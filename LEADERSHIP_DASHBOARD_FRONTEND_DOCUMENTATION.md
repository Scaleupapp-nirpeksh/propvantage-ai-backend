# PropVantage AI — Leadership Dashboard: Frontend Documentation

**Base URL**: `/api/leadership`
**Auth**: All endpoints require `Authorization: Bearer <token>` header.
**Permission**: `dashboard:leadership` — only users with roles Level 0–3 (Organization Owner, Business Head, Project Director, Sales Head, Marketing Head, Finance Head) have access. Lower-level roles receive **HTTP 403**.

---

## Table of Contents

1. [Overview](#1-overview)
2. [API Endpoints](#2-api-endpoints)
3. [Data Models & TypeScript Interfaces](#3-data-models--typescript-interfaces)
4. [Endpoint 1: Organization Overview](#4-endpoint-1-organization-overview)
5. [Endpoint 2: Project Comparison](#5-endpoint-2-project-comparison)
6. [Enum & Status Reference](#6-enum--status-reference)
7. [UI Component Guide](#7-ui-component-guide)
8. [Currency & Number Formatting](#8-currency--number-formatting)
9. [Color Coding & Severity Mapping](#9-color-coding--severity-mapping)
10. [Empty/Zero State Handling](#10-emptyzero-state-handling)
11. [Error Handling](#11-error-handling)
12. [Live API Response Examples](#12-live-api-response-examples)

---

## 1. Overview

The Leadership Dashboard provides two pages for promoters and board members:

| Page | Endpoint | Purpose |
|------|----------|---------|
| **Organization Overview** | `GET /overview` | Bird's-eye view of the entire organization — 8 KPI sections |
| **Project Comparison** | `GET /project-comparison` | Side-by-side comparison of every project with tower-level drill-down |

Both endpoints support a **time period filter** (default: last 30 days). Some metrics are **cumulative snapshots** (current state of portfolio, outstanding balances) while others are **period-specific** (new sales in last 30 days, payments received in last 30 days).

---

## 2. API Endpoints

### 2.1 Organization Overview

```
GET /api/leadership/overview?period=30
```

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `period` | number | `30` | Number of days to look back for period-specific metrics |
| `startDate` | ISO string | _(none)_ | Custom range start — **must** be used with `endDate` |
| `endDate` | ISO string | _(none)_ | Custom range end — **must** be used with `startDate` |

> **Note**: If `startDate`/`endDate` are provided, they override `period`. Providing only one of the two returns **HTTP 400**.

### 2.2 Project Comparison

```
GET /api/leadership/project-comparison?period=30&sortBy=revenue
```

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `period` | number | `30` | Number of days to look back for period-specific metrics |
| `startDate` | ISO string | _(none)_ | Custom range start |
| `endDate` | ISO string | _(none)_ | Custom range end |
| `projectIds` | string | _(all)_ | Comma-separated Project IDs to include (e.g. `id1,id2`). Omit to include all. |
| `sortBy` | string | `revenue` | Sort projects by: `revenue`, `sales`, `construction`, `collection` |

---

## 3. Data Models & TypeScript Interfaces

### 3.1 Overview Response

```typescript
interface OverviewResponse {
  success: boolean;
  data: {
    portfolio: PortfolioSection;
    revenue: RevenueSection;
    salesPipeline: SalesPipelineSection;
    construction: ConstructionSection;
    invoicing: InvoicingSection;
    channelPartner: ChannelPartnerSection;
    operations: OperationsSection;
    team: TeamSection;
  };
  metadata: {
    period: number;                    // e.g. 30
    dateRange: {
      start: string;                   // ISO date
      end: string;                     // ISO date
    };
    generatedAt: string;               // ISO date
  };
}
```

### 3.2 Project Comparison Response

```typescript
interface ProjectComparisonResponse {
  success: boolean;
  data: {
    projects: ProjectDetail[];
    comparison: ComparisonHighlights;
  };
  metadata: {
    period: number;
    dateRange: { start: string; end: string };
    generatedAt: string;
    projectCount: number;
    sortedBy: 'revenue' | 'sales' | 'construction' | 'collection';
  };
}
```

---

## 4. Endpoint 1: Organization Overview

The overview returns **8 sections**. Each section is described below with its TypeScript interface, field descriptions, and UI guidance.

---

### 4.1 Portfolio Section

The current state of the organization's real-estate portfolio. **Not date-filtered** — always shows current snapshot.

```typescript
interface PortfolioSection {
  totalProjects: number;              // Total number of projects
  projectsByStatus: Record<string, number>;  // e.g. {"under-construction": 1, "launched": 1, "pre-launch": 1}
  totalUnits: number;                 // Total units across all projects
  unitsByStatus: Record<string, number>;     // e.g. {"available": 27, "booked": 16, "sold": 12}
  totalInventoryValue: number;        // Sum of currentPrice of ALL units (INR)
  totalSoldValue: number;             // Sum of currentPrice of SOLD units (INR)
  totalTargetRevenue: number;         // Sum of targetRevenue across all projects (INR)
  totalArea: number;                  // Total area in sq ft
}
```

**Project Status enum values (possible keys in `projectsByStatus`):**
`planning`, `pre-launch`, `launched`, `under-construction`, `completed`, `on-hold`

**Unit Status enum values (possible keys in `unitsByStatus`):**
`available`, `booked`, `sold`, `blocked`

**UI Suggestions:**
- **Top KPI cards**: totalProjects, totalUnits, totalInventoryValue, totalTargetRevenue
- **Donut chart**: unitsByStatus (available vs booked vs sold vs blocked)
- **Small horizontal bar**: projectsByStatus with color-coded badges
- **Big number**: totalArea formatted as "5.8 Lakh sq ft"

---

### 4.2 Revenue Section

Financial health across the organization. **Mixed** — some fields are all-time cumulative, some are period-filtered.

```typescript
interface RevenueSection {
  totalSalesValue: number;            // Total sale price of all sales ever (INR) — cumulative
  totalSalesCount: number;            // Number of sales ever — cumulative
  periodSalesValue: number;           // Sale value within the selected period (INR) — period
  periodSalesCount: number;           // Number of sales within period — period
  totalCollected: number;             // Total payments received (completed/cleared) — cumulative
  periodCollected: number;            // Payments received within period — period
  totalOutstanding: number;           // Outstanding amount from active payment plans — cumulative
  totalOverdue: number;               // Overdue installment amounts — cumulative
  overdueInstallmentCount: number;    // Number of overdue installments — cumulative
  collectionRate: number;             // (totalCollected / totalSalesValue) × 100 — percentage
}
```

**UI Suggestions:**
- **KPI Row**: totalSalesValue, totalCollected, totalOutstanding, totalOverdue
- **Progress bar**: collectionRate (show as "39.5% collected")
- **Period highlight card**: "₹{periodSalesValue} booked this month ({periodSalesCount} sales)"
- **Alert badge**: if totalOverdue > 0, show red "₹{totalOverdue} overdue ({overdueInstallmentCount} installments)"
- **Stacked bar**: totalCollected vs totalOutstanding vs totalOverdue

---

### 4.3 Sales Pipeline Section

Lead funnel and conversion metrics. **Mixed** — lead snapshot (all-time) + period-filtered new leads/sales.

```typescript
interface SalesPipelineSection {
  totalLeads: number;                 // Total leads in system — cumulative
  periodNewLeads: number;             // Leads created in period — period
  leadsByStatus: Record<string, number>;     // Lead count by status
  leadsBySource: Record<string, number>;     // Lead count by source
  avgLeadScore: number;               // Average AI lead score (0–100)
  hotLeads: number;                   // Leads with score >= 70
  overdueFollowUps: number;           // Leads past their follow-up date
  totalSales: number;                 // Sales within period — period
  periodSales: number;                // Same as totalSales (period sales count)
  avgBookingValue: number;            // Average sale price within period (INR)
  conversionRate: number;             // (Booked leads / Total leads) × 100 — percentage
}
```

**Lead Status enum values (possible keys in `leadsByStatus`):**
`New`, `Contacted`, `Qualified`, `Site Visit Scheduled`, `Site Visit Completed`, `Negotiating`, `Booked`, `Lost`, `Unqualified`

**Lead Source enum values (possible keys in `leadsBySource`):**
`Website`, `Property Portal`, `Referral`, `Walk-in`, `Social Media`, `Advertisement`, `Cold Call`, `Other`

**UI Suggestions:**
- **Funnel chart**: leadsByStatus — ordered from New → Booked (top to bottom)
- **Pie/Donut chart**: leadsBySource — which channels generate leads
- **KPI cards**: totalLeads, hotLeads, conversionRate, avgBookingValue
- **Alert badges**: overdueFollowUps (red if > 0: "{n} follow-ups overdue")
- **Gauge/Score**: avgLeadScore (0–100 scale)
- **Period highlight**: "📈 {periodNewLeads} new leads this month"

---

### 4.4 Construction Section

Construction progress and cost tracking. **Snapshot** — always shows current state.

```typescript
interface ConstructionSection {
  milestonesByPhase: Record<string, PhaseDetail>;   // Detailed per-phase breakdown
  milestonesByStatus: Record<string, number>;       // Milestone count by status
  delayedCount: number;               // Milestones past planned end & not completed
  overallProgress: number;            // Weighted average progress (0–100) — percentage
  costVariance: {
    planned: number;                  // Total budgeted construction cost (INR)
    actual: number;                   // Total actual construction cost (INR)
    variance: number;                 // actual - planned (negative = under budget)
    variancePercent: number;          // ((actual - planned) / planned) × 100
  };
  activeContractors: number;          // Contractors with status "Active"
  avgContractorRating: number;        // Average contractor rating (0–5)
  openIssues: number;                 // Open/In Progress issues across milestones
}

interface PhaseDetail {
  total: number;                      // Total milestones in this phase
  completed: number;                  // Completed milestones
  inProgress: number;                 // In Progress milestones
  avgProgress: number;                // Average progress % for this phase
}
```

**Phase enum values (possible keys in `milestonesByPhase`):**
`Pre-Construction`, `Foundation Phase`, `Structure Phase`, `MEP Phase`, `Finishing Phase`, `Inspection Phase`, `Handover Phase`

**Milestone Status enum values (possible keys in `milestonesByStatus`):**
`Not Started`, `Planning`, `In Progress`, `On Hold`, `Completed`, `Delayed`, `Cancelled`

**UI Suggestions:**
- **Horizontal stacked progress bar**: milestonesByPhase — each phase as a segment showing completed/inProgress/remaining
- **Big circular gauge**: overallProgress (28.8%)
- **Cost variance card**: Show planned vs actual with color:
  - Green if variancePercent < 0 (under budget)
  - Yellow if 0–10%
  - Red if > 10% (over budget)
- **KPI cards**: delayedCount (red), activeContractors, avgContractorRating (star rating), openIssues
- **Phase table**: One row per phase with progress bar and milestone counts

**Recommended phase display order:**
1. Pre-Construction
2. Foundation Phase
3. Structure Phase
4. MEP Phase
5. Finishing Phase
6. Inspection Phase
7. Handover Phase

---

### 4.5 Invoicing Section

Invoice status and amounts. **Mixed** — snapshot totals + period-filtered new invoices.

```typescript
interface InvoicingSection {
  totalInvoiced: number;              // Total amount invoiced ever (INR) — cumulative
  totalPaid: number;                  // Total paid amount on invoices (INR) — cumulative
  totalPending: number;               // Total pending amount (INR) — cumulative
  totalOverdue: number;               // Total overdue invoice amount (INR) — cumulative
  overdueCount: number;               // Number of overdue invoices — cumulative
  invoicesByStatus: Record<string, number>;   // Invoice count by status
  periodInvoiceCount: number;         // Invoices generated in period — period
  periodInvoiceValue: number;         // Value of invoices generated in period (INR) — period
}
```

**Invoice Status enum values (possible keys in `invoicesByStatus`):**
`draft`, `generated`, `sent`, `paid`, `overdue`, `cancelled`, `partially_paid`

**UI Suggestions:**
- **KPI row**: totalInvoiced, totalPaid, totalPending, totalOverdue
- **Donut chart**: invoicesByStatus
- **Alert**: if overdueCount > 0, show red "⚠ {overdueCount} overdue invoices totaling ₹{totalOverdue}"
- **Period highlight**: "{periodInvoiceCount} invoices worth ₹{periodInvoiceValue} generated this month"

---

### 4.6 Channel Partner Section

Channel partner commission tracking. **Snapshot** — current state.

```typescript
interface ChannelPartnerSection {
  totalGrossCommissions: number;      // Total gross commission calculated (INR)
  totalNetCommissions: number;        // Total net commission after deductions (INR)
  totalPaid: number;                  // Commission amount paid out (INR)
  totalPending: number;               // Commission amount pending payout (INR)
  commissionsByStatus: Record<string, CommissionStatusDetail>;
}

interface CommissionStatusDetail {
  count: number;                      // Number of commissions in this status
  amount: number;                     // Total net commission amount for this status (INR)
}
```

**Commission Status enum values (possible keys in `commissionsByStatus`):**
`calculated`, `pending_approval`, `approved`, `on_hold`, `paid`, `cancelled`, `clawed_back`

**UI Suggestions:**
- **KPI row**: totalGrossCommissions, totalNetCommissions, totalPaid, totalPending
- **Horizontal bar or table**: commissionsByStatus showing count and amount per status
- **Progress**: (totalPaid / totalNetCommissions) as "Payout Progress"

---

### 4.7 Operations Section

Task management KPIs. **Mixed** — snapshot status + period-filtered creation/completion.

```typescript
interface OperationsSection {
  tasksByStatus: Record<string, number>;     // Task count by status
  tasksByPriority: Record<string, number>;   // Task count by priority
  tasksByCategory: Record<string, number>;   // Task count by category
  overdueCount: number;               // Tasks past due date & not completed/cancelled
  escalatedCount: number;             // Tasks with escalation level > 0
  periodCreated: number;              // Tasks created in period — period
  periodCompleted: number;            // Tasks completed in period — period
}
```

**Task Status enum values (possible keys in `tasksByStatus`):**
`Open`, `In Progress`, `Under Review`, `Completed`, `On Hold`, `Cancelled`

**Task Priority enum values (possible keys in `tasksByPriority`):**
`Critical`, `High`, `Medium`, `Low`

**Task Category enum values (possible keys in `tasksByCategory`):**
`Lead & Sales`, `Payment & Collection`, `Construction`, `Document & Compliance`, `Customer Service`, `Approval`, `General`

**UI Suggestions:**
- **Donut chart**: tasksByStatus
- **Horizontal bar**: tasksByPriority (color-coded: Critical=red, High=orange, Medium=blue, Low=gray)
- **Treemap or bar chart**: tasksByCategory
- **KPI cards**: overdueCount (red), escalatedCount (orange), periodCreated, periodCompleted
- **Completion metric**: "Completed {periodCompleted} of {periodCreated} tasks this month"

---

### 4.8 Team Section

User and workload distribution. **Snapshot** — current state.

```typescript
interface TeamSection {
  activeUsers: number;                // Active users in the organization
  usersByRole: Record<string, number>;       // User count per role name
  topWorkload: WorkloadEntry[];       // Top 10 users by open task count (descending)
}

interface WorkloadEntry {
  userId: string;                     // User ID (MongoDB ObjectId)
  name: string;                       // Full name (e.g. "Neha Gupta")
  openTasks: number;                  // Number of Open + In Progress tasks
}
```

**Possible role names (keys in `usersByRole`):**
`Organization Owner`, `Business Head`, `Project Director`, `Sales Head`, `Marketing Head`, `Finance Head`, `Sales Manager`, `Finance Manager`, `Channel Partner Manager`, `Sales Executive`, `Channel Partner Admin`, `Channel Partner Agent`

**UI Suggestions:**
- **KPI card**: activeUsers
- **Horizontal bar or table**: usersByRole
- **Leaderboard/Table**: topWorkload — show name + bar chart of open tasks
- Consider showing avatars/initials for top workload users

---

## 5. Endpoint 2: Project Comparison

Returns an array of projects, each with identical metric sections for side-by-side comparison, plus a `comparison` highlights object.

### 5.1 ProjectDetail Interface

```typescript
interface ProjectDetail {
  projectId: string;                  // MongoDB ObjectId
  name: string;                       // Project name
  type: 'apartment' | 'villa' | 'commercial' | 'plot' | 'mixed';
  status: 'planning' | 'pre-launch' | 'launched' | 'under-construction' | 'completed' | 'on-hold';
  launchDate: string | null;          // ISO date
  expectedCompletionDate: string | null; // ISO date

  inventory: ProjectInventory;
  revenue: ProjectRevenue;
  salesPipeline: ProjectSalesPipeline;
  construction: ProjectConstruction;
  invoicing: ProjectInvoicing;
  channelPartner: ProjectChannelPartner;
  tasks: ProjectTasks;
  towers: TowerDetail[];
  alerts: ProjectAlert[];
}
```

### 5.2 Per-Project Sections

```typescript
interface ProjectInventory {
  totalUnits: number;
  available: number;
  booked: number;
  sold: number;
  blocked: number;
  inventoryValue: number;             // Sum of currentPrice of all units (INR)
  occupancyRate: number;              // ((booked + sold) / totalUnits) × 100 — percentage
}

interface ProjectRevenue {
  targetRevenue: number;              // Project's target revenue (INR)
  actualRevenue: number;              // Sum of sale prices (INR) — cumulative
  achievementRate: number;            // (actualRevenue / targetRevenue) × 100 — percentage
  periodRevenue: number;              // Sales value within period (INR)
  periodSalesCount: number;           // Sales count within period
  totalCollected: number;             // Payments received (INR) — cumulative
  totalOutstanding: number;           // actualRevenue - totalCollected (INR) — cumulative
  overdueAmount: number;              // Overdue installment amount (INR) — cumulative
  collectionEfficiency: number;       // (totalCollected / actualRevenue) × 100 — percentage
}

interface ProjectSalesPipeline {
  totalLeads: number;                 // Leads for this project
  qualifiedLeads: number;             // Leads in Qualified/SiteVisit/Negotiating/Booked status
  totalSales: number;                 // Total sales count — cumulative
  periodSales: number;                // Sales in period
  avgSalePrice: number;               // Average sale price (INR)
  conversionRate: number;             // (Booked / totalLeads) × 100 — percentage
}

interface ProjectConstruction {
  totalMilestones: number;
  completed: number;
  inProgress: number;
  delayed: number;
  overallProgress: number;            // Average progress % across all milestones
  costVariance: {
    planned: number;                  // Budgeted cost (INR)
    actual: number;                   // Actual cost (INR)
    variancePercent: number;          // ((actual - planned) / planned) × 100
  };
}

interface ProjectInvoicing {
  totalInvoiced: number;              // Total invoiced amount (INR)
  totalPaid: number;                  // Paid amount on invoices (INR)
  overdueAmount: number;              // Overdue invoice amount (INR)
  overdueCount: number;               // Number of overdue invoices
}

interface ProjectChannelPartner {
  salesViaCp: number;                 // Number of sales via channel partners
  totalCommission: number;            // Total net commission (INR)
  paidCommission: number;             // Paid commission (INR)
}

interface ProjectTasks {
  total: number;
  open: number;
  inProgress: number;
  completed: number;
  overdue: number;
}
```

### 5.3 Tower Detail

Each project contains a `towers` array with tower-level breakdown:

```typescript
interface TowerDetail {
  towerId: string;                    // MongoDB ObjectId
  name: string;                       // e.g. "Tower A", "Phase 1"
  code: string;                       // e.g. "HHA", "GFV1"
  totalUnits: number;
  status: 'planning' | 'under_construction' | 'completed' | 'on_hold' | 'cancelled';
  constructionProgress: number;       // 0–100 percentage
  financials: {
    constructionCost: {
      budgeted: number;               // Budgeted construction cost (INR)
      actual: number;                 // Actual construction cost (INR)
    };
    revenueTarget: number;            // Revenue target for this tower (INR)
    revenueAchieved: number;          // Revenue achieved (INR)
  };
}
```

### 5.4 Project Alerts

Auto-generated alerts per project. Each project's `alerts` array may contain:

```typescript
interface ProjectAlert {
  type: AlertType;
  severity: 'info' | 'warning' | 'critical';
  message: string;                    // Human-readable message
}

type AlertType =
  | 'delayed_milestone'       // Construction milestones past planned end date
  | 'cost_overrun'            // Construction cost variance > 10%
  | 'overdue_invoices'        // Invoices in overdue status
  | 'overdue_installments'    // Installment payments overdue
  | 'low_revenue'             // Revenue achievement < 30% of target
  | 'overdue_tasks';          // More than 5 overdue tasks
```

**Alert generation rules:**

| Alert Type | Trigger Condition | Severity |
|------------|-------------------|----------|
| `delayed_milestone` | `delayed >= 1` | `critical` if >= 3, else `warning` |
| `cost_overrun` | `costVariance.variancePercent > 10` | `critical` if > 20%, else `warning` |
| `overdue_invoices` | `overdueCount >= 1` | `warning` if >= 3, else `info` |
| `overdue_installments` | Overdue installments exist for this project | `critical` if >= 5, else `warning` |
| `low_revenue` | `achievementRate > 0 && achievementRate < 30` | `warning` |
| `overdue_tasks` | `overdue > 5` | `warning` |

### 5.5 Comparison Highlights

The `comparison` object identifies the best-performing project for each metric:

```typescript
interface ComparisonHighlights {
  bestRevenue: {
    projectId: string;
    name: string;
    achievementRate: number;          // % of target achieved
  };
  bestSales: {
    projectId: string;
    name: string;
    conversionRate: number;           // Lead conversion %
  };
  bestConstruction: {
    projectId: string;
    name: string;
    overallProgress: number;          // Construction progress %
  };
  bestCollection: {
    projectId: string;
    name: string;
    collectionEfficiency: number;     // Collection efficiency %
  };
}
```

---

## 6. Enum & Status Reference

### 6.1 All Possible Enum Values

| Category | Field | Values |
|----------|-------|--------|
| Project Status | `projectsByStatus`, `project.status` | `planning`, `pre-launch`, `launched`, `under-construction`, `completed`, `on-hold` |
| Unit Status | `unitsByStatus` | `available`, `booked`, `sold`, `blocked` |
| Lead Status | `leadsByStatus` | `New`, `Contacted`, `Qualified`, `Site Visit Scheduled`, `Site Visit Completed`, `Negotiating`, `Booked`, `Lost`, `Unqualified` |
| Lead Source | `leadsBySource` | `Website`, `Property Portal`, `Referral`, `Walk-in`, `Social Media`, `Advertisement`, `Cold Call`, `Other` |
| Milestone Phase | `milestonesByPhase` | `Pre-Construction`, `Foundation Phase`, `Structure Phase`, `MEP Phase`, `Finishing Phase`, `Inspection Phase`, `Handover Phase` |
| Milestone Status | `milestonesByStatus` | `Not Started`, `Planning`, `In Progress`, `On Hold`, `Completed`, `Delayed`, `Cancelled` |
| Invoice Status | `invoicesByStatus` | `draft`, `generated`, `sent`, `paid`, `overdue`, `cancelled`, `partially_paid` |
| Commission Status | `commissionsByStatus` | `calculated`, `pending_approval`, `approved`, `on_hold`, `paid`, `cancelled`, `clawed_back` |
| Task Status | `tasksByStatus` | `Open`, `In Progress`, `Under Review`, `Completed`, `On Hold`, `Cancelled` |
| Task Priority | `tasksByPriority` | `Critical`, `High`, `Medium`, `Low` |
| Task Category | `tasksByCategory` | `Lead & Sales`, `Payment & Collection`, `Construction`, `Document & Compliance`, `Customer Service`, `Approval`, `General` |
| Project Type | `project.type` | `apartment`, `villa`, `commercial`, `plot`, `mixed` |
| Tower Status | `tower.status` | `planning`, `under_construction`, `completed`, `on_hold`, `cancelled` |
| Alert Severity | `alert.severity` | `info`, `warning`, `critical` |
| Alert Type | `alert.type` | `delayed_milestone`, `cost_overrun`, `overdue_invoices`, `overdue_installments`, `low_revenue`, `overdue_tasks` |

### 6.2 Important Notes

- **Status keys are exact strings** — e.g. `"Site Visit Scheduled"` (with spaces), `"under-construction"` (hyphenated for project), `"under_construction"` (underscored for tower).
- **Record objects may have missing keys** — if no units are `blocked`, `unitsByStatus` will NOT contain a `"blocked"` key. Always use optional chaining or fallback: `unitsByStatus.blocked ?? 0`.
- **All monetary values are in INR (Indian Rupees)** and are raw numbers, not pre-formatted.
- **All percentages are pre-calculated** — e.g. `collectionRate: 39.5` means 39.5%.
- **Dates are ISO 8601 strings** — e.g. `"2026-01-13T13:15:37.449Z"`.

---

## 7. UI Component Guide

### 7.1 Page 1: Organization Overview

**Recommended layout — top to bottom:**

```
┌─────────────────────────────────────────────────────────────────────┐
│  HEADER: "Leadership Dashboard" + Period Filter Dropdown            │
│  [Last 7 days] [Last 30 days] [Last 90 days] [This Year] [Custom]  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────────┐ │
│  │ PORTFOLIO    │ │ TOTAL SALES  │ │ COLLECTED    │ │ OVERDUE    │ │
│  │ 3 Projects   │ │ ₹6.8 Cr     │ │ ₹2.69 Cr    │ │ ₹70.7L    │ │
│  │ 55 Units     │ │ 5 Sales      │ │ 39.5% Rate   │ │ 2 Instmts │ │
│  └──────────────┘ └──────────────┘ └──────────────┘ └────────────┘ │
│                                                                     │
│  ┌── UNIT INVENTORY (Donut) ──┐  ┌── REVENUE BREAKDOWN (Bar) ────┐ │
│  │  Available: 27  ████████   │  │  ████ Collected: ₹2.69Cr      │ │
│  │  Booked: 16     █████      │  │  ██ Outstanding: ₹4.9Cr       │ │
│  │  Sold: 12       ████       │  │  █ Overdue: ₹0.7Cr            │ │
│  └────────────────────────────┘  └────────────────────────────────┘ │
│                                                                     │
│  ┌── SALES PIPELINE (Funnel) ─┐  ┌── LEAD SOURCES (Pie) ────────┐ │
│  │  New: 3                    │  │  Website: 4                   │ │
│  │  Contacted: 3              │  │  Property Portal: 4           │ │
│  │  Qualified: 3              │  │  Walk-in: 3                   │ │
│  │  Site Visit: 5             │  │  Social Media: 3              │ │
│  │  Negotiating: 2            │  │  Referral: 3                  │ │
│  │  Booked: 2                 │  │  Advertisement: 3             │ │
│  └────────────────────────────┘  └────────────────────────────────┘ │
│                                                                     │
│  ┌── CONSTRUCTION PROGRESS ──────────────────────────────────────┐  │
│  │  Overall: ██████░░░░░░░░░░░░░░ 28.8%                         │  │
│  │  Pre-Construction: ████████████████████ 100%  (2/2 done)      │  │
│  │  Foundation:       ██████████████████░░ 91.7% (2/3 done)      │  │
│  │  Structure:        ████░░░░░░░░░░░░░░░ 20%   (0/3 done)      │  │
│  │  MEP:              ░░░░░░░░░░░░░░░░░░░ 0%    (0/3 done)      │  │
│  │  Finishing:        █░░░░░░░░░░░░░░░░░░ 8%    (0/5 done)      │  │
│  │  Inspection:       ░░░░░░░░░░░░░░░░░░░ 0%    (0/2 done)      │  │
│  │  Handover:         ░░░░░░░░░░░░░░░░░░░ 0%    (0/2 done)      │  │
│  │                                                               │  │
│  │  Cost: ₹12.16Cr budgeted → ₹2.91Cr spent (24% utilized)     │  │
│  │  ⚠ 4 milestones delayed  |  6 active contractors (★ 4.3)    │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌── INVOICING ──────────────┐  ┌── CHANNEL PARTNERS ───────────┐  │
│  │  Invoiced: ₹7.54 Cr      │  │  Gross Commission: ₹8.1L      │  │
│  │  Paid: ₹2.0 Cr           │  │  Net Commission: ₹7.7L        │  │
│  │  Pending: ₹5.5 Cr        │  │  Paid: ₹0                     │  │
│  │  ⚠ 3 overdue (₹4.97Cr)  │  │  Pending: ₹0                  │  │
│  └───────────────────────────┘  └────────────────────────────────┘  │
│                                                                     │
│  ┌── TASKS (Donut) ─────────┐  ┌── TEAM WORKLOAD ───────────────┐  │
│  │  Open: 7                  │  │  Active Users: 13              │  │
│  │  In Progress: 3           │  │  Neha Gupta     ███ 3 tasks    │  │
│  │  Under Review: 1          │  │  Vikram Mehta   ██  2 tasks    │  │
│  │  Completed: 2             │  │  Sanjay Patel   █   1 task     │  │
│  │  On Hold: 1               │  │  Arjun Desai    █   1 task     │  │
│  │  Cancelled: 1             │  │  ...                           │  │
│  │  ⚠ 1 overdue, 1 escalated│  │                                │  │
│  └───────────────────────────┘  └────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### 7.2 Page 2: Project Comparison

**Recommended layout:**

```
┌─────────────────────────────────────────────────────────────────────┐
│  HEADER: "Project Comparison"                                       │
│  Period: [30 days ▼]   Sort by: [Revenue ▼]   Filter: [All ▼]     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌── COMPARISON HIGHLIGHTS ────────────────────────────────────────┐│
│  │ 🏆 Best Revenue: Greenfield Villas (2.5%)                      ││
│  │ 🏆 Best Sales: Greenfield Villas (20% conversion)              ││
│  │ 🏆 Best Construction: Horizon Heights (28.8%)                  ││
│  │ 🏆 Best Collection: Horizon Heights (76.7%)                    ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                     │
│  ┌─ PROJECT CARDS (side by side or tabbed) ────────────────────────┐│
│  │                                                                  ││
│  │ ┌── Greenfield Villas ──┐ ┌── Horizon Heights ──┐ ┌── Skyline ┐││
│  │ │ Type: Villa           │ │ Type: Apartment     │ │ Type: Comm │││
│  │ │ Status: Launched      │ │ Status: Under Constr│ │ Status: Pre│││
│  │ │                       │ │                     │ │            │││
│  │ │ ── INVENTORY ──       │ │ ── INVENTORY ──     │ │            │││
│  │ │ 15 units              │ │ 30 units            │ │ 10 units   │││
│  │ │ ██░░ 46.7% occupied   │ │ ██████░ 70% occ     │ │ ░░ 0%     │││
│  │ │                       │ │                     │ │            │││
│  │ │ ── REVENUE ──         │ │ ── REVENUE ──       │ │            │││
│  │ │ Target: ₹180Cr        │ │ Target: ₹270Cr      │ │ ₹150Cr    │││
│  │ │ Actual: ₹4.5Cr        │ │ Actual: ₹2.3Cr      │ │ ₹0        │││
│  │ │ 2.5% achieved         │ │ 0.9% achieved       │ │ 0%        │││
│  │ │ Collection: 20.5%     │ │ Collection: 76.7%   │ │ 0%        │││
│  │ │                       │ │                     │ │            │││
│  │ │ ── CONSTRUCTION ──    │ │ ── CONSTRUCTION ──  │ │            │││
│  │ │ No milestones yet     │ │ 28.8% overall       │ │ Not started│││
│  │ │                       │ │ 4 delayed ⚠         │ │            │││
│  │ │                       │ │ Cost: -76% variance  │ │            │││
│  │ │                       │ │                     │ │            │││
│  │ │ ── TOWERS ──          │ │ ── TOWERS ──        │ │ ── TOWER ─│││
│  │ │ Phase 1 ████████ 100% │ │ Tower A ██████ 55%  │ │ Tower 1 0%│││
│  │ │ Phase 2 ███░░░░░  35% │ │ Tower B ████░░ 40%  │ │           │││
│  │ │                       │ │ Tower C ░░░░░░  0%  │ │           │││
│  │ │                       │ │                     │ │            │││
│  │ │ ── ALERTS ──          │ │ ── ALERTS ──        │ │ No alerts  │││
│  │ │ ⚠ 3 invoices overdue │ │ 🔴 4 milestones    │ │            │││
│  │ │ ⚠ 1 installment      │ │    delayed          │ │            │││
│  │ │ ⚠ Low revenue 2.5%   │ │ ⚠ 1 installment    │ │            │││
│  │ │                       │ │ ⚠ Low revenue 0.9% │ │            │││
│  │ └───────────────────────┘ └─────────────────────┘ └────────────┘││
│  └──────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

### 7.3 Component Breakdown

| Component | Used In | Data Source |
|-----------|---------|-------------|
| `KpiCard` | Both pages | Any single numeric metric with label |
| `DonutChart` | Overview (units, tasks, invoices) | `Record<string, number>` objects |
| `FunnelChart` | Overview (leads) | `leadsByStatus` — ordered by pipeline stage |
| `StackedProgressBar` | Overview (construction), Comparison (towers) | Phase data or tower progress |
| `HorizontalBar` | Overview (priority, source, roles) | `Record<string, number>` objects |
| `GaugeChart` | Overview (progress, collection rate) | Single percentage value |
| `AlertBanner` | Comparison (per project) | `alerts[]` array |
| `ProjectCard` | Comparison page | Full `ProjectDetail` object |
| `TowerRow` | Inside ProjectCard | `TowerDetail` object |
| `ComparisonHighlightBar` | Comparison page (top) | `comparison` object |
| `PeriodSelector` | Both pages (header) | Drives `period`/`startDate`/`endDate` params |
| `SortSelector` | Comparison page | Drives `sortBy` param |
| `CurrencyDisplay` | Throughout | Formats INR amounts |
| `StarRating` | Overview (contractors) | `avgContractorRating` (0–5) |
| `WorkloadTable` | Overview (team) | `topWorkload[]` array |

---

## 8. Currency & Number Formatting

All monetary values are in **INR (Indian Rupees)** as raw numbers. Frontend must format them.

**Recommended formatting rules:**

```typescript
function formatINR(value: number): string {
  if (value >= 10000000) {
    // Crores: ₹6.8 Cr
    return `₹${(value / 10000000).toFixed(1)} Cr`;
  } else if (value >= 100000) {
    // Lakhs: ₹70.7L
    return `₹${(value / 100000).toFixed(1)}L`;
  } else if (value >= 1000) {
    // Thousands: ₹50K
    return `₹${(value / 1000).toFixed(1)}K`;
  }
  return `₹${value.toLocaleString('en-IN')}`;
}

// Full format for tooltips / detail views
function formatINRFull(value: number): string {
  return `₹${value.toLocaleString('en-IN')}`;
}

// Percentage — already calculated by API
function formatPercent(value: number): string {
  return `${value}%`;
}

// Area
function formatArea(sqft: number): string {
  if (sqft >= 100000) return `${(sqft / 100000).toFixed(1)} Lakh sq ft`;
  return `${sqft.toLocaleString('en-IN')} sq ft`;
}
```

**Examples with demo data:**

| Raw Value | Short Format | Full Format |
|-----------|-------------|-------------|
| `904750000` | ₹90.5 Cr | ₹90,47,50,000 |
| `68000000` | ₹6.8 Cr | ₹6,80,00,000 |
| `7071200` | ₹70.7L | ₹70,71,200 |
| `580000` | 5.8 Lakh sq ft | 5,80,000 sq ft |

---

## 9. Color Coding & Severity Mapping

### 9.1 Alert Severity Colors

| Severity | Color | Use |
|----------|-------|-----|
| `critical` | Red (`#EF4444` / `red-500`) | Urgent attention needed — delayed milestones, cost overrun >20% |
| `warning` | Amber (`#F59E0B` / `amber-500`) | Action recommended — overdue items, low revenue |
| `info` | Blue (`#3B82F6` / `blue-500`) | Informational — minor overdue counts |

### 9.2 Status Color Mapping

**Project Status:**
| Status | Color | Badge Text |
|--------|-------|------------|
| `planning` | Gray | Planning |
| `pre-launch` | Purple | Pre-Launch |
| `launched` | Green | Launched |
| `under-construction` | Blue | Under Construction |
| `completed` | Emerald | Completed |
| `on-hold` | Orange | On Hold |

**Unit Status:**
| Status | Color |
|--------|-------|
| `available` | Green |
| `booked` | Blue |
| `sold` | Emerald/Dark Green |
| `blocked` | Red |

**Task Priority:**
| Priority | Color |
|----------|-------|
| `Critical` | Red |
| `High` | Orange |
| `Medium` | Blue |
| `Low` | Gray |

**Task Status:**
| Status | Color |
|--------|-------|
| `Open` | Blue |
| `In Progress` | Amber |
| `Under Review` | Purple |
| `Completed` | Green |
| `On Hold` | Gray |
| `Cancelled` | Red |

**Milestone Status:**
| Status | Color |
|--------|-------|
| `Not Started` | Gray |
| `Planning` | Purple |
| `In Progress` | Blue |
| `On Hold` | Orange |
| `Completed` | Green |
| `Delayed` | Red |
| `Cancelled` | Dark Gray |

### 9.3 Metric Thresholds

| Metric | Good (Green) | Warning (Amber) | Bad (Red) |
|--------|-------------|-----------------|-----------|
| `collectionRate` | > 70% | 40–70% | < 40% |
| `collectionEfficiency` | > 70% | 40–70% | < 40% |
| `achievementRate` | > 50% | 20–50% | < 20% |
| `conversionRate` | > 15% | 5–15% | < 5% |
| `overallProgress` | On or ahead of schedule | Slightly behind | > 2 milestones delayed |
| `costVariance.variancePercent` | < 0 (under budget) | 0–10% | > 10% (over budget) |
| `overdueCount` | 0 | 1–2 | >= 3 |

---

## 10. Empty/Zero State Handling

The API always returns all keys even when data is empty/zero. Handle these gracefully:

| Scenario | What API Returns | UI Recommendation |
|----------|-----------------|-------------------|
| No projects | `totalProjects: 0`, empty objects | "No projects yet. Create your first project." |
| No units | `totalUnits: 0`, `unitsByStatus: {}` | Show empty donut with "No units created" |
| No sales | `totalSalesValue: 0`, `periodSalesValue: 0` | Show ₹0 with "No sales recorded" |
| No leads | `totalLeads: 0`, `leadsByStatus: {}` | Show empty funnel with "No leads yet" |
| No milestones (per project) | `totalMilestones: 0`, `overallProgress: 0` | "Construction not started" / gray progress bar |
| No invoices | `totalInvoiced: 0`, `invoicesByStatus: {}` | "No invoices generated" |
| No commissions | `totalGrossCommissions: 0`, `commissionsByStatus: {}` | "No channel partner activity" |
| No tasks | All task counts = 0 | "No tasks created" |
| No towers for a project | `towers: []` | "No towers configured" |
| No alerts for a project | `alerts: []` | Show green checkmark: "All clear" |
| `Record<string, number>` missing a key | Key simply absent from object | Default to `0`. E.g. `data.unitsByStatus.blocked ?? 0` |

---

## 11. Error Handling

### 11.1 HTTP Status Codes

| Code | Meaning | When |
|------|---------|------|
| `200` | Success | Normal response |
| `400` | Bad Request | `startDate` without `endDate` or vice versa |
| `401` | Unauthorized | Missing or invalid JWT token |
| `403` | Forbidden | User lacks `dashboard:leadership` permission |
| `500` | Server Error | Aggregation failure |

### 11.2 Error Response Format

```typescript
interface ErrorResponse {
  message: string;                    // Human-readable error message
  stack?: string;                     // Only in development mode
}
```

### 11.3 403 Handling

```json
{
  "message": "Missing required permission(s): dashboard:leadership"
}
```

**UI**: If user gets 403, show a "You don't have permission to view this dashboard. Contact your administrator." page. Do NOT show the menu item for users without this permission. Check user permissions on the frontend to conditionally render the navigation link.

### 11.4 Partial Failures

If one aggregation sub-function fails, the section will include an `error` field alongside zeroed-out data. The rest of the dashboard still loads. Check for `error` field:

```typescript
if (data.portfolio.error) {
  // Show "Portfolio data unavailable" message in that section
}
```

---

## 12. Live API Response Examples

### 12.1 Overview — Full Response

```
GET /api/leadership/overview?period=30
Authorization: Bearer <token>
```

```json
{
  "success": true,
  "data": {
    "portfolio": {
      "totalProjects": 3,
      "projectsByStatus": {
        "pre-launch": 1,
        "launched": 1,
        "under-construction": 1
      },
      "totalUnits": 55,
      "unitsByStatus": {
        "available": 27,
        "booked": 16,
        "sold": 12
      },
      "totalInventoryValue": 904750000,
      "totalSoldValue": 192750000,
      "totalTargetRevenue": 6000000000,
      "totalArea": 580000
    },
    "revenue": {
      "totalSalesValue": 68000000,
      "totalSalesCount": 5,
      "periodSalesValue": 0,
      "periodSalesCount": 0,
      "totalCollected": 26856480,
      "periodCollected": 0,
      "totalOutstanding": 49039000,
      "totalOverdue": 7071200,
      "overdueInstallmentCount": 2,
      "collectionRate": 39.5
    },
    "salesPipeline": {
      "totalLeads": 20,
      "periodNewLeads": 20,
      "leadsByStatus": {
        "Booked": 2,
        "Negotiating": 2,
        "Lost": 2,
        "Qualified": 3,
        "Contacted": 3,
        "Site Visit Scheduled": 3,
        "Site Visit Completed": 2,
        "New": 3
      },
      "leadsBySource": {
        "Website": 4,
        "Walk-in": 3,
        "Referral": 3,
        "Advertisement": 3,
        "Property Portal": 4,
        "Social Media": 3
      },
      "avgLeadScore": 64.9,
      "hotLeads": 8,
      "overdueFollowUps": 1,
      "totalSales": 0,
      "periodSales": 0,
      "avgBookingValue": 0,
      "conversionRate": 10
    },
    "construction": {
      "milestonesByPhase": {
        "Pre-Construction": { "total": 2, "completed": 2, "inProgress": 0, "avgProgress": 100 },
        "Foundation Phase": { "total": 3, "completed": 2, "inProgress": 1, "avgProgress": 91.7 },
        "Structure Phase": { "total": 3, "completed": 0, "inProgress": 1, "avgProgress": 20 },
        "MEP Phase": { "total": 3, "completed": 0, "inProgress": 0, "avgProgress": 0 },
        "Finishing Phase": { "total": 5, "completed": 0, "inProgress": 0, "avgProgress": 8 },
        "Inspection Phase": { "total": 2, "completed": 0, "inProgress": 0, "avgProgress": 0 },
        "Handover Phase": { "total": 2, "completed": 0, "inProgress": 0, "avgProgress": 0 }
      },
      "milestonesByStatus": {
        "Planning": 1,
        "Not Started": 12,
        "Completed": 4,
        "Delayed": 1,
        "In Progress": 2
      },
      "delayedCount": 4,
      "overallProgress": 28.8,
      "costVariance": {
        "planned": 121600000,
        "actual": 29130000,
        "variance": -92470000,
        "variancePercent": -76
      },
      "activeContractors": 6,
      "avgContractorRating": 4.3,
      "openIssues": 0
    },
    "invoicing": {
      "totalInvoiced": 75430000,
      "totalPaid": 19976250,
      "totalPending": 55453750,
      "totalOverdue": 49728000,
      "overdueCount": 3,
      "invoicesByStatus": { "partially_paid": 2, "overdue": 3 },
      "periodInvoiceCount": 0,
      "periodInvoiceValue": 0
    },
    "channelPartner": {
      "totalGrossCommissions": 810000,
      "totalNetCommissions": 769500,
      "totalPaid": 0,
      "totalPending": 0,
      "commissionsByStatus": {
        "paid": { "count": 2, "amount": 437000 },
        "approved": { "count": 1, "amount": 47500 },
        "pending_approval": { "count": 1, "amount": 285000 }
      }
    },
    "operations": {
      "tasksByStatus": { "Cancelled": 1, "Completed": 2, "On Hold": 1, "In Progress": 3, "Open": 7, "Under Review": 1 },
      "tasksByPriority": { "Medium": 5, "Critical": 1, "High": 7, "Low": 2 },
      "tasksByCategory": { "Lead & Sales": 3, "Construction": 3, "Approval": 1, "Payment & Collection": 2, "General": 2, "Customer Service": 2, "Document & Compliance": 2 },
      "overdueCount": 1,
      "escalatedCount": 1,
      "periodCreated": 15,
      "periodCompleted": 2
    },
    "team": {
      "activeUsers": 13,
      "usersByRole": {
        "Organization Owner": 1, "Business Head": 1, "Project Director": 1,
        "Sales Head": 1, "Marketing Head": 1, "Finance Head": 1,
        "Sales Manager": 1, "Finance Manager": 1, "Channel Partner Manager": 1,
        "Sales Executive": 2, "Channel Partner Admin": 1, "Channel Partner Agent": 1
      },
      "topWorkload": [
        { "userId": "698dbcff61a8e6df665e08e5", "name": "Neha Gupta", "openTasks": 3 },
        { "userId": "698dbcf861a8e6df665e089e", "name": "Vikram Mehta", "openTasks": 2 },
        { "userId": "698dbcfd61a8e6df665e08d7", "name": "Sanjay Patel", "openTasks": 1 },
        { "userId": "698dbcfc61a8e6df665e08cd", "name": "Arjun Desai", "openTasks": 1 },
        { "userId": "698dbcff61a8e6df665e08e7", "name": "Rohit Singh", "openTasks": 1 },
        { "userId": "698dbcfd61a8e6df665e08db", "name": "Kavita Reddy", "openTasks": 1 },
        { "userId": "698dbcf961a8e6df665e08a7", "name": "Priya Nair", "openTasks": 1 }
      ]
    }
  },
  "metadata": {
    "period": 30,
    "dateRange": { "start": "2026-01-13T13:15:37.449Z", "end": "2026-02-12T13:15:37.449Z" },
    "generatedAt": "2026-02-12T13:15:39.906Z"
  }
}
```

### 12.2 Project Comparison — Full Response

```
GET /api/leadership/project-comparison?period=30&sortBy=revenue
Authorization: Bearer <token>
```

```json
{
  "success": true,
  "data": {
    "projects": [
      {
        "projectId": "698dbd0261a8e6df665e08f7",
        "name": "Greenfield Villas",
        "type": "villa",
        "status": "launched",
        "launchDate": "2025-11-14T11:44:02.286Z",
        "expectedCompletionDate": "2028-02-02T11:44:02.286Z",
        "inventory": { "totalUnits": 15, "available": 8, "booked": 3, "sold": 4, "blocked": 0, "inventoryValue": 376500000, "occupancyRate": 46.7 },
        "revenue": { "targetRevenue": 1800000000, "actualRevenue": 45000000, "achievementRate": 2.5, "periodRevenue": 0, "periodSalesCount": 0, "totalCollected": 9204000, "totalOutstanding": 35796000, "overdueAmount": 3540000, "collectionEfficiency": 20.5 },
        "salesPipeline": { "totalLeads": 5, "qualifiedLeads": 3, "totalSales": 3, "periodSales": 0, "avgSalePrice": 15000000, "conversionRate": 20 },
        "construction": { "totalMilestones": 0, "completed": 0, "inProgress": 0, "delayed": 0, "overallProgress": 0, "costVariance": { "planned": 0, "actual": 0, "variancePercent": 0 } },
        "invoicing": { "totalInvoiced": 49728000, "totalPaid": 0, "overdueAmount": 49728000, "overdueCount": 3 },
        "channelPartner": { "salesViaCp": 2, "totalCommission": 332500, "paidCommission": 0 },
        "tasks": { "total": 0, "open": 0, "inProgress": 0, "completed": 0, "overdue": 0 },
        "towers": [
          { "towerId": "698dbd0261a8e6df665e0903", "name": "Phase 1", "code": "GFV1", "totalUnits": 8, "status": "completed", "constructionProgress": 100, "financials": { "constructionCost": { "budgeted": 160000000, "actual": 172000000 }, "revenueTarget": 240000000, "revenueAchieved": 195000000 } },
          { "towerId": "698dbd0261a8e6df665e0904", "name": "Phase 2", "code": "GFV2", "totalUnits": 8, "status": "under_construction", "constructionProgress": 35, "financials": { "constructionCost": { "budgeted": 200000000, "actual": 70000000 }, "revenueTarget": 320000000, "revenueAchieved": 64000000 } }
        ],
        "alerts": [
          { "type": "overdue_invoices", "severity": "warning", "message": "3 invoice(s) overdue totaling 4,97,28,000" },
          { "type": "overdue_installments", "severity": "warning", "message": "1 installment(s) overdue totaling 35,40,000" },
          { "type": "low_revenue", "severity": "warning", "message": "Revenue achievement at 2.5% of target" }
        ]
      },
      {
        "projectId": "698dbd0161a8e6df665e08ee",
        "name": "Horizon Heights",
        "type": "apartment",
        "status": "under-construction",
        "launchDate": "2025-08-16T11:44:01.875Z",
        "expectedCompletionDate": "2027-08-06T11:44:01.875Z",
        "inventory": { "totalUnits": 30, "available": 9, "booked": 13, "sold": 8, "blocked": 0, "inventoryValue": 422250000, "occupancyRate": 70 },
        "revenue": { "targetRevenue": 2700000000, "actualRevenue": 23000000, "achievementRate": 0.9, "periodRevenue": 0, "periodSalesCount": 0, "totalCollected": 17652480, "totalOutstanding": 5347520, "overdueAmount": 3531200, "collectionEfficiency": 76.7 },
        "salesPipeline": { "totalLeads": 12, "qualifiedLeads": 7, "totalSales": 2, "periodSales": 0, "avgSalePrice": 11500000, "conversionRate": 8.3 },
        "construction": { "totalMilestones": 20, "completed": 4, "inProgress": 2, "delayed": 4, "overallProgress": 28.8, "costVariance": { "planned": 121600000, "actual": 29130000, "variancePercent": -76 } },
        "invoicing": { "totalInvoiced": 25702000, "totalPaid": 19976250, "overdueAmount": 0, "overdueCount": 0 },
        "channelPartner": { "salesViaCp": 2, "totalCommission": 437000, "paidCommission": 437000 },
        "tasks": { "total": 0, "open": 0, "inProgress": 0, "completed": 0, "overdue": 0 },
        "towers": [
          { "towerId": "698dbd0261a8e6df665e0900", "name": "Tower A", "code": "HHA", "totalUnits": 50, "status": "under_construction", "constructionProgress": 55, "financials": { "constructionCost": { "budgeted": 450000000, "actual": 247500000 }, "revenueTarget": 750000000, "revenueAchieved": 225000000 } },
          { "towerId": "698dbd0261a8e6df665e0901", "name": "Tower B", "code": "HHB", "totalUnits": 50, "status": "under_construction", "constructionProgress": 40, "financials": { "constructionCost": { "budgeted": 480000000, "actual": 192000000 }, "revenueTarget": 800000000, "revenueAchieved": 160000000 } },
          { "towerId": "698dbd0261a8e6df665e0902", "name": "Tower C", "code": "HHC", "totalUnits": 40, "status": "planning", "constructionProgress": 0, "financials": { "constructionCost": { "budgeted": 300000000, "actual": 0 }, "revenueTarget": 500000000, "revenueAchieved": 0 } }
        ],
        "alerts": [
          { "type": "delayed_milestone", "severity": "critical", "message": "4 construction milestone(s) delayed" },
          { "type": "overdue_installments", "severity": "warning", "message": "1 installment(s) overdue totaling 35,31,200" },
          { "type": "low_revenue", "severity": "warning", "message": "Revenue achievement at 0.9% of target" }
        ]
      },
      {
        "projectId": "698dbd0261a8e6df665e08fc",
        "name": "Skyline Commercial Plaza",
        "type": "commercial",
        "status": "pre-launch",
        "launchDate": "2026-03-14T11:44:02.583Z",
        "expectedCompletionDate": "2028-07-31T11:44:02.583Z",
        "inventory": { "totalUnits": 10, "available": 10, "booked": 0, "sold": 0, "blocked": 0, "inventoryValue": 106000000, "occupancyRate": 0 },
        "revenue": { "targetRevenue": 1500000000, "actualRevenue": 0, "achievementRate": 0, "periodRevenue": 0, "periodSalesCount": 0, "totalCollected": 0, "totalOutstanding": 0, "overdueAmount": 0, "collectionEfficiency": 0 },
        "salesPipeline": { "totalLeads": 3, "qualifiedLeads": 2, "totalSales": 0, "periodSales": 0, "avgSalePrice": 0, "conversionRate": 0 },
        "construction": { "totalMilestones": 0, "completed": 0, "inProgress": 0, "delayed": 0, "overallProgress": 0, "costVariance": { "planned": 0, "actual": 0, "variancePercent": 0 } },
        "invoicing": { "totalInvoiced": 0, "totalPaid": 0, "overdueAmount": 0, "overdueCount": 0 },
        "channelPartner": { "salesViaCp": 0, "totalCommission": 0, "paidCommission": 0 },
        "tasks": { "total": 0, "open": 0, "inProgress": 0, "completed": 0, "overdue": 0 },
        "towers": [
          { "towerId": "698dbd0261a8e6df665e0905", "name": "Tower 1", "code": "SCP1", "totalUnits": 48, "status": "planning", "constructionProgress": 0, "financials": { "constructionCost": { "budgeted": 550000000, "actual": 0 }, "revenueTarget": 1000000000, "revenueAchieved": 0 } }
        ],
        "alerts": []
      }
    ],
    "comparison": {
      "bestRevenue": { "projectId": "698dbd0261a8e6df665e08f7", "name": "Greenfield Villas", "achievementRate": 2.5 },
      "bestSales": { "projectId": "698dbd0261a8e6df665e08f7", "name": "Greenfield Villas", "conversionRate": 20 },
      "bestConstruction": { "projectId": "698dbd0161a8e6df665e08ee", "name": "Horizon Heights", "overallProgress": 28.8 },
      "bestCollection": { "projectId": "698dbd0161a8e6df665e08ee", "name": "Horizon Heights", "collectionEfficiency": 76.7 }
    }
  },
  "metadata": {
    "period": 30,
    "dateRange": { "start": "2026-01-13T13:15:40.622Z", "end": "2026-02-12T13:15:40.622Z" },
    "generatedAt": "2026-02-12T13:15:40.935Z",
    "projectCount": 3,
    "sortedBy": "revenue"
  }
}
```

---

## Appendix: Quick Reference Card

### Endpoints
| Method | URL | Description |
|--------|-----|-------------|
| `GET` | `/api/leadership/overview` | Org-wide overview (8 sections) |
| `GET` | `/api/leadership/project-comparison` | Side-by-side project comparison |

### Auth
- Header: `Authorization: Bearer <JWT_TOKEN>`
- Permission: `dashboard:leadership`
- Roles with access: Organization Owner, Business Head, Project Director, Sales Head, Marketing Head, Finance Head

### Query Params
| Param | Both Endpoints | Default |
|-------|---------------|---------|
| `period` | Yes | `30` |
| `startDate` | Yes | _(none)_ |
| `endDate` | Yes | _(none)_ |
| `projectIds` | Comparison only | _(all)_ |
| `sortBy` | Comparison only | `revenue` |

### Data Notes
- All monetary values: INR (raw number, not formatted)
- All percentages: Pre-calculated (e.g. `39.5` = 39.5%)
- All dates: ISO 8601 strings
- Record objects may have missing keys — always default to `0` or `{}`
- Sections with errors include an `error: string` field alongside zeroed data
