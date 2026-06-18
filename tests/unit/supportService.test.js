// tests/unit/supportService.test.js
// In-process service tests: mock every DB/email/notification dependency so the
// support loop is exercised with no network and no Mongo.
import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';

// ─── Mock the models, email service, and notification service ────────────────
const mockUserFindOne = jest.fn();
const mockUserFind = jest.fn();
jest.unstable_mockModule('../../models/userModel.js', () => ({
  default: { findOne: mockUserFindOne, find: mockUserFind },
}));
// resolveAssignee does `User.find(...).populate('roleRef','name')` → array of users.
const usersFind = (arr) => mockUserFind.mockReturnValue({ populate: () => Promise.resolve(arr) });

const mockTaskCreate = jest.fn();
const mockTaskFindById = jest.fn();
jest.unstable_mockModule('../../models/taskModel.js', () => ({
  default: { create: mockTaskCreate, findById: mockTaskFindById },
}));

// supportInboxService.getOrgInbox is called via helpdeskReplyTo on every client
// send — mock it so unit tests never touch the DB.
const mockGetOrgInbox = jest.fn();
jest.unstable_mockModule('../../services/support/supportInboxService.js', () => ({
  getOrgInbox: mockGetOrgInbox,
  provisionSupportInbox: jest.fn(),
  regenerateOrgInbox: jest.fn(),
}));

const mockTicketCreate = jest.fn();
const mockMint = jest.fn();
const mockTicketFindById = jest.fn();
const mockTicketFindOne = jest.fn();
jest.unstable_mockModule('../../models/supportTicketModel.js', () => ({
  default: {
    create: mockTicketCreate,
    mintTicketNumber: mockMint,
    findById: mockTicketFindById,
    findOne: mockTicketFindOne,
  },
  TICKET_STATUSES: ['new', 'assigned', 'in_progress', 'waiting_on_client', 'resolved', 'closed'],
  TICKET_PRIORITIES: [],
  TICKET_CATEGORIES: [],
}));

const mockSendEmail = jest.fn();
jest.unstable_mockModule('../../utils/emailService.js', () => ({
  sendEmail: mockSendEmail,
}));

const mockCreateNotification = jest.fn();
jest.unstable_mockModule('../../services/notificationService.js', () => ({
  createNotification: mockCreateNotification,
}));

const {
  parseCategory,
  resolveAssignee,
  createTicketFromMessage,
  updateTicketStatus,
  addPublicClientReply,
  CATEGORY_TO_ROLE,
  TICKET_TASK_CATEGORY,
} = await import('../../services/support/supportService.js');

const ORG = new mongoose.Types.ObjectId();

beforeEach(() => {
  [
    mockUserFindOne,
    mockUserFind,
    mockTaskCreate,
    mockTaskFindById,
    mockTicketCreate,
    mockMint,
    mockTicketFindById,
    mockTicketFindOne,
    mockSendEmail,
    mockCreateNotification,
    mockGetOrgInbox,
  ].forEach((m) => m.mockReset());
  // Default: an inbox exists, so client emails get a Reply-To.
  mockGetOrgInbox.mockResolvedValue({ address: 'demo@helpdesk.prop-vantage.com' });
});

// ─── parseCategory ───────────────────────────────────────────────────────────
describe('parseCategory', () => {
  test("'Legal - x' → 'legal'", () => {
    expect(parseCategory('Legal - clause 4')).toBe('legal');
  });
  test("'sales: y' → 'sales'", () => {
    expect(parseCategory('sales: pricing question')).toBe('sales');
  });
  test("'Legal Issue - x' → 'legal' (leading word match)", () => {
    expect(parseCategory('Legal Issue - help')).toBe('legal');
  });
  test("'crm - x' → 'crm'", () => {
    expect(parseCategory('CRM - data')).toBe('crm');
  });
  test("'random' → 'other'", () => {
    expect(parseCategory('random subject with no prefix')).toBe('other');
  });
  test('empty/undefined → other', () => {
    expect(parseCategory('')).toBe('other');
    expect(parseCategory(undefined)).toBe('other');
  });
});

