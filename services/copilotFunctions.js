// File: services/copilotFunctions.js
// Description: Database query functions for AI Copilot - GPT-4 function calling tools
// Each function maps to a MongoDB query, always scoped to the user's organization and role

import mongoose from 'mongoose';
import Project from '../models/projectModel.js';
import Lead from '../models/leadModel.js';
import Sale from '../models/salesModel.js';
import Unit from '../models/unitModel.js';
import Tower from '../models/towerModel.js';
import PaymentPlan from '../models/paymentPlanModel.js';
import PaymentTransaction from '../models/paymentTransactionModel.js';
import Installment from '../models/installmentModel.js';
import PartnerCommission from '../models/partnerCommissionModel.js';
import User from '../models/userModel.js';
import Task from '../models/taskModel.js';
import CompetitorProject from '../models/competitorProjectModel.js';

// =============================================================================
// HELPER UTILITIES
// =============================================================================

/**
 * Get date range for a named period
 */
function getDateRange(period, startDate, endDate) {
  const now = new Date();
  let start, end;

  switch (period) {
    case 'today':
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
      break;
    case 'this_week': {
      start = new Date(now);
      start.setDate(now.getDate() - now.getDay());
      start.setHours(0, 0, 0, 0);
      end = now;
      break;
    }
    case 'this_month':
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = now;
      break;
    case 'this_quarter': {
      const q = Math.floor(now.getMonth() / 3);
      start = new Date(now.getFullYear(), q * 3, 1);
      end = now;
      break;
    }
    case 'this_year':
      start = new Date(now.getFullYear(), 0, 1);
      end = now;
      break;
    case 'last_month':
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
      break;
    case 'last_quarter': {
      const cq = Math.floor(now.getMonth() / 3);
      start = new Date(now.getFullYear(), (cq - 1) * 3, 1);
      end = new Date(now.getFullYear(), cq * 3, 0, 23, 59, 59);
      break;
    }
    case 'custom':
      start = startDate ? new Date(startDate) : new Date(now.getFullYear(), 0, 1);
      end = endDate ? new Date(endDate) : now;
      break;
    default:
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = now;
  }

  return { start, end };
}

/**
 * Apply role-based data scoping to a query filter
 */
function applyRoleScope(filter, user, entityType) {
  filter.organization = user.organization;

  const role = user.roleRef?.name || user.role;

  // Full access roles
  if (['Business Head', 'Project Director', 'Sales Head', 'Marketing Head'].includes(role)) {
    return filter;
  }

  // Finance roles - full access to financial data, read access to rest
  if (['Finance Head', 'Finance Manager'].includes(role)) {
    return filter;
  }

  // Sales Manager - own team data (for now, all org data since team mapping isn't explicit)
  if (role === 'Sales Manager') {
    return filter;
  }

  // Sales Executive - own data only
  if (role === 'Sales Executive') {
    if (entityType === 'lead') filter.assignedTo = user._id;
    if (entityType === 'sale') filter.salesPerson = user._id;
    return filter;
  }

  // Channel Partners - own referred data
  if (['Channel Partner Admin', 'Channel Partner Agent', 'Channel Partner Manager'].includes(role)) {
    if (entityType === 'commission') filter.partner = user._id;
    if (entityType === 'lead') filter.assignedTo = user._id;
    if (entityType === 'sale') filter.salesPerson = user._id;
    return filter;
  }

  return filter;
}

/**
 * Resolve a project by ID or by name search within the org
 */
async function resolveProject(orgId, projectId, projectName) {
  if (projectId) {
    return Project.findOne({ _id: projectId, organization: orgId }).lean();
  }
  if (projectName) {
    return Project.findOne({
      organization: orgId,
      name: { $regex: projectName, $options: 'i' },
    }).lean();
  }
  return null;
}

/**
 * Get a project scope filter for queries on models with a `project` field
 */
function getProjectScopeFilter(accessibleProjectIds) {
  // null means full access (Org Owner) — match all documents
  if (accessibleProjectIds === null) return { $exists: true };
  if (!accessibleProjectIds || accessibleProjectIds.length === 0) {
    return { $in: [] };
  }
  return { $in: accessibleProjectIds.map(id => new mongoose.Types.ObjectId(id)) };
}

/**
 * Check if a specific project is accessible
 */
function isProjectAccessible(accessibleProjectIds, projectId) {
  // null means full access (Org Owner)
  if (accessibleProjectIds === null) return true;
  if (!accessibleProjectIds || accessibleProjectIds.length === 0) return false;
  return accessibleProjectIds.includes(projectId.toString());
}

// =============================================================================
// GPT-4 TOOL DEFINITIONS
// =============================================================================

