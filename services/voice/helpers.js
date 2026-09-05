// File: services/voice/helpers.js
// Description: DB-free helpers shared by the voice module (kept import-light so
//   unit tests never pull in models or background services).

/** "HH:mm" in IST for now. */
export function istClock(now = new Date()) {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }).format(now);
}

/** True when the IST clock is inside [start, end). */
export function withinCallingHours(hours = {}, now = new Date()) {
  const start = hours.start || '09:00';
  const end = hours.end || '21:00';
  const cur = istClock(now);
  return cur >= start && cur < end;
}

/** Normalize an Indian mobile (or any E.164) into E.164. Returns null if not plausible. */
export function normalizePhone(raw) {
  if (!raw) return null;
  let s = String(raw).replace(/[\s\-().]/g, '');
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  if (/^\+\d{8,15}$/.test(s)) return s;
  if (/^0\d{10}$/.test(s)) return `+91${s.slice(1)}`;
  if (/^\d{10}$/.test(s)) return `+91${s}`;
  if (/^91\d{10}$/.test(s)) return `+${s}`;
  return null;
}

/** "9:05 pm" in IST. */
export function nowIst(now = new Date()) {
  return new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).format(now);
}

/** "morning" | "afternoon" | "evening" from the IST clock (evening from 5 PM, incl. night). */
export function timeOfDayIst(now = new Date()) {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }).format(now));
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}
