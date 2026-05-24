// File: services/commissionInvoiceTriggerService.js
// Description: SP5+ — fires the `commission_invoice_ready` notification
//   when a customer's cumulative paid amount on a Sale crosses the
//   developer org's invoicePolicy.commissionInvoiceTriggerPct threshold
//   (default 0.20).
//
//   Idempotency:
//     • Sets Sale.commissionInvoiceTriggered = { at, paidPct } the first
//       time the threshold is crossed for a (Sale, ChannelPartner) pair.
//     • Subsequent payments do NOT re-fire the notification.
//     • Configurable via Organization.invoicePolicy.commissionInvoiceTriggerPct.
//
//   Called from services/paymentService.js after every successful
//   processPayment. Errors are caught and logged; they never bubble up
//   to fail the actual payment processing.

import mongoose from 'mongoose';
import PaymentPlan from '../models/paymentPlanModel.js';
import Sale from '../models/salesModel.js';
import Installment from '../models/installmentModel.js';
import Lead from '../models/leadModel.js';
import Organization from '../models/organizationModel.js';
import ChannelPartner from '../models/channelPartnerModel.js';
import Partnership from '../models/partnershipModel.js';
import Prospect from '../models/prospectModel.js';
import { createNotification, notifyUsersWithPermission } from './notificationService.js';
import { autoCreateDraftForSale } from './commissionInvoiceService.js';

const DEFAULT_TRIGGER_PCT = 0.20;

/**
 * Compute cumulative paid amount for a Sale from its installments.
 * Returns 0 if no installments / paidAmount fields.
 */
async function cumulativePaidForSale(saleId) {
  const agg = await Installment.aggregate([
    { $match: { sale: new mongoose.Types.ObjectId(String(saleId)) } },
    { $group: { _id: null, paid: { $sum: { $ifNull: ['$paidAmount', 0] } } } },
  ]);
  return agg[0]?.paid || 0;
}

/**
 * Main entry. Called from paymentService.processPayment after the plan
 * has been recalculated. paymentPlanId is what we already have at the
 * call site — we resolve the rest from it.
 *
 * @param {string|ObjectId} paymentPlanId
 * @param {string|ObjectId} actorUserId — recorded as the notification actor
 */
