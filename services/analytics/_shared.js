// File: services/analytics/_shared.js
// Description: SP5 — small shared helpers for the CP/dev analytics services.
//   Date-range parsing, CP-role detection, agent narrowing, safe division,
//   in-memory 5-minute cache. Kept dependency-free (no node-cache / lru-cache).

import mongoose from 'mongoose';

// ─── Date-range parsing ─────────────────────────────────────────────────────

/**
 * Parse a `range` query string into a {from, to, key} window.
 * Supported: '7d' | '30d' | '90d' | '6m' | '12m' | 'ytd' | 'all'.
 * Defaults to '30d'.
 *
 * `from` is null for 'all'; callers should `.$match` accordingly.
 */
export function parseRange(rangeParam) {
  const now = new Date();
  const range = (rangeParam || '30d').toString().toLowerCase();
  let from;
  switch (range) {
    case '7d':  from = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000); break;
    case '30d': from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); break;
    case '90d': from = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000); break;
    case '6m':  from = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate()); break;
    case '12m': from = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()); break;
    case 'ytd': from = new Date(now.getFullYear(), 0, 1); break;
    case 'all': from = null; break;
    default:    from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }
  return { from, to: now, range };
}

// ─── CP role identity ──────────────────────────────────────────────────────

/**
 * True iff `user` is a CP Agent (the only CP role that gets self-only scoping).
 * CP Owner is mapped to 'Business Head' by the legacy registerUser flow, so
 * `user.role` strings are unreliable for CP roles — always check `roleRef`.
 */
export function isCpAgent(user) {
  return user?.roleRef?.name === 'CP Agent' || user?.roleRef?.slug === 'cp-agent';
}

/**
 * Builds the agent-narrowing match fragment for any Prospect aggregation.
 * Returns `{ assignedAgent: user._id }` for CP Agents, `{}` otherwise.
 */
export function agentScopeMatch(user) {
  return isCpAgent(user) ? { assignedAgent: user._id } : {};
}

// ─── Mongo helpers ─────────────────────────────────────────────────────────

export const toObjectId = (id) => (mongoose.isValidObjectId(id) ? new mongoose.Types.ObjectId(id) : id);
export const safeDiv    = (a, b) => (b > 0 ? a / b : 0);
export const round2     = (x) => Math.round((Number(x) || 0) * 100) / 100;

// ─── In-memory 5-minute cache ──────────────────────────────────────────────
//
// Keyed by an analytics-service-supplied string (e.g. 'pipeline:<orgId>:<range>:<agent?>').
// Single-process EC2 deploy — cache resets on PM2 restart (acceptable for
// analytics that tolerate slight staleness per spec §5.1). If the deploy ever
// moves to a multi-process cluster, swap this for a Redis-backed cache.

const TTL_MS = 5 * 60 * 1000;
const _cache = new Map(); // key → { value, expiresAt }

export function cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    _cache.delete(key);
    return null;
  }
  return entry.value;
}

export function cacheSet(key, value) {
  _cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
  return value;
}

/**
 * Convenience wrapper — fetch from cache or compute + store.
 * `compute` is an async fn; the cache key should encode every parameter
 * that affects the output.
 */
export async function withCache(key, compute) {
  const hit = cacheGet(key);
  if (hit !== null) return hit;
  const value = await compute();
  return cacheSet(key, value);
}
