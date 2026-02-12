# PropVantage AI — In-App Notification System: Frontend Documentation

**Base URL**: `/api/notifications`
**Auth**: All endpoints require `Authorization: Bearer <token>` header. Notifications are always scoped to the authenticated user — no user can see another user's notifications.

---

## 1. Data Model

### Notification Object

```typescript
interface Notification {
  _id: string;
  organization: string;
  recipient: string;                 // Always the current user
  type: NotificationType;
  title: string;                     // Short heading (max 200 chars)
  message: string;                   // Body text (max 1000 chars)
  actionUrl: string;                 // Frontend route to navigate to on click
  relatedEntity?: {
    entityType: 'Task' | 'Lead' | 'Sale' | 'Installment' | 'ConstructionMilestone' | 'Invoice' | 'Project';
    entityId: string;
    displayLabel: string;            // e.g. "TASK-042" or "Rahul Sharma"
  };
  isRead: boolean;
  readAt: string | null;             // ISO date string, null if unread
  priority: 'low' | 'medium' | 'high' | 'urgent';
  actor?: {                          // Populated User who triggered it (null for system)
    _id: string;
    firstName: string;
    lastName: string;
  };
  metadata?: Record<string, any>;    // Extra context (taskNumber, dueDate, etc.)
  expiresAt: string;                 // ISO date — auto-deleted by MongoDB after this date (30 days)
  createdAt: string;                 // ISO date
  updatedAt: string;
}
```

### Notification Types

```typescript
type NotificationType =
  // Task-related (10)
  | 'task_assigned'          // Someone assigned a task to you
  | 'task_status_changed'    // A task you're watching changed status
  | 'task_completed'         // A task you created/assigned was completed
  | 'task_comment'           // Someone commented on your task
  | 'task_mention'           // Someone @mentioned you in a comment
  | 'task_due_today'         // Your tasks that are due today (daily digest)
  | 'task_overdue'           // Your tasks that are overdue (daily digest)
  | 'task_due_soon'          // A task is due within 24 hours
  | 'task_escalated'         // A task was escalated to you
  | 'task_auto_generated'    // System created a task for you
  // Business events (4)
  | 'payment_overdue'        // An installment payment is overdue
  | 'lead_follow_up_due'     // A lead follow-up date is today
  | 'milestone_delayed'      // A construction milestone is past planned end
  | 'sale_booked';           // A new sale was booked
```

### Priority Levels

| Priority | When Used | UI Recommendation |
|----------|-----------|-------------------|
| `urgent` | Escalations, overdue tasks | Red badge / icon |
| `high` | Task assignments, tasks due today, @mentions | Orange badge |
| `medium` | Status changes, comments, due soon, auto-generated | Default / blue |
| `low` | Sale booked, informational | Gray / muted |

---

## 2. API Endpoints

### 2.1 Get Notifications (Paginated)

```
GET /api/notifications?page=1&limit=20&isRead=false&type=task_assigned,task_mention&priority=high,urgent
```

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | 1 | Page number |
| `limit` | number | 20 | Items per page (max 50) |
| `isRead` | string | _(all)_ | `"true"` or `"false"` to filter by read status |
| `type` | string | _(all)_ | Comma-separated notification types to include |
| `priority` | string | _(all)_ | Comma-separated priorities to include |

**Response:**

```json
{
  "success": true,
  "data": {
    "notifications": [
      {
        "_id": "65f...",
        "type": "task_assigned",
        "title": "Task assigned: TASK-042",
        "message": "Rahul Sharma assigned you \"Follow up with buyer\" — Priority: High",
        "actionUrl": "/tasks/65f...",
        "relatedEntity": {
          "entityType": "Task",
          "entityId": "65f...",
          "displayLabel": "TASK-042"
        },
        "isRead": false,
        "readAt": null,
        "priority": "high",
        "actor": {
          "_id": "65e...",
          "firstName": "Rahul",
          "lastName": "Sharma"
        },
        "metadata": {
          "taskNumber": "TASK-042",
          "taskPriority": "High",
          "taskCategory": "Lead & Sales",
          "dueDate": "2026-02-15T00:00:00.000Z"
        },
        "createdAt": "2026-02-11T10:30:00.000Z"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 3,
      "total": 47,
      "limit": 20,
      "hasNextPage": true,
      "hasPrevPage": false
    }
  }
}
```

