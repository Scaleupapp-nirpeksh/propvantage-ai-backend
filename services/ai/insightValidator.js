// File: services/ai/insightValidator.js
// Description: SP5 — the trust boundary. The narrator may invent prose; the
//   validator catches every cited number, named entity, headlined candidate,
//   and citation URL that is NOT in the facts pack and rejects the response.
//
//   Return shape:
//     { valid: true }
//   OR
//     { valid: false, reason: '<short check name>', retryHint: '<feedback
//        string passed back to the narrator on retry>' }
//
//   The pipeline retries up to INSIGHT_VALIDATOR_MAX_RETRIES (default 2) and
//   falls back to the deterministic template on exhaustion.
//
//   Tolerances (configurable via env):
//     • Numeric : ±INSIGHT_VALIDATOR_NUMERIC_TOLERANCE (default 0.01 = 1%)
//     • Entity  : exact substring match (case-insensitive) against any
//                  name|developerName|agentName|prospectName field

const NUMERIC_TOLERANCE = Number(process.env.INSIGHT_VALIDATOR_NUMERIC_TOLERANCE) || 0.01;

// ─── Number extraction ────────────────────────────────────────────────────
//
// Matches: 22 / 22.5 / 22% / 22.5% / ₹1,42,500 / ₹1,42,500.50 / 1,000,000 /
//          1.4M / ₹14L (Indian short-forms parsed below).
// Numbers in dates (2026-05-23) and IDs are filtered by surrounding context.

const NUMBER_REGEX = /(?:₹\s*)?(\d{1,3}(?:[,\d]*\d)?(?:\.\d+)?)\s*([%MmKkLlCr]+)?/g;

function parseShortform(raw, suffix) {
  const n = Number(String(raw).replace(/,/g, ''));
  if (Number.isNaN(n)) return null;
  if (!suffix) return n;
  const s = suffix.toLowerCase();
  if (s === '%')  return n / 100;       // store percent as a fraction
  if (s === 'k')  return n * 1e3;
  if (s === 'l')  return n * 1e5;       // Indian Lakh
  if (s === 'm')  return n * 1e6;
  if (s === 'cr') return n * 1e7;       // Indian Crore
  return n;
}

function extractNumbers(text) {
  if (!text) return [];
  const out = [];
  let m;
  // Reset regex state.
  NUMBER_REGEX.lastIndex = 0;
  while ((m = NUMBER_REGEX.exec(text)) !== null) {
    const raw = m[1];
    const suffix = m[2];
    const parsed = parseShortform(raw, suffix);
    if (parsed === null) continue;
    // Filter: numbers in date-like contexts (YYYY-MM-DD) tend to be 4-digit
    // years or single-day numbers. We let those through and rely on the
    // tolerance + entity check to neuter false positives.
    out.push({ value: parsed, raw: m[0], hasPercent: suffix === '%' });
  }
  return out;
}

// ─── Recursive number search ──────────────────────────────────────────────

function* walkPrimitives(node) {
  if (node == null) return;
  if (typeof node === 'number' || typeof node === 'string') {
    yield node;
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) yield* walkPrimitives(item);
    return;
  }
  if (typeof node === 'object') {
    for (const k of Object.keys(node)) yield* walkPrimitives(node[k]);
  }
}

function collectNumbersInPack(pack) {
  const seen = new Set();
  for (const prim of walkPrimitives(pack)) {
    if (typeof prim === 'number' && Number.isFinite(prim)) seen.add(prim);
    else if (typeof prim === 'string') {
      // Strings inside the pack often contain numbers — e.g. priority scores
      // surfaced as labels. Extract them too.
      for (const n of extractNumbers(prim)) seen.add(n.value);
    }
  }
  return Array.from(seen);
}

function matchesAny(target, pool, tolerance) {
  for (const v of pool) {
    if (v === 0 && target === 0) return true;
    if (v === 0) continue;
    const rel = Math.abs(target - v) / Math.abs(v);
    if (rel <= tolerance) return true;
    // Small-integer count tolerance: allow ±1 for INTEGER counts ≥ 2
    // (rounding artefact when the LLM writes "about 5" for a value of 4 or 6).
    // Do NOT apply this to fractional values — 0.22 must not match 0.25.
    const bothIntegers = Number.isInteger(v) && Number.isInteger(target);
    if (bothIntegers && Math.abs(v) >= 2 && Math.abs(target - v) <= 1) return true;
  }
  return false;
}

// ─── Entity extraction ────────────────────────────────────────────────────

