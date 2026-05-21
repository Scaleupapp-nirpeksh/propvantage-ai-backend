// File: controllers/portfolioController.js
// Description: Developer public portfolio endpoints — org public profile, per-project
//   portfolio settings, and the computed portfolio read.

import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import Organization from '../models/organizationModel.js';
import Project from '../models/projectModel.js';
import { getDeveloperPortfolio } from '../services/portfolioService.js';

// GET /api/portfolio/profile — the caller's own org public profile.
export const getMyPortfolioProfile = asyncHandler(async (req, res) => {
  const org = await Organization.findById(req.user.organization).select(
    'name portfolioProfile contactInfo'
  );
  if (!org) {
    res.status(404);
    throw new Error('Organization not found');
  }
  res.json({ success: true, data: org });
});

// PUT /api/portfolio/profile — update the caller's org public profile.
export const updateMyPortfolioProfile = asyncHandler(async (req, res) => {
  const org = await Organization.findById(req.user.organization);
  if (!org) {
    res.status(404);
    throw new Error('Organization not found');
  }
  const { logoUrl, about, contactInfo } = req.body;
  const existing = org.portfolioProfile?.toObject?.() || org.portfolioProfile || {};
  const nextProfile = { ...existing };
  if (logoUrl !== undefined) nextProfile.logoUrl = logoUrl;
  if (about !== undefined) nextProfile.about = about;
  org.portfolioProfile = nextProfile;
  if (contactInfo !== undefined) {
    org.contactInfo = {
      ...(org.contactInfo?.toObject?.() || org.contactInfo || {}),
      ...contactInfo,
    };
  }
  await org.save();
  res.json({ success: true, data: org });
});

// PUT /api/portfolio/projects/:id — set a project's portfolio settings.
export const updateProjectPortfolio = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(400);
    throw new Error('Invalid project id');
  }
  const project = await Project.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });
  if (!project) {
    res.status(404);
    throw new Error('Project not found');
  }
  const { isPublished, showPriceRange, showConfigurations, coverImageUrl } = req.body;
  const current = project.portfolio || {};
  project.portfolio = {
    isPublished: isPublished !== undefined ? !!isPublished : current.isPublished ?? false,
    showPriceRange:
      showPriceRange !== undefined ? !!showPriceRange : current.showPriceRange ?? true,
    showConfigurations:
      showConfigurations !== undefined
        ? !!showConfigurations
        : current.showConfigurations ?? true,
    coverImageUrl:
      coverImageUrl !== undefined ? coverImageUrl : current.coverImageUrl ?? null,
  };
  await project.save();
  res.json({ success: true, data: { id: project._id, portfolio: project.portfolio } });
});

// GET /api/portfolio/view/:organizationId — the computed portfolio for any developer org.
export const getPortfolioView = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.organizationId)) {
    res.status(400);
    throw new Error('Invalid organization id');
  }
  const portfolio = await getDeveloperPortfolio(req.params.organizationId);
  if (!portfolio) {
    res.status(404);
    throw new Error('Developer portfolio not found');
  }
  res.json({ success: true, data: portfolio });
});
