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

// =============================================================================
// ISO-WEEK HELPERS
// =============================================================================

/**
 * Return the ISO week string 'YYYY-Www' for a given Date (or now).
 * ISO weeks start on Monday. Week 1 is the week that contains the first Thursday.
 *
 * @param {Date} [date]
 * @returns {string}  e.g. '2026-W25'
 */
export function isoWeekOf(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

  // Day of week: Mon=1 … Sun=7
  const dow = d.getUTCDay() || 7;  // getUTCDay returns 0 for Sunday; map to 7

  // Shift to the nearest Thursday (ISO week rule)
  d.setUTCDate(d.getUTCDate() + 4 - dow);

  const year = d.getUTCFullYear();

  // First Thursday of the year
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const jan1dow = jan1.getUTCDay() || 7;
  const firstThursday = new Date(Date.UTC(year, 0, 1 + (4 - jan1dow + 7) % 7));

  // Week number = (thursday - firstThursday) / 7 + 1
  const diff = d - firstThursday;
  const weekNum = Math.round(diff / (7 * 86400000)) + 1;

  return `${year}-W${String(weekNum).padStart(2, '0')}`;
}

/**
 * Return Monday 00:00:00.000 UTC for the ISO week containing `date`.
 *
 * @param {Date} [date]
 * @returns {Date}
 */
export function weekStartOf(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = d.getUTCDay() || 7;  // Mon=1 … Sun=7
  d.setUTCDate(d.getUTCDate() - (dow - 1));
  return d;  // already at 00:00:00 UTC
}

/**
 * Return Sunday 23:59:59.999 UTC for the ISO week containing `date`.
 *
 * @param {Date} [date]
 * @returns {Date}
 */
export function weekEndOf(date = new Date()) {
  const start = weekStartOf(date);
  return new Date(start.getTime() + 7 * 86400000 - 1);
}

/**
 * Derive weekStart/weekEnd from an isoWeek string 'YYYY-Www'.
 * Returns { weekStart, weekEnd }.
 */
function boundsFromIsoWeek(isoWeek) {
  // Parse year + week number
  const m = isoWeek.match(/^(\d{4})-W(\d{2})$/);
  if (!m) throw new Error(`Invalid isoWeek: ${isoWeek}`);
  const year = parseInt(m[1], 10);
  const week = parseInt(m[2], 10);

  // Jan 4 is always in week 1 (ISO rule)
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4dow = jan4.getUTCDay() || 7;
  // Monday of week 1
  const week1Mon = new Date(jan4.getTime() - (jan4dow - 1) * 86400000);

  const weekStart = new Date(week1Mon.getTime() + (week - 1) * 7 * 86400000);
  const weekEnd   = new Date(weekStart.getTime() + 7 * 86400000 - 1);
  return { weekStart, weekEnd };
}

// =============================================================================
// PREVIOUS ISO-WEEK HELPER
// =============================================================================

/**
 * Return the isoWeek string for the week immediately prior to `isoWeek`.
 */
function previousIsoWeek(isoWeek) {
  const { weekStart } = boundsFromIsoWeek(isoWeek);
  // Subtract one day to land in the previous week
  const dayInPrevWeek = new Date(weekStart.getTime() - 86400000);
  return isoWeekOf(dayInPrevWeek);
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
  const isoWeek   = isoWeekOf(now);
  const weekStart = weekStartOf(now);
  const weekEnd   = weekEndOf(now);

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
