// File: services/leadershipDashboardService.js
// Description: Aggregation service for the Leadership / Promoter / Board Meeting Dashboard.
// Provides org-wide overview KPIs and side-by-side project comparison metrics.

import mongoose from 'mongoose';

// ─── DYNAMIC MODEL IMPORTS ─────────────────────────────────────────────────────
let Project, Tower, Unit, Lead, Interaction, Sale,
    PaymentPlan, Installment, PaymentTransaction,
    Invoice, ConstructionMilestone, Contractor,
    PartnerCommission, Task, User;

const initializeModels = async () => {
  if (!Project) {
    try {
      const [
        { default: ProjectModel },
        { default: TowerModel },
        { default: UnitModel },
        { default: LeadModel },
        { default: InteractionModel },
        { default: SaleModel },
        { default: PaymentPlanModel },
        { default: InstallmentModel },
        { default: PaymentTransactionModel },
        { default: InvoiceModel },
        { default: ConstructionMilestoneModel },
        { default: ContractorModel },
        { default: PartnerCommissionModel },
        { default: TaskModel },
        { default: UserModel },
      ] = await Promise.all([
        import('../models/projectModel.js'),
        import('../models/towerModel.js'),
        import('../models/unitModel.js'),
        import('../models/leadModel.js'),
        import('../models/interactionModel.js'),
        import('../models/salesModel.js'),
        import('../models/paymentPlanModel.js'),
        import('../models/installmentModel.js'),
        import('../models/paymentTransactionModel.js'),
        import('../models/invoiceModel.js'),
        import('../models/constructionMilestoneModel.js'),
        import('../models/contractorModel.js'),
        import('../models/partnerCommissionModel.js'),
        import('../models/taskModel.js'),
        import('../models/userModel.js'),
      ]);

      Project = ProjectModel;
      Tower = TowerModel;
      Unit = UnitModel;
      Lead = LeadModel;
      Interaction = InteractionModel;
      Sale = SaleModel;
      PaymentPlan = PaymentPlanModel;
      Installment = InstallmentModel;
      PaymentTransaction = PaymentTransactionModel;
      Invoice = InvoiceModel;
      ConstructionMilestone = ConstructionMilestoneModel;
      Contractor = ContractorModel;
      PartnerCommission = PartnerCommissionModel;
      Task = TaskModel;
      User = UserModel;

      console.log('✅ Leadership dashboard models initialized');
    } catch (error) {
      console.error('❌ Failed to initialize leadership dashboard models:', error.message);
      throw error;
    }
  }
};

// ─── HELPERS ────────────────────────────────────────────────────────────────────

const buildDateRange = (period, startDate, endDate) => {
  if (startDate && endDate) {
    return { start: new Date(startDate), end: new Date(endDate) };
  }
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - parseInt(period || 30));
  return { start, end };
};

const toObjectId = (id) => new mongoose.Types.ObjectId(id);

const safeDiv = (numerator, denominator, decimals = 1) =>
  denominator > 0 ? Math.round((numerator / denominator) * Math.pow(10, decimals + 2)) / Math.pow(10, decimals) : 0;

const arrayToMap = (arr, keyField = '_id') => {
  const map = {};
  for (const item of arr) {
    map[item[keyField]] = (map[item[keyField]] || 0) + (item.count || 0);
  }
  return map;
};

// ─── OVERVIEW: 8 PARALLEL SUB-FUNCTIONS ─────────────────────────────────────────

/**
 * 1. Portfolio summary — current snapshot (no date filter)
 */
const aggregatePortfolio = async (orgId) => {
  try {
    const orgObjectId = toObjectId(orgId);

    const [projectStats, unitStats] = await Promise.all([
      Project.aggregate([
        { $match: { organization: orgObjectId } },
        {
          $facet: {
            byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
            totals: [
              {
                $group: {
                  _id: null,
                  totalProjects: { $sum: 1 },
                  totalTargetRevenue: { $sum: { $ifNull: ['$targetRevenue', 0] } },
                  totalArea: { $sum: { $ifNull: ['$totalArea', 0] } },
                },
              },
            ],
          },
        },
      ]),
      Unit.aggregate([
        { $match: { organization: orgObjectId } },
        {
          $facet: {
            byStatus: [
              {
                $group: {
                  _id: '$status',
                  count: { $sum: 1 },
                  totalValue: { $sum: { $ifNull: ['$currentPrice', 0] } },
                },
              },
            ],
            totals: [
              {
                $group: {
                  _id: null,
                  totalUnits: { $sum: 1 },
                  totalInventoryValue: { $sum: { $ifNull: ['$currentPrice', 0] } },
                },
              },
            ],
          },
        },
      ]),
    ]);

    const projTotals = projectStats[0]?.totals[0] || {};
    const unitTotals = unitStats[0]?.totals[0] || {};
    const unitByStatus = {};
    let soldValue = 0;
    for (const s of unitStats[0]?.byStatus || []) {
      unitByStatus[s._id] = s.count;
      if (s._id === 'sold') soldValue = s.totalValue;
    }

    return {
      totalProjects: projTotals.totalProjects || 0,
      projectsByStatus: arrayToMap(projectStats[0]?.byStatus || []),
      totalUnits: unitTotals.totalUnits || 0,
      unitsByStatus: unitByStatus,
      totalInventoryValue: unitTotals.totalInventoryValue || 0,
      totalSoldValue: soldValue,
      totalTargetRevenue: projTotals.totalTargetRevenue || 0,
      totalArea: projTotals.totalArea || 0,
    };
  } catch (error) {
    console.error('Portfolio aggregation error:', error.message);
    return { totalProjects: 0, projectsByStatus: {}, totalUnits: 0, unitsByStatus: {}, totalInventoryValue: 0, totalSoldValue: 0, totalTargetRevenue: 0, totalArea: 0, error: error.message };
  }
};

