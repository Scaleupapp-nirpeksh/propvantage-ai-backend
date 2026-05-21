// File: data/backfillChannelPartnerCategory.js
// One-time: set category='broker_firm' on ChannelPartner docs that predate the field.
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import ChannelPartner from '../models/channelPartnerModel.js';

dotenv.config();

const run = async () => {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is not set in .env');
  await mongoose.connect(process.env.MONGO_URI);
  const res = await ChannelPartner.updateMany(
    { category: { $exists: false } },
    { $set: { category: 'broker_firm' } }
  );
  console.log(`Backfilled category on ${res.modifiedCount} channel partner(s).`);
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
