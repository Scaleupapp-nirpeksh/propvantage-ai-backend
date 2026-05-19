// File: tests/smokeTestAIModels.js
// Description: Smoke-test all AI model upgrades end-to-end.
//   - One small call per model to verify model strings and SDKs work
//   - Two calls against the cacheable EXTRACTION_SYSTEM to verify cache hits
// Usage: node tests/smokeTestAIModels.js
// Cost: < $0.05 total per run

import dotenv from 'dotenv';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const results = [];
const log = (name, status, detail = '') => {
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : 'ℹ️';
  console.log(`${icon} ${name}${detail ? ` — ${detail}` : ''}`);
  results.push({ name, status, detail });
};

// Resolve env-configurable defaults the same way the services do
const COPILOT_MODEL = process.env.COPILOT_MODEL || 'gpt-4o';
const CONVERSATION_MODEL = process.env.CONVERSATION_MODEL || 'gpt-4o';
const LEAD_INSIGHTS_MODEL = process.env.LEAD_INSIGHTS_MODEL || 'gpt-4o';
const RESEARCH_SEARCH_MODEL = process.env.RESEARCH_SEARCH_MODEL || 'gpt-4o-search-preview';
const RESEARCH_EXTRACTION_MODEL = process.env.RESEARCH_EXTRACTION_MODEL || 'claude-sonnet-4-6';
const COMPETITIVE_AI_MODEL = process.env.COMPETITIVE_AI_MODEL || 'claude-sonnet-4-6';

// Minimal sample of the real EXTRACTION_SYSTEM shape — to test caching
// Real one lives in services/aiResearchService.js; we copy a token-realistic chunk here
const SAMPLE_CACHEABLE_SYSTEM = `You are a data extraction specialist. You always respond with valid JSON only — no markdown fences, no comments, no explanation outside the JSON.

Your task: parse the real estate market research provided in the user message into a structured JSON array.

IMPORTANT RULES:
1. Return ONLY valid JSON — no markdown, no comments, no explanation.
2. Return an object with a "projects" key containing an array.
3. For numeric fields, use numbers (not strings). Use null for unknown values.
4. Price amounts should be in INR (not lakhs/crores — convert to absolute numbers).
   - 1 Lakh = 100000, 1 Crore = 10000000
   - "₹85 Lakhs" = 8500000, "₹1.2 Cr" = 12000000, "₹8,500/sqft" = 8500
5. For boolean amenities, use true/false.
6. confidence should be 30-80: 30 for estimated/guessed data, 50 for partially verified, 70-80 for data with clear sources.
7. Use the locality (city/area) provided in the user message verbatim inside each project's "location" object.

${'PAD '.repeat(800)}`; // pad so the prefix definitely crosses Sonnet 4.6's 2048-token min

const testOpenAIChat = async (label, model) => {
  try {
    const resp = await openai.chat.completions.create({
      model,
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Reply with just the word: ok' }],
    });
    const txt = resp.choices?.[0]?.message?.content?.trim() || '';
    log(`OpenAI ${label} (${model})`, 'PASS', `replied "${txt}"`);
  } catch (err) {
    log(`OpenAI ${label} (${model})`, 'FAIL', err.message);
  }
};

const testOpenAISearch = async (label, model) => {
  // gpt-4o-search-preview does not accept max_tokens or temperature
  try {
    const resp = await openai.chat.completions.create({
      model,
      messages: [{ role: 'user', content: 'Reply with just the word: ok' }],
    });
    const txt = resp.choices?.[0]?.message?.content?.trim()?.slice(0, 40) || '';
    log(`OpenAI ${label} (${model})`, 'PASS', `replied "${txt}"`);
  } catch (err) {
    log(`OpenAI ${label} (${model})`, 'FAIL', err.message);
  }
};

