// tests/regression/sp4-e2e/lib/auth.mjs
import { http } from './api.mjs';

export async function login(email, password) {
  const r = await http('POST', '/auth/login', { body: { email, password }, expect: 200, note: `login ${email}` });
  return { token: r.data.token, userId: r.data._id, org: r.data.organization, role: r.data.role, raw: r.data };
}

// No /auth/me — we cache identity at login time.
