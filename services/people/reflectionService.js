// File: services/people/reflectionService.js
// Description: Weekly reflection lifecycle for the People & Performance module (spec §10).
//
//   isoWeekOf(date)               → 'YYYY-Www'
//   weekStartOf(date)             → Monday 00:00:00.000 UTC
//   weekEndOf(date)               → Sunday 23:59:59.999 UTC
//   upsertDraft(user, isoWeek, answers)  → ReflectionDoc (create/update draft; locked if past weekEnd)
//   submit(user, isoWeek)               → ReflectionDoc (enforces ≥500 chars on required fields; locked if past weekEnd)
//   currentStatus(user)                 → { isoWeek, status, weekStart, weekEnd, overdue }
//   transcribe(audioBuffer, mime)       → string (via openAIService; best-effort)
//   ack(manager, reflectionId, note)    → ReflectionDoc (managerAck; guarded by hierarchy)

import mongoose from 'mongoose';
import WeeklyReflection, {
  REQUIRED_ANSWER_FIELDS,
  MIN_ANSWER_LENGTH,
} from '../../models/weeklyReflectionModel.js';
import { transcribeAudio } from '../openAIService.js';
import { getManagerChain } from './hierarchyService.js';
import {
  isoWeekOf as isoWeekOf_,
  weekStartOf as weekStartOf_,
  weekEndOf as weekEndOf_,
  boundsFromIsoWeek,
  previousIsoWeek,
} from '../../utils/isoWeek.js';

// Re-export ISO-week helpers so existing callers (e.g. reflectionReminders.js)
// can continue importing them from this service without changes.
export { isoWeekOf, weekStartOf, weekEndOf } from '../../utils/isoWeek.js';

// Lazy import to avoid circular deps at module load time.
// analyzeReflection is fire-and-forget so any error is silently swallowed.
async function _triggerSentimentAnalysis(reflectionDoc) {
  try {
    const { analyzeReflection } = await import('./moraleService.js');
    await analyzeReflection(reflectionDoc);
  } catch (err) {
    console.error('[reflectionService] sentiment fire-and-forget error:', err.message);
  }
}

// =============================================================================
// upsertDraft
// =============================================================================

/**
 * Create or update the draft reflection for `user` in `isoWeek`.
 * Merges `answers` into any existing answers (so partial saves work).
 * Throws if the weekEnd is in the past (the week is locked).
 *
 * @param {object} user
 * @param {string} isoWeek  'YYYY-Www'
 * @param {object} answers  partial or full answers object
 * @returns {Promise<object>} WeeklyReflection document
 */
export async function upsertDraft(user, isoWeek, answers = {}) {
  const { weekStart, weekEnd } = boundsFromIsoWeek(isoWeek);

  // Lock check: once the weekEnd has passed, the reflection is read-only
  if (new Date() > weekEnd) {
    const err = new Error(`Reflection for ${isoWeek} is locked — the week has ended`);
    err.statusCode = 400;
    throw err;
  }

  // Submit-once check: a submitted reflection is final and cannot be edited
  const existing = await WeeklyReflection.findOne({
    organization: user.organization,
    user: user._id,
    isoWeek,
  }).lean();

  if (existing && existing.status === 'submitted') {
    const err = new Error('Reflection already submitted for this week');
    err.statusCode = 400;
    throw err;
  }

  // Build the $set payload for answers (only provided keys)
  const answerSet = {};
  for (const [key, value] of Object.entries(answers)) {
    answerSet[`answers.${key}`] = value;
  }

  const doc = await WeeklyReflection.findOneAndUpdate(
    {
      organization: user.organization,
      user: user._id,
      isoWeek,
    },
    {
      $set: {
        weekStart,
        weekEnd,
        ...answerSet,
      },
      $setOnInsert: {
        organization: user.organization,
        user: user._id,
        isoWeek,
        status: 'draft',
      },
    },
    {
      upsert: true,
      new: true,
      runValidators: true,
    }
  );

  return doc;
}

// =============================================================================
// submit
// =============================================================================

/**
 * Submit the reflection for `user` in `isoWeek`.
 * Validates each REQUIRED answer has ≥500 trimmed characters.
 * Throws a validation error listing which fields are short.
 * Throws if the weekEnd is in the past (locked).
 *
 * @param {object} user
 * @param {string} isoWeek
 * @returns {Promise<object>} WeeklyReflection document with status 'submitted'
 */
export async function submit(user, isoWeek) {
  const { weekEnd } = boundsFromIsoWeek(isoWeek);

  if (new Date() > weekEnd) {
    const err = new Error(`Reflection for ${isoWeek} is locked — the week has ended`);
    err.statusCode = 400;
    throw err;
  }

  const doc = await WeeklyReflection.findOne({
    organization: user.organization,
    user: user._id,
    isoWeek,
  });

  if (!doc) {
    const err = new Error(`No reflection draft found for ${isoWeek}`);
    err.statusCode = 404;
    throw err;
  }

  // Validate each required field
  const shortFields = REQUIRED_ANSWER_FIELDS.filter((field) => {
    const val = (doc.answers[field] || '').trim();
    return val.length < MIN_ANSWER_LENGTH;
  });

  if (shortFields.length > 0) {
    const err = new Error(
      `The following fields need at least ${MIN_ANSWER_LENGTH} characters: ${shortFields.join(', ')}`
    );
    err.statusCode = 422;
    err.shortFields = shortFields;
    throw err;
  }

  doc.status = 'submitted';
  doc.submittedAt = new Date();
  await doc.save();

  // Fire-and-forget AI sentiment analysis — best-effort, non-blocking.
  // A Claude outage or parse error must NEVER affect submit latency or UX.
  _triggerSentimentAnalysis(doc).catch(() => {/* already logged inside */});

  return doc;
}