// ─── resolveAssignee ───────────────────────────────────────────────────────
describe('resolveAssignee', () => {
  test('picks the mapped department head (by legacy role string)', async () => {
    const head = { _id: new mongoose.Types.ObjectId(), role: CATEGORY_TO_ROLE.legal };
    usersFind([head]);
    const result = await resolveAssignee(ORG, 'legal');
    expect(result).toBe(head);
  });

  test('matches the head set via roleRef.name too', async () => {
    const head = { _id: new mongoose.Types.ObjectId(), role: 'Sales Executive', roleRef: { name: 'Legal Head' } };
    usersFind([head]);
    const result = await resolveAssignee(ORG, 'legal');
    expect(result).toBe(head);
  });

  test('falls back when the mapped head is missing', async () => {
    const fallback = { _id: new mongoose.Types.ObjectId(), role: 'CRM Head' };
    // No Sales Head present; the first fallback (CRM Head) is.
    usersFind([fallback]);
    const result = await resolveAssignee(ORG, 'sales');
    expect(result).toBe(fallback);
  });

  test('returns null when no head and no fallback exist', async () => {
    usersFind([{ _id: new mongoose.Types.ObjectId(), role: 'Sales Executive' }]);
    const result = await resolveAssignee(ORG, 'finance');
    expect(result).toBeNull();
  });
});

