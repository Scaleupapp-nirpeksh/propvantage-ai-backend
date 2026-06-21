// File: services/aiCopilotService.js
// Description: GPT-4 orchestration service for AI Copilot with function calling and in-memory conversation store
// Uses OpenAI function calling to let GPT-4 decide which database queries to run

import OpenAI from 'openai';
import { copilotTools, executeCopilotFunction } from './copilotFunctions.js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const COPILOT_MODEL = process.env.COPILOT_MODEL || 'gpt-4o';

// =============================================================================
// IN-MEMORY CONVERSATION STORE (No Redis required)
// =============================================================================

const conversations = new Map();
const CONVERSATION_TTL = 30 * 60 * 1000; // 30 minutes
const MAX_MESSAGES_PER_CONVERSATION = 10;

// Cleanup expired conversations every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, conv] of conversations) {
    if (now - conv.lastAccessed > CONVERSATION_TTL) {
      conversations.delete(id);
    }
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
  // Keep only the last N messages to stay within token limits
  const trimmedMessages = messages.slice(-MAX_MESSAGES_PER_CONVERSATION * 2);

  conversations.set(conversationId, {
    userId,
    messages: trimmedMessages,
    lastAccessed: Date.now(),
  });
}

function generateId(prefix) {
  const randomPart = Math.random().toString(36).substring(2, 10);
  return `${prefix}_${randomPart}${Date.now().toString(36)}`;
}

// =============================================================================
// SYSTEM PROMPT BUILDER
// =============================================================================

function buildSystemPrompt(user) {
  const currentDate = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return `You are PropVantage AI Copilot, an intelligent assistant for a real estate CRM platform.

Current user: ${user.firstName} ${user.lastName} (${user.roleRef?.name || user.role})
Organization: ${user.organization}
Current date: ${currentDate}
Currency: INR (Indian Rupees)

You help users understand their business data by answering questions about:
- Projects, towers, and unit inventory
- Leads and sales pipeline
- Revenue, payments, and collections
- Sales forecasts and projections
- Team performance
- Commissions
- Channel partners — how much business is sourced through channel partners, the direct-vs-channel-partner split, performance broken down by partner firm and by partner category, partner attribution, and channel-partner commissions, payouts, and top performers. Use the channel-partner tools (not the generic sales/commission tools) whenever the user mentions partners, channel partners, CPs, brokers, or asks which partner/firm sourced business.
- Tasks and tickets — assignments, overdue tasks, workload, task analytics, and task details
- Support tickets — client support tickets (email-to-ticket): counts by status and category, open/unresolved tickets, and recent tickets with assignee and age. Use the get_support_tickets tool for questions about support tickets, client tickets, or ticket queues.

Rules:
1. Always scope data to the user's organization (this is handled automatically by the system).
2. Format currency in Indian format (₹ Cr for crores, ₹ L for lakhs, ₹ K for thousands). Examples: ₹3.5 Cr, ₹45 L, ₹75 K.
3. Be concise but informative.
4. When showing numbers, also provide context (comparisons, trends, what they mean).
5. If data is insufficient to answer, say so honestly.
6. Respect role-based access — the system automatically filters data based on the user's role.
7. Always provide actionable suggestions when relevant (e.g., "You might want to follow up on these leads").
8. When your answer contains metrics, tabular data, or chart-worthy data, include structured cards in your response.
9. When a function returns a list of individual records (e.g. recentTickets, leads, sales, units, recent items), you MUST present those records in a "table" or "list" card showing their key fields — never collapse them to just a count or a vague "no details available". If the list is non-empty, the items ARE the details; show them.

RESPONSE FORMAT:
You MUST respond with a valid JSON object matching this exact structure:
{
  "text": "Your natural language answer here",
  "type": "text" or "rich" (use "rich" when including cards),
  "cards": [
    {
      "type": "metrics" | "table" | "chart_data" | "list" | "alert",
      "title": "Card Title",
      "metrics": [{"label": "...", "value": ..., "unit": "currency|percent|number|units|text"}],
      "columns": [{"key": "...", "label": "..."}],
      "rows": [...],
      "chartType": "line" | "bar" | "pie" | "area",
      "data": [...],
      "xKey": "...",
      "yKeys": [...],
      "items": [{"title": "...", "subtitle": "...", "value": "...", "status": "..."}],
      "severity": "info" | "warning" | "error" | "success",
      "message": "..."
    }
  ],
  "actions": [{"label": "...", "type": "navigate", "path": "/..."}],
  "followUpQuestions": ["question1?", "question2?"],
  "sources": ["sales", "leads", "projects", "payments", "units", "commissions", "channel_partners", "predictions", "tasks"]
}

Include only relevant fields in each card based on its type.
For every metric "value" (and numeric table cell), output a RAW JSON number only — e.g. 5002600000 or 12.5 — never a string with commas, currency symbols, units, or words like "Cr"/"Lakh". The UI formats and adds ₹/% itself.
If the answer is simple text with no structured data, use type "text" and omit cards.
Always include 2-3 followUpQuestions to guide the user to explore further.
Always include sources listing which data categories were queried.

CRITICAL: Your entire reply must be ONLY the JSON object — nothing else. Do not write any explanatory text before or after it, and do not wrap it in a markdown code fence. The first character of your reply must be "{" and the last must be "}".`;
}

