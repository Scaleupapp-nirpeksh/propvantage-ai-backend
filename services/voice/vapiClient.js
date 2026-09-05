// File: services/voice/vapiClient.js
// Description: Minimal HTTP client for the Vapi REST API. Auth is the org-level
//   private key from VAPI_API_KEY. Every method throws an Error carrying Vapi's
//   own message so validation problems are visible in logs and API responses.

const BASE = process.env.VAPI_API_BASE || 'https://api.vapi.ai';

function apiKey() {
  const k = (process.env.VAPI_API_KEY || '').replace(/^['"]|['"]$/g, '').trim();
  if (!k) throw new Error('VAPI_API_KEY is not configured');
  return k;
}

async function request(method, path, body, { timeoutMs = 20000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!res.ok) {
      const msg = Array.isArray(data?.message) ? data.message.join('; ') : (data?.message || data?.error || text || res.statusText);
      const err = new Error(`Vapi ${method} ${path} → ${res.status}: ${msg}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(t);
  }
}

export const vapiClient = {
  isConfigured: () => Boolean((process.env.VAPI_API_KEY || '').trim()),
  createAssistant: (dto) => request('POST', '/assistant', dto),
  updateAssistant: (id, dto) => request('PATCH', `/assistant/${id}`, dto),
  getAssistant: (id) => request('GET', `/assistant/${id}`),
  createCall: (dto) => request('POST', '/call', dto),
  getCall: (id) => request('GET', `/call/${id}`),
  listPhoneNumbers: () => request('GET', '/phone-number'),
  importTwilioNumber: ({ number, accountSid, authToken, name }) =>
    request('POST', '/phone-number', {
      provider: 'twilio',
      number,
      twilioAccountSid: accountSid,
      twilioAuthToken: authToken,
      name: name || `PropVantage ${number}`,
    }),
  request,
};

export default vapiClient;
