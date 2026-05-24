// File: data/backfillCpLeadScoring.js
// One-time: enqueue a lead-score update for every CP-attributed Lead that
//   currently shows score = 0 (or is missing lastScoreUpdate). Fixes the
//   "Lead Score: 0/100 — Cold Lead" cosmetic issue on dev-side LeadDetail
//   for leads that were pushed/accepted before the SP4+ scoring trigger
//   landed in services/prospectService.js + decideLeadRegistration.
//
//   We do NOT backfill `assignedTo` — there's no reliable historical signal
//   for which dev user clicked Accept. New accepts auto-assign going
//   forward; existing un-assigned ones need a manual claim by the dev team.
//
//   Idempotent: re-running just re-queues scoring; the score job is a
//   no-op when inputs haven't changed.
//     node data/backfillCpLeadScoring.js

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import Lead from '../models/leadModel.js';
import { addLeadScoreUpdateJob } from '../services/backgroundJobService.js';

dotenv.config();

const run = async () => {
  try {
    await connectDB();

    const candidates = await Lead.find({
      'channelPartnerAttribution.viaChannelPartner': true,
      status: { $ne: 'pending' },
      $or: [
        { score: { $in: [null, 0] } },
        { lastScoreUpdate: { $exists: false } },
        { lastScoreUpdate: null },
      ],
    })
      .select('_id score lastScoreUpdate assignedTo')
      .lean();

    console.log(`Found ${candidates.length} CP-attributed leads needing scoring…`);

    let queued = 0, unassigned = 0;
    for (const lead of candidates) {
      if (!lead.assignedTo) unassigned++;
      try {
        // Stagger to avoid hammering the score worker.
        addLeadScoreUpdateJob(lead._id, { delay: Math.random() * 10_000 });
        queued++;
      } catch (err) {
        console.warn(`Failed to queue score for ${lead._id}:`, err.message);
      }
    }

    console.log(
      `CP lead scoring backfill — queued: ${queued}; ` +
      `(of those, still unassigned: ${unassigned} — dev team needs to claim).`
    );
  } finally {
    // Give the in-process job runner a beat to flush before disconnect.
    await new Promise((r) => setTimeout(r, 2000));
    await mongoose.disconnect();
    // The background job service registers a periodic interval that keeps
    // the event loop alive; force exit so this one-shot script terminates.
    process.exit(0);
  }
};

run().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
