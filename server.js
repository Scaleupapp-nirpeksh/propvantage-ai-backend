// File: server.js
// Description: Main server file with complete construction and project management system

import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import connectDB from './config/db.js';
import { errorHandler, notFound } from './middleware/errorMiddleware.js';

// Import route files
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import projectRoutes from './routes/projectRoutes.js';
import unitRoutes from './routes/unitRoutes.js';
import leadRoutes from './routes/leadRoutes.js';
import leadScoringRoutes from './routes/leadScoringRoutes.js';
import salesRoutes from './routes/salesRoutes.js';
import pricingRoutes from './routes/pricingRoutes.js';
import aiRoutes from './routes/aiRoutes.js';
import fileRoutes from './routes/fileRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import projectPaymentRoutes from './routes/projectPaymentRoutes.js';
import commissionRoutes from './routes/commissionRoutes.js';
import documentRoutes from './routes/documentRoutes.js';
import documentApprovalRoutes from './routes/documentApprovalRoutes.js';
// New construction management routes
import constructionRoutes from './routes/constructionRoutes.js';
import contractorRoutes from './routes/contractorRoutes.js';

// Load environment variables
dotenv.config();

// Connect to database
connectDB();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/projects', projectPaymentRoutes);
app.use('/api/units', unitRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/leads', leadScoringRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/pricing', pricingRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/commissions', commissionRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/documents', documentApprovalRoutes);
// Construction management routes
app.use('/api/construction', constructionRoutes);
app.use('/api/contractors', contractorRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    version: '1.6.0', // Updated version
    features: [
      'Authentication',
      'User Management',
      'Project Management',
      'Lead Management',
      'Advanced Lead Scoring',
      'Sales Management',
      'Pricing Engine',
      'AI Insights',
      'File Management',
      'Advanced Analytics',
      'Payment System',
      'Installment Management',
      'Financial Tracking',
      'Commission Management',
      'Document Management',
      'Document Approval Workflows',
      'Version Control',
      'Document Templates',
      'Construction Management', // New feature
      'Milestone Tracking', // New feature
      'Contractor Management', // New feature
      'Progress Documentation', // New feature
      'Quality Control', // New feature
      'Issue Tracking' // New feature
    ]
  });
});

// API documentation endpoint
app.get('/api/docs', (req, res) => {
  res.json({
    title: 'PropVantage AI - Real Estate CRM API',
    version: '1.6.0',
    description: 'Comprehensive real estate CRM with construction management',
    endpoints: {
      authentication: '/api/auth',
      users: '/api/users',
      projects: '/api/projects',
      leads: '/api/leads',
      sales: '/api/sales',
      payments: '/api/payments',
      commissions: '/api/commissions',
      documents: '/api/documents',
      construction: '/api/construction',
      contractors: '/api/contractors',
      analytics: '/api/analytics'
    },
    newFeatures: [
      'Construction milestone tracking',
      'Progress photo documentation',
      'Quality control workflows',
      'Contractor management and ratings',
      'Issue tracking and resolution',
      'Project timeline visualization'
    ]
  });
});

// Error handling middleware
app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 PropVantage AI Server running on port ${PORT}`);
  console.log(`\n📊 Core Features:`);
  console.log(`   Analytics Dashboard: http://localhost:${PORT}/api/analytics/dashboard`);
  console.log(`   Sales Reports: http://localhost:${PORT}/api/analytics/sales-report`);
  console.log(`   Lead Scoring: http://localhost:${PORT}/api/leads/high-priority`);
  console.log(`\n💰 Financial Management:`);
  console.log(`   Payment System: http://localhost:${PORT}/api/payments`);
  console.log(`   Project Payment Config: http://localhost:${PORT}/api/projects/:id/payment-config`);
  console.log(`   Commission System: http://localhost:${PORT}/api/commissions`);
  console.log(`\n📄 Document Management:`);
  console.log(`   Document Management: http://localhost:${PORT}/api/documents`);
  console.log(`   Document Approvals: http://localhost:${PORT}/api/documents/approvals/pending`);
  console.log(`   Document Categories: http://localhost:${PORT}/api/documents/categories`);
  console.log(`\n🏗️ Construction Management:`);
  console.log(`   Construction Milestones: http://localhost:${PORT}/api/construction/milestones`);
  console.log(`   Project Timeline: http://localhost:${PORT}/api/construction/projects/:id/timeline`);
  console.log(`   Contractor Management: http://localhost:${PORT}/api/contractors`);
  console.log(`   Overdue Milestones: http://localhost:${PORT}/api/construction/milestones/overdue`);
  console.log(`\n📖 Documentation: http://localhost:${PORT}/api/docs`);
  console.log(`\n✨ PropVantage AI v1.6.0 - Complete Real Estate CRM with Construction Management`);
});