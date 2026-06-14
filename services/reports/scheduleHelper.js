// File: services/reports/scheduleHelper.js
// Pure scheduling math for report templates. No I/O, no Date.now (caller passes `from`).

const parseTime = (time) => {
  const [h, m] = String(time || '09:00').split(':').map((n) => parseInt(n, 10));
  return { h: Number.isFinite(h) ? h : 9, m: Number.isFinite(m) ? m : 0 };
};

/**
 * Compute the next run timestamp for a schedule, strictly after `from`.
 * @param {{ frequency, dayOfWeek?, dayOfMonth?, time? }} schedule
 * @param {Date} from
 * @returns {Date|null}
 */
export const computeNextRunAt = (schedule = {}, from = new Date(0)) => {
  const { frequency } = schedule;
  const { h, m } = parseTime(schedule.time);

  if (frequency === 'weekly') {
    const target = ((schedule.dayOfWeek ?? 1) % 7 + 7) % 7;
    const next = new Date(from.getFullYear(), from.getMonth(), from.getDate(), h, m, 0, 0);
    let delta = (target - next.getDay() + 7) % 7;
    if (delta === 0 && next <= from) delta = 7;
    next.setDate(next.getDate() + delta);
    return next;
  }

  if (frequency === 'monthly') {
    const day = Math.min(Math.max(schedule.dayOfMonth ?? 1, 1), 28);
    let next = new Date(from.getFullYear(), from.getMonth(), day, h, m, 0, 0);
    if (next <= from) next = new Date(from.getFullYear(), from.getMonth() + 1, day, h, m, 0, 0);
    return next;
  }

  if (frequency === 'quarterly') {
    const q = Math.floor(from.getMonth() / 3);     // 0..3
    let startMonth = (q + 1) * 3;                   // first month of next quarter
    let year = from.getFullYear();
    if (startMonth > 11) { startMonth = 0; year += 1; }
    return new Date(year, startMonth, 1, h, m, 0, 0);
  }

  return null;
};
