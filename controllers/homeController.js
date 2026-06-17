// File: controllers/homeController.js
// Description: Home screen endpoints. Routes a free-text request into one intent
//   (action | data | question | clarify) via the intent router.
import asyncHandler from 'express-async-handler';
import { routeHomeIntent } from '../services/home/intentRouter.js';

/**
 * @desc    Classify a Home free-text request into a single intent.
 * @route   POST /api/home/intent
 * @access  Private (protect)
 */
export const homeIntent = asyncHandler(async (req, res) => {
  const { text } = req.body || {};
  const data = await routeHomeIntent(text);
  res.json({ success: true, data });
});

export default { homeIntent };
