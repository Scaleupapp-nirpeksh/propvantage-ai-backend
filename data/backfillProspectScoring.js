// File: data/backfillProspectScoring.js
// One-time: compute a score + grade for every existing Prospect using the
//   new prospectScoringService, and for any Prospect already pushed to a
//   Lead, mirror the current Lead.score/grade into Prospect.devScore so
//   the CP UI immediately shows both numbers.
//
//   Idempotent: re-running just recomputes; values are overwritten with
//   the same answer when nothing has changed.
//     node data/backfillProspectScoring.js

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import Prospect from '../models/prospectModel.js';
import Lead from '../models/leadModel.js';
import {
  updateProspectScore,
  mirrorLeadScoreToProspect,
} from '../services/prospectScoringService.js';

dotenv.config();

const run = async () => {
  try {
    await connectDB();

    const prospects = await Prospect.find({}).select('_id pushedToLead').lean();
    console.log(`Scoring ${prospects.length} prospects…`);

    let scored = 0, mirrored = 0, mirrorSkipped = 0;
    for (const p of prospects) {
      await updateProspectScore(p._id);
      scored++;

      if (p.pushedToLead) {
        const lead = await Lead.findById(p.pushedToLead).select('score scoreGrade').lean();
        if (lead && lead.score != null) {
          await mirrorLeadScoreToProspect(p._id, lead.score, lead.scoreGrade);
          mirrored++;
        } else {
          mirrorSkipped++;
        }
      }
    }

    console.log(
      `Prospect scoring backfill — scored: ${scored}; ` +
      `dev-score mirrored: ${mirrored} (skipped because lead unscored: ${mirrorSkipped}).`
    );
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
};

run().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
