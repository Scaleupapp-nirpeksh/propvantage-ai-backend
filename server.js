// File: server.js
// Description: Main server file with complete construction and project management system + AI Conversation
// Version: 1.7.0 - Added AI Conversation Intelligence

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import mongoSanitize from 'express-mongo-sanitize';
import xss from 'xss-clean';
import hpp from 'hpp';
import connectDB from './config/db.js';
import { errorHandler, notFound } from './middleware/errorMiddleware.js';
import { initializeSocket } from './socket/socketHandler.js';

// Import route files
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import inviteRoutes from './routes/invitationRoutes.js';
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
import predictiveRoutes from './routes/predictiveRoutes.js';
import towerRoutes from './routes/towerRoutes.js';
import invoiceRoutes from './routes/invoiceRoutes.js';
import budgetVarianceRoutes from './routes/budgetVarianceRoutes.js';
import aiCopilotRoutes from './routes/aiCopilotRoutes.js';
import roleRoutes from './routes/roleRoutes.js';
import taskRoutes from './routes/taskRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import leadershipDashboardRoutes from './routes/leadershipDashboardRoutes.js';
import chatRoutes from './routes/chatRoutes.js';
import projectAccessRoutes from './routes/projectAccessRoutes.js';


// Load environment variables
dotenv.config();

// Connect to database
connectDB();

const app = express();

// ─── Security Middleware (order matters) ───────────────────────────────────────

// 1. Security headers (X-Frame-Options, X-Content-Type-Options, HSTS, etc.)
app.use(helmet());

// 2. CORS — restrict to allowed origins only
const allowedOrigins = process.env.CLIENT_URL
  ? process.env.CLIENT_URL.split(',').map(o => o.trim())
  : ['http://localhost:3000', 'http://localhost:3001'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, Postman in dev)
    if (!origin && process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// 3. Body parsing with reduced limits
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// 3b. Cookie parsing — required for refresh token httpOnly cookies
app.use(cookieParser());

// 4. NoSQL injection prevention — strips $ and . from req.body/query/params
app.use(mongoSanitize());

// 5. XSS prevention — sanitizes user input in body/query/params
app.use(xss());

// 6. HTTP Parameter Pollution prevention
app.use(hpp());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/invitations', inviteRoutes);
app.use('/api/projects', budgetVarianceRoutes);    // ← Budget variance first
app.use('/api/projects', projectPaymentRoutes);
app.use('/api/projects', projectRoutes); 
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
app.use('/api/analytics/predictions', predictiveRoutes);
app.use('/api/towers', towerRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/ai/copilot', aiCopilotRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/leadership', leadershipDashboardRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/project-access', projectAccessRoutes);
// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    features: [
      'Authentication',
      'User Management',
      'Project Management',
      'Lead Management',
      'Advanced Lead Scoring',
      'Sales Management',
      'Pricing Engine',
      'AI Insights',
      'AI Conversation Analysis',
      'AI Follow-up Recommendations',
      'AI Lead Temperature Prediction',
      'Interaction Pattern Analysis',
      'Conversation Summaries',
      'Predictive Sales Forecasting',     // NEW FEATURE
      'Revenue Projections',              // NEW FEATURE
      'Lead Conversion Predictions',      // NEW FEATURE
      'Inventory Turnover Analysis',      // NEW FEATURE
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
      'Financial Forecasting',
      'AI Copilot Chat',
      'Custom Roles & Permissions',
      'Permission-Based Access Control',
      'Task Management',
      'Task Templates',
      'Task Auto-Generation',
      'Task Analytics',
      'In-App Notifications',
      'Real-Time Chat & Messaging',
      'Entity-Linked Conversations',
      'Project-Level Access Control'
    ]
  });
});

// API documentation endpoint
app.get('/api/docs', (req, res) => {
  res.json({
    title: 'PropVantage AI - Real Estate CRM API',
    version: '1.8.0', // Updated version
    description: 'Comprehensive real estate CRM with construction management, AI conversation intelligence, and predictive analytics',
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
      aiConversation: '/api/ai/conversation',
      predictiveAnalytics: '/api/analytics/predictions',
      aiCopilot: '/api/ai/copilot',
      roles: '/api/roles'
    },
    latestFeatures: [
      'AI-powered sales forecasting with trend analysis',
      'Revenue projections with confidence intervals',
      'Lead conversion probability predictions',
      'Inventory turnover analysis and predictions',
      'Market momentum and seasonality factors',
      'Scenario-based forecasting (pessimistic, realistic, optimistic)',
      'Bulk forecasting operations for multiple projects'
    ],
    previousFeatures: [
      'AI conversation sentiment analysis',
      'Smart follow-up recommendations',
      'Lead temperature prediction',
      'Interaction pattern analysis',
      'Automated conversation summaries',
      'Bulk conversation analysis',
      'Conversion probability scoring',
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
    version: '1.8.0', // Updated version
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
        description: 'AI conversation intelligence',
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
        description: 'Smart follow-up action recommendations',
        endpoint: '/api/ai/conversation/recommendations',
        features: [
          'Immediate action items',
          'Long-term strategy planning',
          'Communication scheduling',
          'Risk mitigation strategies'
        ]
      },
      interactionPatterns: {
        description: 'Lead interaction pattern analysis',
        endpoint: '/api/ai/conversation/leads/:id/interaction-patterns',
        features: [
          'Response rate analysis',
          'Engagement level tracking',
          'Call success patterns',
          'Conversion likelihood prediction'
        ]
      },
      conversationSummaries: {
        description: 'Automated conversation summaries',
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
      },
      // NEW: Predictive Analytics Features
      predictiveAnalytics: {
        description: 'AI-powered sales forecasting and predictions',
        endpoint: '/api/analytics/predictions',
        features: [
          'Sales forecasting with AI enhancements',
          'Revenue projections and scenarios',
          'Lead conversion probability',
          'Inventory turnover predictions',
          'Market trend analysis',
          'Confidence intervals and risk assessment'
        ]
      }
    },
    aiProgress: {
      overall: '90%', // Updated from 85% to 90%
      components: {
        leadScoring: '100%',
        salesInsights: '100%',
        conversationAnalysis: '100%',
        budgetAnalytics: '100%',
        predictiveAnalytics: '100%', // NEW: Added predictive analytics
        marketTrendAnalysis: '0%', // TODO: Still pending
        customerBehaviorInsights: '0%' // TODO: Still pending
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

// Create HTTP server and attach Socket.IO
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

initializeSocket(io);
app.set('io', io);

httpServer.listen(PORT, () => {
  console.log(`PropVantage AI Server running on port ${PORT}`);
});