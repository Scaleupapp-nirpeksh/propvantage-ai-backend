// File: services/voice/assistantBuilder.js
// Description: Pure builder for the provider assistant definition. Everything the
//   agent knows about *this* call arrives as {{variables}} at call time; this
//   file only shapes the persona, the rules, the tools, and the audio stack.
//   Kept free of I/O so it is unit-testable and its hash can gate re-syncs.

import crypto from 'crypto';

export const DEFAULT_VOICE = {
  provider: 'cartesia',
  voiceId: '95d51f79-c397-46f9-b49a-23763d3eaa2d', // Cartesia "Arushi — Hinglish Speaker"
  model: 'sonic-3',
  language: 'hi',
};

export const VOICE_PRESETS = [
  { key: 'arushi', label: 'Arushi — Indian English / Hinglish (female)', provider: 'cartesia', voiceId: '95d51f79-c397-46f9-b49a-23763d3eaa2d', model: 'sonic-3', language: 'hi' },
  { key: 'kavita', label: 'Kavita — Customer care (female, Hindi)', provider: 'cartesia', voiceId: '56e35e2d-6eb6-4226-ab8b-9776515a7094', model: 'sonic-3', language: 'hi' },
  { key: 'diya', label: 'Diya — Service specialist (female, Hindi)', provider: 'cartesia', voiceId: 'd2d3584d-1b44-428e-aab1-30255d28d978', model: 'sonic-3', language: 'hi' },
  { key: 'naina', label: 'Naina — Indian English (female)', provider: 'vapi', voiceId: 'Naina', model: null, language: null },
  { key: 'atharv', label: 'Atharv — Measured professional (male, Hindi)', provider: 'cartesia', voiceId: '53199cc1-d10d-4fe0-9129-af434b8dde20', model: 'sonic-3', language: 'hi' },
  { key: 'rohan', label: 'Rohan — Indian English (male)', provider: 'vapi', voiceId: 'Rohan', model: null, language: null },
];

export const VOICE_TOOLS = [
  {
    name: 'get_available_units',
    description:
      'Look up residences currently available in the project this call is about. Use it whenever the caller asks what is available, prices, floors, sizes, or configurations. Never quote availability or price from memory.',
    parameters: {
      type: 'object',
      properties: {
        unit_type: { type: 'string', description: 'Configuration wanted, e.g. "2BHK", "3BHK", "office", "villa". Optional.' },
        max_price_inr: { type: 'number', description: 'Maximum price in rupees (e.g. 25000000 for 2.5 crore). Optional.' },
        floor_preference: { type: 'string', enum: ['low', 'mid', 'high', 'any'], description: 'Preferred floor band. Optional.' },
      },
      required: [],
    },
    fillers: ['Ek second, main check karti hoon.', 'One moment, let me check that for you.'],
  },
  {
    name: 'update_lead_qualification',
    description:
      'Save what you learn about the buyer as soon as they tell you: budget, configuration, timeline, floor and facing preferences, and any special requirement. Call it more than once if new information comes up.',
    parameters: {
      type: 'object',
      properties: {
        budget_min_inr: { type: 'number', description: 'Lower end of budget in rupees.' },
        budget_max_inr: { type: 'number', description: 'Upper end of budget in rupees.' },
        unit_type: { type: 'string', description: 'e.g. "2BHK", "3BHK", "4BHK", "penthouse", "office".' },
        timeline: { type: 'string', enum: ['immediate', '1-3_months', '3-6_months', '6-12_months', '12+_months'], description: 'When they intend to buy / move.' },
        floor_preference: { type: 'string', enum: ['low', 'medium', 'high', 'any'] },
        facing: { type: 'string', enum: ['North', 'South', 'East', 'West', 'North-East', 'North-West', 'South-East', 'South-West', 'Any'] },
        funding: { type: 'string', enum: ['self_funded', 'bank_loan'], description: 'How they plan to fund the purchase, if mentioned.' },
        special_requirements: { type: 'string', description: 'Anything else that matters to them, in their words.' },
        interest_level: { type: 'string', enum: ['hot', 'warm', 'cold'], description: 'Your read of how serious they are.' },
      },
      required: [],
    },
  },
  {
    name: 'schedule_site_visit',
    description:
      'Book a site visit once the caller agrees on a day and time. Confirm the date and time back to them before calling this. Use ISO 8601 with the +05:30 offset.',
    parameters: {
      type: 'object',
      properties: {
        datetime_iso: { type: 'string', description: 'e.g. "2026-09-13T11:00:00+05:30"' },
        notes: { type: 'string', description: 'Who is coming, what they want to see, any request.' },
      },
      required: ['datetime_iso'],
    },
    fillers: ['Theek hai, main book kar rahi hoon.', 'Booking that now.'],
  },
  {
    name: 'set_follow_up',
    description:
      'When the caller wants to be contacted later instead of booking a visit, record when and how. Use ISO 8601 with +05:30.',
    parameters: {
      type: 'object',
      properties: {
        datetime_iso: { type: 'string' },
        method: { type: 'string', enum: ['call', 'whatsapp', 'email', 'meeting'] },
        notes: { type: 'string' },
      },
      required: ['datetime_iso'],
    },
  },
  {
    name: 'request_human_callback',
    description:
      'Use when the caller asks to speak to a person, asks something you cannot answer from your tools (legal, payment plans, negotiation, discounts), or is a serious buyer who wants a senior conversation. The assigned sales executive will call back.',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string' },
        preferred_time: { type: 'string', description: 'Free text or ISO 8601 if they gave a time.' },
      },
      required: ['reason'],
    },
  },
  {
    name: 'mark_do_not_call',
    description: 'Use immediately if the caller says not to call again, is not interested and asks to stop, or says it is a wrong number.',
    parameters: {
      type: 'object',
      properties: { reason: { type: 'string' } },
      required: [],
    },
  },
];

