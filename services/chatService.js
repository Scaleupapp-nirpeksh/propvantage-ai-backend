// File: services/chatService.js
// Description: Business logic helpers for the chat/messaging system

import mongoose from 'mongoose';

/**
 * Resolve initial participants for an entity-linked conversation.
 * Returns an array of user ObjectId strings (deduplicated).
 */
export async function getEntityParticipants(organizationId, entityType, entityId) {
  const participants = new Set();

  try {
    switch (entityType) {
      case 'Lead': {
        const Lead = (await import('../models/leadModel.js')).default;
        const lead = await Lead.findOne({
          _id: entityId,
          organization: organizationId,
        }).select('assignedTo createdBy').lean();
        if (lead?.assignedTo) participants.add(lead.assignedTo.toString());
        if (lead?.createdBy) participants.add(lead.createdBy.toString());
        break;
      }

      case 'Sale': {
        const Sale = (await import('../models/salesModel.js')).default;
        const sale = await Sale.findOne({
          _id: entityId,
          organization: organizationId,
        }).select('salesExecutive createdBy').lean();
        if (sale?.salesExecutive) participants.add(sale.salesExecutive.toString());
        if (sale?.createdBy) participants.add(sale.createdBy.toString());
        break;
      }

      case 'Project': {
        const Project = (await import('../models/projectModel.js')).default;
        const project = await Project.findOne({
          _id: entityId,
          organization: organizationId,
        }).select('projectManager createdBy').lean();
        if (project?.projectManager) participants.add(project.projectManager.toString());
        if (project?.createdBy) participants.add(project.createdBy.toString());
        break;
      }

      case 'Invoice': {
        const Invoice = (await import('../models/invoiceModel.js')).default;
        const invoice = await Invoice.findOne({
          _id: entityId,
          organization: organizationId,
        }).select('createdBy').lean();
        if (invoice?.createdBy) participants.add(invoice.createdBy.toString());
        break;
      }

      case 'ConstructionMilestone': {
        const Milestone = (await import('../models/constructionMilestoneModel.js')).default;
        const milestone = await Milestone.findOne({
          _id: entityId,
          organization: organizationId,
        }).select('assignedTo createdBy').lean();
        if (milestone?.assignedTo) participants.add(milestone.assignedTo.toString());
        if (milestone?.createdBy) participants.add(milestone.createdBy.toString());
        break;
      }

      case 'PaymentTransaction': {
        const PaymentTransaction = (await import('../models/paymentTransactionModel.js')).default;
        const txn = await PaymentTransaction.findOne({
          _id: entityId,
          organization: organizationId,
        }).select('createdBy recordedBy').lean();
        if (txn?.createdBy) participants.add(txn.createdBy.toString());
        if (txn?.recordedBy) participants.add(txn.recordedBy.toString());
        break;
      }

      default:
        break;
    }
  } catch (error) {
    console.error(`[ChatService] Error resolving entity participants for ${entityType}:`, error.message);
  }

  return [...participants];
}

/**
 * Build a display label for an entity conversation.
 */
export async function getEntityDisplayLabel(organizationId, entityType, entityId) {
  try {
    switch (entityType) {
      case 'Lead': {
        const Lead = (await import('../models/leadModel.js')).default;
        const lead = await Lead.findOne({ _id: entityId, organization: organizationId })
          .select('firstName lastName').lean();
        return lead ? `Lead: ${lead.firstName} ${lead.lastName}` : `Lead #${entityId}`;
      }
      case 'Sale': {
        const Sale = (await import('../models/salesModel.js')).default;
        const sale = await Sale.findOne({ _id: entityId, organization: organizationId })
          .select('bookingId').lean();
        return sale?.bookingId ? `Sale: ${sale.bookingId}` : `Sale #${entityId}`;
      }
      case 'Project': {
        const Project = (await import('../models/projectModel.js')).default;
        const project = await Project.findOne({ _id: entityId, organization: organizationId })
          .select('name').lean();
        return project ? `Project: ${project.name}` : `Project #${entityId}`;
      }
      case 'Invoice': {
        const Invoice = (await import('../models/invoiceModel.js')).default;
        const invoice = await Invoice.findOne({ _id: entityId, organization: organizationId })
          .select('invoiceNumber').lean();
        return invoice?.invoiceNumber ? `Invoice: ${invoice.invoiceNumber}` : `Invoice #${entityId}`;
      }
      case 'ConstructionMilestone': {
        const Milestone = (await import('../models/constructionMilestoneModel.js')).default;
        const ms = await Milestone.findOne({ _id: entityId, organization: organizationId })
          .select('name').lean();
        return ms ? `Milestone: ${ms.name}` : `Milestone #${entityId}`;
      }
      case 'PaymentTransaction':
        return `Payment #${entityId}`;
      default:
        return `${entityType} #${entityId}`;
    }
  } catch {
    return `${entityType} #${entityId}`;
  }
}

/**
 * Create chat notifications for offline participants.
 * Fire-and-forget — caller should .catch() errors.
 */
export async function notifyChatMessage(conversation, message, senderId, senderName, onlineUserIds = []) {
  const { createBulkNotifications } = await import('./notificationService.js');

  const offlineParticipants = conversation.participants.filter((p) => {
    if (!p.isActive) return false;
    if (p.user.toString() === senderId.toString()) return false;
    if (p.notifications === 'none') return false;
    // Only notify offline users
    if (onlineUserIds.includes(p.user.toString())) return false;
    return true;
  });

  if (offlineParticipants.length === 0) return;

  const preview = message.content?.text?.substring(0, 100) || 'Sent an attachment';
  const convName =
    conversation.type === 'direct'
      ? senderName
      : conversation.name || 'Group';

  const notifications = offlineParticipants.map((p) => ({
    organization: conversation.organization,
    recipient: p.user,
    type: 'chat_message',
    title:
      conversation.type === 'direct'
        ? `${senderName} sent you a message`
        : `${senderName} in ${convName}`,
    message: preview,
    actionUrl: `/chat/${conversation._id}`,
    priority: 'medium',
    actor: new mongoose.Types.ObjectId(senderId),
    relatedEntity: {
      entityType: 'Conversation',
      entityId: conversation._id,
      displayLabel: convName,
    },
  }));

  return createBulkNotifications(notifications);
}

/**
 * Create mention notifications. Higher priority than regular chat messages.
 */
export async function notifyChatMention(conversation, message, mentionIds, senderId, senderName) {
  const { createBulkNotifications } = await import('./notificationService.js');

  const convName =
    conversation.type === 'direct'
      ? senderName
      : conversation.name || 'Group';

  const notifications = mentionIds
    .filter((uid) => uid.toString() !== senderId.toString())
    .map((uid) => ({
      organization: conversation.organization,
      recipient: new mongoose.Types.ObjectId(uid),
      type: 'chat_mention',
      title: `${senderName} mentioned you`,
      message: message.content?.text?.substring(0, 100) || 'Mentioned you in a message',
      actionUrl: `/chat/${conversation._id}`,
      priority: 'high',
      actor: new mongoose.Types.ObjectId(senderId),
      relatedEntity: {
        entityType: 'Conversation',
        entityId: conversation._id,
        displayLabel: convName,
      },
    }));

  if (notifications.length === 0) return;
  return createBulkNotifications(notifications);
}