export const copilotTools = [
  // 4.1 Project Functions
  {
    type: 'function',
    function: {
      name: 'get_projects',
      description: 'Get projects list with optional filters. Returns project names, status, type, location, total units, and price range.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['planning', 'pre-launch', 'launched', 'under-construction', 'completed', 'on-hold'] },
          name_search: { type: 'string', description: 'Search project by name (partial match)' },
          type: { type: 'string', enum: ['apartment', 'villa', 'plot', 'commercial'] },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_project_details',
      description: 'Get detailed information about a specific project including unit inventory breakdown, sales revenue, lead count, and budget info.',
      parameters: {
        type: 'object',
        properties: {
          project_id: { type: 'string', description: 'Project ObjectId' },
          project_name: { type: 'string', description: 'If ID not known, search by name' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_project_budget_variance',
      description: 'Get budget vs actual analysis for a project — target revenue vs collected revenue and variance percentage.',
      parameters: {
        type: 'object',
        properties: {
          project_id: { type: 'string', description: 'Project ID' },
          project_name: { type: 'string', description: 'If ID not known, search by name' },
        },
      },
    },
  },

  // 4.2 Sales & Revenue Functions
  {
    type: 'function',
    function: {
      name: 'get_sales_summary',
      description: 'Get sales summary — total bookings count, total revenue, breakdown by project, by status. Can filter by period, project, or salesperson.',
      parameters: {
        type: 'object',
        properties: {
          project_id: { type: 'string', description: 'Filter by project' },
          period: { type: 'string', enum: ['today', 'this_week', 'this_month', 'this_quarter', 'this_year', 'last_month', 'last_quarter', 'custom'] },
          start_date: { type: 'string', description: 'Custom start date (ISO format)' },
          end_date: { type: 'string', description: 'Custom end date (ISO format)' },
          salesperson_id: { type: 'string', description: 'Filter by salesperson' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_sales_forecast',
      description: 'Get sales forecast/projection based on historical velocity. Returns monthly projected sales and revenue.',
      parameters: {
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          project_name: { type: 'string', description: 'If ID not known, search by name' },
          period: { type: 'string', enum: ['3_months', '6_months', '12_months'], description: 'Forecast period, default 6_months' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_revenue_analysis',
      description: 'Get revenue analysis — total collected, total pending, total overdue amounts from payment transactions.',
      parameters: {
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          period: { type: 'string', enum: ['this_month', 'this_quarter', 'this_year', 'last_month', 'last_quarter'] },
        },
      },
    },
  },

  // 4.3 Lead Functions
  {
    type: 'function',
    function: {
      name: 'get_leads_summary',
      description: 'Get leads overview — counts by status, source, priority. Can filter by project, status, priority, assigned user, or source.',
      parameters: {
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          status: { type: 'string' },
          priority: { type: 'string', enum: ['Critical', 'High', 'Medium', 'Low', 'Very Low'] },
          assigned_to: { type: 'string', description: 'Filter by assigned user ID' },
          source: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_lead_funnel',
      description: 'Get lead conversion funnel — counts at each stage (New → Contacted → Qualified → Site Visit → Negotiating → Booked) with conversion rates.',
      parameters: {
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          period: { type: 'string', enum: ['this_month', 'this_quarter', 'this_year', 'last_month'] },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_high_priority_leads',
      description: 'Get leads needing immediate attention — high/critical priority leads and overdue follow-ups.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max results to return, default 10' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_lead_details',
      description: 'Search for a specific lead by name, phone, or email. Returns detailed lead info.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Lead name, phone, or email to search for' },
        },
        required: ['search'],
      },
    },
  },

  // 4.4 Unit/Inventory Functions
  {
    type: 'function',
    function: {
      name: 'get_inventory_summary',
      description: 'Get unit inventory status — available, booked, sold, blocked counts by project or tower.',
      parameters: {
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          tower_id: { type: 'string' },
          status: { type: 'string', enum: ['available', 'booked', 'sold', 'blocked'] },
          type: { type: 'string', description: 'Unit type like 2BHK, 3BHK' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_available_units',
      description: 'Get list of available units with pricing, type, floor, and facing details. Useful when looking for specific unit options.',
      parameters: {
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          tower_id: { type: 'string' },
          unit_type: { type: 'string', description: 'e.g. 2BHK, 3BHK' },
          min_price: { type: 'number' },
          max_price: { type: 'number' },
          floor_preference: { type: 'string', enum: ['low', 'mid', 'high'] },
          facing: { type: 'string' },
        },
      },
    },
  },

  // 4.5 Payment Functions
  {
    type: 'function',
    function: {
      name: 'get_payment_summary',
      description: 'Get payment collection summary — total collected, total pending, total overdue amounts, transaction count.',
      parameters: {
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          period: { type: 'string', enum: ['this_month', 'this_quarter', 'this_year', 'last_month'] },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_overdue_payments',
      description: 'Get overdue payment installments with customer details, overdue amount, and days overdue.',
      parameters: {
        type: 'object',
        properties: {
          project_id: { type: 'string' },
          min_overdue_days: { type: 'number', description: 'Minimum days overdue to filter' },
          limit: { type: 'number', description: 'Max results, default 20' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_payments_due_today',
      description: 'Get installments due today or this week.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },

  // 4.6 Team & Performance Functions
  {
    type: 'function',
    function: {
      name: 'get_team_performance',
      description: 'Get sales team performance — sales count and revenue by salesperson, lead conversion rates.',
      parameters: {
        type: 'object',
        properties: {
          period: { type: 'string', enum: ['this_month', 'this_quarter', 'this_year', 'last_month'] },
          role: { type: 'string', description: 'Filter by user role' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_commission_summary',
      description: 'Get commission overview — total pending, approved, paid commission amounts.',
      parameters: {
        type: 'object',
        properties: {
          partner_id: { type: 'string' },
          project_id: { type: 'string' },
          status: { type: 'string' },
        },
      },
    },
  },

  // 4.7 Comparison & Analytics Functions
  {
    type: 'function',
    function: {
      name: 'compare_projects',
      description: 'Compare two or more projects on sales count, revenue, inventory, and sales velocity.',
      parameters: {
        type: 'object',
        properties: {
          project_ids: { type: 'array', items: { type: 'string' }, description: 'Array of project IDs to compare' },
          project_names: { type: 'array', items: { type: 'string' }, description: 'If IDs unknown, search by names' },
          metrics: { type: 'array', items: { type: 'string' }, description: 'Metrics to compare: sales, revenue, velocity, inventory' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_dashboard_overview',
      description: 'Get high-level business overview — total projects, total leads, total sales, total revenue collected, overdue amount, available units. Use this for broad "how is business" questions.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },

  // 4.8 Task & Ticketing Functions
  {
    type: 'function',
    function: {
      name: 'get_task_summary',
      description: 'Get task overview — counts by status, priority, and category. Includes overdue count and completion rate. Use for questions like "how many tasks are open", "task status breakdown", "what is the task workload".',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['Open', 'In Progress', 'Under Review', 'Completed', 'On Hold', 'Cancelled'] },
          priority: { type: 'string', enum: ['Critical', 'High', 'Medium', 'Low'] },
          category: { type: 'string', enum: ['Lead & Sales', 'Payment & Collection', 'Construction', 'Document & Compliance', 'Customer Service', 'Approval', 'General'] },
          assigned_to: { type: 'string', description: 'Filter by assigned user ID' },
          period: { type: 'string', enum: ['today', 'this_week', 'this_month', 'this_quarter', 'this_year', 'last_month'] },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_my_tasks',
      description: 'Get the current user\'s tasks grouped by urgency — overdue, due today, due this week, in progress, and recently completed. Use for questions like "what are my tasks", "what do I need to do", "my pending work".',
      parameters: {
        type: 'object',
        properties: {
          include_completed: { type: 'boolean', description: 'Include recently completed tasks (last 7 days). Default false.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_team_task_workload',
      description: 'Get task workload across team members — how many tasks each person has, broken down by status and priority. Use for questions like "team workload", "who has most tasks", "task distribution".',
      parameters: {
        type: 'object',
        properties: {
          period: { type: 'string', enum: ['this_week', 'this_month', 'this_quarter'] },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_overdue_tasks',
      description: 'Get overdue tasks with aging details — how many days overdue, assignee, priority. Use for questions like "overdue tasks", "delayed tasks", "what tasks are late".',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: ['Lead & Sales', 'Payment & Collection', 'Construction', 'Document & Compliance', 'Customer Service', 'Approval', 'General'] },
          priority: { type: 'string', enum: ['Critical', 'High', 'Medium', 'Low'] },
          limit: { type: 'number', description: 'Max results to return, default 15' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_task_details',
      description: 'Search for a specific task by task number (e.g. TASK-001) or by title keyword. Returns full task details including status, assignee, checklist progress, comments count, and activity.',
      parameters: {
        type: 'object',
        properties: {
          task_number: { type: 'string', description: 'Task number like TASK-001' },
          search: { type: 'string', description: 'Search by title keyword' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_task_analytics',
      description: 'Get task analytics — completion rate, average resolution time, SLA compliance, auto-generated task breakdown, category distribution, overdue aging buckets. Use for questions like "task performance", "task metrics", "how fast are tasks being completed".',
      parameters: {
        type: 'object',
        properties: {
          period: { type: 'string', enum: ['this_week', 'this_month', 'this_quarter', 'this_year', 'last_month'] },
          category: { type: 'string', enum: ['Lead & Sales', 'Payment & Collection', 'Construction', 'Document & Compliance', 'Customer Service', 'Approval', 'General'] },
        },
      },
    },
  },
  // ---- Competitive Analysis Functions ----
  {
    type: 'function',
    function: {
      name: 'get_market_comparison',
      description: 'Compare our project pricing against competitor projects in the same locality. Use for questions like "how does our pricing compare", "are we competitive", "what are competitors charging", "market rate comparison".',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: 'City name' },
          area: { type: 'string', description: 'Locality/area name' },
          project_id: { type: 'string', description: 'Our project ID to compare against' },
        },
        required: ['city', 'area'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_competitive_positioning',
      description: 'Get our competitive position in the market — segment, percentile ranking, advantages, disadvantages. Use for questions like "market position", "where do we stand", "competitive advantage", "pricing position".',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: 'City name' },
          area: { type: 'string', description: 'Locality/area name' },
          project_id: { type: 'string', description: 'Our project ID' },
        },
        required: ['city', 'area'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_pricing_recommendations',
      description: 'Get AI-driven pricing recommendations based on competitive data. Use for questions like "should we change price", "optimal pricing", "pricing strategy", "what price should we set".',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: 'City name' },
          area: { type: 'string', description: 'Locality/area name' },
          project_id: { type: 'string', description: 'Our project ID' },
        },
        required: ['city', 'area'],
      },
    },
  },
];

// =============================================================================
// FUNCTION IMPLEMENTATIONS
// =============================================================================

const functionImplementations = {
  // ---- 4.1 Project Functions ----

  get_projects: async (params, user, accessibleProjectIds) => {
    const filter = applyRoleScope({}, user, 'project');
    if (params.status) filter.status = params.status;
    if (params.type) filter.type = params.type;
    if (params.name_search) filter.name = { $regex: params.name_search, $options: 'i' };
    filter._id = getProjectScopeFilter(accessibleProjectIds);

    const projects = await Project.find(filter)
      .select('name status type location totalUnits priceRange targetRevenue launchDate')
      .lean()
      .limit(20);

    return {
      count: projects.length,
      projects: projects.map(p => ({
        id: p._id,
        name: p.name,
        status: p.status,
        type: p.type,
        city: p.location?.city,
        area: p.location?.area,
        totalUnits: p.totalUnits,
        priceRange: p.priceRange,
        targetRevenue: p.targetRevenue,
        launchDate: p.launchDate,
      })),
    };
  },

  get_project_details: async (params, user, accessibleProjectIds) => {
    const project = await resolveProject(user.organization, params.project_id, params.project_name);
    if (!project) return { error: 'Project not found' };
    if (project && !isProjectAccessible(accessibleProjectIds, project._id)) return { error: 'You do not have access to this project' };

    // Get unit breakdown
    const unitStats = await Unit.aggregate([
      { $match: { project: project._id, organization: user.organization } },
      { $group: { _id: '$status', count: { $sum: 1 }, totalValue: { $sum: '$currentPrice' } } },
    ]);

    // Get sales stats
    const salesStats = await Sale.aggregate([
      { $match: { project: project._id, organization: user.organization, status: { $ne: 'Cancelled' } } },
      { $group: { _id: null, totalSales: { $sum: 1 }, totalRevenue: { $sum: '$salePrice' }, avgPrice: { $avg: '$salePrice' } } },
    ]);

    // Get lead count
    const leadCount = await Lead.countDocuments({ project: project._id, organization: user.organization });

    // Get towers
    const towers = await Tower.find({ project: project._id, organization: user.organization })
      .select('towerName towerCode totalFloors totalUnits status')
      .lean();

    const inventory = {};
    unitStats.forEach(s => { inventory[s._id] = { count: s.count, value: s.totalValue }; });

    return {
      id: project._id,
      name: project.name,
      status: project.status,
      type: project.type,
      location: project.location,
      totalUnits: project.totalUnits,
      priceRange: project.priceRange,
      targetRevenue: project.targetRevenue,
      launchDate: project.launchDate,
      expectedCompletionDate: project.expectedCompletionDate,
      amenities: project.amenities,
      inventory,
      sales: salesStats[0] || { totalSales: 0, totalRevenue: 0, avgPrice: 0 },
      leadCount,
      towers: towers.map(t => ({ name: t.towerName, code: t.towerCode, floors: t.totalFloors, units: t.totalUnits, status: t.status })),
    };
  },

  get_project_budget_variance: async (params, user, accessibleProjectIds) => {
    const project = await resolveProject(user.organization, params.project_id, params.project_name);
    if (!project) return { error: 'Project not found' };
    if (project && !isProjectAccessible(accessibleProjectIds, project._id)) return { error: 'You do not have access to this project' };

    // Collected revenue from completed/cleared transactions
    const revenueData = await PaymentTransaction.aggregate([
      { $match: { project: project._id, organization: user.organization, status: { $in: ['completed', 'cleared'] } } },
      { $group: { _id: null, totalCollected: { $sum: '$amount' } } },
    ]);

    // Total booked revenue from sales
    const salesData = await Sale.aggregate([
      { $match: { project: project._id, organization: user.organization, status: { $ne: 'Cancelled' } } },
      { $group: { _id: null, totalBooked: { $sum: '$salePrice' }, salesCount: { $sum: 1 } } },
    ]);

    const targetRevenue = project.targetRevenue || 0;
    const totalCollected = revenueData[0]?.totalCollected || 0;
    const totalBooked = salesData[0]?.totalBooked || 0;
    const salesCount = salesData[0]?.salesCount || 0;
    const varianceAmount = totalCollected - targetRevenue;
    const variancePercentage = targetRevenue > 0 ? ((varianceAmount / targetRevenue) * 100).toFixed(2) : 0;

    return {
      projectName: project.name,
      targetRevenue,
      totalBooked,
      totalCollected,
      pendingCollection: totalBooked - totalCollected,
      varianceAmount,
      variancePercentage: Number(variancePercentage),
      salesCount,
      totalUnits: project.totalUnits,
      revenuePerUnit: salesCount > 0 ? Math.round(totalBooked / salesCount) : 0,
      budgetTracking: project.budgetTracking ? {
        lastVariancePercentage: project.budgetTracking.lastVariancePercentage,
        varianceThreshold: project.budgetTracking.varianceThreshold,
      } : null,
    };
  },

  // ---- 4.2 Sales & Revenue Functions ----

  get_sales_summary: async (params, user, accessibleProjectIds) => {
    const filter = applyRoleScope({}, user, 'sale');
    filter.status = { $ne: 'Cancelled' };

    if (params.project_id) {
      if (!isProjectAccessible(accessibleProjectIds, params.project_id)) return { error: 'You do not have access to this project' };
      filter.project = new mongoose.Types.ObjectId(params.project_id);
    } else {
      filter.project = getProjectScopeFilter(accessibleProjectIds);
    }
    if (params.salesperson_id) filter.salesPerson = new mongoose.Types.ObjectId(params.salesperson_id);

    if (params.period || params.start_date) {
      const { start, end } = getDateRange(params.period || 'this_month', params.start_date, params.end_date);
      filter.bookingDate = { $gte: start, $lte: end };
    }

    // Overall summary
    const summary = await Sale.aggregate([
      { $match: filter },
      { $group: { _id: null, totalSales: { $sum: 1 }, totalRevenue: { $sum: '$salePrice' }, avgDealSize: { $avg: '$salePrice' } } },
    ]);

    // By project
    const byProject = await Sale.aggregate([
      { $match: filter },
      { $lookup: { from: 'projects', localField: 'project', foreignField: '_id', as: 'projectInfo' } },
      { $unwind: '$projectInfo' },
      { $group: { _id: '$project', projectName: { $first: '$projectInfo.name' }, sales: { $sum: 1 }, revenue: { $sum: '$salePrice' } } },
      { $sort: { revenue: -1 } },
    ]);

    // By status
    const byStatus = await Sale.aggregate([
      { $match: { ...filter, status: { $exists: true } } },
      { $group: { _id: '$status', count: { $sum: 1 }, revenue: { $sum: '$salePrice' } } },
    ]);

    return {
      period: params.period || 'all_time',
      overall: summary[0] || { totalSales: 0, totalRevenue: 0, avgDealSize: 0 },
      byProject: byProject.map(p => ({ projectName: p.projectName, sales: p.sales, revenue: p.revenue })),
      byStatus: byStatus.map(s => ({ status: s._id, count: s.count, revenue: s.revenue })),
    };
  },

  get_sales_forecast: async (params, user, accessibleProjectIds) => {
    let project = null;
    if (params.project_id || params.project_name) {
      project = await resolveProject(user.organization, params.project_id, params.project_name);
      if (!project) return { error: 'Project not found' };
      if (!isProjectAccessible(accessibleProjectIds, project._id)) return { error: 'You do not have access to this project' };
    }

    const months = params.period === '3_months' ? 3 : params.period === '12_months' ? 12 : 6;

    // Get historical monthly sales for the last 6 months
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const matchFilter = {
      organization: user.organization,
      status: { $ne: 'Cancelled' },
      bookingDate: { $gte: sixMonthsAgo },
    };
    if (project) {
      matchFilter.project = project._id;
    } else {
      matchFilter.project = getProjectScopeFilter(accessibleProjectIds);
    }

    const monthlySales = await Sale.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: { year: { $year: '$bookingDate' }, month: { $month: '$bookingDate' } },
          sales: { $sum: 1 },
          revenue: { $sum: '$salePrice' },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);

    // Calculate average monthly velocity
    const totalHistoricalSales = monthlySales.reduce((sum, m) => sum + m.sales, 0);
    const totalHistoricalRevenue = monthlySales.reduce((sum, m) => sum + m.revenue, 0);
    const monthsWithData = monthlySales.length || 1;
    const avgMonthlySales = Math.round(totalHistoricalSales / monthsWithData);
    const avgMonthlyRevenue = Math.round(totalHistoricalRevenue / monthsWithData);

    // Generate forecast
    const forecast = [];
    const now = new Date();
    for (let i = 1; i <= months; i++) {
      const forecastDate = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const monthName = forecastDate.toLocaleString('default', { month: 'short', year: 'numeric' });
      forecast.push({
        month: monthName,
        projectedSales: avgMonthlySales,
        projectedRevenue: avgMonthlyRevenue,
      });
    }

    // Available inventory
    const inventoryFilter = { organization: user.organization, status: 'available' };
    if (project) {
      inventoryFilter.project = project._id;
    } else {
      inventoryFilter.project = getProjectScopeFilter(accessibleProjectIds);
    }
    const availableUnits = await Unit.countDocuments(inventoryFilter);

    return {
      projectName: project?.name || 'All Projects',
      forecastPeriod: `${months} months`,
      currentVelocity: { salesPerMonth: avgMonthlySales, revenuePerMonth: avgMonthlyRevenue },
      historicalData: monthlySales.map(m => ({
        month: `${m._id.year}-${String(m._id.month).padStart(2, '0')}`,
        sales: m.sales,
        revenue: m.revenue,
      })),
      forecast,
      totalProjectedSales: avgMonthlySales * months,
      totalProjectedRevenue: avgMonthlyRevenue * months,
      availableInventory: availableUnits,
      confidence: monthlySales.length >= 4 ? 85 : monthlySales.length >= 2 ? 65 : 40,
    };
  },

  get_revenue_analysis: async (params, user, accessibleProjectIds) => {
    const filter = { organization: user.organization };
    if (params.project_id) {
      if (!isProjectAccessible(accessibleProjectIds, params.project_id)) return { error: 'You do not have access to this project' };
      filter.project = new mongoose.Types.ObjectId(params.project_id);
    } else {
      filter.project = getProjectScopeFilter(accessibleProjectIds);
    }

    const { start, end } = getDateRange(params.period || 'this_month');

    // Collected revenue
    const collected = await PaymentTransaction.aggregate([
      { $match: { ...filter, status: { $in: ['completed', 'cleared'] }, paymentDate: { $gte: start, $lte: end } } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]);

    // Total outstanding from active payment plans
    const outstanding = await PaymentPlan.aggregate([
      { $match: { ...filter, status: 'active' } },
      { $group: { _id: null, totalOutstanding: { $sum: '$financialSummary.totalOutstanding' }, totalOverdue: { $sum: '$financialSummary.totalOverdue' } } },
    ]);

    // Pending transactions
    const pending = await PaymentTransaction.aggregate([
      { $match: { ...filter, status: { $in: ['pending', 'processing'] } } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]);

    return {
      period: params.period || 'this_month',
      collected: { amount: collected[0]?.total || 0, transactionCount: collected[0]?.count || 0 },
      outstanding: outstanding[0]?.totalOutstanding || 0,
      overdue: outstanding[0]?.totalOverdue || 0,
      pendingTransactions: { amount: pending[0]?.total || 0, count: pending[0]?.count || 0 },
    };
  },

  // ---- 4.3 Lead Functions ----

  get_leads_summary: async (params, user, accessibleProjectIds) => {
    const filter = applyRoleScope({}, user, 'lead');
    if (params.project_id) {
      if (!isProjectAccessible(accessibleProjectIds, params.project_id)) return { error: 'You do not have access to this project' };
      filter.project = new mongoose.Types.ObjectId(params.project_id);
    } else {
      filter.project = getProjectScopeFilter(accessibleProjectIds);
    }
    if (params.status) filter.status = params.status;
    if (params.priority) filter.priority = params.priority;
    if (params.assigned_to) filter.assignedTo = new mongoose.Types.ObjectId(params.assigned_to);
    if (params.source) filter.source = params.source;

    const totalCount = await Lead.countDocuments(filter);

    // By status
    const byStatus = await Lead.aggregate([
      { $match: filter },
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    // By source
    const bySource = await Lead.aggregate([
      { $match: filter },
      { $group: { _id: '$source', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    // By priority
    const byPriority = await Lead.aggregate([
      { $match: filter },
      { $group: { _id: '$priority', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    // Recent leads (last 5)
    const recentLeads = await Lead.find(filter)
      .sort({ createdAt: -1 })
      .limit(5)
      .select('firstName lastName status priority source score createdAt')
      .populate('project', 'name')
      .lean();

    return {
      totalCount,
      byStatus: byStatus.map(s => ({ status: s._id, count: s.count })),
      bySource: bySource.map(s => ({ source: s._id, count: s.count })),
      byPriority: byPriority.map(p => ({ priority: p._id, count: p.count })),
      recentLeads: recentLeads.map(l => ({
        name: `${l.firstName} ${l.lastName || ''}`.trim(),
        status: l.status,
        priority: l.priority,
        source: l.source,
        score: l.score,
        project: l.project?.name,
        createdAt: l.createdAt,
      })),
    };
  },

  get_lead_funnel: async (params, user, accessibleProjectIds) => {
    const filter = applyRoleScope({}, user, 'lead');
    if (params.project_id) {
      if (!isProjectAccessible(accessibleProjectIds, params.project_id)) return { error: 'You do not have access to this project' };
      filter.project = new mongoose.Types.ObjectId(params.project_id);
    } else {
      filter.project = getProjectScopeFilter(accessibleProjectIds);
    }

    if (params.period) {
      const { start, end } = getDateRange(params.period);
      filter.createdAt = { $gte: start, $lte: end };
    }

    const stages = ['New', 'Contacted', 'Qualified', 'Site Visit Scheduled', 'Site Visit Completed', 'Negotiating', 'Booked', 'Lost', 'Unqualified'];

    const funnelData = await Lead.aggregate([
      { $match: filter },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);

    const funnelMap = {};
    funnelData.forEach(f => { funnelMap[f._id] = f.count; });

    const totalLeads = Object.values(funnelMap).reduce((sum, c) => sum + c, 0);
    const booked = funnelMap['Booked'] || 0;
    const lost = funnelMap['Lost'] || 0;

    return {
      period: params.period || 'all_time',
      totalLeads,
      funnel: stages.map(stage => ({
        stage,
        count: funnelMap[stage] || 0,
        percentage: totalLeads > 0 ? Number(((funnelMap[stage] || 0) / totalLeads * 100).toFixed(1)) : 0,
      })),
      conversionRate: totalLeads > 0 ? Number(((booked / totalLeads) * 100).toFixed(1)) : 0,
      lossRate: totalLeads > 0 ? Number(((lost / totalLeads) * 100).toFixed(1)) : 0,
    };
  },

  get_high_priority_leads: async (params, user, accessibleProjectIds) => {
    const limit = params.limit || 10;
    const filter = applyRoleScope({}, user, 'lead');
    filter.status = { $nin: ['Booked', 'Lost', 'Unqualified'] };
    filter.project = getProjectScopeFilter(accessibleProjectIds);

    // High/Critical priority leads
    const highPriorityLeads = await Lead.find({ ...filter, priority: { $in: ['Critical', 'High'] } })
      .sort({ score: -1 })
      .limit(limit)
      .select('firstName lastName status priority score phone email followUpSchedule project')
      .populate('project', 'name')
      .populate('assignedTo', 'firstName lastName')
      .lean();

    // Overdue follow-ups
    const now = new Date();
    const overdueLeads = await Lead.find({
      ...filter,
      'followUpSchedule.nextFollowUpDate': { $lt: now },
    })
      .sort({ 'followUpSchedule.nextFollowUpDate': 1 })
      .limit(limit)
      .select('firstName lastName status priority score followUpSchedule project')
      .populate('project', 'name')
      .populate('assignedTo', 'firstName lastName')
      .lean();

    return {
      highPriorityCount: highPriorityLeads.length,
      overdueFollowUpCount: overdueLeads.length,
      highPriorityLeads: highPriorityLeads.map(l => ({
        id: l._id,
        name: `${l.firstName} ${l.lastName || ''}`.trim(),
        status: l.status,
        priority: l.priority,
        score: l.score,
        project: l.project?.name,
        assignedTo: l.assignedTo ? `${l.assignedTo.firstName} ${l.assignedTo.lastName}` : 'Unassigned',
        nextFollowUp: l.followUpSchedule?.nextFollowUpDate,
        phone: l.phone,
      })),
      overdueFollowUps: overdueLeads.map(l => ({
        id: l._id,
        name: `${l.firstName} ${l.lastName || ''}`.trim(),
        status: l.status,
        priority: l.priority,
        score: l.score,
        project: l.project?.name,
        assignedTo: l.assignedTo ? `${l.assignedTo.firstName} ${l.assignedTo.lastName}` : 'Unassigned',
        overdueDate: l.followUpSchedule?.nextFollowUpDate,
        daysOverdue: Math.floor((now - new Date(l.followUpSchedule.nextFollowUpDate)) / (1000 * 60 * 60 * 24)),
      })),
    };
  },

  get_lead_details: async (params, user, accessibleProjectIds) => {
    const filter = applyRoleScope({}, user, 'lead');
    filter.project = getProjectScopeFilter(accessibleProjectIds);
    const search = params.search;

    filter.$or = [
      { firstName: { $regex: search, $options: 'i' } },
      { lastName: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];

    const leads = await Lead.find(filter)
      .limit(5)
      .select('firstName lastName email phone status priority score source budget requirements followUpSchedule engagementMetrics project assignedTo createdAt')
      .populate('project', 'name')
      .populate('assignedTo', 'firstName lastName')
      .lean();

    if (leads.length === 0) return { error: `No leads found matching "${search}"` };

    return {
      count: leads.length,
      leads: leads.map(l => ({
        id: l._id,
        name: `${l.firstName} ${l.lastName || ''}`.trim(),
        email: l.email,
        phone: l.phone,
        status: l.status,
        priority: l.priority,
        score: l.score,
        source: l.source,
        budget: l.budget,
        requirements: l.requirements,
        project: l.project?.name,
        assignedTo: l.assignedTo ? `${l.assignedTo.firstName} ${l.assignedTo.lastName}` : 'Unassigned',
        nextFollowUp: l.followUpSchedule?.nextFollowUpDate,
        totalInteractions: l.engagementMetrics?.totalInteractions || 0,
        lastInteraction: l.engagementMetrics?.lastInteractionDate,
        createdAt: l.createdAt,
      })),
    };
  },

  // ---- 4.4 Unit/Inventory Functions ----

  get_inventory_summary: async (params, user, accessibleProjectIds) => {
    const matchFilter = { organization: user.organization };
    if (params.project_id) {
      if (!isProjectAccessible(accessibleProjectIds, params.project_id)) return { error: 'You do not have access to this project' };
      matchFilter.project = new mongoose.Types.ObjectId(params.project_id);
    } else {
      matchFilter.project = getProjectScopeFilter(accessibleProjectIds);
    }
    if (params.tower_id) matchFilter.tower = new mongoose.Types.ObjectId(params.tower_id);
    if (params.status) matchFilter.status = params.status;
    if (params.type) matchFilter.type = { $regex: params.type, $options: 'i' };

    const summary = await Unit.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalValue: { $sum: '$currentPrice' },
          avgPrice: { $avg: '$currentPrice' },
        },
      },
    ]);

    // By type
    const byType = await Unit.aggregate([
      { $match: matchFilter },
      { $group: { _id: '$type', count: { $sum: 1 }, available: { $sum: { $cond: [{ $eq: ['$status', 'available'] }, 1, 0] } } } },
      { $sort: { count: -1 } },
    ]);

    const totalUnits = summary.reduce((sum, s) => sum + s.count, 0);
    const statusMap = {};
    summary.forEach(s => { statusMap[s._id] = { count: s.count, totalValue: s.totalValue, avgPrice: Math.round(s.avgPrice) }; });

    return {
      totalUnits,
      byStatus: statusMap,
      byType: byType.map(t => ({ type: t._id, total: t.count, available: t.available })),
    };
  },

  get_available_units: async (params, user, accessibleProjectIds) => {
    const filter = { organization: user.organization, status: 'available' };
    if (params.project_id) {
      if (!isProjectAccessible(accessibleProjectIds, params.project_id)) return { error: 'You do not have access to this project' };
      filter.project = new mongoose.Types.ObjectId(params.project_id);
    } else {
      filter.project = getProjectScopeFilter(accessibleProjectIds);
    }
    if (params.tower_id) filter.tower = new mongoose.Types.ObjectId(params.tower_id);
    if (params.unit_type) filter.type = { $regex: params.unit_type, $options: 'i' };
    if (params.facing) filter.facing = params.facing;

    if (params.min_price || params.max_price) {
      filter.currentPrice = {};
      if (params.min_price) filter.currentPrice.$gte = params.min_price;
      if (params.max_price) filter.currentPrice.$lte = params.max_price;
    }

    if (params.floor_preference) {
      // Get max floor to determine ranges
      if (params.floor_preference === 'low') filter.floor = { $lte: 5 };
      else if (params.floor_preference === 'mid') filter.floor = { $gte: 6, $lte: 15 };
      else if (params.floor_preference === 'high') filter.floor = { $gte: 16 };
    }

    const units = await Unit.find(filter)
      .sort({ currentPrice: 1 })
      .limit(20)
      .select('unitNumber type floor areaSqft currentPrice facing features specifications')
      .populate('project', 'name')
      .populate('tower', 'towerName')
      .lean();

    return {
      count: units.length,
      units: units.map(u => ({
        id: u._id,
        unitNumber: u.unitNumber,
        type: u.type,
        floor: u.floor,
        area: u.areaSqft,
        price: u.currentPrice,
        facing: u.facing,
        project: u.project?.name,
        tower: u.tower?.towerName,
        bedrooms: u.specifications?.bedrooms,
        bathrooms: u.specifications?.bathrooms,
        hasBalcony: u.features?.hasBalcony,
        hasParkingSlot: u.features?.hasParkingSlot,
      })),
    };
  },

  // ---- 4.5 Payment Functions ----

  get_payment_summary: async (params, user, accessibleProjectIds) => {
    const filter = { organization: user.organization };
    if (params.project_id) {
      if (!isProjectAccessible(accessibleProjectIds, params.project_id)) return { error: 'You do not have access to this project' };
      filter.project = new mongoose.Types.ObjectId(params.project_id);
    } else {
      filter.project = getProjectScopeFilter(accessibleProjectIds);
    }

    const { start, end } = getDateRange(params.period || 'this_month');

    // Collected in period
    const collected = await PaymentTransaction.aggregate([
      { $match: { ...filter, status: { $in: ['completed', 'cleared'] }, paymentDate: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: null,
          totalCollected: { $sum: '$amount' },
          transactionCount: { $sum: 1 },
        },
      },
    ]);

    // By payment method
    const byMethod = await PaymentTransaction.aggregate([
      { $match: { ...filter, status: { $in: ['completed', 'cleared'] }, paymentDate: { $gte: start, $lte: end } } },
      { $group: { _id: '$paymentMethod', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]);

    // Overdue installments
    const now = new Date();
    const overdueData = await Installment.aggregate([
      {
        $match: {
          organization: user.organization,
          status: 'overdue',
          project: params.project_id ? new mongoose.Types.ObjectId(params.project_id) : getProjectScopeFilter(accessibleProjectIds),
        },
      },
      { $group: { _id: null, totalOverdue: { $sum: '$pendingAmount' }, count: { $sum: 1 } } },
    ]);

    return {
      period: params.period || 'this_month',
      collected: collected[0]?.totalCollected || 0,
      transactionCount: collected[0]?.transactionCount || 0,
      overdue: { amount: overdueData[0]?.totalOverdue || 0, count: overdueData[0]?.count || 0 },
      byPaymentMethod: byMethod.map(m => ({ method: m._id, amount: m.amount, count: m.count })),
    };
  },

  get_overdue_payments: async (params, user, accessibleProjectIds) => {
    const limit = params.limit || 20;
    const now = new Date();

    const filter = {
      organization: user.organization,
      status: 'overdue',
    };
    if (params.project_id) {
      if (!isProjectAccessible(accessibleProjectIds, params.project_id)) return { error: 'You do not have access to this project' };
      filter.project = new mongoose.Types.ObjectId(params.project_id);
    } else {
      filter.project = getProjectScopeFilter(accessibleProjectIds);
    }

    const overdueInstallments = await Installment.find(filter)
      .sort({ currentDueDate: 1 })
      .limit(limit)
      .select('installmentNumber description currentAmount pendingAmount currentDueDate gracePeriodEndDate customer project')
      .populate('customer', 'firstName lastName phone email')
      .populate('project', 'name')
      .lean();

    let results = overdueInstallments.map(inst => {
      const graceEnd = inst.gracePeriodEndDate || inst.currentDueDate;
      const daysOverdue = Math.floor((now - new Date(graceEnd)) / (1000 * 60 * 60 * 24));
      return {
        installmentNumber: inst.installmentNumber,
        description: inst.description,
        amount: inst.currentAmount,
        pendingAmount: inst.pendingAmount,
        dueDate: inst.currentDueDate,
        daysOverdue,
        customerName: inst.customer ? `${inst.customer.firstName} ${inst.customer.lastName || ''}`.trim() : 'Unknown',
        customerPhone: inst.customer?.phone,
        projectName: inst.project?.name,
      };
    });

    if (params.min_overdue_days) {
      results = results.filter(r => r.daysOverdue >= params.min_overdue_days);
    }

    const totalOverdueAmount = results.reduce((sum, r) => sum + r.pendingAmount, 0);

    return {
      count: results.length,
      totalOverdueAmount,
      installments: results,
    };
  },

  get_payments_due_today: async (params, user, accessibleProjectIds) => {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfWeek = new Date(startOfDay);
    endOfWeek.setDate(endOfWeek.getDate() + 7);

    // Due today
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    const dueToday = await Installment.find({
      organization: user.organization,
      status: { $in: ['due', 'pending'] },
      currentDueDate: { $gte: startOfDay, $lte: endOfDay },
      project: getProjectScopeFilter(accessibleProjectIds),
    })
      .select('installmentNumber description currentAmount pendingAmount currentDueDate customer project')
      .populate('customer', 'firstName lastName phone')
      .populate('project', 'name')
      .lean();

    // Due this week
    const dueThisWeek = await Installment.find({
      organization: user.organization,
      status: { $in: ['due', 'pending'] },
      currentDueDate: { $gt: endOfDay, $lte: endOfWeek },
      project: getProjectScopeFilter(accessibleProjectIds),
    })
      .select('installmentNumber description currentAmount pendingAmount currentDueDate customer project')
      .populate('customer', 'firstName lastName phone')
      .populate('project', 'name')
      .lean();

    const formatInstallment = (inst) => ({
      installmentNumber: inst.installmentNumber,
      description: inst.description,
      amount: inst.currentAmount,
      pending: inst.pendingAmount,
      dueDate: inst.currentDueDate,
      customerName: inst.customer ? `${inst.customer.firstName} ${inst.customer.lastName || ''}`.trim() : 'Unknown',
      customerPhone: inst.customer?.phone,
      project: inst.project?.name,
    });

    return {
      dueToday: { count: dueToday.length, totalAmount: dueToday.reduce((s, i) => s + i.pendingAmount, 0), installments: dueToday.map(formatInstallment) },
      dueThisWeek: { count: dueThisWeek.length, totalAmount: dueThisWeek.reduce((s, i) => s + i.pendingAmount, 0), installments: dueThisWeek.map(formatInstallment) },
    };
  },

  // ---- 4.6 Team & Performance Functions ----

  get_team_performance: async (params, user, accessibleProjectIds) => {
    const filter = { organization: user.organization, status: { $ne: 'Cancelled' } };
    filter.project = getProjectScopeFilter(accessibleProjectIds);

    if (params.period) {
      const { start, end } = getDateRange(params.period);
      filter.bookingDate = { $gte: start, $lte: end };
    }

    // Sales by salesperson
    const salesByPerson = await Sale.aggregate([
      { $match: filter },
      {
        $lookup: { from: 'users', localField: 'salesPerson', foreignField: '_id', as: 'user' },
      },
      { $unwind: '$user' },
      ...(params.role ? [{ $match: { 'user.role': params.role } }] : []),
      {
        $group: {
          _id: '$salesPerson',
          name: { $first: { $concat: ['$user.firstName', ' ', '$user.lastName'] } },
          role: { $first: '$user.role' },
          salesCount: { $sum: 1 },
          totalRevenue: { $sum: '$salePrice' },
          avgDealSize: { $avg: '$salePrice' },
        },
      },
      { $sort: { totalRevenue: -1 } },
      { $limit: 20 },
    ]);

    // Lead conversion by salesperson
    const leadsByPerson = await Lead.aggregate([
      { $match: { organization: user.organization, assignedTo: { $exists: true }, project: getProjectScopeFilter(accessibleProjectIds) } },
      {
        $group: {
          _id: '$assignedTo',
          totalLeads: { $sum: 1 },
          booked: { $sum: { $cond: [{ $eq: ['$status', 'Booked'] }, 1, 0] } },
          lost: { $sum: { $cond: [{ $eq: ['$status', 'Lost'] }, 1, 0] } },
        },
      },
    ]);

    const leadMap = {};
    leadsByPerson.forEach(l => { leadMap[l._id.toString()] = l; });

    return {
      period: params.period || 'all_time',
      teamMembers: salesByPerson.map(p => {
        const leadData = leadMap[p._id.toString()] || { totalLeads: 0, booked: 0, lost: 0 };
        return {
          name: p.name,
          role: p.role,
          salesCount: p.salesCount,
          totalRevenue: p.totalRevenue,
          avgDealSize: Math.round(p.avgDealSize),
          totalLeads: leadData.totalLeads,
          conversionRate: leadData.totalLeads > 0 ? Number(((leadData.booked / leadData.totalLeads) * 100).toFixed(1)) : 0,
        };
      }),
    };
  },

  get_commission_summary: async (params, user, accessibleProjectIds) => {
    const filter = applyRoleScope({}, user, 'commission');
    if (params.partner_id) filter.partner = new mongoose.Types.ObjectId(params.partner_id);
    if (params.project_id) {
      if (!isProjectAccessible(accessibleProjectIds, params.project_id)) return { error: 'You do not have access to this project' };
      filter.project = new mongoose.Types.ObjectId(params.project_id);
    } else {
      filter.project = getProjectScopeFilter(accessibleProjectIds);
    }
    if (params.status) filter.status = params.status;

    const summary = await PartnerCommission.aggregate([
      { $match: filter },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$commissionCalculation.netCommission' },
          totalPaid: { $sum: '$paymentDetails.totalPaid' },
          totalPending: { $sum: '$paymentDetails.totalPending' },
        },
      },
    ]);

    const statusMap = {};
    let grandTotal = 0, grandPaid = 0, grandPending = 0;
    summary.forEach(s => {
      statusMap[s._id] = { count: s.count, amount: s.totalAmount, paid: s.totalPaid, pending: s.totalPending };
      grandTotal += s.totalAmount;
      grandPaid += s.totalPaid;
      grandPending += s.totalPending;
    });

    return {
      totalCommissions: grandTotal,
      totalPaid: grandPaid,
      totalPending: grandPending,
      byStatus: statusMap,
    };
  },

  // ---- 4.7 Comparison & Analytics Functions ----

  compare_projects: async (params, user, accessibleProjectIds) => {
    let projectIds = [];

    if (params.project_ids && params.project_ids.length > 0) {
      projectIds = params.project_ids.map(id => new mongoose.Types.ObjectId(id));
    } else if (params.project_names && params.project_names.length > 0) {
      const projects = await Project.find({
        organization: user.organization,
        name: { $in: params.project_names.map(n => new RegExp(n, 'i')) },
      }).lean();
      projectIds = projects.map(p => p._id);
    }

    if (accessibleProjectIds && accessibleProjectIds.length > 0) {
      projectIds = projectIds.filter(pid => accessibleProjectIds.includes(pid.toString()));
    }

    if (projectIds.length === 0) return { error: 'No projects found to compare' };

    const comparison = [];

    for (const pid of projectIds) {
      const project = await Project.findOne({ _id: pid, organization: user.organization })
        .select('name status type totalUnits targetRevenue priceRange')
        .lean();
      if (!project) continue;

      // Sales
      const sales = await Sale.aggregate([
        { $match: { project: pid, organization: user.organization, status: { $ne: 'Cancelled' } } },
        { $group: { _id: null, count: { $sum: 1 }, revenue: { $sum: '$salePrice' } } },
      ]);

      // Inventory
      const inventory = await Unit.aggregate([
        { $match: { project: pid, organization: user.organization } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]);
      const inventoryMap = {};
      inventory.forEach(i => { inventoryMap[i._id] = i.count; });

      // Leads
      const leadCount = await Lead.countDocuments({ project: pid, organization: user.organization, status: { $nin: ['Lost', 'Unqualified'] } });

      // Revenue collected
      const collected = await PaymentTransaction.aggregate([
        { $match: { project: pid, organization: user.organization, status: { $in: ['completed', 'cleared'] } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]);

      comparison.push({
        projectName: project.name,
        status: project.status,
        type: project.type,
        totalUnits: project.totalUnits,
        targetRevenue: project.targetRevenue,
        salesCount: sales[0]?.count || 0,
        bookedRevenue: sales[0]?.revenue || 0,
        collectedRevenue: collected[0]?.total || 0,
        availableUnits: inventoryMap['available'] || 0,
        soldUnits: inventoryMap['sold'] || 0,
        bookedUnits: inventoryMap['booked'] || 0,
        activeLeads: leadCount,
        salesVelocity: sales[0]?.count ? 'calculated from historical data' : '0 sales',
      });
    }

    return { projectsCompared: comparison.length, comparison };
  },

  get_dashboard_overview: async (params, user, accessibleProjectIds) => {
    const orgFilter = { organization: user.organization };
    const projectScopeFilter = getProjectScopeFilter(accessibleProjectIds);

    // Projects
    const projectCount = await Project.countDocuments({ ...orgFilter, _id: projectScopeFilter });
    const activeProjects = await Project.countDocuments({ ...orgFilter, _id: projectScopeFilter, status: { $in: ['launched', 'under-construction'] } });

    // Leads
    const leadBaseFilter = applyRoleScope({}, user, 'lead');
    leadBaseFilter.project = projectScopeFilter;
    const totalLeads = await Lead.countDocuments(leadBaseFilter);
    const activeLeads = await Lead.countDocuments({ ...leadBaseFilter, status: { $nin: ['Booked', 'Lost', 'Unqualified'] } });
    const hotLeads = await Lead.countDocuments({ ...leadBaseFilter, priority: { $in: ['Critical', 'High'] }, status: { $nin: ['Booked', 'Lost', 'Unqualified'] } });

    // Sales this month
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const salesThisMonth = await Sale.aggregate([
      { $match: { ...orgFilter, project: projectScopeFilter, status: { $ne: 'Cancelled' }, bookingDate: { $gte: monthStart } } },
      { $group: { _id: null, count: { $sum: 1 }, revenue: { $sum: '$salePrice' } } },
    ]);

    // Total revenue collected
    const totalCollected = await PaymentTransaction.aggregate([
      { $match: { ...orgFilter, project: projectScopeFilter, status: { $in: ['completed', 'cleared'] } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);

    // Overdue
    const overdueData = await Installment.aggregate([
      { $match: { ...orgFilter, project: projectScopeFilter, status: 'overdue' } },
      { $group: { _id: null, total: { $sum: '$pendingAmount' }, count: { $sum: 1 } } },
    ]);

    // Inventory
    const inventoryStats = await Unit.aggregate([
      { $match: { ...orgFilter, project: projectScopeFilter } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const inventoryMap = {};
    inventoryStats.forEach(i => { inventoryMap[i._id] = i.count; });

    return {
      projects: { total: projectCount, active: activeProjects },
      leads: { total: totalLeads, active: activeLeads, hotLeads },
      salesThisMonth: { count: salesThisMonth[0]?.count || 0, revenue: salesThisMonth[0]?.revenue || 0 },
      revenue: { totalCollected: totalCollected[0]?.total || 0 },
      overdue: { amount: overdueData[0]?.total || 0, count: overdueData[0]?.count || 0 },
      inventory: {
        available: inventoryMap['available'] || 0,
        booked: inventoryMap['booked'] || 0,
        sold: inventoryMap['sold'] || 0,
        blocked: inventoryMap['blocked'] || 0,
      },
    };
  },

  // ---- 4.8 Task & Ticketing Functions ----

  get_task_summary: async (params, user, accessibleProjectIds) => {
    const filter = { organization: user.organization };
    if (params.status) filter.status = params.status;
    if (params.priority) filter.priority = params.priority;
    if (params.category) filter.category = params.category;
    if (params.assigned_to) filter.assignedTo = new mongoose.Types.ObjectId(params.assigned_to);

    if (params.period) {
      const { start, end } = getDateRange(params.period);
      filter.createdAt = { $gte: start, $lte: end };
    }

    const totalCount = await Task.countDocuments(filter);

    // By status
    const byStatus = await Task.aggregate([
      { $match: filter },
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    // By priority
    const byPriority = await Task.aggregate([
      { $match: filter },
      { $group: { _id: '$priority', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    // By category
    const byCategory = await Task.aggregate([
      { $match: filter },
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    // Overdue count
    const now = new Date();
    const overdueCount = await Task.countDocuments({
      ...filter,
      status: { $nin: ['Completed', 'Cancelled'] },
      dueDate: { $lt: now },
    });

    // Completion rate
    const completedCount = byStatus.find(s => s._id === 'Completed')?.count || 0;
    const terminalStatuses = ['Completed', 'Cancelled'];
    const nonTerminal = byStatus.filter(s => !terminalStatuses.includes(s._id)).reduce((sum, s) => sum + s.count, 0);
    const completionRate = totalCount > 0 ? Number(((completedCount / totalCount) * 100).toFixed(1)) : 0;

    return {
      totalCount,
      overdueCount,
      completionRate,
      activeCount: nonTerminal,
      byStatus: byStatus.map(s => ({ status: s._id, count: s.count })),
      byPriority: byPriority.map(p => ({ priority: p._id, count: p.count })),
      byCategory: byCategory.map(c => ({ category: c._id, count: c.count })),
    };
  },

  get_my_tasks: async (params, user, accessibleProjectIds) => {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    const endOfWeek = new Date(startOfDay);
    endOfWeek.setDate(endOfWeek.getDate() + 7);

    const baseFilter = { organization: user.organization, assignedTo: user._id };

    // Overdue
    const overdue = await Task.find({
      ...baseFilter,
      status: { $nin: ['Completed', 'Cancelled'] },
      dueDate: { $lt: startOfDay },
    })
      .sort({ dueDate: 1 })
      .limit(10)
      .select('taskNumber title status priority category dueDate')
      .lean();

    // Due today
    const dueToday = await Task.find({
      ...baseFilter,
      status: { $nin: ['Completed', 'Cancelled'] },
      dueDate: { $gte: startOfDay, $lte: endOfDay },
    })
      .sort({ priority: 1 })
      .limit(10)
      .select('taskNumber title status priority category dueDate')
      .lean();

    // Due this week
    const dueThisWeek = await Task.find({
      ...baseFilter,
      status: { $nin: ['Completed', 'Cancelled'] },
      dueDate: { $gt: endOfDay, $lte: endOfWeek },
    })
      .sort({ dueDate: 1 })
      .limit(10)
      .select('taskNumber title status priority category dueDate')
      .lean();

    // In progress
    const inProgress = await Task.find({
      ...baseFilter,
      status: 'In Progress',
    })
      .sort({ updatedAt: -1 })
      .limit(10)
      .select('taskNumber title priority category dueDate')
      .lean();

    const formatTask = (t) => ({
      taskNumber: t.taskNumber,
      title: t.title,
      status: t.status,
      priority: t.priority,
      category: t.category,
      dueDate: t.dueDate,
      daysOverdue: t.dueDate && t.dueDate < now ? Math.floor((now - new Date(t.dueDate)) / (1000 * 60 * 60 * 24)) : 0,
    });

    const result = {
      overdue: { count: overdue.length, tasks: overdue.map(formatTask) },
      dueToday: { count: dueToday.length, tasks: dueToday.map(formatTask) },
      dueThisWeek: { count: dueThisWeek.length, tasks: dueThisWeek.map(formatTask) },
      inProgress: { count: inProgress.length, tasks: inProgress.map(formatTask) },
    };

    if (params.include_completed) {
      const sevenDaysAgo = new Date(now);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const recentlyCompleted = await Task.find({
        ...baseFilter,
        status: 'Completed',
        completedAt: { $gte: sevenDaysAgo },
      })
        .sort({ completedAt: -1 })
        .limit(10)
        .select('taskNumber title priority category completedAt')
        .lean();
      result.recentlyCompleted = { count: recentlyCompleted.length, tasks: recentlyCompleted.map(formatTask) };
    }

    return result;
  },

  get_team_task_workload: async (params, user, accessibleProjectIds) => {
    const filter = { organization: user.organization, status: { $nin: ['Completed', 'Cancelled'] } };

    if (params.period) {
      const { start, end } = getDateRange(params.period);
      filter.createdAt = { $gte: start, $lte: end };
    }

    const now = new Date();

    const workload = await Task.aggregate([
      { $match: filter },
      {
        $lookup: { from: 'users', localField: 'assignedTo', foreignField: '_id', as: 'assignee' },
      },
      { $unwind: { path: '$assignee', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: '$assignedTo',
          name: { $first: { $concat: [{ $ifNull: ['$assignee.firstName', 'Unassigned'] }, ' ', { $ifNull: ['$assignee.lastName', ''] }] } },
          role: { $first: '$assignee.role' },
          totalTasks: { $sum: 1 },
          open: { $sum: { $cond: [{ $eq: ['$status', 'Open'] }, 1, 0] } },
          inProgress: { $sum: { $cond: [{ $eq: ['$status', 'In Progress'] }, 1, 0] } },
          underReview: { $sum: { $cond: [{ $eq: ['$status', 'Under Review'] }, 1, 0] } },
          onHold: { $sum: { $cond: [{ $eq: ['$status', 'On Hold'] }, 1, 0] } },
          critical: { $sum: { $cond: [{ $eq: ['$priority', 'Critical'] }, 1, 0] } },
          high: { $sum: { $cond: [{ $eq: ['$priority', 'High'] }, 1, 0] } },
          overdue: { $sum: { $cond: [{ $and: [{ $lt: ['$dueDate', now] }, { $nin: ['$status', ['Completed', 'Cancelled']] }] }, 1, 0] } },
        },
      },
      { $sort: { totalTasks: -1 } },
      { $limit: 20 },
    ]);

    return {
      period: params.period || 'all_time',
      teamMembers: workload.map(w => ({
        name: w.name?.trim() || 'Unassigned',
        role: w.role,
        totalTasks: w.totalTasks,
        open: w.open,
        inProgress: w.inProgress,
        underReview: w.underReview,
        onHold: w.onHold,
        criticalCount: w.critical,
        highCount: w.high,
        overdueCount: w.overdue,
      })),
    };
  },

  get_overdue_tasks: async (params, user, accessibleProjectIds) => {
    const now = new Date();
    const filter = {
      organization: user.organization,
      status: { $nin: ['Completed', 'Cancelled'] },
      dueDate: { $lt: now },
    };
    if (params.category) filter.category = params.category;
    if (params.priority) filter.priority = params.priority;

    const limit = params.limit || 15;

    const overdueTasks = await Task.find(filter)
      .sort({ dueDate: 1 })
      .limit(limit)
      .select('taskNumber title status priority category dueDate assignedTo')
      .populate('assignedTo', 'firstName lastName')
      .lean();

    // Aging buckets
    const agingBuckets = { '1-7 days': 0, '8-14 days': 0, '15-30 days': 0, '30+ days': 0 };
    const allOverdueCount = await Task.countDocuments(filter);

    const tasks = overdueTasks.map(t => {
      const daysOverdue = Math.floor((now - new Date(t.dueDate)) / (1000 * 60 * 60 * 24));
      if (daysOverdue <= 7) agingBuckets['1-7 days']++;
      else if (daysOverdue <= 14) agingBuckets['8-14 days']++;
      else if (daysOverdue <= 30) agingBuckets['15-30 days']++;
      else agingBuckets['30+ days']++;

      return {
        taskNumber: t.taskNumber,
        title: t.title,
        status: t.status,
        priority: t.priority,
        category: t.category,
        dueDate: t.dueDate,
        daysOverdue,
        assignedTo: t.assignedTo ? `${t.assignedTo.firstName} ${t.assignedTo.lastName || ''}`.trim() : 'Unassigned',
      };
    });

    return {
      totalOverdue: allOverdueCount,
      showing: tasks.length,
      agingBuckets,
      tasks,
    };
  },

  get_task_details: async (params, user, accessibleProjectIds) => {
    const filter = { organization: user.organization };

    if (params.task_number) {
      filter.taskNumber = params.task_number.toUpperCase();
    } else if (params.search) {
      filter.$or = [
        { title: { $regex: params.search, $options: 'i' } },
        { taskNumber: { $regex: params.search, $options: 'i' } },
      ];
    } else {
      return { error: 'Please provide a task number or search keyword' };
    }

    const tasks = await Task.find(filter)
      .limit(5)
      .select('taskNumber title description status priority category dueDate startDate completedAt assignedTo assignedBy checklist comments linkedEntity tags sla autoGenerated createdAt')
      .populate('assignedTo', 'firstName lastName email')
      .populate('assignedBy', 'firstName lastName')
      .lean();

    if (tasks.length === 0) {
      return { error: `No tasks found matching "${params.task_number || params.search}"` };
    }

    return {
      count: tasks.length,
      tasks: tasks.map(t => {
        const checklistTotal = t.checklist?.length || 0;
        const checklistDone = t.checklist?.filter(c => c.isCompleted).length || 0;

        return {
          taskNumber: t.taskNumber,
          title: t.title,
          description: t.description?.substring(0, 300),
          status: t.status,
          priority: t.priority,
          category: t.category,
          dueDate: t.dueDate,
          startDate: t.startDate,
          completedAt: t.completedAt,
          assignedTo: t.assignedTo ? `${t.assignedTo.firstName} ${t.assignedTo.lastName || ''}`.trim() : 'Unassigned',
          assignedBy: t.assignedBy ? `${t.assignedBy.firstName} ${t.assignedBy.lastName || ''}`.trim() : null,
          checklistProgress: checklistTotal > 0 ? `${checklistDone}/${checklistTotal} (${Math.round((checklistDone / checklistTotal) * 100)}%)` : 'No checklist',
          commentsCount: t.comments?.length || 0,
          tags: t.tags,
          isAutoGenerated: t.autoGenerated?.isAutoGenerated || false,
          triggerType: t.autoGenerated?.triggerType,
          linkedEntity: t.linkedEntity?.entityType ? `${t.linkedEntity.entityType}: ${t.linkedEntity.displayLabel || t.linkedEntity.entityId}` : null,
          isOverdue: t.dueDate && new Date(t.dueDate) < new Date() && !['Completed', 'Cancelled'].includes(t.status),
          slaTargetHours: t.sla?.targetResolutionHours,
          createdAt: t.createdAt,
        };
      }),
    };
  },

  get_task_analytics: async (params, user, accessibleProjectIds) => {
    const filter = { organization: user.organization };

    if (params.period) {
      const { start, end } = getDateRange(params.period);
      filter.createdAt = { $gte: start, $lte: end };
    }
    if (params.category) filter.category = params.category;

    const now = new Date();

    // Use $facet for multiple aggregations in one query
    const analytics = await Task.aggregate([
      { $match: filter },
      {
        $facet: {
          statusDistribution: [
            { $group: { _id: '$status', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
          ],
          priorityDistribution: [
            { $group: { _id: '$priority', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
          ],
          categoryDistribution: [
            { $group: { _id: '$category', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
          ],
          completionMetrics: [
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                completed: { $sum: { $cond: [{ $eq: ['$status', 'Completed'] }, 1, 0] } },
                cancelled: { $sum: { $cond: [{ $eq: ['$status', 'Cancelled'] }, 1, 0] } },
                overdue: {
                  $sum: {
                    $cond: [
                      { $and: [{ $lt: ['$dueDate', now] }, { $nin: ['$status', ['Completed', 'Cancelled']] }] },
                      1,
                      0,
                    ],
                  },
                },
              },
            },
          ],
          avgResolutionTime: [
            { $match: { status: 'Completed', completedAt: { $exists: true } } },
            {
              $project: {
                resolutionHours: {
                  $divide: [{ $subtract: ['$completedAt', '$createdAt'] }, 3600000],
                },
              },
            },
            { $group: { _id: null, avgHours: { $avg: '$resolutionHours' }, minHours: { $min: '$resolutionHours' }, maxHours: { $max: '$resolutionHours' } } },
          ],
          autoGeneratedBreakdown: [
            { $match: { 'autoGenerated.isAutoGenerated': true } },
            { $group: { _id: '$autoGenerated.triggerType', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
          ],
          overdueAging: [
            { $match: { status: { $nin: ['Completed', 'Cancelled'] }, dueDate: { $lt: now } } },
            {
              $project: {
                daysOverdue: { $divide: [{ $subtract: [now, '$dueDate'] }, 86400000] },
              },
            },
            {
              $bucket: {
                groupBy: '$daysOverdue',
                boundaries: [0, 8, 15, 31, 10000],
                default: '30+',
                output: { count: { $sum: 1 } },
              },
            },
          ],
        },
      },
    ]);

    const result = analytics[0];
    const metrics = result.completionMetrics[0] || { total: 0, completed: 0, cancelled: 0, overdue: 0 };
    const resTime = result.avgResolutionTime[0];

    return {
      period: params.period || 'all_time',
      totalTasks: metrics.total,
      completedTasks: metrics.completed,
      completionRate: metrics.total > 0 ? Number(((metrics.completed / metrics.total) * 100).toFixed(1)) : 0,
      overdueCount: metrics.overdue,
      cancelledCount: metrics.cancelled,
      avgResolutionTimeHours: resTime ? Number(resTime.avgHours.toFixed(1)) : null,
      minResolutionTimeHours: resTime ? Number(resTime.minHours.toFixed(1)) : null,
      maxResolutionTimeHours: resTime ? Number(resTime.maxHours.toFixed(1)) : null,
      statusDistribution: result.statusDistribution.map(s => ({ status: s._id, count: s.count })),
      priorityDistribution: result.priorityDistribution.map(p => ({ priority: p._id, count: p.count })),
      categoryDistribution: result.categoryDistribution.map(c => ({ category: c._id, count: c.count })),
      autoGeneratedBreakdown: result.autoGeneratedBreakdown.map(a => ({ triggerType: a._id, count: a.count })),
      overdueAging: result.overdueAging.map(a => ({
        bucket: a._id === 0 ? '1-7 days' : a._id === 8 ? '8-14 days' : a._id === 15 ? '15-30 days' : '30+ days',
        count: a.count,
      })),
    };
  },

  // ---- Competitive Analysis Functions ----

  get_market_comparison: async (params, user) => {
    const filter = {
      organization: user.organization,
      'location.city': new RegExp(params.city, 'i'),
      'location.area': new RegExp(params.area, 'i'),
      isActive: true,
    };

    const competitors = await CompetitorProject.find(filter)
      .select('projectName developerName pricing.pricePerSqft projectStatus totalUnits dataCollectionDate confidenceScore')
      .sort({ 'pricing.pricePerSqft.avg': -1 })
      .limit(15)
      .lean();

    let ourProject = null;
    if (params.project_id) {
      ourProject = await Project.findOne({ _id: params.project_id, organization: user.organization })
        .select('name priceRange totalUnits')
        .lean();
    }

    const prices = competitors.map(c => c.pricing?.pricePerSqft?.avg).filter(Boolean);
    const avgMarketRate = prices.length > 0 ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null;

    return {
      locality: `${params.area}, ${params.city}`,
      competitorCount: competitors.length,
      marketAvgPricePerSqft: avgMarketRate,
      marketMinPricePerSqft: prices.length > 0 ? Math.min(...prices) : null,
      marketMaxPricePerSqft: prices.length > 0 ? Math.max(...prices) : null,
      ourProject: ourProject ? { name: ourProject.name, priceRange: ourProject.priceRange } : null,
      competitors: competitors.map(c => ({
        name: c.projectName,
        developer: c.developerName,
        pricePerSqft: c.pricing?.pricePerSqft,
        status: c.projectStatus,
        totalUnits: c.totalUnits,
        confidence: c.confidenceScore,
      })),
    };
  },

  get_competitive_positioning: async (params, user) => {
    const competitors = await CompetitorProject.find({
      organization: user.organization,
      'location.city': new RegExp(params.city, 'i'),
      'location.area': new RegExp(params.area, 'i'),
      isActive: true,
    })
      .select('projectName pricing.pricePerSqft.avg amenities')
      .lean();

    let ourProject = null;
    if (params.project_id) {
      ourProject = await Project.findOne({ _id: params.project_id, organization: user.organization })
        .select('name priceRange amenities')
        .lean();
    }

    const prices = competitors.map(c => c.pricing?.pricePerSqft?.avg).filter(Boolean).sort((a, b) => a - b);
    const avgPrice = prices.length > 0 ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0;

    let percentile = null;
    let segment = 'unknown';
    if (ourProject?.priceRange?.min && prices.length > 0) {
      const ourAvg = (ourProject.priceRange.min + ourProject.priceRange.max) / 2;
      const below = prices.filter(p => p < ourAvg).length;
      percentile = Math.round((below / prices.length) * 100);
      if (percentile < 20) segment = 'budget';
      else if (percentile < 40) segment = 'affordable';
      else if (percentile < 60) segment = 'mid_segment';
      else if (percentile < 80) segment = 'premium';
      else segment = 'luxury';
    }

    return {
      locality: `${params.area}, ${params.city}`,
      totalCompetitors: competitors.length,
      marketAvgPricePerSqft: avgPrice,
      ourProject: ourProject?.name || null,
      positioning: { segment, pricePercentile: percentile },
    };
  },

  get_pricing_recommendations: async (params, user) => {
    const competitors = await CompetitorProject.find({
      organization: user.organization,
      'location.city': new RegExp(params.city, 'i'),
      'location.area': new RegExp(params.area, 'i'),
      isActive: true,
    })
      .select('projectName pricing confidenceScore')
      .sort({ confidenceScore: -1 })
      .limit(10)
      .lean();

    const prices = competitors.map(c => c.pricing?.pricePerSqft?.avg).filter(Boolean);
    const floorRises = competitors.map(c => c.pricing?.floorRiseCharge).filter(Boolean);
    const parkingCovered = competitors.map(c => c.pricing?.parkingCharges?.covered).filter(Boolean);

    const avg = (arr) => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;

    return {
      locality: `${params.area}, ${params.city}`,
      basedOnCompetitors: competitors.length,
      recommendations: {
        pricePerSqft: { avg: avg(prices), min: prices.length ? Math.min(...prices) : null, max: prices.length ? Math.max(...prices) : null },
        floorRiseCharge: { avg: avg(floorRises), min: floorRises.length ? Math.min(...floorRises) : null, max: floorRises.length ? Math.max(...floorRises) : null },
        coveredParking: { avg: avg(parkingCovered) },
      },
      note: competitors.length < 3
        ? 'Limited competitive data. Add more competitors or run AI Research for better recommendations.'
        : `Based on ${competitors.length} competitor projects in ${params.area}, ${params.city}.`,
    };
  },
};

// =============================================================================
// FUNCTION EXECUTOR
// =============================================================================

/**
 * Execute a copilot function by name
 * @param {string} functionName - Name of the function to execute
 * @param {object} params - Parameters from GPT-4
 * @param {object} user - Authenticated user object (from req.user)
 * @returns {object} - Query result
 */
export const executeCopilotFunction = async (functionName, params, user, accessibleProjectIds) => {
  const fn = functionImplementations[functionName];
  if (!fn) {
    return { error: `Unknown function: ${functionName}` };
  }

  try {
    const result = await fn(params, user, accessibleProjectIds);
    return result;
  } catch (error) {
    console.error(`❌ Copilot function ${functionName} failed:`, error.message);
    return { error: `Failed to execute ${functionName}: ${error.message}` };
  }
};
