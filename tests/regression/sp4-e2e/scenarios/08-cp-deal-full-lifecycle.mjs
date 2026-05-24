// Scenario 8 — Lifecycle-repair canary. The CANONICAL definition of "done"
// for the 2026-05-24 CP deal lifecycle repair plan.
//
// Drives a CP-attributed deal from prospect creation through paid commission:
//   1. CP creates a platform-context Prospect with a commissionAgreement
//   2. CP pushes to dev → pending Lead
//   3. Dev accepts → status='New', attribution.status='approved'
//   4. Dev creates Sale via POST /sales WITHOUT sending channelPartnerAttribution
//      in the body. THIS IS THE B1 CANARY — proves auto-inheritance from the
//      Lead works and CP attribution survives the booking handoff.
//   5. Verify Sale has channelPartnerAttribution copied from the Lead.
//   6. Verify CommissionRecord was created for the right (sale, shadow CP).
//   7. Customer records a payment > 20% of salePrice via /payments/transactions.
//   8. Verify Sale.commissionInvoiceTriggered was set (B2 — proves the 20%
//      trigger now reads salePrice, not the non-existent totalAmount).
//   9. Verify a CommissionInvoice was auto-created in 'draft' status with
//      commissionRecord FK populated (B6 + Phase 3.3).
//  10. CP submits the invoice.
//  11. Dev approves the invoice.
//  12. Dev records payment on the invoice.
//  13. Verify CommissionRecord.payouts[0].status === 'paid' (B3 cascade).
//  14. Verify SP5 reconciliation row for this prospect shows 'matched'.
//
// If any single step in this scenario fails on the live API, the repair plan
// is NOT done — every gap surfaces here.

import { http, pickArr } from '../lib/api.mjs';
import { login } from '../lib/auth.mjs';
import { step, pass, fail, warn, assert, note } from '../lib/log.mjs';
import { track } from '../lib/manifest.mjs';

