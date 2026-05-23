// File: data/backfillSp4CpPermissions.js
// One-time (SP4): grant the new cp_prospects:* and cp_external_developers:manage
//   permissions to existing channel-partner organizations' seeded CP roles
//   (which predate these permissions).
//
//   - CP Manager → cp_prospects:view + cp_prospects:manage + cp_external_developers:manage
//   - CP Agent   → cp_prospects:view + cp_prospects:manage (NOT external_developers)
//   - CP Owner   → no action (already inherits via ALL_CP_PERMISSIONS).
//
// Idempotent — $addToSet skips perms already present. Run after deploy:
//   node data/backfillSp4CpPermissions.js
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import Role from '../models/roleModel.js';

dotenv.config();

const run = async () => {
  try {
    await connectDB();
    const managers = await Role.updateMany(
      { name: 'CP Manager' },
      {
        $addToSet: {
          permissions: {
            $each: [
              'cp_prospects:view',
              'cp_prospects:manage',
              'cp_external_developers:manage',
            ],
          },
        },
      }
    );
    const agents = await Role.updateMany(
      { name: 'CP Agent' },
      {
        $addToSet: {
          permissions: {
            $each: ['cp_prospects:view', 'cp_prospects:manage'],
          },
        },
      }
    );
    console.log(
      `SP4 CP permission backfill — ${managers.modifiedCount} CP Manager role(s), ` +
        `${agents.modifiedCount} CP Agent role(s) updated.`
    );
  } finally {
    await mongoose.disconnect();
  }
};

run().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
