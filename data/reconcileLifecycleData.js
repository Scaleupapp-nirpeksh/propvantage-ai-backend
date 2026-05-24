// File: data/reconcileLifecycleData.js
// One-time (2026-05-24 lifecycle-repair): READ-ONLY audit script that finds
// data the dev team should review by hand to fix attribution / commission
// issues introduced by the bugs we just patched.
//
// The bugs we just fixed were:
//   B1 — Sale attribution silently dropped at Lead→Sale handoff
//   B2 — 20% trigger never fired (read non-existent salePrice fields)
//   B4 — CommissionRecord silently created at ₹0 when no rule matches
//   B14 — Sale cancellation set Lead.status='Active' (not in enum)
//
// This script DOES NOT modify any data. It scans the database for records
// matching each bug's signature and writes a CSV report. The data team
// reviews each row and decides whether to retroactively patch.
//
// Usage:
//   node data/reconcileLifecycleData.js
//   node data/reconcileLifecycleData.js --org=<orgId>   # restrict to one developer org
//
// Output: /tmp/lifecycle-reconciliation-report-YYYY-MM-DD.csv

import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import Sale from '../models/salesModel.js';
import Lead from '../models/leadModel.js';
import CommissionRecord from '../models/commissionRecordModel.js';
import CommissionInvoice from '../models/commissionInvoiceModel.js';
import Installment from '../models/installmentModel.js';
import Organization from '../models/organizationModel.js';

dotenv.config();

const argOrg = (process.argv.find((a) => a.startsWith('--org=')) || '').slice('--org='.length);

const formatRow = (cols) => cols.map((v) => {
  if (v == null) return '';
  const s = String(v);
  return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
}).join(',');

