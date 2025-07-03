// File: server.js
// Description: Main server file with payment system routes

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
import salesRoutes from './routes/salesRoutes.js';
import pricingRoutes from './routes/pricingRoutes.js';
import aiRoutes from './routes/aiRoutes.js';
import fileRoutes from './routes/fileRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import projectPaymentRoutes from './routes/projectPaymentRoutes.js';
import commissionRoutes from './routes/commissionRoutes.js'; // New commission routes

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
app.use('/api/projects', projectPaymentRoutes); // Project payment configuration routes
app.use('/api/units', unitRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/pricing', pricingRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/payments', paymentRoutes); // Payment system routes
app.use('/api/commissions', commissionRoutes); // Commission system routes

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    version: '1.3.0',
    features: [
      'Authentication',
      'User Management',
      'Project Management',
      'Lead Management',
      'Sales Management',
      'Pricing Engine',
      'AI Insights',
      'File Management',
      'Advanced Analytics',
      'Payment System',
      'Installment Management',
      'Financial Tracking',
      'Commission Management' // New feature
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
});