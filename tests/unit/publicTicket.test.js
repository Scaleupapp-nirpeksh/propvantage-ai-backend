// tests/unit/publicTicket.test.js
// The public controller must return ONLY public-safe fields + a public timeline.
// It must never leak internal notes, assignee PII, or the real outbound author name.
import { jest, describe, test, expect, beforeEach } from '@jest/globals';

const mockFindOne = jest.fn();
jest.unstable_mockModule('../../models/supportTicketModel.js', () => ({
  default: { findOne: mockFindOne },
  TICKET_STATUSES: ['new', 'assigned', 'in_progress', 'waiting_on_client', 'resolved', 'closed'],
}));

// Mock the service so importing the controller doesn't pull in the whole
// support-service dependency chain; these read-only tests only exercise GET.
const mockAddPublicReply = jest.fn();
jest.unstable_mockModule('../../services/support/supportService.js', () => ({
  addPublicClientReply: mockAddPublicReply,
}));

const { getPublicTicket } = await import('../../controllers/publicTicketController.js');

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
  // asyncHandler returns a promise; surface thrown errors for assertions.
  await getPublicTicket(req, res, (err) => {
    if (err) throw err;
  });
};

beforeEach(() => mockFindOne.mockReset());

describe('getPublicTicket', () => {
  const created = new Date('2026-06-10T09:00:00Z');
  const ticket = {
    displayId: 'TKT-000412',
    subject: 'Legal - clause 4',
    status: 'in_progress',
    category: 'legal',
    createdAt: created,
    updatedAt: new Date('2026-06-12T10:00:00Z'),
    organization: 'org1',
    assignee: 'user-secret-id',
    messages: [
      {
        direction: 'inbound',
        visibility: 'public',
        from: 'buyer@example.com',
        body: 'Please clarify clause 4.',
        at: new Date('2026-06-10T09:00:01Z'),
      },
      {
        direction: 'internal',
        visibility: 'internal',
        body: 'SECRET internal note — reassign to legal',
        authorUser: 'agent-1',
        at: new Date('2026-06-11T09:00:00Z'),
      },
      {
        direction: 'outbound',
        visibility: 'public',
        from: 'helpdesk',
        body: 'We are reviewing it.',
        authorUser: 'Jane The Agent',
        at: new Date('2026-06-12T10:00:00Z'),
      },
    ],
  };

  test('returns only public-safe fields + a public timeline', async () => {
    mockFindOne.mockResolvedValueOnce(ticket);
    const res = makeRes();
    await run({ params: { token: 'tok' } }, res);

    expect(mockFindOne).toHaveBeenCalledWith({ publicToken: 'tok' });
    const data = res.body.data;
    expect(Object.keys(data).sort()).toEqual(
      ['category', 'createdAt', 'displayId', 'status', 'subject', 'timeline', 'updatedAt'].sort()
    );
    expect(data.displayId).toBe('TKT-000412');

    // Leading status event, then both public messages — internal note dropped.
    expect(data.timeline[0]).toEqual({ type: 'status', at: created, status: 'received' });
    const messages = data.timeline.filter((e) => e.type === 'message');
    expect(messages).toHaveLength(2);
    expect(messages.map((m) => m.direction)).toEqual(['inbound', 'outbound']);

    // Timeline sorted ascending.
    const times = data.timeline.map((e) => new Date(e.at).getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  test('never leaks internal notes or assignee PII; outbound author is "Support team"', async () => {
    mockFindOne.mockResolvedValueOnce(ticket);
    const res = makeRes();
    await run({ params: { token: 'tok' } }, res);

    const json = JSON.stringify(res.body);
    expect(json).not.toContain('SECRET internal note');
    expect(json).not.toContain('user-secret-id'); // assignee id
    expect(json).not.toContain('Jane The Agent'); // real author name
    expect(json).not.toContain('org1'); // org internals

    const outbound = res.body.data.timeline.find((e) => e.direction === 'outbound');
    expect(outbound.author).toBe('Support team');
  });

  test('404 on unknown token', async () => {
    mockFindOne.mockResolvedValueOnce(null);
    const res = makeRes();
    await expect(run({ params: { token: 'nope' } }, res)).rejects.toThrow('Ticket not found');
    expect(res.statusCode).toBe(404);
  });
});
