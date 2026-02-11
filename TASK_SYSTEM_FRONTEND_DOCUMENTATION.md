# PropVantage AI - Task & Ticketing System
## Frontend Developer Documentation

### Version 2.0.0 | Complete API Reference & Integration Guide

---

## Table of Contents

1. [Feature Overview](#1-feature-overview)
2. [Permissions & Access Control](#2-permissions--access-control)
3. [API Reference](#3-api-reference)
   - [Task CRUD](#31-task-crud)
   - [Status Management](#32-status-management)
   - [Comments](#33-comments)
   - [Sub-Tasks](#34-sub-tasks)
   - [Checklist Operations](#35-checklist-operations)
   - [Personal Dashboard (My Tasks)](#36-personal-dashboard-my-tasks)
   - [Team View](#37-team-view)
   - [Overdue Tasks](#38-overdue-tasks)
   - [Bulk Operations](#39-bulk-operations)
   - [Task Analytics](#310-task-analytics)
   - [Template CRUD](#311-template-crud)
   - [Apply Template](#312-apply-template)
4. [Data Models & TypeScript Interfaces](#4-data-models--typescript-interfaces)
5. [Enums & Constants](#5-enums--constants)
6. [Status State Machine](#6-status-state-machine)
7. [Auto-Generated Tasks](#7-auto-generated-tasks)
8. [Business Flows & UI Recommendations](#8-business-flows--ui-recommendations)
9. [Error Codes & Handling](#9-error-codes--handling)

---

## 1. Feature Overview

The Task & Ticketing System replaces WhatsApp-based task management with a structured system for tracking assignments, deadlines, and team workload. Key capabilities:

- **Task CRUD** with sequential task numbers (TASK-001, TASK-002...)
- **Status workflow** with state machine validation (Open -> In Progress -> Under Review -> Completed)
- **Sub-tasks** up to 3 levels deep
- **Checklists** with toggle-able items and progress tracking
- **Comments** with @mentions that auto-add watchers
- **Permission-scoped views**: My Tasks, Team Tasks, All Tasks
- **Bulk operations**: mass-assign and mass-status-update
- **Task templates**: reusable workflows with sub-task definitions
- **Auto-generated tasks**: system creates tasks from overdue payments, missed follow-ups, delayed milestones, new sale onboarding
- **Recurring tasks**: daily/weekly/biweekly/monthly/quarterly
- **SLA tracking** with overdue detection and escalation
- **Entity linking**: tasks can be linked to Leads, Sales, Invoices, Milestones, etc.
- **Analytics dashboard**: status/priority/category distribution, completion rate, overdue aging, team workload, SLA compliance

### Base URL
```
/api/tasks
```

### Authentication
All endpoints require `Authorization: Bearer <jwt_token>` header.

---

## 2. Permissions & Access Control

Task permissions follow the existing RBAC system. Each action maps to a permission string stored in the user's role.

| Permission | Description | Who Has It |
|------------|-------------|------------|
| `tasks:view` | View own tasks (assigned to me, created by me, watching) | All roles |
| `tasks:view_team` | View tasks of subordinates (lower role level) | Level 4+ (Managers and above) |
| `tasks:view_all` | View all tasks in the organization | Level 2 (Project Director and above) |
| `tasks:create` | Create new tasks | All roles |
| `tasks:update` | Update task fields, change status, toggle checklist | Level 5+ (Executives and above) |
| `tasks:delete` | Cancel/delete tasks | Level 1-2 (Business Head, Project Director) |
| `tasks:assign` | Assign tasks to other users | Level 4+ (Managers and above) |
| `tasks:manage_templates` | Create/update/delete task templates | Level 2 (Project Director and above) |
| `tasks:analytics` | Access task analytics dashboard | Level 3+ (Department Heads and above) |
| `tasks:bulk_operations` | Perform bulk assign and bulk status updates | Level 1-2 (Business Head, Project Director) |

### Permission-Scoped Task Visibility

When calling `GET /api/tasks`, the backend automatically scopes results based on the user's permissions:

| Permission | What They See |
|------------|---------------|
| `tasks:view_all` | All tasks in the organization |
| `tasks:view_team` | Tasks assigned to themselves + tasks assigned to subordinates (users with higher role level number) + tasks they created + tasks they're watching |
| `tasks:view` (only) | Tasks assigned to themselves + tasks they created + tasks they're watching |

**Frontend guidance**: Use the user's permissions to show/hide UI elements:
- Hide "Team Tasks" tab if user lacks `tasks:view_team`
- Hide "Analytics" tab if user lacks `tasks:analytics`
- Hide "Assign To" dropdown in forms if user lacks `tasks:assign`
- Hide bulk operation buttons if user lacks `tasks:bulk_operations`
- Hide template management (create/edit/delete) if user lacks `tasks:manage_templates`
- Hide delete button if user lacks `tasks:delete`

---

## 3. API Reference

### 3.1 Task CRUD

#### Create Task

```http
POST /api/tasks
```

**Permission**: `tasks:create`

**Request Body**:
```json
{
  "title": "Follow up with Ravi Sharma about 2BHK unit",
  "description": "Discuss payment plan options and schedule site visit",
  "category": "Lead & Sales",
  "priority": "High",
  "assignedTo": "507f1f77bcf86cd799439011",
  "dueDate": "2026-02-15T00:00:00.000Z",
  "startDate": "2026-02-10T00:00:00.000Z",
  "tags": ["follow-up", "hot-lead", "2bhk"],
  "checklist": [
    { "text": "Call lead to discuss payment options", "order": 1 },
    { "text": "Send cost sheet via WhatsApp", "order": 2 },
    { "text": "Schedule site visit", "order": 3 }
  ],
  "linkedEntity": {
    "entityType": "Lead",
    "entityId": "507f1f77bcf86cd799439022",
    "displayLabel": "Ravi Sharma"
  },
  "sla": {
    "targetResolutionHours": 48,
    "warningThresholdHours": 36
  },
  "recurrence": {
    "isRecurring": false
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | **Yes** | Task title (max 300 chars) |
| `description` | string | No | Detailed description (max 5000 chars) |
| `category` | string | No | One of the [Task Categories](#task-categories). Defaults to `"General"` |
| `priority` | string | No | One of: `Critical`, `High`, `Medium`, `Low`. Defaults to `"Medium"` |
| `assignedTo` | ObjectId | No | User ID to assign. Defaults to the creator (self-assign) |
| `dueDate` | ISO Date | No | When the task is due |
| `startDate` | ISO Date | No | When work should begin |
| `tags` | string[] | No | Lowercase tags for filtering |
| `checklist` | object[] | No | Array of `{ text, order }` items |
| `linkedEntity` | object | No | Link to an existing entity. See [Linked Entity Types](#linked-entity-types) |
| `linkedEntity.entityType` | string | Conditional | Required if linkedEntity is provided |
| `linkedEntity.entityId` | ObjectId | Conditional | Required if linkedEntity is provided |
| `linkedEntity.displayLabel` | string | No | Human-readable label for display |
| `parentTask` | ObjectId | No | Parent task ID (for creating a sub-task via this endpoint) |
| `sla` | object | No | SLA settings |
| `sla.targetResolutionHours` | number | No | Target resolution time in hours |
| `sla.warningThresholdHours` | number | No | Warning threshold in hours |
| `recurrence` | object | No | Recurrence configuration |
| `recurrence.isRecurring` | boolean | No | Whether this is a recurring task |
| `recurrence.pattern` | string | Conditional | Required if recurring. One of: `daily`, `weekly`, `biweekly`, `monthly`, `quarterly` |
| `recurrence.interval` | number | No | Repeat every N periods (default 1) |
| `recurrence.dayOfWeek` | number | No | 0=Sunday to 6=Saturday (for weekly) |
| `recurrence.dayOfMonth` | number | No | 1-31 (for monthly) |
| `recurrence.endDate` | ISO Date | No | When recurrence stops |
| `createdFromTemplate` | ObjectId | No | Template ID if created from a template |

**Response** `201`:
```json
{
  "success": true,
  "message": "Task created successfully",
  "data": {
    "task": {
      "_id": "60d5ecb54b24a10f58b2f1a3",
      "taskNumber": "TASK-001",
      "sequenceNumber": 1,
      "title": "Follow up with Ravi Sharma about 2BHK unit",
      "description": "Discuss payment plan options and schedule site visit",
      "category": "Lead & Sales",
      "status": "Open",
      "priority": "High",
      "assignedTo": {
        "_id": "507f1f77bcf86cd799439011",
        "firstName": "Priya",
        "lastName": "Patel",
        "email": "priya@company.com"
      },
      "assignedBy": "507f1f77bcf86cd799439099",
      "assignmentType": "direct",
      "assignmentStatus": "accepted",
      "dueDate": "2026-02-15T00:00:00.000Z",
      "startDate": "2026-02-10T00:00:00.000Z",
      "tags": ["follow-up", "hot-lead", "2bhk"],
      "checklist": [
        { "_id": "abc123", "text": "Call lead to discuss payment options", "order": 1, "isCompleted": false },
        { "_id": "abc124", "text": "Send cost sheet via WhatsApp", "order": 2, "isCompleted": false },
        { "_id": "abc125", "text": "Schedule site visit", "order": 3, "isCompleted": false }
      ],
      "linkedEntity": {
        "entityType": "Lead",
        "entityId": "507f1f77bcf86cd799439022",
        "displayLabel": "Ravi Sharma"
      },
      "sla": {
        "targetResolutionHours": 48,
        "warningThresholdHours": 36,
        "isOverdue": false
      },
      "watchers": [],
      "depth": 0,
      "parentTask": null,
      "createdBy": {
        "_id": "507f1f77bcf86cd799439099",
        "firstName": "Admin",
        "lastName": "User",
        "email": "admin@company.com"
      },
      "createdAt": "2026-02-10T10:30:00.000Z",
      "updatedAt": "2026-02-10T10:30:00.000Z",
      "displayId": "TASK-001",
      "daysUntilDue": 5,
      "isOverdue": false,
      "overdueDays": 0,
      "checklistProgress": 0
    }
  }
}
```

---

#### Get All Tasks (Paginated, Filtered)

```http
GET /api/tasks
```

**Permission**: `tasks:view` / `tasks:view_team` / `tasks:view_all`

**Query Parameters**:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | `1` | Page number |
| `limit` | number | `20` | Items per page (max recommended: 50) |
| `sortBy` | string | `createdAt` | Sort field. Options: `createdAt`, `dueDate`, `priority`, `status`, `title` |
| `sortOrder` | string | `desc` | Sort direction: `asc` or `desc` |
| `status` | string | - | Filter by status: `Open`, `In Progress`, `Under Review`, `Completed`, `On Hold`, `Cancelled` |
| `priority` | string | - | Filter by priority: `Critical`, `High`, `Medium`, `Low` |
| `category` | string | - | Filter by category (see [Task Categories](#task-categories)) |
| `assignedTo` | ObjectId | - | Filter by assignee user ID |
| `dueBefore` | ISO Date | - | Tasks due before this date |
| `dueAfter` | ISO Date | - | Tasks due after this date |
| `search` | string | - | Full-text search on title and description |
| `tags` | string | - | Comma-separated tags (e.g., `follow-up,hot-lead`) |
| `isOverdue` | string | - | Set to `"true"` to get only overdue tasks |
| `linkedEntityType` | string | - | Filter by linked entity type (e.g., `Lead`, `Sale`) |
| `parentTask` | string | - | Filter by parent task ID, or `"null"`/`"root"` for root tasks only |

**Response** `200`:
```json
{
  "success": true,
  "data": {
    "tasks": [
      {
        "_id": "60d5ecb54b24a10f58b2f1a3",
        "taskNumber": "TASK-001",
        "title": "Follow up with Ravi Sharma about 2BHK unit",
        "category": "Lead & Sales",
        "status": "Open",
        "priority": "High",
        "assignedTo": {
          "_id": "507f1f77bcf86cd799439011",
          "firstName": "Priya",
          "lastName": "Patel",
          "email": "priya@company.com"
        },
        "assignedBy": {
          "_id": "507f1f77bcf86cd799439099",
          "firstName": "Admin",
          "lastName": "User"
        },
        "createdBy": {
          "_id": "507f1f77bcf86cd799439099",
          "firstName": "Admin",
          "lastName": "User",
          "email": "admin@company.com"
        },
        "dueDate": "2026-02-15T00:00:00.000Z",
        "tags": ["follow-up", "hot-lead"],
        "linkedEntity": {
          "entityType": "Lead",
          "entityId": "507f1f77bcf86cd799439022",
          "displayLabel": "Ravi Sharma"
        },
        "checklist": [...],
        "displayId": "TASK-001",
        "daysUntilDue": 5,
        "isOverdue": false,
        "checklistProgress": 0,
        "createdAt": "2026-02-10T10:30:00.000Z"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 5,
      "total": 93,
      "limit": 20,
      "hasNextPage": true,
      "hasPrevPage": false
    }
  }
}
```

**Note**: The `comments` and `activityLog` arrays are excluded from list responses for performance. Use `GET /api/tasks/:id` to get the full task detail.

---

#### Get Task by ID

```http
GET /api/tasks/:id
```

**Permission**: `tasks:view`

**Response** `200`:
```json
{
  "success": true,
  "data": {
    "task": {
      "_id": "60d5ecb54b24a10f58b2f1a3",
      "taskNumber": "TASK-001",
      "sequenceNumber": 1,
      "title": "Follow up with Ravi Sharma about 2BHK unit",
      "description": "Discuss payment plan options and schedule site visit",
      "category": "Lead & Sales",
      "status": "In Progress",
      "priority": "High",
      "assignedTo": {
        "_id": "...",
        "firstName": "Priya",
        "lastName": "Patel",
        "email": "priya@company.com"
      },
      "assignedBy": {
        "_id": "...",
        "firstName": "Admin",
        "lastName": "User",
        "email": "admin@company.com"
      },
      "assignmentType": "direct",
      "assignmentStatus": "accepted",
      "watchers": [
        { "_id": "...", "firstName": "Ravi", "lastName": "Kumar", "email": "ravi@company.com" }
      ],
      "dueDate": "2026-02-15T00:00:00.000Z",
      "startDate": "2026-02-10T00:00:00.000Z",
      "sla": {
        "targetResolutionHours": 48,
        "warningThresholdHours": 36,
        "isOverdue": false
      },
      "tags": ["follow-up", "hot-lead", "2bhk"],
      "checklist": [
        { "_id": "abc123", "text": "Call lead", "isCompleted": true, "completedBy": "...", "completedAt": "...", "order": 1 },
        { "_id": "abc124", "text": "Send cost sheet", "isCompleted": false, "order": 2 },
        { "_id": "abc125", "text": "Schedule site visit", "isCompleted": false, "order": 3 }
      ],
      "linkedEntity": {
        "entityType": "Lead",
        "entityId": "507f1f77bcf86cd799439022",
        "displayLabel": "Ravi Sharma"
      },
      "parentTask": null,
      "depth": 0,
      "comments": [
        {
          "_id": "comment1",
          "text": "Called Ravi, he's interested. @Ravi check payment options.",
          "author": { "_id": "...", "firstName": "Priya", "lastName": "Patel", "email": "priya@company.com" },
          "mentions": [{ "_id": "...", "firstName": "Ravi", "lastName": "Kumar" }],
          "isEdited": false,
          "createdAt": "2026-02-10T14:00:00.000Z"
        }
      ],
      "activityLog": [
        { "action": "created", "performedBy": "...", "performedAt": "...", "details": { "title": "...", "category": "Lead & Sales" } },
        { "action": "status_changed", "performedBy": "...", "performedAt": "...", "previousValue": "Open", "newValue": "In Progress" }
      ],
      "escalations": [],
      "currentEscalationLevel": 0,
      "autoGenerated": {
        "isAutoGenerated": false
      },
      "resolution": null,
      "attachments": [],
      "recurrence": {
        "isRecurring": false
      },
      "createdBy": { "_id": "...", "firstName": "Admin", "lastName": "User", "email": "admin@company.com" },
      "createdFromTemplate": null,
      "createdAt": "2026-02-10T10:30:00.000Z",
      "updatedAt": "2026-02-10T14:00:00.000Z",
      "displayId": "TASK-001",
      "daysUntilDue": 5,
      "isOverdue": false,
      "overdueDays": 0,
      "checklistProgress": 33,
      "resolutionTimeHours": null
    },
    "subTasks": [
      {
        "_id": "subtask1",
        "title": "Send cost sheet to Ravi",
        "taskNumber": "TASK-002",
        "status": "Open",
        "priority": "Medium",
        "dueDate": "2026-02-13T00:00:00.000Z",
        "assignedTo": { "_id": "...", "firstName": "Priya", "lastName": "Patel", "email": "priya@company.com" },
        "depth": 1
      }
    ]
  }
}
```

**Key fields for the detail view**:
- `subTasks` array is returned separately from the task object
- `comments` and `activityLog` are included only in detail view
- `checklistProgress` is a virtual (percentage 0-100, or `null` if no checklist)
- `displayId` is the human-readable task number ("TASK-001")

---

#### Update Task

```http
PUT /api/tasks/:id
```

**Permission**: `tasks:update`

**Request Body** (all fields optional, send only what changed):
```json
{
  "title": "Updated title",
  "description": "Updated description",
  "category": "Lead & Sales",
  "priority": "Critical",
  "dueDate": "2026-02-20T00:00:00.000Z",
  "startDate": "2026-02-11T00:00:00.000Z",
  "tags": ["urgent", "escalated"],
  "checklist": [
    { "text": "Item 1", "order": 1 },
    { "text": "Item 2", "order": 2 }
  ],
  "linkedEntity": {
    "entityType": "Lead",
    "entityId": "507f1f77bcf86cd799439022",
    "displayLabel": "Ravi Sharma"
  },
  "sla": {
    "targetResolutionHours": 24
  },
  "assignedTo": "507f1f77bcf86cd799439055",
  "addWatchers": ["507f1f77bcf86cd799439066", "507f1f77bcf86cd799439077"]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | New title |
| `description` | string | New description |
| `category` | string | New category |
| `priority` | string | New priority (logs `priority_changed` in activity) |
| `dueDate` | ISO Date | New due date (logs `due_date_changed` in activity) |
| `startDate` | ISO Date | New start date |
| `tags` | string[] | Replace tags array |
| `checklist` | object[] | Replace checklist array |
| `linkedEntity` | object | Link/update linked entity |
| `sla` | object | Update SLA settings |
| `assignedTo` | ObjectId | Reassign task (logs `reassigned` in activity) |
| `addWatchers` | ObjectId[] | Add users as watchers |

**Response** `200`:
```json
{
  "success": true,
  "message": "Task updated successfully",
  "data": {
    "task": { ... }
  }
}
```

**Note**: Status changes must go through `PUT /api/tasks/:id/status` (not this endpoint). This ensures state machine validation.

---

#### Delete (Cancel) Task

```http
DELETE /api/tasks/:id
```

**Permission**: `tasks:delete`

This does NOT hard-delete the task. It sets status to `Cancelled` and cancels all sub-tasks.

**Response** `200`:
```json
{
  "success": true,
  "message": "Task cancelled successfully"
}
```

---

### 3.2 Status Management

#### Update Task Status

```http
PUT /api/tasks/:id/status
```

**Permission**: `tasks:update`

**Request Body**:
```json
{
  "status": "In Progress",
  "notes": "Starting work on this today",
  "resolution": "Customer confirmed booking after follow-up call"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | string | **Yes** | New status. Must be a valid transition (see [State Machine](#6-status-state-machine)) |
| `notes` | string | No | Optional transition notes (stored in activity log) |
| `resolution` | string | No | Resolution summary. Only applicable when status is `Completed` |

**Response** `200`:
```json
{
  "success": true,
  "message": "Task status updated to 'In Progress'",
  "data": {
    "task": { ... }
  }
}
```

**Error Cases**:
- `400`: Invalid transition (e.g., `Open` -> `Completed` is not allowed)
- `400`: Cannot complete parent task if sub-tasks are still pending (`"Cannot complete task: 2 sub-task(s) still pending"`)

---

### 3.3 Comments

#### Add Comment

```http
POST /api/tasks/:id/comments
```

**Permission**: `tasks:view` (any viewer can comment)

**Request Body**:
```json
{
  "text": "Called Ravi, he's interested in the 3BHK option. @Priya please prepare the cost sheet.",
  "mentions": ["507f1f77bcf86cd799439011"]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `text` | string | **Yes** | Comment text (max 5000 chars) |
| `mentions` | ObjectId[] | No | User IDs of mentioned users. Mentioned users are automatically added as watchers |

**Response** `201`:
```json
{
  "success": true,
  "message": "Comment added successfully",
  "data": {
    "comment": {
      "_id": "comment_abc",
      "text": "Called Ravi, he's interested...",
      "author": {
        "_id": "...",
        "firstName": "Admin",
        "lastName": "User",
        "email": "admin@company.com"
      },
      "mentions": ["507f1f77bcf86cd799439011"],
      "isEdited": false,
      "createdAt": "2026-02-10T14:30:00.000Z"
    }
  }
}
```

**Frontend guidance for @mentions**:
- Implement an `@` autocomplete that searches org users
- Pass mentioned user IDs in the `mentions` array
- Mentioned users automatically become watchers and receive email notifications

---

#### Get Comments (Paginated)

```http
GET /api/tasks/:id/comments
```

**Permission**: `tasks:view`

**Query Parameters**:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | `1` | Page number |
| `limit` | number | `20` | Comments per page |

**Response** `200`:
```json
{
  "success": true,
  "data": {
    "comments": [
      {
        "_id": "comment_abc",
        "text": "Called Ravi, he's interested...",
        "author": {
          "_id": "...",
          "firstName": "Admin",
          "lastName": "User",
          "email": "admin@company.com"
        },
        "mentions": [{ "_id": "...", "firstName": "Priya", "lastName": "Patel" }],
        "isEdited": false,
        "createdAt": "2026-02-10T14:30:00.000Z"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 1,
      "total": 3,
      "limit": 20
    }
  }
}
```

Comments are returned **newest first**.

---

### 3.4 Sub-Tasks

#### Create Sub-Task

```http
POST /api/tasks/:id/subtasks
```

**Permission**: `tasks:create`

Creates a sub-task under the given parent task. Sub-tasks automatically inherit the `linkedEntity` and `organization` from the parent.

**Request Body**:
```json
{
  "title": "Send cost sheet to Ravi Sharma",
  "description": "Prepare and share the 3BHK cost sheet",
  "category": "Lead & Sales",
  "priority": "Medium",
  "assignedTo": "507f1f77bcf86cd799439011",
  "dueDate": "2026-02-13T00:00:00.000Z",
  "checklist": [
    { "text": "Download latest cost sheet template", "order": 1 },
    { "text": "Customize for unit B-302", "order": 2 },
    { "text": "Share via WhatsApp", "order": 3 }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | **Yes** | Sub-task title |
| `description` | string | No | Description |
| `category` | string | No | Defaults to `"General"` |
| `priority` | string | No | Defaults to `"Medium"` |
| `assignedTo` | ObjectId | No | Defaults to creator |
| `dueDate` | ISO Date | No | Due date |
| `checklist` | object[] | No | Checklist items |

**Response** `201`:
```json
{
  "success": true,
  "message": "Sub-task created successfully",
  "data": {
    "task": {
      "_id": "subtask_xyz",
      "taskNumber": "TASK-005",
      "title": "Send cost sheet to Ravi Sharma",
      "parentTask": "60d5ecb54b24a10f58b2f1a3",
      "depth": 1,
      "linkedEntity": { "entityType": "Lead", "entityId": "...", "displayLabel": "Ravi Sharma" },
      ...
    }
  }
}
```

**Constraints**:
- Maximum nesting depth is **3 levels** (parent -> child -> grandchild -> great-grandchild)
- Error `400` if trying to create a sub-task on a task at depth 3: `"Maximum sub-task depth (3) exceeded"`

**Important for completion**: A parent task **cannot** be marked as `Completed` unless all its sub-tasks are either `Completed` or `Cancelled`.

---

### 3.5 Checklist Operations

#### Toggle Checklist Item

```http
PUT /api/tasks/:id/checklist/:itemId
```

**Permission**: `tasks:update`

**Request Body**:
```json
{
  "isCompleted": true
}
```

**Response** `200`:
```json
{
  "success": true,
  "message": "Checklist item completed",
  "data": {
    "item": {
      "_id": "abc123",
      "text": "Call lead to discuss payment options",
      "isCompleted": true,
      "completedBy": "507f1f77bcf86cd799439099",
      "completedAt": "2026-02-10T11:00:00.000Z",
      "order": 1
    },
    "checklistProgress": 33
  }
}
```

**Frontend guidance**: Show a progress bar or percentage based on `checklistProgress` (0-100). When toggling off (`isCompleted: false`), `completedBy` and `completedAt` are cleared.

---

### 3.6 Personal Dashboard (My Tasks)

```http
GET /api/tasks/my
```

**Permission**: `tasks:view`

Returns the logged-in user's tasks organized into actionable groups.

**Query Parameters**:

| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string | Filter by status |
| `priority` | string | Filter by priority |
| `category` | string | Filter by category |

**Response** `200`:
```json
{
  "success": true,
  "data": {
    "overdue": [
      {
        "_id": "...",
        "title": "Collect KYC from Arun",
        "taskNumber": "TASK-003",
        "status": "Open",
        "priority": "High",
        "category": "Document & Compliance",
        "dueDate": "2026-02-08T00:00:00.000Z",
        "createdBy": { "firstName": "Admin", "lastName": "User" },
        "parentTask": null,
        "linkedEntity": { "entityType": "Sale", "entityId": "...", "displayLabel": "Sale - Arun" },
        "tags": ["kyc", "urgent"],
        "checklist": [...]
      }
    ],
    "dueToday": [...],
    "dueThisWeek": [...],
    "inProgress": [...],
    "recentlyCompleted": [...],
    "summary": {
      "overdueCount": 2,
      "dueTodayCount": 3,
      "dueThisWeekCount": 5,
      "inProgressCount": 4,
      "statusCounts": {
        "Open": 8,
        "In Progress": 4,
        "Completed": 12,
        "On Hold": 1
      }
    }
  }
}
```

**Groups explained**:
| Group | Criteria | Sort | Limit |
|-------|----------|------|-------|
| `overdue` | Due date < today, status not Completed/Cancelled | Due date ascending (oldest first) | 50 |
| `dueToday` | Due date = today, status not Completed/Cancelled | Priority ascending (Critical first) | All |
| `dueThisWeek` | Due date = tomorrow through 7 days from now, status not Completed/Cancelled | Due date ascending | All |
| `inProgress` | Status = "In Progress" | Due date ascending | 20 |
| `recentlyCompleted` | Status = "Completed" | CompletedAt descending (newest first) | 10 |

**Recommended UI layout**:
```
+---------------------------------------------+
|  MY TASKS                   [Create Task +]  |
+---------------------------------------------+
|  Overdue (2)    | Due Today (3) | This Week  |
+---------------------------------------------+
|  [Red urgency   | [Today's      | [Upcoming  |
|   cards]        |  cards]       |  cards]    |
+---------------------------------------------+
|  In Progress (4)                             |
+---------------------------------------------+
|  Recently Completed (10)                     |
+---------------------------------------------+
|  Summary Counters: Open(8) InProgress(4)...  |
+---------------------------------------------+
```

---

### 3.7 Team View

```http
GET /api/tasks/team
```

**Permission**: `tasks:view_team`

Returns tasks for the user and their subordinates, with workload analysis.

**Query Parameters**:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | `1` | Page number |
| `limit` | number | `20` | Items per page |
| `status` | string | - | Filter by status |
| `priority` | string | - | Filter by priority |
| `groupBy` | string | `"assignee"` | Grouping mode (currently only `assignee` supported) |

**Response** `200`:
```json
{
  "success": true,
  "data": {
    "tasks": [...],
    "workload": [
      {
        "user": {
          "_id": "507f1f77bcf86cd799439011",
          "firstName": "Priya",
          "lastName": "Patel",
          "email": "priya@company.com",
          "role": "Sales Executive"
        },
        "totalTasks": 8,
        "overdueTasks": 2,
        "criticalTasks": 1,
        "highTasks": 3
      },
      {
        "user": {
          "_id": "507f1f77bcf86cd799439022",
          "firstName": "Rahul",
          "lastName": "Singh",
          "email": "rahul@company.com",
          "role": "Sales Executive"
        },
        "totalTasks": 5,
        "overdueTasks": 0,
        "criticalTasks": 0,
        "highTasks": 1
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 3,
      "total": 45,
      "limit": 20,
      "hasNextPage": true,
      "hasPrevPage": false
    }
  }
}
```

**Subordinates**: The API automatically finds users whose role level is **higher** (numerically) than the current user's role level. For example, a Sales Manager (level 4) sees tasks for Sales Executives (level 5) and Channel Partner Agents (level 6).

**Recommended UI**: Show a team workload widget with per-user task counts, overdue indicators, and a sortable/filterable task list.

---

### 3.8 Overdue Tasks

```http
GET /api/tasks/overdue
```

**Permission**: `tasks:view`

Returns all overdue tasks (due date < now, not Completed/Cancelled).

**Query Parameters**:

| Parameter | Type | Description |
|-----------|------|-------------|
| `category` | string | Filter by category |
| `priority` | string | Filter by priority |
| `assignedTo` | ObjectId | Filter by assignee |

**Note**: Results are automatically scoped by permissions:
- `tasks:view_all` or `tasks:view_team`: sees all matching overdue tasks
- `tasks:view` only: sees only their own overdue tasks

**Response** `200`:
```json
{
  "success": true,
  "data": {
    "tasks": [...],
    "total": 7
  }
}
```

---

### 3.9 Bulk Operations

#### Bulk Assign

```http
PUT /api/tasks/bulk/assign
```

**Permission**: `tasks:bulk_operations`

**Request Body**:
```json
{
  "taskIds": ["task_id_1", "task_id_2", "task_id_3"],
  "assignedTo": "507f1f77bcf86cd799439055"
}
```

**Response** `200`:
```json
{
  "success": true,
  "message": "3 task(s) assigned to Priya Patel",
  "data": {
    "modifiedCount": 3
  }
}
```

**Notes**:
- Only tasks in the same organization are updated
- Tasks with status `Completed` or `Cancelled` are skipped
- The assignee must exist in the same organization

---

#### Bulk Update Status

```http
PUT /api/tasks/bulk/status
```

**Permission**: `tasks:bulk_operations`

**Request Body**:
```json
{
  "taskIds": ["task_id_1", "task_id_2", "task_id_3"],
  "status": "In Progress"
}
```

**Response** `200`:
```json
{
  "success": true,
  "message": "2 task(s) updated, 1 skipped",
  "data": {
    "updated": 2,
    "skipped": 1,
    "errors": [
      {
        "taskId": "task_id_3",
        "taskNumber": "TASK-015",
        "error": "Cannot transition from 'Completed' to 'In Progress'"
      }
    ]
  }
}
```

**Note**: Each task's transition is validated individually against the state machine. Tasks that can't transition are skipped and reported in `errors`.

---

### 3.10 Task Analytics

```http
GET /api/tasks/analytics
```

**Permission**: `tasks:analytics`

Returns comprehensive analytics for the organization's tasks.

**Query Parameters**:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `period` | number | `30` | Number of days to analyze (lookback period) |
| `category` | string | - | Filter by category |

**Response** `200`:
```json
{
  "success": true,
  "data": {
    "period": "30 days",
    "analytics": {
      "statusDistribution": [
        { "_id": "Open", "count": 25 },
        { "_id": "In Progress", "count": 18 },
        { "_id": "Completed", "count": 42 },
        { "_id": "On Hold", "count": 3 },
        { "_id": "Under Review", "count": 5 },
        { "_id": "Cancelled", "count": 2 }
      ],
      "priorityDistribution": [
        { "_id": "Critical", "count": 8 },
        { "_id": "High", "count": 22 },
        { "_id": "Medium", "count": 35 },
        { "_id": "Low", "count": 30 }
      ],
      "categoryDistribution": [
        { "_id": "Lead & Sales", "count": 35 },
        { "_id": "Payment & Collection", "count": 20 },
        { "_id": "Construction", "count": 15 },
        { "_id": "Document & Compliance", "count": 12 },
        { "_id": "Customer Service", "count": 8 },
        { "_id": "Approval", "count": 3 },
        { "_id": "General", "count": 2 }
      ],
      "completionRate": [
        {
          "total": 95,
          "completed": 42,
          "rate": 44.2
        }
      ],
      "overdueAging": [
        { "_id": 0, "count": 5 },
        { "_id": 7, "count": 3 },
        { "_id": 14, "count": 2 },
        { "_id": 30, "count": 1 }
      ],
      "teamWorkload": [
        {
          "_id": "507f1f77bcf86cd799439011",
          "totalTasks": 12,
          "overdueTasks": 2,
          "user": {
            "firstName": "Priya",
            "lastName": "Patel",
            "email": "priya@company.com"
          }
        },
        {
          "_id": "507f1f77bcf86cd799439022",
          "totalTasks": 8,
          "overdueTasks": 0,
          "user": {
            "firstName": "Rahul",
            "lastName": "Singh",
            "email": "rahul@company.com"
          }
        }
      ],
      "avgResolutionTime": [
        {
          "avgHours": 36.5,
          "count": 42
        }
      ],
      "slaCompliance": [
        {
          "total": 38,
          "onTime": 30,
          "complianceRate": 78.9
        }
      ],
      "createdVsCompleted": [
        { "_id": { "year": 2026, "week": 5 }, "created": 12, "completed": 8 },
        { "_id": { "year": 2026, "week": 6 }, "created": 15, "completed": 11 },
        { "_id": { "year": 2026, "week": 7 }, "created": 10, "completed": 9 }
      ],
      "autoGeneratedBreakdown": [
        { "_id": "overdue_payment", "count": 8 },
        { "_id": "missed_follow_up", "count": 5 },
        { "_id": "new_sale_onboarding", "count": 3 },
        { "_id": "delayed_milestone", "count": 2 }
      ]
    }
  }
}
```

**Analytics facets explained**:

| Facet | Description | Recommended Chart |
|-------|-------------|-------------------|
| `statusDistribution` | Task count per status | Donut chart |
| `priorityDistribution` | Task count per priority | Horizontal bar chart |
| `categoryDistribution` | Task count per category | Pie chart |
| `completionRate` | Overall completion percentage | KPI card (e.g., "44.2%") |
| `overdueAging` | Overdue tasks grouped by days: 0-7, 7-14, 14-30, 30+ | Stacked bar / Heat indicator |
| `teamWorkload` | Active tasks per team member with overdue count | Table or bar chart |
| `avgResolutionTime` | Average hours to resolve completed tasks | KPI card (e.g., "36.5h avg") |
| `slaCompliance` | Percentage of tasks completed on time | KPI card + gauge |
| `createdVsCompleted` | Weekly trend of created vs completed tasks | Line chart (dual lines) |
| `autoGeneratedBreakdown` | Count of auto-generated tasks by trigger type | Bar chart |

---

### 3.11 Template CRUD

#### Create Template

```http
POST /api/tasks/templates
```

**Permission**: `tasks:manage_templates`

**Request Body**:
```json
{
  "name": "New Booking Onboarding",
  "description": "Standard onboarding workflow when a sale is booked",
  "category": "Lead & Sales",
  "defaultTitle": "Booking Onboarding: {Customer Name}",
  "defaultDescription": "Complete all onboarding steps for the new booking",
  "defaultPriority": "High",
  "defaultDueDays": 7,
  "defaultTags": ["onboarding", "booking"],
  "checklist": [
    { "text": "Verify all documents received", "order": 1 },
    { "text": "Set up customer portal access", "order": 2 }
  ],
  "subTasks": [
    {
      "title": "Collect KYC Documents",
      "description": "Collect PAN, Aadhaar, and address proof from buyer",
      "category": "Document & Compliance",
      "priority": "High",
      "relativeDueDays": 3,
      "checklist": [
        { "text": "PAN Card copy", "order": 1 },
        { "text": "Aadhaar Card copy", "order": 2 },
        { "text": "Address proof", "order": 3 },
        { "text": "Passport photos", "order": 4 }
      ],
      "order": 1,
      "assigneeRole": "sales-executive"
    },
    {
      "title": "Send Agreement Draft",
      "description": "Prepare and send the sale agreement draft for review",
      "category": "Document & Compliance",
      "priority": "High",
      "relativeDueDays": 5,
      "order": 2,
      "assigneeRole": "finance-manager"
    },
    {
      "title": "Confirm Payment Schedule",
      "description": "Finalize installment schedule with buyer",
      "category": "Payment & Collection",
      "priority": "Medium",
      "relativeDueDays": 7,
      "order": 3,
      "assigneeRole": "sales-executive"
    }
  ],
  "triggerType": "new_sale_onboarding"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | **Yes** | Template name (max 200 chars) |
| `category` | string | **Yes** | Template category |
| `description` | string | No | Template description (max 2000 chars) |
| `defaultTitle` | string | No | Default task title when applied |
| `defaultDescription` | string | No | Default task description |
| `defaultPriority` | string | No | Default priority. Defaults to `"Medium"` |
| `defaultDueDays` | number | No | Days from creation to due date. Defaults to `7` |
| `defaultTags` | string[] | No | Default tags |
| `checklist` | object[] | No | Checklist items for the parent task |
| `subTasks` | object[] | No | Sub-task definitions (see below) |
| `subTasks[].title` | string | **Yes** | Sub-task title |
| `subTasks[].description` | string | No | Sub-task description |
| `subTasks[].category` | string | No | Defaults to parent category |
| `subTasks[].priority` | string | No | Defaults to `"Medium"` |
| `subTasks[].relativeDueDays` | number | No | Due days relative to parent due date (0 = same day) |
| `subTasks[].checklist` | object[] | No | Sub-task checklist |
| `subTasks[].order` | number | No | Display order |
| `subTasks[].assigneeRole` | string | No | Role slug hint (informational, not auto-assigned) |
| `triggerType` | string | No | Auto-generation trigger type |

**Response** `201`:
```json
{
  "success": true,
  "message": "Task template created successfully",
  "data": {
    "template": { ... }
  }
}
```

---

#### Get All Templates

```http
GET /api/tasks/templates
```

**Permission**: `tasks:view`

**Query Parameters**:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `category` | string | - | Filter by category |
| `isActive` | string | `"true"` | Filter by active status |

**Response** `200`:
```json
{
  "success": true,
  "data": {
    "templates": [
      {
        "_id": "template_001",
        "name": "New Booking Onboarding",
        "description": "Standard onboarding workflow...",
        "category": "Lead & Sales",
        "defaultPriority": "High",
        "defaultDueDays": 7,
        "subTasks": [...],
        "checklist": [...],
        "isActive": true,
        "usageCount": 15,
        "triggerType": "new_sale_onboarding",
        "createdBy": { "firstName": "Admin", "lastName": "User" },
        "createdAt": "2026-02-01T00:00:00.000Z"
      }
    ]
  }
}
```

Templates are sorted by `usageCount` descending (most used first).

---

#### Get Template by ID

```http
GET /api/tasks/templates/:templateId
```

**Permission**: `tasks:view`

---

#### Update Template

```http
PUT /api/tasks/templates/:templateId
```

**Permission**: `tasks:manage_templates`

Same fields as create (all optional).

---

#### Delete Template (Soft Delete)

```http
DELETE /api/tasks/templates/:templateId
```

**Permission**: `tasks:manage_templates`

Sets `isActive: false`. System templates cannot be deleted (returns `403`).

---

### 3.12 Apply Template

```http
POST /api/tasks/templates/:templateId/apply
```

**Permission**: `tasks:create`

Creates a parent task plus all defined sub-tasks from the template.

**Request Body**:
```json
{
  "title": "Booking Onboarding: Ravi Sharma",
  "description": "Custom description override",
  "assignedTo": "507f1f77bcf86cd799439011",
  "dueDate": "2026-02-20T00:00:00.000Z",
  "linkedEntity": {
    "entityType": "Sale",
    "entityId": "sale_abc",
    "displayLabel": "Sale - Ravi Sharma"
  },
  "overrides": {
    "priority": "Critical"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | No | Override the template's defaultTitle |
| `description` | string | No | Override the template's defaultDescription |
| `assignedTo` | ObjectId | No | Assignee for parent and all sub-tasks. Defaults to creator |
| `dueDate` | ISO Date | No | Due date for parent. If not provided, calculated from `defaultDueDays` |
| `linkedEntity` | object | No | Entity to link to the task and all sub-tasks |
| `overrides.priority` | string | No | Override the template's defaultPriority |

**Response** `201`:
```json
{
  "success": true,
  "message": "Task created from template 'New Booking Onboarding' with 3 sub-task(s)",
  "data": {
    "task": {
      "_id": "parent_task_id",
      "taskNumber": "TASK-020",
      "title": "Booking Onboarding: Ravi Sharma",
      "status": "Open",
      "priority": "Critical",
      "createdFromTemplate": {
        "_id": "template_001",
        "name": "New Booking Onboarding"
      },
      ...
    },
    "subTaskCount": 3,
    "subTaskIds": ["sub1", "sub2", "sub3"]
  }
}
```

**How sub-task due dates work**: Each sub-task's `relativeDueDays` is added to the parent's `dueDate`. For example:
- Parent due: Feb 20
- Sub-task with `relativeDueDays: 3` -> Due: Feb 23
- Sub-task with `relativeDueDays: 0` -> Due: Feb 20 (same as parent)

---

## 4. Data Models & TypeScript Interfaces

### 4.1 Task

```typescript
interface Task {
  _id: ObjectId;

  // Identification
  taskNumber: string;           // "TASK-001" (auto-generated, unique per org)
  sequenceNumber: number;       // 1, 2, 3... (auto-incremented per org)
  title: string;                // Max 300 chars
  description?: string;         // Max 5000 chars

  // Categorization
  category: TaskCategory;
  tags: string[];               // Lowercase

  // Status & Priority
  status: TaskStatus;           // Default: "Open"
  priority: TaskPriority;       // Default: "Medium"

  // Assignment
  assignedTo?: User;            // Populated: { _id, firstName, lastName, email }
  assignedBy?: User;
  assignmentType: AssignmentType;
  assignmentStatus: 'accepted' | 'pending' | 'declined';
  declineReason?: string;

  // Watchers
  watchers: User[];             // Populated: [{ _id, firstName, lastName, email }]

  // Dates & SLA
  dueDate?: Date;
  startDate?: Date;
  completedAt?: Date;
  sla?: {
    targetResolutionHours?: number;
    warningThresholdHours?: number;
    isOverdue: boolean;         // Auto-calculated on save
    overdueSince?: Date;        // When it became overdue
  };

  // Hierarchy
  parentTask?: Task | null;     // Populated: { _id, title, taskNumber, status }
  depth: number;                // 0 = root, 1 = child, 2 = grandchild, 3 = max

  // Checklist
  checklist: ChecklistItem[];

  // Entity Linking
  linkedEntity?: {
    entityType: LinkedEntityType;
    entityId: ObjectId;
    displayLabel?: string;
  };

  // Recurrence
  recurrence?: {
    isRecurring: boolean;
    pattern?: RecurrencePattern;
    interval?: number;          // Default 1
    dayOfWeek?: number;         // 0-6
    dayOfMonth?: number;        // 1-31
    endDate?: Date;
    nextOccurrence?: Date;
  };

  // Comments (only in detail view)
  comments: Comment[];

  // Attachments
  attachments: ObjectId[];      // File IDs

  // Auto-generation metadata
  autoGenerated?: {
    isAutoGenerated: boolean;
    triggerType?: TriggerType;
    triggerEntityType?: string;
    triggerEntityId?: ObjectId;
    deduplicationKey?: string;
  };

  // Template reference
  createdFromTemplate?: TaskTemplate;  // Populated: { _id, name }

  // Escalation tracking
  escalations: Escalation[];
  currentEscalationLevel: number;  // 0-5

  // Activity log (only in detail view)
  activityLog: ActivityLogEntry[];

  // Resolution
  resolution?: {
    summary?: string;
    resolvedBy?: ObjectId;
    resolvedAt?: Date;
  };

  // Audit
  createdBy: User;              // Populated: { _id, firstName, lastName, email }
  lastModifiedBy?: ObjectId;
  organization: ObjectId;
  createdAt: Date;
  updatedAt: Date;

  // Virtuals (computed, read-only)
  displayId: string;            // "TASK-001"
  daysUntilDue: number | null;  // Positive = days left, negative = overdue days, null = no due date
  isOverdue: boolean;           // true if due date passed and not Completed/Cancelled
  overdueDays: number;          // 0 if not overdue
  checklistProgress: number | null;  // 0-100 percentage, null if no checklist
  resolutionTimeHours: number | null; // Hours from creation to completion
}
```

### 4.2 ChecklistItem

```typescript
interface ChecklistItem {
  _id: ObjectId;
  text: string;                 // Max 500 chars
  isCompleted: boolean;
  completedBy?: ObjectId;
  completedAt?: Date;
  order: number;
}
```

### 4.3 Comment

```typescript
interface Comment {
  _id: ObjectId;
  text: string;                 // Max 5000 chars
  author: User;                 // Populated: { _id, firstName, lastName, email }
  mentions: User[];             // Populated: [{ _id, firstName, lastName }]
  isEdited: boolean;
  editedAt?: Date;
  createdAt: Date;
}
```

### 4.4 ActivityLogEntry

```typescript
interface ActivityLogEntry {
  _id: ObjectId;
  action: ActivityAction;
  performedBy?: ObjectId;
  performedAt: Date;
  details?: any;                // Varies by action type
  previousValue?: any;
  newValue?: any;
}
```

### 4.5 Escalation

```typescript
interface Escalation {
  _id: ObjectId;
  level: number;                // 1-5
  escalatedTo: User;            // Populated: { _id, firstName, lastName, email }
  escalatedAt: Date;
  reason: string;
  acknowledged: boolean;
  acknowledgedAt?: Date;
  resolvedAt?: Date;
}
```

### 4.6 TaskTemplate

```typescript
interface TaskTemplate {
  _id: ObjectId;
  organization: ObjectId;
  name: string;                 // Max 200 chars
  description?: string;         // Max 2000 chars
  category: TaskCategory;

  // Defaults applied when template is used
  defaultTitle?: string;
  defaultDescription?: string;
  defaultPriority: TaskPriority;
  defaultDueDays: number;       // Default: 7
  defaultTags: string[];

  // Parent task checklist
  checklist: TemplateChecklistItem[];

  // Sub-task definitions
  subTasks: TemplateSubTask[];

  // Metadata
  isSystemTemplate: boolean;    // System templates cannot be deleted
  isActive: boolean;
  usageCount: number;           // Incremented each time template is applied
  triggerType?: TriggerType | null;
  createdBy: User;              // Populated: { _id, firstName, lastName }
  createdAt: Date;
  updatedAt: Date;
}

interface TemplateChecklistItem {
  text: string;
  order: number;
}

interface TemplateSubTask {
  _id: ObjectId;
  title: string;                // Required
  description?: string;
  category?: TaskCategory;
  priority: TaskPriority;
  relativeDueDays: number;      // Days relative to parent due date
  checklist: TemplateChecklistItem[];
  order: number;
  assigneeRole?: string;        // Role slug hint (e.g., "sales-executive")
}
```

---

## 5. Enums & Constants

### Task Categories
```typescript
type TaskCategory =
  | 'Lead & Sales'
  | 'Payment & Collection'
  | 'Construction'
  | 'Document & Compliance'
  | 'Customer Service'
  | 'Approval'
  | 'General';
```

### Task Statuses
```typescript
type TaskStatus =
  | 'Open'
  | 'In Progress'
  | 'Under Review'
  | 'Completed'
  | 'On Hold'
  | 'Cancelled';
```

### Task Priorities
```typescript
type TaskPriority = 'Critical' | 'High' | 'Medium' | 'Low';
```

### Assignment Types
```typescript
type AssignmentType =
  | 'direct'                    // Assigned by another user
  | 'self'                      // Self-assigned
  | 'system'                    // Auto-generated by the system
  | 'cross_department_request'; // Cross-department task request
```

### Linked Entity Types
```typescript
type LinkedEntityType =
  | 'Lead'
  | 'Sale'
  | 'PaymentPlan'
  | 'PaymentTransaction'
  | 'Installment'
  | 'Invoice'
  | 'ConstructionMilestone'
  | 'Project'
  | 'Unit'
  | 'Contractor'
  | 'User'
  | 'File';
```

### Trigger Types (for auto-generated tasks)
```typescript
type TriggerType =
  | 'overdue_payment'
  | 'missed_follow_up'
  | 'delayed_milestone'
  | 'pending_approval'
  | 'new_sale_onboarding'
  | 'recurring_schedule'
  | 'manual';
```

### Recurrence Patterns
```typescript
type RecurrencePattern = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly';
```

### Activity Actions
```typescript
type ActivityAction =
  | 'created'
  | 'updated'
  | 'status_changed'
  | 'assigned'
  | 'reassigned'
  | 'priority_changed'
  | 'comment_added'
  | 'checklist_updated'
  | 'due_date_changed'
  | 'watcher_added'
  | 'watcher_removed'
  | 'escalated'
  | 'sub_task_added'
  | 'tag_added'
  | 'tag_removed'
  | 'linked_entity_added'
  | 'template_applied'
  | 'auto_generated'
  | 'bulk_updated'
  | 'accepted'
  | 'declined';
```

---

## 6. Status State Machine

Tasks follow a strict state machine. Only valid transitions are allowed:

```
                    ┌──────────────┐
                    │    Open      │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────────┐
              ▼            ▼                 ▼
        ┌──────────┐  ┌──────────┐   ┌──────────────┐
        │In Progress│  │ On Hold  │   │  Cancelled   │
        └─────┬────┘  └────┬─────┘   └──────┬───────┘
              │             │                │
              ▼             │                │
        ┌───────────┐      │          (can reopen)
        │Under Review│     │                │
        └─────┬─────┘     │                │
              │            │                │
              ▼            ▼                ▼
        ┌──────────┐                 ┌──────────┐
        │ Completed │◄───────────────│  Open    │
        └──────────┘  (reopen)       └──────────┘
```

### Transition Map

| Current Status | Allowed Transitions |
|---------------|---------------------|
| **Open** | `In Progress`, `On Hold`, `Cancelled` |
| **In Progress** | `Under Review`, `On Hold`, `Cancelled`, `Completed` |
| **Under Review** | `In Progress`, `Completed`, `On Hold` |
| **On Hold** | `Open`, `In Progress`, `Cancelled` |
| **Completed** | `Open` (reopen) |
| **Cancelled** | `Open` (reopen) |

### Frontend Guidance

When displaying status change options, use this map to only show valid next statuses:

```javascript
const STATUS_TRANSITIONS = {
  'Open': ['In Progress', 'On Hold', 'Cancelled'],
  'In Progress': ['Under Review', 'On Hold', 'Cancelled', 'Completed'],
  'Under Review': ['In Progress', 'Completed', 'On Hold'],
  'On Hold': ['Open', 'In Progress', 'Cancelled'],
  'Completed': ['Open'],    // Reopen
  'Cancelled': ['Open'],    // Reopen
};
```

### Recommended Status Colors

| Status | Color | Hex |
|--------|-------|-----|
| Open | Blue | `#3B82F6` |
| In Progress | Yellow/Amber | `#F59E0B` |
| Under Review | Purple | `#8B5CF6` |
| Completed | Green | `#10B981` |
| On Hold | Gray | `#6B7280` |
| Cancelled | Red | `#EF4444` |

### Recommended Priority Colors

| Priority | Color | Hex |
|----------|-------|-----|
| Critical | Red | `#DC2626` |
| High | Orange | `#EA580C` |
| Medium | Yellow | `#CA8A04` |
| Low | Green | `#16A34A` |

---

## 7. Auto-Generated Tasks

The system automatically creates tasks based on business triggers. These run on cron schedules (no user action needed).

### Trigger Types

| Trigger | What It Detects | Task Created | Auto-Assigned To | Frequency |
|---------|----------------|--------------|------------------|-----------|
| `overdue_payment` | Installments past due date, not paid/waived/cancelled | "Overdue Payment Follow-up: Installment #X" | Sales person from the linked sale | Hourly check, daily dedup |
| `missed_follow_up` | Leads with follow-up date in the past, not terminal status | "Follow-up Overdue: {Lead Name}" | Lead's assigned agent | Hourly check, daily dedup |
| `delayed_milestone` | Construction milestones past planned end date, not completed | "Delayed Milestone: {Milestone Name}" | Milestone's assigned user | Hourly check, daily dedup |
| `new_sale_onboarding` | Sales with status "Booked" created in last 7 days, no existing onboarding task | "New Booking Onboarding: {Customer Name}" with 5-item checklist | Sales person | Hourly check, one per sale |
| `recurring_schedule` | Recurring tasks whose next occurrence date has arrived | New instance of the recurring task | Same as source task | Every 15 minutes |

### Identifying Auto-Generated Tasks

Auto-generated tasks have:
- `autoGenerated.isAutoGenerated === true`
- `autoGenerated.triggerType` set to one of the trigger types
- `assignmentType === "system"`

**Frontend guidance**: Display a badge or indicator (e.g., "Auto-generated" with a robot icon) for system-created tasks.

### Escalation Rules

Overdue tasks are automatically escalated to managers:

| Time Overdue | Escalation Level | Escalated To |
|-------------|-----------------|--------------|
| 24+ hours | Level 1 | Next manager above assignee |
| 48+ hours | Level 2 | Next level above Level 1 |
| 72+ hours | Level 3 | Next level above Level 2 |

Escalated managers are added as watchers and receive email notifications.

---

## 8. Business Flows & UI Recommendations

### 8.1 Task Creation Flow

```
1. User clicks "Create Task" button
   └── Show task creation form

2. Form fields:
   ├── Title (required)
   ├── Description (rich text editor)
   ├── Category dropdown (7 options)
   ├── Priority selector (4 options with color indicators)
   ├── Assign To (user picker - org users, requires tasks:assign)
   ├── Due Date (date picker)
   ├── Start Date (date picker, optional)
   ├── Tags (tag input with autocomplete)
   ├── Linked Entity (optional entity picker)
   │   ├── Entity Type dropdown
   │   └── Entity search/select
   ├── Checklist builder (add/remove/reorder items)
   └── Recurrence toggle (if enabled, show pattern options)

3. OR: "Create from Template" button
   ├── Template picker (categorized list)
   ├── Override fields: title, assignee, due date, linked entity
   └── Preview sub-tasks that will be created

4. POST /api/tasks or POST /api/tasks/templates/:id/apply

5. On success: navigate to task detail page
```

### 8.2 Task Detail Page

```
+--------------------------------------------------+
| TASK-001                              [Status ▼]  |
| Follow up with Ravi Sharma about 2BHK unit        |
+--------------------------------------------------+
| Category: Lead & Sales  | Priority: [High]        |
| Assigned: Priya Patel   | Due: Feb 15, 2026       |
| Created by: Admin       | Created: Feb 10, 2026   |
| Tags: #follow-up #hot-lead                        |
| Linked: Lead - Ravi Sharma  [→ View Lead]         |
+--------------------------------------------------+
| CHECKLIST (33%)  ████░░░░░░                       |
| [✓] Call lead to discuss payment options           |
| [ ] Send cost sheet via WhatsApp                   |
| [ ] Schedule site visit                            |
+--------------------------------------------------+
| SUB-TASKS (1)                                      |
| TASK-002 | Send cost sheet | Open | Due: Feb 13   |
| [+ Add Sub-Task]                                   |
+--------------------------------------------------+
| COMMENTS                                           |
| Priya: Called Ravi, he's interested. @Admin...     |
| [Add comment box with @mention support]            |
+--------------------------------------------------+
| ACTIVITY LOG                                       |
| Feb 10 14:00 - Status changed: Open → In Progress |
| Feb 10 10:30 - Task created by Admin               |
+--------------------------------------------------+
| WATCHERS: Ravi Kumar  [+ Add Watcher]              |
+--------------------------------------------------+
```

### 8.3 My Tasks Dashboard

Recommended tabs/sections:
1. **Overdue** (red accent) - Tasks past due date
2. **Due Today** (amber accent) - Tasks due today
3. **This Week** (blue accent) - Tasks due in next 7 days
4. **In Progress** (yellow accent) - Active tasks
5. **Recently Completed** (green accent) - Last 10 completed

Plus a summary bar at the top showing counts per status.

### 8.4 Team Tasks View (Manager)

1. **Workload overview** - Cards/bars showing each team member's task count, overdue count, critical tasks
2. **Task list** - All team tasks with assignee, status, priority filters
3. **Bulk actions toolbar** - Select multiple tasks -> Assign / Change Status

### 8.5 Task Kanban Board (Optional UI)

A drag-and-drop Kanban board with columns for each status:

```
| Open | In Progress | Under Review | Completed | On Hold |
|------|-------------|-------------|-----------|---------|
| Card | Card        | Card        | Card      | Card    |
| Card | Card        |             | Card      |         |
| Card |             |             |           |         |
```

On drag-and-drop:
1. Check `STATUS_TRANSITIONS` to validate the move
2. Call `PUT /api/tasks/:id/status` with the new status
3. If invalid transition, show error and snap card back

---

## 9. Error Codes & Handling

### Common Error Responses

| Status | Error | Endpoint | Cause |
|--------|-------|----------|-------|
| `400` | "Task title is required" | POST /api/tasks | Missing title |
| `400` | "Assigned user not found in your organization" | POST/PUT /api/tasks | Invalid assignee ID |
| `400` | "Maximum sub-task depth (3) exceeded" | POST /api/tasks/:id/subtasks | Too many nesting levels |
| `400` | "Status is required" | PUT /api/tasks/:id/status | Missing status field |
| `400` | "Cannot transition from 'Open' to 'Completed'" | PUT /api/tasks/:id/status | Invalid state machine transition |
| `400` | "Cannot complete task: 2 sub-task(s) still pending" | PUT /api/tasks/:id/status | Sub-tasks not done |
| `400` | "Comment text is required" | POST /api/tasks/:id/comments | Empty comment |
| `400` | "Template name and category are required" | POST /api/tasks/templates | Missing required template fields |
| `400` | "taskIds array is required" | PUT /api/tasks/bulk/* | Missing or empty taskIds |
| `400` | "Checklist item not found" | PUT /api/tasks/:id/checklist/:itemId | Invalid checklist item ID |
| `403` | "System templates cannot be deleted" | DELETE /api/tasks/templates/:id | Attempted to delete system template |
| `403` | "Access denied. Required permission: tasks:create" | Any | User lacks required permission |
| `404` | "Task not found" | GET/PUT/DELETE /api/tasks/:id | Invalid ID or wrong organization |
| `404` | "Template not found" | GET/PUT/DELETE templates | Invalid template ID |
| `404` | "Template not found or inactive" | POST templates/:id/apply | Template deactivated |

### Error Response Format

```json
{
  "success": false,
  "message": "Cannot transition from 'Open' to 'Completed'",
  "stack": "..."
}
```

**Frontend tip**: Always check `response.success` and display `response.message` to the user on failure.

---

## API Quick Reference

| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| POST | `/api/tasks` | `tasks:create` | Create task |
| GET | `/api/tasks` | `tasks:view*` | List tasks (paginated, filtered) |
| GET | `/api/tasks/my` | `tasks:view` | My tasks dashboard |
| GET | `/api/tasks/team` | `tasks:view_team` | Team tasks + workload |
| GET | `/api/tasks/overdue` | `tasks:view` | Overdue tasks |
| GET | `/api/tasks/analytics` | `tasks:analytics` | Analytics dashboard |
| GET | `/api/tasks/:id` | `tasks:view` | Task detail |
| PUT | `/api/tasks/:id` | `tasks:update` | Update task fields |
| DELETE | `/api/tasks/:id` | `tasks:delete` | Cancel task |
| PUT | `/api/tasks/:id/status` | `tasks:update` | Change status |
| PUT | `/api/tasks/:id/checklist/:itemId` | `tasks:update` | Toggle checklist item |
| POST | `/api/tasks/:id/comments` | `tasks:view` | Add comment |
| GET | `/api/tasks/:id/comments` | `tasks:view` | Get comments |
| POST | `/api/tasks/:id/subtasks` | `tasks:create` | Create sub-task |
| PUT | `/api/tasks/bulk/assign` | `tasks:bulk_operations` | Bulk reassign |
| PUT | `/api/tasks/bulk/status` | `tasks:bulk_operations` | Bulk status change |
| POST | `/api/tasks/templates` | `tasks:manage_templates` | Create template |
| GET | `/api/tasks/templates` | `tasks:view` | List templates |
| GET | `/api/tasks/templates/:templateId` | `tasks:view` | Template detail |
| PUT | `/api/tasks/templates/:templateId` | `tasks:manage_templates` | Update template |
| DELETE | `/api/tasks/templates/:templateId` | `tasks:manage_templates` | Delete template |
| POST | `/api/tasks/templates/:templateId/apply` | `tasks:create` | Apply template |

---

**Document Version**: 2.0.0
**Last Updated**: 2026-02-10
**API Version**: 2.0.0

For questions or support, contact the backend team or raise an issue in the repository.
