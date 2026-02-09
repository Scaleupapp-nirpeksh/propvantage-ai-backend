// File: controllers/aiCopilotController.js
// Description: Request handler for AI Copilot chat endpoint

import asyncHandler from 'express-async-handler';
import { processCopilotMessage } from '../services/aiCopilotService.js';

/**
 * @desc    Process a copilot chat message
 * @route   POST /api/ai/copilot/chat
 * @access  Private (All authenticated roles)
 */
const copilotChat = asyncHandler(async (req, res) => {
  const { message, conversationId, context } = req.body;

  // Validate message
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    res.status(400);
    throw new Error('Message is required and must be a non-empty string');
  }

  // Enforce max message length to prevent token abuse
  if (message.length > 2000) {
    res.status(400);
    throw new Error('Message cannot exceed 2000 characters');
  }

  try {
    const result = await processCopilotMessage(
      message.trim(),
      req.user,
      conversationId || null,
      context || {}
    );

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('❌ Copilot controller error:', error.message);

    // Handle specific AI service errors
    if (error.message === 'AI_RATE_LIMITED') {
      res.status(429).json({
        success: false,
        message: 'AI service is rate limited. Please wait a moment and try again.',
        code: 'AI_RATE_LIMITED',
      });
      return;
    }

    if (error.message === 'AI_MODEL_ERROR') {
      res.status(503).json({
        success: false,
        message: 'AI model is temporarily unavailable. Please try again later.',
        code: 'AI_MODEL_ERROR',
      });
      return;
    }

    if (error.message === 'AI_SERVICE_ERROR') {
      res.status(503).json({
        success: false,
        message: 'AI service is temporarily unavailable. Please try again.',
        code: 'AI_SERVICE_ERROR',
      });
      return;
    }

    // Generic error
    res.status(500);
    throw new Error('Failed to process your message. Please try again.');
  }
});

export { copilotChat };
