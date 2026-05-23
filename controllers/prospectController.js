// File: controllers/prospectController.js
// Description: SP4 — HTTP handlers for the CP-side Prospect entity. Thin
//   wrappers over services/prospectService; translate service errors to
//   their HTTP status codes via err.statusCode (defaults to 500).

import asyncHandler from 'express-async-handler';
import * as prospectService from '../services/prospectService.js';

// Tiny wrapper — service throws errors with .statusCode; controller sets
// res.status before re-throwing so express-async-handler / errorMiddleware
// reports the right code.
const callService = async (fn, res) => {
  try {
    return await fn();
  } catch (err) {
    if (err?.statusCode) res.status(err.statusCode);
    throw err;
  }
};

// GET /api/cp/prospects — list with filters.
export const listProspects = asyncHandler(async (req, res) => {
  const data = await callService(
    () => prospectService.listProspects(req.query, req.user),
    res
  );
  res.json({ success: true, data });
});

// POST /api/cp/prospects — create.
export const createProspect = asyncHandler(async (req, res) => {
  const data = await callService(
    () => prospectService.createProspect(req.body, req.user),
    res
  );
  res.status(201).json({ success: true, data });
});

// GET /api/cp/prospects/:id — get one.
export const getProspect = asyncHandler(async (req, res) => {
  const data = await callService(
    () => prospectService.getProspect(req.params.id, req.user),
    res
  );
  res.json({ success: true, data });
});

// PUT /api/cp/prospects/:id — update.
export const updateProspect = asyncHandler(async (req, res) => {
  const data = await callService(
    () => prospectService.updateProspect(req.params.id, req.body, req.user),
    res
  );
  res.json({ success: true, data });
});

// DELETE /api/cp/prospects/:id — delete (blocked when pushed).
export const deleteProspect = asyncHandler(async (req, res) => {
  const data = await callService(
    () => prospectService.deleteProspect(req.params.id, req.user),
    res
  );
  res.json({ success: true, data });
});

// POST /api/cp/prospects/:id/activities — append an activity.
export const addProspectActivity = asyncHandler(async (req, res) => {
  const data = await callService(
    () => prospectService.addActivity(req.params.id, req.body, req.user),
    res
  );
  res.status(201).json({ success: true, data });
});

// ─── Commission tracking (SP4 Phase D) ─────────────────────────────────────

// POST /api/cp/prospects/:id/booking — set booking + recompute commission.
export const recordProspectBooking = asyncHandler(async (req, res) => {
  const data = await callService(
    () => prospectService.recordBooking(req.params.id, req.body, req.user),
    res
  );
  res.json({ success: true, data });
});

// POST /api/cp/prospects/:id/commission/payments — append payment receipt.
export const addProspectCommissionPayment = asyncHandler(async (req, res) => {
  const data = await callService(
    () => prospectService.addCommissionPayment(req.params.id, req.body, req.user),
    res
  );
  res.status(201).json({ success: true, data });
});

// PUT /api/cp/prospects/:id/commission — update agreement or trigger write-off.
export const updateProspectCommission = asyncHandler(async (req, res) => {
  const data = await callService(
    () => prospectService.updateCommission(req.params.id, req.body, req.user),
    res
  );
  res.json({ success: true, data });
});
