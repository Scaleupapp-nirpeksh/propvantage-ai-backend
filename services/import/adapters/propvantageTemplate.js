// File: services/import/adapters/propvantageTemplate.js
// Description: Adapter for the PropVantage data-intake template (one sheet per
//   entity: Team, Projects, Towers, Units, Leads, Interactions, Bookings, Brokers).
//   Row 1 = headers ("*" marks mandatory), row 2 = hints, row 3 = a blue example
//   row (ignored), data from row 4. Pure: workbook in, canonical out.

import { columnIndex } from '../workbook.js';
import { emptyCanonical, issueCollector, TeamRegistry, BrokerRegistry, LeadRegistry, sha } from '../canonical.js';
import * as N from '../normalize.js';

export const FORMAT = 'propvantage_template';

export function detect(wb) {
  const names = wb.sheets.map((s) => s.name.trim().toLowerCase());
  const hits = ['units', 'leads', 'bookings', 'projects', 'towers'].filter((n) => names.includes(n)).length;
  return hits >= 2 ? hits + 2 : 0;
}

function isExampleRow(sheet, r) {
  if (r !== 3) return false;
  const c = sheet.ws.getRow(3).getCell(1).font?.color?.argb;
  return typeof c === 'string' && c.toUpperCase().endsWith('0000FF');
}

function readSheet(wb, name, issue, required = []) {
  const s = wb.sheet(name); if (!s) return null;
  const headers = s.row(1).map((h) => N.text(h).replace(/\s*\*$/, ''));
  const rows = [];
  for (let r = 3; r <= s.rowCount; r += 1) {
    if (isExampleRow(s, r)) continue;
    const vals = s.row(r, headers.length);
    if (!vals.some((v) => v !== null && v !== '')) continue;
    if (String(vals[0] ?? '').startsWith('system-keys')) break;
    const get = (...n) => { const i = columnIndex(headers, ...n); return i === -1 ? null : vals[i]; };
    const missing = required.filter((h) => N.isBlank(get(h)));
    if (missing.length) { issue('error', name, r, missing.join(', '), `Mandatory value missing: ${missing.join(', ')} — row skipped`); continue; }
    rows.push({ r, get });
  }
  return { sheet: s, rows };
}

