// File: server.js
// Description: Main server file with complete construction and project management system + AI Conversation
// Version: 1.7.0 - Added AI Conversation Intelligence

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
import aiConversationRoutes from './routes/aiConversationRoutes.js'; // NEW: AI Conversation routes
import fileRoutes from './routes/fileRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import projectPaymentRoutes from './routes/projectPaymentRoutes.js';
import commissionRoutes from './routes/commissionRoutes.js';
import documentRoutes from './routes/documentRoutes.js';
import documentApprovalRoutes from './routes/documentApprovalRoutes.js';
import budgetVsActualRoutes from './routes/budgetVsActualRoutes.js';
import constructionRoutes from './routes/constructionRoutes.js';
import contractorRoutes from './routes/contractorRoutes.js';

// Load environment variables
dotenv.config();

// Connect to database
connectDB();

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Increased limit for AI conversation analysis
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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
app.use('/api/ai/conversation', aiConversationRoutes); // NEW: AI Conversation intelligence
app.use('/api/files', fileRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/commissions', commissionRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/documents', documentApprovalRoutes);
app.use('/api/analytics', budgetVsActualRoutes);
app.use('/api/construction', constructionRoutes);
app.use('/api/contractors', contractorRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    version: '1.7.0', // Updated version for AI Conversation features
    features: [
      'Authentication',
      'User Management',
      'Project Management',
      'Lead Management',
      'Advanced Lead Scoring',
      'Sales Management',
      'Pricing Engine',
      'AI Insights',
      'AI Conversation Analysis',      // NEW FEATURE
      'AI Follow-up Recommendations',  // NEW FEATURE
      'AI Lead Temperature Prediction', // NEW FEATURE
      'Interaction Pattern Analysis',   // NEW FEATURE
      'Conversation Summaries',        // NEW FEATURE
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
      'Construction Management', 
      'Milestone Tracking', 
      'Contractor Management', 
      'Progress Documentation', 
      'Quality Control', 
      'Issue Tracking',
      'Budget vs Actual Tracking',
      'Revenue Analysis',
      'Sales Performance Analytics',
      'Marketing ROI Tracking',
      'Project Comparison',
      'Financial Forecasting'
    ]
  });
});

// API documentation endpoint
app.get('/api/docs', (req, res) => {
  res.json({
    title: 'PropVantage AI - Real Estate CRM API',
    version: '1.7.0',
    description: 'Comprehensive real estate CRM with construction management and AI conversation intelligence',
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
      analytics: '/api/analytics',
      ai: '/api/ai',
      aiConversation: '/api/ai/conversation' // NEW: AI Conversation endpoints
    },
    latestFeatures: [
      'AI conversation sentiment analysis',
      'Smart follow-up recommendations',
      'Lead temperature prediction',
      'Interaction pattern analysis',
      'Automated conversation summaries',
      'Bulk conversation analysis',
      'Conversion probability scoring'
    ],
    previousFeatures: [
      'Construction milestone tracking',
      'Progress photo documentation',
      'Quality control workflows',
      'Contractor management and ratings',
      'Issue tracking and resolution',
      'Project timeline visualization',
      'Budget vs actual tracking',
      'Revenue analysis and forecasting'
    ]
  });
});

// AI Features demonstration endpoint
app.get('/api/ai-features', (req, res) => {
  res.json({
    title: 'PropVantage AI - Artificial Intelligence Features',
    version: '1.7.0',
    aiCapabilities: {
      leadScoring: {
        description: 'Advanced lead scoring algorithm',
        endpoint: '/api/leads/:id/score',
        features: ['Budget alignment', 'Engagement tracking', 'Timeline urgency', 'Source quality']
      },
      salesInsights: {
        description: 'AI-powered sales insights for leads',
        endpoint: '/api/ai/leads/:id/insights',
        features: ['Buying motivators', 'Objection handling', 'Opening lines', 'Strategic questions']
      },
      conversationAnalysis: {
        description: 'AI conversation intelligence', // NEW
        endpoint: '/api/ai/conversation/analyze',
        features: [
          'Sentiment analysis',
          'Buying signals detection',
          'Objection identification',
          'Lead temperature classification',
          'Conversion probability scoring'
        ]
      },
      followUpRecommendations: {
        description: 'Smart follow-up action recommendations', // NEW
        endpoint: '/api/ai/conversation/recommendations',
        features: [
          'Immediate action items',
          'Long-term strategy planning',
          'Communication scheduling',
          'Risk mitigation strategies'
        ]
      },
      interactionPatterns: {
        description: 'Lead interaction pattern analysis', // NEW
        endpoint: '/api/ai/conversation/leads/:id/interaction-patterns',
        features: [
          'Response rate analysis',
          'Engagement level tracking',
          'Call success patterns',
          'Conversion likelihood prediction'
        ]
      },
      conversationSummaries: {
        description: 'Automated conversation summaries', // NEW
        endpoint: '/api/ai/conversation/leads/:id/conversation-summary',
        features: [
          'Progress tracking',
          'Key developments identification',
          'Concern analysis',
          'Opportunity spotting'
        ]
      },
      budgetAnalytics: {
        description: 'AI-powered budget vs actual analysis',
        endpoint: '/api/analytics/budget-vs-actual',
        features: [
          'Revenue variance analysis',
          'Sales performance tracking',
          'Marketing ROI calculation',
          'Project comparison analytics'
        ]
      }
    },
    aiProgress: {
      overall: '85%',
      components: {
        leadScoring: '85%',
        salesInsights: '100%',
        conversationAnalysis: '100%', // NEW
        budgetAnalytics: '100%',
        predictiveAnalytics: '0%', // TODO
        marketTrendAnalysis: '0%', // TODO
        customerBehaviorInsights: '0%' // TODO
      }
    }
  });
});

