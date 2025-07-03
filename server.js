// File: server.js
// Description: Main server file with enhanced document management system

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
// New document management routes
import documentRoutes from './routes/documentRoutes.js';
import documentApprovalRoutes from './routes/documentApprovalRoutes.js';

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

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    version: '1.5.0', // Updated version
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
      'Document Management', // New feature
      'Document Approval Workflows', // New feature
      'Version Control', // New feature
      'Document Templates' // New feature
    ]
  });
});

// Error handling middleware
app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 PropVantage AI Server running on port ${PORT}`);
  console.log(`📊 Analytics Dashboard: http://localhost:${PORT}/api/analytics/dashboard`);
  console.log(`📈 Sales Reports: http://localhost:${PORT}/api/analytics/sales-report`);
  console.log(`💳 Payment System: http://localhost:${PORT}/api/payments`);
  console.log(`🏗️ Project Payment Config: http://localhost:${PORT}/api/projects/:id/payment-config`);
  console.log(`💰 Commission System: http://localhost:${PORT}/api/commissions`);
  console.log(`🤝 Partner Management: http://localhost:${PORT}/api/commissions/partners`);
  console.log(`🎯 Lead Scoring: http://localhost:${PORT}/api/leads/high-priority`);
  console.log(`📋 Lead Analytics: http://localhost:${PORT}/api/leads/score-analytics`);
  console.log(`📄 Document Management: http://localhost:${PORT}/api/documents`);
  console.log(`✅ Document Approvals: http://localhost:${PORT}/api/documents/approvals/pending`);
  console.log(`📁 Document Categories: http://localhost:${PORT}/api/documents/categories`);
});