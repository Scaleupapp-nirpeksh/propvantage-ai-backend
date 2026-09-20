// File: services/import/parse.js
// Description: Turns uploaded workbooks into one canonical data set: detect each
//   file's format, run its adapter, merge, then reconcile across files (combined
//   "jodi" units, prices for units no register covers). Pure apart from reading
//   the workbook buffers.

import { loadWorkbook } from './workbook.js';
import { mergeCanonicals, issueCollector } from './canonical.js';
import * as mis from './adapters/downtownMis.js';
import * as stacking from './adapters/stackingSheet.js';
import * as template from './adapters/propvantageTemplate.js';

const ADAPTERS = [mis, stacking, template];

export function detectFormat(wb) {
  let best = null; let bestScore = 0;
  for (const a of ADAPTERS) { const s = a.detect(wb); if (s > bestScore) { best = a; bestScore = s; } }
  return best;
}

const median = (arr) => { const a = arr.filter((x) => x > 0).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : 0; };

/** Cross-file clean-up after the merge. */
export function reconcile(c) {
  const issue = issueCollector(c.issues);
  // 1. A register row like "T1-4401 & 4402" already covers the grid cells T1-4401 and T1-4402.
  const covered = new Set();
  for (const u of c.units) {
    if (u.origin === 'stacking') continue;
    const m = u.key.match(/^(T\d+)-(.+)$/); if (!m || !/[&+]/.test(m[2])) continue;
    for (const part of m[2].split(/[&+]/)) { const p = part.replace(/\D/g, ''); if (p) covered.add(`${m[1]}-${p}`); }
  }
  // 1b. A register may number the same apartment differently from the grid ("5301" for the only
  //     apartment on a refuge floor, "3301 B" for the second one): match on tower + floor + area.
  const claimed = new Set(c.units.filter((u) => u.origin === 'stacking').map((u) => u.key));
  const regUnits = c.units.filter((u) => u.origin !== 'stacking');
  const regHasGridTwin = new Set(regUnits.map((u) => u.key));
  const absorbed = new Set();
  for (const g of c.units) {
    if (g.origin !== 'stacking' || covered.has(g.key)) continue;
    const twin = regUnits.find((u) => u.towerCode === g.towerCode && u.floor === g.floor && !u.gridMatched && u.key !== g.key && !claimed.has(u.key) && g.areaSqft && Math.abs(u.areaSqft - g.areaSqft) / g.areaSqft < 0.01);
    if (!twin) continue;
    twin.gridMatched = true; absorbed.add(g.key);
    for (const f of ['facing', 'heightMeters']) if (!twin[f] && g[f]) twin[f] = g[f];
    if (g.waitlist?.length && !twin.waitlist?.length) twin.waitlist = g.waitlist;
  }
  void regHasGridTwin;
  const before = c.units.length;
  c.units = c.units.filter((u) => !(u.origin === 'stacking' && (covered.has(u.key) || absorbed.has(u.key))));
  if (absorbed.size) issue('info', 'Stacking sheets', null, 'Unit', `${absorbed.size} grid cells matched register apartments numbered differently (same tower, floor and area) — merged, not duplicated`);
  if (before - c.units.length - absorbed.size > 0) issue('info', 'Stacking sheets', null, 'Unit', `${before - c.units.length - absorbed.size} grid cells are halves of combined (jodi) apartments already listed in the register — not created twice`);
  // 2. Units that only a stacking sheet knows have no rate: estimate from the register's median, and say so.
  const psfByTower = new Map(); const all = [];
  for (const u of c.units) { const p = u.pricing?.agreementPsf; if (p > 0) { all.push(p); psfByTower.set(u.towerCode, [...(psfByTower.get(u.towerCode) || []), p]); } }
  const overall = median(all); const estimated = new Map();
  for (const u of c.units) {
    if (u.currentPrice > 0 || !u.areaSqft) continue;
    const psf = median(psfByTower.get(u.towerCode) || []) || overall;
    if (!psf) continue;
    u.basePrice = Math.round(psf * u.areaSqft); u.currentPrice = u.basePrice; u.pricing = { ...(u.pricing || {}), agreementPsf: psf, estimated: true };
    u.remarks = [u.remarks, `Price estimated at the median achieved rate (₹${Math.round(psf).toLocaleString('en-IN')} psf) — no rate card supplied`].filter(Boolean).join('. ');
    estimated.set(u.towerCode, (estimated.get(u.towerCode) || 0) + 1);
  }
  for (const [t, n] of estimated) issue('warning', 'Stacking sheets', null, 'Price', `${t}: ${n} units have no rate in any file — priced at the median achieved rate until a rate card is supplied`);
  // 2b. One live booking per apartment. A register that lists an apartment twice (re-sold after a
  //     withdrawal, or entered twice) keeps its most recent booking; the earlier client stays, with a note.
  const latestFirst = [...(c.sales || [])].sort((a, b) => new Date(b.bookingDate || 0) - new Date(a.bookingDate || 0));
  const kept = new Set(); const superseded = new Set();
  for (const s of latestFirst) {
    if (!kept.has(s.unitKey)) { kept.add(s.unitKey); continue; }
    superseded.add(s.key);
    const lead = (c.leads || []).find((l) => l.key === s.leadKey);
    const stillBooked = lead && latestFirst.some((x) => x.leadKey === s.leadKey && !superseded.has(x.key));
    if (lead) { lead.notes = [lead.notes, `The register also lists this client against ${s.unitKey}; a later booking of that apartment by another client was imported instead`].filter(Boolean).join(' · '); if (!stillBooked && lead.status === 'Booked') lead.status = 'Negotiating'; }
    issue('warning', 'Sales register', null, 'Booking', `${s.unitKey} is listed twice in the register with different clients — the most recent booking was imported; the earlier client is kept with a note`);
  }
  if (superseded.size) c.sales = c.sales.filter((s) => !superseded.has(s.key));
  // 3. Project roll-ups.
  if (c.project) {
    const prices = c.units.map((u) => u.currentPrice).filter((p) => p > 0);
    c.project.priceMin = prices.length ? Math.min(...prices) : 0; c.project.priceMax = prices.length ? Math.max(...prices) : 0;
    c.project.totalUnits = c.units.length; c.project.totalArea = Math.round(c.units.reduce((a, u) => a + (u.areaSqft || 0), 0));
    c.project.targetRevenue = Math.round(c.units.reduce((a, u) => a + (u.currentPrice || 0), 0));
  }
  // 4. Towers: make sure every unit's tower exists and floor counts cover the units.
  for (const u of c.units) {
    let t = c.towers.find((x) => x.code === u.towerCode);
    if (!t) { t = { key: u.towerCode, code: u.towerCode, name: '', totalFloors: 1, unitsPerFloor: 1 }; c.towers.push(t); }
    if (u.floor > t.totalFloors) t.totalFloors = u.floor;
  }
  for (const t of c.towers) if (!t.name) t.name = `Tower ${t.code.replace(/\D/g, '') || t.code}`;
  c.towers.sort((a, b) => a.code.localeCompare(b.code));
  return c;
}

