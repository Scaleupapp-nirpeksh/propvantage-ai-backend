// File: services/import/adapters/stackingSheet.js
// Description: Adapter for a tower "stacking sheet" — a floor × unit grid where each
//   cell is an apartment's area and the fill colour marks its state. Adds what a
//   flat register lacks (facing, configuration, height, waitlist) and is the only
//   source for a tower that has no register rows. Also reads the payment-plan
//   templates, launch-pitch client list and broker list kept in the same workbook.
//   Pure: workbook in, canonical out.

import { emptyCanonical, issueCollector, TeamRegistry, BrokerRegistry, LeadRegistry, sha } from '../canonical.js';
import { columnIndex } from '../workbook.js';
import * as N from '../normalize.js';

export const FORMAT = 'stacking_sheet';

const GREEN = 'FF00FF00'; const YELLOW = 'FFFFFF00';

export function detect(wb) {
  return wb.sheets.some((s) => /stacking/i.test(s.name) && s.find(/^floor from g/i)) ? 3 : 0;
}

function parseGrid(sheet, out, issue) {
  const towerCell = sheet.find(/^tower\s*\d+$/i, { maxRow: 8, maxCol: 8 });
  const floorCell = sheet.find(/^floor from g/i);
  if (!towerCell || !floorCell) return null;
  const code = `T${N.text(sheet.get(towerCell.r, towerCell.c)).replace(/\D/g, '')}`;
  const unitCells = sheet.findAll(/^(unit\s*\d+|1 unit\s*\/\s*floor)$/i);
  if (!unitCells.length) { issue('error', sheet.name, null, 'UNIT', `${code}: could not find the unit columns`); return null; }
  const hmCell = sheet.find(/^height in meter/i);
  const clientCells = sheet.findAll(/^client name$/i).filter((c) => c.r === floorCell.r).sort((a, b) => a.c - b.c);
  const waitCell = sheet.findAll(/^waitlist$/i).find((c) => c.r === floorCell.r);
  const cols = unitCells.sort((a, b) => a.c - b.c).map((u, i) => ({
    col: u.c, n: i + 1,
    facing: N.titleCase(sheet.get(u.r - 1, u.c)),
    config: N.text(sheet.get(u.r + 2, u.c)) || N.text(sheet.get(u.r + 1, u.c)),
    clientCol: clientCells.length > 1 ? (i === 0 ? clientCells[0].c : clientCells[clientCells.length - 1].c) : (clientCells[0]?.c || null),
  }));
  const FACINGS = ['North', 'South', 'East', 'West', 'North-East', 'North-West', 'South-East', 'South-West'];
  const floors = new Set(); const units = [];
  for (let r = floorCell.r + 1; r <= sheet.rowCount; r += 1) {
    const fl = sheet.get(r, floorCell.c);
    if (typeof fl !== 'number') continue;
    for (const uc of cols) {
      const v = sheet.get(r, uc.col);
      if (typeof v !== 'number' || v < 500) continue;
      const floor = Math.round(fl); floors.add(floor);
      const key = N.unitKey(code, `${floor}${String(uc.n).padStart(2, '0')}`);
      const fill = sheet.fill(r, uc.col);
      const wait = waitCell ? N.text(sheet.get(r, waitCell.c)) : '';
      const holder = uc.clientCol ? N.text(sheet.get(r, uc.clientCol)) : '';
      units.push({
        key, origin: 'stacking', towerCode: code, unitNumber: key, floor, type: uc.config || 'Apartment', typology: (uc.config.match(/\d+/) || [''])[0], bedrooms: Number((uc.config.match(/\d+/) || [0])[0]) || null,
        areaSqft: v, facing: FACINGS.includes(uc.facing) ? uc.facing : '', heightMeters: hmCell ? N.num(sheet.get(r, hmCell.c)) : null,
        status: fill === GREEN || fill === YELLOW ? 'blocked' : 'available',
        remarks: fill === GREEN ? `Marked "cheque received" on the stacking sheet${holder ? ` (${N.personName(holder).full})` : ''}` : fill === YELLOW ? 'Marked "clarity awaited" on the stacking sheet' : '',
        waitlist: wait ? [{ name: wait, note: 'Waitlisted for this floor' }] : [], areaBreakdown: {}, parkingSplit: {}, pricing: {},
      });
    }
  }
  if (!units.length) return null;
  out.towers.push({ code, name: `Tower ${code.slice(1)}`, totalFloors: Math.max(...floors), unitsPerFloor: cols.length });
  out.units.push(...units);
  return code;
}