// =============================================================================
// currentStatus
// =============================================================================

/**
 * Return the current week's reflection status for `user`, plus an `overdue` flag
 * indicating whether the most recent prior week's reflection is missing/unsubmitted.
 *
 * @param {object} user
 * @returns {Promise<{ isoWeek: string, status: 'none'|'draft'|'submitted', weekStart: Date, weekEnd: Date, overdue: boolean }>}
 */
export async function currentStatus(user) {
  const now = new Date();
  const isoWeek   = isoWeekOf_(now);
  const weekStart = weekStartOf_(now);
  const weekEnd   = weekEndOf_(now);

  // Look up the current week's reflection
  const current = await WeeklyReflection.findOne({
    organization: user.organization,
    user: user._id,
    isoWeek,
  }).lean();

  const status = !current ? 'none' : current.status;

  // Check if the MOST RECENT PRIOR week is unsubmitted (overdue)
  const prevWeek = previousIsoWeek(isoWeek);
  const prior = await WeeklyReflection.findOne({
    organization: user.organization,
    user: user._id,
    isoWeek: prevWeek,
  }).lean();

  const overdue = !prior || prior.status !== 'submitted';

  return { isoWeek, status, weekStart, weekEnd, overdue };
}

// =============================================================================
// transcribe
// =============================================================================

/**
 * Transcribe an audio buffer via Whisper (openAIService).
 * Best-effort: throws only if openAIService returns null (i.e. Whisper call failed).
 *
 * @param {Buffer} audioBuffer
 * @param {string} mime  MIME type
 * @returns {Promise<string>}
 */
export async function transcribe(audioBuffer, mime) {
  const text = await transcribeAudio(audioBuffer, mime);
  if (text == null) {
    const err = new Error('Audio transcription failed');
    err.statusCode = 502;
    throw err;
  }
  return text;
}

// =============================================================================
// listForUser
// =============================================================================

/**
 * Return the authenticated user's own reflections, sorted newest-first.
 *
 * @param {object} user         — the requesting user (must have ._id and .organization)
 * @param {number} [limit=12]   — max documents to return
 * @returns {Promise<object[]>} array of WeeklyReflection lean documents
 */
export async function listForUser(user, limit = 12) {
  return WeeklyReflection.find({
    organization: user.organization,
    user: user._id,
  })
    .sort({ weekStart: -1 })
    .limit(limit)
    .lean();
}

// =============================================================================
// listForUserId
// =============================================================================

/**
 * Return reflections for a specific user (by id), sorted newest-first.
 * Caller is responsible for access-control before calling this function.
 *
 * @param {mongoose.Types.ObjectId|string} orgId
 * @param {mongoose.Types.ObjectId|string} userId
 * @param {number} [limit=12]
 * @returns {Promise<object[]>} array of WeeklyReflection lean documents
 */
export async function listForUserId(orgId, userId, limit = 12) {
  return WeeklyReflection.find({
    organization: orgId,
    user: userId,
  })
    .sort({ weekStart: -1 })
    .limit(limit)
    .lean();
}

// =============================================================================
// ack
// =============================================================================

/**
 * Record a manager acknowledgement on a reflection.
 * Only a user in the reflection author's manager chain may acknowledge.
 *
 * @param {object} manager         — the requesting manager user
 * @param {string|ObjectId} reflectionId
 * @param {string} note            — private note (may be empty string)
 * @returns {Promise<object>}      WeeklyReflection document with managerAck set
 */
export async function ack(manager, reflectionId, note = '') {
  const doc = await WeeklyReflection.findById(reflectionId);
  if (!doc) {
    const err = new Error('Reflection not found');
    err.statusCode = 404;
    throw err;
  }

  // Load the author's user document so we can walk the hierarchy
  // We only need the _id and organization from the reflection's user reference.
  // hierarchyService.getManagerChain expects a user object with { _id, organization, role, roleRef }.
  // Fetch the author's full user doc.
  const { default: User } = await import('../../models/userModel.js');
  const author = await User.findById(doc.user).lean();
  if (!author) {
    const err = new Error('Reflection author not found');
    err.statusCode = 404;
    throw err;
  }

  const chain = await getManagerChain(author);
  const managerIdStr = manager._id.toString();
  const inChain = chain.some((m) => m._id.toString() === managerIdStr);

  if (!inChain) {
    const err = new Error('Unauthorized: you are not in this user\'s manager chain');
    err.statusCode = 403;
    throw err;
  }

  doc.managerAck = {
    by:   manager._id,
    at:   new Date(),
    note: (note || '').trim(),
  };
  await doc.save();

  return doc;
}
