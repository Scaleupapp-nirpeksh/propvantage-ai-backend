// File: controllers/cpAnalyticsController.js
// Description: SP5 — thin asyncHandlers for /api/cp/analytics/*. All gating
//   (protect + requireOrgType + per-route permissions) is applied in
//   routes/cpAnalyticsRoutes.js, so the handlers here only marshal req/res
//   and translate service errors (httpError-style { statusCode, message }).

import asyncHandler from 'express-async-handler';
import * as cpAnalytics from '../services/analytics/cpAnalyticsService.js';
import * as reconciliation from '../services/analytics/commissionReconciliationService.js';

const callService = async (fn, res) => {
  try {
    return await fn();
  } catch (err) {
    if (err?.statusCode) res.status(err.statusCode);
    throw err;
  }
};

// ─── Area 1 ────────────────────────────────────────────────────────────────
export const getPipeline = asyncHandler(async (req, res) => {
  const data = await callService(
    () => cpAnalytics.getPipelineHealth(req.user.organization, req.query, req.user),
    res
  );
  res.json({ success: true, data });
});

// ─── Area 2 ────────────────────────────────────────────────────────────────
export const getCommission = asyncHandler(async (req, res) => {
  const data = await callService(
    () => cpAnalytics.getCommissionOverview(req.user.organization, req.query, req.user),
    res
  );
  res.json({ success: true, data });
});

// ─── Area 3 (gated by cp_analytics:view_team in the route) ─────────────────
export const getAgents = asyncHandler(async (req, res) => {
  const data = await callService(
    () => cpAnalytics.getAgentPerformance(req.user.organization, req.query, req.user),
    res
  );
  res.json({ success: true, data });
});

// ─── Area 4 ────────────────────────────────────────────────────────────────
export const getDevelopers = asyncHandler(async (req, res) => {
  const data = await callService(
    () => cpAnalytics.getDeveloperPerformance(req.user.organization, req.query, req.user),
    res
  );
  res.json({ success: true, data });
});

// ─── Area 5 — reconciliation ───────────────────────────────────────────────
export const getReconciliation = asyncHandler(async (req, res) => {
  const data = await callService(
    () => reconciliation.getReconciliationOverview(req.user.organization, req.query, req.user),
    res
  );
  res.json({ success: true, data });
});

export const getReconciliationDetail = asyncHandler(async (req, res) => {
  const data = await callService(
    () => reconciliation.getReconciliationDetail(req.user.organization, req.params.prospectId, req.user),
    res
  );
  res.json({ success: true, data });
});

export const markReconciliationReviewed = asyncHandler(async (req, res) => {
  const data = await callService(
    () => reconciliation.markReviewed(req.user.organization, req.params.prospectId, req.user),
    res
  );
  res.json({ success: true, data });
});
