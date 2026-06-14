// File: tests/unit/otp.test.js
import { generateOtp, hashOtp, verifyOtp } from '../../services/reports/otp.js';

describe('otp helpers', () => {
  it('generateOtp returns a 6-digit string', () => {
    expect(generateOtp()).toMatch(/^\d{6}$/);
  });
  it('hashOtp is deterministic and not the plaintext', () => {
    expect(hashOtp('123456')).toBe(hashOtp('123456'));
    expect(hashOtp('123456')).not.toBe('123456');
  });
  it('verifyOtp matches only the correct code', () => {
    const h = hashOtp('123456');
    expect(verifyOtp('123456', h)).toBe(true);
    expect(verifyOtp('000000', h)).toBe(false);
    expect(verifyOtp('', h)).toBe(false);
  });
});
