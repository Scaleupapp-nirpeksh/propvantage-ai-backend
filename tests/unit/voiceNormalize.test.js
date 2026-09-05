// tests/unit/voiceNormalize.test.js
import { normalizeToolCalls, normalizeEndOfCall, mapProviderStatus, outcomeFromEndedReason } from '../../services/voice/normalize.js';

describe('voice normalize', () => {
  it('reads toolCallList with object arguments', () => {
    const calls = normalizeToolCalls({ toolCallList: [{ id: 't1', name: 'get_available_units', arguments: { unit_type: '3BHK' } }] });
    expect(calls).toEqual([{ id: 't1', name: 'get_available_units', args: { unit_type: '3BHK' } }]);
  });

  it('parses JSON-string arguments and falls back to toolWithToolCallList', () => {
    const calls = normalizeToolCalls({
      toolWithToolCallList: [{ name: 'schedule_site_visit', toolCall: { id: 't2', parameters: '{"datetime_iso":"2026-09-13T11:00:00+05:30"}' } }],
    });
    expect(calls[0]).toEqual({ id: 't2', name: 'schedule_site_visit', args: { datetime_iso: '2026-09-13T11:00:00+05:30' } });
  });

  it('normalizes an end-of-call report with duration derived from timestamps', () => {
    const facts = normalizeEndOfCall({
      type: 'end-of-call-report',
      endedReason: 'customer-ended-call',
      call: { id: 'c1', startedAt: '2026-09-05T10:00:00.000Z', endedAt: '2026-09-05T10:03:30.000Z', cost: 0.42, assistantOverrides: { variableValues: { callSessionId: 's1' } } },
      artifact: {
        messages: [
          { role: 'system', message: 'ignored' },
          { role: 'bot', message: 'Hi, am I speaking with Rahul?', secondsFromStart: 1 },
          { role: 'user', message: 'Yes', secondsFromStart: 3 },
        ],
        recordingUrl: 'https://rec/1.wav',
      },
      analysis: { summary: 'Qualified.', structuredData: { outcome: 'qualified' } },
    });
    expect(facts.providerCallId).toBe('c1');
    expect(facts.durationSec).toBe(210);
    expect(facts.costUsd).toBe(0.42);
    expect(facts.messages).toHaveLength(2);
    expect(facts.messages[0].role).toBe('assistant');
    expect(facts.transcript).toMatch(/^AI: Hi, am I speaking with Rahul\?\nUser: Yes$/);
    expect(facts.recordingUrl).toBe('https://rec/1.wav');
    expect(facts.summary).toBe('Qualified.');
    expect(facts.structuredData.outcome).toBe('qualified');
    expect(facts.variableValues.callSessionId).toBe('s1');
  });

  it('maps provider statuses and ended reasons', () => {
    expect(mapProviderStatus('in-progress')).toBe('in-progress');
    expect(mapProviderStatus('scheduled')).toBe('queued');
    expect(mapProviderStatus('weird')).toBeNull();
    expect(outcomeFromEndedReason('customer-did-not-answer')).toBe('No answer');
    expect(outcomeFromEndedReason('voicemail')).toBe('Reached voicemail');
    expect(outcomeFromEndedReason('customer-ended-call')).toBe('');
  });
});