/**
 * 2. Revenue & Collections — mixed snapshot + period
 */
const aggregateRevenue = async (orgId, dateRange) => {
  try {
    const orgObjectId = toObjectId(orgId);

    const [allSales, periodSales, collections, periodCollections, overdueInstallments, outstandingPlans] = await Promise.all([
      // Total sales value (all time, exclude cancelled)
      Sale.aggregate([
        { $match: { organization: orgObjectId, status: { $ne: 'Cancelled' } } },
        { $group: { _id: null, total: { $sum: '$salePrice' }, count: { $sum: 1 } } },
      ]),
      // Period sales value
      Sale.aggregate([
        {
          $match: {
            organization: orgObjectId,
            status: { $ne: 'Cancelled' },
            bookingDate: { $gte: dateRange.start, $lte: dateRange.end },
          },
        },
        { $group: { _id: null, total: { $sum: '$salePrice' }, count: { $sum: 1 } } },
      ]),
      // Total collected (all time)
      PaymentTransaction.aggregate([
        { $match: { organization: orgObjectId, status: { $in: ['completed', 'cleared'] } } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      // Period collected
      PaymentTransaction.aggregate([
        {
          $match: {
            organization: orgObjectId,
            status: { $in: ['completed', 'cleared'] },
            paymentDate: { $gte: dateRange.start, $lte: dateRange.end },
          },
        },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      // Overdue installments
      Installment.aggregate([
        { $match: { organization: orgObjectId, status: 'overdue' } },
        { $group: { _id: null, total: { $sum: '$pendingAmount' }, count: { $sum: 1 } } },
      ]),
      // Outstanding from payment plans
      PaymentPlan.aggregate([
        { $match: { organization: orgObjectId, status: { $in: ['active', 'defaulted'] } } },
        {
          $group: {
            _id: null,
            totalOutstanding: { $sum: { $ifNull: ['$financialSummary.totalOutstanding', 0] } },
            totalPaid: { $sum: { $ifNull: ['$financialSummary.totalPaid', 0] } },
          },
        },
      ]),
    ]);

    const totalSalesValue = allSales[0]?.total || 0;
    const totalCollected = collections[0]?.total || 0;
    const totalOutstanding = outstandingPlans[0]?.totalOutstanding || 0;
    const totalOverdue = overdueInstallments[0]?.total || 0;

    return {
      totalSalesValue,
      totalSalesCount: allSales[0]?.count || 0,
      periodSalesValue: periodSales[0]?.total || 0,
      periodSalesCount: periodSales[0]?.count || 0,
      totalCollected,
      periodCollected: periodCollections[0]?.total || 0,
      totalOutstanding,
      totalOverdue,
      overdueInstallmentCount: overdueInstallments[0]?.count || 0,
      collectionRate: safeDiv(totalCollected, totalSalesValue, 1),
    };
  } catch (error) {
    console.error('Revenue aggregation error:', error.message);
    return { totalSalesValue: 0, totalSalesCount: 0, periodSalesValue: 0, periodSalesCount: 0, totalCollected: 0, periodCollected: 0, totalOutstanding: 0, totalOverdue: 0, overdueInstallmentCount: 0, collectionRate: 0, error: error.message };
  }
};

/**
 * 3. Sales pipeline — period filtered
 */
const aggregateSalesPipeline = async (orgId, dateRange) => {
  try {
    const orgObjectId = toObjectId(orgId);

    const [leadStats, periodLeads, saleStats] = await Promise.all([
      // All leads (current snapshot)
      Lead.aggregate([
        { $match: { organization: orgObjectId } },
        {
          $facet: {
            byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
            bySource: [{ $group: { _id: '$source', count: { $sum: 1 } } }],
            totals: [
              {
                $group: {
                  _id: null,
                  total: { $sum: 1 },
                  avgScore: { $avg: '$score' },
                  hotLeads: { $sum: { $cond: [{ $gte: ['$score', 70] }, 1, 0] } },
                },
              },
            ],
            overdueFollowUps: [
              {
                $match: {
                  'followUpSchedule.nextFollowUpDate': { $lt: new Date() },
                  status: { $nin: ['Booked', 'Lost', 'Unqualified'] },
                },
              },
              { $count: 'count' },
            ],
          },
        },
      ]),
      // Period new leads
      Lead.aggregate([
        {
          $match: {
            organization: orgObjectId,
            createdAt: { $gte: dateRange.start, $lte: dateRange.end },
          },
        },
        { $group: { _id: null, count: { $sum: 1 } } },
      ]),
      // Period sales
      Sale.aggregate([
        {
          $match: {
            organization: orgObjectId,
            status: { $ne: 'Cancelled' },
            bookingDate: { $gte: dateRange.start, $lte: dateRange.end },
          },
        },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            avgPrice: { $avg: '$salePrice' },
            totalRevenue: { $sum: '$salePrice' },
          },
        },
      ]),
    ]);

    const leadTotals = leadStats[0]?.totals[0] || {};
    const totalLeads = leadTotals.total || 0;
    const bookedLeads = (leadStats[0]?.byStatus || []).find((s) => s._id === 'Booked')?.count || 0;

    return {
      totalLeads,
      periodNewLeads: periodLeads[0]?.count || 0,
      leadsByStatus: arrayToMap(leadStats[0]?.byStatus || []),
      leadsBySource: arrayToMap(leadStats[0]?.bySource || []),
      avgLeadScore: Math.round((leadTotals.avgScore || 0) * 10) / 10,
      hotLeads: leadTotals.hotLeads || 0,
      overdueFollowUps: leadStats[0]?.overdueFollowUps[0]?.count || 0,
      totalSales: saleStats[0]?.count || 0,
      periodSales: saleStats[0]?.count || 0,
      avgBookingValue: Math.round(saleStats[0]?.avgPrice || 0),
      conversionRate: safeDiv(bookedLeads, totalLeads, 1),
    };
  } catch (error) {
    console.error('Sales pipeline aggregation error:', error.message);
    return { totalLeads: 0, periodNewLeads: 0, leadsByStatus: {}, leadsBySource: {}, avgLeadScore: 0, hotLeads: 0, overdueFollowUps: 0, totalSales: 0, periodSales: 0, avgBookingValue: 0, conversionRate: 0, error: error.message };
  }
};

/**
 * 4. Construction progress — current snapshot
 */
const aggregateConstruction = async (orgId) => {
  try {
    const orgObjectId = toObjectId(orgId);
    const now = new Date();

    const [milestoneStats, contractorStats] = await Promise.all([
      ConstructionMilestone.aggregate([
        { $match: { organization: orgObjectId } },
        {
          $facet: {
            byPhase: [
              {
                $group: {
                  _id: '$phase',
                  total: { $sum: 1 },
                  completed: { $sum: { $cond: [{ $eq: ['$status', 'Completed'] }, 1, 0] } },
                  inProgress: { $sum: { $cond: [{ $eq: ['$status', 'In Progress'] }, 1, 0] } },
                  avgProgress: { $avg: { $ifNull: ['$progress.percentage', 0] } },
                },
              },
            ],
            byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
            delayed: [
              {
                $match: {
                  status: { $nin: ['Completed', 'Cancelled'] },
                  plannedEndDate: { $lt: now },
                },
              },
              { $count: 'count' },
            ],
            costSummary: [
              {
                $group: {
                  _id: null,
                  totalPlanned: { $sum: { $ifNull: ['$budget.plannedCost', 0] } },
                  totalActual: { $sum: { $ifNull: ['$budget.actualCost', 0] } },
                },
              },
            ],
            overallProgress: [
              {
                $group: {
                  _id: null,
                  avgProgress: { $avg: { $ifNull: ['$progress.percentage', 0] } },
                },
              },
            ],
            openIssues: [
              { $unwind: { path: '$issues', preserveNullAndEmptyArrays: false } },
              { $match: { 'issues.status': { $in: ['Open', 'In Progress'] } } },
              { $count: 'count' },
            ],
          },
        },
      ]),
      Contractor.aggregate([
        { $match: { organization: orgObjectId } },
        {
          $facet: {
            byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
            avgRating: [{ $group: { _id: null, avg: { $avg: '$rating.overall' } } }],
          },
        },
      ]),
    ]);

    const ms = milestoneStats[0] || {};
    const cs = ms.costSummary?.[0] || {};
    const planned = cs.totalPlanned || 0;
    const actual = cs.totalActual || 0;

    // Build milestonesByPhase as object with sub-details
    const milestonesByPhase = {};
    for (const p of ms.byPhase || []) {
      milestonesByPhase[p._id] = {
        total: p.total,
        completed: p.completed,
        inProgress: p.inProgress,
        avgProgress: Math.round((p.avgProgress || 0) * 10) / 10,
      };
    }

    const activeContractors = (contractorStats[0]?.byStatus || []).find((s) => s._id === 'Active')?.count || 0;

    return {
      milestonesByPhase,
      milestonesByStatus: arrayToMap(ms.byStatus || []),
      delayedCount: ms.delayed?.[0]?.count || 0,
      overallProgress: Math.round((ms.overallProgress?.[0]?.avgProgress || 0) * 10) / 10,
      costVariance: {
        planned,
        actual,
        variance: actual - planned,
        variancePercent: safeDiv(actual - planned, planned, 1),
      },
      activeContractors,
      avgContractorRating: Math.round((contractorStats[0]?.avgRating?.[0]?.avg || 0) * 10) / 10,
      openIssues: ms.openIssues?.[0]?.count || 0,
    };
  } catch (error) {
    console.error('Construction aggregation error:', error.message);
    return { milestonesByPhase: {}, milestonesByStatus: {}, delayedCount: 0, overallProgress: 0, costVariance: { planned: 0, actual: 0, variance: 0, variancePercent: 0 }, activeContractors: 0, avgContractorRating: 0, openIssues: 0, error: error.message };
  }
};

/**
 * 5. Invoicing summary — mixed snapshot + period
 */
const aggregateInvoicing = async (orgId, dateRange) => {
  try {
    const orgObjectId = toObjectId(orgId);

    const result = await Invoice.aggregate([
      { $match: { organization: orgObjectId } },
      {
        $facet: {
          byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
          financials: [
            {
              $group: {
                _id: null,
                totalInvoiced: { $sum: { $ifNull: ['$financialSummary.totalAmount', 0] } },
                totalPaid: { $sum: { $ifNull: ['$paymentDetails.totalPaid', 0] } },
                totalPending: { $sum: { $ifNull: ['$paymentDetails.pendingAmount', 0] } },
              },
            },
          ],
          overdue: [
            { $match: { status: 'overdue' } },
            {
              $group: {
                _id: null,
                overdueAmount: { $sum: { $ifNull: ['$financialSummary.totalAmount', 0] } },
                count: { $sum: 1 },
              },
            },
          ],
          periodInvoices: [
            { $match: { invoiceDate: { $gte: dateRange.start, $lte: dateRange.end } } },
            {
              $group: {
                _id: null,
                count: { $sum: 1 },
                total: { $sum: { $ifNull: ['$financialSummary.totalAmount', 0] } },
              },
            },
          ],
        },
      },
    ]);

    const r = result[0] || {};
    const fin = r.financials?.[0] || {};

    return {
      totalInvoiced: fin.totalInvoiced || 0,
      totalPaid: fin.totalPaid || 0,
      totalPending: fin.totalPending || 0,
      totalOverdue: r.overdue?.[0]?.overdueAmount || 0,
      overdueCount: r.overdue?.[0]?.count || 0,
      invoicesByStatus: arrayToMap(r.byStatus || []),
      periodInvoiceCount: r.periodInvoices?.[0]?.count || 0,
      periodInvoiceValue: r.periodInvoices?.[0]?.total || 0,
    };
  } catch (error) {
    console.error('Invoicing aggregation error:', error.message);
    return { totalInvoiced: 0, totalPaid: 0, totalPending: 0, totalOverdue: 0, overdueCount: 0, invoicesByStatus: {}, periodInvoiceCount: 0, periodInvoiceValue: 0, error: error.message };
  }
};

/**
 * 6. Channel partner summary — current snapshot
 */
const aggregateChannelPartner = async (orgId) => {
  try {
    const orgObjectId = toObjectId(orgId);

    const result = await PartnerCommission.aggregate([
      { $match: { organization: orgObjectId } },
      {
        $facet: {
          byStatus: [
            {
              $group: {
                _id: '$status',
                count: { $sum: 1 },
                totalNet: { $sum: { $ifNull: ['$commissionCalculation.netCommission', 0] } },
              },
            },
          ],
          totals: [
            {
              $group: {
                _id: null,
                totalGross: { $sum: { $ifNull: ['$commissionCalculation.grossCommission', 0] } },
                totalNet: { $sum: { $ifNull: ['$commissionCalculation.netCommission', 0] } },
                totalPaid: { $sum: { $ifNull: ['$paymentDetails.totalPaid', 0] } },
                totalPending: { $sum: { $ifNull: ['$paymentDetails.totalPending', 0] } },
              },
            },
          ],
        },
      },
    ]);

    const r = result[0] || {};
    const totals = r.totals?.[0] || {};
    const byStatus = {};
    for (const s of r.byStatus || []) {
      byStatus[s._id] = { count: s.count, amount: s.totalNet };
    }

    return {
      totalGrossCommissions: totals.totalGross || 0,
      totalNetCommissions: totals.totalNet || 0,
      totalPaid: totals.totalPaid || 0,
      totalPending: totals.totalPending || 0,
      commissionsByStatus: byStatus,
    };
  } catch (error) {
    console.error('Channel partner aggregation error:', error.message);
    return { totalGrossCommissions: 0, totalNetCommissions: 0, totalPaid: 0, totalPending: 0, commissionsByStatus: {}, error: error.message };
  }
};

/**
 * 7. Operations / Tasks summary — mixed
 */
const aggregateOperations = async (orgId, dateRange) => {
  try {
    const orgObjectId = toObjectId(orgId);
    const now = new Date();

    const result = await Task.aggregate([
      { $match: { organization: orgObjectId } },
      {
        $facet: {
          byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
          byPriority: [{ $group: { _id: '$priority', count: { $sum: 1 } } }],
          byCategory: [{ $group: { _id: '$category', count: { $sum: 1 } } }],
          overdue: [
            {
              $match: {
                dueDate: { $lt: now },
                status: { $nin: ['Completed', 'Cancelled'] },
              },
            },
            { $count: 'count' },
          ],
          escalated: [
            { $match: { currentEscalationLevel: { $gt: 0 } } },
            { $count: 'count' },
          ],
          periodCreated: [
            { $match: { createdAt: { $gte: dateRange.start, $lte: dateRange.end } } },
            { $count: 'count' },
          ],
          periodCompleted: [
            {
              $match: {
                status: 'Completed',
                completedAt: { $gte: dateRange.start, $lte: dateRange.end },
              },
            },
            { $count: 'count' },
          ],
        },
      },
    ]);

    const r = result[0] || {};

    return {
      tasksByStatus: arrayToMap(r.byStatus || []),
      tasksByPriority: arrayToMap(r.byPriority || []),
      tasksByCategory: arrayToMap(r.byCategory || []),
      overdueCount: r.overdue?.[0]?.count || 0,
      escalatedCount: r.escalated?.[0]?.count || 0,
      periodCreated: r.periodCreated?.[0]?.count || 0,
      periodCompleted: r.periodCompleted?.[0]?.count || 0,
    };
  } catch (error) {
    console.error('Operations aggregation error:', error.message);
    return { tasksByStatus: {}, tasksByPriority: {}, tasksByCategory: {}, overdueCount: 0, escalatedCount: 0, periodCreated: 0, periodCompleted: 0, error: error.message };
  }
};

/**
 * 8. Team / User summary — snapshot
 */
const aggregateTeam = async (orgId) => {
  try {
    const orgObjectId = toObjectId(orgId);

    const [userStats, workload] = await Promise.all([
      User.aggregate([
        { $match: { organization: orgObjectId, isActive: true } },
        {
          $lookup: {
            from: 'roles',
            localField: 'roleRef',
            foreignField: '_id',
            as: 'role',
          },
        },
        { $unwind: { path: '$role', preserveNullAndEmptyArrays: true } },
        {
          $facet: {
            total: [{ $count: 'count' }],
            byRole: [{ $group: { _id: '$role.name', count: { $sum: 1 } } }],
          },
        },
      ]),
      // Top workload — users with most open tasks
      Task.aggregate([
        {
          $match: {
            organization: orgObjectId,
            status: { $in: ['Open', 'In Progress'] },
          },
        },
        {
          $group: {
            _id: '$assignedTo',
            openTasks: { $sum: 1 },
          },
        },
        { $sort: { openTasks: -1 } },
        { $limit: 10 },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'user',
          },
        },
        { $unwind: '$user' },
        {
          $project: {
            userId: '$_id',
            name: { $concat: ['$user.firstName', ' ', '$user.lastName'] },
            openTasks: 1,
          },
        },
      ]),
    ]);

    const us = userStats[0] || {};

    return {
      activeUsers: us.total?.[0]?.count || 0,
      usersByRole: arrayToMap(us.byRole || []),
      topWorkload: workload.map((w) => ({
        userId: w.userId,
        name: w.name,
        openTasks: w.openTasks,
      })),
    };
  } catch (error) {
    console.error('Team aggregation error:', error.message);
    return { activeUsers: 0, usersByRole: {}, topWorkload: [], error: error.message };
  }
};

// ─── OVERVIEW ORCHESTRATOR ──────────────────────────────────────────────────────

const getLeadershipOverview = async (orgId, period, startDate, endDate) => {
  await initializeModels();
  const dateRange = buildDateRange(period, startDate, endDate);

  console.log('👔 Generating leadership overview...', { orgId, period, dateRange });

  const [
    portfolio,
    revenue,
    salesPipeline,
    construction,
    invoicing,
    channelPartner,
    operations,
    team,
  ] = await Promise.all([
    aggregatePortfolio(orgId),
    aggregateRevenue(orgId, dateRange),
    aggregateSalesPipeline(orgId, dateRange),
    aggregateConstruction(orgId),
    aggregateInvoicing(orgId, dateRange),
    aggregateChannelPartner(orgId),
    aggregateOperations(orgId, dateRange),
    aggregateTeam(orgId),
  ]);

  console.log('✅ Leadership overview generated');

  return {
    portfolio,
    revenue,
    salesPipeline,
    construction,
    invoicing,
    channelPartner,
    operations,
    team,
    _dateRange: dateRange,
  };
};

// ─── PROJECT COMPARISON: CROSS-PROJECT PIPELINES ────────────────────────────────

const getLeadershipProjectComparison = async (orgId, period, startDate, endDate, projectIds, sortBy) => {
  await initializeModels();
  const dateRange = buildDateRange(period, startDate, endDate);
  const orgObjectId = toObjectId(orgId);

  console.log('📊 Generating project comparison...', { orgId, period, projectIds, sortBy });

  // Base project query
  const projectQuery = { organization: orgObjectId };
  if (projectIds && projectIds.length > 0) {
    projectQuery._id = { $in: projectIds.map(toObjectId) };
  }

  // Run all cross-project aggregations in parallel
  const [
    projects,
    unitsByProject,
    salesByProject,
    leadsByProject,
    collectionsByProject,
    overdueByProject,
    milestonesByProject,
    invoicesByProject,
    towers,
    commissionsByProject,
    tasksByProject,
  ] = await Promise.all([
    // 1. Base project data
    Project.find(projectQuery)
      .select('name type status totalUnits totalArea targetRevenue launchDate expectedCompletionDate')
      .lean(),

    // 2. Unit breakdown per project
    Unit.aggregate([
      { $match: { organization: orgObjectId } },
      {
        $group: {
          _id: { project: '$project', status: '$status' },
          count: { $sum: 1 },
          totalValue: { $sum: { $ifNull: ['$currentPrice', 0] } },
        },
      },
      {
        $group: {
          _id: '$_id.project',
          statuses: {
            $push: { status: '$_id.status', count: '$count', value: '$totalValue' },
          },
          totalUnits: { $sum: '$count' },
          totalValue: { $sum: '$totalValue' },
        },
      },
    ]),

    // 3. Sales per project
    Sale.aggregate([
      { $match: { organization: orgObjectId, status: { $ne: 'Cancelled' } } },
      {
        $facet: {
          allTime: [
            {
              $group: {
                _id: '$project',
                totalRevenue: { $sum: '$salePrice' },
                count: { $sum: 1 },
                avgPrice: { $avg: '$salePrice' },
              },
            },
          ],
          period: [
            { $match: { bookingDate: { $gte: dateRange.start, $lte: dateRange.end } } },
            {
              $group: {
                _id: '$project',
                periodRevenue: { $sum: '$salePrice' },
                periodCount: { $sum: 1 },
              },
            },
          ],
        },
      },
    ]),

    // 4. Leads per project
    Lead.aggregate([
      { $match: { organization: orgObjectId } },
      {
        $group: {
          _id: '$project',
          totalLeads: { $sum: 1 },
          qualified: {
            $sum: {
              $cond: [
                { $in: ['$status', ['Qualified', 'Site Visit Scheduled', 'Site Visit Completed', 'Negotiating', 'Booked']] },
                1,
                0,
              ],
            },
          },
          booked: { $sum: { $cond: [{ $eq: ['$status', 'Booked'] }, 1, 0] } },
        },
      },
    ]),

    // 5. Collections per project (completed/cleared)
    PaymentTransaction.aggregate([
      { $match: { organization: orgObjectId, status: { $in: ['completed', 'cleared'] } } },
      {
        $facet: {
          allTime: [
            { $group: { _id: '$project', total: { $sum: '$amount' } } },
          ],
          period: [
            { $match: { paymentDate: { $gte: dateRange.start, $lte: dateRange.end } } },
            { $group: { _id: '$project', total: { $sum: '$amount' } } },
          ],
        },
      },
    ]),

    // 6. Overdue installments per project
    Installment.aggregate([
      { $match: { organization: orgObjectId, status: 'overdue' } },
      {
        $group: {
          _id: '$project',
          overdueAmount: { $sum: '$pendingAmount' },
          overdueCount: { $sum: 1 },
        },
      },
    ]),

    // 7. Construction milestones per project
    ConstructionMilestone.aggregate([
      { $match: { organization: orgObjectId } },
      {
        $group: {
          _id: '$project',
          total: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'Completed'] }, 1, 0] } },
          inProgress: { $sum: { $cond: [{ $eq: ['$status', 'In Progress'] }, 1, 0] } },
          delayed: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $not: { $in: ['$status', ['Completed', 'Cancelled']] } },
                    { $lt: ['$plannedEndDate', new Date()] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          avgProgress: { $avg: { $ifNull: ['$progress.percentage', 0] } },
          plannedCost: { $sum: { $ifNull: ['$budget.plannedCost', 0] } },
          actualCost: { $sum: { $ifNull: ['$budget.actualCost', 0] } },
        },
      },
    ]),

    // 8. Invoices per project
    Invoice.aggregate([
      { $match: { organization: orgObjectId } },
      {
        $group: {
          _id: '$project',
          totalInvoiced: { $sum: { $ifNull: ['$financialSummary.totalAmount', 0] } },
          totalPaid: { $sum: { $ifNull: ['$paymentDetails.totalPaid', 0] } },
          overdueAmount: {
            $sum: {
              $cond: [{ $eq: ['$status', 'overdue'] }, { $ifNull: ['$financialSummary.totalAmount', 0] }, 0],
            },
          },
          overdueCount: { $sum: { $cond: [{ $eq: ['$status', 'overdue'] }, 1, 0] } },
        },
      },
    ]),

    // 9. Towers per project
    Tower.find({ organization: orgObjectId })
      .select('project towerName towerCode totalUnits status construction.progressPercentage financials')
      .lean(),

    // 10. Partner commissions per project
    PartnerCommission.aggregate([
      { $match: { organization: orgObjectId } },
      {
        $group: {
          _id: '$project',
          totalCommission: { $sum: { $ifNull: ['$commissionCalculation.netCommission', 0] } },
          paidCommission: {
            $sum: {
              $cond: [{ $eq: ['$status', 'paid'] }, { $ifNull: ['$commissionCalculation.netCommission', 0] }, 0],
            },
          },
          salesViaCp: { $sum: 1 },
        },
      },
    ]),

    // 11. Tasks per project (linked via linkedEntity)
    Task.aggregate([
      { $match: { organization: orgObjectId } },
      {
        $group: {
          _id: '$project',
          total: { $sum: 1 },
          open: { $sum: { $cond: [{ $eq: ['$status', 'Open'] }, 1, 0] } },
          inProgress: { $sum: { $cond: [{ $eq: ['$status', 'In Progress'] }, 1, 0] } },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'Completed'] }, 1, 0] } },
          overdue: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $lt: ['$dueDate', new Date()] },
                    { $not: { $in: ['$status', ['Completed', 'Cancelled']] } },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]),
  ]);

  // Build lookup maps for O(1) merge — filter out null _id (records without a project ref)
  const toMap = (arr) =>
    Object.fromEntries(arr.filter((x) => x._id != null).map((x) => [x._id.toString(), x]));

  const unitMap = toMap(unitsByProject);

  const salesAllTime = toMap(salesByProject[0]?.allTime || []);
  const salesPeriod = toMap(salesByProject[0]?.period || []);

  const leadMap = toMap(leadsByProject);

  const collAllTime = toMap(collectionsByProject[0]?.allTime || []);
  const collPeriod = toMap(collectionsByProject[0]?.period || []);

  const overdueMap = toMap(overdueByProject);
  const msMap = toMap(milestonesByProject);
  const invMap = toMap(invoicesByProject);
  const cpMap = toMap(commissionsByProject);
  const taskMap = toMap(tasksByProject);

  // Group towers by project
  const towersByProject = {};
  for (const t of towers) {
    if (!t.project) continue;
    const pid = t.project.toString();
    if (!towersByProject[pid]) towersByProject[pid] = [];
    towersByProject[pid].push(t);
  }

  // Merge everything per project
  const projectResults = projects.map((proj) => {
    const pid = proj._id.toString();

    // Inventory
    const units = unitMap[pid] || { statuses: [], totalUnits: 0, totalValue: 0 };
    const inventory = { totalUnits: units.totalUnits, available: 0, booked: 0, sold: 0, blocked: 0, inventoryValue: units.totalValue };
    for (const s of units.statuses) {
      if (inventory.hasOwnProperty(s.status)) inventory[s.status] = s.count;
    }
    inventory.occupancyRate = safeDiv(inventory.booked + inventory.sold, inventory.totalUnits, 1);

    // Revenue
    const sa = salesAllTime[pid] || {};
    const sp = salesPeriod[pid] || {};
    const ca = collAllTime[pid] || {};
    const od = overdueMap[pid] || {};
    const actualRevenue = sa.totalRevenue || 0;
    const totalCollected = ca.total || 0;
    const totalOutstanding = actualRevenue - totalCollected;
    const revenue = {
      targetRevenue: proj.targetRevenue || 0,
      actualRevenue,
      achievementRate: safeDiv(actualRevenue, proj.targetRevenue || 0, 1),
      periodRevenue: sp.periodRevenue || 0,
      periodSalesCount: sp.periodCount || 0,
      totalCollected,
      totalOutstanding: Math.max(0, totalOutstanding),
      overdueAmount: od.overdueAmount || 0,
      collectionEfficiency: safeDiv(totalCollected, actualRevenue, 1),
    };

    // Sales pipeline
    const ld = leadMap[pid] || {};
    const salesPipeline = {
      totalLeads: ld.totalLeads || 0,
      qualifiedLeads: ld.qualified || 0,
      totalSales: sa.count || 0,
      periodSales: sp.periodCount || 0,
      avgSalePrice: Math.round(sa.avgPrice || 0),
      conversionRate: safeDiv(ld.booked || 0, ld.totalLeads || 0, 1),
    };

    // Construction
    const ms = msMap[pid] || {};
    const construction = {
      totalMilestones: ms.total || 0,
      completed: ms.completed || 0,
      inProgress: ms.inProgress || 0,
      delayed: ms.delayed || 0,
      overallProgress: Math.round((ms.avgProgress || 0) * 10) / 10,
      costVariance: {
        planned: ms.plannedCost || 0,
        actual: ms.actualCost || 0,
        variancePercent: safeDiv((ms.actualCost || 0) - (ms.plannedCost || 0), ms.plannedCost || 0, 1),
      },
    };

    // Invoicing
    const inv = invMap[pid] || {};
    const invoicing = {
      totalInvoiced: inv.totalInvoiced || 0,
      totalPaid: inv.totalPaid || 0,
      overdueAmount: inv.overdueAmount || 0,
      overdueCount: inv.overdueCount || 0,
    };

    // Channel partner
    const cp = cpMap[pid] || {};
    const channelPartner = {
      salesViaCp: cp.salesViaCp || 0,
      totalCommission: cp.totalCommission || 0,
      paidCommission: cp.paidCommission || 0,
    };

    // Tasks
    const tk = taskMap[pid] || {};
    const tasks = {
      total: tk.total || 0,
      open: tk.open || 0,
      inProgress: tk.inProgress || 0,
      completed: tk.completed || 0,
      overdue: tk.overdue || 0,
    };

    // Tower breakdown
    const projectTowers = (towersByProject[pid] || []).map((t) => ({
      towerId: t._id,
      name: t.towerName,
      code: t.towerCode,
      totalUnits: t.totalUnits,
      status: t.status,
      constructionProgress: t.construction?.progressPercentage || 0,
      financials: t.financials || {},
    }));

    // Generate alerts
    const alerts = generateProjectAlerts({ construction, invoicing, revenue, tasks, od });

    return {
      projectId: proj._id,
      name: proj.name,
      type: proj.type,
      status: proj.status,
      launchDate: proj.launchDate,
      expectedCompletionDate: proj.expectedCompletionDate,
      inventory,
      revenue,
      salesPipeline,
      construction,
      invoicing,
      channelPartner,
      tasks,
      towers: projectTowers,
      alerts,
    };
  });

  // Sort
  sortProjects(projectResults, sortBy);

  // Comparison highlights
  const comparison = buildComparisonHighlights(projectResults);

  console.log('✅ Project comparison generated for', projectResults.length, 'projects');

  return {
    projects: projectResults,
    comparison,
    _dateRange: dateRange,
  };
};

