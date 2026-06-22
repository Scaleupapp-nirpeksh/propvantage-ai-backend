// File: controllers/reflectionController.js
// Description: Thin HTTP handlers for the weekly reflection endpoints (spec §10, §13).
//   Routes are mounted by a later task — this file only exports the handlers.
//   All handlers are scoped to req.user (set by the `protect` auth middleware).
//
//   GET  /api/people/reflections/current        → getCurrent
//   GET  /api/people/reflections?isoWeek=       → getReflection
//   PUT  /api/people/reflections/:isoWeek       → saveDraft
//   POST /api/people/reflections/:isoWeek/submit → submitReflection
//   POST /api/people/reflections/:id/ack        → ackReflection
//   POST /api/people/reflections/transcribe     → transcribeAudio

import asyncHandler from 'express-async-handler';
import WeeklyReflection from '../models/weeklyReflectionModel.js';
import {
  upsertDraft,
  submit,
  currentStatus,
  transcribe,
  ack,
  isoWeekOf,
  listForUser,
} from '../services/people/reflectionService.js';

// =============================================================================
// listMine
// =============================================================================

/**
 * @desc    List the authenticated user's own reflections, newest first.
 *          Accepts an optional ?limit= query param (default 12, max 50).
 * @route   GET /api/people/reflections
 * @access  Authenticated
 */
export const listMine = asyncHandler(async (req, res) => {
  const rawLimit = parseInt(req.query.limit, 10);
  const limit = rawLimit > 0 ? Math.min(rawLimit, 50) : 12;

  const docs = await listForUser(req.user, limit);
  res.json({ success: true, data: docs });
});

// =============================================================================
// getCurrent
// =============================================================================

/**
 * @desc    Get the current week's reflection status for the authenticated user.
 * @route   GET /api/people/reflections/current
 * @access  Authenticated
 */
export const getCurrent = asyncHandler(async (req, res) => {
  const result = await currentStatus(req.user);
  res.json({ success: true, data: result });
});

// =============================================================================
// getReflection
// =============================================================================

/**
 * @desc    Get a specific week's reflection document.
 *          Accepts the isoWeek via route param (:isoWeek) or query string
 *          (?isoWeek=) — param takes precedence. Falls back to current week.
 * @route   GET /api/people/reflections/:isoWeek
 * @route   GET /api/people/reflections?isoWeek=YYYY-Www
 * @access  Authenticated
 */
export const getReflection = asyncHandler(async (req, res) => {
  const isoWeek = req.params.isoWeek || req.query.isoWeek || isoWeekOf(new Date());

  const doc = await WeeklyReflection.findOne({
    organization: req.user.organization,
    user: req.user._id,
    isoWeek,
  }).lean();

  if (!doc) {
    res.status(404);
    throw new Error(`No reflection found for ${isoWeek}`);
  }

  res.json({ success: true, data: doc });
});

// =============================================================================
// saveDraft
// =============================================================================

/**
 * @desc    Create or update the draft reflection for the current user.
 * @route   PUT /api/people/reflections/:isoWeek
 * @access  Authenticated
 */
const KNOWN_ANSWER_FIELDS = ['wins', 'areasToImprove', 'dislikes', 'achievements', 'plansNextWeek', 'other'];

export const saveDraft = asyncHandler(async (req, res) => {
  const { isoWeek } = req.params;
  const raw = req.body.answers || req.body;  // accept { answers: {...} } or flat body

  // Pick only known answer fields — discard any stray top-level keys
  const answers = {};
  for (const field of KNOWN_ANSWER_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(raw, field)) {
      answers[field] = raw[field];
    }
  }

  const doc = await upsertDraft(req.user, isoWeek, answers);
  res.json({ success: true, data: doc });
});

// =============================================================================
// submitReflection
// =============================================================================

/**
 * @desc    Submit the reflection for the given week.
 *          Enforces ≥500 chars per required answer.
 * @route   POST /api/people/reflections/:isoWeek/submit
 * @access  Authenticated
 */
export const submitReflection = asyncHandler(async (req, res) => {
  const { isoWeek } = req.params;
  const doc = await submit(req.user, isoWeek);
  res.json({ success: true, data: doc });
});

// =============================================================================
// ackReflection
// =============================================================================

/**
 * @desc    Manager acknowledges a reflection and optionally leaves a private note.
 * @route   POST /api/people/reflections/:id/ack
 * @access  Authenticated (manager chain only — enforced in service)
 */
export const ackReflection = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const note = (req.body.note || '').trim();

  const doc = await ack(req.user, id, note);
  res.json({ success: true, data: doc });
});

// =============================================================================
// transcribeAudio
// =============================================================================

/**
 * @desc    Transcribe an uploaded audio file using Whisper.
 *          Expects req.file set by multer (the multer middleware is added by
 *          the routing task — this handler just consumes req.file).
 * @route   POST /api/people/reflections/transcribe
 * @access  Authenticated
 */
export const transcribeAudio = asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400);
    throw new Error('Audio file is required (multipart/form-data, field: audio)');
  }

  const text = await transcribe(req.file.buffer, req.file.mimetype);
  res.json({ success: true, data: { text } });
});
