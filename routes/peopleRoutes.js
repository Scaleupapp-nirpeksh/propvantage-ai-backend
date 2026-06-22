// File: routes/peopleRoutes.js
// Description: Routes for the People & Performance module (spec §13).
//   All routes require authentication via `protect`, applied once via
//   `router.use(protect)` before any route handlers.
//   Reflection routes are thin wrappers delegating to reflectionController.js.
//   Audio transcription uses multer memory storage (25MB limit) matching the
//   pattern in routes/fileRoutes.js.

import express from 'express';
import multer  from 'multer';
import { protect } from '../middleware/authMiddleware.js';
import {
  getMe,
  getMember,
  getTeam,
  getOrg,
  getFlags,
  getTargets,
  setTargets,
  getMoraleTeam,
  getMoraleOrg,
} from '../controllers/peopleController.js';
import {
  listMine,
  getCurrent,
  getReflection,
  saveDraft,
  submitReflection,
  ackReflection,
  transcribeAudio,
} from '../controllers/reflectionController.js';

const router = express.Router();

// ─── MULTER — audio transcription ────────────────────────────────
// Memory storage: audio buffer is transcribed then discarded (not persisted).
// 25MB limit: matches largest voice memo duration in practice.
const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
});

// ─── ALL ROUTES REQUIRE AUTH ──────────────────────────────────────
router.use(protect);

// ─── DASHBOARD ENDPOINTS ──────────────────────────────────────────
router.get('/me',               getMe);
router.get('/member/:userId',   getMember);
router.get('/team',             getTeam);
router.get('/org',              getOrg);
router.get('/flags',            getFlags);

// ─── TARGETS ──────────────────────────────────────────────────────
router.get('/targets/:userId',  getTargets);
router.put('/targets/:userId',  setTargets);

// ─── REFLECTIONS ──────────────────────────────────────────────────
// NOTE: static paths must be declared BEFORE parameterized routes so Express
// does not swallow fixed segments as :isoWeek / :id values.
router.get('/reflections/current',             getCurrent);

// Audio transcription — multipart upload; must come before the :isoWeek routes
// that also start with /reflections/.  Express matches by declaration order.
router.post('/reflections/transcribe', audioUpload.single('audio'), transcribeAudio);

// List the caller's own reflections (Reflection History tab).
// Declared BEFORE /reflections/:isoWeek so "GET /reflections" is not consumed
// by the parameterised route.
router.get('/reflections',                     listMine);               // ?limit=

// Standard reflection CRUD (identified by ISO-week string, e.g. '2026-W26')
router.get('/reflections/:isoWeek',            getReflection);
router.put('/reflections/:isoWeek',            saveDraft);
router.post('/reflections/:isoWeek/submit',    submitReflection);

// Manager acknowledgement (identified by MongoDB reflection _id)
router.post('/reflections/:id/ack',            ackReflection);

// ─── MORALE ───────────────────────────────────────────────────────
router.get('/morale/team', getMoraleTeam);
router.get('/morale/org',  getMoraleOrg);

export default router;
