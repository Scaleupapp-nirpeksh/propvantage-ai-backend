// TEMP server-side diagnostic — mirrors the FULL postAgentMessage controller body with the
// server's real env/DB to surface the true 500 cause. Removed after diagnosis.
import 'dotenv/config';
import mongoose from 'mongoose';
import Anthropic from '@anthropic-ai/sdk';
import { runAgentTurn } from './services/reports/agent/agentService.js';
import * as tools from './services/reports/agent/tools.js';
import { resolveReportData } from './services/reports/snapshotService.js';
import Project from './models/projectModel.js';
import User from './models/userModel.js';
import ReportAgentSession from './models/reportAgentSession.js';

const key = (process.env.ANTHROPIC_API_KEY || '').trim().replace(/^['"]+|['"]+$/g, '');
const model = process.env.REPORT_AGENT_MODEL || 'claude-sonnet-4-6';
console.log(`DIAG keylen=${key.length} okPrefix=${key.startsWith('sk-ant-')} model=${model} node=${process.version}`);

const client = new Anthropic({ apiKey: key });
await mongoose.connect(process.env.MONGO_URI);
const proj = await Project.findOne().select('organization').lean();
const org = proj?.organization;
const u = await User.findOne({ organization: org }).select('_id').lean();
console.log('org=' + org + ' user=' + (u?._id));

try {
  const session = await ReportAgentSession.create({ organization: org, createdBy: u?._id });
  console.log('SESSION_CREATE_OK ' + session._id);
  const ctx = { organization: org, accessibleProjectIds: null, userPermissions: [], isOwner: true };
  const { definition, reply, transcript } = await runAgentTurn(
    { definition: { name: '', scope: { mode: 'portfolio' }, theme: { preset: 'warm' }, blocks: [] }, transcript: [], userMessage: 'I want to build a weekly whole portfolio , show Leads data , Sales Data , Inventory Data , Payments and Commission data' },
    ctx, { client, tools, model },
  );
  console.log('AGENT_OK blocks=' + (definition.blocks || []).length);
  session.definition = definition;
  session.transcript = transcript;
  await session.save();
  console.log('SESSION_SAVE_OK');
  let previewBlocks = [];
  try { const r = await resolveReportData({ ...definition, organization: org }, { accessibleProjectIds: null }); previewBlocks = r.blocks; } catch (e) { console.log('PREVIEW_ERR ' + e.message); }
  console.log('PREVIEW blocks=' + previewBlocks.length);
  const payload = JSON.stringify({ success: true, data: { sessionId: session._id, reply, definition, previewBlocks } });
  console.log('RESPONSE_SERIALIZE_OK len=' + payload.length);
  await ReportAgentSession.deleteOne({ _id: session._id });
  console.log('FULL_CONTROLLER_REPRO_OK');
} catch (e) {
  console.log('CTRL_ERR name=' + e.name + ' status=' + e.status + ' msg=' + e.message);
  console.log('CTRL_STACK:', (e.stack || '').split('\n').slice(0, 8).join(' | '));
} finally {
  await mongoose.disconnect();
}