// ─── ALERT GENERATION ───────────────────────────────────────────────────────────

const generateProjectAlerts = ({ construction, invoicing, revenue, tasks, od }) => {
  const alerts = [];

  if (construction.delayed > 0) {
    alerts.push({
      type: 'delayed_milestone',
      severity: construction.delayed >= 3 ? 'critical' : 'warning',
      message: `${construction.delayed} construction milestone(s) delayed`,
    });
  }

  if (construction.costVariance.variancePercent > 10) {
    alerts.push({
      type: 'cost_overrun',
      severity: construction.costVariance.variancePercent > 20 ? 'critical' : 'warning',
      message: `Construction cost ${construction.costVariance.variancePercent}% over budget`,
    });
  }

  if (invoicing.overdueCount > 0) {
    alerts.push({
      type: 'overdue_invoices',
      severity: invoicing.overdueCount >= 3 ? 'warning' : 'info',
      message: `${invoicing.overdueCount} invoice(s) overdue totaling ${invoicing.overdueAmount.toLocaleString('en-IN')}`,
    });
  }

  if (od?.overdueCount > 0) {
    alerts.push({
      type: 'overdue_installments',
      severity: od.overdueCount >= 5 ? 'critical' : 'warning',
      message: `${od.overdueCount} installment(s) overdue totaling ${(od.overdueAmount || 0).toLocaleString('en-IN')}`,
    });
  }

  if (revenue.achievementRate > 0 && revenue.achievementRate < 30) {
    alerts.push({
      type: 'low_revenue',
      severity: 'warning',
      message: `Revenue achievement at ${revenue.achievementRate}% of target`,
    });
  }

  if (tasks.overdue > 5) {
    alerts.push({
      type: 'overdue_tasks',
      severity: 'warning',
      message: `${tasks.overdue} overdue tasks require attention`,
    });
  }

  return alerts;
};

