// File: data/backfillChannelPartnerCategory.js
// One-time: set category='broker_firm' on ChannelPartner docs that predate the field.
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import ChannelPartner from '../models/channelPartnerModel.js';

dotenv.config();

const run = async () => {
  try {
    await connectDB();
    const res = await ChannelPartner.updateMany(
      { category: { $exists: false } },
      { $set: { category: 'broker_firm' } }
    );
    console.log(`Backfilled category on ${res.modifiedCount} channel partner(s).`);
  } finally {
    await mongoose.disconnect();
  }
};

run().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
