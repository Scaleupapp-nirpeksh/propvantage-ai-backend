// TEMP server-side diagnostic — reproduces the report-agent call with the server's REAL env
// (key, model, network, DB). Run by the deploy once to surface the true failure cause, then removed.
import 'dotenv/config';
import mongoose from 'mongoose';
import Anthropic from '@anthropic-ai/sdk';
import { runAgentTurn } from './services/reports/agent/agentService.js';
import * as tools from './services/reports/agent/tools.js';
import Project from './models/projectModel.js';

const key = (process.env.ANTHROPIC_API_KEY || '').trim().replace(/^['"]+|['"]+$/g, '');
const model = process.env.REPORT_AGENT_MODEL || 'claude-sonnet-4-6';
console.log(`DIAG keylen=${key.length} first8=${key.slice(0, 8)} okPrefix=${key.startsWith('sk-ant-')} model=${model} node=${process.version}`);

let client;
try {
  client = new Anthropic({ apiKey: key });
  const r = await client.messages.create({ model, max_tokens: 16, messages: [{ role: 'user', content: 'say ok' }] });
  console.log('RAW_ANTHROPIC_OK:', JSON.stringify(r.content));
} catch (e) {
  console.log(`RAW_ANTHROPIC_ERR status=${e.status} name=${e.name} msg=${e.message}`);
  if (e.error) console.log('RAW_ERR_BODY:', JSON.stringify(e.error).slice(0, 400));
  if (e.cause) console.log('RAW_ERR_CAUSE:', String(e.cause).slice(0, 300));
  process.exit(0);
}

try {
  await mongoose.connect(process.env.MONGO_URI);
  const proj = await Project.findOne().select('organization').lean();
  const ctx = { organization: proj?.organization, accessibleProjectIds: null, userPermissions: [], isOwner: true };
  const out = await runAgentTurn(
    { definition: { name: '', scope: { mode: 'portfolio' }, theme: { preset: 'clean' }, blocks: [] }, transcript: [], userMessage: 'Build a simple portfolio report with revenue and collections.' },
    ctx,
    { client, tools, model },
  );
  console.log('AGENT_OK reply=' + (out.reply || '').slice(0, 120));
  console.log('AGENT_BLOCKS=' + JSON.stringify((out.definition.blocks || []).map((b) => b.type)));
} catch (e) {
  console.log(`AGENT_ERR name=${e.name} status=${e.status} msg=${e.message}`);
  console.log('AGENT_STACK:', (e.stack || '').split('\n').slice(0, 6).join(' | '));
} finally {
  await mongoose.disconnect();
}