// Performance monitoring endpoint
app.get('/api/performance', (req, res) => {
  const memoryUsage = process.memoryUsage();
  const uptime = process.uptime();
  
  res.json({
    status: 'Operational',
    uptime: {
      seconds: Math.floor(uptime),
      humanReadable: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`
    },
    memory: {
      rss: `${Math.round(memoryUsage.rss / 1024 / 1024)} MB`,
      heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)} MB`,
      heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)} MB`,
      external: `${Math.round(memoryUsage.external / 1024 / 1024)} MB`
    },
    nodeVersion: process.version,
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString()
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
  console.log(`   Budget vs Actual: http://localhost:${PORT}/api/analytics/budget-dashboard`);
  
  console.log(`\n🤖 AI Features:`);
  console.log(`   Sales Insights: http://localhost:${PORT}/api/ai/leads/:id/insights`);
  console.log(`   Conversation Analysis: http://localhost:${PORT}/api/ai/conversation/analyze`);
  console.log(`   Follow-up Recommendations: http://localhost:${PORT}/api/ai/conversation/recommendations`);
  console.log(`   Interaction Patterns: http://localhost:${PORT}/api/ai/conversation/leads/:id/interaction-patterns`);
  console.log(`   Conversation Summary: http://localhost:${PORT}/api/ai/conversation/leads/:id/conversation-summary`);
  console.log(`   AI Features Overview: http://localhost:${PORT}/api/ai-features`);
  
  console.log(`\n💰 Financial Management:`);
  console.log(`   Payment System: http://localhost:${PORT}/api/payments`);
  console.log(`   Project Payment Config: http://localhost:${PORT}/api/projects/:id/payment-config`);
  console.log(`   Commission System: http://localhost:${PORT}/api/commissions`);
  console.log(`   Budget Analytics: http://localhost:${PORT}/api/analytics/budget-vs-actual`);
  
  console.log(`\n📄 Document Management:`);
  console.log(`   Document Management: http://localhost:${PORT}/api/documents`);
  console.log(`   Document Approvals: http://localhost:${PORT}/api/documents/approvals/pending`);
  console.log(`   Document Categories: http://localhost:${PORT}/api/documents/categories`);
  
  console.log(`\n🏗️ Construction Management:`);
  console.log(`   Construction Milestones: http://localhost:${PORT}/api/construction/milestones`);
  console.log(`   Project Timeline: http://localhost:${PORT}/api/construction/projects/:id/timeline`);
  console.log(`   Contractor Management: http://localhost:${PORT}/api/contractors`);
  console.log(`   Overdue Milestones: http://localhost:${PORT}/api/construction/milestones/overdue`);
  
  console.log(`\n📖 System Information:`);
  console.log(`   API Documentation: http://localhost:${PORT}/api/docs`);
  console.log(`   Health Check: http://localhost:${PORT}/api/health`);
  console.log(`   Performance Monitor: http://localhost:${PORT}/api/performance`);
  
  console.log(`\n✨ PropVantage AI v1.7.0 - Complete Real Estate CRM with AI Conversation Intelligence`);
  console.log(`🎯 AI Capabilities: 85% Complete`);
  console.log(`🚀 New: AI Conversation Analysis, Follow-up Recommendations, Interaction Patterns`);
});