// ─── SORTING ────────────────────────────────────────────────────────────────────

const sortProjects = (projects, sortBy) => {
  const sortFns = {
    revenue: (a, b) => b.revenue.actualRevenue - a.revenue.actualRevenue,
    sales: (a, b) => b.salesPipeline.totalSales - a.salesPipeline.totalSales,
    construction: (a, b) => b.construction.overallProgress - a.construction.overallProgress,
    collection: (a, b) => b.revenue.collectionEfficiency - a.revenue.collectionEfficiency,
  };
  projects.sort(sortFns[sortBy] || sortFns.revenue);
};

// ─── COMPARISON HIGHLIGHTS ──────────────────────────────────────────────────────

const buildComparisonHighlights = (projects) => {
  if (projects.length === 0) return {};

  const best = (key) => {
    const sorted = [...projects];
    sorted.sort((a, b) => {
      switch (key) {
        case 'revenue': return b.revenue.achievementRate - a.revenue.achievementRate;
        case 'sales': return b.salesPipeline.conversionRate - a.salesPipeline.conversionRate;
        case 'construction': return b.construction.overallProgress - a.construction.overallProgress;
        case 'collection': return b.revenue.collectionEfficiency - a.revenue.collectionEfficiency;
        default: return 0;
      }
    });
    return sorted[0];
  };

  const bestRevProject = best('revenue');
  const bestSalesProject = best('sales');
  const bestConstructionProject = best('construction');
  const bestCollectionProject = best('collection');

  return {
    bestRevenue: {
      projectId: bestRevProject.projectId,
      name: bestRevProject.name,
      achievementRate: bestRevProject.revenue.achievementRate,
    },
    bestSales: {
      projectId: bestSalesProject.projectId,
      name: bestSalesProject.name,
      conversionRate: bestSalesProject.salesPipeline.conversionRate,
    },
    bestConstruction: {
      projectId: bestConstructionProject.projectId,
      name: bestConstructionProject.name,
      overallProgress: bestConstructionProject.construction.overallProgress,
    },
    bestCollection: {
      projectId: bestCollectionProject.projectId,
      name: bestCollectionProject.name,
      collectionEfficiency: bestCollectionProject.revenue.collectionEfficiency,
    },
  };
};

// ─── EXPORTS ────────────────────────────────────────────────────────────────────

export { getLeadershipOverview, getLeadershipProjectComparison };
