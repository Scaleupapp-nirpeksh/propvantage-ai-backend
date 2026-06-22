// File: utils/isoWeek.js
// Description: Shared ISO-week helper functions used by reflectionService,
//   moraleService, and generateMoraleSummaries.
//
// Single source of truth — previously copy-pasted across four files.

/**
 * Return the ISO week string 'YYYY-Www' for a given Date (or now).
 * ISO weeks start on Monday. Week 1 is the week that contains the first Thursday.
 *
 * @param {Date} [date]
 * @returns {string}  e.g. '2026-W25'
 */
export function isoWeekOf(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

  // Day of week: Mon=1 … Sun=7
  const dow = d.getUTCDay() || 7;  // getUTCDay returns 0 for Sunday; map to 7

  // Shift to the nearest Thursday (ISO week rule)
  d.setUTCDate(d.getUTCDate() + 4 - dow);

  const year = d.getUTCFullYear();

  // First Thursday of the year
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const jan1dow = jan1.getUTCDay() || 7;
  const firstThursday = new Date(Date.UTC(year, 0, 1 + (4 - jan1dow + 7) % 7));

  // Week number = (thursday - firstThursday) / 7 + 1
  const diff = d - firstThursday;
  const weekNum = Math.round(diff / (7 * 86400000)) + 1;

  return `${year}-W${String(weekNum).padStart(2, '0')}`;
}

/**
 * Return Monday 00:00:00.000 UTC for the ISO week containing `date`.
 *
 * @param {Date} [date]
 * @returns {Date}
 */
export function weekStartOf(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = d.getUTCDay() || 7;  // Mon=1 … Sun=7
  d.setUTCDate(d.getUTCDate() - (dow - 1));
  return d;  // already at 00:00:00 UTC
}

/**
 * Return Sunday 23:59:59.999 UTC for the ISO week containing `date`.
 *
 * @param {Date} [date]
 * @returns {Date}
 */
export function weekEndOf(date = new Date()) {
  const start = weekStartOf(date);
  return new Date(start.getTime() + 7 * 86400000 - 1);
}

/**
 * Derive weekStart/weekEnd from an isoWeek string 'YYYY-Www'.
 * Returns { weekStart, weekEnd }.
 *
 * @param {string} isoWeek  e.g. '2026-W25'
 * @returns {{ weekStart: Date, weekEnd: Date }}
 */
export function boundsFromIsoWeek(isoWeek) {
  // Parse year + week number
  const m = isoWeek.match(/^(\d{4})-W(\d{2})$/);
  if (!m) throw new Error(`Invalid isoWeek: ${isoWeek}`);
  const year = parseInt(m[1], 10);
  const week = parseInt(m[2], 10);

  // Jan 4 is always in week 1 (ISO rule)
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4dow = jan4.getUTCDay() || 7;
  // Monday of week 1
  const week1Mon = new Date(jan4.getTime() - (jan4dow - 1) * 86400000);

  const weekStart = new Date(week1Mon.getTime() + (week - 1) * 7 * 86400000);
  const weekEnd   = new Date(weekStart.getTime() + 7 * 86400000 - 1);
  return { weekStart, weekEnd };
}

/**
 * Return the isoWeek string for the week immediately prior to `isoWeek`.
 *
 * @param {string} isoWeek  e.g. '2026-W25'
 * @returns {string}  e.g. '2026-W24'
 */
export function previousIsoWeek(isoWeek) {
  const { weekStart } = boundsFromIsoWeek(isoWeek);
  // Subtract one day to land in the previous week
  const dayInPrevWeek = new Date(weekStart.getTime() - 86400000);
  return isoWeekOf(dayInPrevWeek);
}
