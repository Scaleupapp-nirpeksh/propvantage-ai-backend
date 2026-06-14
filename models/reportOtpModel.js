// File: models/reportOtpModel.js
// Description: Short-lived one-time codes for the email_otp report gate. TTL-expired.

import mongoose from 'mongoose';

const reportOtpSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization' },
    reportInstance: { type: mongoose.Schema.Types.ObjectId, ref: 'ReportInstance', required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
  },
  { timestamps: true }
);

reportOtpSchema.index({ reportInstance: 1, email: 1 }, { unique: true });
reportOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL auto-cleanup

const ReportOtp = mongoose.model('ReportOtp', reportOtpSchema);
export default ReportOtp;
