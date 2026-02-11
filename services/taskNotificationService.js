// File: services/taskNotificationService.js
// Description: Email notifications for task events (assignments, overdue, mentions, escalations)

import { sendEmail } from '../utils/emailService.js';

/**
 * Build a simple HTML email body for task notifications
 */
function buildTaskEmailHtml({ heading, taskTitle, taskNumber, message, actionUrl }) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; border-radius: 8px 8px 0 0;">
        <h2 style="color: #fff; margin: 0;">${heading}</h2>
      </div>
      <div style="background: #f9fafb; padding: 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        <p style="font-size: 16px; color: #374151; margin-top: 0;">
          <strong>${taskNumber}</strong> — ${taskTitle}
        </p>
        <p style="font-size: 14px; color: #6b7280;">${message}</p>
        ${actionUrl ? `<a href="${actionUrl}" style="display: inline-block; margin-top: 16px; padding: 10px 20px; background: #667eea; color: #fff; text-decoration: none; border-radius: 6px;">View Task</a>` : ''}
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
        <p style="font-size: 12px; color: #9ca3af;">This is an automated notification from PropVantage AI.</p>
      </div>
    </div>
  `;
}

/**
 * Send notification when a task is assigned to someone
 */
export async function notifyTaskAssigned({ assignee, assigner, task }) {
  if (!assignee?.email) return;

  try {
    await sendEmail({
      to: assignee.email,
      subject: `[${task.taskNumber}] Task assigned to you: ${task.title}`,
      html: buildTaskEmailHtml({
        heading: 'New Task Assigned',
        taskTitle: task.title,
        taskNumber: task.taskNumber || task.displayId,
        message: `${assigner?.firstName || 'System'} ${assigner?.lastName || ''} has assigned you a task.<br/>
          <strong>Priority:</strong> ${task.priority}<br/>
          <strong>Due:</strong> ${task.dueDate ? new Date(task.dueDate).toLocaleDateString() : 'No due date'}<br/>
          <strong>Category:</strong> ${task.category}`,
      }),
    });
  } catch (err) {
    console.error(`❌ [TaskNotify] notifyTaskAssigned failed: ${err.message}`);
  }
}

/**
 * Send notification when a task is overdue
 */
export async function notifyTaskOverdue({ assignee, task, overdueDays }) {
  if (!assignee?.email) return;

  try {
    await sendEmail({
      to: assignee.email,
      subject: `[OVERDUE] ${task.taskNumber}: ${task.title} — ${overdueDays} day(s) overdue`,
      html: buildTaskEmailHtml({
        heading: 'Task Overdue',
        taskTitle: task.title,
        taskNumber: task.taskNumber || task.displayId,
        message: `This task is now <strong>${overdueDays} day(s) overdue</strong>.<br/>
          <strong>Due Date:</strong> ${new Date(task.dueDate).toLocaleDateString()}<br/>
          <strong>Priority:</strong> ${task.priority}<br/>
          Please take action as soon as possible.`,
      }),
    });
  } catch (err) {
    console.error(`❌ [TaskNotify] notifyTaskOverdue failed: ${err.message}`);
  }
}

/**
 * Send notification when someone is @mentioned in a comment
 */
export async function notifyMention({ mentionedUser, commenter, task, commentText }) {
  if (!mentionedUser?.email) return;

  try {
    await sendEmail({
      to: mentionedUser.email,
      subject: `[${task.taskNumber}] You were mentioned in: ${task.title}`,
      html: buildTaskEmailHtml({
        heading: 'You Were Mentioned',
        taskTitle: task.title,
        taskNumber: task.taskNumber || task.displayId,
        message: `${commenter?.firstName || 'Someone'} ${commenter?.lastName || ''} mentioned you in a comment:<br/>
          <blockquote style="border-left: 3px solid #667eea; padding-left: 12px; color: #374151; margin: 12px 0;">${commentText.substring(0, 500)}</blockquote>`,
      }),
    });
  } catch (err) {
    console.error(`❌ [TaskNotify] notifyMention failed: ${err.message}`);
  }
}

/**
 * Send notification when a task is escalated
 */
export async function notifyEscalation({ escalatedToUser, task, escalationLevel, reason }) {
  if (!escalatedToUser?.email) return;

  try {
    await sendEmail({
      to: escalatedToUser.email,
      subject: `[ESCALATION L${escalationLevel}] ${task.taskNumber}: ${task.title}`,
      html: buildTaskEmailHtml({
        heading: `Task Escalation — Level ${escalationLevel}`,
        taskTitle: task.title,
        taskNumber: task.taskNumber || task.displayId,
        message: `This task has been escalated to you.<br/>
          <strong>Reason:</strong> ${reason}<br/>
          <strong>Priority:</strong> ${task.priority}<br/>
          <strong>Due Date:</strong> ${task.dueDate ? new Date(task.dueDate).toLocaleDateString() : 'N/A'}<br/>
          Please review and take appropriate action.`,
      }),
    });
  } catch (err) {
    console.error(
      `❌ [TaskNotify] notifyEscalation failed: ${err.message}`
    );
  }
}

/**
 * Send notification when a task due date is approaching (24 hours)
 */
export async function notifyTaskDueSoon({ assignee, task }) {
  if (!assignee?.email) return;

  try {
    await sendEmail({
      to: assignee.email,
      subject: `[Due Soon] ${task.taskNumber}: ${task.title} — due tomorrow`,
      html: buildTaskEmailHtml({
        heading: 'Task Due Soon',
        taskTitle: task.title,
        taskNumber: task.taskNumber || task.displayId,
        message: `This task is due within the next 24 hours.<br/>
          <strong>Due Date:</strong> ${new Date(task.dueDate).toLocaleDateString()}<br/>
          <strong>Priority:</strong> ${task.priority}`,
      }),
    });
  } catch (err) {
    console.error(
      `❌ [TaskNotify] notifyTaskDueSoon failed: ${err.message}`
    );
  }
}