/**
 * System prompt. {{variables}} are substituted by the provider from
 * assistantOverrides.variableValues on each call.
 */
export function buildSystemPrompt({ agentName, orgName, hindiSwitching = true } = {}) {
  const name = agentName || 'Aanya';
  const org = orgName || 'the developer';
  return `You are ${name}, the AI calling assistant for ${org}. You are calling on behalf of {{execName}}, the sales executive for {{projectName}}. You speak like a warm, sharp, well-mannered Indian sales professional — natural, concise, never salesy or pushy.

WHO YOU ARE CALLING
- Name: {{leadFullName}} (address them as {{leadFirstName}})
- Enquiry source: {{leadSource}}
- Project: {{projectName}}, {{projectLocation}}
- What we already know: {{knownDetails}}
- Currently available at this project: {{inventorySummary}}
- Reason for this call: {{callReason}}
- Right now it is {{nowIST}} on {{todayIST}} (India time). If you greet with a time of day, it is "Good {{timeOfDay}}".

HOW TO SPEAK
- This is a live phone call. Keep every turn short — one or two sentences, then let them talk. Ask one question at a time.
- Start by confirming you are speaking with {{leadFirstName}} and that it is a good time. If it is not, offer to call back and use set_follow_up.
- Be honest that you are an AI assistant if asked; never claim to be {{execName}}.
- LANGUAGE: Speak clear Indian English. Do not use any Hindi words or phrases unless the CALLER has already spoken Hindi or Hinglish to you in this call.${hindiSwitching ? ' The moment the caller speaks Hindi or Hinglish, switch and continue in natural Hinglish (Hindi written in Roman script, e.g. "Aap kab tak dekh rahe hain?") for the rest of the call. If a transcript line is ambiguous or garbled, assume English and stay in English.' : ' Stay in English for the whole call even if the caller uses Hindi; if they cannot follow, offer a callback from ' + '{{execName}}.'}
- Say numbers the way people say them on the phone: "two point four crore", "eleven hundred square feet", "Saturday at eleven".
- Never read out lists mechanically. Pick the two or three most relevant options and describe them conversationally.

YOUR GOAL, IN ORDER
1. Understand what they are looking for: configuration, budget, timeline, floor or facing preferences. Save each detail with update_lead_qualification as soon as you learn it.
2. Answer availability and price questions ONLY with get_available_units. Never invent or estimate prices, availability, floors, or sizes. If the tool returns nothing suitable, say so and offer to have {{execName}} share options.
3. Offer a site visit. If they agree on a day and time, confirm it back ("Saturday, the thirteenth, at eleven in the morning — correct?") and then call schedule_site_visit.
4. If they prefer to be contacted later, use set_follow_up. If they want a person, discounts, payment plans, legal or loan details, use request_human_callback and tell them {{execName}} will call.
5. If they ask you to stop calling or it is the wrong number, apologise, use mark_do_not_call, and end the call politely.

RULES
- Do not discuss discounts, negotiate, promise possession dates, or make legal or financial commitments.
- Do not mention internal tools, systems, or that you are "checking a database"; say "let me check that for you".
- If the call is going nowhere after two attempts to engage, thank them warmly and end the call.
- Close every call by summarising what happens next in one sentence, then say goodbye and end the call.`;
}

