// File: services/voice/normalize.js
// Description: Pure normalizers for the voice provider's webhook payloads so the
//   rest of the module (and the tests) work on one canonical shape regardless
//   of the exact envelope the provider sends.

/**
 * Extract the tool calls from a Vapi `tool-calls` server message.
 * Vapi sends both `toolCallList` and `toolWithToolCallList`; arguments may be a
 * JSON string or an object depending on the model provider.
 * @returns {{ id: string, name: string, args: Object }[]}
 */
export function normalizeToolCalls(message = {}) {
  const out = [];
  const list = Array.isArray(message.toolCallList) ? message.toolCallList : [];
  for (const tc of list) {
    if (!tc) continue;
    const name = tc.name || tc.function?.name;
    let args = tc.arguments ?? tc.function?.arguments ?? tc.parameters ?? {};
    if (typeof args === 'string') {
      try { args = JSON.parse(args); } catch { args = { _raw: args }; }
    }
    out.push({ id: tc.id, name, args: args || {} });
  }
  if (out.length) return out;

  const wrapped = Array.isArray(message.toolWithToolCallList) ? message.toolWithToolCallList : [];
  for (const w of wrapped) {
    const tc = w?.toolCall || {};
    const name = w?.name || w?.function?.name || tc.function?.name;
    let args = tc.parameters ?? tc.arguments ?? tc.function?.arguments ?? {};
    if (typeof args === 'string') {
      try { args = JSON.parse(args); } catch { args = { _raw: args }; }
    }
    out.push({ id: tc.id, name, args: args || {} });
  }
  return out;
}

/**
 * Canonical end-of-call facts from a Vapi `end-of-call-report` message.
 * @returns {{ providerCallId, endedReason, startedAt, endedAt, durationSec, costUsd,
 *   transcript, messages, recordingUrl, summary, structuredData, successEvaluation, variableValues }}
 */
export function normalizeEndOfCall(message = {}) {
  const call = message.call || {};
  const artifact = message.artifact || {};
  const analysis = message.analysis || {};

  const startedAt = message.startedAt || call.startedAt || null;
  const endedAt = message.endedAt || call.endedAt || null;
  let durationSec = Number(message.durationSeconds ?? call.durationSeconds ?? 0) || 0;
  if (!durationSec && startedAt && endedAt) {
    durationSec = Math.max(0, Math.round((new Date(endedAt) - new Date(startedAt)) / 1000));
  }

  const messages = (Array.isArray(artifact.messages) ? artifact.messages : [])
    .filter((m) => m && (m.message || m.content) && m.role !== 'system')
    .map((m) => ({
      role: m.role === 'bot' ? 'assistant' : m.role,
      text: m.message || m.content || '',
      at: typeof m.secondsFromStart === 'number' ? m.secondsFromStart : undefined,
    }));

  let transcript = artifact.transcript || '';
  if (!transcript && messages.length) {
    transcript = messages.map((m) => `${m.role === 'assistant' ? 'AI' : 'User'}: ${m.text}`).join('\n');
  }

  return {
    providerCallId: call.id || null,
    endedReason: message.endedReason || call.endedReason || '',
    startedAt: startedAt ? new Date(startedAt) : null,
    endedAt: endedAt ? new Date(endedAt) : null,
    durationSec,
    costUsd: Number(message.cost ?? call.cost ?? 0) || 0,
    transcript,
    messages,
    recordingUrl: artifact.recordingUrl || artifact.recording?.mono?.combinedUrl || artifact.stereoRecordingUrl || null,
    summary: analysis.summary || '',
    structuredData: analysis.structuredData || null,
    successEvaluation: analysis.successEvaluation ?? null,
    variableValues: call.assistantOverrides?.variableValues || artifact.variableValues || {},
  };
}

/**
 * Map a provider status-update / endedReason into our session status + outcome hints.
 */
export function mapProviderStatus(status) {
  const s = String(status || '').toLowerCase();
  if (['queued', 'ringing', 'in-progress', 'forwarding', 'ended'].includes(s)) return s;
  if (s === 'scheduled') return 'queued';
  return null;
}

/** Human outcome for ended calls that never became a conversation. */
export function outcomeFromEndedReason(endedReason) {
  const r = String(endedReason || '').toLowerCase();
  if (!r) return '';
  if (r.includes('voicemail')) return 'Reached voicemail';
  if (r.includes('did-not-answer') || r.includes('no-answer') || r.includes('busy')) return 'No answer';
  if (r.includes('customer-ended-call') || r.includes('customer-hung-up')) return '';
  if (r.includes('error') || r.includes('failed') || r.includes('twilio') || r.includes('sip')) return 'Call failed';
  if (r.includes('max-duration')) return 'Ended at maximum duration';
  return '';
}