const run = async () => {
  await connectDB();
  console.log('🔍 Lifecycle reconciliation report — scanning…');
  if (argOrg) console.log(`   Restricted to organization: ${argOrg}`);

  const orgFilter = argOrg ? { organization: argOrg } : {};
  const rows = [];
  rows.push(formatRow(['bug', 'severity', 'entity', 'entityId', 'organization', 'detail']));

  // ─── B1: Sales where lead.channelPartnerAttribution says CP but Sale doesn't ───
  console.log('  • B1 — Sale attribution dropped at Lead→Sale handoff…');
  const sales = await Sale.find({
    ...orgFilter,
    'channelPartnerAttribution.viaChannelPartner': { $ne: true },
  }).select('_id organization lead salePrice bookingDate').lean();
  let b1 = 0;
  for (const sale of sales) {
    const lead = await Lead.findById(sale.lead).select('channelPartnerAttribution').lean();
    if (lead?.channelPartnerAttribution?.viaChannelPartner === true) {
      rows.push(formatRow([
        'B1',
        'critical',
        'Sale',
        sale._id,
        sale.organization,
        `Lead has CP attribution but Sale doesn't. salePrice=${sale.salePrice}. ` +
          `Lead.partners=${(lead.channelPartnerAttribution.partners || []).length}. ` +
          `Booked ${new Date(sale.bookingDate).toISOString().slice(0, 10)}.`,
      ]));
      b1++;
    }
  }
  console.log(`     → found ${b1} sales with dropped CP attribution`);

  // ─── B4: CommissionRecords at ₹0 ───────────────────────────────────────────
  console.log('  • B4 — CommissionRecords at ₹0 (silent no-rule victims)…');
  const zeroRecords = await CommissionRecord.find({
    ...orgFilter,
    grossAmount: 0,
    status: { $ne: 'cancelled' },
  }).select('_id organization sale channelPartner').lean();
  for (const rec of zeroRecords) {
    rows.push(formatRow([
      'B4',
      'critical',
      'CommissionRecord',
      rec._id,
      rec.organization,
      `Commission record exists at ₹0. sale=${rec.sale} cp=${rec.channelPartner}. ` +
        `Configure a CommissionRule or set the prospect agreement, then re-sync.`,
    ]));
  }
  console.log(`     → found ${zeroRecords.length} ₹0 commission records`);

  // ─── B2: Sales past 20% paid but commissionInvoiceTriggered not set ────────
  console.log('  • B2 — sales past 20% but trigger never fired…');
  const cpSales = await Sale.find({
    ...orgFilter,
    'channelPartnerAttribution.viaChannelPartner': true,
    'commissionInvoiceTriggered.at': { $exists: false },
    status: { $ne: 'cancelled' },
  }).select('_id organization salePrice').lean();
  let b2 = 0;
  for (const sale of cpSales) {
    const agg = await Installment.aggregate([
      { $match: { sale: new mongoose.Types.ObjectId(String(sale._id)) } },
      { $group: { _id: null, paid: { $sum: { $ifNull: ['$paidAmount', 0] } } } },
    ]);
    const paid = agg[0]?.paid || 0;
    const salePrice = Number(sale.salePrice) || 0;
    if (salePrice > 0 && paid / salePrice >= 0.20) {
      rows.push(formatRow([
        'B2',
        'high',
        'Sale',
        sale._id,
        sale.organization,
        `Past 20% paid (${((paid / salePrice) * 100).toFixed(1)}%) but trigger never fired. ` +
          `salePrice=${salePrice}, paid=${paid}. Re-fire by editing attribution OR recording another payment.`,
      ]));
      b2++;
    }
  }
  console.log(`     → found ${b2} sales past 20% with no trigger fired`);

  // ─── Phase 3.3: triggered but no CommissionInvoice exists ───────────────────
  console.log('  • Phase 3.3 — triggered sales with no CommissionInvoice…');
  const triggeredSales = await Sale.find({
    ...orgFilter,
    'commissionInvoiceTriggered.at': { $exists: true, $ne: null },
  }).select('_id organization').lean();
  let p33 = 0;
  for (const sale of triggeredSales) {
    const exists = await CommissionInvoice.findOne({ sale: sale._id }).select('_id').lean();
    if (!exists) {
      rows.push(formatRow([
        'P3.3',
        'medium',
        'Sale',
        sale._id,
        sale.organization,
        `Trigger fired but no CommissionInvoice exists (auto-draft skipped pre-fix). ` +
          `CP can still create one manually via POST /cp/commission-invoices.`,
      ]));
      p33++;
    }
  }
  console.log(`     → found ${p33} triggered sales without invoice`);

  // ─── B14: Leads with status='Active' (outside enum) ─────────────────────────
  console.log('  • B14 — Leads with corrupted status=\'Active\'…');
  // Bypass mongoose enum validation by using collection().find directly.
  const corruptLeads = await mongoose.connection.db.collection('leads').find({
    ...(argOrg ? { organization: new mongoose.Types.ObjectId(argOrg) } : {}),
    status: 'Active',
  }).project({ _id: 1, organization: 1 }).toArray();
  for (const lead of corruptLeads) {
    rows.push(formatRow([
      'B14',
      'medium',
      'Lead',
      lead._id,
      lead.organization,
      `Lead.status='Active' is outside the enum. Likely set by an old cancelSale call. ` +
        `Patch to 'Negotiating' or another valid value.`,
    ]));
  }
  console.log(`     → found ${corruptLeads.length} leads with status='Active'`);

  // ─── Phase 4 cascade: paid invoices whose CommissionRecord payout is still pending ───
  console.log('  • Phase 4 — paid invoices whose CommissionRecord payout is still pending…');
  const paidInvoices = await CommissionInvoice.find({
    ...(argOrg ? { developerOrg: argOrg } : {}),
    status: 'paid',
    commissionRecord: { $ne: null },
  }).select('_id developerOrg commissionRecord invoiceNumber').lean();
  let p4 = 0;
  for (const inv of paidInvoices) {
    const rec = await CommissionRecord.findById(inv.commissionRecord)
      .select('_id payouts status').lean();
    if (!rec) continue;
    const hasUnpaidPayout = (rec.payouts || []).some((p) => p.status === 'pending');
    if (hasUnpaidPayout) {
      rows.push(formatRow([
        'P4',
        'high',
        'CommissionInvoice',
        inv._id,
        inv.developerOrg,
        `Invoice ${inv.invoiceNumber} is paid but CommissionRecord ${rec._id} still has ` +
          `pending payouts. Cascade fix applies retroactively only on re-payment OR via ` +
          `PUT /api/channel-partners/commission-records/${rec._id}/payouts/N/pay`,
      ]));
      p4++;
    }
  }
  console.log(`     → found ${p4} paid invoices with un-cascaded records`);

  // ─── Write the report ──────────────────────────────────────────────────────
  const date = new Date().toISOString().slice(0, 10);
  const outPath = path.join('/tmp', `lifecycle-reconciliation-report-${date}.csv`);
  fs.writeFileSync(outPath, rows.join('\n') + '\n');
  console.log(`\n📝 Report written: ${outPath}`);
  console.log(`   Total rows: ${rows.length - 1} (excluding header)`);
  console.log(`   Breakdown: B1=${b1}, B4=${zeroRecords.length}, B2=${b2}, P3.3=${p33}, B14=${corruptLeads.length}, P4=${p4}`);

  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error('❌ Reconciliation script failed:', err);
  process.exit(1);
});
