// tests/unit/amenity.test.js
import { normalizeAmenityName, amenityKey } from '../../utils/amenity.js';

describe('amenity normalization', () => {
  it('trims and collapses internal whitespace, preserving display case', () => {
    expect(normalizeAmenityName('  Swimming   Pool ')).toBe('Swimming Pool');
    expect(normalizeAmenityName('Gym')).toBe('Gym');
  });
  it('returns empty string for blank/nullish input', () => {
    expect(normalizeAmenityName('   ')).toBe('');
    expect(normalizeAmenityName(undefined)).toBe('');
    expect(normalizeAmenityName(null)).toBe('');
  });
  it('amenityKey lowercases the normalized name (case-insensitive dedupe key)', () => {
    expect(amenityKey('  Swimming   Pool ')).toBe('swimming pool');
    expect(amenityKey('GYM')).toBe('gym');
    expect(amenityKey('Kids Play Area')).toBe('kids play area');
  });
});
