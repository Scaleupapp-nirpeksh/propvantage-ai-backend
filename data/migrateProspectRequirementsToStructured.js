// File: data/migrateProspectRequirementsToStructured.js
// One-time: convert Prospect.requirements from free-text String to the
//   structured object Lead.requirements uses
//   ({ timeline, unitType, floor: {preference, specific}, facing,
//      amenities: [], specialRequirements }), so the CP form can capture
//   the same customer detail the dev-side lead form captures and we can
//   pass it through field-for-field on push.
//
//   Existing free-text values are preserved in `requirements.specialRequirements`
//   so no information is lost — the dev still sees exactly what the CP
//   originally wrote, just under a structured subfield.
//
//   Idempotent: skips docs already converted (object shape) or empty.
//
//   IMPORTANT: run this BEFORE deploying the model change (otherwise
//   Mongoose will cast-fail on load of existing docs).
//     node data/migrateProspectRequirementsToStructured.js
//
//   Uses the native driver (not the Mongoose model) so the migration
//   isn't blocked by the new schema's stricter shape.

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';

dotenv.config();

const run = async () => {
  try {
    await connectDB();
    const col = mongoose.connection.db.collection('prospects');

    const total = await col.countDocuments({});
    console.log(`Scanning ${total} prospects…`);

    let converted = 0, alreadyObject = 0, emptyOrMissing = 0;

    const cursor = col.find({}, { projection: { _id: 1, requirements: 1 } });
    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      const r = doc.requirements;

      if (r && typeof r === 'object' && !Array.isArray(r)) {
        alreadyObject++;
        continue;
      }

      if (typeof r !== 'string' || !r.trim()) {
        // Empty/missing string → upgrade to empty object so downstream code
        // can do safe `prospect.requirements.timeline` reads.
        await col.updateOne({ _id: doc._id }, { $set: { requirements: {} } });
        emptyOrMissing++;
        continue;
      }

      await col.updateOne(
        { _id: doc._id },
        {
          $set: {
            requirements: {
              specialRequirements: r.trim(),
              // Other subfields intentionally left unset so they default to
              // undefined; the CP can fill them in via the new UI.
            },
          },
        }
      );
      converted++;
    }

    console.log(
      `Prospect.requirements migration — converted-from-string: ${converted}, ` +
      `already-structured: ${alreadyObject}, empty-or-missing-normalized: ${emptyOrMissing}.`
    );
  } finally {
    await mongoose.disconnect();
  }
};

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
