// File: controllers/reportAgentController.js
import asyncHandler from 'express-async-handler';
import Anthropic from '@anthropic-ai/sdk';
import ReportAgentSession from '../models/reportAgentSession.js';
import { runAgentTurn } from '../services/reports/agent/agentService.js';
import * as tools from '../services/reports/agent/tools.js';
import { resolveReportData } from '../services/reports/snapshotService.js';

const MODEL = process.env.REPORT_AGENT_MODEL || 'claude-sonnet-4-6';
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

// ctx is built ONLY from the authenticated request — never from model-emitted tool args.
const ctxFromReq = (req) => ({
  organization: req.user.organization,
  accessibleProjectIds: req.accessibleProjectIds,
  userPermissions: req.userPermissions || [],
  isOwner: req.isOwner || false,
});

/**
 * @desc  Send a message to the report agent; returns the updated definition + a live preview.
 * @route POST /api/reports/agent/message   body: { sessionId?, message }
 * @access Private (reports:manage)
 */
export const postAgentMessage = asyncHandler(async (req, res) => {
  if (!client) { res.status(503); throw new Error('AI is not configured.'); }
  const { sessionId, message } = req.body || {};
  if (!message || !String(message).trim()) { res.status(400); throw new Error('A message is required.'); }

  let session = sessionId
    ? await ReportAgentSession.findOne({ _id: sessionId, organization: req.user.organization })
    : null;
  if (sessionId && !session) { res.status(404); throw new Error('Session not found.'); }
  if (!session) {
    session = await ReportAgentSession.create({ organization: req.user.organization, createdBy: req.user._id });
  }

  const workingDefinition = (req.body?.definition && typeof req.body.definition === 'object')
    ? req.body.definition
    : session.definition;

  const ctx = ctxFromReq(req);
  const { definition, reply, transcript } = await runAgentTurn(
    { definition: workingDefinition, transcript: session.transcript, userMessage: String(message) },
    ctx,
    { client, tools, model: MODEL },
  );

  session.definition = definition;
  session.transcript = transcript;
  await session.save();

  // Live preview of the (possibly updated) definition so the canvas can render real data.
  let previewBlocks = [];
  try {
    const resolved = await resolveReportData({ ...definition, organization: req.user.organization }, { accessibleProjectIds: req.accessibleProjectIds });
    previewBlocks = resolved.blocks;
  } catch (err) { previewBlocks = []; } // e.g. scope not yet chosen / inaccessible — canvas shows empty

  res.json({ success: true, data: { sessionId: session._id, reply, definition, previewBlocks } });
});

/**
 * @desc  Resume a session.
 * @route GET /api/reports/agent/sessions/:id
 * @access Private (reports:manage)
 */
export const getAgentSession = asyncHandler(async (req, res) => {
  const session = await ReportAgentSession.findOne({ _id: req.params.id, organization: req.user.organization });
  if (!session) { res.status(404); throw new Error('Session not found.'); }
  res.json({ success: true, data: { sessionId: session._id, definition: session.definition, transcript: session.transcript } });
});