// =============================================================================
// ROLE-BASED ACCESS CHECK
// =============================================================================

const FINANCIAL_ROLES = ['Business Head', 'Project Director', 'Finance Head', 'Finance Manager', 'Sales Head'];
const FINANCIAL_FUNCTIONS = ['get_revenue_analysis', 'get_payment_summary', 'get_overdue_payments', 'get_payments_due_today', 'get_commission_summary', 'get_channel_partner_commission_analytics'];

function isRoleAllowedForFunction(user, functionName) {
  const userRole = user?.roleRef?.name || user;
  // Financial functions are restricted for non-financial roles
  if (FINANCIAL_FUNCTIONS.includes(functionName)) {
    if (['Sales Executive', 'Channel Partner Agent'].includes(userRole)) {
      return false;
    }
  }
  return true;
}

// =============================================================================
// GPT-4 ORCHESTRATION
// =============================================================================

/**
 * Process a copilot chat message
 * @param {string} message - User's natural language message
 * @param {object} user - Authenticated user object
 * @param {string} conversationId - Optional conversation ID for multi-turn
 * @param {object} context - Optional frontend context (currentPage, projectId, etc.)
 * @returns {object} - Structured copilot response
 */
export const processCopilotMessage = async (message, user, conversationId, context = {}) => {
  const convId = conversationId || generateId('conv');
  const msgId = generateId('msg');
  const { accessibleProjectIds, ...frontendContext } = context;

  try {
    // Step 1: Build messages array with conversation history
    const systemPrompt = buildSystemPrompt(user);
    const conversationHistory = getConversation(convId);

    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory,
    ];

    // Add context if provided
    let userMessage = message;
    if (frontendContext.currentPage || frontendContext.projectId) {
      userMessage += `\n\n[Context: User is on page "${frontendContext.currentPage || 'unknown'}"`;
      if (frontendContext.projectId) userMessage += `, viewing project ID: ${frontendContext.projectId}`;
      userMessage += ']';
    }

    messages.push({ role: 'user', content: userMessage });

    // Step 2: First GPT-4 call with function definitions
    console.log('🤖 Copilot: Sending message to GPT-4...');
    const firstResponse = await openai.chat.completions.create({
      model: COPILOT_MODEL,
      messages,
      tools: copilotTools,
      tool_choice: 'auto',
      temperature: 0.3,
      max_tokens: 1500,
    });

    const assistantMessage = firstResponse.choices[0].message;

    // Step 3: Check if GPT-4 wants to call functions
    if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      console.log(`🔧 Copilot: GPT-4 requested ${assistantMessage.tool_calls.length} function call(s)`);

      // Execute all function calls in parallel
      messages.push(assistantMessage);

      const functionResults = await Promise.all(
        assistantMessage.tool_calls.map(async (toolCall) => {
          const functionName = toolCall.function.name;
          const functionArgs = JSON.parse(toolCall.function.arguments);

          console.log(`  📊 Executing: ${functionName}(${JSON.stringify(functionArgs)})`);

          // Check role-based access
          if (!isRoleAllowedForFunction(user, functionName)) {
            const roleName = user.roleRef?.name || user.role;
            return {
              tool_call_id: toolCall.id,
              role: 'tool',
              content: JSON.stringify({ error: `Access denied: Your role (${roleName}) does not have permission to access this data.` }),
            };
          }

          const result = await executeCopilotFunction(functionName, functionArgs, user, accessibleProjectIds);

          return {
            tool_call_id: toolCall.id,
            role: 'tool',
            content: JSON.stringify(result),
          };
        })
      );

      // Add function results to messages
      functionResults.forEach(result => messages.push(result));

      // Step 4: Second GPT-4 call with function results to generate final response
      console.log('🤖 Copilot: Generating final response with data...');
      const secondResponse = await openai.chat.completions.create({
        model: COPILOT_MODEL,
        messages,
        temperature: 0.4,
        max_tokens: 2000,
      });

      const finalContent = secondResponse.choices[0].message.content;

      // Parse the structured response
      const parsedResponse = parseGPTResponse(finalContent);

      // Detect intent from function calls
      const intent = detectIntent(assistantMessage.tool_calls, parsedResponse);

      // Save conversation history
      saveConversation(convId, user._id, [
        ...conversationHistory,
        { role: 'user', content: message },
        { role: 'assistant', content: finalContent },
      ]);

      return {
        conversationId: convId,
        messageId: msgId,
        response: parsedResponse,
        intent,
        tokensUsed: (firstResponse.usage?.total_tokens || 0) + (secondResponse.usage?.total_tokens || 0),
      };
    }

    // Step 5: No function calls — GPT-4 responded directly (greetings, out-of-scope, etc.)
    const directContent = assistantMessage.content;
    const parsedResponse = parseGPTResponse(directContent);

    // Save conversation history
    saveConversation(convId, user._id, [
      ...conversationHistory,
      { role: 'user', content: message },
      { role: 'assistant', content: directContent },
    ]);

    return {
      conversationId: convId,
      messageId: msgId,
      response: parsedResponse,
      intent: {
        category: 'general',
        confidence: 0.5,
        entities: {},
      },
      tokensUsed: firstResponse.usage?.total_tokens || 0,
    };
  } catch (error) {
    console.error('❌ Copilot service error:', error);

    // Handle specific OpenAI errors
    if (error.code === 'insufficient_quota' || error.status === 429) {
      throw new Error('AI_RATE_LIMITED');
    }
    if (error.code === 'model_not_found') {
      throw new Error('AI_MODEL_ERROR');
    }

    throw new Error('AI_SERVICE_ERROR');
  }
};

