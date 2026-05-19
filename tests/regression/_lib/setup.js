// File: tests/regression/_lib/setup.js
// Jest globalSetup: pre-flight check that the API is reachable before any test runs.

import 'dotenv/config';
import fetch from 'node-fetch';

const BASE_URL = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

export default async () => {
  const url = `${BASE_URL}/api/health`;
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(url, { timeout: 5000 });
      if (res.ok) {
        const body = await res.json();
        console.log(`\n[regression] target reachable: ${BASE_URL} (version ${body.version})\n`);
        return;
      }
    } catch (_) { /* retry */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(
    `[regression] ${url} unreachable after 5 attempts.\n` +
    `Set API_BASE_URL to the running server (default http://localhost:3000), ` +
    `or start the dev server with \`npm run server\` before running tests.`,
  );
};
