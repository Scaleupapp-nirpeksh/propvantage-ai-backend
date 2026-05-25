// File: data/backfillLeadStatusChangedAt.js
// One-time (2026-05-25): seed Lead.statusChangedAt for existing rows so the
// dev-side Leads list shows correct "stuck for N days" aging immediately
// after this field rollout. New status changes are stamped by the
// leadSchema pre-save hook from now on.
//
// Strategy: set statusChangedAt = updatedAt for every Lead that doesn't
// already have one. This is the best proxy without a status-history table —
// in most cases the last update was a status mutation. For leads where the
// last update was a notes/score change, the aging may understate by hours
// or days, which is acceptable for an aging signal.
//
// Idempotent — only updates Leads where statusChangedAt is null/missing.

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import Lead from '../models/leadModel.js';

dotenv.config();

const run = async () => {
  try {
    await connectDB();
    console.log('📅 Backfilling Lead.statusChangedAt from updatedAt…');

    // Use updateMany with $set on documents lacking the field. We bypass the
    // pre-save hook here intentionally — we don't want the hook stamping
    // "now" on every existing lead, which would zero out the aging signal.
    const res = await Lead.collection.updateMany(
      { statusChangedAt: { $in: [null, undefined] } },
      [
        // Aggregation-pipeline update: set statusChangedAt to $updatedAt,
        // or to $createdAt if updatedAt is missing.
        { $set: { statusChangedAt: { $ifNull: ['$updatedAt', '$createdAt'] } } },
      ]
    );

    console.log(`✅ Matched ${res.matchedCount} leads, updated ${res.modifiedCount}.`);
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('❌ Backfill failed:', err);
    process.exit(1);
  }
};

run();
