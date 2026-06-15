// File: data/migrateLeadsDeveloperReady.js
// One-time (2026-06): migrate existing Lead documents onto the developer-ready
// enums. Idempotent — re-running is safe. Uses the raw driver (Lead.collection)
// to bypass schema validators and the pre-save hook, because legacy values are
// invalid under the new schema and we don't want the hook stamping "now".
//
// Run (dry-run first):  node data/migrateLeadsDeveloperReady.js --dry
// Then for real:        node data/migrateLeadsDeveloperReady.js
//
// Mapping (see data/leadEnumMigrationMaps.js + utils/leadPriority.js):
//   source        legacy → {Channel Partner, Management, Direct, Referral, Marketing, Cold Calling}
//   budgetSource  legacy → {self_funded, bank_loan}
//   status        Contacted→New, Site Visit Scheduled→Qualified, Unqualified→Lost
//   followUpType  whatsapp→text, site_visit→meeting
//   priority      recomputed from requirements.timeline (drops Critical)
//   floor.specific removed; statusHistory seeded if empty.

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import Lead from '../models/leadModel.js';
import {
  mapSource, mapBudgetSource, mapStatus, mapFollowUpType,
} from './leadEnumMigrationMaps.js';
import { derivePriorityFromTimeline } from '../utils/leadPriority.js';

dotenv.config();
const DRY = process.argv.includes('--dry');

const run = async () => {
  try {
    await connectDB();
    console.log(`🔄 Migrating leads to developer-ready model${DRY ? ' (DRY RUN)' : ''}…`);

    const cursor = Lead.collection.find({});
    let ops = [];
    let scanned = 0;
    let changed = 0;

    for await (const lead of cursor) {
      scanned++;
      const set = {};
      const unset = {};

      const newSource = mapSource(lead.source);
      if (newSource !== lead.source) set.source = newSource;

      const oldBs = lead.budget?.budgetSource;
      if (oldBs) {
        const nb = mapBudgetSource(oldBs);
        if (nb !== oldBs) set['budget.budgetSource'] = nb;
      }

      const newStatus = mapStatus(lead.status);
      if (newStatus !== lead.status) set.status = newStatus;

      // Also remap an in-flight CP proposed status (rare; transient field).
      const oldProposed = lead.proposedStatusChange?.status;
      if (oldProposed) {
        const newProposed = mapStatus(oldProposed);
        if (newProposed !== oldProposed) set['proposedStatusChange.status'] = newProposed;
      }

      const oldFt = lead.followUpSchedule?.followUpType;
      if (oldFt) {
        const nf = mapFollowUpType(oldFt);
        if (nf !== oldFt) set['followUpSchedule.followUpType'] = nf;
      }

      const newPriority = derivePriorityFromTimeline(lead.requirements?.timeline);
      if (newPriority !== lead.priority) set.priority = newPriority;

      if (lead.requirements?.floor?.specific !== undefined) {
        unset['requirements.floor.specific'] = '';
      }

      if (!Array.isArray(lead.statusHistory) || lead.statusHistory.length === 0) {
        set.statusHistory = [{
          status: newStatus,
          changedAt: lead.statusChangedAt || lead.createdAt || new Date(),
          changedBy: null,
        }];
      }

      const update = {};
      if (Object.keys(set).length) update.$set = set;
      if (Object.keys(unset).length) update.$unset = unset;
      if (!Object.keys(update).length) continue;

      changed++;
      ops.push({ updateOne: { filter: { _id: lead._id }, update } });
      if (ops.length >= 500 && !DRY) {
        await Lead.collection.bulkWrite(ops);
        ops = [];
      }
    }

    if (ops.length && !DRY) await Lead.collection.bulkWrite(ops);

    console.log(`✅ Scanned ${scanned}; ${DRY ? 'would change' : 'changed'} ${changed}.`);
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
};

run();
