// tests/unit/isoWeek.test.js
// Unit tests for utils/isoWeek.js
// No mocks needed — pure date arithmetic, no I/O.
//
// Run:
//   node --experimental-vm-modules node_modules/jest/bin/jest.js \
//     --config jest.unit.config.mjs tests/unit/isoWeek.test.js

import { describe, test, expect } from '@jest/globals';
import {
  isoWeekOf,
  weekStartOf,
  weekEndOf,
  boundsFromIsoWeek,
  previousIsoWeek,
} from '../../utils/isoWeek.js';

// Helper: build a UTC Date from year/month(1-indexed)/day
function utc(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day));
}

// =============================================================================
// isoWeekOf
// =============================================================================

describe('isoWeekOf', () => {
  test('returns string in YYYY-Www format', () => {
    const result = isoWeekOf(utc(2026, 6, 16));
    expect(result).toMatch(/^\d{4}-W\d{2}$/);
  });

  test('Monday 2026-06-15 → 2026-W25', () => {
    // 2026-06-15 is a Monday
    expect(isoWeekOf(utc(2026, 6, 15))).toBe('2026-W25');
  });

  test('Sunday 2026-06-21 (end of same week) → 2026-W25', () => {
    // 2026-06-21 is a Sunday — still week 25
    expect(isoWeekOf(utc(2026, 6, 21))).toBe('2026-W25');
  });

  test('Monday 2026-06-22 (next week) → 2026-W26', () => {
    expect(isoWeekOf(utc(2026, 6, 22))).toBe('2026-W26');
  });

  test('Jan 1 2015 falls in week 53 of 2014 (year boundary)', () => {
    // 2015-01-01 is a Thursday and belongs to week 1 of 2015
    // Actually, Jan 1 2015 is Thursday: it IS week 1 of 2015
    expect(isoWeekOf(utc(2015, 1, 1))).toBe('2015-W01');
  });

  test('Dec 31 2018 falls in week 1 of 2019 (year boundary rollover)', () => {
    // 2018-12-31 is a Monday; the Thursday of that week (2019-01-03) is in 2019 → W01 2019
    expect(isoWeekOf(utc(2018, 12, 31))).toBe('2019-W01');
  });

  test('Jan 2 2020 is in week 1 of 2020', () => {
    // 2020-01-01 is Wednesday, 2020-01-02 is Thursday → week 1
    expect(isoWeekOf(utc(2020, 1, 2))).toBe('2020-W01');
  });

  test('Dec 28 2020 (Monday) is in week 53 of 2020', () => {
    // 2020 has 53 ISO weeks
    expect(isoWeekOf(utc(2020, 12, 28))).toBe('2020-W53');
  });

  test('uses current date when called with no args', () => {
    const result = isoWeekOf();
    expect(result).toMatch(/^\d{4}-W\d{2}$/);
  });
});

// =============================================================================
// weekStartOf
// =============================================================================

describe('weekStartOf', () => {
  test('returns a Date', () => {
    expect(weekStartOf(utc(2026, 6, 17))).toBeInstanceOf(Date);
  });

  test('mid-week Wednesday → Monday 00:00:00 UTC', () => {
    const wednesday = utc(2026, 6, 17); // Wednesday
    const start = weekStartOf(wednesday);
    expect(start.toISOString()).toBe('2026-06-15T00:00:00.000Z'); // Monday
  });

  test('Monday input → same Monday 00:00:00 UTC', () => {
    const monday = utc(2026, 6, 15);
    const start = weekStartOf(monday);
    expect(start.toISOString()).toBe('2026-06-15T00:00:00.000Z');
  });

  test('Sunday input → Monday of that week 00:00:00 UTC', () => {
    const sunday = utc(2026, 6, 21);
    const start = weekStartOf(sunday);
    expect(start.toISOString()).toBe('2026-06-15T00:00:00.000Z');
  });

  test('year boundary: Mon 2018-12-31 → start is itself', () => {
    const monday = utc(2018, 12, 31);
    const start = weekStartOf(monday);
    expect(start.toISOString()).toBe('2018-12-31T00:00:00.000Z');
  });
});

// =============================================================================
// weekEndOf
// =============================================================================

