// File: data/backfillProspectStatusSync.js
// One-time: walk every Prospect with pushedToLead set and sync its status
//   from the dev-side Lead.status — fixes the SP4 bug where Prospect.status
//   never advanced even after the dev accepted a status proposal.
//
//   Lead.status enum is a superset of Prospect.status. We only sync when
//   the lead's status is also a valid prospect status ('pending' stays as-is
//   on the lead and the prospect retains its prior status).
//
//   Idempotent: if Prospect.status already matches Lead.status, no write.
//   Run after deploying the fix:
//     node data/backfillProspectStatusSync.js

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import Prospect from '../models/prospectModel.js';
import Lead from '../models/leadModel.js';

dotenv.config();

const PROSPECT_STATUS_VALUES = new Set([
  'New', 'Contacted', 'Qualified', 'Site Visit Scheduled',
  'Site Visit Completed', 'Negotiating', 'Booked', 'Lost', 'Unqualified',
]);

const run = async () => {
  try {
    await connectDB();
    const pushed = await Prospect.find({ pushedToLead: { $ne: null } })
      .select('_id status pushedToLead activities')
      .lean();
    console.log(`Found ${pushed.length} pushed prospects to consider…`);

    let synced = 0, skipped = 0, leadMissing = 0, alreadyMatch = 0;

    for (const p of pushed) {
      const lead = await Lead.findById(p.pushedToLead).select('status').lean();
      if (!lead) { leadMissing++; continue; }
      if (lead.status === 'pending') { skipped++; continue; }
      if (!PROSPECT_STATUS_VALUES.has(lead.status)) { skipped++; continue; }
      if (p.status === lead.status) { alreadyMatch++; continue; }

      await Prospect.updateOne(
        { _id: p._id },
        {
          $set: { status: lead.status },
          $push: {
            activities: {
              type: 'status_change',
              note: `${p.status} → ${lead.status} (back-fill sync from dev side)`,
              at: new Date(),
              by: null,
            },
          },
        }
      );
      synced++;
    }
    console.log(
      `Prospect status sync — synced: ${synced}, already-match: ${alreadyMatch}, ` +
      `skipped-pending-or-invalid: ${skipped}, lead-missing: ${leadMissing}.`
    );
  } finally {
    await mongoose.disconnect();
  }
};

run().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
