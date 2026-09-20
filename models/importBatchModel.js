// File: models/importBatchModel.js
// Description: History of data imports. One document per run (dry-run or commit):
//   which files, which format was detected, per-entity counts (found / created /
//   duplicates skipped / rejected), and every issue raised. Imports are
//   insert-only — nothing in here ever describes an edit to existing data.

import mongoose from 'mongoose';

const issueSchema = new mongoose.Schema(
  {
    severity: { type: String, enum: ['error', 'warning', 'info'], default: 'warning' },
    sheet: { type: String },
    row: { type: Number },
    field: { type: String },
    message: { type: String },
  },
  { _id: false }
);

const entityCountSchema = new mongoose.Schema(
  {
    entity: { type: String },
    found: { type: Number, default: 0 },
    created: { type: Number, default: 0 },
    duplicates: { type: Number, default: 0 },
    rejected: { type: Number, default: 0 },
  },
  { _id: false }
);

const importBatchSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    mode: { type: String, enum: ['dry_run', 'commit'], required: true },
    status: { type: String, enum: ['validated', 'importing', 'completed', 'completed_with_issues', 'failed'], default: 'validated' },
    files: [{ _id: false, name: String, sizeBytes: Number, sha256: String, format: String, sheets: Number }],
    formats: [{ type: String }],
    options: { type: mongoose.Schema.Types.Mixed },
    counts: { type: [entityCountSchema], default: [] },
    issues: { type: [issueSchema], default: [] },
    issueTotals: { errors: { type: Number, default: 0 }, warnings: { type: Number, default: 0 }, info: { type: Number, default: 0 } },
    unmappedColumns: [{ _id: false, sheet: String, column: String }],
    skippedSheets: [{ _id: false, file: String, sheet: String, reason: String }],
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' },
    // Live progress while a commit runs in the background.
    progress: { stage: { type: String }, done: { type: Number, default: 0 }, total: { type: Number, default: 0 } },
    // Login accounts this import created (never the password).
    accounts: [{ _id: false, name: String, email: String, role: String, placeholder: Boolean }],
    // Short plain-language facts about the loaded data (totals by status, value booked…).
    summary: { type: mongoose.Schema.Types.Mixed },
    error: { type: String },
    startedAt: { type: Date, default: Date.now },
    finishedAt: { type: Date },
    durationMs: { type: Number },
  },
  { timestamps: true }
);

importBatchSchema.index({ organization: 1, createdAt: -1 });

const ImportBatch = mongoose.model('ImportBatch', importBatchSchema);
export default ImportBatch;
