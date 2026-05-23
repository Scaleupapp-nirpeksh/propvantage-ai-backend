// tests/regression/sp4-e2e/lib/api.mjs
// HTTP wrapper for the SP4 end-to-end runner. Records every request/response
// onto the active run-log so the final report has full evidence.
import fetch from 'node-fetch';

export const BASE = process.env.SP4_API_BASE || 'https://api.prop-vantage.com/api';

let _runLog = null;
export const bindRunLog = (log) => { _runLog = log; };

export async function http(method, path, { token = null, body = null, expect = null, note = '' } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const init = { method, headers };
  if (body !== null) init.body = JSON.stringify(body);

  const url = BASE + path;
  let res;
  let text = '';
  let data = null;
  const t0 = Date.now();
  try {
    res = await fetch(url, init);
    text = await res.text();
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
  } catch (e) {
    const rec = {
      method, path, status: 0, ms: Date.now() - t0,
      networkError: e.message, note,
    };
    if (_runLog) _runLog.requests.push(rec);
    return { status: 0, data: null, ok: false, networkError: e.message };
  }

  const rec = {
    method, path, status: res.status, ms: Date.now() - t0,
    body: body ? truncate(body) : null,
    response: truncate(data),
    note,
  };
  if (_runLog) _runLog.requests.push(rec);

  if (expect != null) {
    const ok = Array.isArray(expect) ? expect.includes(res.status) : res.status === expect;
    if (!ok) {
      const err = new Error(
        `${method} ${path} expected ${Array.isArray(expect) ? '['+expect.join(',')+']' : expect}, got ${res.status}: ${JSON.stringify(data).slice(0, 300)}`
      );
      err.response = { status: res.status, data };
      throw err;
    }
  }

  return { status: res.status, data, ok: res.ok };
}

// Normalize the many response shapes used by the API into a flat array.
// /leads → data.leads[], /notifications → data.notifications[],
// /partnerships → data[], /channel-partners → data[], etc.
export function pickArr(resp, ...keys) {
  const d = resp?.data;
  if (Array.isArray(d)) return d;
  if (d && typeof d === 'object') {
    for (const k of keys) if (Array.isArray(d[k])) return d[k];
    // common defaults
    for (const k of ['items', 'leads', 'notifications', 'developers', 'channelPartners', 'prospects', 'data', 'results', 'docs']) {
      if (Array.isArray(d[k])) return d[k];
    }
  }
  return [];
}

function truncate(obj) {
  try {
    const s = JSON.stringify(obj);
    if (s.length <= 1500) return obj;
    return JSON.parse(s.slice(0, 1500) + '"…TRUNCATED"}'.replace(/^/, '')) ?? { _truncated: s.slice(0, 1500) };
  } catch {
    return { _unserializable: String(obj).slice(0, 500) };
  }
}