describe('weekEndOf', () => {
  test('returns a Date', () => {
    expect(weekEndOf(utc(2026, 6, 17))).toBeInstanceOf(Date);
  });

  test('mid-week Wednesday → Sunday 23:59:59.999 UTC', () => {
    const wednesday = utc(2026, 6, 17);
    const end = weekEndOf(wednesday);
    expect(end.toISOString()).toBe('2026-06-21T23:59:59.999Z'); // Sunday
  });

  test('Monday input → Sunday at end-of-day same week', () => {
    const monday = utc(2026, 6, 15);
    const end = weekEndOf(monday);
    expect(end.toISOString()).toBe('2026-06-21T23:59:59.999Z');
  });

  test('Sunday input → itself (as end-of-day)', () => {
    const sunday = utc(2026, 6, 21);
    const end = weekEndOf(sunday);
    expect(end.toISOString()).toBe('2026-06-21T23:59:59.999Z');
  });

  test('weekEnd is exactly 7 days - 1ms after weekStart', () => {
    const date = utc(2026, 6, 17);
    const start = weekStartOf(date);
    const end   = weekEndOf(date);
    expect(end.getTime() - start.getTime()).toBe(7 * 86400000 - 1);
  });
});

// =============================================================================
// boundsFromIsoWeek
// =============================================================================

describe('boundsFromIsoWeek', () => {
  test('returns { weekStart, weekEnd }', () => {
    const result = boundsFromIsoWeek('2026-W25');
    expect(result).toHaveProperty('weekStart');
    expect(result).toHaveProperty('weekEnd');
    expect(result.weekStart).toBeInstanceOf(Date);
    expect(result.weekEnd).toBeInstanceOf(Date);
  });

  test('2026-W25 starts on Monday 2026-06-15', () => {
    const { weekStart } = boundsFromIsoWeek('2026-W25');
    expect(weekStart.toISOString()).toBe('2026-06-15T00:00:00.000Z');
  });

  test('2026-W25 ends on Sunday 2026-06-21 23:59:59.999', () => {
    const { weekEnd } = boundsFromIsoWeek('2026-W25');
    expect(weekEnd.toISOString()).toBe('2026-06-21T23:59:59.999Z');
  });

  test('roundtrip: boundsFromIsoWeek(isoWeekOf(date)).weekStart == weekStartOf(date)', () => {
    const date = utc(2026, 6, 17);
    const week = isoWeekOf(date);
    const { weekStart } = boundsFromIsoWeek(week);
    expect(weekStart.getTime()).toBe(weekStartOf(date).getTime());
  });

  test('roundtrip: boundsFromIsoWeek(isoWeekOf(date)).weekEnd == weekEndOf(date)', () => {
    const date = utc(2026, 6, 17);
    const week = isoWeekOf(date);
    const { weekEnd } = boundsFromIsoWeek(week);
    expect(weekEnd.getTime()).toBe(weekEndOf(date).getTime());
  });

  test('throws on invalid format', () => {
    expect(() => boundsFromIsoWeek('2026-25')).toThrow(/Invalid isoWeek/);
    expect(() => boundsFromIsoWeek('bad')).toThrow(/Invalid isoWeek/);
  });

  test('week 1 of 2019 (cross-year): starts 2018-12-31', () => {
    const { weekStart } = boundsFromIsoWeek('2019-W01');
    expect(weekStart.toISOString()).toBe('2018-12-31T00:00:00.000Z');
  });
});

// =============================================================================
// previousIsoWeek
// =============================================================================

describe('previousIsoWeek', () => {
  test('returns string in YYYY-Www format', () => {
    expect(previousIsoWeek('2026-W25')).toMatch(/^\d{4}-W\d{2}$/);
  });

  test('2026-W25 → 2026-W24', () => {
    expect(previousIsoWeek('2026-W25')).toBe('2026-W24');
  });

  test('mid-year week: 2026-W10 → 2026-W09', () => {
    expect(previousIsoWeek('2026-W10')).toBe('2026-W09');
  });

  test('week 1 rollover: 2026-W01 → last week of 2025', () => {
    const prev = previousIsoWeek('2026-W01');
    // 2025's last ISO week is W52
    expect(prev).toBe('2025-W52');
  });

  test('2019-W01 → 2018-W52 (cross-year rollover)', () => {
    // 2019-W01 starts on 2018-12-31; previous week is 2018-W52
    expect(previousIsoWeek('2019-W01')).toBe('2018-W52');
  });

  test('2021-W01 → 2020-W53 (year with 53 weeks)', () => {
    // 2020 has 53 ISO weeks
    expect(previousIsoWeek('2021-W01')).toBe('2020-W53');
  });

  test('throws on invalid isoWeek string', () => {
    expect(() => previousIsoWeek('bad-W99')).toThrow();
  });
});
