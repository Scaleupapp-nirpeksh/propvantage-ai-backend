// File: models/callJobModel.js
// Description: One scheduled AI call: a person × playbook × occurrence. The dedup
//   key guarantees a buyer is never called twice for the same instalment / visit /
//   follow-up. The dispatcher drains due jobs; no-answers reschedule themselves.

import mongoose from 'mongoose';

export const JOB_STATUSES = ['scheduled', 'calling', 'completed', 'no_answer', 'failed', 'cancelled', 'skipped'];

const callJobSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    playbook: { type: mongoose.Schema.Types.ObjectId, ref: 'CallPlaybook', required: true, index: true },
    lead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    entityType: { type: String, enum: ['Lead', 'Installment', 'Sale', 'ConstructionMilestone'], default: 'Lead' },
    entityId: { type: mongoose.Schema.Types.ObjectId },
    dedupKey: { type: String, required: true },

    scheduledFor: { type: Date, required: true, index: true },
    status: { type: String, enum: JOB_STATUSES, default: 'scheduled', index: true },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 2 },
    lastSession: { type: mongoose.Schema.Types.ObjectId, ref: 'CallSession' },
    outcome: { type: String, default: '' },
    reason: { type: String, default: '' }, // why skipped / failed / cancelled
    context: { type: mongoose.Schema.Types.Mixed, default: {} }, // trigger-specific facts (amount, due date, visit time…)
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

callJobSchema.index({ organization: 1, dedupKey: 1 }, { unique: true });
callJobSchema.index({ status: 1, scheduledFor: 1 });

const CallJob = mongoose.model('CallJob', callJobSchema);
export default CallJob;
