// File: tests/regression/_lib/api.js
// Tiny fetch wrapper used by every regression test.
//
// Configuration via env vars:
//   API_BASE_URL    — defaults to http://localhost:3000
//   API_TEST_TOKEN  — optional Bearer token; if set, used directly for auth tests
//                     (preferred for running against production from CI — provide
//                     a real user token via repo secret)
//
// If API_TEST_TOKEN is not provided, auth-required tests will skip themselves
// gracefully unless they detect a local DB via getDbAuthToken (see auth.js).

import fetch from 'node-fetch';
import FormData from 'form-data';

const BASE_URL = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

let authToken = process.env.API_TEST_TOKEN || null;

export const getBaseUrl = () => BASE_URL;
export const setAuthToken = (token) => { authToken = token; };
export const getAuthToken = () => authToken;
export const hasAuthToken = () => Boolean(authToken);

export const api = async (method, path, body = null, opts = {}) => {
  const headers = {
    'Content-Type': 'application/json',
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...(opts.headers || {}),
  };

  const init = { method, headers };
  if (body && !(body instanceof FormData)) {
    init.body = JSON.stringify(body);
  } else if (body instanceof FormData) {
    delete headers['Content-Type'];
    init.body = body;
  }

  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, init);
  } catch (e) {
    return { status: 0, data: null, ok: false, networkError: e.message };
  }

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: res.status, data, ok: res.ok };
};

// Helpers for jest matchers
export const expectOk = (res, label = '') => {
  if (!res.ok) {
    throw new Error(`${label || 'request'} expected ok, got ${res.status}: ${JSON.stringify(res.data)?.slice(0, 200)}`);
  }
};

export const expectStatusIn = (res, statuses, label = '') => {
  if (!statuses.includes(res.status)) {
    throw new Error(`${label || 'request'} expected status in [${statuses.join(', ')}], got ${res.status}: ${JSON.stringify(res.data)?.slice(0, 200)}`);
  }
};
