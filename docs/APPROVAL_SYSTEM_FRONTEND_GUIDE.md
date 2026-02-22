# Centralized Approval System — Frontend Development Guide

> **Version**: 1.0
> **Backend Status**: Fully implemented and ready for integration
> **Last Updated**: February 2026

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Approval Types & Business Context](#2-approval-types--business-context)
3. [Universal Approval Flow](#3-universal-approval-flow)
4. [API Reference](#4-api-reference)
5. [Data Models & TypeScript Interfaces](#5-data-models--typescript-interfaces)
6. [Existing API Changes (Breaking)](#6-existing-api-changes-breaking)
7. [Notification Types & Real-Time Events](#7-notification-types--real-time-events)
8. [Permissions & Role-Based Visibility](#8-permissions--role-based-visibility)
9. [UI/UX Specifications by Screen](#9-uiux-specifications-by-screen)
10. [Discount Threshold Reference](#10-discount-threshold-reference)
11. [State Diagrams & Edge Cases](#11-state-diagrams--edge-cases)
12. [Integration Checklist](#12-integration-checklist)

---

## 1. System Overview

The approval system is a centralized engine that gates critical business actions behind configurable approval workflows. It integrates with:

- **Task System** — every approval auto-creates a task (category: `"Approval"`) in the approver's task list
- **Notification System** — real-time bell notifications for all approval lifecycle events
- **Socket.IO** — real-time updates (existing notification socket channel)

### Key Principles

- **Non-blocking for non-approval actions**: If a policy is disabled or the user's action doesn't exceed thresholds, the existing flow continues unchanged.
- **Pending state**: When approval is required, the entity (Sale, Unit, Invoice) enters a pending state until resolved.
- **One rejection = immediate rejection**: Unlike multi-approver systems where majority rules, a single rejection immediately rejects the entire request.
- **SLA-based auto-escalation**: If no action is taken within configured hours, the request auto-escalates to a higher authority.

---

## 2. Approval Types & Business Context

| # | Type Constant | Display Name | When It Triggers | Who Approves (Default) | SLA |
|---|---------------|-------------|-----------------|----------------------|-----|
| 1 | `DISCOUNT_APPROVAL` | Discount Approval | Discount % exceeds user's role-based limit during sale creation | Next higher role that can approve that % | 24h |
| 2 | `SALE_CANCELLATION` | Sale Cancellation | Any sale cancellation request | Sales Head (L3) or above | 48h |
| 3 | `PRICE_OVERRIDE` | Price Override | Unit price changed >10% from base price | Project Director (L2) or above | 24h |
| 4 | `REFUND_APPROVAL` | Refund Approval | Payment refund request | Finance team (amount-tiered) | 24h |
| 5 | `INSTALLMENT_MODIFICATION` | Installment Modification | Due date/amount/waiver changes | Finance Manager (L4) or above | 24h |
| 6 | `COMMISSION_PAYOUT` | Commission Payout | _(Disabled)_ — existing commission system handles this | N/A | N/A |
| 7 | `INVOICE_APPROVAL` | Invoice Approval | Invoice moves from draft/generated to sent | Finance Head (L3) or above | 24h |

---

## 3. Universal Approval Flow

```
User triggers action (e.g., creates sale with 12% discount)
     |
     v
Backend checks: checkApprovalRequired()
     |
     +-- NO approval needed --> Action proceeds normally (existing flow)
     |
     +-- YES approval needed:
           |
           v
     ApprovalRequest created (status: "pending")
     Original entity enters pending state:
       - Sale --> "Pending Approval"
       - Unit price change --> deferred (not applied)
       - Invoice --> approvalWorkflow.approvalStatus = "pending"
           |
           v
     Task auto-created (category: "Approval", trigger: "pending_approval")
     Notifications sent to all approvers
           |
           v
     API response includes: { pendingApproval: true, ... }
           |
           v
     Approver sees the request in:
       - Approval Dashboard (/approvals)
       - Task List (category: Approval)
       - Notification bell icon
           |
           +-- APPROVE --> Entity proceeds (Sale: Booked, Unit: sold, etc.)
           |                Requester notified. Task completed.
           |
           +-- REJECT  --> Entity reverted (Pending Sale deleted, Unit: available)
           |                Requester notified with reason. Task completed.
           |
           +-- CANCEL  --> Only the original requester can cancel their own request.
           |                Entity reverted. Task completed.
           |
           +-- NO ACTION (SLA breached) --> Auto-escalation:
                 - Escalation target added as new approver
                 - Task reassigned to escalation target
                 - Urgent notification sent
                 - Up to 3 escalation levels (24h/48h/72h by default)
```

---

## 4. API Reference

**Base URL**: `/api/approvals`
**Authentication**: All endpoints require `Authorization: Bearer <token>` header.

---

### 4.1 Dashboard

```
GET /api/approvals/dashboard
Permission: approvals:view
```

**Response**:
```json
{
  "pendingForMe": [
    {
      "_id": "665abc...",
      "requestNumber": "APR-0001",
      "approvalType": "DISCOUNT_APPROVAL",
      "status": "pending",
      "priority": "High",
      "title": "Discount Approval: 8% on Unit A-501",
      "description": "Sales Executive Rohan applied 8% discount...",
      "entityType": "Sale",
      "entityId": "665def...",
      "requestedBy": {
        "_id": "664aaa...",
        "firstName": "Rohan",
        "lastName": "Singh"
      },
      "project": {
        "_id": "664bbb...",
        "name": "Skyline Heights"
      },
      "requestData": {
        "discountPercentage": 8,
        "discountAmount": 160000,
        "salePrice": 1840000,
        "originalPrice": 2000000,
        "unitId": "665ccc..."
      },
      "slaDeadline": "2026-02-23T10:30:00.000Z",
      "createdAt": "2026-02-22T10:30:00.000Z",
      "isOverdue": false,
      "hoursUntilDeadline": 18
    }
  ],
  "myRequests": [
    {
      "_id": "665xyz...",
      "requestNumber": "APR-0003",
      "approvalType": "SALE_CANCELLATION",
      "status": "approved",
      "priority": "Medium",
      "title": "Cancel Sale for Unit B-202",
      "resolvedAt": "2026-02-21T14:00:00.000Z",
      "createdAt": "2026-02-20T09:00:00.000Z"
    }
  ],
  "recentlyResolved": [
    {
      "_id": "665pqr...",
      "requestNumber": "APR-0002",
      "approvalType": "PRICE_OVERRIDE",
      "status": "rejected",
      "resolvedBy": {
        "firstName": "Vikram",
        "lastName": "Mehta"
      },
      "resolvedAt": "2026-02-21T16:00:00.000Z"
    }
  ],
  "stats": [
    { "_id": { "type": "DISCOUNT_APPROVAL", "status": "pending" }, "count": 3 },
    { "_id": { "type": "DISCOUNT_APPROVAL", "status": "approved" }, "count": 12 },
    { "_id": { "type": "SALE_CANCELLATION", "status": "rejected" }, "count": 1 },
    { "_id": { "type": "INVOICE_APPROVAL", "status": "approved" }, "count": 8 }
  ]
}
```

**How to derive stats for display**:
```javascript
// Transform stats array into usable object
const statsByType = {};
stats.forEach(({ _id, count }) => {
  if (!statsByType[_id.type]) {
    statsByType[_id.type] = { pending: 0, approved: 0, rejected: 0, cancelled: 0 };
  }
  statsByType[_id.type][_id.status] = count;
});
// Result: { DISCOUNT_APPROVAL: { pending: 3, approved: 12, ... }, ... }
```

---

### 4.2 Pending Approvals (My Queue)

```
GET /api/approvals/pending
Permission: approvals:view
```

**Query Parameters**:
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `approvalType` | string | - | Filter by type: `DISCOUNT_APPROVAL`, `SALE_CANCELLATION`, etc. |
| `priority` | string | - | Filter by priority: `Critical`, `High`, `Medium`, `Low` |
| `page` | number | 1 | Page number |
| `limit` | number | 20 | Items per page |

**Response**:
```json
{
  "approvals": [
    {
      "_id": "665abc...",
      "requestNumber": "APR-0001",
      "approvalType": "DISCOUNT_APPROVAL",
      "status": "pending",
      "priority": "High",
      "title": "Discount Approval: 8% on Unit A-501",
      "requestedBy": {
        "_id": "664aaa...",
        "firstName": "Rohan",
        "lastName": "Singh",
        "email": "rohan@example.com"
      },
      "project": {
        "_id": "664bbb...",
        "name": "Skyline Heights"
      },
      "requestData": { ... },
      "slaDeadline": "2026-02-23T10:30:00.000Z",
      "currentEscalationLevel": 0,
      "createdAt": "2026-02-22T10:30:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 5,
    "totalPages": 1
  }
}
```

**Sort order**: Critical priority first, then oldest first (FIFO within same priority).

---

### 4.3 All Requests (Admin View)

```
GET /api/approvals
Permission: approvals:view_all
```

**Query Parameters**:
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `status` | string | - | `pending`, `approved`, `rejected`, `cancelled`, `expired` |
| `approvalType` | string | - | Any of the 7 approval type constants |
| `requestedBy` | ObjectId | - | Filter by requester user ID |
| `page` | number | 1 | Page number |
| `limit` | number | 20 | Items per page |

**Response**: Same shape as pending approvals, but includes `resolvedBy` populated.

---

### 4.4 Single Request (Detail View)

```
GET /api/approvals/:id
Permission: approvals:view
```

**Response** (fully populated):
```json
{
  "_id": "665abc...",
  "requestNumber": "APR-0001",
  "organization": "664org...",
  "project": {
    "_id": "664bbb...",
    "name": "Skyline Heights"
  },
  "approvalType": "DISCOUNT_APPROVAL",
  "status": "pending",
  "priority": "High",
  "entityType": "Sale",
  "entityId": "665def...",
  "title": "Discount Approval: 8% on Unit A-501",
  "description": "Sales Executive Rohan Singh applied 8% discount on Unit A-501 in Skyline Heights (exceeds 2% limit for Sales Executive role)",
  "requestedBy": {
    "_id": "664aaa...",
    "firstName": "Rohan",
    "lastName": "Singh",
    "email": "rohan@example.com"
  },
  "approvalPolicy": {
    "_id": "664pol...",
    "displayName": "Discount Approval",
    "approvalType": "DISCOUNT_APPROVAL",
    "slaHours": 24
  },
  "requestData": {
    "discountPercentage": 8,
    "discountAmount": 160000,
    "salePrice": 1840000,
    "originalPrice": 2000000,
    "unitId": "665ccc...",
    "userRoleLevel": 5,
    "userRoleSlug": "sales-executive"
  },
  "approverActions": [
    {
      "approver": {
        "_id": "664bbb...",
        "firstName": "Priya",
        "lastName": "Nair",
        "email": "priya@example.com"
      },
      "action": "pending",
      "comment": null,
      "actionAt": null
    },
    {
      "approver": {
        "_id": "664ccc...",
        "firstName": "Vikram",
        "lastName": "Mehta",
        "email": "vikram@example.com"
      },
      "action": "pending",
      "comment": null,
      "actionAt": null
    }
  ],
  "requiredApprovals": 1,
  "currentApprovalCount": 0,
  "linkedTask": {
    "_id": "665task...",
    "taskNumber": "TASK-042",
    "status": "Open"
  },
  "slaDeadline": "2026-02-23T10:30:00.000Z",
  "currentEscalationLevel": 0,
  "escalationHistory": [],
  "resolvedBy": null,
  "resolvedAt": null,
  "resolutionComment": null,
  "auditTrail": [
    {
      "action": "created",
      "performedBy": "664aaa...",
      "performedAt": "2026-02-22T10:30:00.000Z",
      "details": {
        "approvalType": "DISCOUNT_APPROVAL",
        "entityType": "Sale"
      }
    }
  ],
  "createdAt": "2026-02-22T10:30:00.000Z",
  "updatedAt": "2026-02-22T10:30:00.000Z",
  "isOverdue": false,
  "hoursUntilDeadline": 18
}
```

---

### 4.5 Approve Request

```
POST /api/approvals/:id/approve
Permission: approvals:approve
```

**Request Body**:
```json
{
  "comment": "Approved — customer is a bulk buyer, discount justified."
}
```
`comment` is optional for approvals.

**Response**:
```json
{
  "message": "Approval recorded successfully",
  "approval": {
    "_id": "665abc...",
    "status": "approved",
    "currentApprovalCount": 1,
    "resolvedBy": "664bbb...",
    "resolvedAt": "2026-02-22T14:00:00.000Z",
    "resolutionComment": "Approved — customer is a bulk buyer, discount justified.",
    "approverActions": [
      {
        "approver": "664bbb...",
        "action": "approved",
        "comment": "Approved — customer is a bulk buyer, discount justified.",
        "actionAt": "2026-02-22T14:00:00.000Z"
      }
    ]
  }
}
```

**What happens on approval** (by type):

| Type | Backend Side Effect |
|------|-------------------|
| `DISCOUNT_APPROVAL` | Sale status: `"Pending Approval"` → `"Booked"`, Unit: `"blocked"` → `"sold"`, Lead: → `"Booked"`, Payment plan auto-created |
| `SALE_CANCELLATION` | Sale: → `"Cancelled"`, Unit: → `"available"`, Lead: → `"Active"` |
| `PRICE_OVERRIDE` | Unit `currentPrice` updated to `requestData.proposedPrice` |
| `REFUND_APPROVAL` | Payment transaction `requiresApproval` flag cleared |
| `INSTALLMENT_MODIFICATION` | Installment amount/date/waiver applied |
| `INVOICE_APPROVAL` | Invoice `approvalWorkflow.approvalStatus` → `"approved"` |

---

### 4.6 Reject Request

```
POST /api/approvals/:id/reject
Permission: approvals:reject
```

**Request Body**:
```json
{
  "comment": "8% discount is too high for this unit type. Maximum 5% allowed per policy."
}
```
`comment` is **REQUIRED** for rejections. Returns `400` if empty.

**Response**:
```json
{
  "message": "Request rejected",
  "approval": {
    "_id": "665abc...",
    "status": "rejected",
    "resolvedBy": "664bbb...",
    "resolvedAt": "2026-02-22T14:00:00.000Z",
    "resolutionComment": "8% discount is too high for this unit type. Maximum 5% allowed per policy."
  }
}
```

**What happens on rejection** (by type):

| Type | Backend Side Effect |
|------|-------------------|
| `DISCOUNT_APPROVAL` | Pending sale **DELETED**, Unit: `"blocked"` → `"available"` |
| `SALE_CANCELLATION` | Nothing — sale stays as-is (cancellation denied) |
| `PRICE_OVERRIDE` | Nothing — price stays unchanged |
| `REFUND_APPROVAL` | Nothing — payment unchanged |
| `INSTALLMENT_MODIFICATION` | Nothing — installment unchanged |
| `INVOICE_APPROVAL` | Invoice `approvalWorkflow.approvalStatus` → `"rejected"`, `rejectionReason` set |

---

### 4.7 Cancel Request

```
POST /api/approvals/:id/cancel
Permission: approvals:view (only the original requester can cancel)
```

**Request Body**:
```json
{
  "reason": "Customer changed their mind about the discount."
}
```
`reason` is optional (defaults to "Cancelled by requester").

**Response**:
```json
{
  "message": "Approval request cancelled",
  "approval": {
    "_id": "665abc...",
    "status": "cancelled"
  }
}
```

**Error cases**:
- `400`: Request is not in `pending` status
- `403`: User is not the original requester

---

### 4.8 Policy Management

#### List Policies
```
GET /api/approvals/policies
Permission: approvals:manage_policies
```

**Response**: Array of policy objects
```json
[
  {
    "_id": "664pol...",
    "approvalType": "DISCOUNT_APPROVAL",
    "displayName": "Discount Approval",
    "description": "Controls discount limits per role...",
    "isEnabled": true,
    "discountThresholds": [
      { "roleSlug": "sales-executive", "roleLevel": 5, "maxDiscountPercentage": 2 },
      { "roleSlug": "sales-manager", "roleLevel": 4, "maxDiscountPercentage": 5 },
      { "roleSlug": "sales-head", "roleLevel": 3, "maxDiscountPercentage": 10 },
      { "roleSlug": "project-director", "roleLevel": 2, "maxDiscountPercentage": 15 },
      { "roleSlug": "business-head", "roleLevel": 1, "maxDiscountPercentage": 25 },
      { "roleSlug": "organization-owner", "roleLevel": 0, "maxDiscountPercentage": 100 }
    ],
    "priceOverrideThresholdPercent": 10,
    "amountThresholds": [],
    "alwaysRequire": false,
    "approverRules": [
      { "roleSlug": "sales-head", "roleLevel": 3, "assignmentMode": "hierarchy" }
    ],
    "requiredApprovals": 1,
    "slaHours": 24,
    "escalationConfig": {
      "enabled": true,
      "level1AfterHours": 24,
      "level2AfterHours": 48,
      "level3AfterHours": 72
    },
    "project": null,
    "createdAt": "2026-02-20T00:00:00.000Z"
  }
]
```

#### Get Single Policy
```
GET /api/approvals/policies/:id
Permission: approvals:manage_policies
```

#### Create Policy
```
POST /api/approvals/policies
Permission: approvals:manage_policies
```

**Request Body**: Any valid policy fields. `organization` and `createdBy` are auto-set from auth.

#### Update Policy
```
PUT /api/approvals/policies/:id
Permission: approvals:manage_policies
```

**Allowed update fields**:
```
isEnabled, displayName, description, discountThresholds,
priceOverrideThresholdPercent, amountThresholds, alwaysRequire,
approverRules, requiredApprovals, slaHours, escalationConfig
```

---

## 5. Data Models & TypeScript Interfaces

```typescript
// ─── Enums & Constants ─────────────────────────────────────

type ApprovalType =
  | 'DISCOUNT_APPROVAL'
  | 'SALE_CANCELLATION'
  | 'PRICE_OVERRIDE'
  | 'REFUND_APPROVAL'
  | 'INSTALLMENT_MODIFICATION'
  | 'COMMISSION_PAYOUT'
  | 'INVOICE_APPROVAL';

type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired';

type ApproverActionStatus = 'pending' | 'approved' | 'rejected';

type Priority = 'Critical' | 'High' | 'Medium' | 'Low';

type EntityType = 'Sale' | 'Unit' | 'PaymentTransaction' | 'Invoice' | 'Installment' | 'PartnerCommission';

type AssignmentMode = 'role' | 'specific' | 'hierarchy';

// ─── ApprovalRequest ───────────────────────────────────────

interface ApproverAction {
  approver: string | PopulatedUser; // ObjectId or populated
  action: ApproverActionStatus;
  comment?: string;
  actionAt?: string; // ISO date
}

interface EscalationEntry {
  level: number; // 1, 2, or 3
  escalatedTo: string | PopulatedUser;
  escalatedAt: string;
  reason?: string;
}

interface AuditEntry {
  action: 'created' | 'approved' | 'rejected' | 'cancelled' | 'escalated' | 'reassigned' | 'comment_added' | 'expired' | 'auto_approved';
  performedBy?: string; // userId (null for system actions)
  performedAt: string;
  details?: Record<string, any>;
  comment?: string;
}

interface RequestData {
  // DISCOUNT_APPROVAL
  discountPercentage?: number;
  discountAmount?: number;
  salePrice?: number;
  originalPrice?: number;
  unitId?: string;
  userRoleLevel?: number;
  userRoleSlug?: string;

  // PRICE_OVERRIDE
  currentPrice?: number;
  proposedPrice?: number;
  basePrice?: number;
  deviationPercentage?: number;

  // REFUND_APPROVAL
  refundAmount?: number;
  refundReason?: string;
  originalPaymentAmount?: number;

  // INSTALLMENT_MODIFICATION
  modificationType?: 'amount_change' | 'date_change' | 'waiver';
  originalValue?: any;
  proposedValue?: any;

  // SALE_CANCELLATION
  cancellationReason?: string;
  salePriceAtCancellation?: number;

  // COMMISSION_PAYOUT
  commissionAmount?: number;
  partnerName?: string;

  // INVOICE_APPROVAL
  invoiceAmount?: number;
  invoiceType?: string;
}

interface ApprovalRequest {
  _id: string;
  organization: string;
  project?: { _id: string; name: string } | null;
  requestNumber: string; // e.g., "APR-0001"
  sequenceNumber: number;

  approvalType: ApprovalType;
  status: ApprovalStatus;
  priority: Priority;

  entityType: EntityType;
  entityId: string;

  approvalPolicy: string | { _id: string; displayName: string; approvalType: string; slaHours: number };

  title: string;
  description?: string;
  requestedBy: string | PopulatedUser;

  requestData: RequestData;

  approverActions: ApproverAction[];
  requiredApprovals: number;
  currentApprovalCount: number;

  linkedTask?: { _id: string; taskNumber: string; status: string } | null;

  slaDeadline?: string; // ISO date
  currentEscalationLevel: number; // 0-3
  escalationHistory: EscalationEntry[];

  resolvedBy?: PopulatedUser | null;
  resolvedAt?: string | null;
  resolutionComment?: string | null;

  auditTrail: AuditEntry[];

  createdAt: string;
  updatedAt: string;

  // Virtuals
  isOverdue: boolean;
  hoursUntilDeadline: number | null;
}

// ─── ApprovalPolicy ────────────────────────────────────────

interface DiscountThreshold {
  roleSlug: string;
  roleLevel: number;
  maxDiscountPercentage: number;
}

interface AmountThreshold {
  minAmount: number;
  maxAmount: number | null; // null = unlimited
  approverRoleSlug: string;
  approverRoleLevel: number;
}

interface ApproverRule {
  roleSlug: string;
  roleLevel: number;
  specificUsers?: string[];
  assignmentMode: AssignmentMode;
}

interface EscalationConfig {
  enabled: boolean;
  level1AfterHours: number;
  level2AfterHours: number;
  level3AfterHours: number;
}

interface ApprovalPolicy {
  _id: string;
  organization: string;
  project?: { _id: string; name: string } | null;
  approvalType: ApprovalType;
  isEnabled: boolean;
  displayName: string;
  description?: string;

  discountThresholds: DiscountThreshold[];
  priceOverrideThresholdPercent: number;
  amountThresholds: AmountThreshold[];
  alwaysRequire: boolean;

  approverRules: ApproverRule[];
  requiredApprovals: number;

  slaHours: number;
  escalationConfig: EscalationConfig;

  createdBy: string;
  lastModifiedBy?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Dashboard ─────────────────────────────────────────────

interface ApprovalDashboard {
  pendingForMe: ApprovalRequest[];  // max 20
  myRequests: ApprovalRequest[];     // max 20
  recentlyResolved: ApprovalRequest[]; // max 10
  stats: Array<{
    _id: { type: ApprovalType; status: ApprovalStatus };
    count: number;
  }>;
}

// ─── Pagination ────────────────────────────────────────────

interface PaginatedResponse<T> {
  approvals: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ─── Populated User (common shape in responses) ────────────

interface PopulatedUser {
  _id: string;
  firstName: string;
  lastName: string;
  email?: string;
}
```

---

## 6. Existing API Changes (Breaking)

These are changes to **existing API responses** that your current frontend code needs to handle.

### 6.1 Sale Creation — `POST /api/sales`

**Previously**: Always returned the created sale with `status: "Booked"`.

**Now**: If the discount exceeds the user's role-based limit, returns:

```json
{
  "success": true,
  "pendingApproval": true,
  "data": {
    "_id": "665sale...",
    "status": "Pending Approval",
    "salePrice": 1840000,
    "discountAmount": 160000,
    "unit": { ... },
    "lead": { ... }
  },
  "approvalRequest": "APR-0001",
  "message": "Sale created pending discount approval (8.0% exceeds your limit)"
}
```

**Frontend action required**:
- Check for `pendingApproval === true` in the response
- Show a **success-with-info** state (not an error): "Sale submitted for approval"
- Display the `message` to the user
- Optionally show a link to the approval request using the `approvalRequest` number
- The sale WILL appear in the sales list with status `"Pending Approval"` — style it differently (e.g., amber badge, dotted border, or muted row)
- The unit will show as `"blocked"` (not `"sold"`) — show a lock icon or "Pending" label

### 6.2 Sale Cancellation — `POST /api/sales/:id/cancel`

**Previously**: Immediately cancelled the sale.

**Now**: If SALE_CANCELLATION policy is enabled (it is by default), returns:

```json
{
  "success": true,
  "pendingApproval": true,
  "message": "Cancellation request submitted for approval"
}
```

**Frontend action required**:
- Check for `pendingApproval === true`
- Show an info toast: "Cancellation request submitted. You'll be notified when it's reviewed."
- The sale remains in its current status until approved

### 6.3 Unit Price Update — `PUT /api/units/:id`

**Previously**: Price change applied immediately.

**Now**: If price deviation exceeds threshold (default 10%), returns:

```json
{
  "success": true,
  "pendingApproval": true,
  "data": { /* unit without the price change */ },
  "message": "Price change submitted for approval (15.2% deviation exceeds threshold)"
}
```

**Note**: If other fields were included in the update (e.g., `unitNumber`, `floor`), those are still applied. Only `currentPrice` is held back.

### 6.4 Invoice Status Update — `PUT /api/invoices/:id`

**Previously**: Invoice could be moved to `"sent"` immediately.

**Now**: If INVOICE_APPROVAL policy is enabled and status changes to `"sent"`, returns:

```json
{
  "success": true,
  "pendingApproval": true,
  "data": { /* invoice with approvalWorkflow.approvalStatus = "pending" */ },
  "message": "Invoice submitted for approval before sending"
}
```

### 6.5 Sale Status Enum Change

The `Sale.status` field now includes a new value: `"Pending Approval"`.

**Full enum**: `["Pending Approval", "Booked", "Agreement Signed", "Registered", "Completed", "Cancelled"]`

Update any status filters, badge colors, or dropdown options in your sales UI.

---

## 7. Notification Types & Real-Time Events

### 7.1 New Notification Types

| Type | Recipient | Title Format | Message Format |
|------|-----------|-------------|----------------|
| `approval_requested` | Each approver | `Approval Required: APR-0001` | `{requesterName} submitted: "{title}"` |
| `approval_approved` | Requester | `Approved: APR-0001` | `{approverName} approved your request: "{title}"` |
| `approval_rejected` | Requester | `Rejected: APR-0001` | `{rejectorName} rejected your request: "{title}". Reason: {reason}` |
| `approval_escalated` | Escalation target | `Escalated (L{level}): APR-0001` | `Approval request "{title}" has been escalated to you — SLA breached` |
| `approval_cancelled` | Approvers | _(sent when requester cancels)_ | — |

### 7.2 Notification `actionUrl` Values

All approval notifications include an `actionUrl` field:
```
/approvals/{approvalRequestId}
```

Use this to navigate the user directly to the approval detail view when they click the notification.

### 7.3 Notification `relatedEntity`

```json
{
  "entityType": "ApprovalRequest",
  "entityId": "665abc..."
}
```

### 7.4 Socket.IO Events

The approval system uses the existing notification socket mechanism. When a notification is created, the existing `notification:new` event is emitted. No new socket events are needed — just listen for the notification types above.

---

## 8. Permissions & Role-Based Visibility

### 8.1 Permission Matrix

| Permission | Slug | Levels 0-2 | Level 3 (Heads) | Level 4 (Managers) | Levels 5-6 (Executives/Agents) |
|-----------|------|-----------|-----------------|-------------------|-------------------------------|
| View own requests & pending | `approvals:view` | Yes | Yes | Yes | Yes |
| View all org requests | `approvals:view_all` | Yes | Yes | No | No |
| Approve requests | `approvals:approve` | Yes | Yes | Yes | No |
| Reject requests | `approvals:reject` | Yes | Yes | Yes | No |
| Manage policies (CRUD) | `approvals:manage_policies` | Yes | No | No | No |

### 8.2 UI Visibility Rules

| UI Element | Show When |
|-----------|-----------|
| "Approvals" nav item | User has `approvals:view` (everyone) |
| "Pending Approvals" tab with action buttons | User has `approvals:approve` OR `approvals:reject` |
| "All Requests" tab | User has `approvals:view_all` |
| "My Requests" tab | Always (within approvals:view) |
| "Settings / Policies" tab | User has `approvals:manage_policies` |
| Approve button | User has `approvals:approve` AND is listed in `approverActions` AND their action is `"pending"` |
| Reject button | User has `approvals:reject` AND is listed in `approverActions` AND their action is `"pending"` |
| Cancel button | User is the `requestedBy` AND status is `"pending"` |

### 8.3 Checking if Current User Can Act

```javascript
// On the detail view, check if the logged-in user can approve/reject
const canAct = approval.approverActions.some(
  (a) => a.approver._id === currentUser._id && a.action === 'pending'
);

// Check if the user can cancel (only the requester)
const canCancel = approval.requestedBy._id === currentUser._id && approval.status === 'pending';
```

---

## 9. UI/UX Specifications by Screen

### 9.1 Approvals Dashboard (`/approvals`)

**Layout**: Card-based dashboard with 3-4 sections.

**Section A: Summary Cards (top row)**
```
+------------------+  +------------------+  +------------------+  +------------------+
| Pending For Me   |  | My Requests      |  | Approved (30d)   |  | Rejected (30d)   |
|       5          |  |       12         |  |       28         |  |       3          |
+------------------+  +------------------+  +------------------+  +------------------+
```
- Derive counts from `stats` array
- "Pending For Me" count = `pendingForMe.length`
- Click on any card to scroll to / filter that section

**Section B: Pending For Me (main action area)**
- Table or card list of `pendingForMe` items
- Columns: Request #, Type (with icon/badge), Title, Requested By, Priority (color-coded), SLA Countdown, Actions
- SLA Countdown: Show time remaining as "18h left" (green), "2h left" (amber), "OVERDUE" (red pulse)
- Priority badges: Critical (red), High (orange), Medium (blue), Low (gray)
- Actions column: [Approve] [Reject] buttons (inline) or click row to open detail
- Empty state: "No pending approvals. You're all caught up!"

**Section C: My Requests**
- Table of `myRequests` items (requests the current user submitted)
- Columns: Request #, Type, Title, Status (badge), Created, Resolved
- Status badges: Pending (amber), Approved (green), Rejected (red), Cancelled (gray)
- Allow cancel action on pending items (only requester can cancel)

**Section D: Recent Activity**
- `recentlyResolved` list — show as a timeline or compact list
- "{resolvedBy.name} {approved/rejected} {requestNumber} — {timeAgo}"

---

### 9.2 Approval Detail View (`/approvals/:id`)

**Header**:
```
APR-0001 | Discount Approval | Priority: High
Status: PENDING                           SLA: 18h remaining
Requested by: Rohan Singh                 Created: Feb 22, 2026 10:30 AM
```

**Action Buttons** (shown only if user `canAct`):
```
[✓ Approve]  [✗ Reject]
```
- Approve: Optional comment textarea, then confirm
- Reject: **Required** comment textarea (explain why), then confirm
- Show confirmation dialog before both actions

**Request Details Card**:
```
Type-specific details based on approvalType:

DISCOUNT_APPROVAL:
  ┌─────────────────────────────────────────────┐
  │ Original Price:     ₹20,00,000              │
  │ Discount:           8.0% (₹1,60,000)        │
  │ Sale Price:         ₹18,40,000              │
  │ Unit:               A-501 (link to unit)     │
  │ Requester's Limit:  2% (Sales Executive)     │
  └─────────────────────────────────────────────┘

SALE_CANCELLATION:
  ┌─────────────────────────────────────────────┐
  │ Sale Value:         ₹18,40,000              │
  │ Reason:             Customer unable to...    │
  └─────────────────────────────────────────────┘

PRICE_OVERRIDE:
  ┌─────────────────────────────────────────────┐
  │ Base Price:         ₹20,00,000              │
  │ Current Price:      ₹20,00,000              │
  │ Proposed Price:     ₹17,00,000              │
  │ Deviation:          15.0%                    │
  │ Threshold:          10%                      │
  └─────────────────────────────────────────────┘

REFUND_APPROVAL:
  ┌─────────────────────────────────────────────┐
  │ Refund Amount:      ₹2,50,000              │
  │ Original Payment:   ₹5,00,000              │
  │ Reason:             Partial cancellation     │
  └─────────────────────────────────────────────┘

INSTALLMENT_MODIFICATION:
  ┌─────────────────────────────────────────────┐
  │ Modification Type:  Date Change              │
  │ Original Value:     Mar 15, 2026            │
  │ Proposed Value:     Apr 30, 2026            │
  └─────────────────────────────────────────────┘

INVOICE_APPROVAL:
  ┌─────────────────────────────────────────────┐
  │ Invoice Amount:     ₹18,40,000              │
  │ Invoice Type:       Booking Invoice          │
  └─────────────────────────────────────────────┘
```

**Approvers Section**:
```
Approvers (1 required):
┌──────────────────┬──────────┬──────────────────────────┐
│ Priya Nair       │ Pending  │ —                        │
│ Vikram Mehta     │ Pending  │ —                        │
└──────────────────┴──────────┴──────────────────────────┘
```
After action:
```
┌──────────────────┬──────────┬──────────────────────────┐
│ Priya Nair       │ Approved │ Feb 22, 2:00 PM          │
│                  │          │ "Bulk buyer, justified"  │
└──────────────────┴──────────┴──────────────────────────┘
```

**Escalation History** (shown if `escalationHistory.length > 0`):
```
Escalation History:
  L1 → Vikram Mehta (Feb 23, 10:30 AM) — SLA breached: 24h since creation
  L2 → Ananya Sharma (Feb 24, 10:30 AM) — SLA breached: 48h since creation
```

**Audit Trail** (collapsible, at bottom):
```
Activity Log:
  Feb 22, 10:30 AM — Created by Rohan Singh
  Feb 22, 2:00 PM  — Approved by Priya Nair
```

**Linked Task**:
Show a link: "Task: TASK-042 (Open)" — clicking navigates to `/tasks/:taskId`.

**Cancel Button** (shown only if requester and status is pending):
```
[Cancel Request]
```

---

### 9.3 Policy Management (`/approvals/policies`)

**Only visible to users with `approvals:manage_policies`** (Levels 0-2: Owner, Business Head, Project Director).

**List View**:
```
┌─────────────────────────────┬──────────┬──────────┬──────────┐
│ Policy Name                 │ Type     │ Status   │ SLA      │
├─────────────────────────────┼──────────┼──────────┼──────────┤
│ Discount Approval           │ Discount │ Enabled  │ 24h      │
│ Sale Cancellation Approval  │ Cancel   │ Enabled  │ 48h      │
│ Price Override Approval     │ Price    │ Enabled  │ 24h      │
│ Refund Approval             │ Refund   │ Enabled  │ 24h      │
│ Installment Modification    │ Instmt   │ Enabled  │ 24h      │
│ Commission Payout Approval  │ Comm     │ Disabled │ 48h      │
│ Invoice Approval            │ Invoice  │ Enabled  │ 24h      │
└─────────────────────────────┴──────────┴──────────┴──────────┘
```

**Edit View** (per policy):

**For DISCOUNT_APPROVAL**, show an editable table of thresholds:
```
Role-Based Discount Limits:
┌───────────────────────────┬───────┬─────────────────────┐
│ Role                      │ Level │ Max Discount %      │
├───────────────────────────┼───────┼─────────────────────┤
│ Channel Partner Agent     │ 6     │ [  0 ]%             │
│ Sales Executive           │ 5     │ [  2 ]%             │
│ Channel Partner Admin     │ 5     │ [  2 ]%             │
│ Sales Manager             │ 4     │ [  5 ]%             │
│ Channel Partner Manager   │ 4     │ [  5 ]%             │
│ Finance Manager           │ 4     │ [  5 ]%             │
│ Sales Head                │ 3     │ [ 10 ]%             │
│ Finance Head              │ 3     │ [ 10 ]%             │
│ Marketing Head            │ 3     │ [ 10 ]%             │
│ Project Director          │ 2     │ [ 15 ]%             │
│ Business Head             │ 1     │ [ 25 ]%             │
│ Organization Owner        │ 0     │ [ 100 ]%            │
└───────────────────────────┴───────┴─────────────────────┘
```

**For PRICE_OVERRIDE**, show:
```
Threshold: [ 10 ]% deviation from base price triggers approval
```

**For REFUND_APPROVAL**, show editable amount brackets:
```
Amount Brackets:
┌──────────────┬──────────────┬───────────────────┐
│ Min Amount   │ Max Amount   │ Approver Role     │
├──────────────┼──────────────┼───────────────────┤
│ ₹0           │ ₹1,00,000   │ Finance Manager   │
│ ₹1,00,001    │ ₹5,00,000   │ Finance Head      │
│ ₹5,00,001    │ Unlimited    │ Business Head     │
└──────────────┴──────────────┴───────────────────┘
```

**Common fields** for all policies:
```
Enabled:               [Toggle switch]
SLA Hours:             [ 24 ] hours
Required Approvals:    [ 1  ]

Escalation:
  Enabled:             [Toggle switch]
  Level 1 after:       [ 24 ] hours
  Level 2 after:       [ 48 ] hours
  Level 3 after:       [ 72 ] hours
```

---

### 9.4 Sales List — Status Badge Updates

Add handling for the new `"Pending Approval"` status:

| Status | Badge Color | Icon |
|--------|------------|------|
| Pending Approval | Amber/Yellow | Clock or hourglass |
| Booked | Green | Check |
| Agreement Signed | Blue | Document |
| Registered | Purple | Stamp |
| Completed | Dark Green | Double check |
| Cancelled | Red | X |

---

### 9.5 Navigation Integration

Add "Approvals" to the main sidebar navigation:

```
Sidebar:
  ...
  Tasks
  Approvals  ← NEW (show pending count badge)
  ...
```

The pending count badge shows the number of `pendingForMe` items. Fetch this from the dashboard API.

---

## 10. Discount Threshold Reference

This table shows the default self-approval limits. If the discount exceeds the user's limit, approval is routed to the lowest-level role that can approve it.

| Role | Level | Can Self-Approve Up To | Exceeding Goes To |
|------|-------|----------------------|-------------------|
| Channel Partner Agent | 6 | 0% (no discount) | Sales Manager (L4) |
| Sales Executive | 5 | 2% | Sales Manager (L4) for ≤5%, Sales Head (L3) for ≤10%, etc. |
| Channel Partner Admin | 5 | 2% | Same as above |
| Sales Manager | 4 | 5% | Sales Head (L3) |
| Channel Partner Manager | 4 | 5% | Sales Head (L3) |
| Finance Manager | 4 | 5% | Sales Head (L3) |
| Sales Head | 3 | 10% | Project Director (L2) |
| Finance Head | 3 | 10% | Project Director (L2) |
| Marketing Head | 3 | 10% | Project Director (L2) |
| Project Director | 2 | 15% | Business Head (L1) |
| Business Head | 1 | 25% | Organization Owner (L0) |
| Organization Owner | 0 | 100% | No approval needed |

**Example scenarios**:
1. Sales Executive (L5) offers 3% discount → exceeds 2% limit → approval goes to Sales Manager (L4, can approve up to 5%)
2. Sales Executive (L5) offers 8% discount → exceeds 2% limit → Sales Manager (5%) can't approve it either → goes to Sales Head (L3, up to 10%)
3. Sales Head (L3) offers 12% discount → exceeds 10% limit → goes to Project Director (L2, up to 15%)
4. Organization Owner offers 50% discount → no approval needed (unlimited)

---

## 11. State Diagrams & Edge Cases

### 11.1 Approval Request Status Transitions

```
                              ┌─────────────┐
                              │   pending    │
                              └──────┬───┬──┘
                                     │   │
                        ┌────────────┘   └────────────┐
                        │                             │
                        v                             v
                  ┌──────────┐                 ┌───────────┐
                  │ approved │                 │ rejected  │
                  └──────────┘                 └───────────┘

                        ^
                        │ (SLA breach)
                  ┌──────────┐
                  │escalated │  (adds new approver, stays "pending")
                  └──────────┘

        ┌──────────┐
        │cancelled │  (only by requester)
        └──────────┘
```

Note: Escalation does NOT change the status — it stays `"pending"` but adds new approvers and sends notifications.

### 11.2 Sale Status with Approval Flow

```
                ┌──────────────────┐
                │ Pending Approval │  (discount > limit)
                └────────┬─────┬──┘
                         │     │
              Approved   │     │  Rejected
                         v     v
                  ┌────────┐  ┌──────────────┐
                  │ Booked │  │ (sale deleted) │
                  └────┬───┘  └──────────────┘
                       │
                       v
              ┌─────────────────┐
              │ Agreement Signed │
              └────────┬────────┘
                       v
              ┌──────────────┐
              │  Registered  │
              └──────┬───────┘
                     v
              ┌─────────────┐
              │  Completed  │
              └─────────────┘
```

### 11.3 Edge Cases

| Scenario | What Happens |
|----------|-------------|
| User creates sale with 0% discount | No approval needed — normal flow |
| User creates sale with discount but no policy exists | No approval needed — normal flow |
| Policy is disabled (`isEnabled: false`) | No approval needed — normal flow |
| User tries to approve their own request | Backend rejects: requester is excluded from approver list |
| User tries to approve when they already acted | Backend returns error: "You have already acted on this request" |
| User tries to reject without a comment | Backend returns 400: "Rejection reason is required" |
| Non-requester tries to cancel a request | Backend returns error: "Only the requester can cancel this request" |
| Request is already approved/rejected, user tries to act | Backend returns error: "Cannot process action on request with status: approved" |
| Multiple approvers for single-approval request | First person to approve resolves it. Other approvers see it as resolved. |
| Sale pending approval, same unit booked again | Prevented by existing unit uniqueness constraint on Sale model |
| Pending sale's unit shown in available units list | Unit status is `"blocked"`, not `"available"` — filter accordingly |
| Discount approval rejected | Pending sale is **deleted** (not just status change), unit goes back to `"available"` |

---

## 12. Integration Checklist

Use this checklist to track frontend implementation progress.

### Phase 1: Handle Existing API Changes
- [ ] **Sale Creation**: Handle `pendingApproval: true` response — show info state instead of success
- [ ] **Sale Cancellation**: Handle `pendingApproval: true` response — show info toast
- [ ] **Unit Price Update**: Handle `pendingApproval: true` response — show info toast
- [ ] **Invoice Send**: Handle `pendingApproval: true` response — show info state
- [ ] **Sale Status Badge**: Add `"Pending Approval"` status with amber styling
- [ ] **Unit Status**: Handle `"blocked"` status display (for units pending discount approval)
- [ ] **Sale List Filters**: Add `"Pending Approval"` to status filter dropdown

### Phase 2: Approval Dashboard
- [ ] Add "Approvals" to sidebar navigation with pending count badge
- [ ] Build dashboard page with summary cards
- [ ] Build "Pending For Me" table/list with approve/reject inline actions
- [ ] Build "My Requests" table with status badges
- [ ] Build "Recent Activity" timeline/list
- [ ] Implement type filter and priority filter
- [ ] Implement pagination

### Phase 3: Approval Detail View
- [ ] Build detail view layout (header, status, SLA countdown)
- [ ] Build type-specific request details cards (switch by `approvalType`)
- [ ] Build approver actions list with status indicators
- [ ] Build approve modal with optional comment
- [ ] Build reject modal with required comment (validate non-empty)
- [ ] Build cancel button (shown only to requester on pending requests)
- [ ] Build escalation history section
- [ ] Build audit trail section (collapsible)
- [ ] Link to related task (TASK-XXX)
- [ ] Link to related entity (Sale, Unit, Invoice, etc.)

### Phase 4: Notifications & Real-Time
- [ ] Handle new notification types in notification bell/dropdown
- [ ] Render `actionUrl` → navigate to `/approvals/:id` on click
- [ ] Show approval notification icons (different from other notification types)
- [ ] Update pending count badge in real-time when notification arrives

### Phase 5: Policy Management (Admin)
- [ ] Build policy list view (7 policies, toggle enabled/disabled)
- [ ] Build policy edit view:
  - [ ] DISCOUNT_APPROVAL: editable threshold table
  - [ ] PRICE_OVERRIDE: threshold percentage input
  - [ ] REFUND_APPROVAL: editable amount brackets table
  - [ ] All: SLA hours, required approvals, escalation config toggles & inputs
- [ ] Wire up `PUT /api/approvals/policies/:id` for saving changes
- [ ] Only show to users with `approvals:manage_policies` permission

### Phase 6: Polish
- [ ] SLA countdown timer (real-time, color-coded: green > amber > red)
- [ ] Empty states for all lists
- [ ] Loading skeletons for dashboard
- [ ] Error handling for all API calls
- [ ] Toast notifications for approve/reject/cancel actions
- [ ] Responsive layout for mobile/tablet
- [ ] Keyboard shortcuts (if applicable): Enter to approve, Esc to close

---

## Appendix A: Approval Type Icons & Colors (Suggested)

| Type | Suggested Icon | Suggested Color |
|------|---------------|----------------|
| DISCOUNT_APPROVAL | Percent (%) | Orange |
| SALE_CANCELLATION | X-Circle | Red |
| PRICE_OVERRIDE | TrendingUp | Purple |
| REFUND_APPROVAL | RotateCcw / Undo | Teal |
| INSTALLMENT_MODIFICATION | Calendar / Edit | Blue |
| COMMISSION_PAYOUT | DollarSign | Green |
| INVOICE_APPROVAL | FileText / Receipt | Indigo |

## Appendix B: Priority Badge Colors

| Priority | Color | Use Case |
|----------|-------|----------|
| Critical | Red (#EF4444) | Auto-set on escalation |
| High | Orange (#F97316) | Large discounts, high-value refunds |
| Medium | Blue (#3B82F6) | Default for most requests |
| Low | Gray (#6B7280) | Low-value items |

## Appendix C: Quick API Reference Card

```
GET    /api/approvals/dashboard              → ApprovalDashboard
GET    /api/approvals/pending?type&priority&page&limit → PaginatedResponse<ApprovalRequest>
GET    /api/approvals?status&type&requestedBy&page&limit → PaginatedResponse<ApprovalRequest>
GET    /api/approvals/:id                    → ApprovalRequest (fully populated)
POST   /api/approvals/:id/approve            → { message, approval }
POST   /api/approvals/:id/reject             → { message, approval }  (comment required)
POST   /api/approvals/:id/cancel             → { message, approval }

GET    /api/approvals/policies               → ApprovalPolicy[]
GET    /api/approvals/policies/:id           → ApprovalPolicy
POST   /api/approvals/policies               → ApprovalPolicy
PUT    /api/approvals/policies/:id           → ApprovalPolicy
```
