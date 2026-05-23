// File: controllers/cpCopilotController.js
// Description: SP5 — POST /api/cp/copilot/message handler.

import asyncHandler from 'express-async-handler';
import { processCpCopilotMessage } from '../services/cpCopilotService.js';
import { incrementMeter } from '../services/ai/aiUsageMeterService.js';

export const cpCopilotMessage = asyncHandler(async (req, res) => {
  const { message, conversationId } = req.body || {};
  if (!message || typeof message !== 'string') {
    res.status(400);
    throw new Error('`message` is required and must be a string.');
  }
  const out = await processCpCopilotMessage(message, req.user, conversationId);
  // Always increment the copilot counter — every message costs LLM time.
  await incrementMeter(req.user.organization, 'copilot', out.tokenUsage);
  res.json({ success: true, data: out });
});
