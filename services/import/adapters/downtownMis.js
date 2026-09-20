// File: services/import/adapters/downtownMis.js
// Description: Adapter for a developer "Sales & CRM MIS" workbook in the shape used
//   by 25 Downtown: a master unit/booking register ("MIS") plus registration values,
//   a collection process tracker, an audit-status comparison, a client-meeting
//   register, assigned / digital leads, cancellations, a checklist and FY targets.
//   Pure: workbook in, canonical entities + issues out. No DB access.

import { columnIndex } from '../workbook.js';
import { emptyCanonical, issueCollector, TeamRegistry, BrokerRegistry, LeadRegistry, sha } from '../canonical.js';
import * as N from '../normalize.js';

export const FORMAT = 'developer_mis';

export function detect(wb) {
  const names = wb.sheets.map((s) => s.name.trim().toLowerCase());
  let score = 0;
  if (names.includes('mis')) score += 2;
  if (names.some((n) => n.includes('client meetings'))) score += 2;
  if (names.some((n) => n.includes('collection sheet'))) score += 1;
  if (names.some((n) => n.includes('registration val'))) score += 1;
  return score >= 3 ? score : 0;
}

const UNIT_STATUS = { UNSOLD: 'available', BLOCKED: 'blocked', BLOCK: 'blocked', EOI: 'blocked', SOLD: 'booked', REGISTERED: 'sold', 'SOLD-REGISTERED': 'sold' };
const SALE_STATUS = { SOLD: 'Booked', REGISTERED: 'Registered', 'SOLD-REGISTERED': 'Registered' };

function typologyLabel(t) {
  const s = N.text(t);
  if (!s) return 'Apartment';
  if (/^\d+(\.0)?$/.test(s)) { const n = Number(s); return n === 9 ? 'Jodi 4+5 BHK' : `${n} BHK`; }
  if (/refuge/i.test(s)) return 'Refuge-floor apartment';
  return N.titleCase(s);
}

function sourceFrom(kind) {
  const k = N.text(kind).toUpperCase();
  if (k.startsWith('CP')) return 'Channel Partner';
  if (k.includes('MGMT') || k.includes('MANAGEMENT')) return 'Management';
  if (k.startsWith('REF')) return 'Referral';
  if (k.startsWith('DIRECT')) return 'Direct';
  return null;
}

/** Tower blocks stacked vertically in one sheet: a cell in column A equal to T1/T2/… starts a block. */
function towerBlocks(sheet, col = 1) {
  const blocks = [];
  for (let r = 1; r <= sheet.rowCount; r += 1) {
    const v = N.text(sheet.get(r, col)).toUpperCase().replace(/^TOWER\s*/, 'T');
    if (/^T\d$/.test(v)) blocks.push({ tower: v, startRow: r });
  }
  blocks.forEach((b, i) => { b.endRow = i + 1 < blocks.length ? blocks[i + 1].startRow - 1 : sheet.rowCount; });
  return blocks;
}

