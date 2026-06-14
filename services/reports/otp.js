// File: services/reports/otp.js
// Pure-ish OTP helpers. generateOtp uses randomness; hash/verify are deterministic.

import crypto from 'crypto';

/** A 6-digit numeric code as a string (cryptographically random). */
export const generateOtp = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

/** SHA-256 of the code — never store the plaintext. */
export const hashOtp = (code) => crypto.createHash('sha256').update(String(code)).digest('hex');

/** Constant-ish check that a code matches a stored hash. */
export const verifyOtp = (code, hash) => !!code && !!hash && hashOtp(code) === hash;

export default { generateOtp, hashOtp, verifyOtp };
