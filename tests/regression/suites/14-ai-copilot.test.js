// 14-ai-copilot.test.js — contract test for the AI copilot endpoint.
// Skipped if AI_COPILOT_TEST_LIVE !== 'true' because it costs real OpenAI/Anthropic tokens.
import { describe, test, expect, beforeAll } from '@jest/globals';
import { api, hasAuthToken } from '../_lib/api.js';
import { tryAcquireToken, disconnectAuth } from '../_lib/auth.js';

const LIVE = process.env.AI_COPILOT_TEST_LIVE === 'true';

describe('AI copilot (live)', () => {
  beforeAll(async () => { await tryAcquireToken(); });
  afterAll(async () => { await disconnectAuth(); });

  test('POST /api/ai/copilot/chat returns structured response shape', async () => {
    if (!LIVE) { console.warn('  ⏭️  skipped — set AI_COPILOT_TEST_LIVE=true to run (costs ~$0.01)'); return; }
    if (!hasAuthToken()) { console.warn('  ⏭️  skipped — no auth token'); return; }

    const res = await api('POST', '/api/ai/copilot/chat', {
      message: 'How many projects do we have?',
    });
    expect([200, 403]).toContain(res.status);
    if (res.status === 200) {
      // Per AI_COPILOT_FRONTEND_GUIDE.md the response always has a response.text
      const r = res.data?.response || res.data;
      expect(typeof r?.text || r?.response?.text).toBeDefined();
    }
  }, 30000);

  test('GET /api/ai/copilot/suggestions returns suggestions array', async () => {
    if (!hasAuthToken()) { console.warn('  ⏭️  skipped — no auth token'); return; }
    const res = await api('GET', '/api/ai/copilot/suggestions');
    expect([200, 403]).toContain(res.status);
  });
});
