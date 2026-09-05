// tests/unit/voicePlaybooks.test.js — DB-free coverage of the playbook engine's pure parts
import { PLAYBOOK_TEMPLATES, V1_TEMPLATES, playbookFromTemplate } from '../../services/voice/playbooks/templates.js';
import { TRIGGER_TYPES, HANDOVER_CONDITIONS } from '../../models/callPlaybookModel.js';
import { VOICE_ACTION_NAMES } from '../../services/voice/agentActions.js';
import {
  fill, allowedTools, isToolAllowed, buildMissionVariables, effectiveWindow, isWithinWindow,
  nextWindowOpen, inCooldown, retryAt, dedup, describeTrigger,
} from '../../services/voice/playbooks/mission.js';

describe('playbook templates', () => {
  it('are internally valid (triggers, tools, handover conditions, opening lines)', () => {
    for (const t of PLAYBOOK_TEMPLATES) {
      expect(TRIGGER_TYPES).toContain(t.trigger.type);
      for (const tool of t.tools) expect(VOICE_ACTION_NAMES).toContain(tool);
      for (const c of t.handover.conditions) expect(HANDOVER_CONDITIONS).toContain(c);
      expect(t.objective.openingLine).toMatch(/\{\{agentName\}\}/);
      expect(t.timing.window.start < t.timing.window.end).toBe(true);
    }
    expect(V1_TEMPLATES.map((t) => t.key)).toEqual(['new_enquiry', 'missed_follow_up', 'site_visit_reminder', 'payment_reminder']);
  });

  it('copies a template into a disabled playbook body', () => {
    const pb = playbookFromTemplate('payment_reminder');
    expect(pb.enabled).toBe(false);
    expect(pb.templateKey).toBe('payment_reminder');
    expect(pb.phase).toBeUndefined();
    expect(pb.trigger).toEqual({ type: 'installment.due', params: { daysBefore: 3 } });
    expect(playbookFromTemplate('nope')).toBeNull();
  });
});

describe('mission variables', () => {
  const vars = { agentName: 'Aanya', projectName: 'Skyline', execName: 'Priya', leadFirstName: 'Rahul', installmentAmount: '₹18 L', installmentDue: 'the 15th', installmentLabel: '#3' };

  it('fills variables and leaves unknown ones intact', () => {
    expect(fill('Hi {{leadFirstName}} from {{projectName}} {{unknown}}', vars)).toBe('Hi Rahul from Skyline {{unknown}}');
  });

  it('renders a playbook into a mission block with allow-list and handover rules', () => {
    const pb = playbookFromTemplate('payment_reminder');
    const m = buildMissionVariables(pb, vars);
    expect(m.playbookName).toBe('Payment reminder');
    expect(m.openingLine).toMatch(/^Hi Rahul, this is Aanya from Skyline, calling on behalf of Priya/);
    expect(m.callMission).toMatch(/₹18 L .* due on the 15th/);
    expect(m.callMission).toMatch(/Actions available on this call: set a follow-up date; arrange a callback from Priya; mark do-not-call/);
    expect(m.callMission).toMatch(/Hand over .* when: the caller asks to speak to a person; the caller disputes an amount or a due date; the caller raises a complaint/);
    expect(m.callMission).not.toMatch(/book a site visit/);
  });

  it('falls back to the default qualification mission without a playbook', () => {
    const m = buildMissionVariables(null, vars);
    expect(m.openingLine).toBe('Hi, this is Aanya calling from Skyline on behalf of Priya. Am I speaking with Rahul?');
    expect(m.callMission).toMatch(/offer a site visit/);
  });

  it('enforces the tool allow-list (empty list = everything)', () => {
    const pb = playbookFromTemplate('payment_reminder');
    expect(isToolAllowed(pb, 'set_follow_up')).toBe(true);
    expect(isToolAllowed(pb, 'schedule_site_visit')).toBe(false);
    expect(allowedTools({ tools: [] })).toEqual(VOICE_ACTION_NAMES);
    expect(allowedTools({ tools: ['bogus', 'mark_do_not_call'] })).toEqual(['mark_do_not_call']);
  });
});

describe('guardrail arithmetic (IST)', () => {
  const org = { voiceAgent: { hardWindow: { start: '09:00', end: '21:00' }, cooldownDays: 3 } };

  it('intersects playbook and org windows unless overridden', () => {
    expect(effectiveWindow({ timing: { window: { start: '08:00', end: '22:00' } } }, org)).toEqual({ start: '09:00', end: '21:00' });
    expect(effectiveWindow({ timing: { window: { start: '10:00', end: '18:00' } } }, org)).toEqual({ start: '10:00', end: '18:00' });
    expect(effectiveWindow({ timing: { window: { start: '08:00', end: '22:00' }, overrideOrgGuardrails: true } }, org)).toEqual({ start: '08:00', end: '22:00' });
  });

  it('knows whether a moment is inside the window and when it next opens', () => {
    const w = { start: '10:00', end: '19:00' };
    const at = (isoUtc) => new Date(isoUtc);
    expect(isWithinWindow(w, at('2026-09-05T05:30:00Z'))).toBe(true);   // 11:00 IST
    expect(isWithinWindow(w, at('2026-09-05T15:30:00Z'))).toBe(false);  // 21:00 IST
    expect(nextWindowOpen(w, at('2026-09-05T02:00:00Z')).toISOString()).toBe('2026-09-05T04:30:00.000Z'); // 07:30 IST → 10:00 IST same day
    expect(nextWindowOpen(w, at('2026-09-05T15:30:00Z')).toISOString()).toBe('2026-09-06T04:30:00.000Z'); // 21:00 IST → 10:00 IST next day
    expect(nextWindowOpen(w, at('2026-09-05T05:30:00Z')).toISOString()).toBe('2026-09-05T05:30:00.000Z'); // already inside
  });

  it('applies cooldown and clamps retries into the window', () => {
    const now = new Date('2026-09-05T05:30:00Z');
    expect(inCooldown(new Date('2026-09-04T05:30:00Z'), 3, now)).toBe(true);
    expect(inCooldown(new Date('2026-09-01T05:30:00Z'), 3, now)).toBe(false);
    expect(inCooldown(null, 3, now)).toBe(false);
    // 11:00 IST + 12h = 23:00 IST → next day 10:00 IST
    expect(retryAt(12, { start: '10:00', end: '19:00' }, now).toISOString()).toBe('2026-09-06T04:30:00.000Z');
  });

  it('builds stable dedup keys and readable trigger labels', () => {
    expect(dedup.followUpMissed('L1', '2026-09-05T05:30:00.000Z')).toBe('fu:L1:2026-09-05T05:30');
    expect(dedup.installmentDue('I9')).toBe('inst:I9:due');
    expect(describeTrigger({ type: 'installment.due', params: { daysBefore: 5 } })).toBe('5 days before an instalment is due');
    expect(describeTrigger({ type: 'lead.created' })).toBe('When a new lead is created');
  });
});
