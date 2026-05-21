// File: data/backfillPortfolioPermission.js
// One-time: grant portfolio:manage to existing Business Head / Project Director /
//   Marketing Head role documents (which predate the permission).
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import Role from '../models/roleModel.js';

dotenv.config();

const run = async () => {
  try {
    await connectDB();
    const res = await Role.updateMany(
      { name: { $in: ['Business Head', 'Project Director', 'Marketing Head'] } },
      { $addToSet: { permissions: 'portfolio:manage' } }
    );
    console.log(`Granted portfolio:manage to ${res.modifiedCount} role(s).`);
  } finally {
    await mongoose.disconnect();
  }
};

run().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