// =============================================================================
// RESPONSE PARSER
// =============================================================================

/**
 * Extract the structured-response JSON object from GPT output.
 * GPT-4o is asked to return a bare JSON object, but it intermittently wraps it
 * in a markdown fence or prefaces it with prose. This handles all three shapes:
 *   1. the whole content is the JSON object (optionally fence-wrapped),
 *   2. a ```json ... ``` fenced block sits somewhere inside prose,
 *   3. a bare { ... } object sits somewhere inside prose.
 * Returns the parsed object, or null if no JSON object is found.
 */
function extractJsonObject(content) {
  // 1. Whole content is JSON, optionally wrapped in a single fence.
  let whole = content.trim();
  const wholeFence = whole.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (wholeFence) whole = wholeFence[1].trim();
  try {
    return JSON.parse(whole);
  } catch {
    // not pure JSON — fall through
  }

  // 2. A fenced ```json ... ``` block embedded anywhere inside prose.
  const blockFence = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (blockFence) {
    try {
      return JSON.parse(blockFence[1].trim());
    } catch {
      // fenced block wasn't valid JSON — fall through
    }
  }

  // 3. A bare { ... } object embedded in prose.
  const first = content.indexOf('{');
  const last = content.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try {
      return JSON.parse(content.slice(first, last + 1));
    } catch {
      // not parseable — fall through
    }
  }

  return null;
}

