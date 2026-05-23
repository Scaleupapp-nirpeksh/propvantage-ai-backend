// File: controllers/externalDeveloperController.js
// Description: SP4 — HTTP handlers for /api/cp/external-developers (CP-side,
//   authenticated + org-type-gated) and /api/external-developer-invites
//   (public lookup only).

import asyncHandler from 'express-async-handler';
import * as svc from '../services/externalDeveloperService.js';

const callService = async (fn, res) => {
  try {
    return await fn();
  } catch (err) {
    if (err?.statusCode) res.status(err.statusCode);
    throw err;
  }
};

// ─── Authenticated CP-side CRUD ────────────────────────────────────────────

export const listExternalDevelopers = asyncHandler(async (req, res) => {
  const data = await callService(() => svc.listExternalDevelopers(req.query, req.user), res);
  res.json({ success: true, data });
});

export const getExternalDeveloper = asyncHandler(async (req, res) => {
  const data = await callService(() => svc.getExternalDeveloper(req.params.id, req.user), res);
  res.json({ success: true, data });
});

export const createExternalDeveloper = asyncHandler(async (req, res) => {
  const data = await callService(() => svc.createExternalDeveloper(req.body, req.user), res);
  res.status(201).json({ success: true, data });
});

export const updateExternalDeveloper = asyncHandler(async (req, res) => {
  const data = await callService(() => svc.updateExternalDeveloper(req.params.id, req.body, req.user), res);
  res.json({ success: true, data });
});

export const deleteExternalDeveloper = asyncHandler(async (req, res) => {
  const data = await callService(() => svc.deleteExternalDeveloper(req.params.id, req.user), res);
  res.json({ success: true, data });
});

// POST /api/cp/external-developers/:id/invite — body { email }.
export const inviteExternalDeveloper = asyncHandler(async (req, res) => {
  const data = await callService(
    () => svc.inviteExternalDeveloper(req.params.id, req.body?.email, req.user),
    res
  );
  res.status(201).json({ success: true, data });
});

// ─── Public — no auth ──────────────────────────────────────────────────────

// GET /api/external-developer-invites/:token — registration-page pre-fill.
export const publicInviteLookup = asyncHandler(async (req, res) => {
  const data = await callService(() => svc.getInviteByToken(req.params.token), res);
  res.json({ success: true, data });
});
