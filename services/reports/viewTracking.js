// File: services/reports/viewTracking.js
// Pure helpers for public report view tracking. No I/O.

/**
 * Classify a viewer email against the report's intended recipient list.
 * Matching is case-insensitive. An empty/absent recipient list means we can't
 * attribute the view to a known stakeholder → treated as forwarded.
 * @returns {{ matchedRecipient: boolean, isForwarded: boolean }}
 */
export const classifyViewer = (email, recipientEmails) => {
  const set = new Set((recipientEmails || []).map((e) => String(e).toLowerCase().trim()));
  const matched = set.has(String(email || '').toLowerCase().trim());
  return { matchedRecipient: matched, isForwarded: !matched };
};

/**
 * Roll up ReportView documents into the instance's denormalized stats block.
 * @param {Array} views - ReportView-like objects
 * @returns {{ uniqueViewers, totalViews, recipientsOpened, forwardedOpens, firstOpenAt, lastOpenAt }}
 */
export const computeInstanceStats = (views = []) => {
  if (!views.length) {
    return { uniqueViewers: 0, totalViews: 0, recipientsOpened: 0, forwardedOpens: 0, firstOpenAt: null, lastOpenAt: null };
  }
  let totalViews = 0, recipientsOpened = 0, forwardedOpens = 0;
  let firstOpenAt = null, lastOpenAt = null;
  for (const v of views) {
    totalViews += v.viewCount || 0;
    if (v.matchedRecipient) recipientsOpened += 1;
    if (v.isForwarded) forwardedOpens += 1;
    if (v.firstViewedAt && (!firstOpenAt || v.firstViewedAt < firstOpenAt)) firstOpenAt = v.firstViewedAt;
    if (v.lastViewedAt && (!lastOpenAt || v.lastViewedAt > lastOpenAt)) lastOpenAt = v.lastViewedAt;
  }
  return { uniqueViewers: views.length, totalViews, recipientsOpened, forwardedOpens, firstOpenAt, lastOpenAt };
};
