// File: services/import/intelligence.js
// Description: The pass that runs after an import so the platform's intelligence works on
//   the new records straight away. It only ever touches records created by that import batch,
//   and only DERIVED fields (scores) — never anything that came from the files. It also repairs
//   one importer artefact: records the files gave no date for must not look like "today's".
//   Safe to run again: it recomputes the same values.

import Lead from '../../models/leadModel.js';
import Interaction from '../../models/interactionModel.js';
import Sale from '../../models/salesModel.js';
import ImportBatch from '../../models/importBatchModel.js';
import { calculateLeadScore } from '../leadScoringService.js';

async function pooled(items, size, fn) {
  let i = 0;
  const worker = async () => { while (i < items.length) { const idx = i; i += 1; await fn(items[idx], idx); } };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}

const qualification = (score, lead) => (score >= 80 && lead.budget?.min && lead.requirements?.timeline ? 'Pre-Approved' : score >= 70 ? 'Qualified' : score >= 50 ? 'In Progress' : 'Not Qualified');

/** Records stamped at import time because the files carried no date → date them at the batch's earliest record. */
async function repairUndated(org, batch) {
  const stampedFrom = new Date(new Date(batch.startedAt || batch.createdAt).getTime() - 60 * 1000);
  const base = { organization: org, importBatch: batch._id };
  const first = await Lead.findOne({ ...base, createdAt: { $lt: stampedFrom } }).sort({ createdAt: 1 }).select('createdAt').lean();
  if (!first) return { clients: 0, meetings: 0, bookings: 0 };
  const anchor = first.createdAt;
  // `createdAt` is immutable through Mongoose; this is a deliberate, narrow native update.
  const leads = await Lead.collection.updateMany({ ...base, createdAt: { $gte: stampedFrom } }, { $set: { createdAt: anchor } });
  const leadDates = new Map((await Lead.find(base).select('createdAt').lean()).map((l) => [String(l._id), l.createdAt]));
  let meetings = 0;
  for (const it of await Interaction.find({ ...base, occurredAt: { $exists: false }, createdAt: { $gte: stampedFrom } }).select('lead').lean()) {
    await Interaction.collection.updateOne({ _id: it._id }, { $set: { createdAt: leadDates.get(String(it.lead)) || anchor } }); meetings += 1;
  }
  let bookings = 0;
  for (const s of await Sale.find({ ...base, bookingDate: null, createdAt: { $gte: stampedFrom } }).select('lead').lean()) {
    await Sale.collection.updateOne({ _id: s._id }, { $set: { createdAt: leadDates.get(String(s.lead)) || anchor } }); bookings += 1;
  }
  return { clients: leads.modifiedCount || 0, meetings, bookings, datedAt: anchor };
}

export async function runIntelligencePass({ organizationId: org, batchId, onProgress = () => {} }) {
  const batch = await ImportBatch.findOne({ _id: batchId, organization: org }).lean();
  if (!batch) throw new Error('Import not found');
  if (batch.mode !== 'commit') throw new Error('Only a completed import can be processed');
  const startedAt = Date.now();

  onProgress('Dating undated records', 0, 1);
  const undated = await repairUndated(org, batch);

  // Score the clients this import created, plus any client it added meetings to.
  const created = await Lead.find({ organization: org, importBatch: batch._id }).select('_id').lean();
  const touched = await Interaction.distinct('lead', { organization: org, importBatch: batch._id });
  const ids = [...new Set([...created.map((l) => String(l._id)), ...touched.map(String)])];
  let scored = 0; let failed = 0; let total = 0; const grades = {};
  await pooled(ids, 6, async (id) => {
    try {
      const lead = await Lead.findById(id);
      if (!lead) return;
      const r = await calculateLeadScore(lead);
      await Lead.updateOne({ _id: id }, { $set: { score: r.totalScore, scoreBreakdown: r.breakdown, scoreGrade: r.grade, confidence: r.confidence, lastScoreUpdate: new Date(), qualificationStatus: qualification(r.totalScore, lead) } }, { timestamps: false });
      scored += 1; total += r.totalScore; grades[r.grade] = (grades[r.grade] || 0) + 1;
    } catch (err) { failed += 1; }
    if ((scored + failed) % 100 === 0) onProgress('Scoring clients', scored + failed, ids.length);
  });

  const intelligence = { ranAt: new Date(), durationMs: Date.now() - startedAt, clientsScored: scored, scoringFailed: failed, averageScore: scored ? Math.round(total / scored) : 0, grades, undated };
  await ImportBatch.updateOne({ _id: batch._id }, { $set: { intelligence } });
  return intelligence;
}
