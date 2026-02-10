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
];

// =============================================================================
// FUNCTION IMPLEMENTATIONS
// =============================================================================

const functionImplementations = {
  // ---- 4.1 Project Functions ----

  get_projects: async (params, user) => {
    const filter = applyRoleScope({}, user, 'project');
    if (params.status) filter.status = params.status;
    if (params.type) filter.type = params.type;
    if (params.name_search) filter.name = { $regex: params.name_search, $options: 'i' };

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

  get_project_details: async (params, user) => {
    const project = await resolveProject(user.organization, params.project_id, params.project_name);
    if (!project) return { error: 'Project not found' };

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

  get_project_budget_variance: async (params, user) => {
    const project = await resolveProject(user.organization, params.project_id, params.project_name);
    if (!project) return { error: 'Project not found' };

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

  get_sales_summary: async (params, user) => {
    const filter = applyRoleScope({}, user, 'sale');
    filter.status = { $ne: 'Cancelled' };

    if (params.project_id) filter.project = new mongoose.Types.ObjectId(params.project_id);
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

  get_sales_forecast: async (params, user) => {
    let project = null;
    if (params.project_id || params.project_name) {
      project = await resolveProject(user.organization, params.project_id, params.project_name);
      if (!project) return { error: 'Project not found' };
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
    if (project) matchFilter.project = project._id;

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
    if (project) inventoryFilter.project = project._id;
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

  get_revenue_analysis: async (params, user) => {
    const filter = { organization: user.organization };
    if (params.project_id) filter.project = new mongoose.Types.ObjectId(params.project_id);

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

  get_leads_summary: async (params, user) => {
    const filter = applyRoleScope({}, user, 'lead');
    if (params.project_id) filter.project = new mongoose.Types.ObjectId(params.project_id);
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

  get_lead_funnel: async (params, user) => {
    const filter = applyRoleScope({}, user, 'lead');
    if (params.project_id) filter.project = new mongoose.Types.ObjectId(params.project_id);

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

  get_high_priority_leads: async (params, user) => {
    const limit = params.limit || 10;
    const filter = applyRoleScope({}, user, 'lead');
    filter.status = { $nin: ['Booked', 'Lost', 'Unqualified'] };

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

  get_lead_details: async (params, user) => {
    const filter = applyRoleScope({}, user, 'lead');
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

  get_inventory_summary: async (params, user) => {
    const matchFilter = { organization: user.organization };
    if (params.project_id) matchFilter.project = new mongoose.Types.ObjectId(params.project_id);
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

  get_available_units: async (params, user) => {
    const filter = { organization: user.organization, status: 'available' };
    if (params.project_id) filter.project = new mongoose.Types.ObjectId(params.project_id);
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

  get_payment_summary: async (params, user) => {
    const filter = { organization: user.organization };
    if (params.project_id) filter.project = new mongoose.Types.ObjectId(params.project_id);

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
          ...(params.project_id ? { project: new mongoose.Types.ObjectId(params.project_id) } : {}),
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

  get_overdue_payments: async (params, user) => {
    const limit = params.limit || 20;
    const now = new Date();

    const filter = {
      organization: user.organization,
      status: 'overdue',
    };
    if (params.project_id) filter.project = new mongoose.Types.ObjectId(params.project_id);

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

  get_payments_due_today: async (params, user) => {
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

  get_team_performance: async (params, user) => {
    const filter = { organization: user.organization, status: { $ne: 'Cancelled' } };

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
      { $match: { organization: user.organization, assignedTo: { $exists: true } } },
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

  get_commission_summary: async (params, user) => {
    const filter = applyRoleScope({}, user, 'commission');
    if (params.partner_id) filter.partner = new mongoose.Types.ObjectId(params.partner_id);
    if (params.project_id) filter.project = new mongoose.Types.ObjectId(params.project_id);
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

  compare_projects: async (params, user) => {
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

  get_dashboard_overview: async (params, user) => {
    const orgFilter = { organization: user.organization };

    // Projects
    const projectCount = await Project.countDocuments(orgFilter);
    const activeProjects = await Project.countDocuments({ ...orgFilter, status: { $in: ['launched', 'under-construction'] } });

    // Leads
    const totalLeads = await Lead.countDocuments(applyRoleScope({}, user, 'lead'));
    const activeLeads = await Lead.countDocuments(applyRoleScope({ status: { $nin: ['Booked', 'Lost', 'Unqualified'] } }, user, 'lead'));
    const hotLeads = await Lead.countDocuments(applyRoleScope({ priority: { $in: ['Critical', 'High'] }, status: { $nin: ['Booked', 'Lost', 'Unqualified'] } }, user, 'lead'));

    // Sales this month
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const salesThisMonth = await Sale.aggregate([
      { $match: { ...orgFilter, status: { $ne: 'Cancelled' }, bookingDate: { $gte: monthStart } } },
      { $group: { _id: null, count: { $sum: 1 }, revenue: { $sum: '$salePrice' } } },
    ]);

    // Total revenue collected
    const totalCollected = await PaymentTransaction.aggregate([
      { $match: { ...orgFilter, status: { $in: ['completed', 'cleared'] } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);

    // Overdue
    const overdueData = await Installment.aggregate([
      { $match: { ...orgFilter, status: 'overdue' } },
      { $group: { _id: null, total: { $sum: '$pendingAmount' }, count: { $sum: 1 } } },
    ]);

    // Inventory
    const inventoryStats = await Unit.aggregate([
      { $match: orgFilter },
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
export const executeCopilotFunction = async (functionName, params, user) => {
  const fn = functionImplementations[functionName];
  if (!fn) {
    return { error: `Unknown function: ${functionName}` };
  }

  try {
    const result = await fn(params, user);
    return result;
  } catch (error) {
    console.error(`❌ Copilot function ${functionName} failed:`, error.message);
    return { error: `Failed to execute ${functionName}: ${error.message}` };
  }
};