export function parse(wb, ctx = {}) {
  const out = emptyCanonical(); out.formats.push(FORMAT);
  const issue = issueCollector(out.issues);
  const team = new TeamRegistry(); const brokers = new BrokerRegistry(); const leads = new LeadRegistry();
  const unitByKey = new Map(); const saleByUnit = new Map(); const towers = new Map();
  const handled = new Set();
  const sheetLike = (re) => wb.sheets.find((s) => re.test(s.name.trim()));

  // ── 1. Master register ────────────────────────────────────────────────
  const mis = wb.sheet('MIS');
  if (mis) {
    handled.add(mis.name);
    const { headers, rows } = mis.table();
    const H = (...n) => columnIndex(headers, ...n);
    const towerCols = headers.map((h, i) => (h.toLowerCase() === 'tower' ? i : -1)).filter((i) => i !== -1);
    const c = {
      tCode: towerCols[0] ?? -1, tName: towerCols[1] ?? -1, unit: H('unit no'), floor: H('floor no. from ground', 'floor from'), hab: H('habitable floor'),
      cust: H('customer name (main applicant)', 'customer name'), status: H('booking status'), live: H('system (live'), cs: H('cs (y/n)'), bf: H('bf (y/n)'),
      kyc: H('kyc (y/n)'), token: H('token (y/n)'), gst: H('gst (y/n)'), kind: H('cp/ direct/ mgmt', 'cp/direct'), srcName: H('cp / mgmt name'), firm: H('cp firm name'),
      cpPhone: H('cp contact number'), brok: H('brokerage %', 'brokerage'), closing: H('closing manager'), sourcing: H('sourcing manager'), bDate: H('booking date'),
      tokenAmt: H('token amount'), area: H('area in sqft'), avPsf: H('agreement value psf'), aiPsf: H('all-in value psf'), av: H('agreement value in rs'), ai: H('all-in value in rs'),
      sd: H('stamp duty'), totSqm: H('total area sqmt'), rera: H('rera carpet area sqmt'), deck: H('deck area'), util: H('utility area'), serv: H('servant area'), dry: H('drying area'),
      typ: H('typology'), park: H('car park total'), single: H('single'), tandem: H('tandem'), profile: H('customer profile'), cat: H('corporate / professional'),
      dob: H('dob'), ann: H('anniversary date'), phone: H('contact no. (spokes person)', 'contact no'), alt: H('alternate no'), email: H('email id'), pan: H('pan card'), aad: H('aadhar card', 'aadhaar'),
      coName: H('customer name (co-applicants)'), coAddr: H('co-app: correspondance address', 'co-app: correspondence'), coDob: H('co-app: dob'), coPhone: H('co-app: contact'), coEmail: H('co-app: email'), coPan: H('co-app: pan'), coAad: H('co-app: aadhar'),
      salesRem: H('sales remarks'), dep: H('(dependency'), crmRem: H('sid remarks'), gift: H('gift remark'),
    };
    c.addr = c.ann !== -1 && headers[c.ann + 1] === '' ? c.ann + 1 : -1;
    const mapped = new Set(Object.values(c).filter((i) => i >= 0));
    headers.forEach((h, i) => { if (h && !mapped.has(i) && !/^(sr\.? ?no|year|booking month|total area sqft|send by|sid remarks 2nd|ss)$/i.test(h)) out.unmappedColumns.push({ sheet: mis.name, column: h }); });

    for (const { __row: r, __vals: v } of rows) {
      const g = (i) => (i >= 0 ? v[i] : null);
      const tCode = N.text(g(c.tCode)).toUpperCase(); const unitNo = N.text(g(c.unit)).replace(/\.0$/, '');
      if (!tCode || !unitNo) continue;
      if (/^(lmr|terrace)$/i.test(unitNo)) { issue('info', mis.name, r, 'Unit no', `${tCode} ${unitNo} is a service level, not an apartment — skipped`); continue; }
      if (!towers.has(tCode)) towers.set(tCode, { code: tCode, name: N.text(g(c.tName)) || tCode, floors: new Set(), perFloor: new Map() });
      const floor = N.num(g(c.floor)); const area = N.num(g(c.area));
      const tw = towers.get(tCode); if (floor != null) { tw.floors.add(floor); tw.perFloor.set(floor, (tw.perFloor.get(floor) || 0) + 1); }
      const rawStatus = N.text(g(c.status)).toUpperCase();
      const avPsf = N.num(g(c.avPsf)); const aiPsf = N.num(g(c.aiPsf)); const av = N.num(g(c.av)); const ai = N.num(g(c.ai));
      if (!(rawStatus in UNIT_STATUS)) issue('warning', mis.name, r, 'BOOKING STATUS', `Unrecognised status "${N.text(g(c.status))}" — treated as unsold`);
      const typ = N.text(g(c.typ));
      const key = N.unitKey(tCode, unitNo);
      const price = av || (avPsf && area ? Math.round(avPsf * area) : null);
      if (!area) issue('error', mis.name, r, 'Area in SqFt', `${key}: no area — unit cannot be priced`);
      unitByKey.set(key, {
        key, origin: 'register', towerCode: tCode, unitNumber: key, floor: floor ?? 0, habitableFloor: N.num(g(c.hab)), typology: typ, type: typologyLabel(typ), isRefuge: /refuge/i.test(typ),
        areaSqft: area || 0, basePrice: price || 0, currentPrice: price || 0, status: UNIT_STATUS[rawStatus] || 'available',
        areaBreakdown: { totalSqm: N.num(g(c.totSqm)), reraCarpetSqm: N.num(g(c.rera)), deckSqm: N.num(g(c.deck)), utilitySqm: N.num(g(c.util)), servantSqm: N.num(g(c.serv)), dryingSqm: N.num(g(c.dry)) },
        parkingTotal: N.num(g(c.park)), parkingSplit: { single: N.num(g(c.single)), tandem: N.num(g(c.tandem)) }, pricing: { agreementPsf: avPsf, allInPsf: aiPsf },
        bedrooms: /^\d+$/.test(typ) ? Number(typ) : null, combined: /[&+]/.test(unitNo), waitlist: [],
      });

      const custRaw = N.text(g(c.cust));
      const committed = ['SOLD', 'REGISTERED', 'EOI', 'BLOCKED', 'BLOCK'].includes(rawStatus);
      if (!committed) { if (av) issue('warning', mis.name, r, 'Agreement Value in Rs.', `${key} is Unsold but carries an agreement value`); continue; }
      if (!custRaw) { issue('warning', mis.name, r, 'Customer name', `${key} is ${rawStatus} but has no customer name — unit status kept, no booking created`); continue; }

      const closing = team.add(g(c.closing), 'closing'); const sourcing = team.add(g(c.sourcing), 'sourcing');
      const kind = N.text(g(c.kind)); const source = sourceFrom(kind);
      const srcName = N.text(g(c.srcName)); const firm = N.text(g(c.firm));
      let brokerKey = null; const rate = N.percent(g(c.brok));
      if (source === 'Channel Partner') { brokerKey = brokers.add({ firmName: firm, contactName: srcName, phone: N.phone(g(c.cpPhone)), ratePct: rate }); brokers.bump(brokerKey); }
      const bDate = N.date(g(c.bDate));
      if (bDate && bDate.getTime() > Date.now() + 86400000) issue('warning', mis.name, r, 'Booking Date', `${key}: booking date ${bDate.toISOString().slice(0, 10)} is in the future`);
      const co = N.text(g(c.coName));
      const leadKey = leads.upsert(custRaw, {
        phone: N.phone(g(c.phone)), alternatePhone: N.phone(g(c.alt)), email: N.email(g(c.email)), address: c.addr >= 0 ? N.text(g(c.addr)) : '',
        source: source || 'Direct', sourceDetail: [kind, firm, srcName].filter(Boolean).join(' · '), mgmtContact: source === 'Management' ? srcName : '', brokerKey, brokerPerson: source === 'Channel Partner' ? srcName : '',
        assignedTo: closing, createdAt: bDate, profile: { company: N.text(g(c.profile)), category: N.text(g(c.cat)), dateOfBirth: N.date(g(c.dob)), anniversaryDate: N.date(g(c.ann)) },
        kyc: { pan: N.pan(g(c.pan)), aadhaarLast4: N.aadhaarLast4(g(c.aad)), status: N.yn(g(c.kyc)) === 'Y' ? 'complete' : 'pending' },
        coApplicants: co ? [{ name: N.personName(co).full, dateOfBirth: N.date(g(c.coDob)), phone: N.phone(g(c.coPhone)), email: N.email(g(c.coEmail)), address: N.text(g(c.coAddr)), pan: N.pan(g(c.coPan)), aadhaarLast4: N.aadhaarLast4(g(c.coAad)) }] : [],
        unitTypeWanted: typologyLabel(typ), budgetMax: av || null, notes: N.text(g(c.gift)) ? `Gift: ${N.text(g(c.gift))}` : '',
      });
      const tracker = { costSheet: N.yn(g(c.cs)), bookingForm: N.yn(g(c.bf)), kyc: N.yn(g(c.kyc)), token: N.yn(g(c.token)), gstOnToken: N.yn(g(c.gst)), systemLive: N.text(g(c.live)), dependency: N.titleCase(g(c.dep)), salesRemarks: N.text(g(c.salesRem)), crmRemarks: N.text(g(c.crmRem)) };

      if (rawStatus in SALE_STATUS) {
        if (!av) issue('warning', mis.name, r, 'Agreement Value in Rs.', `${key} is ${rawStatus} without an agreement value — used rate × area`);
        const sale = {
          key: `sale:${key}:${leadKey}`, unitKey: key, leadKey, status: SALE_STATUS[rawStatus], bookingDate: bDate, salePrice: av || price || 0, allInValue: ai, agreementValuePsf: avPsf, allInValuePsf: aiPsf,
          stampDuty: N.num(g(c.sd)), tokenAmount: N.num(g(c.tokenAmt)), closing, sourcing, sourceType: kind, sourceName: srcName, brokerKey, brokerRatePct: rate, processTracker: tracker,
          externalStatus: { sales: rawStatus }, costSheet: { areaSqft: area, agreementValue: av, allInValue: ai, agreementPsf: avPsf, allInPsf: aiPsf, stampDuty: N.num(g(c.sd)) },
        };
        saleByUnit.set(key, sale); out.sales.push(sale);
        leads.get(leadKey).status = 'Booked';
      } else {
        out.holds.push({ unitKey: key, type: rawStatus === 'EOI' ? 'EOI' : 'Blocked', leadKey, clientName: N.personName(custRaw).full, since: bDate, tokenAmount: N.num(g(c.tokenAmt)), agreedValue: av, closing, remarks: tracker.salesRemarks, processTracker: tracker });
        const l = leads.get(leadKey); if (l.status !== 'Booked') l.status = 'Negotiating';
      }
    }
  } else {
    issue('error', '(workbook)', null, 'MIS', 'No "MIS" sheet found — units and bookings cannot be read');
  }

  // ── 2. Registration values (tower blocks; also the only source for a tower missing from the MIS) ──
  const reg = sheetLike(/registration val/i);
  if (reg) {
    handled.add(reg.name);
    for (const b of towerBlocks(reg)) {
      for (let r = b.startRow + 1; r <= b.endRow; r += 1) {
        const unitNo = N.text(reg.get(r, 2)).replace(/\.0$/, ''); const av = N.num(reg.get(r, 4));
        if (!unitNo || !/\d/.test(unitNo)) continue;
        const key = N.unitKey(b.tower, unitNo);
        const breakdown = { agreementValue: av, stampDuty: N.num(reg.get(r, 5)), gst: N.num(reg.get(r, 6)), cess: N.num(reg.get(r, 7)), others: N.num(reg.get(r, 8)), grandTotal: N.num(reg.get(r, 9)) };
        // The register may list this apartment under a combined key ("T1-4401 & 4402") or with a suffix ("T3-5001-A").
        const digits = String(unitNo).replace(/\D/g, '');
        const regKey = unitByKey.has(key) ? key : [...unitByKey.keys()].find((k) => k.startsWith(`${b.tower}-`) && k.slice(b.tower.length + 1).split(/[&+]/).some((part) => part.replace(/\D/g, '') === digits));
        const sale = saleByUnit.get(regKey || key);
        if (sale) {
          const prev = sale.costSheet.registration;
          sale.costSheet = { ...sale.costSheet, registration: prev ? Object.fromEntries(Object.keys(breakdown).map((f) => [f, (prev[f] || 0) + (breakdown[f] || 0)])) : breakdown };
          continue;
        }
        if (regKey) continue; // known unit (unsold / held) — nothing to create
        const client = N.text(reg.get(r, 1));
        if (av && client) {
          // A sold unit that the master register does not list (e.g. a tower kept outside the MIS).
          const area = N.num(reg.get(r, 3)) || 0;
          unitByKey.set(key, { key, origin: 'register', towerCode: b.tower, unitNumber: key, floor: Number(String(unitNo).slice(0, -2)) || 0, typology: '', type: 'Apartment', areaSqft: area, basePrice: av, currentPrice: av, status: 'booked', areaBreakdown: {}, parkingSplit: {}, pricing: { agreementPsf: area ? av / area : null }, waitlist: [] });
          if (!towers.has(b.tower)) towers.set(b.tower, { code: b.tower, name: '', floors: new Set(), perFloor: new Map() });
          const leadKey = leads.upsert(client, { source: 'Direct', status: 'Booked', unitTypeWanted: 'Apartment' });
          const closing = team.add(reg.get(r, 12), 'closing');
          const s = { key: `sale:${key}:${leadKey}`, unitKey: key, leadKey, status: 'Booked', bookingDate: null, salePrice: av, closing, processTracker: {}, externalStatus: {}, costSheet: { areaSqft: area, agreementValue: av, registration: breakdown } };
          saleByUnit.set(key, s); out.sales.push(s);
          issue('warning', reg.name, r, 'Unit', `${key} appears only in the registration sheet — booking created without a booking date or contact`);
        }
      }
    }
  }

  // ── 3. Collection process tracker (tower blocks) ─────────────────────────
  const col = sheetLike(/collection sheet/i);
  if (col) {
    handled.add(col.name);
    for (const b of towerBlocks(col)) {
      const hdr = col.row(b.startRow + 1).map((h) => N.text(h).toLowerCase());
      const at = (...n) => { for (const x of n) { const i = hdr.findIndex((h) => h.includes(x)); if (i !== -1) return i + 1; } return -1; };
      const cc = { unit: at('unit'), reg: at('registration'), rev: at('reverse payment'), bookAmt: at('booking amount'), erp: at('netsuite', 'erp upload'), gstBook: at('gst (9.99', 'gst (10'), rem: at('remarks') };
      for (let r = b.startRow + 2; r <= b.endRow; r += 1) {
        const sale = saleByUnit.get(N.unitKey(b.tower, N.text(col.get(r, cc.unit)).replace(/\.0$/, '')));
        if (!sale) continue;
        const v = (cI) => (cI > 0 ? col.get(r, cI) : null);
        Object.assign(sale.processTracker, { registration: N.yn(v(cc.reg)), reversePayment: N.yn(v(cc.rev)), bookingAmount: N.yn(v(cc.bookAmt)), erpUpload: N.yn(v(cc.erp)), gstOnBookingAmount: N.yn(v(cc.gstBook)) });
        const rem = N.text(v(cc.rem)); if (rem) sale.processTracker.crmRemarks = [sale.processTracker.crmRemarks, rem].filter(Boolean).join(' | ');
      }
    }
  }

  // ── 4. Audit-status comparison ───────────────────────────────────────────
  const eoi = sheetLike(/eoi.*noc/i);
  if (eoi) {
    handled.add(eoi.name);
    const { headers, rows } = eoi.table({ headerRow: 1 });
    const iT = columnIndex(headers, 'tower'); const iU = columnIndex(headers, 'unit'); const iS = columnIndex(headers, 'sales: status', 'sales'); const iA = headers.findIndex((h) => /file:?\s*status/i.test(h)); const iR = columnIndex(headers, 'remarks');
    let differ = 0;
    for (const { __vals: v } of rows) {
      const key = N.unitKey(N.text(v[iT]), N.text(v[iU]).replace(/\.0$/, '')); const s = N.text(v[iS]).toUpperCase(); const a = iA >= 0 ? N.text(v[iA]).toUpperCase() : '';
      if (s && a && s !== a && !(s === 'REGISTERED' && a === 'SOLD-REGISTERED') && !(s === 'BLOCK' && a === 'BLOCKED')) differ += 1;
      const sale = saleByUnit.get(key); if (sale) sale.externalStatus = { sales: s, audit: a, auditRemarks: N.text(v[iR]) };
      const hold = out.holds.find((h) => h.unitKey === key); if (hold) hold.auditStatus = a;
    }
    if (differ) issue('info', eoi.name, null, 'Status', `Sales status and audit-file status disagree on ${differ} units — both are stored on the booking for reconciliation`);
  }

  // ── 5. Client meetings → clients + interactions ─────────────────────────
  const mtg = sheetLike(/client meetings/i);
  if (mtg) {
    handled.add(mtg.name);
    const { headers, rows } = mtg.table({ headerRow: 1 });
    const H = (...n) => columnIndex(headers, ...n);
    const m = { name: H('name'), status: H('status'), profile: H('profile'), date: H('date of visit'), type: H('type of meeting'), addr: H('address'), rem: H('remarks'), src: H('source'), sm: H('sales manager'), st: H('sourcing team'), proj: H('project name'), att: H('attended by') };
    const TYPE = { IBM: 'Site Visit', OBM: 'Meeting', VC: 'Video Call', CALL: 'Call' };
    const LEAD_STATUS = { BOOKED: 'Negotiating', LOST: 'Lost', REVISIT: 'Site Visit Completed', DONE: 'Site Visit Completed', PLANNED: 'New', HOT: 'Qualified', WARM: 'Qualified', COLD: 'Qualified' };
    for (const { __row: r, __vals: v } of rows) {
      const nm = N.text(v[m.name]); if (!nm) continue;
      const when = N.date(v[m.date]); const mode = N.text(v[m.type]).toUpperCase(); const st = N.text(v[m.status]).toUpperCase();
      const sm = team.add(v[m.sm], 'closing'); if (N.text(v[m.st])) team.add(v[m.st], 'sourcing');
      const srcRaw = N.text(v[m.src]); const bk = srcRaw ? brokers.find(srcRaw) : null;
      const srcType = /^direct$/i.test(srcRaw) ? 'Direct' : /mgmt|management/i.test(srcRaw) ? 'Management' : /existing client|^ref/i.test(srcRaw) ? 'Referral' : srcRaw ? 'Channel Partner' : 'Direct';
      const leadKey = leads.upsert(nm, { source: srcType, sourceDetail: srcRaw, brokerKey: bk, brokerPerson: srcType === 'Channel Partner' ? srcRaw : '', assignedTo: sm, createdAt: when, profile: { company: N.text(v[m.profile]) } });
      if (!leadKey) continue;
      const l = leads.get(leadKey);
      if (when && (!l.createdAt || when < l.createdAt)) l.createdAt = when;
      if (when && (!l.lastContactAt || when > l.lastContactAt)) { l.lastContactAt = when; if (l.status !== 'Booked' && !(l.status === 'Negotiating' && st !== 'LOST')) l.status = LEAD_STATUS[st] || l.status || 'Qualified'; if (st === 'BOOKED' && l.status !== 'Booked') l.registerSaysBooked = true; }
      const content = N.text(v[m.rem]) || 'Meeting held (no remarks recorded)';
      const proj = N.text(v[m.proj]);
      out.interactions.push({ key: `int:${sha([leadKey, when ? when.toISOString().slice(0, 10) : r, mode, content.slice(0, 80)].join('|'))}`, leadKey, occurredAt: when, type: TYPE[mode] || 'Meeting', meetingMode: mode, direction: mode === 'OBM' ? 'Outbound' : 'Inbound', by: sm, content: proj && !/downtown/i.test(proj) ? `[${proj}] ${content}` : content, outcome: N.titleCase(v[m.status]), location: N.text(v[m.addr]), attendedBy: N.text(v[m.att]), status: N.titleCase(v[m.status]) });
      if (!when) issue('warning', mtg.name, r, 'Date of Visit', 'Meeting without a usable date — imported with no date');
    }
    issue('info', mtg.name, null, 'Contact', 'The meeting register carries no phone or email — clients are created without contact details');
  }

  // ── 6. Assigned & digital leads ─────────────────────────────────────────
  const la = sheetLike(/^lead assigned/i);
  if (la) {
    handled.add(la.name);
    const { headers, rows } = la.table({ headerRow: 1 });
    const iN = columnIndex(headers, 'client name'); const iD = columnIndex(headers, 'date'); const iS = columnIndex(headers, 'source'); const iM = columnIndex(headers, 'sales manager'); const iSm = columnIndex(headers, 'sourcing manager');
    for (const { __vals: v } of rows) {
      const nm = N.text(v[iN]); if (!nm) continue;
      const src = N.text(v[iS]); const firm = src.replace(/\(.*?\)/g, '').trim(); const person = (src.match(/\(([^)]*)\)/) || [])[1] || '';
      const bk = firm ? brokers.add({ firmName: firm, contactName: person }) : null; if (N.text(v[iSm])) team.add(v[iSm], 'sourcing');
      const k = leads.upsert(nm, { source: firm ? 'Channel Partner' : 'Direct', sourceDetail: src, brokerKey: bk, brokerPerson: person, assignedTo: team.add(v[iM], 'closing'), createdAt: N.date(v[iD]) });
      if (k && !leads.get(k).status) leads.get(k).status = 'New';
    }
  }
  const dl = sheetLike(/^digital leads/i);
  if (dl) {
    handled.add(dl.name);
    for (let r = 1; r <= dl.rowCount; r += 1) {
      const d = N.date(dl.get(r, 1)); const nm = N.text(dl.get(r, 2)); if (!d || !nm) continue;
      const k = leads.upsert(nm, { phone: N.phone(dl.get(r, 3)), source: 'Marketing', sourceDetail: 'Digital', assignedTo: team.add(dl.get(r, 4), 'closing'), createdAt: d, lostReason: N.text(dl.get(r, 6)) });
      if (k && !leads.get(k).status) leads.get(k).status = /lost/i.test(N.text(dl.get(r, 5))) ? 'Lost' : 'New';
    }
  }

  // ── 7. Cancellations → lost clients with the history kept as a note ─────
  const cx = sheetLike(/^cancelled units/i);
  if (cx) {
    handled.add(cx.name);
    const { headers, rows } = cx.table({ headerRow: 1 });
    const iN = columnIndex(headers, 'client name'); const iU = columnIndex(headers, 'unit'); const iM = columnIndex(headers, 'sm'); const iR = columnIndex(headers, 'registration date', 'remarks');
    for (const { __row: r, __vals: v } of rows) {
      const nm = N.text(v[iN]); if (!nm) continue;
      const unitNo = N.text(v[iU]).replace(/\.0$/, ''); const sm = team.add(v[iM], 'closing');
      const k = leads.upsert(nm, { source: 'Direct', assignedTo: sm, lostReason: 'Booking cancelled' }); if (!k) continue;
      const l = leads.get(k); if (l.status !== 'Booked' && l.status !== 'Negotiating') l.status = 'Lost';
      const flags = headers.map((h, i) => (h && i !== iN && i !== iU && i !== iM && N.text(v[i]) ? `${h}: ${N.text(v[i])}` : '')).filter(Boolean).join('; ');
      out.interactions.push({ key: `int:${sha(['cx', k, unitNo].join('|'))}`, leadKey: k, occurredAt: null, type: 'Note', by: sm, content: `Cancelled booking — unit ${unitNo || '(not recorded)'}. ${flags}`.trim(), outcome: 'Cancelled', status: 'Cancelled' });
    }
    issue('info', cx.name, null, 'Unit Number', 'Cancelled bookings list a unit number without a tower, so they are kept as client history (status Lost + note) rather than as cancelled sales');
  }

  // ── 8. Checklist → completed tasks; FY target ───────────────────────────
  const ck = sheetLike(/^checklist/i);
  if (ck) {
    handled.add(ck.name);
    const { headers, rows } = ck.table({ headerRow: 1 });
    const iT = columnIndex(headers, 'checklist'); const iD = columnIndex(headers, 'dates'); const iS = columnIndex(headers, 'status'); const iO = columnIndex(headers, 'ownership');
    for (const { __vals: v } of rows) { const t = N.text(v[iT]); if (!t || /^downtown$/i.test(t)) continue; out.tasks.push({ key: `task:${sha(t)}`, title: t, dueText: N.text(v[iD]), status: N.text(v[iS]), owner: N.text(v[iO]) }); }
  }
  const fyTargets = [];
  const rv = sheetLike(/^revenue/i);
  if (rv) {
    handled.add(rv.name);
    const t = rv.find(/^target/i); const a = rv.find(/^achieved/i);
    const below = (cell) => { for (let k = 1; k <= 6; k += 1) { const v = rv.get(cell.r + k, cell.c); if (typeof v === 'number') return v; } return null; };
    if (t && a) { const fy = (N.text(rv.get(t.r, t.c)).match(/(\d{4})/) || [])[1]; const tv = below(t); const avv = below(a); if (tv) fyTargets.push({ fy: fy ? `FY${fy}` : 'FY', targetCr: tv, achievedCr: avv, note: 'From the MIS revenue sheet (₹ Cr)' }); }
  }

  // ── Wrap up ─────────────────────────────────────────────────────────────
  for (const s of wb.sheets) if (!handled.has(s.name)) out.skippedSheets.push({ file: wb.fileName, sheet: s.name, reason: /start till date|challenging/i.test(s.name) ? 'Derived summary — recomputed by the platform from the imported records' : 'Not recognised by this adapter' });
  const unitsArr = [...unitByKey.values()];
  const prices = unitsArr.map((u) => u.currentPrice).filter((p) => p > 0);
  out.project = { name: ctx.projectName || '25 Downtown', type: 'apartment', status: 'under-construction', city: ctx.city || 'Mumbai', area: ctx.area || 'Mumbai', state: 'Maharashtra', priceMin: prices.length ? Math.min(...prices) : 0, priceMax: prices.length ? Math.max(...prices) : 0, fyTargets, paymentPlanTemplates: [] };
  out.towers = [...towers.values()].map((t) => ({ code: t.code, name: t.name, totalFloors: t.floors.size ? Math.max(...t.floors) : 1, unitsPerFloor: (() => { const f = {}; for (const n of t.perFloor.values()) f[n] = (f[n] || 0) + 1; const top = Object.entries(f).sort((x, y) => y[1] - x[1])[0]; return top ? Number(top[0]) : 1; })() }));
  out.units = unitsArr; out.team = team.list(); out.brokers = brokers.list();
  out.leads = leads.list().map((l) => ({ ...l, status: l.status || 'Qualified' }));
  const orphanBooked = out.leads.filter((l) => l.registerSaysBooked && l.status !== 'Booked').length;
  if (orphanBooked) issue('info', 'Client Meetings', null, 'Status', `${orphanBooked} clients are marked Booked in the meeting register but could not be matched by name to a booking — kept as Negotiating`);
  return out;
}
