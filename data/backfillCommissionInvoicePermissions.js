// File: data/backfillCommissionInvoicePermissions.js
// One-time (SP5+): grant the new commission_invoices:* / cp_commission_invoices:*
//   permissions to existing roles that predate the feature.
//
//   Dev side:
//     - Organization Owner / Business Head → already inherit via ALL_PERMISSIONS
//     - Project Director / Sales Head      → grant view + approve + pay
//   CP side:
//     - CP Owner   → already inherits via ALL_CP_PERMISSIONS
//     - CP Manager → grant view + manage
//     - CP Agent   → grant view + manage (for their own prospects' invoices)
//
//   Idempotent ($addToSet skips perms already present). Run after deploy:
//     node data/backfillCommissionInvoicePermissions.js
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import Role from '../models/roleModel.js';

dotenv.config();

const DEV_PERMS = ['commission_invoices:view', 'commission_invoices:approve', 'commission_invoices:pay'];
const CP_PERMS  = ['cp_commission_invoices:view', 'cp_commission_invoices:manage'];

const run = async () => {
  try {
    await connectDB();

    // Dev side — Project Director + Sales Head.
    const devUpdates = await Role.updateMany(
      { slug: { $in: ['project-director', 'sales-head'] } },
      { $addToSet: { permissions: { $each: DEV_PERMS } } }
    );

    // CP side — Manager + Agent (Owner inherits via ALL_CP_PERMISSIONS).
    const cpManagers = await Role.updateMany(
      { name: 'CP Manager' },
      { $addToSet: { permissions: { $each: CP_PERMS } } }
    );
    const cpAgents = await Role.updateMany(
      { name: 'CP Agent' },
      { $addToSet: { permissions: { $each: CP_PERMS } } }
    );

    console.log(
      `CommissionInvoice perms backfill — ` +
      `dev roles (Project Director / Sales Head): ${devUpdates.modifiedCount} updated; ` +
      `CP Manager: ${cpManagers.modifiedCount}; CP Agent: ${cpAgents.modifiedCount}.`
    );
  } finally {
    await mongoose.disconnect();
  }
};

run().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
