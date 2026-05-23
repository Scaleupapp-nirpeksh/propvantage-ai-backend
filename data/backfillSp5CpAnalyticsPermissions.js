// File: data/backfillSp5CpAnalyticsPermissions.js
// One-time (SP5): grant the new cp_analytics:* permissions to existing
//   channel-partner organizations' seeded CP roles (which predate SP5).
//
//   - CP Manager → cp_analytics:view + cp_analytics:view_team
//   - CP Agent   → cp_analytics:view (NOT view_team — Agents must not see peers)
//   - CP Owner   → no action (already inherits via ALL_CP_PERMISSIONS).
//
// Idempotent — $addToSet skips perms already present. Run after deploy:
//   node data/backfillSp5CpAnalyticsPermissions.js
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
            $each: ['cp_analytics:view', 'cp_analytics:view_team'],
          },
        },
      }
    );
    const agents = await Role.updateMany(
      { name: 'CP Agent' },
      {
        $addToSet: {
          permissions: {
            $each: ['cp_analytics:view'],
          },
        },
      }
    );
    console.log(
      `SP5 CP analytics permission backfill — ${managers.modifiedCount} CP Manager role(s), ` +
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
