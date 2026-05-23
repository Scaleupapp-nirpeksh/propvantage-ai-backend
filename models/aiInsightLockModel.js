// File: models/aiInsightLockModel.js
// Description: SP5 — Mongo sentinel collection used by the insight pipeline
//   to prevent concurrent regenerations for the same (cpOrgId, surface).
//   The unique index serialises insert attempts; the TTL index purges stale
//   locks after 60s (defence against an orphaned lock from a crashed worker).
//
//   Resolved Open Item §13(3): Mongo sentinel (not in-memory Map) so the
//   lock survives PM2 cluster mode + future horizontal scaling.

import mongoose from 'mongoose';

const aiInsightLockSchema = new mongoose.Schema({
  cpOrgId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
  surface:  { type: String, required: true },
  lockedAt: { type: Date, default: Date.now },
});

// Serialises generation attempts for the same (org, surface).
aiInsightLockSchema.index({ cpOrgId: 1, surface: 1 }, { unique: true });
// TTL — Mongo deletes locks older than 60s. Defence against orphaned locks
// from a crashed worker / killed process.
aiInsightLockSchema.index({ lockedAt: 1 }, { expireAfterSeconds: 60 });

const AIInsightLock = mongoose.model('AIInsightLock', aiInsightLockSchema);
export default AIInsightLock;
