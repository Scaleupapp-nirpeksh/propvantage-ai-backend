// File: controllers/reportController.js
// Description: Authenticated controllers for the Report Builder.

import asyncHandler from 'express-async-handler';
import { getCatalog as getBlockCatalog } from '../services/reports/blockRegistry.js';

/**
 * @desc    Get the block catalog the current user may use, for the builder palette.
 * @route   GET /api/reports/catalog
 * @access  Private (reports:manage)
 */
export const getCatalog = asyncHandler(async (req, res) => {
  const catalog = getBlockCatalog(req.userPermissions || [], req.isOwner || false);
  res.json({ success: true, data: catalog });
});
