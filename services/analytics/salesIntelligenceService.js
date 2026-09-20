// File: services/analytics/salesIntelligenceService.js
// Description: "Sales Intelligence" — what the organisation's own sales register, stacking
//   sheets and meeting log say when read together: inventory and absorption, booking velocity
//   against the year's target, rate (psf) movement, apartments on hold and how long, where the
//   booking desk is stuck, where sales and audit records disagree, which sources and partners
//   convert, and how the team is doing. Computed live, so every new import shows up here.
//   Aggregates only — no client names or contact details leave this service.

import mongoose from 'mongoose';
import Project from '../../models/projectModel.js';
import Tower from '../../models/towerModel.js';
import Unit from '../../models/unitModel.js';
import Sale, { ACTIVE_SALE_STATUSES } from '../../models/salesModel.js';
import Lead from '../../models/leadModel.js';
import Interaction from '../../models/interactionModel.js';
import ChannelPartner from '../../models/channelPartnerModel.js';
import User from '../../models/userModel.js';

const DAY = 86400000;
const CR = 1e7;
const round = (n, d = 0) => { const f = 10 ** d; return Math.round((n || 0) * f) / f; };
const pct = (a, b) => (b > 0 ? round((a / b) * 100, 1) : 0);
const median = (arr) => { const a = arr.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };

/** Indian financial year of a date: Apr 2025 – Mar 2026 → "FY2026". */
export const fyOf = (d) => { const x = new Date(d); const y = x.getUTCFullYear(); return `FY${x.getUTCMonth() >= 3 ? y + 1 : y}`; };
const fyBounds = (fy) => { const y = Number(String(fy).replace(/\D/g, '')); return { start: new Date(Date.UTC(y - 1, 3, 1)), end: new Date(Date.UTC(y, 3, 1)) }; };

const TRACKER_STEPS = [
  ['costSheet', 'Cost sheet'], ['bookingForm', 'Booking form'], ['kyc', 'KYC'], ['token', 'Token'], ['gstOnToken', 'GST on token'], ['bookingAmount', 'Booking amount'],
  ['gstOnBookingAmount', 'GST on booking amount'], ['reversePayment', 'Reverse payment'], ['registration', 'Registration'], ['erpUpload', 'ERP upload'],
];
const isYes = (v) => /^y/i.test(v || ''); const isNo = (v) => /^n(?!\/?a)/i.test(v || '');

