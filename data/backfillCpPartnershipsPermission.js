// File: data/backfillCpPartnershipsPermission.js
// One-time (SP3): grant the cp_partnerships:* permissions to existing channel-
//   partner organizations' seeded CP roles (which predate these permissions).
//   CP Owner & CP Manager → view + manage; CP Agent → view only.
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import Role from '../models/roleModel.js';

dotenv.config();

const run = async () => {
  try {
    await connectDB();
    const managers = await Role.updateMany(
      { name: { $in: ['CP Owner', 'CP Manager'] } },
      { $addToSet: { permissions: { $each: ['cp_partnerships:view', 'cp_partnerships:manage'] } } }
    );
    const agents = await Role.updateMany(
      { name: 'CP Agent' },
      { $addToSet: { permissions: 'cp_partnerships:view' } }
    );
    console.log(
      `cp_partnerships:* backfill — ${managers.modifiedCount} CP Owner/Manager role(s), ` +
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