function parsePlan(sheet, label) {
  const installments = [];
  for (let r = 1; r <= Math.min(sheet.rowCount, 60); r += 1) {
    const d = N.text(sheet.get(r, 1)); const p = sheet.get(r, 2);
    if (!/^payable/i.test(d) || typeof p !== 'number') continue;
    const pct = Math.round((p <= 1 ? p * 100 : p) * 100) / 100;
    installments.push({ installmentNumber: installments.length + 1, description: d, percentage: pct, milestoneType: /booking/i.test(d) ? 'booking' : /possession|oc\b/i.test(d) ? 'possession' : /agreement/i.test(d) ? 'custom' : 'construction' });
  }
  const sum = Math.round(installments.reduce((a, b) => a + b.percentage, 0) * 100) / 100;
  if (installments.length && Math.abs(sum - 100) > 0.01) installments[installments.length - 1].percentage = Math.round((installments[installments.length - 1].percentage + (100 - sum)) * 100) / 100;
  return installments.length ? { name: label, planType: 'construction_linked', installments } : null;
}

export function parse(wb, ctx = {}) {
  const out = emptyCanonical(); out.formats.push(FORMAT);
  const issue = issueCollector(out.issues);
  const team = new TeamRegistry(); const brokers = new BrokerRegistry(); const leads = new LeadRegistry();
  const handled = new Set(); const templates = [];

  const grid = wb.sheets.find((s) => /updated stacking/i.test(s.name)) || wb.sheets.find((s) => /stacking/i.test(s.name) && !s.hidden) || wb.sheets.find((s) => /stacking/i.test(s.name));
  if (grid) { handled.add(grid.name); if (!parseGrid(grid, out, issue)) issue('error', grid.name, null, 'grid', 'Could not read the stacking grid (tower / floor / unit headers not found)'); }

  for (const s of wb.sheets) {
    const n = s.name.trim().toLowerCase();
    if (n === 'clp') { handled.add(s.name); const t = parsePlan(s, 'Construction-linked plan (CLP)'); if (t) templates.push(t); }
    else if (n === 'payment plan') { handled.add(s.name); const t = parsePlan(s, 'Standard 10:10:80 milestone plan'); if (t) templates.push(t); }
    else if (/^broker working/.test(n)) {
      handled.add(s.name);
      for (let r = 3; r <= s.rowCount; r += 1) { const nm = N.text(s.get(r, 2)); if (nm) brokers.add({ firmName: nm, visits: N.num(s.get(r, 4)) || 0 }); }
    } else if (/^client met/.test(n)) {
      handled.add(s.name);
      const { headers, rows } = s.table({ headerRow: 2 });
      const H = (...x) => columnIndex(headers, ...x);
      const c = { date: H('date'), name: H('client name'), phone: H('phone'), floor: H('floor preference'), rate: H('rate closed'), rem: H('remarks'), email: H('email id'), broker: H('broker name'), desig: H('designation'), comp: H('company'), met: H('met / pitched', 'met') };
      for (const { __row: r, __vals: v } of rows) {
        const nm = N.text(v[c.name]); if (!nm) continue;
        const when = N.date(v[c.date]); const br = N.text(v[c.broker]);
        const bk = br ? brokers.add({ firmName: br }) : null;
        const k = leads.upsert(nm, { phone: N.phone(v[c.phone]), email: N.email(v[c.email]), source: br ? 'Channel Partner' : 'Direct', sourceDetail: br, brokerKey: bk, brokerPerson: br, createdAt: when, profile: { company: [N.text(v[c.desig]), N.text(v[c.comp])].filter(Boolean).join(', ') }, status: 'Qualified' });
        if (!k) continue;
        const bits = [N.text(v[c.met]) || 'Pitched', N.text(v[c.floor]) && `floor preference: ${N.text(v[c.floor])}`, N.text(v[c.rate]) && `rate discussed: ${N.text(v[c.rate])}`, typeof v[c.rem] === 'string' ? N.text(v[c.rem]) : ''].filter(Boolean);
        out.interactions.push({ key: `int:${sha(['pitch', k, when ? when.toISOString().slice(0, 10) : r].join('|'))}`, leadKey: k, occurredAt: when, type: 'Meeting', meetingMode: 'LAUNCH', by: null, content: `Launch pitch — ${bits.join('; ')}`, outcome: N.text(v[c.met]) || 'Pitched', status: N.text(v[c.met]) || 'Pitched' });
      }
    }
  }
  for (const s of wb.sheets) if (!handled.has(s.name)) out.skippedSheets.push({ file: wb.fileName, sheet: s.name, reason: /chq|cheque/i.test(s.name) ? 'Cheque log without amounts linked to bookings — load through a receipts sheet instead' : /ready reck/i.test(s.name) ? 'Government ready-reckoner rates — reference only' : /bank details/i.test(s.name) ? 'Bank account details — configure in project payment settings' : s.hidden ? 'Older working copy of data already covered' : 'Not recognised by this adapter' });

  out.project = { name: ctx.projectName || '25 Downtown', type: 'apartment', status: 'under-construction', city: ctx.city || 'Mumbai', area: ctx.area || 'Mumbai', state: 'Maharashtra', fyTargets: [], paymentPlanTemplates: templates };
  out.team = team.list(); out.brokers = brokers.list(); out.leads = leads.list();
  return out;
}
