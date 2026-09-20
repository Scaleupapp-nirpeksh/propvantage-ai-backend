// File: services/import/normalize.js
// Description: Pure value normalizers shared by every import adapter — money,
//   phones, dates, names, yes/no flags, percentages, keys. No I/O.

const EMPTY = new Set(['', '-', '--', 'na', 'n/a', 'null', 'none', 'nil', '#ref!', '#n/a', '#value!']);

/** Collapse whitespace; return '' for empty-ish values. */
export function text(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  const s = String(v).replace(/\s+/g, ' ').trim();
  return EMPTY.has(s.toLowerCase()) ? '' : s;
}

export function isBlank(v) { return text(v) === ''; }

/** Number from Excel numerics or strings like "₹1.92 Cr", "85 Lakhs", "19,20,00,000", "5 %". */
export function num(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = text(v).toLowerCase();
  if (!s) return null;
  s = s.replace(/[₹,\s]|rs\.?|inr/g, '');
  let mult = 1;
  if (/(cr|crore|crores)$/.test(s)) { mult = 1e7; s = s.replace(/(crores|crore|cr)$/, ''); }
  else if (/(l|lac|lacs|lakh|lakhs)$/.test(s)) { mult = 1e5; s = s.replace(/(lakhs|lakh|lacs|lac|l)$/, ''); }
  else if (/k$/.test(s)) { mult = 1e3; s = s.replace(/k$/, ''); }
  s = s.replace(/%$/, '');
  const n = Number(s);
  return Number.isFinite(n) ? n * mult : null;
}

/** Percentage as a number 0–100 from "5 %", 0.05, 5, "2%". Values ≤ 1 are treated as fractions. */
export function percent(v) {
  const n = num(v);
  if (n === null) return null;
  if (n > 0 && n <= 1) return Math.round(n * 10000) / 100;
  return n;
}

/** E.164-ish phone. Excel often stores mobiles as floats (9819808947.0). Returns '' when implausible. */
export function phone(v) {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'number' ? String(Math.round(v)) : text(v);
  if (!s) return '';
  s = s.split(/[\/,;]| or /i)[0];
  const plus = s.trim().startsWith('+');
  let d = s.replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (!plus && d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10 && /^[6-9]/.test(d)) return `+91${d}`;
  if (d.length === 12 && d.startsWith('91')) return `+${d}`;
  if (plus && d.length >= 8 && d.length <= 15) return `+${d}`;
  if (d.length >= 8 && d.length <= 15) return d; // landline / foreign without +; keep digits
  return '';
}

/** Date from a Date, an Excel serial, "DD-MM-YYYY", "DD/MM/YYYY", "DD-MM-YYYY HH:MM", or ISO. Null when unparseable. */
export function date(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number') {
    if (v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400 * 1000));
    return null;
  }
  const s = text(v);
  if (!s) return null;
  let m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (m) {
    let [, d, mo, y, hh, mi] = m;
    y = Number(y); if (y < 100) y += 2000;
    const dt = new Date(Date.UTC(y, Number(mo) - 1, Number(d), Number(hh || 0) - 5, Number(mi || 0) - 30)); // IST → UTC
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/** "Y" | "N" | "NA" | '' from assorted yes/no spellings. */
export function yn(v) {
  const s = text(v).toLowerCase();
  if (!s) return '';
  if (['y', 'yes', 'true', '1', 'done', 'received'].includes(s)) return 'Y';
  if (['n', 'no', 'false', '0', 'pending'].includes(s)) return 'N';
  if (['na', 'n.a.', 'not applicable'].includes(s)) return 'NA';
  return text(v);
}

export function bool(v) { return yn(v) === 'Y'; }

const TITLES = /^(mr|mrs|ms|miss|dr|shri|smt|m\/s|messrs)\.?\s+/i;
const COMPANY = /\b(llp|ltd|pvt|limited|advisors|trust|huf|ventures|capital|enterprises|industries|holdings|realty|realtors|associates|corporation|corp|inc|co\.?|company|jewellers|jewels|exports|impex|sales)\b/i;

/**
 * Split a client string into a person/company name plus any bracketed or slash-separated notes.
 * "Shweta Choksi (Vishal Shah ref)" → { first:'Shweta', last:'Choksi', note:'Vishal Shah ref' }
 */
export function personName(v) {
  let s = text(v);
  if (!s) return { full: '', first: '', last: '', note: '', isCompany: false };
  const notes = [];
  s = s.replace(/\(([^)]*)\)/g, (_, inner) => { if (inner.trim()) notes.push(inner.trim()); return ' '; }).replace(/\s+/g, ' ').trim();
  if (s.includes('/')) { const parts = s.split('/').map((p) => p.trim()).filter(Boolean); s = parts.shift() || ''; notes.push(...parts); }
  s = s.replace(TITLES, '').replace(TITLES, '').trim();
  const isCompany = COMPANY.test(s);
  if (isCompany) return { full: s, first: s, last: '', note: notes.join('; '), isCompany };
  const bits = s.split(' ').filter(Boolean);
  const first = bits.shift() || '';
  return { full: s, first, last: bits.join(' '), note: notes.join('; '), isCompany };
}

/** Stable key for matching the same person/firm across sheets. */
export function nameKey(v) {
  const p = typeof v === 'string' ? personName(v) : v;
  return (p.full || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

export function firmKey(v) {
  return text(v).toLowerCase().replace(/\b(realtors?|realty|properties|property|consultants?|advisors?|pvt|ltd|llp|and|&)\b/g, '').replace(/[^a-z0-9]/g, '').trim();
}

/** "T1" + 4902 → "T1-4902"; keeps suffixes ("1501 B") and combined units ("4401 & 4402"). */
export function unitKey(towerCode, unitNo) {
  let u = typeof unitNo === 'number' ? String(Math.round(unitNo)) : text(unitNo).replace(/\.0$/, '');
  u = u.replace(/\s+/g, ' ').trim();
  const t = text(towerCode).toUpperCase().replace(/\s+/g, '');
  return t ? `${t}-${u}` : u;
}

/** Mask an Aadhaar-like value to its last four digits. Never returns the full number. */
export function aadhaarLast4(v) {
  const d = (typeof v === 'number' ? String(Math.round(v)) : text(v)).replace(/\D/g, '');
  return d.length >= 4 ? d.slice(-4) : '';
}

export function pan(v) {
  const s = text(v).toUpperCase().replace(/\s/g, '');
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(s) ? s : '';
}

export function email(v) {
  const s = text(v).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : '';
}

/** "meera" → "Meera"; keeps multi-word names. */
export function titleCase(v) {
  return text(v).toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

export function slug(v) {
  return text(v).toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '');
}
