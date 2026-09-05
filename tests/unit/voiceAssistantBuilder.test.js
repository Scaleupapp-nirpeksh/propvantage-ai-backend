// tests/unit/voiceAssistantBuilder.test.js
import { buildAssistantConfig, assistantConfigHash, VOICE_TOOLS, buildSystemPrompt } from '../../services/voice/assistantBuilder.js';

const org = { _id: 'org1', name: 'Demo Realty', voiceAgent: { agentName: 'Aanya', hindiSwitching: true } };

describe('buildAssistantConfig', () => {
  it('points every tool and the assistant server at the webhook with the secret header', () => {
    const dto = buildAssistantConfig({ org, baseUrl: 'https://api.example.com/', secret: 'sekret' });
    expect(dto.server.url).toBe('https://api.example.com/api/voice/webhooks/vapi');
    expect(dto.server.headers['x-propvantage-secret']).toBe('sekret');
    const fnTools = dto.model.tools.filter((t) => t.type === 'function');
    expect(fnTools.map((t) => t.function.name)).toEqual(VOICE_TOOLS.map((t) => t.name));
    for (const t of fnTools) {
      expect(t.server.url).toBe(dto.server.url);
      expect(t.server.headers['x-propvantage-secret']).toBe('sekret');
      expect(t.function.parameters.type).toBe('object');
    }
    expect(dto.model.tools.some((t) => t.type === 'endCall')).toBe(true);
  });

  it('uses Claude via Anthropic, a multilingual transcriber, and the configured voice', () => {
    const dto = buildAssistantConfig({ org, baseUrl: 'https://x', secret: 's' });
    expect(dto.model.provider).toBe('anthropic');
    expect(dto.model.model).toMatch(/^claude-/);
    expect(dto.transcriber).toEqual({ provider: 'deepgram', model: 'nova-3', language: 'multi' });
    expect(dto.voice.provider).toBe('cartesia');
    expect(dto.voice.voiceId).toBeTruthy();
    expect(dto.serverMessages).toEqual(expect.arrayContaining(['tool-calls', 'end-of-call-report']));
  });

  it('templates per-call variables into the prompt and first message, never hardcoding a lead', () => {
    const dto = buildAssistantConfig({ org, baseUrl: 'https://x', secret: 's' });
    const sys = dto.model.messages[0].content;
    for (const v of ['{{leadFirstName}}', '{{projectName}}', '{{execName}}', '{{inventorySummary}}', '{{knownDetails}}', '{{nowIST}}', '{{timeOfDay}}']) {
      expect(sys).toContain(v);
    }
    expect(dto.firstMessage).toContain('{{leadFirstName}}');
    expect(dto.firstMessage).toContain('Aanya');
    expect(sys).toMatch(/never claim to be \{\{execName\}\}/);
  });

  it('keeps tool fillers in English regardless of the Hindi-switching setting', () => {
    for (const hindiSwitching of [true, false]) {
      const dto = buildAssistantConfig({ org: { ...org, voiceAgent: { hindiSwitching } }, baseUrl: 'https://x', secret: 's' });
      const fillers = dto.model.tools.filter((t) => t.messages?.length).map((t) => t.messages[0].content);
      expect(fillers.length).toBeGreaterThan(0);
      for (const f of fillers) expect(f).toMatch(/^(One moment|Booking that)/);
    }
    const sys = buildSystemPrompt({ hindiSwitching: true });
    expect(sys).toMatch(/Do not use any Hindi words or phrases unless the CALLER has already spoken Hindi/);
  });

  it('drops the Hindi instruction when switching is disabled and hashes deterministically', () => {
    const a = buildAssistantConfig({ org, baseUrl: 'https://x', secret: 's' });
    const b = buildAssistantConfig({ org, baseUrl: 'https://x', secret: 's' });
    expect(assistantConfigHash(a)).toBe(assistantConfigHash(b));
    const noHindi = buildAssistantConfig({ org: { ...org, voiceAgent: { hindiSwitching: false } }, baseUrl: 'https://x', secret: 's' });
    expect(assistantConfigHash(noHindi)).not.toBe(assistantConfigHash(a));
    expect(buildSystemPrompt({ hindiSwitching: false })).not.toMatch(/switch and continue in natural Hinglish/);
    expect(buildSystemPrompt({ hindiSwitching: false })).toMatch(/Stay in English for the whole call/);
  });
});
