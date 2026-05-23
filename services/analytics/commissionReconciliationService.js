// File: services/analytics/commissionReconciliationService.js
// Description: SP5 — Area 5, the headline cross-org feature. Reconciles a
//   CP's manual commission ledger (Prospect.commission, from SP4) against
//   the developer's official CommissionRecord engine.
//
//   Workflow per row:
//     1. Find every Prospect in the CP org with `pushedToLead` set.
//     2. Resolve the dev-side Sale (Sale.lead === Prospect.pushedToLead) and
//        the CommissionRecord(s) (CommissionRecord.sale === Sale._id) that
//        belong to the CP's shadow ChannelPartner record (security: via
//        partnerAccessScope — never trust the lead-id alone for cross-org
//        reads).
//     3. Classify status:
//        - matched      : both sides exist and amounts agree within ±tolerance
//        - cp_only      : CP has a ledger, no CommissionRecord exists, AND
//                          Lead status is in RECONCILIATION_TRIGGER_STATUSES
//                          (i.e. a record *should* exist by now)
//        - dev_only     : CommissionRecord exists, Prospect has no agreement
//                          or expectedAmount === 0
//        - mismatched   : both exist but amounts diverge > tolerance

import mongoose from 'mongoose';
import Prospect from '../../models/prospectModel.js';
import Lead from '../../models/leadModel.js';
import Sale from '../../models/salesModel.js';
import CommissionRecord from '../../models/commissionRecordModel.js';
import ChannelPartner from '../../models/channelPartnerModel.js';
import Partnership from '../../models/partnershipModel.js';
import { parseRange, isCpAgent, agentScopeMatch, toObjectId, safeDiv, round2, withCache } from './_shared.js';

const TOLERANCE = Number(process.env.INSIGHT_VALIDATOR_NUMERIC_TOLERANCE) || 0.01; // ±1%

// Lead statuses at which a CommissionRecord is *expected* to exist on the
// dev side. Configurable per spec §5.3 step 2; keep in sync with
// config/insightSurfaces.js RECONCILIATION_TRIGGER_STATUSES (Phase 3 ships
// the same constant there — both should match).
const TRIGGER_STATUSES = ['Booked'];

// ─── Internal helpers ──────────────────────────────────────────────────────

/**
 * Build a Prospect → { lead, sale, commissionRecords[] } lookup for an org.
 * Returns a Map keyed by Prospect._id.toString().
 */
async function buildCrossOrgIndex(cpOrgId) {
  // 1. Active partnerships → dev orgs we may legitimately read.
  const partnerships = await Partnership.find({
    channelPartnerOrg: cpOrgId,
    status: 'active',
  }).select('developerOrg').lean();
  const devOrgIds = partnerships.map((p) => p.developerOrg);
  if (devOrgIds.length === 0) return { index: new Map(), shadowMap: new Map() };

  // 2. Dev-side ChannelPartner shadow records that point back at this CP org.
  const shadows = await ChannelPartner.find({
    organization: { $in: devOrgIds },
    channelPartnerOrg: cpOrgId,
  }).select('_id organization').lean();
  const shadowIds = shadows.map((s) => s._id);
  const shadowMap = new Map(shadows.map((s) => [s._id.toString(), s]));
  if (shadowIds.length === 0) return { index: new Map(), shadowMap };

  // 3. Pushed prospects in this CP org.
  const prospects = await Prospect.find({
    organization: cpOrgId,
    pushedToLead: { $ne: null },
  }).select('_id pushedToLead').lean();
  const leadIds = prospects.map((p) => p.pushedToLead);
  if (leadIds.length === 0) return { index: new Map(), shadowMap };

  // 4. Sales joined to those Leads.
  const sales = await Sale.find({ lead: { $in: leadIds } }).select('_id lead').lean();
  const saleIds = sales.map((s) => s._id);
  const leadToSale = new Map(sales.map((s) => [s.lead.toString(), s]));

  // 5. CommissionRecords for those Sales AND our shadow records (cross-org
  //    safety: never trust the sale id alone).
  const commissionRecords = saleIds.length
    ? await CommissionRecord.find({
        sale: { $in: saleIds },
        channelPartner: { $in: shadowIds },
      }).lean()
    : [];
  const saleToRecords = new Map();
  for (const r of commissionRecords) {
    const key = r.sale.toString();
    if (!saleToRecords.has(key)) saleToRecords.set(key, []);
    saleToRecords.get(key).push(r);
  }

  // 6. Build the Prospect → { lead, sale, records[] } map.
  const index = new Map();
  for (const p of prospects) {
    const leadKey = p.pushedToLead.toString();
    const sale = leadToSale.get(leadKey) || null;
    const records = sale ? saleToRecords.get(sale._id.toString()) || [] : [];
    index.set(p._id.toString(), { lead: p.pushedToLead, sale, records });
  }
  return { index, shadowMap };
}