---

### 2.2 Get Unread Count (Bell Badge)

```
GET /api/notifications/unread-count
```

**Response:**

```json
{
  "success": true,
  "data": { "count": 12 }
}
```

**Usage:** Poll this endpoint every 30–60 seconds to update the bell icon badge. It's a lightweight `countDocuments` query — safe to call frequently.

---

### 2.3 Mark Single Notification as Read

```
PUT /api/notifications/:id/read
```

**Response:**

```json
{
  "success": true,
  "message": "Notification marked as read",
  "data": {
    "notification": { "_id": "65f...", "isRead": true, "readAt": "2026-02-11T10:35:00.000Z", "..." }
  }
}
```

**When to call:** When the user clicks on a notification. Typically you'd call this AND navigate to `actionUrl` at the same time.

---

### 2.4 Mark All as Read

```
PUT /api/notifications/read-all
```

**Response:**

```json
{
  "success": true,
  "message": "12 notification(s) marked as read",
  "data": { "modifiedCount": 12 }
}
```

**When to call:** "Mark all as read" button in the notification panel.

---

### 2.5 Delete Notification

```
DELETE /api/notifications/:id
```

**Response:**

```json
{
  "success": true,
  "message": "Notification deleted"
}
```

**When to call:** Swipe-to-dismiss or "X" button on individual notification. This is a hard delete — the notification is gone permanently.

---

### 2.6 Get Notification Preferences

```
GET /api/notifications/preferences
```

**Response:**

```json
{
  "success": true,
  "data": {
    "preferences": {
      "task_assigned": true,
      "task_status_changed": true,
      "task_completed": true,
      "task_comment": true,
      "task_mention": true,
      "task_due_today": true,
      "task_overdue": true,
      "task_due_soon": true,
      "task_escalated": true,
      "task_auto_generated": true,
      "payment_overdue": true,
      "lead_follow_up_due": true,
      "milestone_delayed": true,
      "sale_booked": true
    },
    "availableTypes": [
      "task_assigned", "task_status_changed", "task_completed",
      "task_comment", "task_mention", "task_due_today",
      "task_overdue", "task_due_soon", "task_escalated",
      "task_auto_generated", "payment_overdue", "lead_follow_up_due",
      "milestone_delayed", "sale_booked"
    ]
  }
}
```

**Usage:** Render a settings page with toggles. `availableTypes` provides the full list; `preferences` provides the current on/off state. All default to `true`.

---

### 2.7 Update Notification Preferences

```
PUT /api/notifications/preferences
```

**Request Body:**

```json
{
  "preferences": {
    "task_comment": false,
    "sale_booked": false
  }
}
```

Only send the keys you want to change — you don't need to send all 14 every time. Only valid `NotificationType` keys with boolean values are accepted; everything else is ignored.

**Response:**

```json
{
  "success": true,
  "message": "Notification preferences updated",
  "data": {
    "preferences": {
      "task_assigned": true,
      "task_status_changed": true,
      "task_completed": true,
      "task_comment": false,
      "task_mention": true,
      "task_due_today": true,
      "task_overdue": true,
      "task_due_soon": true,
      "task_escalated": true,
      "task_auto_generated": true,
      "payment_overdue": true,
      "lead_follow_up_due": true,
      "milestone_delayed": true,
      "sale_booked": false
    }
  }
}
```

---

## 3. Notification Trigger Map

This table shows exactly when each notification is created, who receives it, and what the `title` / `message` look like.

### 3.1 Immediate Triggers (created on user action)

| Type | Triggered When | Recipient(s) | Priority | Example Title | Example Message |
|------|----------------|--------------|----------|---------------|-----------------|
| `task_assigned` | Task created with assignee / task reassigned / bulk assign | The assigned user | `high` (or `urgent` if Critical) | "Task assigned: TASK-042" | "Rahul Sharma assigned you \"Follow up with buyer\" — Priority: High" |
| `task_status_changed` | Task status transitions (Open→In Progress, etc.) | Creator + assignee + watchers (excl. actor) | `medium` | "TASK-042: Open → In Progress" | "Rahul Sharma changed the status of \"Follow up with buyer\"" |
| `task_completed` | Task marked Completed | Creator + assignedBy (excl. completer) | `medium` | "TASK-042 completed" | "Priya Singh completed \"Follow up with buyer\"" |
| `task_comment` | Comment added on task | Assignee + creator + watchers (excl. author) | `medium` | "Comment on TASK-042" | "Rahul: \"The buyer confirmed the meeting for...\"" |
| `task_mention` | User @mentioned in a comment | Each mentioned user (excl. commenter) | `high` | "Mentioned in TASK-042" | "Rahul mentioned you: \"@Priya please review the...\"" |