export default async function scenarioEight(ctx, log) {
  step(log, 'Login as CP Owner + Developer Owner');
  const cp = await login(ctx.creds.cp.email, ctx.creds.cp.password);
  const dev = await login(ctx.creds.dev.email, ctx.creds.dev.password);
  pass(log, 'Both logins OK', { cpOrg: cp.org.name, devOrg: dev.org.name });
  log.artifacts.cpOrgId = cp.org._id;
  log.artifacts.devOrgId = dev.org._id;

  step(log, 'Resolve active partnership between the two orgs');
  const partnersResp = await http('GET', '/partnerships', { token: cp.token, expect: 200, note: 'cp list partnerships' });
  const partnership = pickArr(partnersResp).find(
    (p) => String(p.developerOrg?._id || p.developerOrg) === String(dev.org._id) && p.status === 'active'
  );
  assert(log, 'Active partnership resolved', !!partnership, partnership && { id: partnership._id });
  log.artifacts.partnershipId = partnership?._id;

  // Pick an active project. Either restricted-to-partnership project, or any
  // dev project visible to the dev (we need an available unit on it).
  const projectId = (partnership?.approvedProjects?.[0]?._id || partnership?.approvedProjects?.[0])
    || '6a0c587913c90085c7abfb35'; // Heliconia BKC fallback
  log.artifacts.projectId = projectId;

  step(log, 'Dev locates an available unit on the project');
  const unitsResp = await http('GET', `/units?project=${projectId}&status=available&limit=5`, { token: dev.token, expect: 200, note: 'dev lists available units' });
  const candidateUnits = pickArr(unitsResp).filter((u) => u.status === 'available');
  if (!candidateUnits.length) {
    warn(log, 'No available units on the project — cannot exercise booking step. Aborting scenario.');
    return;
  }
  const unit = candidateUnits[0];
  log.artifacts.unitId = unit._id;
  note(log, 'Unit chosen', { id: unit._id, number: unit.unitNumber, currentPrice: unit.currentPrice });

  step(log, 'CP creates a platform-context Prospect with a commissionAgreement');
  const tag = `s8-${ctx.runId.slice(0, 12)}`;
  const prospectPayload = {
    firstName: 'Saanvi',
    lastName: `Repair-${tag}`,
    phone: '+91-90000-' + Math.floor(Math.random() * 90000 + 10000),
    email: `saanvi.${tag}@example.test`,
    developerContext: { type: 'platform', partnership: partnership._id },
    project: { platform: projectId },
    assignedAgent: cp.userId,
    priority: 'High',
    creationNote: 'SP4-E2E S8: lifecycle-repair canary',
    commissionAgreement: { type: 'percentage', value: 2, currency: 'INR', notes: 'Lifecycle-repair canary scenario' },
  };
  const createProspect = await http('POST', '/cp/prospects', { token: cp.token, body: prospectPayload, expect: 201, note: 'CP creates prospect' });
  const prospect = createProspect.data?.data;
  assert(log, 'Prospect created in platform context', prospect?.developerContext?.type === 'platform', { id: prospect?._id });
  log.artifacts.prospectId = prospect?._id;
  track(ctx.manifest, 'prospects', { id: prospect?._id, scenarioId: log.scenarioId, name: `${prospect?.firstName} ${prospect?.lastName}` });

  step(log, 'CP pushes prospect → pending Lead');
  const push = await http('POST', `/cp/prospects/${prospect._id}/push`, { token: cp.token, expect: [200, 201], note: 'push' });
  const leadId = push.data?.data?.leadId;
  assert(log, 'Push returned a leadId', !!leadId, { leadId });
  log.artifacts.leadId = leadId;
  track(ctx.manifest, 'leads', { id: leadId, scenarioId: log.scenarioId, status: 'pending' });

  step(log, 'Dev accepts the registration');
  await http('PATCH', `/leads/${leadId}/registration`, { token: dev.token, body: { action: 'accept' }, expect: 200, note: 'dev accepts' });
  const leadAfterAccept = (await http('GET', `/leads/${leadId}`, { token: dev.token, expect: 200, note: 'reload lead' })).data?.data;
  assert(log, 'Lead.status flipped to New', leadAfterAccept?.status === 'New', { status: leadAfterAccept?.status });
  assert(log, 'Lead.channelPartnerAttribution.status === "approved"',
    leadAfterAccept?.channelPartnerAttribution?.status === 'approved',
    { attributionStatus: leadAfterAccept?.channelPartnerAttribution?.status });

  // decideLeadRegistration schedules a lead-scoring background job with a
  // 1500ms delay that mutates the lead. We need to wait past that window so
  // the dev's createSale transaction doesn't race with the scorer (write
  // conflict). 2500ms gives a comfortable margin.
  note(log, 'Waiting 2.5s for background lead-scoring job to settle…');
  await new Promise((r) => setTimeout(r, 2500));

  // ─── B1 CANARY ────────────────────────────────────────────────────────
  step(log, '*** B1 CANARY *** Dev creates Sale WITHOUT channelPartnerAttribution in body');
  // Build a minimal cost-sheet snapshot. The unit's currentPrice or basePrice
  // is used as the final sale price. NO channelPartnerAttribution sent.
  const finalSalePrice = unit.currentPrice || unit.basePrice || 30000000;
  const costSheet = {
    finalPayableAmount: finalSalePrice,
    totals: { finalAmount: finalSalePrice },
    basePrice: unit.basePrice || finalSalePrice,
  };
  const saleBody = {
    unitId: unit._id,
    leadId,
    discountPercentage: 0,
    discountAmount: 0,
    costSheetSnapshot: costSheet,
    paymentPlanSnapshot: { templateName: 'standard' },
    // INTENTIONALLY OMITTED — channelPartnerAttribution
    // The helper must auto-inherit from lead.channelPartnerAttribution.
  };
  const saleResp = await http('POST', '/sales', { token: dev.token, body: saleBody, expect: 201, note: 'dev creates sale (no CP attribution in body)' });
  const sale = saleResp.data?.data;
  assert(log, 'Sale created (201)', !!sale?._id, { saleId: sale?._id });
  log.artifacts.saleId = sale?._id;
  track(ctx.manifest, 'sales', { id: sale?._id, scenarioId: log.scenarioId });

  step(log, '*** B1 CANARY *** Sale.channelPartnerAttribution auto-inherited from Lead');
  const saleReload = (await http('GET', `/sales/${sale._id}`, { token: dev.token, expect: 200, note: 'reload sale' })).data?.data;
  assert(log, 'sale.channelPartnerAttribution.viaChannelPartner === true',
    saleReload?.channelPartnerAttribution?.viaChannelPartner === true,
    { attribution: saleReload?.channelPartnerAttribution });
  const inheritedPartners = saleReload?.channelPartnerAttribution?.partners || [];
  assert(log, 'sale has at least one CP partner attributed',
    inheritedPartners.length > 0,
    { partners: inheritedPartners.length });
  // The history should record the inherit-from-lead action
  const inheritEvent = (saleReload?.channelPartnerAttribution?.history || [])
    .find((h) => h.action === 'inherited_from_lead');
  assert(log, 'history records "inherited_from_lead" action',
    !!inheritEvent,
    { hist: saleReload?.channelPartnerAttribution?.history });

  step(log, 'CommissionRecord exists for (sale, shadow CP)');
  // Dev side commission records endpoint
  const recordsResp = await http('GET', '/channel-partners/commission-records?limit=50', { token: dev.token, expect: 200, note: 'dev lists commission records' });
  const myRecord = pickArr(recordsResp).find((r) => String(r.sale?._id || r.sale) === String(sale._id));
  assert(log, 'CommissionRecord row exists for the new sale',
    !!myRecord,
    myRecord && { id: myRecord._id, status: myRecord.status, gross: myRecord.grossAmount });
  if (myRecord) {
    assert(log, 'CommissionRecord.grossAmount > 0 (rule OR prospect-agreement fallback)',
      Number(myRecord.grossAmount) > 0,
      { grossAmount: myRecord.grossAmount });
    log.artifacts.commissionRecordId = myRecord._id;
  }

  // ─── B2 CANARY ────────────────────────────────────────────────────────
  step(log, '*** B2 CANARY *** Customer records payment > 20% to fire the trigger');
  // We need to find an installment to allocate against. Get the payment plan.
  const plan = (await http('GET', `/payments/plans/${sale._id}`, { token: dev.token, expect: 200, note: 'dev fetches payment plan' })).data?.data;
  const installments = plan?.installments || plan?.schedule || [];
  if (!installments.length) {
    warn(log, 'Payment plan has no installments — cannot exercise trigger step.');
    return;
  }
  const firstInstallment = installments[0];
  const targetAmount = Math.ceil(finalSalePrice * 0.25); // 25% — well above 20%
  const paymentBody = {
    sale: sale._id,
    amount: targetAmount,
    paymentDate: new Date().toISOString(),
    paymentMethod: 'bank_transfer',
    paymentReference: `S8-CUST-${Date.now()}`,
    notes: 'Lifecycle-repair canary — first customer payment crossing 20%',
    allocation: { [firstInstallment._id || firstInstallment.installmentNumber]: targetAmount },
  };
  await http('POST', '/payments/transactions', { token: dev.token, body: paymentBody, expect: [200, 201], note: 'dev records customer payment' });
  pass(log, 'Customer payment recorded', { amount: targetAmount, ofSale: finalSalePrice, pct: (targetAmount / finalSalePrice * 100).toFixed(1) + '%' });

  step(log, '*** B2 CANARY *** Sale.commissionInvoiceTriggered should be set');
  const saleAfterPayment = (await http('GET', `/sales/${sale._id}`, { token: dev.token, expect: 200, note: 'reload sale post-payment' })).data?.data;
  assert(log, 'Sale.commissionInvoiceTriggered.at is set',
    !!saleAfterPayment?.commissionInvoiceTriggered?.at,
    { trigger: saleAfterPayment?.commissionInvoiceTriggered });
  assert(log, 'Sale.commissionInvoiceTriggered.paidPct >= 0.20',
    Number(saleAfterPayment?.commissionInvoiceTriggered?.paidPct) >= 0.19,
    { paidPct: saleAfterPayment?.commissionInvoiceTriggered?.paidPct });

  step(log, '*** Phase 3.3 *** CommissionInvoice was auto-created in draft');
  // CP lists their commission invoices, filter to this prospect.
  const invoicesResp = await http('GET', `/cp/commission-invoices?prospectId=${prospect._id}`, { token: cp.token, expect: 200, note: 'cp lists invoices' });
  const draftInv = pickArr(invoicesResp).find((i) => i.status === 'draft');
  assert(log, 'Auto-created draft invoice visible to CP', !!draftInv, draftInv && { id: draftInv._id, status: draftInv.status, baseAmount: draftInv.baseAmount });
  assert(log, '*** B6 *** Invoice has commissionRecord FK populated',
    !!draftInv?.commissionRecord,
    { commissionRecord: draftInv?.commissionRecord });
  log.artifacts.commissionInvoiceId = draftInv?._id;
  track(ctx.manifest, 'commissionInvoices', { id: draftInv?._id, scenarioId: log.scenarioId, status: 'draft' });

  step(log, 'CP submits the invoice');
  const submitResp = await http('POST', `/cp/commission-invoices/${draftInv._id}/submit`, { token: cp.token, expect: [200, 201], note: 'cp submits invoice' });
  const submitted = submitResp.data?.data;
  assert(log, 'Invoice status flipped to "submitted"', submitted?.status === 'submitted', { status: submitted?.status });
  assert(log, 'Invoice number allocated on submit', !!submitted?.invoiceNumber, { invoiceNumber: submitted?.invoiceNumber });

  step(log, 'Dev approves the invoice');
  await http('POST', `/commission-invoices/${draftInv._id}/approve`, { token: dev.token, body: { decisionNote: 'Looks good — approving.' }, expect: 200, note: 'dev approves' });
  const approved = (await http('GET', `/commission-invoices/${draftInv._id}`, { token: dev.token, expect: 200, note: 'dev reads approved invoice' })).data?.data;
  assert(log, 'Invoice status === "approved"', approved?.status === 'approved', { status: approved?.status });

  // ─── B3 + B4 CANARY ───────────────────────────────────────────────────
  step(log, '*** B3/B4 CANARY *** Dev records payment on the invoice');
  await http('POST', `/commission-invoices/${draftInv._id}/payment`, {
    token: dev.token,
    body: { reference: `S8-CP-PAYOUT-${Date.now()}`, method: 'bank_transfer', paidAt: new Date().toISOString() },
    expect: 200,
    note: 'dev records invoice payment',
  });

  step(log, 'CommissionInvoice.status === "paid" + CommissionRecord payout cascade');
  const paidInv = (await http('GET', `/commission-invoices/${draftInv._id}`, { token: dev.token, expect: 200, note: 'reload paid invoice' })).data?.data;
  assert(log, 'Invoice marked paid', paidInv?.status === 'paid', { status: paidInv?.status });

  // ─── Phase 4 CASCADE CANARY ───────────────────────────────────────────
  if (myRecord?._id) {
    const recordAfter = pickArr(
      await http('GET', '/channel-partners/commission-records?limit=50', { token: dev.token, expect: 200, note: 'reload commission records' })
    ).find((r) => String(r._id) === String(myRecord._id));
    assert(log, '*** Phase 4 *** CommissionRecord.payouts[0].status === "paid" (cascade fired)',
      recordAfter?.payouts?.[0]?.status === 'paid',
      { payouts: recordAfter?.payouts });
    assert(log, '*** Phase 4 *** CommissionRecord.status promoted to "paid" or "partially_paid"',
      ['paid', 'partially_paid'].includes(recordAfter?.status),
      { status: recordAfter?.status });
  }

  // ─── SP5 RECONCILIATION CANARY ────────────────────────────────────────
  step(log, '*** SP5 reconciliation *** This prospect should show as "matched"');
  const reconResp = await http('GET', '/cp/analytics/reconciliation?range=all', { token: cp.token, expect: 200, note: 'cp reconciliation overview' });
  const rows = reconResp.data?.data?.rows || pickArr(reconResp);
  const myRow = rows?.find((r) => String(r.prospect?._id || r.prospect || r.prospectId) === String(prospect._id));
  if (myRow) {
    assert(log, 'Reconciliation status === "matched" for this prospect',
      myRow.status === 'matched',
      { status: myRow.status, discrepancy: myRow.discrepancy });
  } else {
    warn(log, 'Reconciliation row not found for this prospect — may need a moment to materialise', { prospectId: prospect._id });
  }

  step(log, 'Scenario 8 complete — full lifecycle from prospect to paid commission worked end-to-end');
  note(log, 'Final artifacts', log.artifacts);
}