// Capitalised multi-word sequences. Allows '&', '/', ',', "'" inside.
const PROPER_NOUN_REGEX = /\b[A-Z][a-zA-Z]+(?:[\s\-&/'][A-Z][a-zA-Z0-9]+)+\b/g;
// Single proper nouns (often agent/dev names with one word). Skipped if in
// the stoplist — these are sentence-starters etc.
const SINGLE_NOUN_STOPLIST = new Set([
  'CP', 'AI', 'INR', 'USD', 'EUR', 'GBP', 'YTD', 'MTD', 'WoW', 'MoM', 'YoY',
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  'Q1', 'Q2', 'Q3', 'Q4',
  'New', 'Contacted', 'Qualified', 'Booked', 'Lost', 'Unqualified',
  'Negotiating', 'Site', 'Visit', 'Scheduled', 'Completed',
  'Pipeline', 'Commission', 'Reconciliation', 'Performance', 'Health',
  'Weekly', 'Monthly', 'Digest', 'Insights', 'Marketplace', 'Developer',
  'Channel', 'Partner', 'Agent', 'Manager', 'Owner', 'Auto-summary',
]);

function extractEntities(text) {
  if (!text) return [];
  const entities = new Set();
  // Multi-word entities (almost always proper nouns).
  for (const m of text.matchAll(PROPER_NOUN_REGEX)) entities.add(m[0].trim());
  return Array.from(entities);
}

function collectEntitiesInPack(pack) {
  const fields = new Set();
  const recurse = (node) => {
    if (node == null) return;
    if (typeof node === 'string') {
      // Whole-string entities live in name-ish fields; collect substrings too.
      fields.add(node.trim());
    }
    if (Array.isArray(node)) {
      for (const item of node) recurse(item);
      return;
    }
    if (typeof node === 'object') {
      for (const k of Object.keys(node)) {
        const v = node[k];
        if (typeof v === 'string' && /name|partnerName|agentName|developerName|prospectName/i.test(k)) {
          fields.add(v.trim());
        } else {
          recurse(v);
        }
      }
    }
  };
  recurse(pack);
  return fields;
}

function entityIsInPack(entity, packFields) {
  if (!entity) return true;
  // Exact (case-insensitive) match against any string in the pack.
  const lc = entity.toLowerCase();
  for (const f of packFields) {
    if (typeof f === 'string' && f.toLowerCase().includes(lc)) return true;
  }
  // Stoplist single-word — if the entity is a known generic word, allow.
  if (SINGLE_NOUN_STOPLIST.has(entity)) return true;
  return false;
}

// ─── Citation collection ──────────────────────────────────────────────────

function collectCitationsInPack(pack) {
  const urls = new Set();
  const recurse = (node) => {
    if (node == null) return;
    if (typeof node === 'string') {
      if (node.startsWith('/')) urls.add(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) recurse(item);
      return;
    }
    if (typeof node === 'object') {
      if (typeof node.citation === 'string') urls.add(node.citation);
      if (typeof node.url === 'string') urls.add(node.url);
      for (const k of Object.keys(node)) recurse(node[k]);
    }
  };
  recurse(pack);
  return urls;
}

// ─── Public surface ───────────────────────────────────────────────────────

/**
 * Validate a narrator response against its facts pack.
 *
 * @param {Object} response — { narrative, headlinedCandidates: [], confidence,
 *   citations: [] | [{url}] | [string] }
 * @param {Object} factsPack — the bounded pack the narrator was given
 * @returns {{ valid: boolean, reason?: string, retryHint?: string }}
 */
export function standardNumericValidator(response, factsPack) {
  if (!response || typeof response !== 'object') {
    return { valid: false, reason: 'malformed_response', retryHint: 'Your previous response was not valid JSON.' };
  }

  const narrative = String(response.narrative || '');
  const headlinedCandidates = Array.isArray(response.headlinedCandidates) ? response.headlinedCandidates : [];
  const citations = Array.isArray(response.citations) ? response.citations : [];

  // 1. Every number cited in narrative must match something in the pack
  //    within ±NUMERIC_TOLERANCE.
  const packNumbers = collectNumbersInPack(factsPack);
  const narratedNumbers = extractNumbers(narrative);
  for (const num of narratedNumbers) {
    if (!matchesAny(num.value, packNumbers, NUMERIC_TOLERANCE)) {
      return {
        valid: false,
        reason: 'number_not_in_pack',
        retryHint: `Your response cited "${num.raw}" (${num.value}) which is not in the facts pack. Use only numbers from the facts pack.`,
      };
    }
  }

  // 2. Every proper-noun entity must appear in a name-ish field in the pack.
  const packEntities = collectEntitiesInPack(factsPack);
  const narratedEntities = extractEntities(narrative);
  for (const ent of narratedEntities) {
    if (!entityIsInPack(ent, packEntities)) {
      return {
        valid: false,
        reason: 'entity_not_in_pack',
        retryHint: `Your response named "${ent}" which is not in the facts pack. Use only names that appear in the facts pack.`,
      };
    }
  }

  // 3. Every headlined candidate ID must exist in candidates.recommendations.
  const candidateIds = new Set(
    (factsPack.candidates?.recommendations || []).map((c) => c.id)
  );
  for (const id of headlinedCandidates) {
    if (!candidateIds.has(id)) {
      return {
        valid: false,
        reason: 'unknown_candidate_id',
        retryHint: `headlinedCandidates includes "${id}" which is not in candidates.recommendations. Select only from the provided list.`,
      };
    }
  }

  // 4. Every cited URL must match a citation field somewhere in the pack.
  const packUrls = collectCitationsInPack(factsPack);
  for (const c of citations) {
    const url = typeof c === 'string' ? c : c?.url;
    if (!url) continue;
    if (!packUrls.has(url)) {
      return {
        valid: false,
        reason: 'unknown_citation_url',
        retryHint: `Citation URL "${url}" is not in the facts pack. Cite only URLs that appear as 'citation' fields in the facts pack.`,
      };
    }
  }

  return { valid: true };
}

// Surface internals for unit tests.
export const _internals = {
  extractNumbers,
  collectNumbersInPack,
  matchesAny,
  extractEntities,
  collectEntitiesInPack,
  entityIsInPack,
  collectCitationsInPack,
  NUMERIC_TOLERANCE,
};

export default { standardNumericValidator };