const testClaudeBasic = async (label, model) => {
  try {
    const resp = await anthropic.messages.create({
      model,
      max_tokens: 50,
      system: 'You are a terse assistant.',
      messages: [{ role: 'user', content: 'Reply with just the word: ok' }],
    });
    const block = resp.content.find((b) => b.type === 'text');
    log(`Claude ${label} (${model})`, 'PASS', `replied "${block?.text?.trim() || '(no text)'}"`);
  } catch (err) {
    log(`Claude ${label} (${model})`, 'FAIL', err.message);
  }
};

const testClaudeAdaptiveThinking = async (model) => {
  try {
    const resp = await anthropic.messages.create({
      model,
      max_tokens: 200,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      system: 'You always reply with valid JSON only.',
      messages: [{ role: 'user', content: 'Return {"ok": true} as JSON.' }],
    });
    const block = resp.content.find((b) => b.type === 'text');
    if (!block) throw new Error('no text block in response');
    JSON.parse(block.text); // verify it parses
    log(`Claude adaptive thinking (${model})`, 'PASS', `text-block-find OK, JSON parsed`);
  } catch (err) {
    log(`Claude adaptive thinking (${model})`, 'FAIL', err.message);
  }
};

const testClaudePromptCaching = async (model) => {
  // First call: should write the cache
  try {
    const first = await anthropic.messages.create({
      model,
      max_tokens: 50,
      system: [
        { type: 'text', text: SAMPLE_CACHEABLE_SYSTEM, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: 'Reply with just: first' }],
    });
    const w1 = first.usage?.cache_creation_input_tokens || 0;
    const r1 = first.usage?.cache_read_input_tokens || 0;

    // Second call with the same system: should READ the cache
    const second = await anthropic.messages.create({
      model,
      max_tokens: 50,
      system: [
        { type: 'text', text: SAMPLE_CACHEABLE_SYSTEM, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: 'Reply with just: second' }],
    });
    const w2 = second.usage?.cache_creation_input_tokens || 0;
    const r2 = second.usage?.cache_read_input_tokens || 0;

    log('Claude prompt-cache write (call 1)', w1 > 0 ? 'PASS' : 'FAIL', `cache_creation=${w1} tokens`);
    log('Claude prompt-cache read  (call 2)', r2 > 0 ? 'PASS' : 'FAIL', `cache_read=${r2}, cache_creation=${w2} tokens`);
  } catch (err) {
    log('Claude prompt-caching', 'FAIL', err.message);
  }
};

const main = async () => {
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY missing in .env');
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY missing in .env');
    process.exit(1);
  }

  console.log('\n🧪 AI model smoke tests — verifying upgraded model strings\n');

  console.log('── OpenAI ────────────────────────────────────────');
  await testOpenAIChat('copilot', COPILOT_MODEL);
  if (CONVERSATION_MODEL !== COPILOT_MODEL) {
    await testOpenAIChat('conversation', CONVERSATION_MODEL);
  }
  if (LEAD_INSIGHTS_MODEL !== COPILOT_MODEL) {
    await testOpenAIChat('lead insights', LEAD_INSIGHTS_MODEL);
  }
  await testOpenAISearch('research search', RESEARCH_SEARCH_MODEL);

  console.log('\n── Anthropic ─────────────────────────────────────');
  await testClaudeBasic('extraction', RESEARCH_EXTRACTION_MODEL);
  if (COMPETITIVE_AI_MODEL !== RESEARCH_EXTRACTION_MODEL) {
    await testClaudeBasic('competitive', COMPETITIVE_AI_MODEL);
  }
  await testClaudeAdaptiveThinking(COMPETITIVE_AI_MODEL);
  await testClaudePromptCaching(RESEARCH_EXTRACTION_MODEL);

  console.log('\n── Summary ───────────────────────────────────────');
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  console.log(`Passed: ${passed}  Failed: ${failed}  Total: ${results.length}`);
  process.exit(failed > 0 ? 1 : 0);
};

main();
