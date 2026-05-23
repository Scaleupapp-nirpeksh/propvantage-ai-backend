// File: services/cpCopilotService.js
// Description: SP5 — CP-side AI Copilot orchestrator. Mirrors
//   services/aiCopilotService.js but with a CP business-analyst persona
//   and the cpCopilotFunctions tool catalog.
//
//   In-memory conversation store (30-min TTL, 10-message rolling window),
//   identical to the dev Copilot. No Redis dep.

import OpenAI from 'openai';
import { cpCopilotTools, executeCpCopilotFunction } from './cpCopilotFunctions.js';
import { SYSTEM_PROMPT as INSIGHT_SYSTEM_PROMPT } from './ai/promptTemplates.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.COPILOT_MODEL || 'gpt-4o';

// CP Copilot system prompt — extends the narrator's anti-hallucination rules
// with chat-specific behaviour. Persona: a CP business analyst.
const CP_COPILOT_SYSTEM_PROMPT = `You are PropVantage AI's Channel Partner business analyst. Your job is to help a channel-partner organisation's team (Owner / Manager / Agent) understand their pipeline, commission, agents, developers, and reconciliation state.

You have access to a tool catalog (function calls) that you MUST use to fetch data — never invent numbers or names. The anti-hallucination rules:

1. Every number you mention must come from a tool result. Do not compute new numbers — not even averages or percentages.
2. Every person / developer / project name you mention must come from a tool result.
3. If the user asks for data you cannot fetch (no tool exists), say so explicitly.
4. If a tool returns { error: 'forbidden' }, relay that — do not attempt the action via another tool.
5. After fetching data, write a concise reply (under 200 words) that answers the user's question.
6. Cite specific records by appending citation URLs from the tool results in a 'See:' line at the end.
7. Keep your responses business-focused and actionable.`;

// ─── Conversation store ───────────────────────────────────────────────────
//
// Same shape as services/aiCopilotService.js. Keyed by conversationId; 30-min
// TTL; 10-message rolling window per conversation.

const conversations = new Map();
const CONVERSATION_TTL = 30 * 60 * 1000;
const MAX_MESSAGES = 10;

setInterval(() => {
  const now = Date.now();
  for (const [id, conv] of conversations) {
    if (now - conv.lastAccessed > CONVERSATION_TTL) conversations.delete(id);
  }
}, 5 * 60 * 1000);

function getConversation(conversationId) {
  const conv = conversations.get(conversationId);
  if (conv) {
    conv.lastAccessed = Date.now();
    return conv.messages;
  }
  return [];
}
function saveConversation(conversationId, userId, messages) {
  const trimmed = messages.slice(-MAX_MESSAGES * 2);
  conversations.set(conversationId, { userId, messages: trimmed, lastAccessed: Date.now() });
}

function generateId(prefix = 'cpconv') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// ─── Public surface ───────────────────────────────────────────────────────

/**
 * Process a CP-side Copilot message.
 *
 * @param {string} message
 * @param {Object} user — { _id, organization, roleRef }
 * @param {string|null} conversationId
 * @returns {Promise<{ conversationId, response: { text, citations[],
 *   toolCallsExecuted[] }, tokenUsage }>}
 */
export async function processCpCopilotMessage(message, user, conversationId) {
  const convId = conversationId || generateId();
  const history = getConversation(convId);

  const messages = [
    { role: 'system', content: CP_COPILOT_SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: String(message || '').trim() },
  ];

  let totalPrompt = 0, totalCompletion = 0, totalCost = 0;
  const toolCallsExecuted = [];
  const citationSet = new Set();

  // Tool-calling loop — at most 3 iterations.
  let assistantMessage;
  for (let iter = 0; iter < 3; iter++) {
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages,
      tools: cpCopilotTools,
      tool_choice: 'auto',
      temperature: 0.3,
      max_tokens: 800,
    });
    const usage = response.usage || {};
    totalPrompt += usage.prompt_tokens || 0;
    totalCompletion += usage.completion_tokens || 0;
    // Pricing in line with insightNarrator.
    totalCost += (usage.prompt_tokens || 0) / 1e6 * 2.5
              + (usage.completion_tokens || 0) / 1e6 * 10.0;

    assistantMessage = response.choices?.[0]?.message;
    if (!assistantMessage) break;
    messages.push(assistantMessage);

    if (!assistantMessage.tool_calls?.length) break; // no more tools to call

    for (const tc of assistantMessage.tool_calls) {
      const fnName = tc.function?.name;
      let args = {};
      try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { /* ignore */ }
      const result = await executeCpCopilotFunction(fnName, args, user);
      toolCallsExecuted.push({ name: fnName, args });
      // Collect any citation URLs from the result for the response payload.
      const collectCitations = (node) => {
        if (!node) return;
        if (typeof node === 'string' && node.startsWith('/')) citationSet.add(node);
        if (Array.isArray(node)) node.forEach(collectCitations);
        else if (typeof node === 'object') Object.values(node).forEach(collectCitations);
      };
      collectCitations(result);
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(result).slice(0, 4000),
      });
    }
  }

  const text = assistantMessage?.content || '';
  saveConversation(convId, user._id, messages.slice(1)); // drop system prompt for storage

  return {
    conversationId: convId,
    response: {
      text,
      citations: Array.from(citationSet),
      toolCallsExecuted,
    },
    tokenUsage: { prompt: totalPrompt, completion: totalCompletion, total: totalPrompt + totalCompletion, costUsd: totalCost },
  };
}

export default { processCpCopilotMessage };