/**
 * Compare CP ledger vs dev record(s). Returns one of the 4 status strings
 * plus discrepancy details.
 */
function classify(prospect, crossOrg, leadStatus) {
  const cpExpected = prospect.commission?.expectedAmount || 0;
  const cpReceived = (prospect.commission?.payments || []).reduce((s, p) => s + (p.amount || 0), 0);
  const cpAgreementExists = Boolean(
    prospect.commissionAgreement?.type && prospect.commissionAgreement?.value
  );
  const records = crossOrg.records || [];
  // Aggregate across records (the same sale may have multiple per the CP's
  // sharePct split, though SP4 happy-path is 100%).
  const devExpected = records.reduce((s, r) => s + (r.grossAmount || 0), 0);
  const devPaid = records.reduce(
    (s, r) => s + (r.payouts || []).filter((p) => p.status === 'paid').reduce((q, p) => q + (p.amount || 0), 0),
    0
  );
  const hasCpLedger = cpAgreementExists || cpExpected > 0;
  const hasDevRecord = records.length > 0;

  const expectedDelta = Math.abs(cpExpected - devExpected);
  const receivedDelta = Math.abs(cpReceived - devPaid);

  let status, reason;
  if (hasCpLedger && hasDevRecord) {
    const expectedTolPass = safeDiv(expectedDelta, Math.max(devExpected, 1)) <= TOLERANCE;
    const receivedTolPass = safeDiv(receivedDelta, Math.max(devPaid, 1)) <= TOLERANCE;
    if (expectedTolPass && receivedTolPass) {
      status = 'matched';
      reason = 'CP ledger and developer commission record agree within tolerance.';
    } else {
      status = 'mismatched';
      reason = `Amounts diverge — CP expects ₹${round2(cpExpected)}/received ₹${round2(cpReceived)}, ` +
               `developer record shows ₹${round2(devExpected)}/paid ₹${round2(devPaid)}.`;
    }
  } else if (hasCpLedger && !hasDevRecord) {
    // Only flag cp_only when the lead status indicates a record *should* exist.
    if (TRIGGER_STATUSES.includes(leadStatus)) {
      status = 'cp_only';
      reason = `CP tracks a commission for this prospect, but no developer-side CommissionRecord exists at lead status '${leadStatus}'.`;
    } else {
      status = 'pending_trigger';
      reason = `Lead is at status '${leadStatus}'; developer commission expected to be recorded at status '${TRIGGER_STATUSES[0]}'.`;
    }
  } else if (!hasCpLedger && hasDevRecord) {
    status = 'dev_only';
    reason = 'Developer has recorded a commission, but the CP has no agreement on file.';
  } else {
    status = 'no_record';
    reason = 'Neither side has commission data for this prospect.';
  }
  return {
    status,
    reason,
    cpExpected: round2(cpExpected),
    cpReceived: round2(cpReceived),
    devExpected: round2(devExpected),
    devPaid: round2(devPaid),
    expectedDelta: round2(expectedDelta),
    receivedDelta: round2(receivedDelta),
  };
}

// ─── Public surface ────────────────────────────────────────────────────────

/**
 * Reconciliation overview for the dashboard.
 *
 * @returns {Promise<{summary, rows, generatedAt, range}>}
 */
