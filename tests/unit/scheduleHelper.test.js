// File: tests/unit/scheduleHelper.test.js
import { computeNextRunAt } from '../../services/reports/scheduleHelper.js';

// All assertions use a fixed `from` so the helper stays deterministic/pure.
describe('computeNextRunAt', () => {
  it('weekly: next occurrence of dayOfWeek at time (strictly future)', () => {
    // from = Wed 2026-06-10 09:00 local; weekly Mon (1) 08:00 → Mon 2026-06-15 08:00
    const from = new Date(2026, 5, 10, 9, 0, 0);
    const next = computeNextRunAt({ frequency: 'weekly', dayOfWeek: 1, time: '08:00' }, from);
    expect(next.getFullYear()).toBe(2026);
    expect(next.getMonth()).toBe(5);
    expect(next.getDate()).toBe(15);
    expect(next.getHours()).toBe(8);
    expect(next.getMinutes()).toBe(0);
  });

  it('monthly: next dayOfMonth at time (rolls to next month when past)', () => {
    const from = new Date(2026, 5, 20, 9, 0, 0); // Jun 20
    const next = computeNextRunAt({ frequency: 'monthly', dayOfMonth: 1, time: '07:30' }, from);
    expect(next.getMonth()).toBe(6); // July
    expect(next.getDate()).toBe(1);
    expect(next.getHours()).toBe(7);
    expect(next.getMinutes()).toBe(30);
  });

  it('quarterly: first day of the next calendar quarter at time', () => {
    const from = new Date(2026, 4, 5, 9, 0, 0); // May (Q2) → next quarter starts Jul 1
    const next = computeNextRunAt({ frequency: 'quarterly', time: '09:00' }, from);
    expect(next.getMonth()).toBe(6); // July
    expect(next.getDate()).toBe(1);
  });

  it('returns null when frequency is missing/unknown', () => {
    expect(computeNextRunAt({ frequency: 'daily' }, new Date(2026, 0, 1))).toBeNull();
    expect(computeNextRunAt({}, new Date(2026, 0, 1))).toBeNull();
  });
});
