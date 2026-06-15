// tests/unit/leadStatusMachine.test.js
import {
  LEAD_STATUSES, canTransition, assertTransition, allowedNextStatuses,
} from '../../utils/leadStatusMachine.js';

describe('lead status machine', () => {
  it('lists the new status set (internal Booked value, no Contacted/Site Visit Scheduled/Unqualified)', () => {
    expect(LEAD_STATUSES).toEqual([
      'pending', 'New', 'Qualified', 'Site Visit Completed',
      'Negotiating', 'Booked', 'Lost', 'Revived',
    ]);
  });
  it('allows the happy-path funnel transitions', () => {
    expect(canTransition('New', 'Qualified')).toBe(true);
    expect(canTransition('Qualified', 'Site Visit Completed')).toBe(true);
    expect(canTransition('Site Visit Completed', 'Negotiating')).toBe(true);
    expect(canTransition('Negotiating', 'Booked')).toBe(true);
  });
  it('only allows Revived from Lost, and only to Site Visit Completed/Negotiating', () => {
    expect(canTransition('Lost', 'Revived')).toBe(true);
    expect(canTransition('New', 'Revived')).toBe(false);
    expect(canTransition('Revived', 'Site Visit Completed')).toBe(true);
    expect(canTransition('Revived', 'Negotiating')).toBe(true);
    expect(canTransition('Revived', 'New')).toBe(false);
  });
  it('treats a no-op (same status) as allowed', () => {
    expect(canTransition('Negotiating', 'Negotiating')).toBe(true);
  });
  it('handles the CP intake queue: pending → New (accept) / Lost (reject), but not skipping intake', () => {
    expect(canTransition('pending', 'New')).toBe(true);
    expect(canTransition('pending', 'Lost')).toBe(true);
    expect(canTransition('pending', 'Qualified')).toBe(false);
  });
  it('rejects unknown target statuses', () => {
    expect(canTransition('New', 'Contacted')).toBe(false);
  });
  it('assertTransition throws on an invalid move', () => {
    expect(() => assertTransition('New', 'Booked')).toThrow(/Invalid lead status transition/);
    expect(assertTransition('New', 'Qualified')).toBe(true);
  });
  it('allowedNextStatuses returns the forward set', () => {
    expect(allowedNextStatuses('Site Visit Completed')).toEqual(['Negotiating', 'Booked', 'Lost']);
  });
});
