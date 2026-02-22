// File: routes/competitiveAnalysisRoutes.js
// Description: API routes for the Competitive Analysis & AI Recommendation Engine.

import express from 'express';
import multer from 'multer';
import { protect, hasPermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';
import {
  createCompetitorProject,
  getCompetitorProjects,
  getCompetitorProjectById,
  updateCompetitorProject,
  deleteCompetitorProject,
  getDashboardSummary,
  getProviderConfigs,
  updateProviderConfig,
  triggerProviderSync,
  triggerAIResearch,
  getResearchStatus,
  importCompetitorCSV,
  exportCompetitorCSV,
  downloadCSVTemplate,
  getMarketOverview,
  getMarketTrends,
  getDemandSupply,
  getAnalysis,
  refreshAnalysis,
} from '../controllers/competitiveAnalysisController.js';

// Multer config for CSV uploads (memory storage, 10MB limit, CSV only)
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype === 'text/csv' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.originalname.endsWith('.csv')
    ) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'), false);
    }
  },
});

const router = express.Router();

// All routes require authentication
router.use(protect);

// ─── Dashboard ────────────────────────────────────────────────

router.get(
  '/dashboard',
  hasPermission(PERMISSIONS.COMPETITIVE_ANALYSIS.VIEW),
  getDashboardSummary
);

// ─── Provider Management (before /:id to avoid conflicts) ────

router.get(
  '/providers',
  hasPermission(PERMISSIONS.COMPETITIVE_ANALYSIS.MANAGE_PROVIDERS),
  getProviderConfigs
);

router.put(
  '/providers/:providerName',
  hasPermission(PERMISSIONS.COMPETITIVE_ANALYSIS.MANAGE_PROVIDERS),
  updateProviderConfig
);

router.post(
  '/providers/:providerName/sync',
  hasPermission(PERMISSIONS.COMPETITIVE_ANALYSIS.MANAGE_PROVIDERS),
  triggerProviderSync
);

// ─── AI Web Research ─────────────────────────────────────────

router.post(
  '/research',
  hasPermission(PERMISSIONS.COMPETITIVE_ANALYSIS.AI_RESEARCH),
  triggerAIResearch
);

router.get(
  '/research/:jobKey',
  hasPermission(PERMISSIONS.COMPETITIVE_ANALYSIS.AI_RESEARCH),
  getResearchStatus
);

// ─── CSV Import / Export ─────────────────────────────────────

router.post(
  '/import-csv',
  hasPermission(PERMISSIONS.COMPETITIVE_ANALYSIS.MANAGE_DATA),
  csvUpload.single('file'),
  importCompetitorCSV
);

router.get(
  '/export-csv',
  hasPermission(PERMISSIONS.COMPETITIVE_ANALYSIS.MANAGE_DATA),
  exportCompetitorCSV
);

router.get(
  '/csv-template',
  hasPermission(PERMISSIONS.COMPETITIVE_ANALYSIS.VIEW),
  downloadCSVTemplate
);

// ─── Market Intelligence ─────────────────────────────────────

router.get(
  '/market-overview',
  hasPermission(PERMISSIONS.COMPETITIVE_ANALYSIS.VIEW),
  getMarketOverview
);

router.get(
  '/market-trends',
  hasPermission(PERMISSIONS.COMPETITIVE_ANALYSIS.VIEW),
  getMarketTrends
);

router.get(
  '/demand-supply',
  hasPermission(PERMISSIONS.COMPETITIVE_ANALYSIS.VIEW),
  getDemandSupply
);

// ─── AI Analysis & Recommendations ───────────────────────────

router.get(
  '/analysis/:projectId',
  hasPermission(PERMISSIONS.COMPETITIVE_ANALYSIS.AI_RECOMMENDATIONS),
  getAnalysis
);

router.post(
  '/analysis/:projectId/refresh',
  hasPermission(PERMISSIONS.COMPETITIVE_ANALYSIS.AI_RECOMMENDATIONS),
  refreshAnalysis
);

// ─── Competitor Projects CRUD ─────────────────────────────────

router
  .route('/competitors')
  .get(
    hasPermission(PERMISSIONS.COMPETITIVE_ANALYSIS.VIEW),
    getCompetitorProjects
  )
  .post(
    hasPermission(PERMISSIONS.COMPETITIVE_ANALYSIS.MANAGE_DATA),
    createCompetitorProject
  );

router
  .route('/competitors/:id')
  .get(
    hasPermission(PERMISSIONS.COMPETITIVE_ANALYSIS.VIEW),
    getCompetitorProjectById
  )
  .put(
    hasPermission(PERMISSIONS.COMPETITIVE_ANALYSIS.MANAGE_DATA),
    updateCompetitorProject
  )
  .delete(
    hasPermission(PERMISSIONS.COMPETITIVE_ANALYSIS.MANAGE_DATA),
    deleteCompetitorProject
  );

export default router;