export async function getReconciliationOverview(orgId, params, user) {
  const { range } = parseRange(params?.range);
  const cacheKey = `reconciliation:${orgId}:${range}:${isCpAgent(user) ? user._id : 'org'}`;

  return withCache(cacheKey, async () => {
    const cpOrgId = toObjectId(orgId);
    const agentFilter = agentScopeMatch(user);
    const prospectFilter = {
      organization: cpOrgId,
      pushedToLead: { $ne: null },
      ...agentFilter,
    };

    const prospects = await Prospect.find(prospectFilter)
      .select('_id firstName lastName phone commission commissionAgreement pushedToLead reconciliationReviewedAt reconciliationReviewedBy developerContext')
      .lean();
    if (prospects.length === 0) {
      return {
        summary: { matched: 0, cpOnly: 0, devOnly: 0, mismatched: 0, pendingTrigger: 0, totalDiscrepancy: 0 },
        rows: [],
        generatedAt: new Date().toISOString(),
        range,
      };
    }

    const { index } = await buildCrossOrgIndex(cpOrgId);

    // Fetch lead statuses in one shot.
    const leadIds = prospects.map((p) => p.pushedToLead);
    const leads = await Lead.find({ _id: { $in: leadIds } }).select('_id status').lean();
    const leadStatusMap = new Map(leads.map((l) => [l._id.toString(), l.status]));

    const rows = prospects.map((p) => {
      const crossOrg = index.get(p._id.toString()) || { records: [] };
      const leadStatus = leadStatusMap.get(p.pushedToLead.toString()) || 'unknown';
      const cls = classify(p, crossOrg, leadStatus);
      return {
        prospectId: p._id,
        prospectName: `${p.firstName} ${p.lastName || ''}`.trim(),
        phone: p.phone,
        leadId: p.pushedToLead,
        leadStatus,
        ...cls,
        reviewedAt: p.reconciliationReviewedAt,
        reviewedBy: p.reconciliationReviewedBy,
      };
    });

    const counts = { matched: 0, cpOnly: 0, devOnly: 0, mismatched: 0, pendingTrigger: 0, noRecord: 0 };
    let totalDiscrepancy = 0;
    for (const r of rows) {
      if (r.status === 'matched') counts.matched++;
      else if (r.status === 'cp_only') counts.cpOnly++;
      else if (r.status === 'dev_only') counts.devOnly++;
      else if (r.status === 'mismatched') {
        counts.mismatched++;
        totalDiscrepancy += Math.max(r.expectedDelta, r.receivedDelta);
      } else if (r.status === 'pending_trigger') counts.pendingTrigger++;
      else if (r.status === 'no_record') counts.noRecord++;
    }

    return {
      summary: { ...counts, totalDiscrepancy: round2(totalDiscrepancy) },
      rows,
      generatedAt: new Date().toISOString(),
      range,
    };
  });
}

/**
 * Drill-through detail for a single prospect.
 *
 * @returns {Promise<{prospect, cpLedger, devRecords, status, discrepancy, explanation, citations}>}
 */
export async function getReconciliationDetail(orgId, prospectId, user) {
  const cpOrgId = toObjectId(orgId);
  const pid = toObjectId(prospectId);
  const agentFilter = agentScopeMatch(user);

  const prospect = await Prospect.findOne({ _id: pid, organization: cpOrgId, ...agentFilter }).lean();
  if (!prospect) {
    const err = new Error('Prospect not found');
    err.statusCode = 404;
    throw err;
  }
  if (!prospect.pushedToLead) {
    const err = new Error('Prospect has not been pushed to a developer');
    err.statusCode = 400;
    throw err;
  }

  const { index } = await buildCrossOrgIndex(cpOrgId);
  const crossOrg = index.get(prospect._id.toString()) || { records: [] };
  const lead = await Lead.findById(prospect.pushedToLead).select('_id status').lean();
  const cls = classify(prospect, crossOrg, lead?.status || 'unknown');

  return {
    prospect: {
      _id: prospect._id,
      name: `${prospect.firstName} ${prospect.lastName || ''}`.trim(),
      phone: prospect.phone,
      email: prospect.email,
    },
    cpLedger: {
      agreement: prospect.commissionAgreement,
      expectedAmount: prospect.commission?.expectedAmount || 0,
      receivedAmount: (prospect.commission?.payments || []).reduce((s, p) => s + (p.amount || 0), 0),
      status: prospect.commission?.status,
      payments: prospect.commission?.payments || [],
    },
    devRecords: crossOrg.records,
    lead: { _id: lead?._id, status: lead?.status },
    status: cls.status,
    discrepancy: { expectedDelta: cls.expectedDelta, receivedDelta: cls.receivedDelta },
    explanation: cls.reason,
    citations: [
      { label: 'CP prospect',    url: `/partner/prospects/${prospect._id}` },
      { label: 'Developer lead', url: `/leads/${prospect.pushedToLead}` },
    ],
    reviewedAt: prospect.reconciliationReviewedAt,
    reviewedBy: prospect.reconciliationReviewedBy,
  };
}

/**
 * Mark a reconciliation row as reviewed. Idempotent.
 *
 * @returns {Promise<{prospectId, reviewedAt, reviewedBy}>}
 */
export async function markReviewed(orgId, prospectId, user) {
  const cpOrgId = toObjectId(orgId);
  const pid = toObjectId(prospectId);
  const agentFilter = agentScopeMatch(user);

  const updated = await Prospect.findOneAndUpdate(
    { _id: pid, organization: cpOrgId, ...agentFilter },
    {
      $set: {
        reconciliationReviewedAt: new Date(),
        reconciliationReviewedBy: user._id,
      },
    },
    { new: true }
  ).select('_id reconciliationReviewedAt reconciliationReviewedBy').lean();

  if (!updated) {
    const err = new Error('Prospect not found');
    err.statusCode = 404;
    throw err;
  }
  return {
    prospectId: updated._id,
    reviewedAt: updated.reconciliationReviewedAt,
    reviewedBy: updated.reconciliationReviewedBy,
  };
}

export default { getReconciliationOverview, getReconciliationDetail, markReviewed };
