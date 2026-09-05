// File: models/callSessionModel.js
// Description: One AI voice call (outbound or inbound) placed through a voice
//   provider (Vapi today). Holds the provider call id, lifecycle status, the
//   transcript/recording delivered at end-of-call, and every tool action the
//   agent took during the call so the lead record and the call stay auditable.

import mongoose from 'mongoose';

const actionSchema = new mongoose.Schema(
  {
    tool: { type: String, required: true },
    args: { type: mongoose.Schema.Types.Mixed },
    result: { type: mongoose.Schema.Types.Mixed },
    ok: { type: Boolean, default: true },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    role: { type: String }, // 'assistant' | 'user' | 'system' | 'tool'
    text: { type: String },
    at: { type: Number }, // seconds from call start (provider-relative)
  },
  { _id: false }
);

const callSessionSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    lead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', index: true },
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' },
    assignedUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    initiatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    provider: { type: String, enum: ['vapi'], default: 'vapi' },
    providerCallId: { type: String, index: true },
    providerAssistantId: { type: String },
    direction: { type: String, enum: ['outbound', 'inbound'], default: 'outbound' },
    useCase: { type: String, enum: ['lead_qualification', 'follow_up', 'test'], default: 'lead_qualification' },
    trigger: { type: String, enum: ['manual', 'auto_new_lead', 'test', 'playbook'], default: 'manual' },

    status: {
      type: String,
      enum: ['queued', 'ringing', 'in-progress', 'forwarding', 'ended', 'failed'],
      default: 'queued',
      index: true,
    },
    customerNumber: { type: String },
    error: { type: String },

    startedAt: { type: Date },
    endedAt: { type: Date },
    durationSec: { type: Number, default: 0 },
    costUsd: { type: Number, default: 0 },
    endedReason: { type: String },

    transcript: { type: String, default: '' },
    messages: { type: [messageSchema], default: [] },
    recordingUrl: { type: String },
    summary: { type: String, default: '' },
    outcome: { type: String, default: '' },
    structuredData: { type: mongoose.Schema.Types.Mixed },
    analysis: { type: mongoose.Schema.Types.Mixed },

    actionsTaken: { type: [actionSchema], default: [] },
    handoffRequested: { type: Boolean, default: false },
    doNotCall: { type: Boolean, default: false },
    interaction: { type: mongoose.Schema.Types.ObjectId, ref: 'Interaction' },
    playbook: { type: mongoose.Schema.Types.ObjectId, ref: 'CallPlaybook', index: true },
    callJob: { type: mongoose.Schema.Types.ObjectId, ref: 'CallJob' },
    variableValues: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

callSessionSchema.index({ organization: 1, createdAt: -1 });
callSessionSchema.index({ provider: 1, providerCallId: 1 }, { unique: true, sparse: true });

const CallSession = mongoose.model('CallSession', callSessionSchema);

export default CallSession;
