// tests/unit/voiceWebhookAuth.test.js
import { verifyVoiceWebhook, VOICE_WEBHOOK_HEADER } from '../../services/voice/webhookAuth.js';

const reqWith = (value) => ({ get: (h) => (h === VOICE_WEBHOOK_HEADER ? value : undefined), headers: {} });

describe('verifyVoiceWebhook', () => {
  it('accepts the matching secret and rejects a wrong or missing one', () => {
    expect(verifyVoiceWebhook(reqWith('abc'), { secret: 'abc', env: 'production' })).toBe(true);
    expect(verifyVoiceWebhook(reqWith('abd'), { secret: 'abc', env: 'production' })).toBe(false);
    expect(verifyVoiceWebhook(reqWith(''), { secret: 'abc', env: 'production' })).toBe(false);
    expect(verifyVoiceWebhook(reqWith('abcd'), { secret: 'abc', env: 'production' })).toBe(false);
  });

  it('requires a configured secret in production but not in development', () => {
    expect(verifyVoiceWebhook(reqWith('x'), { secret: '', env: 'production' })).toBe(false);
    expect(verifyVoiceWebhook(reqWith(undefined), { secret: '', env: 'development' })).toBe(true);
  });
});
