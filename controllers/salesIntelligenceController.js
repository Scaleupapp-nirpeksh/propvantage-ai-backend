// File: controllers/salesIntelligenceController.js
import asyncHandler from 'express-async-handler';
import { getSalesIntelligence } from '../services/analytics/salesIntelligenceService.js';

// GET /api/analytics/sales-intelligence?project=<id>
export const getSalesIntelligenceReport = asyncHandler(async (req, res) => {
  const projectId = req.query.project || null;
  if (projectId && !req.hasFullProjectAccess && !(req.accessibleProjectIds || []).includes(String(projectId))) { res.status(403); throw new Error('You do not have access to this project'); }
  const data = await getSalesIntelligence({ organizationId: req.user.organization, projectId, projectIds: req.hasFullProjectAccess ? null : (req.accessibleProjectIds || []) });
  res.json({ success: true, data });
});