/**
 * @param {{ name: string, buffer: Buffer }[]} files
 * @returns {Promise<{ canonical, files: {name, format, sheets}[] }>}
 */
export async function parseFiles(files, ctx = {}) {
  const parts = []; const info = [];
  // Registers first so that, on merge, their richer unit rows win and grids only fill blanks.
  const loaded = [];
  for (const f of files) { const wb = await loadWorkbook(f.buffer, f.name); loaded.push({ f, wb, adapter: detectFormat(wb) }); }
  loaded.sort((a, b) => (a.adapter === stacking ? 1 : 0) - (b.adapter === stacking ? 1 : 0));
  for (const { f, wb, adapter } of loaded) {
    if (!adapter) { info.push({ name: f.name, format: 'unrecognised', sheets: wb.sheets.length }); parts.push({ ...(await import('./canonical.js')).emptyCanonical(), issues: [{ severity: 'error', sheet: f.name, row: null, field: 'format', message: 'This workbook does not match any supported layout (developer MIS, stacking sheet, or the PropVantage intake template)' }] }); continue; }
    info.push({ name: f.name, format: adapter.FORMAT, sheets: wb.sheets.length });
    parts.push(adapter.parse(wb, ctx));
  }
  return { canonical: reconcile(mergeCanonicals(parts)), files: info };
}