export function parse(wb, ctx = {}) {
  const out = emptyCanonical(); out.formats.push(FORMAT);
  const issue = issueCollector(out.issues);
  const team = new TeamRegistry(); const brokers = new BrokerRegistry(); const leads = new LeadRegistry();
  const leadByPhone = new Map();

  const teamS = readSheet(wb, 'Team', issue, ['First name', 'Last name', 'Email', 'Role']);
  const explicitTeam = [];
  for (const { get } of teamS?.rows || []) explicitTeam.push({ key: N.email(get('Email')) || N.slug(`${get('First name')} ${get('Last name')}`), name: `${N.text(get('First name'))} ${N.text(get('Last name'))}`.trim(), email: N.email(get('Email')), phone: N.phone(get('Mobile')), role: N.text(get('Role')), functions: [], explicit: true });

  const proj = readSheet(wb, 'Projects', issue, ['Project name', 'Type', 'Status', 'City', 'Area / locality']);
  const p0 = proj?.rows[0];
  if (proj && proj.rows.length > 1) issue('warning', 'Projects', null, 'Project name', 'Only the first project row is imported per run — upload one workbook per project');
  if (p0) {
    const g = p0.get;
    out.project = { name: ctx.projectName || N.text(g('Project name')), type: N.text(g('Type')).toLowerCase(), status: N.text(g('Status')).toLowerCase(), city: N.text(g('City')), area: N.text(g('Area / locality')), state: N.text(g('State')), pincode: N.text(g('Pincode')), reraNumber: N.text(g('RERA number')), launchDate: N.date(g('Launch date')), expectedCompletionDate: N.date(g('Expected completion')), targetRevenueDeclared: N.num(g('Target revenue')), fyTargets: [], paymentPlanTemplates: [] };
  }

  for (const { get } of readSheet(wb, 'Towers', issue, ['Tower name', 'Tower code', 'Total floors', 'Units per floor'])?.rows || []) out.towers.push({ code: N.text(get('Tower code')).toUpperCase(), name: N.text(get('Tower name')), totalFloors: N.num(get('Total floors')) || 1, unitsPerFloor: N.num(get('Units per floor')) || 1 });

  for (const { r, get } of readSheet(wb, 'Units', issue, ['Unit number', 'Configuration', 'Floor', 'Status'])?.rows || []) {
    const code = N.text(get('Tower code')).toUpperCase(); const unitNo = N.text(get('Unit number'));
    const key = unitNo.toUpperCase().startsWith(`${code}-`) || !code ? unitNo : N.unitKey(code, unitNo);
    const area = N.num(get('Super built-up', 'saleable area')) || N.num(get('Carpet area')) || 0; const cur = N.num(get('Current price')) || N.num(get('Base price')) || 0;
    const status = N.text(get('Status')).toLowerCase();
    if (!['available', 'booked', 'sold', 'blocked'].includes(status)) { issue('error', 'Units', r, 'Status', `"${N.text(get('Status'))}" is not one of available / booked / sold / blocked — row skipped`); continue; }
    out.units.push({ key, towerCode: code, unitNumber: key, floor: N.num(get('Floor')) || 0, type: N.text(get('Configuration')), typology: '', areaSqft: area, basePrice: N.num(get('Base price')) || cur, currentPrice: cur, status, facing: N.text(get('Facing')), bedrooms: N.num(get('Bedrooms')), bathrooms: N.num(get('Bathrooms')), carpetSqft: N.num(get('Carpet area')), builtUpSqft: N.num(get('Built-up area')), parkingTotal: N.num(get('Covered parking')), areaBreakdown: {}, parkingSplit: {}, pricing: {}, waitlist: [] });
  }

  for (const { get } of readSheet(wb, 'Brokers', issue, ['Firm name'])?.rows || []) brokers.add({ firmName: get('Firm name'), contactName: get('Contact name'), phone: N.phone(get('Contact mobile')), ratePct: N.percent(get('Default commission')) });

  for (const { get } of readSheet(wb, 'Leads', issue, ['First name', 'Status'])?.rows || []) {
    const full = `${N.text(get('First name'))} ${N.text(get('Last name'))}`.trim(); const ph = N.phone(get('Mobile'));
    const bk = N.text(get('Broker firm')) ? brokers.add({ firmName: get('Broker firm') }) : null;
    const who = N.email(get('Assigned to')) || null;
    const k = leads.upsert(full, { phone: ph, email: N.email(get('Email')), source: N.text(get('Source')) || 'Direct', sourceDetail: N.text(get('Source detail')), brokerKey: bk, assignedToEmail: who, status: N.text(get('Status')), createdAt: N.date(get('Enquiry date')), budgetMin: N.num(get('Budget min')), budgetMax: N.num(get('Budget max')), unitTypeWanted: N.text(get('Configuration wanted')), timeline: N.text(get('Timeline')), notes: N.text(get('Special requirements')), lostReason: N.text(get('Lost reason')), nextFollowUp: N.date(get('Next follow-up date')), followUpType: N.text(get('Next follow-up type')), profile: {} });
    if (k && ph) leadByPhone.set(ph, k);
  }

  for (const { r, get } of readSheet(wb, 'Interactions', issue, ['Lead mobile', 'Date', 'Type', 'Summary'])?.rows || []) {
    const k = leadByPhone.get(N.phone(get('Lead mobile')));
    if (!k) { issue('error', 'Interactions', r, 'Lead mobile', 'No lead with this mobile on the Leads sheet — row skipped'); continue; }
    const when = N.date(get('Date')); const content = N.text(get('Summary'));
    out.interactions.push({ key: `int:${sha([k, when?.toISOString(), get('Type'), content.slice(0, 80)].join('|'))}`, leadKey: k, occurredAt: when, type: N.text(get('Type')), direction: N.text(get('Direction')) || undefined, byEmail: N.email(get('By')), content, outcome: N.text(get('Outcome')), nextAction: N.text(get('Next action')) });
  }

  for (const { r, get } of readSheet(wb, 'Bookings', issue, ['Booking ID', 'Unit number', 'Buyer mobile', 'Booking date', 'Status', 'Agreement value'])?.rows || []) {
    const ph = N.phone(get('Buyer mobile')); let k = leadByPhone.get(ph);
    if (!k && N.text(get('Buyer name'))) { k = leads.upsert(N.text(get('Buyer name')), { phone: ph, source: 'Direct', status: 'Booked', profile: {} }); if (k) leadByPhone.set(ph, k); }
    if (!k) { issue('error', 'Bookings', r, 'Buyer mobile', 'Buyer is not on the Leads sheet and no buyer name was given — row skipped'); continue; }
    const unitKey = N.text(get('Unit number')); const bk = N.text(get('Broker firm')) ? brokers.add({ firmName: get('Broker firm'), ratePct: N.percent(get('Broker commission')) }) : null;
    const price = N.num(get('Agreement value')) || 0; const status = N.text(get('Status'));
    out.sales.push({ key: `sale:${unitKey}:${N.text(get('Booking ID'))}`, bookingRef: N.text(get('Booking ID')), unitKey, leadKey: k, status, bookingDate: N.date(get('Booking date')), salePrice: price, salesPersonEmail: N.email(get('Sales person')), brokerKey: bk, brokerRatePct: N.percent(get('Broker commission')), discountAmount: N.num(get('Discount given')), processTracker: {}, externalStatus: {}, cancellationReason: N.text(get('Cancellation reason')), cancelledAt: N.date(get('Cancellation date')),
      costSheet: { agreementValue: price, basePrice: N.num(get('Base price')), floorRise: N.num(get('Floor-rise')), plc: N.num(get('PLC')), parking: N.num(get('Parking charges')), clubMembership: N.num(get('Club membership')), otherCharges: N.num(get('Other charges')), gst: N.num(get('GST')), stampDuty: N.num(get('Stamp duty')), registration: N.num(get('Registration')) } });
    if (status !== 'Cancelled') leads.get(k).status = 'Booked';
  }

  for (const n of ['Installments', 'Receipts', 'Commissions', 'Milestones']) if (wb.sheet(n) && readSheet(wb, n, () => {})?.rows.length) out.skippedSheets.push({ file: wb.fileName, sheet: n, reason: 'Recognised, but loading this sheet is not enabled yet — it will be added with the collections import' });

  if (!out.project) out.project = { name: ctx.projectName || 'Imported project', type: 'apartment', status: 'launched', city: ctx.city || 'Mumbai', area: ctx.area || 'Mumbai', fyTargets: [], paymentPlanTemplates: [] };
  out.team = [...explicitTeam, ...team.list()]; out.brokers = brokers.list(); out.leads = leads.list().map((l) => ({ ...l, status: l.status || 'New' }));
  return out;
}
