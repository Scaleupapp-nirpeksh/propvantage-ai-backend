// File: models/callPlaybookModel.js
// Description: An org-owned "call playbook": WHEN a situation happens, FOR whom,
//   call them AT these times to ACHIEVE this objective, USING these actions, and
//   HAND OVER on these conditions. Created from templates, edited by roles with
//   voice:manage_playbooks. The voice engine itself is unchanged; playbooks decide
//   when it dials and what it pursues.

import mongoose from 'mongoose';

export const TRIGGER_TYPES = [
  'lead.created',          // event
  'lead.followUpMissed',   // scan: follow-up date passed by N hours
  'lead.siteVisitReminder',// scan: site visit scheduled, call N hours before
  'installment.due',       // scan: instalment due in N days
  'installment.overdue',   // phase 2
  'sale.postBooking',      // phase 2
  'milestone.completed',   // phase 2
  'lead.stale',            // phase 2
  'manual',                // on-demand only
];

export const HANDOVER_CONDITIONS = [
  'asks_for_human',
  'price_or_discount',
  'payment_dispute',
  'legal_or_loan',
  'complaint',
  'hot_buyer',
];

const callPlaybookSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    templateKey: { type: String, default: null },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, default: '', maxlength: 400 },
    enabled: { type: Boolean, default: false },

    trigger: {
      type: { type: String, enum: TRIGGER_TYPES, required: true },
      params: { type: mongoose.Schema.Types.Mixed, default: {} }, // hoursAfter, hoursBefore, daysBefore, …
    },

    audience: {
      projects: { type: [mongoose.Schema.Types.ObjectId], default: [] }, // empty = all projects
      minScore: { type: Number, default: null },
      statuses: { type: [String], default: [] },                          // empty = any
      skipIfHumanContactHours: { type: Number, default: 48 },
    },

    timing: {
      window: {
        start: { type: String, default: '10:00' },
        end: { type: String, default: '19:00' },
      },
      delayMinutes: { type: Number, default: 2, min: 0 },
      retry: {
        maxAttempts: { type: Number, default: 2, min: 1, max: 5 },
        afterHours: { type: Number, default: 4, min: 1 },
      },
      overrideOrgGuardrails: { type: Boolean, default: false },
    },

    objective: {
      purpose: { type: String, default: '', maxlength: 2000 },
      openingLine: { type: String, default: '', maxlength: 400 },
      mustAsk: { type: [String], default: [] },
      mustNotSay: { type: [String], default: [] },
      extraInstructions: { type: String, default: '', maxlength: 2000 },
    },

    tools: { type: [String], default: [] }, // subset of voice action names; empty = all

    handover: {
      conditions: { type: [String], default: ['asks_for_human'] },
      notifyAssigned: { type: Boolean, default: true },
      notifyRoles: { type: [String], default: [] }, // user role names, e.g. 'Finance Head'
    },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

callPlaybookSchema.index({ organization: 1, enabled: 1, 'trigger.type': 1 });

const CallPlaybook = mongoose.model('CallPlaybook', callPlaybookSchema);
export default CallPlaybook;
