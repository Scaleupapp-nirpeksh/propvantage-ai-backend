// tests/unit/supportInbound.test.js
// Exercises the `test` inbound adapter + the unauthenticated inbound controller flow:
//   recipient routing, new-ticket creation, threading on [TKT-####], dedup, and the
//   "unrouted recipient → 200 (never 4xx, never a ticket in a random org)" guarantee.
import { jest, describe, test, expect, beforeEach } from '@jest/globals';

// ─── Mocks ───────────────────────────────────────────────────────────────────
const mockInboxFindOne = jest.fn();
jest.unstable_mockModule('../../models/supportInboxModel.js', () => ({
  default: { findOne: mockInboxFindOne },
}));

const mockTicketFindOne = jest.fn();
jest.unstable_mockModule('../../models/supportTicketModel.js', () => ({
  default: { findOne: mockTicketFindOne },
  TICKET_STATUSES: [],
  TICKET_PRIORITIES: [],
  TICKET_CATEGORIES: [],
}));

const mockCreateTicket = jest.fn();
const mockAppendReply = jest.fn();
jest.unstable_mockModule('../../services/support/supportService.js', () => ({
  createTicketFromMessage: mockCreateTicket,
  replyToClient: jest.fn(),
  addInternalNote: jest.fn(),
  appendInboundReply: mockAppendReply,
}));

// axios is imported by the controller (used only for SES confirmation).
jest.unstable_mockModule('axios', () => ({ default: { get: jest.fn() } }));

const { inboundEmail } = await import('../../controllers/supportController.js');
const testAdapter = await import('../../services/support/inbound/test.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────
const makeRes = () => {
  const res = {};
  res.statusCode = 200;
  res.status = jest.fn((c) => {
    res.statusCode = c;
    return res;
  });
  res.json = jest.fn((b) => {
    res.body = b;
    return res;
  });
  return res;
};

const run = async (req, res) => {
  await inboundEmail(req, res, (err) => {
    if (err) throw err;
  });
};

const makeReq = (body, over = {}) => ({
  params: { provider: 'test' },
  body,
  get: () => undefined,
  ...over,
});

// `select()` chain used by the dedup query.
const selectable = (val) => ({ select: () => Promise.resolve(val) });

beforeEach(() => {
  [mockInboxFindOne, mockTicketFindOne, mockCreateTicket, mockAppendReply].forEach((m) =>
    m.mockReset()
  );
  delete process.env.NODE_ENV; // test adapter verify() is permissive when not production
});

// ─── test adapter ─────────────────────────────────────────────────────────────
describe('test inbound adapter', () => {
  test('normalize maps the canonical body', () => {
    const msg = testAdapter.normalize({
      body: {
        to: 'help@hd.com',
        from: 'buyer@example.com',
        fromName: 'Buyer',
        subject: 'Legal - x',
        text: 'hi',
        html: '<p>hi</p>',
        messageId: 'm-1',
      },
    });
    expect(msg).toMatchObject({
      to: 'help@hd.com',
      from: 'buyer@example.com',
      fromName: 'Buyer',
      subject: 'Legal - x',
      messageId: 'm-1',
    });
  });

  test('normalize returns null without to/from', () => {
    expect(testAdapter.normalize({ body: { subject: 'x' } })).toBeNull();
  });

  test('verify is true outside production', () => {
    expect(testAdapter.verify({ get: () => undefined })).toBe(true);
  });

  test('verify requires the secret in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.SUPPORT_TEST_SECRET = 's3cret';
    expect(testAdapter.verify({ get: () => 's3cret' })).toBe(true);
    expect(testAdapter.verify({ get: () => 'wrong' })).toBe(false);
    delete process.env.NODE_ENV;
  });
});