// ─── createTicketFromMessage ──────────────────────────────────────────────
describe('createTicketFromMessage', () => {
  const msg = {
    from: 'buyer@example.com',
    fromName: 'Buyer',
    subject: 'Legal - clause 4',
    text: 'Please clarify clause 4.',
    html: '<p>Please clarify clause 4.</p>',
    messageId: 'test-123',
  };

  test('creates a ticket + linked task, assigns to the head, mints displayId, stores the inbound message', async () => {
    const head = { _id: new mongoose.Types.ObjectId(), role: 'Legal Head' };
    usersFind([head]); // resolveAssignee → Legal Head
    mockMint.mockResolvedValueOnce({ ticketNumber: 412, displayId: 'TKT-000412' });

    const savedTicket = {
      _id: new mongoose.Types.ObjectId(),
      displayId: 'TKT-000412',
      save: jest.fn().mockResolvedValue(undefined),
      populate: jest.fn().mockResolvedValue({ displayId: 'TKT-000412' }),
    };
    mockTicketCreate.mockResolvedValueOnce(savedTicket);
    const task = { _id: new mongoose.Types.ObjectId() };
    mockTaskCreate.mockResolvedValueOnce(task);
    mockSendEmail.mockResolvedValue({ success: true });
    mockCreateNotification.mockResolvedValue({});

    await createTicketFromMessage(ORG, msg);

    // Ticket created with the right shape.
    const ticketArg = mockTicketCreate.mock.calls[0][0];
    expect(ticketArg.category).toBe('legal');
    expect(ticketArg.status).toBe('assigned');
    expect(ticketArg.displayId).toBe('TKT-000412');
    expect(ticketArg.assignee).toBe(head._id);
    expect(ticketArg.client).toEqual({ email: 'buyer@example.com', name: 'Buyer' });
    expect(ticketArg.originalMessageId).toBe('test-123');
    expect(ticketArg.messages).toHaveLength(1);
    expect(ticketArg.messages[0]).toMatchObject({
      direction: 'inbound',
      visibility: 'public',
      from: 'buyer@example.com',
      body: 'Please clarify clause 4.',
    });

    // Linked task carries source 'support_ticket' + the Customer Service category.
    const taskArg = mockTaskCreate.mock.calls[0][0];
    expect(taskArg.source).toBe('support_ticket');
    expect(taskArg.category).toBe(TICKET_TASK_CATEGORY);
    expect(taskArg.assignedTo).toBe(head._id);
    expect(taskArg.title).toBe('TKT-000412: Legal - clause 4');
    expect(taskArg.linkedEntity.entityType).toBe('SupportTicket');
    expect(taskArg.linkedEntity.entityId).toBe(savedTicket._id);

    // Linked back + saved.
    expect(savedTicket.linkedTask).toBe(task._id);
    expect(savedTicket.save).toHaveBeenCalled();

    // Notified the assignee + auto-replied to the client.
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ticket_assigned', recipient: head._id })
    );
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'buyer@example.com' })
    );
    expect(mockSendEmail.mock.calls[0][0].subject).toContain('TKT-000412');
  });

  test("status is 'new' and no notification when no assignee resolves", async () => {
    // category 'other' → resolveAssignee finds no Head in the org → null.
    usersFind([{ _id: new mongoose.Types.ObjectId(), role: 'Sales Executive' }]);
    // getSystemUser then issues a chainable query (.populate().sort()).
    mockUserFindOne.mockReturnValueOnce({
      populate: () => ({ sort: () => Promise.resolve({ _id: new mongoose.Types.ObjectId() }) }),
    });
    mockMint.mockResolvedValueOnce({ ticketNumber: 1, displayId: 'TKT-000001' });

    const savedTicket = {
      _id: new mongoose.Types.ObjectId(),
      displayId: 'TKT-000001',
      save: jest.fn().mockResolvedValue(undefined),
      populate: jest.fn().mockResolvedValue({}),
    };
    mockTicketCreate.mockResolvedValueOnce(savedTicket);
    mockTaskCreate.mockResolvedValueOnce({ _id: new mongoose.Types.ObjectId() });
    mockSendEmail.mockResolvedValue({ success: true });

    await createTicketFromMessage(ORG, { ...msg, subject: 'random no prefix' });

    expect(mockTicketCreate.mock.calls[0][0].status).toBe('new');
    expect(mockTicketCreate.mock.calls[0][0].category).toBe('other');
    expect(mockCreateNotification).not.toHaveBeenCalled();
    // createdBy falls back to the system user (resolved via User.findOne), task still created.
    expect(mockTaskCreate).toHaveBeenCalled();
  });

  test('ticket creation still succeeds when the auto-reply email fails', async () => {
    const head = { _id: new mongoose.Types.ObjectId(), role: 'Legal Head' };
    usersFind([head]);
    mockMint.mockResolvedValueOnce({ ticketNumber: 5, displayId: 'TKT-000005' });
    const savedTicket = {
      _id: new mongoose.Types.ObjectId(),
      displayId: 'TKT-000005',
      save: jest.fn().mockResolvedValue(undefined),
      populate: jest.fn().mockResolvedValue({ displayId: 'TKT-000005' }),
    };
    mockTicketCreate.mockResolvedValueOnce(savedTicket);
    mockTaskCreate.mockResolvedValueOnce({ _id: new mongoose.Types.ObjectId() });
    mockSendEmail.mockRejectedValue(new Error('smtp down'));
    mockCreateNotification.mockResolvedValue({});

    const result = await createTicketFromMessage(ORG, msg);
    expect(result).toBeDefined();
    expect(savedTicket.populate).toHaveBeenCalled();
  });

  test('auto-reply sets Reply-To to the helpdesk address so client replies thread back', async () => {
    usersFind([{ _id: new mongoose.Types.ObjectId(), role: 'Legal Head' }]);
    mockMint.mockResolvedValueOnce({ ticketNumber: 9, displayId: 'TKT-000009' });
    const savedTicket = {
      _id: new mongoose.Types.ObjectId(),
      displayId: 'TKT-000009',
      save: jest.fn().mockResolvedValue(undefined),
      populate: jest.fn().mockResolvedValue({}),
    };
    mockTicketCreate.mockResolvedValueOnce(savedTicket);
    mockTaskCreate.mockResolvedValueOnce({ _id: new mongoose.Types.ObjectId() });
    mockSendEmail.mockResolvedValue({ success: true, messageId: 'x' });
    mockCreateNotification.mockResolvedValue({});

    await createTicketFromMessage(ORG, msg); // msg has no `to` → falls back to helpdeskReplyTo

    expect(mockSendEmail.mock.calls[0][0].replyTo).toBe('demo@helpdesk.prop-vantage.com');
  });
});