### 3.2 Auto-Generation Triggers (system-created tasks)

| Type | Triggered When | Recipient | Priority | Example Title | Example Message |
|------|----------------|-----------|----------|---------------|-----------------|
| `task_auto_generated` | Overdue payment task created | Sales person | `medium`/`high` | "New task: TASK-055" | "[Overdue Payment] \"Overdue Payment Follow-up: Installment #3\" has been created and assigned to you" |
| `task_auto_generated` | Missed follow-up task created | Lead assignee | `medium` | "New task: TASK-056" | "[Missed Follow-up] \"Follow-up Overdue: Rahul Sharma\" has been created and assigned to you" |
| `task_auto_generated` | Delayed milestone task created | Milestone assignee | `medium`/`high` | "New task: TASK-057" | "[Delayed Milestone] \"Delayed Milestone: Foundation\" has been created and assigned to you" |
| `task_auto_generated` | New sale onboarding task created | Sales person | `medium` | "New task: TASK-058" | "[New Sale Onboarding] \"New Booking Onboarding: Vikram\" has been created and assigned to you" |
| `task_auto_generated` | Recurring task instance generated | Original assignee | `medium` | "New task: TASK-059" | "[Recurring Task] \"Weekly Site Inspection\" has been created and assigned to you" |
| `task_escalated` | Overdue task escalated to manager | The manager | `urgent` | "Escalation L1: TASK-042" | "Task overdue by 36 hours (auto-escalation level 1)" |

### 3.3 Scheduled Triggers (cron jobs)

| Type | Schedule | Recipient | Priority | Example Title | Example Message |
|------|----------|-----------|----------|---------------|-----------------|
| `task_due_today` | Daily at 8:00 AM IST | Each user with tasks due today | `high` | "3 tasks due today" | "\"Follow up with buyer\" and 2 more tasks are due today" |
| `task_overdue` | Daily at 8:00 AM IST | Each user with overdue tasks | `urgent` | "5 overdue tasks" | "You have 5 overdue tasks — oldest is 12 days overdue" |
| `task_due_soon` | Every 4 hours | Assignee of tasks due within 24h | `medium` | "Due soon: TASK-042" | "\"Follow up with buyer\" is due within 24 hours — Priority: High" |

---

## 4. UI Component Recommendations

### 4.1 Bell Icon with Badge

```
  [Bell Icon]  (12)    ← unread count from GET /unread-count
```

- Poll `GET /api/notifications/unread-count` every 30–60 seconds
- Show badge only when count > 0
- Badge color: red for count > 0

### 4.2 Notification Dropdown / Panel

When the bell is clicked, show a dropdown or slide-out panel:

```
┌─────────────────────────────────────────┐
│  Notifications              [Mark all ✓] │
├─────────────────────────────────────────┤
│ 🔴 Escalation L2: TASK-042       2h ago │  ← urgent = red dot
│    Task overdue by 48 hours...          │
├─────────────────────────────────────────┤
│ 🟠 Task assigned: TASK-055       3h ago │  ← high = orange dot
│    System assigned you "Overdue..."     │
├─────────────────────────────────────────┤
│ 🔵 Comment on TASK-033          5h ago  │  ← medium = blue dot
│    Rahul: "The buyer confirmed..."      │
├─────────────────────────────────────────┤
│           [View all notifications →]     │
└─────────────────────────────────────────┘
```

**Behaviors:**
- Clicking a notification → call `PUT /:id/read` AND navigate to `actionUrl`
- "Mark all" button → call `PUT /read-all`
- "View all" → navigate to `/notifications` full page
- Unread notifications have a colored dot or bold text; read ones are muted

### 4.3 Full Notification Page

