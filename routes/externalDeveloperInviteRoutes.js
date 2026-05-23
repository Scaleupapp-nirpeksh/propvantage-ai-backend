// File: routes/externalDeveloperInviteRoutes.js
// SP4 — PUBLIC (no auth) — the registration page calls this to pre-fill
// from a CP's off-platform invite link before the developer creates their
// org. Returns 200 with the invite details, 410 when claimed/expired,
// 404 for an unknown token.
import express from 'express';
import { publicInviteLookup } from '../controllers/externalDeveloperController.js';

const router = express.Router();

router.get('/:token', publicInviteLookup);

export default router;