export async function checkAndFireTrigger(paymentPlanId, actorUserId = null) {
  try {
    if (!paymentPlanId) return;

    const plan = await PaymentPlan.findById(paymentPlanId).select('sale').lean();
    if (!plan?.sale) return;

    const sale = await Sale.findById(plan.sale)
      .select('_id organization lead salePrice commissionInvoiceTriggered')
      .lean();
    if (!sale) return;

    // Already triggered → don't re-fire.
    if (sale.commissionInvoiceTriggered?.at) return;

    // Sale's authoritative price field is `salePrice` (per models/salesModel.js).
    // Earlier code read `totalAmount`/`finalAmount` which don't exist on the
    // schema; that silent-zero made the trigger never fire. Fixed 2026-05-24.
    const total = Number(sale.salePrice ?? 0);
    if (total <= 0) return;

    const paid = await cumulativePaidForSale(sale._id);
    const paidPct = paid / total;

    // Pull the developer org's policy.
    const devOrg = await Organization.findById(sale.organization)
      .select('invoicePolicy type')
      .lean();
    if (!devOrg || devOrg.type !== 'builder') return;
    const triggerPct = Number(devOrg.invoicePolicy?.commissionInvoiceTriggerPct ?? DEFAULT_TRIGGER_PCT);
    if (paidPct < triggerPct) return;

    // Resolve the Lead → CP attribution. If the lead isn't CP-attributed
    // (direct dev sale, no channel partner), nothing to fire.
    const lead = await Lead.findById(sale.lead)
      .select('_id channelPartnerAttribution sourceProspect organization')
      .lean();
    if (!lead) return;
    const cpAttribution = lead.channelPartnerAttribution;
    const cpShadowId = cpAttribution?.partners?.[0]?.channelPartner;
    const agentUserId = cpAttribution?.partners?.[0]?.agentUser;
    if (!cpShadowId) return; // direct sale, no CP

    // Resolve cpShadow → cpOrg (the channel-partner organisation).
    const cpShadow = await ChannelPartner.findById(cpShadowId)
      .select('channelPartnerOrg organization firmName')
      .lean();
    if (!cpShadow?.channelPartnerOrg) {
      // Legacy CP record with no platform org link — no one to notify.
      return;
    }

    // Atomically mark Sale.commissionInvoiceTriggered so concurrent payment
    // hooks don't both fire. Use findOneAndUpdate to make it race-safe.
    const updated = await Sale.findOneAndUpdate(
      { _id: sale._id, 'commissionInvoiceTriggered.at': { $exists: false } },
      {
        $set: {
          commissionInvoiceTriggered: {
            at: new Date(),
            paidPct: Math.round(paidPct * 1000) / 1000,
            cpOrg: cpShadow.channelPartnerOrg,
          },
        },
      },
      { new: true }
    ).select('commissionInvoiceTriggered').lean();
    if (!updated || !updated.commissionInvoiceTriggered) return; // lost race

    const cpOrgId = cpShadow.channelPartnerOrg;

    // 2026-05-24 lifecycle-repair (Phase 3.3): auto-create the draft
    // CommissionInvoice for the CP. Previously the trigger only fired a
    // notification asking the CP to manually create the draft — but the
    // user's expectation (per the original product brief) is that the
    // invoice is auto-generated at 20%. The CP can then edit + submit.
    //
    // Best-effort: a failure here doesn't block the notification.
    let autoDraftInvoiceId = null;
    try {
      const result = await autoCreateDraftForSale({
        saleId: sale._id,
        cpOrgId,
      });
      autoDraftInvoiceId = result?.invoice?._id || null;
      if (result?.created) {
        console.log(
          `[commissionInvoiceTrigger] auto-draft created invoice=${autoDraftInvoiceId} for sale=${sale._id} cpOrg=${cpOrgId}`
        );
      } else if (result?.invoice?._id) {
        console.log(
          `[commissionInvoiceTrigger] open invoice already exists ${autoDraftInvoiceId} for sale=${sale._id} cpOrg=${cpOrgId}`
        );
      }
    } catch (draftErr) {
      console.warn('[commissionInvoiceTrigger] auto-draft failed (non-fatal):', draftErr.message);
    }

    // Notify the CP side: agent (direct) + CP leadership (broadcast minus agent).
    const baseCpProps = {
      organization: cpOrgId,
      type: 'commission_invoice_ready',
      title: autoDraftInvoiceId
        ? 'Your commission invoice draft is ready'
        : 'You can now generate your commission invoice',
      message: autoDraftInvoiceId
        ? `Your customer's payments on the booking with ${cpShadow.firmName || 'the developer'} ` +
          `have crossed ${Math.round(triggerPct * 100)}%. A draft invoice has been auto-created — review and submit when ready.`
        : `Your customer's payments on the booking with ${cpShadow.firmName || 'the developer'} ` +
          `have crossed ${Math.round(triggerPct * 100)}%. You can now generate a commission invoice.`,
      actionUrl: '/partner/prospects',
      relatedEntity: autoDraftInvoiceId
        ? { type: 'CommissionInvoice', id: autoDraftInvoiceId }
        : { type: 'Sale', id: sale._id },
      priority: 'high',
      actor: actorUserId || undefined,
    };
    if (agentUserId) {
      await createNotification({ ...baseCpProps, recipient: agentUserId });
    }
    await notifyUsersWithPermission({
      organizationId: cpOrgId,
      permission: 'cp_commission_invoices:manage',
      excludeUserIds: agentUserId ? [agentUserId] : [],
      ...baseCpProps,
    });

    // Notify the developer side (heads-up, lower priority).
    // `commission_invoice_due` was added to the notification enum on
    // 2026-05-24 (Phase 1); the previous try/catch was a workaround for the
    // missing enum value. Generic try/catch retained as a safety net only.
    try {
      await notifyUsersWithPermission({
        organizationId: sale.organization,
        permission: 'commission_invoices:approve',
        type: 'commission_invoice_due',
        title: 'Commission invoice incoming',
        message: `Payments on a CP-attributed sale have crossed ${Math.round(triggerPct * 100)}%; ` +
                 (autoDraftInvoiceId
                   ? `a draft invoice has been auto-created on the CP side.`
                   : `expect a commission invoice from the channel partner shortly.`),
        actionUrl: `/leads/${lead._id}`,
        relatedEntity: autoDraftInvoiceId
          ? { type: 'CommissionInvoice', id: autoDraftInvoiceId }
          : { type: 'Sale', id: sale._id },
        priority: 'low',
        actor: actorUserId || undefined,
      });
    } catch (notifyErr) {
      console.warn('[commissionInvoiceTrigger] dev-side commission_invoice_due notify failed (non-fatal):', notifyErr.message);
    }

    console.log(
      `[commissionInvoiceTrigger] fired for sale=${sale._id} cpOrg=${cpOrgId} paidPct=${(paidPct * 100).toFixed(1)}%`
    );
  } catch (err) {
    // Non-fatal — never block the payment flow on a notification bug.
    console.warn('[commissionInvoiceTrigger] failed (non-fatal):', err.message);
  }
}

export default { checkAndFireTrigger };
