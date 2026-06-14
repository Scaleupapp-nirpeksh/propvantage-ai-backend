// File: models/reportAgentSession.js
// Description: A report-agent conversation: the running transcript plus the working
// ReportDefinition the agent is composing. Created/updated by the /reports/agent/* routes.
import mongoose from 'mongoose';

const turnSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, default: '' },
  },
  { _id: false }
);

const reportAgentSessionSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    templateId: { type: mongoose.Schema.Types.ObjectId, ref: 'ReportTemplate', default: null },
    // The working report definition the agent is editing (same shape as a template's editable fields).
    definition: { type: mongoose.Schema.Types.Mixed, default: () => ({ name: '', scope: { mode: 'portfolio' }, theme: { preset: 'clean' }, blocks: [] }) },
    transcript: { type: [turnSchema], default: [] },
    status: { type: String, enum: ['active', 'archived'], default: 'active' },
  },
  { timestamps: true }
);

const ReportAgentSession = mongoose.models.ReportAgentSession
  || mongoose.model('ReportAgentSession', reportAgentSessionSchema);

export default ReportAgentSession;