/**
 * Parse GPT-4's response into the structured format. Robust to GPT wrapping the
 * JSON envelope in a markdown fence or prefacing it with prose — in those cases
 * the older parser failed and dumped the raw envelope into the chat as text.
 */
export function parseGPTResponse(content) {
  if (!content) {
    return {
      text: 'I was unable to generate a response. Please try again.',
      type: 'text',
      cards: [],
      actions: [],
      followUpQuestions: [],
      sources: [],
    };
  }

  const parsed = extractJsonObject(content);

  // Accept the extracted object only if it looks like our response envelope —
  // a stray { } from unrelated prose must not be mistaken for a response.
  if (
    parsed &&
    typeof parsed === 'object' &&
    (parsed.text !== undefined || parsed.cards !== undefined || parsed.type !== undefined)
  ) {
    return {
      text: parsed.text || '',
      type: parsed.type || (parsed.cards && parsed.cards.length > 0 ? 'rich' : 'text'),
      cards: parsed.cards || [],
      actions: parsed.actions || [],
      followUpQuestions: parsed.followUpQuestions || [],
      sources: parsed.sources || [],
    };
  }

  // No JSON envelope found — treat the whole content as a plain-text answer.
  return {
    text: content,
    type: 'text',
    cards: [],
    actions: [],
    followUpQuestions: [],
    sources: [],
  };
}

/**
 * Detect user intent from function calls and response
 */
function detectIntent(toolCalls, response) {
  const functionNames = toolCalls.map(tc => tc.function.name);
  const entities = {};

  // Extract entities from function arguments
  toolCalls.forEach(tc => {
    try {
      const args = JSON.parse(tc.function.arguments);
      if (args.project_name) entities.project = args.project_name;
      if (args.project_id) entities.projectId = args.project_id;
      if (args.search) entities.search = args.search;
      if (args.period) entities.period = args.period;
    } catch {
      // ignore parse errors
    }
  });

  // Determine category
  let category = 'general';
  let confidence = 0.85;

  if (functionNames.some(n => n.includes('forecast') || n.includes('prediction'))) {
    category = 'projection';
    confidence = 0.92;
  } else if (functionNames.some(n => n.includes('task'))) {
    category = 'tasks';
    confidence = 0.9;
  } else if (functionNames.some(n => n.includes('lead'))) {
    category = 'leads';
  } else if (functionNames.some(n => n.includes('sales') || n.includes('revenue'))) {
    category = 'sales';
  } else if (functionNames.some(n => n.includes('payment') || n.includes('overdue'))) {
    category = 'payments';
  } else if (functionNames.some(n => n.includes('inventory') || n.includes('unit'))) {
    category = 'inventory';
  } else if (functionNames.some(n => n.includes('project'))) {
    category = 'projects';
  } else if (functionNames.some(n => n.includes('channel_partner'))) {
    category = 'channel_partners';
    confidence = 0.9;
  } else if (functionNames.some(n => n.includes('team') || n.includes('performance'))) {
    category = 'team';
  } else if (functionNames.some(n => n.includes('commission'))) {
    category = 'commissions';
  } else if (functionNames.some(n => n.includes('compare'))) {
    category = 'comparison';
  } else if (functionNames.some(n => n.includes('dashboard'))) {
    category = 'overview';
  }

  return { category, confidence, entities };
}
