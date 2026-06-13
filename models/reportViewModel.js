// File: models/reportViewModel.js
// Description: One access record per (report instance, viewer email). Powers the
// open-rate dashboard. IP is stored hashed, never raw (PII).

import mongoose from 'mongoose';

const reportViewSchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: [true, 'Organization is required'],
      index: true,
    },
    reportInstance: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ReportInstance',
      required: [true, 'Report instance is required'],
      index: true,
    },
    publicSlug: { type: String },
    email: { type: String, required: [true, 'Email is required'], lowercase: true, trim: true },
    matchedRecipient: { type: Boolean, default: false },
    isForwarded: { type: Boolean, default: false },
    ipHash: { type: String },
    userAgent: { type: String },
    firstViewedAt: { type: Date, default: Date.now },
    lastViewedAt: { type: Date, default: Date.now },
    viewCount: { type: Number, default: 1 },
    totalDwellMs: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// One row per viewer per report; access events upsert + increment viewCount.
reportViewSchema.index({ reportInstance: 1, email: 1 }, { unique: true });

const ReportView = mongoose.model('ReportView', reportViewSchema);

export default ReportView;