export function buildFirstMessage({ agentName } = {}) {
  const name = agentName || 'Aanya';
  return `Hi, this is ${name} calling from {{projectName}} on behalf of {{execName}}. Am I speaking with {{leadFirstName}}?`;
}

/**
 * Build the provider assistant DTO for an organization.
 * @param {{ org: Object, baseUrl: string, secret: string }} p
 */
export function buildAssistantConfig({ org, baseUrl, secret }) {
  const va = org?.voiceAgent || {};
  const agentName = va.agentName || 'Aanya';
  const hindiSwitching = va.hindiSwitching !== false;
  const voice = { ...DEFAULT_VOICE, ...(va.voice || {}) };
  const serverUrl = `${String(baseUrl).replace(/\/+$/, '')}/api/voice/webhooks/vapi`;
  const server = { url: serverUrl, timeoutSeconds: 20, headers: { 'x-propvantage-secret': secret } };

  const tools = VOICE_TOOLS.map((t) => {
    const tool = {
      type: 'function',
      async: false,
      function: { name: t.name, description: t.description, parameters: t.parameters },
      server,
    };
    if (t.fillers?.length) {
      // Always English: the caller decides the language mid-call, the filler must not pre-empt it.
      tool.messages = [{ type: 'request-start', content: t.fillers[1] || t.fillers[0] }];
    }
    return tool;
  });
  tools.push({ type: 'endCall' });

  const voiceDto = { provider: voice.provider, voiceId: voice.voiceId };
  if (voice.provider === 'cartesia') {
    voiceDto.model = voice.model || 'sonic-3';
    if (voice.language) voiceDto.language = voice.language;
  } else if (voice.provider === '11labs') {
    voiceDto.model = voice.model || 'eleven_flash_v2_5';
  }

  return {
    name: `PropVantage · ${org?.name || 'org'}`.slice(0, 40),
    firstMessageMode: 'assistant-speaks-first',
    firstMessage: buildFirstMessage({ agentName }),
    model: {
      provider: 'anthropic',
      model: process.env.VOICE_LLM_MODEL || 'claude-sonnet-5',
      temperature: 0.4,
      maxTokens: 220,
      messages: [{ role: 'system', content: buildSystemPrompt({ agentName, orgName: org?.name, hindiSwitching }) }],
      tools,
    },
    transcriber: { provider: 'deepgram', model: 'nova-3', language: 'multi' },
    voice: voiceDto,
    serverMessages: ['tool-calls', 'end-of-call-report', 'status-update'],
    server,
    maxDurationSeconds: 600,
    backgroundSound: 'off',
    endCallPhrases: ['goodbye', 'bye bye', 'talk to you later', 'phir milte hain'],
    startSpeakingPlan: { waitSeconds: 0.4 },
    stopSpeakingPlan: { numWords: 2, voiceSeconds: 0.2, backoffSeconds: 1 },
    analysisPlan: {
      summaryPlan: { enabled: true, timeoutSeconds: 20 },
      structuredDataPlan: {
        enabled: true,
        timeoutSeconds: 20,
        schema: {
          type: 'object',
          properties: {
            outcome: { type: 'string', enum: ['qualified', 'site_visit_booked', 'follow_up_set', 'callback_requested', 'not_interested', 'wrong_number', 'no_conversation', 'other'] },
            interest_level: { type: 'string', enum: ['hot', 'warm', 'cold', 'unknown'] },
            objections: { type: 'array', items: { type: 'string' } },
            next_step: { type: 'string' },
            language_used: { type: 'string' },
          },
        },
      },
    },
    artifactPlan: { recordingEnabled: true },
    metadata: { propvantageOrgId: String(org?._id || ''), source: 'propvantage' },
  };
}

/** Stable hash of the config so we only PATCH the provider when something changed. */
export function assistantConfigHash(dto) {
  return crypto.createHash('sha1').update(JSON.stringify(dto)).digest('hex');
}