// ─── inbound controller ────────────────────────────────────────────────────────
describe('inboundEmail controller', () => {
  test('unknown provider → 404', async () => {
    const res = makeRes();
    await expect(run(makeReq({}, { params: { provider: 'nope' } }), res)).rejects.toThrow(
      'Unknown inbound provider'
    );
    expect(res.statusCode).toBe(404);
  });

  test('routes by recipient and creates a ticket for a new subject', async () => {
    mockInboxFindOne.mockResolvedValueOnce({ organization: 'org1', address: 'help@hd.com' });
    mockTicketFindOne.mockReturnValueOnce(selectable(null)); // dedup: not seen
    mockTicketFindOne.mockResolvedValueOnce(null); // findThreadTicket: no thread
    mockCreateTicket.mockResolvedValueOnce({ _id: 't1' });

    const res = makeRes();
    await run(
      makeReq({
        to: 'help@hd.com',
        from: 'buyer@example.com',
        subject: 'Legal - clause 4',
        text: 'help',
        messageId: 'm-new',
      }),
      res
    );

    expect(mockInboxFindOne).toHaveBeenCalledWith({ address: 'help@hd.com', active: true });
    expect(mockCreateTicket).toHaveBeenCalledWith('org1', expect.objectContaining({ from: 'buyer@example.com' }));
    expect(mockAppendReply).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, created: true });
  });

  test('routes a +tagged recipient by stripping the tag', async () => {
    mockInboxFindOne.mockResolvedValueOnce({ organization: 'org1' });
    mockTicketFindOne.mockReturnValueOnce(selectable(null));
    mockTicketFindOne.mockResolvedValueOnce(null);
    mockCreateTicket.mockResolvedValueOnce({ _id: 't1' });

    const res = makeRes();
    await run(
      makeReq({ to: 'Help+spam@HD.com', from: 'b@x.com', subject: 'hi', messageId: 'm-tag' }),
      res
    );
    expect(mockInboxFindOne).toHaveBeenCalledWith({ address: 'help@hd.com', active: true });
    expect(res.statusCode).toBe(200);
  });

  test('threads to an existing ticket when subject carries [TKT-000001]', async () => {
    mockInboxFindOne.mockResolvedValueOnce({ organization: 'org1' });
    mockTicketFindOne.mockReturnValueOnce(selectable(null)); // dedup
    mockTicketFindOne.mockResolvedValueOnce({ _id: 'existing-1', displayId: 'TKT-000001' }); // thread match
    mockAppendReply.mockResolvedValueOnce({ _id: 'existing-1' });

    const res = makeRes();
    await run(
      makeReq({
        to: 'help@hd.com',
        from: 'buyer@example.com',
        subject: 'Re: Legal - clause 4 [TKT-000001]',
        text: 'thanks',
        messageId: 'm-reply',
      }),
      res
    );

    expect(mockAppendReply).toHaveBeenCalledWith('existing-1', expect.objectContaining({ messageId: 'm-reply' }));
    expect(mockCreateTicket).not.toHaveBeenCalled();
    expect(res.body).toEqual({ success: true, threaded: true });
  });

  test('dedups a repeated messageId (no create, no thread, 200)', async () => {
    mockInboxFindOne.mockResolvedValueOnce({ organization: 'org1' });
    mockTicketFindOne.mockReturnValueOnce(selectable({ _id: 'seen' })); // dedup hit

    const res = makeRes();
    await run(
      makeReq({ to: 'help@hd.com', from: 'b@x.com', subject: 'x', messageId: 'dup-1' }),
      res
    );

    expect(mockCreateTicket).not.toHaveBeenCalled();
    expect(mockAppendReply).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, deduped: true });
  });

  test('unrouted recipient → 200 (never 4xx, never a ticket in a random org)', async () => {
    mockInboxFindOne.mockResolvedValueOnce(null); // no inbox for this address

    const res = makeRes();
    await run(
      makeReq({ to: 'nobody@hd.com', from: 'b@x.com', subject: 'x', messageId: 'm-unrouted' }),
      res
    );

    expect(mockCreateTicket).not.toHaveBeenCalled();
    expect(mockAppendReply).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, routed: false });
  });

  test('unparseable message (no from) → 400', async () => {
    const res = makeRes();
    await expect(run(makeReq({ subject: 'only subject' }), res)).rejects.toThrow(
      'Could not parse the inbound message'
    );
    expect(res.statusCode).toBe(400);
  });
});