// ─── updateTicketStatus ──────────────────────────────────────────────────────
describe('updateTicketStatus', () => {
  const makeTicket = (overrides = {}) => ({
    _id: new mongoose.Types.ObjectId(),
    displayId: 'TKT-000010',
    organization: ORG,
    status: 'assigned',
    client: { email: 'buyer@example.com' },
    messages: [],
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  });

  test('rejects an invalid status', async () => {
    await expect(updateTicketStatus('id', 'user', 'bogus')).rejects.toThrow('Invalid status');
  });

  test('sets status + closedAt, records an internal note, and emails the client', async () => {
    const ticket = makeTicket();
    mockTicketFindById.mockResolvedValueOnce(ticket);
    mockSendEmail.mockResolvedValue({ success: true, messageId: 'm' });

    const userId = new mongoose.Types.ObjectId();
    await updateTicketStatus(ticket._id, userId, 'resolved');

    expect(ticket.status).toBe('resolved');
    expect(ticket.closedAt).toBeInstanceOf(Date);
    expect(ticket.messages).toHaveLength(1);
    expect(ticket.messages[0]).toMatchObject({ direction: 'internal', visibility: 'internal' });
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'buyer@example.com', replyTo: 'demo@helpdesk.prop-vantage.com' })
    );
    expect(ticket.save).toHaveBeenCalled();
  });

  test('syncs the linked task when resolving', async () => {
    const linkedTaskId = new mongoose.Types.ObjectId();
    const ticket = makeTicket({ linkedTask: linkedTaskId });
    mockTicketFindById.mockResolvedValueOnce(ticket);
    mockSendEmail.mockResolvedValue({ success: true });
    const task = { status: 'In Progress', save: jest.fn().mockResolvedValue(undefined) };
    mockTaskFindById.mockResolvedValueOnce(task);

    await updateTicketStatus(ticket._id, new mongoose.Types.ObjectId(), 'resolved');

    expect(task.status).toBe('Completed');
    expect(task.save).toHaveBeenCalled();
  });

  test('no-ops when the status is unchanged', async () => {
    const ticket = makeTicket({ status: 'in_progress' });
    mockTicketFindById.mockResolvedValueOnce(ticket);
    await updateTicketStatus(ticket._id, new mongoose.Types.ObjectId(), 'in_progress');
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(ticket.save).not.toHaveBeenCalled();
  });
});

// ─── addPublicClientReply ────────────────────────────────────────────────────
describe('addPublicClientReply', () => {
  test('appends a public inbound message, reopens a closed ticket, notifies assignee', async () => {
    const assignee = new mongoose.Types.ObjectId();
    const ticket = {
      _id: new mongoose.Types.ObjectId(),
      displayId: 'TKT-000011',
      organization: ORG,
      status: 'closed',
      assignee,
      client: { email: 'buyer@example.com' },
      messages: [],
      save: jest.fn().mockResolvedValue(undefined),
    };
    mockTicketFindOne.mockResolvedValueOnce(ticket);
    mockCreateNotification.mockResolvedValue({});

    const result = await addPublicClientReply('tok_123', '  Any update?  ');

    expect(result).toBe(ticket);
    expect(ticket.status).toBe('in_progress'); // reopened
    expect(ticket.messages).toHaveLength(1);
    expect(ticket.messages[0]).toMatchObject({
      direction: 'inbound',
      visibility: 'public',
      from: 'buyer@example.com',
      body: 'Any update?',
    });
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ticket_client_reply', recipient: assignee })
    );
  });

  test('rejects an empty message', async () => {
    await expect(addPublicClientReply('tok', '   ')).rejects.toThrow('Empty message');
  });

  test('returns null for an unknown token', async () => {
    mockTicketFindOne.mockResolvedValueOnce(null);
    const result = await addPublicClientReply('nope', 'hello');
    expect(result).toBeNull();
  });
});
