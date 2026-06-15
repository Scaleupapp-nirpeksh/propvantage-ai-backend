// tests/unit/searchHelpers.test.js
import { escapeRegex, matchEnum } from '../../utils/searchHelpers.js';

const STATUSES = ['New', 'Qualified', 'Site Visit Completed', 'Negotiating', 'Booked', 'Lost', 'Revived'];
const PRIORITIES = ['High', 'Medium', 'Low', 'Very Low'];

describe('search helpers', () => {
  it('escapeRegex neutralises regex metacharacters', () => {
    expect(escapeRegex('a.b*c')).toBe('a\\.b\\*c');
    expect(escapeRegex('John (VIP)')).toBe('John \\(VIP\\)');
    expect(escapeRegex('plain')).toBe('plain');
  });
  it('matchEnum finds a case-insensitive exact or substring match', () => {
    expect(matchEnum('new', STATUSES)).toBe('New');
    expect(matchEnum('QUALIFIED', STATUSES)).toBe('Qualified');
    expect(matchEnum('negoti', STATUSES)).toBe('Negotiating');
    expect(matchEnum('high', PRIORITIES)).toBe('High');
  });
  it('matchEnum returns undefined when nothing matches or input is blank', () => {
    expect(matchEnum('zzz', STATUSES)).toBeUndefined();
    expect(matchEnum('', STATUSES)).toBeUndefined();
    expect(matchEnum('   ', STATUSES)).toBeUndefined();
  });
});
