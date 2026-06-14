// File: tests/unit/emailService.smoke.test.js
// Verifies the email module imports cleanly (deps installed, no createTransport typo).
// Does NOT send a real email (no creds in the test env).
import { sendEmail } from '../../utils/emailService.js';

describe('emailService', () => {
  it('imports without throwing and exposes sendEmail', () => {
    expect(typeof sendEmail).toBe('function');
  });
  it('rejects a call missing required fields', async () => {
    await expect(sendEmail({ to: '', subject: '', html: '' })).rejects.toThrow();
  });
});
