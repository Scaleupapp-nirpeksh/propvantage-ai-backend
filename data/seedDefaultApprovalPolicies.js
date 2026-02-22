// File: data/seedDefaultApprovalPolicies.js
// Description: Seeds default approval policies for a new organization.
// Called during org registration and by seedDemoData.js.

import ApprovalPolicy from '../models/approvalPolicyModel.js';

/**
 * Default approval policies for every organization.
 * Each policy can be customized per-org after creation.
 */
const DEFAULT_POLICIES = [
  // ─── 1. DISCOUNT APPROVAL ─────────────────────────────────────
  {
    approvalType: 'DISCOUNT_APPROVAL',
    displayName: 'Discount Approval',
    description:
      'Controls discount limits per role. When a user applies a discount exceeding their role-based limit, approval is required from a higher authority.',
    isEnabled: true,
    discountThresholds: [
      { roleSlug: 'channel-partner-agent', roleLevel: 6, maxDiscountPercentage: 0 },
      { roleSlug: 'sales-executive', roleLevel: 5, maxDiscountPercentage: 2 },
      { roleSlug: 'channel-partner-admin', roleLevel: 5, maxDiscountPercentage: 2 },
      { roleSlug: 'sales-manager', roleLevel: 4, maxDiscountPercentage: 5 },
      { roleSlug: 'channel-partner-manager', roleLevel: 4, maxDiscountPercentage: 5 },
      { roleSlug: 'finance-manager', roleLevel: 4, maxDiscountPercentage: 5 },
      { roleSlug: 'sales-head', roleLevel: 3, maxDiscountPercentage: 10 },
      { roleSlug: 'finance-head', roleLevel: 3, maxDiscountPercentage: 10 },
      { roleSlug: 'marketing-head', roleLevel: 3, maxDiscountPercentage: 10 },
      { roleSlug: 'project-director', roleLevel: 2, maxDiscountPercentage: 15 },
      { roleSlug: 'business-head', roleLevel: 1, maxDiscountPercentage: 25 },
      { roleSlug: 'organization-owner', roleLevel: 0, maxDiscountPercentage: 100 },
    ],
    approverRules: [
      { roleSlug: 'sales-head', roleLevel: 3, assignmentMode: 'hierarchy' },
    ],
    requiredApprovals: 1,
    slaHours: 24,
    escalationConfig: {
      enabled: true,
      level1AfterHours: 24,
      level2AfterHours: 48,
      level3AfterHours: 72,
    },
  },

  // ─── 2. SALE CANCELLATION ─────────────────────────────────────
  {
    approvalType: 'SALE_CANCELLATION',
    displayName: 'Sale Cancellation Approval',
    description:
      'Requires management approval before a booked sale can be cancelled. Protects revenue and ensures proper documentation.',
    isEnabled: true,
    alwaysRequire: true,
    approverRules: [
      { roleSlug: 'sales-head', roleLevel: 3, assignmentMode: 'hierarchy' },
    ],
    requiredApprovals: 1,
    slaHours: 48,
    escalationConfig: {
      enabled: true,
      level1AfterHours: 48,
      level2AfterHours: 72,
      level3AfterHours: 96,
    },
  },

  // ─── 3. PRICE OVERRIDE ────────────────────────────────────────
  {
    approvalType: 'PRICE_OVERRIDE',
    displayName: 'Price Override Approval',
    description:
      'Triggers when a unit price is changed by more than the configured threshold percentage from the base price.',
    isEnabled: true,
    priceOverrideThresholdPercent: 10,
    approverRules: [
      { roleSlug: 'project-director', roleLevel: 2, assignmentMode: 'hierarchy' },
    ],
    requiredApprovals: 1,
    slaHours: 24,
    escalationConfig: {
      enabled: true,
      level1AfterHours: 24,
      level2AfterHours: 48,
      level3AfterHours: 72,
    },
  },

  // ─── 4. REFUND APPROVAL ───────────────────────────────────────
  {
    approvalType: 'REFUND_APPROVAL',
    displayName: 'Refund Approval',
    description:
      'Requires finance approval for payment refunds. Tiered by amount brackets.',
    isEnabled: true,
    amountThresholds: [
      { minAmount: 0, maxAmount: 100000, approverRoleSlug: 'finance-manager', approverRoleLevel: 4 },
      { minAmount: 100001, maxAmount: 500000, approverRoleSlug: 'finance-head', approverRoleLevel: 3 },
      { minAmount: 500001, maxAmount: null, approverRoleSlug: 'business-head', approverRoleLevel: 1 },
    ],
    approverRules: [
      { roleSlug: 'finance-manager', roleLevel: 4, assignmentMode: 'hierarchy' },
    ],
    requiredApprovals: 1,
    slaHours: 24,
    escalationConfig: {
      enabled: true,
      level1AfterHours: 24,
      level2AfterHours: 48,
      level3AfterHours: 72,
    },
  },

  // ─── 5. INSTALLMENT MODIFICATION ──────────────────────────────
  {
    approvalType: 'INSTALLMENT_MODIFICATION',
    displayName: 'Installment Modification Approval',
    description:
      'Requires finance approval when modifying payment installment due dates, amounts, or applying waivers.',
    isEnabled: true,
    alwaysRequire: true,
    approverRules: [
      { roleSlug: 'finance-manager', roleLevel: 4, assignmentMode: 'hierarchy' },
    ],
    requiredApprovals: 1,
    slaHours: 24,
    escalationConfig: {
      enabled: true,
      level1AfterHours: 24,
      level2AfterHours: 48,
      level3AfterHours: 72,
    },
  },

  // ─── 6. COMMISSION PAYOUT (bridge only — existing system) ─────
  {
    approvalType: 'COMMISSION_PAYOUT',
    displayName: 'Commission Payout Approval',
    description:
      'Bridge policy for the existing commission approval system. Adds task and notification integration. The actual approval is handled by the commission workflow.',
    isEnabled: false, // Disabled — existing commission system handles it
    alwaysRequire: false,
    approverRules: [
      { roleSlug: 'sales-head', roleLevel: 3, assignmentMode: 'hierarchy' },
    ],
    requiredApprovals: 1,
    slaHours: 48,
    escalationConfig: { enabled: false, level1AfterHours: 48, level2AfterHours: 72, level3AfterHours: 96 },
  },

  // ─── 7. INVOICE APPROVAL ──────────────────────────────────────
  {
    approvalType: 'INVOICE_APPROVAL',
    displayName: 'Invoice Approval',
    description:
      'Requires finance approval before an invoice can be sent to the customer. Ensures accuracy of customer-facing documents.',
    isEnabled: true,
    alwaysRequire: true,
    approverRules: [
      { roleSlug: 'finance-head', roleLevel: 3, assignmentMode: 'hierarchy' },
    ],
    requiredApprovals: 1,
    slaHours: 24,
    escalationConfig: {
      enabled: true,
      level1AfterHours: 24,
      level2AfterHours: 48,
      level3AfterHours: 72,
    },
  },
];

/**
 * Seed default approval policies for a new organization.
 * Idempotent — uses upsert to avoid duplicates.
 *
 * @param {ObjectId} organizationId
 * @param {ObjectId} createdByUserId
 * @returns {Array} Created/updated policy documents
 */
export const seedDefaultApprovalPolicies = async (organizationId, createdByUserId) => {
  const results = [];

  for (const policyData of DEFAULT_POLICIES) {
    const doc = await ApprovalPolicy.findOneAndUpdate(
      {
        organization: organizationId,
        approvalType: policyData.approvalType,
        project: null, // org-wide policies
      },
      {
        $setOnInsert: {
          ...policyData,
          organization: organizationId,
          project: null,
          createdBy: createdByUserId,
        },
      },
      { upsert: true, new: true }
    );
    results.push(doc);
  }

  return results;
};

export { DEFAULT_POLICIES };
