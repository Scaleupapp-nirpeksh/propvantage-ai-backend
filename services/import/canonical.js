// File: services/import/canonical.js
// Description: The adapter-neutral shape every import format is converted to,
//   plus helpers to build it (registries that merge the same person / firm /
//   team member seen across several sheets) and to merge several files into one.

import crypto from 'crypto';
import { text, nameKey, firmKey, personName, titleCase } from './normalize.js';

export function emptyCanonical() {
  return {
    formats: [],
    project: null,          // { name, type, status, city, area, state, fyTargets[], paymentPlanTemplates[] }
    towers: [],             // { code, name, totalFloors, unitsPerFloor }
    units: [],              // keyed by key = "T1-4902"
    team: [],               // { key, name, functions[] }
    brokers: [],            // { key, firmName, contactName, phone, ratePct, visits }
    leads: [],              // { key, ... }
    interactions: [],
    sales: [],
    holds: [],
    tasks: [],
    issues: [],
    unmappedColumns: [],
    skippedSheets: [],
  };
}

export const sha = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 16);

/** Collects issues with a cap per (sheet, message) so a systemic problem doesn't flood the report. */
export function issueCollector(target) {
  const seen = new Map();
  return (severity, sheet, row, field, message) => {
    // Group by the message with unit keys / numbers removed, so one systemic problem is listed a few times, not hundreds.
    const k = `${sheet}|${field}|${String(message).replace(/\bT\d+-[^\s:,]+( & \d+)?/g, '#').replace(/\d[\d,.-]*/g, '#')}`;
    const n = (seen.get(k) || 0) + 1; seen.set(k, n);
    if (n <= 5) target.push({ severity, sheet, row, field, message });
    else if (n === 6) target.push({ severity, sheet, row: null, field, message: `${message} (further occurrences not listed)` });
  };
}

/** People on the developer's team, merged across sheets by first name ("Meera", "Meera / Kabir", "Meera Shah"). */
export class TeamRegistry {
  constructor() { this.map = new Map(); }
  static ALIASES = { mgmt: null, management: null, '-': null };
  add(raw, fn) {
    const out = [];
    for (const part of text(raw).split(/[\/&,]| and /i)) {
      let name = titleCase(part.replace(/\(.*?\)/g, ' '));
      if (!name || name.length < 3) continue;
      let alias = name.split(' ')[0].toLowerCase();
      if (alias in TeamRegistry.ALIASES) { if (TeamRegistry.ALIASES[alias] === null) continue; alias = TeamRegistry.ALIASES[alias]; name = titleCase(alias); }
      if (!/^[a-z]+$/.test(alias)) continue;
      const cur = this.map.get(alias) || { key: alias, name, functions: new Set(), mentions: 0 };
      if (name.split(' ').length > cur.name.split(' ').length) cur.name = name; // keep the fullest form seen
      if (fn) cur.functions.add(fn);
      cur.mentions += 1;
      this.map.set(alias, cur); out.push(alias);
    }
    return out[0] || null; // primary person
  }
  /**
   * People worth creating as users: named often enough to be real team members, with
   * misspellings of the same person folded together ("Rukimini" → "Rukmini").
   */
  list({ minClosing = 3, minOther = 10 } = {}) {
    const NOT_PEOPLE = /^(existing|exisiting|direct|attended|client|ref|referral|self|walk|na|nil|team|sales|crm)$/;
    const lev = (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j += 1) d[0][j] = j; for (let i = 1; i <= a.length; i += 1) for (let j = 1; j <= b.length; j += 1) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };
    const people = [...this.map.values()].filter((t) => !NOT_PEOPLE.test(t.key) && t.key.length >= 4).sort((a, b) => b.mentions - a.mentions);
    const kept = [];
    for (const p of people) {
      const squashed = p.name.toLowerCase().replace(/[^a-z]/g, '');
      const twin = kept.find((k) => { const ks = k.name.toLowerCase().replace(/[^a-z]/g, ''); return (k.key.length >= 5 && lev(k.key, p.key) <= 2) || lev(ks, squashed) <= 2 || ks.startsWith(squashed) || squashed.startsWith(k.key); });
      if (twin) { twin.mentions += p.mentions; p.functions.forEach((f) => twin.functions.add(f)); twin.aliases.push(p.key); if (p.name.split(' ').length > twin.name.split(' ').length && lev(twin.key, p.key) <= 2) twin.name = p.name; continue; }
      kept.push({ ...p, functions: new Set(p.functions), aliases: [p.key] });
    }
    return kept.filter((t) => (t.functions.has('closing') ? t.mentions >= minClosing : t.mentions >= minOther)).map((t) => ({ ...t, functions: [...t.functions] }));
  }
}