export async function getSalesIntelligence({ organizationId, projectIds = null, projectId = null }) {
  const org = new mongoose.Types.ObjectId(String(organizationId));
  const scope = { organization: org };
  if (projectId) scope.project = new mongoose.Types.ObjectId(String(projectId));
  else if (projectIds) scope.project = { $in: projectIds.map((p) => new mongoose.Types.ObjectId(String(p))) };
  const now = Date.now();

  const [projects, towers, units, sales, leadAgg, leadBands, meetingAgg, partners, users] = await Promise.all([
    Project.find({ organization: org, ...(scope.project ? { _id: scope.project } : {}) }).select('name fyTargets targetRevenue').lean(),
    Tower.find(scope).select('towerName towerCode').lean(),
    Unit.find(scope).select('tower status type typology isRefuge floor areaSqft currentPrice pricing.estimated pricing.agreementPsf hold.type hold.since hold.tokenAmount hold.agreedValue unitNumber').lean(),
    Sale.find({ ...scope, status: { $in: ACTIVE_SALE_STATUSES } }).select('unit lead salesPerson salePrice bookingDate status agreementValuePsf sourceType processTracker externalStatus channelPartnerAttribution.partners.channelPartner closingManagerName commission.rate').lean(),
    Lead.aggregate([{ $match: scope }, { $group: { _id: { status: '$status', source: '$source' }, n: { $sum: 1 } } }]),
    Lead.aggregate([{ $match: { ...scope, status: { $nin: ['Booked', 'Lost'] } } }, { $bucket: { groupBy: '$score', boundaries: [0, 40, 55, 70, 101], default: 'unscored', output: { n: { $sum: 1 } } } }]),
    Interaction.aggregate([{ $match: { organization: org } }, { $group: { _id: { lead: '$lead', user: '$user' }, n: { $sum: 1 }, first: { $min: { $ifNull: ['$occurredAt', '$createdAt'] } }, last: { $max: { $ifNull: ['$occurredAt', '$createdAt'] } }, visits: { $sum: { $cond: [{ $in: ['$type', ['Site Visit', 'Meeting', 'Video Call']] }, 1, 0] } } } }]),
    ChannelPartner.find({ organization: org }).select('firmName').lean(),
    User.find({ organization: org }).select('firstName lastName').lean(),
  ]);

  const towerName = new Map(towers.map((t) => [String(t._id), { code: t.towerCode, name: t.towerName }]));
  const unitById = new Map(units.map((u) => [String(u._id), u]));
  const userName = new Map(users.map((u) => [String(u._id), `${u.firstName} ${u.lastName || ''}`.trim()]));
  const partnerName = new Map(partners.map((p) => [String(p._id), p.firmName]));

  // ── 1. Inventory & absorption ───────────────────────────────────────────────────────
  const blankTower = () => ({ total: 0, available: 0, blocked: 0, booked: 0, sold: 0, availableValue: 0, committedValue: 0, estimatedPrices: 0 });
  const byTower = new Map(); const byType = new Map(); const floorBands = new Map();
  const bandOf = (f) => (f <= 20 ? 'Floors 1–20' : f <= 40 ? 'Floors 21–40' : f <= 60 ? 'Floors 41–60' : 'Floors 61+');
  for (const u of units) {
    const tk = String(u.tower || 'none'); if (!byTower.has(tk)) byTower.set(tk, blankTower());
    const t = byTower.get(tk); t.total += 1; t[u.status] = (t[u.status] || 0) + 1;
    if (u.status === 'available') t.availableValue += u.currentPrice || 0; else t.committedValue += u.currentPrice || 0;
    if (u.pricing?.estimated) t.estimatedPrices += 1;
    const ty = u.type || 'Apartment'; if (!byType.has(ty)) byType.set(ty, { total: 0, available: 0, committed: 0 });
    const y = byType.get(ty); y.total += 1; if (u.status === 'available') y.available += 1; else y.committed += 1;
    const fb = bandOf(u.floor || 0); if (!floorBands.has(fb)) floorBands.set(fb, { total: 0, committed: 0 });
    const b = floorBands.get(fb); b.total += 1; if (u.status !== 'available') b.committed += 1;
  }
  const totals = [...byTower.values()].reduce((a, t) => { for (const k of Object.keys(a)) a[k] += t[k] || 0; return a; }, blankTower());
  const inventory = {
    totals: { ...totals, availableValueCr: round(totals.availableValue / CR), committedValueCr: round(totals.committedValue / CR), absorptionPct: pct(totals.total - totals.available, totals.total) },
    byTower: [...byTower.entries()].map(([k, t]) => ({ tower: towerName.get(k)?.code || '—', name: towerName.get(k)?.name || 'No tower', ...t, availableValueCr: round(t.availableValue / CR), committedValueCr: round(t.committedValue / CR), absorptionPct: pct(t.total - t.available, t.total) })).sort((a, b) => a.tower.localeCompare(b.tower)),
    byType: [...byType.entries()].map(([type, v]) => ({ type, ...v, absorptionPct: pct(v.committed, v.total) })).sort((a, b) => b.total - a.total),
    byFloorBand: ['Floors 1–20', 'Floors 21–40', 'Floors 41–60', 'Floors 61+'].filter((k) => floorBands.has(k)).map((k) => ({ band: k, ...floorBands.get(k), absorptionPct: pct(floorBands.get(k).committed, floorBands.get(k).total) })),
  };

  // ── 2. Booking velocity, FY target, rate movement ───────────────────────────────────
  const dated = sales.filter((s) => s.bookingDate && new Date(s.bookingDate).getTime() <= now + DAY);
  const byMonth = new Map(); const byFy = new Map(); const byQuarterPsf = new Map();
  for (const s of dated) {
    const d = new Date(s.bookingDate); const mk = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const m = byMonth.get(mk) || { month: mk, bookings: 0, value: 0 }; m.bookings += 1; m.value += s.salePrice || 0; byMonth.set(mk, m);
    const fk = fyOf(d); const f = byFy.get(fk) || { fy: fk, bookings: 0, value: 0 }; f.bookings += 1; f.value += s.salePrice || 0; byFy.set(fk, f);
    const psf = s.agreementValuePsf || (unitById.get(String(s.unit))?.areaSqft ? s.salePrice / unitById.get(String(s.unit)).areaSqft : null);
    if (psf) { const qk = `${fk} Q${Math.floor(((d.getUTCMonth() + 9) % 12) / 3) + 1}`; const q = byQuarterPsf.get(qk) || { quarter: qk, sortKey: d.getUTCFullYear() * 10 + Math.floor(d.getUTCMonth() / 3), rates: [] }; q.rates.push(psf); byQuarterPsf.set(qk, q); }
  }
  // Calendar-true monthly series (months with no bookings are zeros, not gaps).
  const months = [];
  if (dated.length) {
    const firstD = new Date(Math.min(...dated.map((x) => new Date(x.bookingDate).getTime()))); const cur = new Date(Date.UTC(firstD.getUTCFullYear(), firstD.getUTCMonth(), 1)); const stop = new Date(now);
    while (cur <= stop) { const mk = `${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, '0')}`; const m = byMonth.get(mk) || { month: mk, bookings: 0, value: 0 }; months.push({ ...m, valueCr: round(m.value / CR, 1) }); cur.setUTCMonth(cur.getUTCMonth() + 1); }
  }
  const inWindow = (days) => dated.filter((x) => now - new Date(x.bookingDate).getTime() <= days * DAY);
  const windowCr = (days) => round(inWindow(days).reduce((a, x) => a + (x.salePrice || 0), 0) / CR, 1);
  const currentFy = fyOf(new Date(now)); const { start: fyStart } = fyBounds(currentFy);
  const fyTargets = projects.flatMap((p) => (p.fyTargets || []).map((t) => ({ project: p.name, ...t, fy: `FY${String(t.fy).replace(/\D/g, '')}` })));
  const targetRow = (t) => {
    const b = fyBounds(t.fy); const row = byFy.get(t.fy) || { bookings: 0, value: 0 }; const achieved = round(row.value / CR, 1);
    const closed = b.end.getTime() <= now; const elapsed = Math.min(1, Math.max(0, (now - b.start.getTime()) / (b.end.getTime() - b.start.getTime())));
    const monthsLeft = closed ? 0 : round((b.end.getTime() - now) / (30.44 * DAY), 1);
    return { fy: t.fy, closed, targetCr: t.targetCr, registerAchievedCr: t.achievedCr ?? null, platformAchievedCr: achieved, bookings: row.bookings, achievedPct: pct(achieved, t.targetCr), yearElapsedPct: round(elapsed * 100, 1),
      expectedByNowCr: round((t.targetCr || 0) * elapsed, 1), gapToTargetCr: round((t.targetCr || 0) - achieved, 1), monthsLeft, requiredPerMonthCr: !closed && monthsLeft > 0 ? round(((t.targetCr || 0) - achieved) / Math.max(0.5, monthsLeft), 1) : null };
  };
  const targets = fyTargets.map(targetRow).sort((a, b) => a.fy.localeCompare(b.fy));
  // This financial year so far, against the same stretch of last year.
  const sinceFyStart = now - fyStart.getTime(); const lastFyStart = new Date(Date.UTC(fyStart.getUTCFullYear() - 1, 3, 1)).getTime();
  const thisFySales = dated.filter((x) => new Date(x.bookingDate).getTime() >= fyStart.getTime());
  const samePeriodLastFy = dated.filter((x) => { const t = new Date(x.bookingDate).getTime(); return t >= lastFyStart && t <= lastFyStart + sinceFyStart; });
  const sumSales = (arr) => round(arr.reduce((a, x) => a + (x.salePrice || 0), 0) / CR, 1);
  const velocity = {
    months, byFy: [...byFy.values()].sort((a, b) => a.fy.localeCompare(b.fy)).map((f) => ({ ...f, valueCr: round(f.value / CR, 1) })),
    last3MonthsCr: windowCr(91), last6MonthsCr: windowCr(182), last12MonthsCr: windowCr(365), bookingsLast3Months: inWindow(91).length, bookingsLast12Months: inWindow(365).length,
    avgBookingsPerMonth12: round(inWindow(365).length / 12, 1), undatedBookings: sales.length - dated.length,
    currentFy: { fy: currentFy, bookings: thisFySales.length, valueCr: sumSales(thisFySales), samePeriodLastFy: { bookings: samePeriodLastFy.length, valueCr: sumSales(samePeriodLastFy) }, monthsElapsed: round(sinceFyStart / (30.44 * DAY), 1), target: targets.find((t) => t.fy === currentFy) || null },
    targets,
    monthsToSellOut: inWindow(365).length > 0 ? round(totals.available / (inWindow(365).length / 12), 0) : null,
  };
  const rates = { byQuarter: [...byQuarterPsf.values()].sort((a, b) => a.sortKey - b.sortKey).map((q) => ({ quarter: q.quarter, bookings: q.rates.length, medianPsf: round(median(q.rates)), minPsf: round(Math.min(...q.rates)), maxPsf: round(Math.max(...q.rates)) })) };
  const towerRates = new Map();
  for (const s of dated) { const u = unitById.get(String(s.unit)); const psf = s.agreementValuePsf || (u?.areaSqft ? s.salePrice / u.areaSqft : null); if (!u || !psf) continue; const k = String(u.tower || 'none'); towerRates.set(k, [...(towerRates.get(k) || []), psf]); }
  rates.byTower = [...towerRates.entries()].map(([k, r]) => ({ tower: towerName.get(k)?.code || '—', name: towerName.get(k)?.name || '', bookings: r.length, medianPsf: round(median(r)), minPsf: round(Math.min(...r)), maxPsf: round(Math.max(...r)) })).sort((a, b) => a.tower.localeCompare(b.tower));

  // ── 3. Apartments on hold (EOI / blocked) ───────────────────────────────────────────
  const held = units.filter((u) => u.hold?.type);
  const ageBuckets = { '0–30 days': 0, '31–90 days': 0, '91–180 days': 0, 'Over 180 days': 0, 'No date': 0 };
  for (const u of held) { if (!u.hold.since) { ageBuckets['No date'] += 1; continue; } const d = (now - new Date(u.hold.since).getTime()) / DAY; ageBuckets[d <= 30 ? '0–30 days' : d <= 90 ? '31–90 days' : d <= 180 ? '91–180 days' : 'Over 180 days'] += 1; }
  const holdType = (t) => held.filter((u) => u.hold.type === t);
  const holds = {
    total: held.length, valueCr: round(held.reduce((a, u) => a + (u.hold.agreedValue || 0), 0) / CR), withoutAgreedValue: held.filter((u) => !(u.hold.agreedValue > 0)).length,
    byType: [...new Set(held.map((u) => u.hold.type))].map((t) => ({ type: t, count: holdType(t).length, valueCr: round(holdType(t).reduce((a, u) => a + (u.hold.agreedValue || 0), 0) / CR), withToken: holdType(t).filter((u) => u.hold.tokenAmount > 0).length })),
    ageing: Object.entries(ageBuckets).filter(([, n]) => n).map(([bucket, count]) => ({ bucket, count })),
    withToken: held.filter((u) => u.hold.tokenAmount > 0).length, tokenCollectedCr: round(held.reduce((a, u) => a + (u.hold.tokenAmount || 0), 0) / CR, 2),
    oldest: held.filter((u) => u.hold.since).sort((a, b) => new Date(a.hold.since) - new Date(b.hold.since)).slice(0, 8).map((u) => ({ unitId: u._id, unit: u.unitNumber, type: u.hold.type, days: Math.floor((now - new Date(u.hold.since).getTime()) / DAY), valueCr: round((u.hold.agreedValue || 0) / CR, 1), token: u.hold.tokenAmount > 0 })),
  };

  { // Deals of this financial year that are still at EOI / blocked stage — part of the year's real picture.
    const fyHolds = held.filter((u) => u.hold.since && new Date(u.hold.since).getTime() >= fyStart.getTime() && new Date(u.hold.since).getTime() <= now);
    velocity.currentFy.holdsStarted = fyHolds.length; velocity.currentFy.holdsValueCr = round(fyHolds.reduce((a, u) => a + (u.hold.agreedValue || 0), 0) / CR, 1);
  }

  // ── 4. Booking desk: where bookings are stuck ───────────────────────────────────────
  const tracked = sales.filter((s) => s.processTracker && Object.values(s.processTracker).some(Boolean));
  const desk = {
    trackedBookings: tracked.length,
    steps: TRACKER_STEPS.map(([k, label]) => ({ step: label, done: tracked.filter((s) => isYes(s.processTracker[k])).length, pending: tracked.filter((s) => isNo(s.processTracker[k])).length })).filter((x) => x.done + x.pending > 0),
    waitingOn: Object.entries(tracked.reduce((m, s) => { const pendingAny = TRACKER_STEPS.some(([k]) => isNo(s.processTracker[k])); if (!pendingAny) return m; const d = (s.processTracker.dependency || 'Not stated').trim(); m[d] = (m[d] || 0) + 1; return m; }, {})).map(([who, count]) => ({ who, count })).sort((a, b) => b.count - a.count),
    notLiveInSystem: tracked.filter((s) => /not/i.test(s.processTracker.systemLive || '')).length,
    bookedNotRegistered: sales.filter((s) => s.status === 'Booked').length,
    bookedNotRegisteredValueCr: round(sales.filter((s) => s.status === 'Booked').reduce((a, s) => a + (s.salePrice || 0), 0) / CR),
    oldestUnregistered: sales.filter((s) => s.status === 'Booked' && s.bookingDate).sort((a, b) => new Date(a.bookingDate) - new Date(b.bookingDate)).slice(0, 8).map((s) => ({ saleId: s._id, unit: unitById.get(String(s.unit))?.unitNumber || '—', days: Math.floor((now - new Date(s.bookingDate).getTime()) / DAY), valueCr: round((s.salePrice || 0) / CR, 1), waitingOn: s.processTracker?.dependency || null })),
  };

  // ── 5. Sales vs audit reconciliation ────────────────────────────────────────────────
  // "Registered" vs "Sold-Registered", "Block" vs "Blocked" are the same thing said two ways.
  const canon = (v) => { const x = String(v || '').trim().toUpperCase(); return /REGIST/.test(x) ? 'REGISTERED' : /^BLOCK/.test(x) ? 'BLOCKED' : /^SOLD/.test(x) ? 'SOLD' : /^UNSOLD|^AVAIL/.test(x) ? 'UNSOLD' : x; };
  const compared = sales.filter((s) => s.externalStatus?.sales && s.externalStatus?.audit);
  const mism = compared.filter((s) => canon(s.externalStatus.sales) !== canon(s.externalStatus.audit));
  const pairs = mism.reduce((m, s) => { const k = `Sales: ${canon(s.externalStatus.sales)} · Audit: ${canon(s.externalStatus.audit)}`; const r = m.get(k) || { pair: k, count: 0, value: 0 }; r.count += 1; r.value += s.salePrice || 0; m.set(k, r); return m; }, new Map());
  const reconciliation = { compared: compared.length, mismatched: mism.length, mismatchedValueCr: round(mism.reduce((a, s) => a + (s.salePrice || 0), 0) / CR), pairs: [...pairs.values()].sort((a, b) => b.count - a.count).map((p) => ({ pair: p.pair, count: p.count, valueCr: round(p.value / CR) })) };

  // ── 6. Sources & channel partners ───────────────────────────────────────────────────
  const leadTotals = { byStatus: {}, bySource: {} }; let totalLeads = 0;
  for (const r of leadAgg) { totalLeads += r.n; leadTotals.byStatus[r._id.status] = (leadTotals.byStatus[r._id.status] || 0) + r.n; const src = r._id.source || 'Not stated'; const e = leadTotals.bySource[src] || { clients: 0, booked: 0 }; e.clients += r.n; if (r._id.status === 'Booked') e.booked += r.n; leadTotals.bySource[src] = e; }
  const saleBySource = sales.reduce((m, s) => { const k = /^cp/i.test(s.sourceType || '') || s.channelPartnerAttribution?.partners?.length ? 'Channel Partner' : /mgmt|management/i.test(s.sourceType || '') ? 'Management' : /^ref/i.test(s.sourceType || '') ? 'Referral' : /^direct/i.test(s.sourceType || '') ? 'Direct' : 'Not stated'; const r = m.get(k) || { bookings: 0, value: 0 }; r.bookings += 1; r.value += s.salePrice || 0; m.set(k, r); return m; }, new Map());
  const sources = [...new Set([...Object.keys(leadTotals.bySource), ...saleBySource.keys()])].map((src) => ({ source: src, clients: leadTotals.bySource[src]?.clients || 0, bookings: saleBySource.get(src)?.bookings || 0, valueCr: round((saleBySource.get(src)?.value || 0) / CR), conversionPct: pct(saleBySource.get(src)?.bookings || 0, leadTotals.bySource[src]?.clients || 0) })).sort((a, b) => b.valueCr - a.valueCr);
  const cpClients = await Lead.aggregate([{ $match: { ...scope, 'channelPartnerAttribution.viaChannelPartner': true } }, { $unwind: '$channelPartnerAttribution.partners' }, { $group: { _id: '$channelPartnerAttribution.partners.channelPartner', clients: { $sum: 1 } } }]);
  const cpMap = new Map(cpClients.map((c) => [String(c._id), { clients: c.clients, bookings: 0, value: 0 }]));
  for (const s of sales) for (const p of s.channelPartnerAttribution?.partners || []) { const k = String(p.channelPartner); const r = cpMap.get(k) || { clients: 0, bookings: 0, value: 0 }; r.bookings += 1; r.value += s.salePrice || 0; cpMap.set(k, r); }
  const cpRows = [...cpMap.entries()].map(([k, r]) => ({ partnerId: k, firm: partnerName.get(k) || 'Unknown firm', clients: r.clients, bookings: r.bookings, valueCr: round(r.value / CR), conversionPct: pct(r.bookings, r.clients) }));
  const cpBookedValue = cpRows.reduce((a, r) => a + r.valueCr, 0);
  const channelPartners = {
    firms: partners.length, firmsWithBookings: cpRows.filter((r) => r.bookings).length, firmsWithClientsNoBookings: cpRows.filter((r) => r.clients >= 5 && !r.bookings).length,
    top: [...cpRows].sort((a, b) => b.valueCr - a.valueCr || b.bookings - a.bookings).slice(0, 10),
    busiestWithoutBookings: cpRows.filter((r) => !r.bookings).sort((a, b) => b.clients - a.clients).slice(0, 5),
    top3SharePct: pct([...cpRows].sort((a, b) => b.valueCr - a.valueCr).slice(0, 3).reduce((a, r) => a + r.valueCr, 0), cpBookedValue),
  };

  // ── 7. Funnel, meetings and the team ────────────────────────────────────────────────
  const perLead = new Map(); const perUser = new Map();
  for (const r of meetingAgg) {
    const lk = String(r._id.lead); const l = perLead.get(lk) || { n: 0, visits: 0, first: null, last: null }; l.n += r.n; l.visits += r.visits; if (r.first && (!l.first || r.first < l.first)) l.first = r.first; if (r.last && (!l.last || r.last > l.last)) l.last = r.last; perLead.set(lk, l);
    const uk = String(r._id.user); const u = perUser.get(uk) || { meetings: 0, clients: new Set() }; u.meetings += r.visits; u.clients.add(lk); perUser.set(uk, u);
  }
  const bookedLeadIds = new Set(sales.map((s) => String(s.lead)));
  const daysToBook = sales.filter((s) => s.bookingDate && perLead.get(String(s.lead))?.first).map((s) => (new Date(s.bookingDate).getTime() - new Date(perLead.get(String(s.lead)).first).getTime()) / DAY).filter((d) => d >= 0 && d < 3650);
  const meetingsBeforeBooking = [...bookedLeadIds].map((id) => perLead.get(id)?.visits).filter((n) => n > 0);
  const openLeads = await Lead.find({ ...scope, status: { $nin: ['Booked', 'Lost'] } }).select('_id').lean();
  const dormancy = { 'Met in last 30 days': 0, '31–90 days ago': 0, '91–180 days ago': 0, '181–365 days ago': 0, 'Over a year ago': 0, 'Never met': 0 };
  for (const l of openLeads) { const m = perLead.get(String(l._id)); if (!m?.last) { dormancy['Never met'] += 1; continue; } const d = (now - new Date(m.last).getTime()) / DAY; dormancy[d <= 30 ? 'Met in last 30 days' : d <= 90 ? '31–90 days ago' : d <= 180 ? '91–180 days ago' : d <= 365 ? '181–365 days ago' : 'Over a year ago'] += 1; }
  const revisitNotBooked = openLeads.filter((l) => (perLead.get(String(l._id))?.visits || 0) >= 2).length;
  const funnel = {
    totalClients: totalLeads, byStatus: leadTotals.byStatus, clientsMet: [...perLead.values()].filter((l) => l.visits > 0).length, booked: leadTotals.byStatus.Booked || 0,
    visitToBookingPct: pct(leadTotals.byStatus.Booked || 0, [...perLead.values()].filter((l) => l.visits > 0).length), medianDaysFirstMeetingToBooking: round(median(daysToBook)),
    medianMeetingsBeforeBooking: median(meetingsBeforeBooking), openClients: openLeads.length, cameBackNotBooked: revisitNotBooked,
    dormancy: Object.entries(dormancy).map(([bucket, count]) => ({ bucket, count })),
    scoreBands: leadBands.map((b) => ({ band: b._id === 0 ? 'Below 40 (dormant)' : b._id === 40 ? '40–54' : b._id === 55 ? '55–69 (warm)' : b._id === 70 ? '70+ (hot)' : 'Not scored', count: b.n })),
  };
  const teamMap = new Map();
  for (const s of sales) { const k = String(s.salesPerson); const r = teamMap.get(k) || { bookings: 0, value: 0, registered: 0 }; r.bookings += 1; r.value += s.salePrice || 0; if (s.status === 'Registered' || s.status === 'Completed') r.registered += 1; teamMap.set(k, r); }
  for (const [k, u] of perUser) { const r = teamMap.get(k) || { bookings: 0, value: 0, registered: 0 }; r.meetings = u.meetings; r.clientsMet = u.clients.size; teamMap.set(k, r); }
  const team = [...teamMap.entries()].map(([k, r]) => ({ userId: k, name: userName.get(k) || 'Unknown', bookings: r.bookings, valueCr: round(r.value / CR), registered: r.registered, meetings: r.meetings || 0, clientsMet: r.clientsMet || 0, bookingsPer100Clients: pct(r.bookings, r.clientsMet || 0) })).filter((r) => r.bookings || r.meetings).sort((a, b) => b.valueCr - a.valueCr || b.meetings - a.meetings);

  // ── 8. Headlines: the handful of things worth a promoter's attention ────────────────
  const headlines = [];
  const push = (tone, title, detail) => headlines.push({ tone, title, detail });
  const inr = (n) => Number(n || 0).toLocaleString('en-IN');
  for (const t of velocity.targets) {
    const diff = t.registerAchievedCr != null && Math.abs(t.registerAchievedCr - t.platformAchievedCr) > 1 ? ` The register's own summary box says ₹${inr(t.registerAchievedCr)} Cr achieved — ₹${inr(round(Math.abs(t.registerAchievedCr - t.platformAchievedCr), 1))} Cr away from what its booking rows add up to, so that box is out of date.` : '';
    if (t.closed) push(t.achievedPct >= 100 ? 'good' : 'info', `${t.fy} closed at ₹${inr(t.platformAchievedCr)} Cr against a ₹${inr(t.targetCr)} Cr target (${t.achievedPct}%)`, `${t.bookings} bookings dated in that financial year.${diff}`);
    else push(t.platformAchievedCr >= t.expectedByNowCr ? 'good' : 'risk', `${t.fy}: ₹${inr(t.platformAchievedCr)} Cr booked against a ₹${inr(t.targetCr)} Cr target (${t.achievedPct}%)`, `${t.yearElapsedPct}% of the year has gone; on a straight line ₹${inr(t.expectedByNowCr)} Cr would be booked by now.${t.requiredPerMonthCr ? ` Closing the gap needs ₹${inr(t.requiredPerMonthCr)} Cr a month for the remaining ${t.monthsLeft} months.` : ''}${diff}`);
  }
  { const c = velocity.currentFy; const lp = c.samePeriodLastFy; const down = c.valueCr < lp.valueCr;
    push(down ? 'risk' : 'good', `${c.fy} so far: ${c.bookings} bookings worth ₹${inr(c.valueCr)} Cr in ${c.monthsElapsed} months`, `The same stretch of last year had ${lp.bookings} bookings worth ₹${inr(lp.valueCr)} Cr.${c.target ? '' : ` No ${c.fy} target is loaded yet.`} ${c.holdsStarted ? ` A further ${c.holdsStarted} apartments (₹${inr(c.holdsValueCr)} Cr) put on hold this year are still at EOI / blocked stage rather than booked.` : ''}`); }
  if (holds.total) { const stale = held.filter((u) => u.hold.since && (now - new Date(u.hold.since).getTime()) / DAY > 90); push(stale.length ? 'risk' : 'info', `${holds.total} apartments worth ₹${holds.valueCr.toLocaleString('en-IN')} Cr are on hold, not sold`, `${holds.withToken} have a token against them. ${stale.length} have been held for more than 90 days${stale.length ? ` (₹${round(stale.reduce((a, u) => a + (u.hold.agreedValue || 0), 0) / CR).toLocaleString('en-IN')} Cr) — convert or release them.` : '.'}`); }
  if (desk.bookedNotRegistered) push('risk', `${desk.bookedNotRegistered} bookings worth ₹${desk.bookedNotRegisteredValueCr.toLocaleString('en-IN')} Cr are not registered yet`, `${desk.waitingOn.length ? `Open desk items are waiting on: ${desk.waitingOn.slice(0, 3).map((w) => `${w.who} (${w.count})`).join(', ')}. ` : ''}${desk.notLiveInSystem ? `${desk.notLiveInSystem} bookings are not live in the accounting system.` : ''}`);
  if (reconciliation.mismatched) push('risk', `Sales and audit records disagree on ${reconciliation.mismatched} of ${reconciliation.compared} bookings (₹${reconciliation.mismatchedValueCr.toLocaleString('en-IN')} Cr)`, `Most common: ${reconciliation.pairs.slice(0, 3).map((p) => `${p.pair} (${p.count})`).join('; ')}.`);
  if (funnel.openClients) { const cold = dormancy['Over a year ago'] + dormancy['181–365 days ago']; push('info', `${funnel.cameBackNotBooked} clients came back for a second meeting and have not booked`, `${cold.toLocaleString('en-IN')} of ${funnel.openClients.toLocaleString('en-IN')} open clients have not been met for over six months; ${dormancy['Met in last 30 days'] + dormancy['31–90 days ago']} were met in the last 90 days. Clients typically book ${funnel.medianDaysFirstMeetingToBooking ?? '—'} days after the first meeting, after ${funnel.medianMeetingsBeforeBooking ?? '—'} meeting(s).`); }
  if (channelPartners.top.length) push('info', `${channelPartners.firmsWithBookings} of ${channelPartners.firms} channel-partner firms have produced a booking`, `The top 3 account for ${channelPartners.top3SharePct}% of partner-sourced value. ${channelPartners.firmsWithClientsNoBookings} firms have brought 5+ clients without a single booking.`);
  if (inventory.totals.estimatedPrices) push('info', `${inventory.totals.estimatedPrices} unsold apartments have no rate on file`, 'They are valued at the tower\'s median achieved rate for now, so unsold-inventory value is indicative until a rate card is loaded.');
  if (velocity.monthsToSellOut) push('info', `At the last 12 months' pace (${velocity.avgBookingsPerMonth12} bookings a month) the remaining ${inventory.totals.available} apartments take about ${velocity.monthsToSellOut} months to sell`, `${inventory.byTower.slice().sort((a, b) => a.absorptionPct - b.absorptionPct)[0]?.name || ''} is the slowest tower at ${inventory.byTower.slice().sort((a, b) => a.absorptionPct - b.absorptionPct)[0]?.absorptionPct ?? 0}% committed.`);

  return { generatedAt: new Date(), projects: projects.map((p) => ({ _id: p._id, name: p.name })), headlines, inventory, velocity, rates, holds, desk, reconciliation, sources, channelPartners, funnel, team, fyTargets };
}
