// tests/unit/voiceAgentActionsPure.test.js — DB-free helpers of the voice tool set
import { normalizeTimeline, normalizeFloorPreference, formatInr, parseAgentDatetime, resultToSpeakable } from '../../services/voice/agentActions.js';
import { normalizePhone, withinCallingHours } from '../../services/voice/helpers.js';

describe('voice agent pure helpers', () => {
  it('normalizes timelines from enum values and free text', () => {
    expect(normalizeTimeline('3-6_months')).toBe('3-6_months');
    expect(normalizeTimeline('within six months')).toBe('3-6_months');
    expect(normalizeTimeline('immediately')).toBe('immediate');
    expect(normalizeTimeline('next year')).toBe('12+_months');
    expect(normalizeTimeline('')).toBeUndefined();
  });

  it('normalizes floor preferences', () => {
    expect(normalizeFloorPreference('higher floors please')).toBe('high');
    expect(normalizeFloorPreference('mid')).toBe('medium');
    expect(normalizeFloorPreference('no preference')).toBe('any');
  });

  it('formats rupees for speech', () => {
    expect(formatInr(25000000)).toBe('₹2.5 Cr');
    expect(formatInr(24500000)).toBe('₹2.45 Cr');
    expect(formatInr(8500000)).toBe('₹85 L');
    expect(formatInr(0)).toBe('');
  });

  it('parses agent datetimes, treating naive values as IST and rejecting the distant past', () => {
    const now = new Date('2026-09-05T06:00:00Z');
    expect(parseAgentDatetime('2026-09-13T11:00:00+05:30', now).toISOString()).toBe('2026-09-13T05:30:00.000Z');
    expect(parseAgentDatetime('2026-09-13T11:00', now).toISOString()).toBe('2026-09-13T05:30:00.000Z');
    expect(parseAgentDatetime('2026-09-13', now).toISOString()).toBe('2026-09-13T05:30:00.000Z');
    expect(parseAgentDatetime('2020-01-01T11:00:00+05:30', now)).toBeNull();
    expect(parseAgentDatetime('not a date', now)).toBeNull();
  });

  it('renders results as speakable strings', () => {
    expect(resultToSpeakable({ spoken: 'Booked.' })).toBe('Booked.');
    expect(resultToSpeakable({ error: 'nope' })).toBe('Error: nope');
    expect(resultToSpeakable({ spoken: 'Available: 2.', units: [{ unitNumber: 'A1' }] })).toMatch(/^Available: 2\. Details: \[/);
  });

  it('normalizes Indian phone numbers to E.164', () => {
    expect(normalizePhone('98765 43210')).toBe('+919876543210');
    expect(normalizePhone('09876543210')).toBe('+919876543210');
    expect(normalizePhone('+91 88002 37144')).toBe('+918800237144');
    expect(normalizePhone('919876543210')).toBe('+919876543210');
    expect(normalizePhone('12345')).toBeNull();
  });

  it('checks calling hours in IST', () => {
    // 05:30Z = 11:00 IST ; 16:30Z = 22:00 IST
    expect(withinCallingHours({ start: '09:00', end: '21:00' }, new Date('2026-09-05T05:30:00Z'))).toBe(true);
    expect(withinCallingHours({ start: '09:00', end: '21:00' }, new Date('2026-09-05T16:30:00Z'))).toBe(false);
  });
});
