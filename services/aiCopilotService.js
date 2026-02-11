// File: services/aiCopilotService.js
// Description: GPT-4 orchestration service for AI Copilot with function calling and in-memory conversation store
// Uses OpenAI function calling to let GPT-4 decide which database queries to run

import OpenAI from 'openai';
import { copilotTools, executeCopilotFunction } from './copilotFunctions.js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const COPILOT_MODEL = process.env.COPILOT_MODEL || 'gpt-4';

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
- Tasks and tickets — assignments, overdue tasks, workload, task analytics, and task details

Rules:
1. Always scope data to the user's organization (this is handled automatically by the system).
2. Format currency in Indian format (₹ Cr for crores, ₹ L for lakhs, ₹ K for thousands). Examples: ₹3.5 Cr, ₹45 L, ₹75 K.
3. Be concise but informative.
4. When showing numbers, also provide context (comparisons, trends, what they mean).
5. If data is insufficient to answer, say so honestly.
6. Respect role-based access — the system automatically filters data based on the user's role.
7. Always provide actionable suggestions when relevant (e.g., "You might want to follow up on these leads").
8. When your answer contains metrics, tabular data, or chart-worthy data, include structured cards in your response.

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
  "sources": ["sales", "leads", "projects", "payments", "units", "commissions", "predictions", "tasks"]
}

Include only relevant fields in each card based on its type.
If the answer is simple text with no structured data, use type "text" and omit cards.
Always include 2-3 followUpQuestions to guide the user to explore further.
Always include sources listing which data categories were queried.`;
}

// =============================================================================
// ROLE-BASED ACCESS CHECK
// =============================================================================

const FINANCIAL_ROLES = ['Business Head', 'Project Director', 'Finance Head', 'Finance Manager', 'Sales Head'];
const FINANCIAL_FUNCTIONS = ['get_revenue_analysis', 'get_payment_summary', 'get_overdue_payments', 'get_payments_due_today', 'get_commission_summary'];

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
    if (context.currentPage || context.projectId) {
      userMessage += `\n\n[Context: User is on page "${context.currentPage || 'unknown'}"`;
      if (context.projectId) userMessage += `, viewing project ID: ${context.projectId}`;
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

          const result = await executeCopilotFunction(functionName, functionArgs, user);

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
 * Parse GPT-4's response into the structured format
 */
function parseGPTResponse(content) {
  if (!content) {
    return {
      text: 'I was unable to generate a response. Please try again.',
      type: 'text',
      sources: [],
    };
  }

  // Try to parse as JSON first
  try {
    // Remove markdown code fences if present
    let cleaned = content.trim();
    if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
    if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
    if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
    cleaned = cleaned.trim();

    const parsed = JSON.parse(cleaned);

    return {
      text: parsed.text || content,
      type: parsed.type || (parsed.cards && parsed.cards.length > 0 ? 'rich' : 'text'),
      cards: parsed.cards || [],
      actions: parsed.actions || [],
      followUpQuestions: parsed.followUpQuestions || [],
      sources: parsed.sources || [],
    };
  } catch {
    // If JSON parsing fails, return as plain text response
    return {
      text: content,
      type: 'text',
      cards: [],
      actions: [],
      followUpQuestions: [],
      sources: [],
    };
  }
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
