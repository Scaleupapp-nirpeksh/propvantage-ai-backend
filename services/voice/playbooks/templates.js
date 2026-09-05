// File: services/voice/playbooks/templates.js
// Description: The playbook template library. A template is a complete, sensible
//   playbook an admin can switch on as-is or edit. v1 ships four; phase-2 entries
//   are defined (so the data model is proven) but hidden from the picker.

export const PLAYBOOK_TEMPLATES = [
  {
    key: 'new_enquiry',
    phase: 1,
    name: 'New enquiry qualification',
    description: 'Call every new lead within minutes: understand budget, configuration and timeline, quote live inventory, book a site visit.',
    trigger: { type: 'lead.created', params: {} },
    audience: { projects: [], minScore: null, statuses: ['New'], skipIfHumanContactHours: 2 },
    timing: { window: { start: '09:30', end: '20:30' }, delayMinutes: 2, retry: { maxAttempts: 2, afterHours: 4 }, overrideOrgGuardrails: false },
    objective: {
      purpose: 'They just enquired about {{projectName}}. Understand what they are looking for — configuration, budget, timeline, floor or facing preferences — save each detail, answer availability and price questions only from live inventory, and offer a site visit.',
      openingLine: 'Hi, this is {{agentName}} calling from {{projectName}} on behalf of {{execName}}. Am I speaking with {{leadFirstName}}?',
      mustAsk: ['Which configuration are they looking for', 'Their budget range', 'When they plan to buy or move', 'Whether they would like to visit the site'],
      mustNotSay: ['Discounts or negotiable pricing', 'Possession or delivery dates', 'Loan approval or eligibility'],
      extraInstructions: '',
    },
    tools: ['get_available_units', 'update_lead_qualification', 'schedule_site_visit', 'set_follow_up', 'request_human_callback', 'mark_do_not_call'],
    handover: { conditions: ['asks_for_human', 'price_or_discount', 'legal_or_loan', 'hot_buyer'], notifyAssigned: true, notifyRoles: [] },
  },
  {
    key: 'missed_follow_up',
    phase: 1,
    name: 'Missed follow-up rescue',
    description: 'When a promised follow-up date slips by a day, the agent re-engages the buyer and re-books the next step.',
    trigger: { type: 'lead.followUpMissed', params: { hoursAfter: 24 } },
    audience: { projects: [], minScore: null, statuses: ['New', 'Qualified', 'Site Visit Completed', 'Negotiating', 'Revived'], skipIfHumanContactHours: 48 },
    timing: { window: { start: '10:00', end: '19:00' }, delayMinutes: 0, retry: { maxAttempts: 2, afterHours: 24 }, overrideOrgGuardrails: false },
    objective: {
      purpose: 'A follow-up that was promised has been missed. Apologise lightly for the gap, check whether they are still considering {{projectName}}, find out what has changed, answer questions from live inventory, and re-book either a site visit or a specific follow-up.',
      openingLine: 'Hi {{leadFirstName}}, this is {{agentName}} from {{projectName}}, calling on behalf of {{execName}}. We were due to get back to you — is this a good time for a minute?',
      mustAsk: ['Are they still looking', 'What has changed since they last spoke to us', 'What would help them decide'],
      mustNotSay: ['Blame anyone for the missed follow-up', 'Discounts or negotiable pricing'],
      extraInstructions: 'If they have already bought elsewhere, thank them, mark the outcome honestly, and end the call warmly.',
    },
    tools: ['get_available_units', 'update_lead_qualification', 'schedule_site_visit', 'set_follow_up', 'request_human_callback', 'mark_do_not_call'],
    handover: { conditions: ['asks_for_human', 'price_or_discount', 'complaint', 'hot_buyer'], notifyAssigned: true, notifyRoles: [] },
  },
  {
    key: 'site_visit_reminder',
    phase: 1,
    name: 'Site-visit reminder',
    description: 'The day before a scheduled site visit: confirm they are coming, reschedule if not, and share what to expect.',
    trigger: { type: 'lead.siteVisitReminder', params: { hoursBefore: 20 } },
    audience: { projects: [], minScore: null, statuses: [], skipIfHumanContactHours: 12 },
    timing: { window: { start: '10:00', end: '19:30' }, delayMinutes: 0, retry: { maxAttempts: 2, afterHours: 3 }, overrideOrgGuardrails: false },
    objective: {
      purpose: 'Confirm the site visit scheduled for {{visitWhen}} at {{projectName}}. If they cannot make it, reschedule on the spot. Mention who will meet them ({{execName}}) and ask if anyone is joining them.',
      openingLine: 'Hi {{leadFirstName}}, this is {{agentName}} from {{projectName}}. I am calling about your site visit {{visitWhen}} — are we still on?',
      mustAsk: ['Confirm the time works', 'How many people are coming', 'Anything specific they want to see'],
      mustNotSay: ['Pricing beyond what live inventory shows', 'Discounts'],
      extraInstructions: 'Keep this call under two minutes.',
    },
    tools: ['schedule_site_visit', 'set_follow_up', 'request_human_callback', 'mark_do_not_call', 'get_available_units'],
    handover: { conditions: ['asks_for_human', 'complaint'], notifyAssigned: true, notifyRoles: [] },
  },
  {
    key: 'payment_reminder',
    phase: 1,
    name: 'Payment reminder',
    description: 'A few days before an instalment falls due: a courteous reminder, confirm the payment date, offer to send the payment details.',
    trigger: { type: 'installment.due', params: { daysBefore: 3 } },
    audience: { projects: [], minScore: null, statuses: [], skipIfHumanContactHours: 24 },
    timing: { window: { start: '10:00', end: '18:30' }, delayMinutes: 0, retry: { maxAttempts: 2, afterHours: 24 }, overrideOrgGuardrails: false },
    objective: {
      purpose: 'Remind them courteously that instalment {{installmentLabel}} of {{installmentAmount}} for their home at {{projectName}} is due on {{installmentDue}}. Confirm when they plan to pay, offer to have the payment details sent on WhatsApp, and record the date they commit to as a follow-up. If they dispute the amount or date, do not argue — hand over.',
      openingLine: 'Hi {{leadFirstName}}, this is {{agentName}} from {{projectName}}, calling on behalf of {{execName}} about your upcoming instalment. Is this a good time?',
      mustAsk: ['When they plan to make the payment', 'Whether they need the payment details sent again'],
      mustNotSay: ['Late fees or penalties', 'Legal consequences', 'Any figure other than the instalment amount you were given'],
      extraInstructions: 'Tone: warm and respectful — they are a customer, not a debtor.',
    },
    tools: ['set_follow_up', 'request_human_callback', 'mark_do_not_call'],
    handover: { conditions: ['asks_for_human', 'payment_dispute', 'complaint'], notifyAssigned: true, notifyRoles: ['Finance Head'] },
  },
  // ── Phase 2 (defined, hidden from the picker) ──────────────────────────
  {
    key: 'overdue_collection', phase: 2, name: 'Overdue collection',
    description: 'After an instalment is past due: capture a promise-to-pay date; escalate on dispute.',
    trigger: { type: 'installment.overdue', params: { daysAfter: 2 } },
    audience: { projects: [], minScore: null, statuses: [], skipIfHumanContactHours: 24 },
    timing: { window: { start: '10:00', end: '18:00' }, delayMinutes: 0, retry: { maxAttempts: 3, afterHours: 48 }, overrideOrgGuardrails: false },
    objective: { purpose: 'The instalment is overdue. Politely establish when it will be paid and record that date.', openingLine: 'Hi {{leadFirstName}}, this is {{agentName}} from {{projectName}} on behalf of {{execName}}.', mustAsk: ['Payment date'], mustNotSay: ['Threats', 'Legal consequences'], extraInstructions: '' },
    tools: ['set_follow_up', 'request_human_callback', 'mark_do_not_call'],
    handover: { conditions: ['asks_for_human', 'payment_dispute', 'complaint'], notifyAssigned: true, notifyRoles: ['Finance Head'] },
  },
  {
    key: 'post_booking_welcome', phase: 2, name: 'Post-booking welcome',
    description: 'A week after booking: welcome, documents checklist, next milestone.',
    trigger: { type: 'sale.postBooking', params: { daysAfter: 7 } },
    audience: { projects: [], minScore: null, statuses: [], skipIfHumanContactHours: 48 },
    timing: { window: { start: '10:00', end: '19:00' }, delayMinutes: 0, retry: { maxAttempts: 1, afterHours: 24 }, overrideOrgGuardrails: false },
    objective: { purpose: 'Welcome them as a new homeowner at {{projectName}}; check if they have questions; note anything they need.', openingLine: 'Hi {{leadFirstName}}, this is {{agentName}} from {{projectName}} — congratulations again on your booking!', mustAsk: ['Any questions so far'], mustNotSay: ['Possession dates'], extraInstructions: '' },
    tools: ['set_follow_up', 'request_human_callback'],
    handover: { conditions: ['asks_for_human', 'complaint', 'legal_or_loan'], notifyAssigned: true, notifyRoles: ['CRM Head'] },
  },
  {
    key: 'milestone_update', phase: 2, name: 'Construction milestone update',
    description: 'When a milestone completes: inform booked buyers and invite them to see progress.',
    trigger: { type: 'milestone.completed', params: {} },
    audience: { projects: [], minScore: null, statuses: [], skipIfHumanContactHours: 24 },
    timing: { window: { start: '10:00', end: '19:00' }, delayMinutes: 60, retry: { maxAttempts: 1, afterHours: 24 }, overrideOrgGuardrails: false },
    objective: { purpose: 'Share that {{milestoneName}} is complete at {{projectName}} and invite them to visit.', openingLine: 'Hi {{leadFirstName}}, this is {{agentName}} from {{projectName}} with a quick construction update.', mustAsk: [], mustNotSay: ['Possession dates'], extraInstructions: '' },
    tools: ['schedule_site_visit', 'set_follow_up', 'request_human_callback'],
    handover: { conditions: ['asks_for_human', 'complaint'], notifyAssigned: true, notifyRoles: [] },
  },
  {
    key: 'stale_lead_revival', phase: 2, name: 'Stale-lead revival',
    description: 'No contact for 30 days: one polite check-in, then stop.',
    trigger: { type: 'lead.stale', params: { daysSilent: 30 } },
    audience: { projects: [], minScore: 40, statuses: ['New', 'Qualified', 'Site Visit Completed'], skipIfHumanContactHours: 72 },
    timing: { window: { start: '11:00', end: '18:00' }, delayMinutes: 0, retry: { maxAttempts: 1, afterHours: 24 }, overrideOrgGuardrails: false },
    objective: { purpose: 'A single, light check-in: are they still looking? Offer fresh availability from live inventory.', openingLine: 'Hi {{leadFirstName}}, this is {{agentName}} from {{projectName}} — just checking in, is this a good time?', mustAsk: ['Still looking?'], mustNotSay: ['Discounts'], extraInstructions: 'One attempt only. Respect a no.' },
    tools: ['get_available_units', 'update_lead_qualification', 'schedule_site_visit', 'set_follow_up', 'mark_do_not_call'],
    handover: { conditions: ['asks_for_human', 'hot_buyer'], notifyAssigned: true, notifyRoles: [] },
  },
];

export const V1_TEMPLATES = PLAYBOOK_TEMPLATES.filter((t) => t.phase === 1);

export function getTemplate(key) {
  return PLAYBOOK_TEMPLATES.find((t) => t.key === key) || null;
}

/** Deep-copy a template into a playbook document body (without org / ids). */
export function playbookFromTemplate(key) {
  const t = getTemplate(key);
  if (!t) return null;
  const { phase, ...rest } = JSON.parse(JSON.stringify(t));
  return { ...rest, templateKey: key, enabled: false };
}
