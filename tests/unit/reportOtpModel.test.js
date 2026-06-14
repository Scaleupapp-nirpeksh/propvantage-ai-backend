// File: tests/unit/reportOtpModel.test.js
import mongoose from 'mongoose';
import ReportOtp from '../../models/reportOtpModel.js';

describe('ReportOtp model', () => {
  it('validates a minimal doc and defaults attempts to 0', () => {
    const doc = new ReportOtp({
      organization: new mongoose.Types.ObjectId(),
      reportInstance: new mongoose.Types.ObjectId(),
      email: 'a@b.com', codeHash: 'abc', expiresAt: new Date(),
    });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.attempts).toBe(0);
  });
  it('requires reportInstance, email, codeHash, expiresAt', () => {
    const err = new ReportOtp({}).validateSync();
    expect(err.errors.reportInstance).toBeDefined();
    expect(err.errors.email).toBeDefined();
    expect(err.errors.codeHash).toBeDefined();
    expect(err.errors.expiresAt).toBeDefined();
  });
});
