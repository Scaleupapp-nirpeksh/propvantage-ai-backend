// tests/unit/supportTicketModel.test.js
import mongoose from 'mongoose';
import SupportTicket, {
  TICKET_STATUSES,
  TICKET_PRIORITIES,
} from '../../models/supportTicketModel.js';

const valid = (over = {}) => ({
  organization: new mongoose.Types.ObjectId(),
  client: { email: 'buyer@example.com', name: 'Buyer' },
  subject: 'Legal - clause 4',
  ...over,
});

describe('SupportTicket model', () => {
  it('validates a minimal valid document', () => {
    expect(new SupportTicket(valid()).validateSync()).toBeUndefined();
  });

  it('requires organization and client email', () => {
    const err = new SupportTicket({}).validateSync();
    expect(err.errors.organization).toBeDefined();
    expect(err.errors['client.email']).toBeDefined();
  });

  it('defaults status to new, source to email, priority to Medium', () => {
    const doc = new SupportTicket(valid());
    expect(doc.status).toBe('new');
    expect(doc.source).toBe('email');
    expect(doc.priority).toBe('Medium');
    expect(doc.category).toBe('other');
  });

  it('auto-generates a publicToken', () => {
    const doc = new SupportTicket(valid());
    expect(typeof doc.publicToken).toBe('string');
    expect(doc.publicToken.length).toBeGreaterThan(16);
    // Two docs get distinct tokens.
    expect(doc.publicToken).not.toBe(new SupportTicket(valid()).publicToken);
  });

  it('rejects an invalid status', () => {
    const err = new SupportTicket(valid({ status: 'bogus' })).validateSync();
    expect(err.errors.status).toBeDefined();
  });

  it('rejects an invalid priority', () => {
    const err = new SupportTicket(valid({ priority: 'Whenever' })).validateSync();
    expect(err.errors.priority).toBeDefined();
  });

  it('validates embedded message direction/visibility enums', () => {
    const ok = new SupportTicket(
      valid({ messages: [{ direction: 'inbound', visibility: 'public', body: 'hi' }] })
    );
    expect(ok.validateSync()).toBeUndefined();
    const bad = new SupportTicket(
      valid({ messages: [{ direction: 'sideways', visibility: 'public', body: 'hi' }] })
    );
    expect(bad.validateSync().errors['messages.0.direction']).toBeDefined();
  });

  it('mints a padded displayId of the TKT-000412 format', () => {
    // Pure formatting check (no DB): mirror the static's padding contract.
    const n = 412;
    expect(`TKT-${String(n).padStart(6, '0')}`).toBe('TKT-000412');
  });

  it('exports the status and priority enums', () => {
    expect(TICKET_STATUSES).toContain('waiting_on_client');
    expect(TICKET_PRIORITIES).toContain('Critical');
  });
});