`/notifications` — full-width list with filters:

| Filter | Control | Maps to Query Param |
|--------|---------|---------------------|
| Read/Unread | Tab or toggle | `?isRead=false` |
| Type | Multi-select dropdown | `?type=task_assigned,task_mention` |
| Priority | Pill filter (All / Urgent / High) | `?priority=urgent,high` |

### 4.4 Notification Settings Page

`/settings/notifications` — grid of toggles:

| Category | Notification | Toggle |
|----------|-------------|--------|
| **Tasks** | Task assigned to me | ✅ |
| | Task status changed | ✅ |
| | Task completed | ✅ |
| | Comment on my task | ✅ |
| | @mentioned in comment | ✅ |
| | Tasks due today (daily) | ✅ |
| | Overdue tasks (daily) | ✅ |
| | Task due within 24h | ✅ |
| | Task escalated to me | ✅ |
| | Auto-generated task | ✅ |
| **Business** | Payment overdue | ✅ |
| | Lead follow-up due | ✅ |
| | Milestone delayed | ✅ |
| | Sale booked | ✅ |

**Tip:** Group by category for readability. Use the `availableTypes` array from `GET /preferences` as the source of truth for which toggles to render.

### 4.5 Notification Type Icons

| Type | Suggested Icon | Color |
|------|---------------|-------|
| `task_assigned` | User + arrow | Blue |
| `task_status_changed` | Refresh/arrows | Gray |
| `task_completed` | Checkmark circle | Green |
| `task_comment` | Chat bubble | Blue |
| `task_mention` | @ symbol | Purple |
| `task_due_today` | Calendar | Orange |
| `task_overdue` | Clock + exclamation | Red |
| `task_due_soon` | Clock | Yellow |
| `task_escalated` | Arrow up + warning | Red |
| `task_auto_generated` | Robot / gear | Teal |
| `payment_overdue` | Rupee + clock | Red |
| `lead_follow_up_due` | Phone + calendar | Orange |
| `milestone_delayed` | Construction + warning | Orange |
| `sale_booked` | Handshake / party | Green |

### 4.6 Relative Time Display

Show "2m ago", "1h ago", "Yesterday", "Feb 10" instead of full timestamps. Use a library like `date-fns` `formatDistanceToNow()` or similar.

---

## 5. Navigation from Notifications

When a user clicks a notification, navigate to `actionUrl`. Here's the mapping:

| actionUrl Pattern | Frontend Route | Description |
|-------------------|---------------|-------------|
| `/tasks/<taskId>` | Task detail page | Most task notifications |
| `/tasks/my` | My Tasks dashboard | Daily digest (due today / overdue) |

The `relatedEntity` field provides additional context:
- `relatedEntity.entityType` tells you what kind of entity is linked
- `relatedEntity.displayLabel` is a human-readable label (e.g. "TASK-042")
- `relatedEntity.entityId` is the MongoDB ID you can use for API calls

---

## 6. Metadata Field Reference

The `metadata` object contains extra context per notification type. Use this for richer UI rendering.

| Notification Type | Metadata Keys | Example Values |
|-------------------|--------------|----------------|
| `task_assigned` | `taskNumber`, `taskPriority`, `taskCategory`, `dueDate` | `"TASK-042"`, `"High"`, `"Lead & Sales"`, `"2026-02-15T..."` |
| `task_status_changed` | `taskNumber`, `oldStatus`, `newStatus` | `"TASK-042"`, `"Open"`, `"In Progress"` |
| `task_completed` | `taskNumber`, `taskCategory` | `"TASK-042"`, `"Payment & Collection"` |
| `task_comment` | `taskNumber` | `"TASK-042"` |
| `task_mention` | `taskNumber` | `"TASK-042"` |
| `task_due_today` | `taskCount`, `date`, `taskNumbers` | `3`, `"2026-02-11"`, `["TASK-040","TASK-041","TASK-042"]` |
| `task_overdue` | `taskCount`, `date`, `taskNumbers` | `5`, `"2026-02-11"`, `["TASK-035",...]` |
| `task_due_soon` | `taskNumber`, `taskPriority`, `dueDate` | `"TASK-042"`, `"High"`, `"2026-02-12T..."` |
| `task_escalated` | `taskNumber`, `escalationLevel`, `taskPriority` | `"TASK-042"`, `2`, `"Critical"` |
| `task_auto_generated` | `taskNumber`, `triggerType`, `taskPriority`, `taskCategory` | `"TASK-055"`, `"overdue_payment"`, `"High"`, `"Payment & Collection"` |