export class BrokerRegistry {
  constructor() { this.map = new Map(); }
  add({ firmName, contactName, phone, ratePct, visits }) {
    const firm = text(firmName); const person = text(contactName);
    const label = firm || person; if (!label) return null;
    const key = firmKey(label) || nameKey(label); if (!key) return null;
    const cur = this.map.get(key) || { key, firmName: label, contacts: new Map(), phone: '', ratePct: null, visits: 0, deals: 0 };
    if (person) cur.contacts.set(nameKey(person), person);
    if (phone && !cur.phone) cur.phone = phone;
    if (ratePct != null && cur.ratePct == null) cur.ratePct = ratePct;
    if (visits) cur.visits += visits;
    this.map.set(key, cur); return key;
  }
  bump(key) { const b = this.map.get(key); if (b) b.deals += 1; }
  find(label) { const k = firmKey(label) || nameKey(label); return this.map.has(k) ? k : null; }
  list() { return [...this.map.values()].map((b) => ({ ...b, contactName: [...b.contacts.values()][0] || '', contacts: [...b.contacts.values()] })); }
}

/** Clients, merged across sheets by normalized name. Earlier (richer) records win; blanks are filled from later ones. */
export class LeadRegistry {
  constructor() { this.map = new Map(); }
  upsert(rawName, attrs = {}) {
    const p = typeof rawName === 'string' ? personName(rawName) : rawName;
    const key = nameKey(p); if (!key) return null;
    const cur = this.map.get(key);
    if (!cur) {
      this.map.set(key, { key, firstName: p.first, lastName: p.last, nameNote: p.note, isCompany: p.isCompany, ...attrs });
      return key;
    }
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === '') continue;
      if (cur[k] === undefined || cur[k] === null || cur[k] === '') cur[k] = v;
    }
    return key;
  }
  get(key) { return this.map.get(key); }
  list() { return [...this.map.values()]; }
}

/** Merge several parsed files into one canonical set (units / leads / brokers / team are keyed, so they de-duplicate). */
export function mergeCanonicals(parts) {
  const out = emptyCanonical();
  const byKey = (arr, item, merge) => {
    const i = arr.findIndex((x) => x.key === item.key);
    if (i === -1) arr.push(item); else arr[i] = merge ? merge(arr[i], item) : arr[i];
  };
  const fillBlanks = (a, b) => { for (const [k, v] of Object.entries(b)) { if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue; if (a[k] === undefined || a[k] === null || a[k] === '' || (Array.isArray(a[k]) && !a[k].length)) a[k] = v; } return a; };
  for (const p of parts) {
    out.formats.push(...p.formats);
    if (p.project) out.project = out.project ? { ...p.project, ...out.project, fyTargets: [...(out.project.fyTargets || []), ...(p.project.fyTargets || [])], paymentPlanTemplates: [...(out.project.paymentPlanTemplates || []), ...(p.project.paymentPlanTemplates || [])] } : p.project;
    for (const t of p.towers) byKey(out.towers, { ...t, key: t.code }, fillBlanks);
    for (const u of p.units) byKey(out.units, u, fillBlanks);
    for (const t of p.team) byKey(out.team, t, (a, b) => ({ ...a, name: b.name.length > a.name.length ? b.name : a.name, functions: [...new Set([...a.functions, ...b.functions])], mentions: (a.mentions || 0) + (b.mentions || 0) }));
    for (const b of p.brokers) byKey(out.brokers, b, fillBlanks);
    for (const l of p.leads) byKey(out.leads, l, fillBlanks);
    for (const x of p.interactions) byKey(out.interactions, x);
    for (const s of p.sales) byKey(out.sales, s);
    for (const h of p.holds) byKey(out.holds, { ...h, key: h.unitKey });
    for (const t of p.tasks) byKey(out.tasks, t);
    out.issues.push(...p.issues); out.unmappedColumns.push(...p.unmappedColumns); out.skippedSheets.push(...p.skippedSheets);
  }
  out.formats = [...new Set(out.formats)];
  return out;
}
