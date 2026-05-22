// File: data/cleanupLegacyChannelPartnerRoles.js
// One-time (SP3): remove the obsolete pre-platform "Channel Partner *" roles
//   seeded into developer organizations. On the two-sided platform, channel
//   partners are their own organizations — these developer-org roles are dead
//   weight. No real users are assigned to them (confirmed during SP3 planning);
//   the script still reports any unexpected assignments before deleting.
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import Role from '../models/roleModel.js';
import User from '../models/userModel.js';

dotenv.config();

const LEGACY_ROLE_NAMES = [
  'Channel Partner Manager',
  'Channel Partner Admin',
  'Channel Partner Agent',
];

const run = async () => {
  try {
    await connectDB();
    const roles = await Role.find({ name: { $in: LEGACY_ROLE_NAMES } }).select(
      '_id name organization'
    );
    if (roles.length === 0) {
      console.log('No legacy "Channel Partner *" roles found — nothing to do.');
      return;
    }
    const roleIds = roles.map((r) => r._id);

    // Defensive: surface any users still pointing at a legacy role.
    const assigned = await User.find({ roleRef: { $in: roleIds } }).select(
      'email organization'
    );
    if (assigned.length > 0) {
      console.warn(`WARNING: ${assigned.length} user(s) are still assigned to a legacy CP role:`);
      assigned.forEach((u) => console.warn(`  - ${u.email} (org ${u.organization})`));
      console.warn('Proceeding with deletion per the SP3 decision — reassign these users.');
    }

    const orgCount = new Set(roles.map((r) => String(r.organization))).size;
    const del = await Role.deleteMany({ _id: { $in: roleIds } });
    console.log(
      `Deleted ${del.deletedCount} legacy "Channel Partner *" role(s) across ${orgCount} organization(s).`
    );
  } finally {
    await mongoose.disconnect();
  }
};

run().catch((err) => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});