---

## 7. Error Responses

All endpoints return errors in the same format:

```json
{
  "success": false,
  "message": "Error description"
}
```

| Status | Scenario |
|--------|----------|
| `400` | Invalid preferences object, no valid updates |
| `401` | Missing or invalid auth token |
| `404` | Notification not found (or belongs to another user) |
| `500` | Internal server error |

---

## 8. Polling Strategy

Since the system does NOT have WebSockets, use polling:

| What | Endpoint | Frequency | Purpose |
|------|----------|-----------|---------|
| Bell badge count | `GET /unread-count` | Every 30–60 seconds | Update the badge number |
| Notification list | `GET /notifications?isRead=false&limit=5` | On bell click (not polled) | Show dropdown content |
| Full list | `GET /notifications?page=1&limit=20` | On page load / pull-to-refresh | Full notification page |

**Optimization:** The `unread-count` endpoint is a single `countDocuments` query with an index — it's fast and safe to poll every 30 seconds.

---

## 9. Notification Lifecycle

```
Created (unread)  →  Read (user clicks)  →  Expires (auto-deleted after 30 days)
                                           OR  Deleted (user dismisses)
```

- Notifications are **created** by the backend (never by the frontend)
- They are **read** when the user clicks them (or "Mark all as read")
- They **auto-expire** after 30 days via MongoDB TTL index — no frontend action needed
- Users can **manually delete** individual notifications

---

## 10. Self-Notification Prevention

The backend automatically prevents these redundant notifications:
- You will **not** get a "task assigned" notification if you assign a task to yourself
- You will **not** get a "status changed" notification if you changed the status yourself
- You will **not** get a "comment added" notification for your own comment
- You will **not** get a "mentioned" notification if you mention yourself

The frontend doesn't need to worry about filtering these — the backend handles it.

---

## 11. Files Changed (for code review reference)

| File | What Changed |
|------|-------------|
| `models/notificationModel.js` | New — Notification schema with 14 types, TTL index, statics |
| `services/notificationService.js` | New — Core `createNotification`, 7 task helpers, 2 cron functions |
| `controllers/notificationController.js` | New — 7 endpoints (list, unread-count, mark-read, mark-all, delete, prefs) |
| `routes/notificationRoutes.js` | New — Route wiring with `protect` middleware |
| `models/userModel.js` | Modified — Added `notificationPreferences` (14 per-type toggles) |
| `controllers/taskController.js` | Modified — Added fire-and-forget notification triggers |
| `services/taskAutoGenerationService.js` | Modified — Added notification triggers for auto-generated tasks + escalations |
| `services/backgroundJobService.js` | Modified — Added 2 cron jobs (daily digest + due-soon) |
| `server.js` | Modified — Registered `/api/notifications` route + health check |

---

## 12. Frontend Developer Checklist

- [ ] **Bell icon component** — badge showing unread count, polls every 30–60 seconds
- [ ] **Notification dropdown** — shows latest 5–10 unread on bell click, "Mark all" button, "View all" link
- [ ] **Full notification page** (`/notifications`) — paginated list with read/unread filter, type filter, priority filter
- [ ] **Click-to-navigate** — clicking a notification marks it as read + navigates to `actionUrl`
- [ ] **Delete/dismiss** — swipe or X button to delete individual notifications
- [ ] **Notification settings page** (`/settings/notifications`) — 14 toggle switches grouped by category
- [ ] **Priority-based styling** — urgent=red, high=orange, medium=blue, low=gray
- [ ] **Type-based icons** — different icons per notification type (see Section 4.5)
- [ ] **Relative time** — "2m ago", "1h ago", "Yesterday" instead of full dates
- [ ] **Empty state** — "No notifications" message when list is empty
- [ ] **Actor avatar/name** — show who triggered the notification (from `actor` field)
- [ ] **Metadata display** — use metadata for richer rendering (task number, priority badge, etc.)

---

*Last Updated: February 2026*
