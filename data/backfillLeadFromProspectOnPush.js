// File: data/backfillLeadFromProspectOnPush.js
// One-time: for every Prospect that was pushed before the SP4 push-payload
//   fix landed, retroactively populate the dev-side Lead with:
//     • priority from Prospect.priority (only if Lead.priority is still the
//       default 'Very Low' — don't overwrite a dev's deliberate value)
//     • notes from Prospect.notes + Prospect.requirements (appended, not
//       overwritten, and idempotently — re-running won't double-append)
//
//   Idempotent. Run after deploying the push-payload fix:
//     node data/backfillLeadFromProspectOnPush.js

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import Prospect from '../models/prospectModel.js';
import Lead from '../models/leadModel.js';

dotenv.config();

// Marker we wrap the appended block in, so re-runs detect prior appends and
// skip. Pick something unlikely to appear in user text.
const APPEND_MARKER = '— synced from CP prospect —';

const composeProspectBlock = (p) => {
  const notes = String(p.notes || '').trim();
  // SP4+ — Prospect.requirements is now structured. Surface specialRequirements
  // (the free-text subfield) into the backfilled Lead.notes block so the dev
  // sees any extra detail. The other structured subfields (timeline/unitType
  // /floor/facing/amenities) are copied into Lead.requirements directly by
  // the live push path and don't belong here.
  const reqs = String(p.requirements?.specialRequirements || '').trim();
  if (!notes && !reqs) return '';
  const parts = [];
  if (notes) parts.push(notes);
  if (reqs)  parts.push(`Requirements: ${reqs}`);
  return `\n\n${APPEND_MARKER}\n${parts.join('\n\n')}`;
};

const run = async () => {
  try {
    await connectDB();
    const pushed = await Prospect.find({ pushedToLead: { $ne: null } })
      .select('_id priority notes requirements pushedToLead')
      .lean();
    console.log(`Found ${pushed.length} pushed prospects to consider…`);

    let prioritySynced = 0, notesAppended = 0, prioritySkipped = 0, notesSkipped = 0, leadMissing = 0;

    for (const p of pushed) {
      const lead = await Lead.findById(p.pushedToLead);
      if (!lead) { leadMissing++; continue; }

      const update = {};

      // ─── Priority — only sync if dev hasn't touched it (still 'Very Low')
      const prospectPriority = p.priority || null;
      if (prospectPriority && lead.priority === 'Very Low') {
        update.priority = prospectPriority;
      } else if (prospectPriority) {
        prioritySkipped++;
      }

      // ─── Notes — append if not already present (marker-based dedup)
      const block = composeProspectBlock(p);
      if (block) {
        const existing = String(lead.notes || '');
        if (existing.includes(APPEND_MARKER)) {
          notesSkipped++; // already back-filled in a previous run
        } else {
          update.notes = (existing.trim() ? existing.trim() : '') + block;
        }
      }

      if (Object.keys(update).length === 0) continue;

      // Use updateOne so we don't trigger save-side hooks that might do
      // something heavy (lead scoring on a backfill is wasteful).
      await Lead.updateOne({ _id: lead._id }, { $set: update });
      if (update.priority) prioritySynced++;
      if (update.notes)    notesAppended++;
    }

    console.log(
      `Lead-from-Prospect backfill — ` +
      `priority synced: ${prioritySynced} (skipped because dev-set: ${prioritySkipped}); ` +
      `notes appended: ${notesAppended} (already-backfilled skipped: ${notesSkipped}); ` +
      `lead missing: ${leadMissing}.`
    );
  } finally {
    await mongoose.disconnect();
  }
};

run().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
