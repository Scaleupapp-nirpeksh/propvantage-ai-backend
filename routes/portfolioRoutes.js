// File: routes/portfolioRoutes.js
import express from 'express';
import { protect, hasPermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';
import {
  getMyPortfolioProfile,
  updateMyPortfolioProfile,
  updateProjectPortfolio,
  getPortfolioView,
} from '../controllers/portfolioController.js';

const router = express.Router();

router.use(protect);

router.get('/profile', getMyPortfolioProfile);
router.put('/profile', hasPermission(PERMISSIONS.PORTFOLIO.MANAGE), updateMyPortfolioProfile);
router.put('/projects/:id', hasPermission(PERMISSIONS.PORTFOLIO.MANAGE), updateProjectPortfolio);
router.get('/view/:organizationId', getPortfolioView);

export default router;
