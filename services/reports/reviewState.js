// File: services/reports/reviewState.js
// Pure review state machine + override transform. No I/O.

// Legal transitions: current status → { action: nextStatus }
const TRANSITIONS = {
  draft: { submit: 'in_review' },
  in_review: { approve: 'approved', request_changes: 'changes_requested' },
  changes_requested: { submit: 'in_review' },
  approved: {}, // terminal w.r.t. these actions
};

/** Return the next review status for an action, or null if the transition is illegal. */
export const nextReviewStatus = (current, action) => TRANSITIONS[current]?.[action] ?? null;

// Set a dotted path on a deep-cloned object (block data is JSON-safe).
const setPath = (obj, path, value) => {
  const clone = JSON.parse(JSON.stringify(obj));
  const keys = String(path).split('.');
  let cur = clone;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] == null || typeof cur[keys[i]] !== 'object') cur[keys[i]] = {};
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
  return clone;
};

/**
 * Apply review overrides to snapshot blocks. Pure — returns a new array (or the
 * same reference if there are no overrides). Each override = { blockId, fieldPath, newValue }.
 */
export const applyOverrides = (blocks = [], overrides = []) => {
  if (!overrides || overrides.length === 0) return blocks;
  const byBlock = new Map();
  for (const o of overrides) {
    if (!byBlock.has(o.blockId)) byBlock.set(o.blockId, []);
    byBlock.get(o.blockId).push(o);
  }
  return blocks.map((b) => {
    const ovs = byBlock.get(b.id);
    if (!ovs) return b;
    let nb = b;
    for (const o of ovs) nb = setPath(nb, o.fieldPath, o.newValue);
    return nb;
  });
};
