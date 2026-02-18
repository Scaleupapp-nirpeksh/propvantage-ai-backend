# Project-Level Access Control — Frontend Integration Guide

> **Backend Status:** Fully implemented and deployed. All APIs are live.
> **Date:** February 2026

---

## Table of Contents

1. [Feature Overview](#1-feature-overview)
2. [Key Concepts](#2-key-concepts)
3. [New API Endpoints](#3-new-api-endpoints)
4. [Impact on Existing Pages](#4-impact-on-existing-pages)
5. [New UI Components to Build](#5-new-ui-components-to-build)
6. [User Invitation Flow Changes (IMPORTANT)](#6-user-invitation-flow-changes-important)
7. [Permission Reference](#7-permission-reference)
8. [Role-Permission Matrix](#8-role-permission-matrix)
9. [Error Handling Reference](#9-error-handling-reference)
10. [UX Recommendations](#10-ux-recommendations)

---

## 1. Feature Overview

### What Changed

Previously, **every user in an organization could see and interact with ALL projects**. Now, project visibility is controlled via explicit assignments — a user can only see and operate on projects they have been assigned to.

### Core Rules

| Rule | Description |
|------|-------------|
| **Org Owner has full access** | The Organization Owner always has access to ALL projects automatically — no assignment needed. All other roles must be explicitly assigned. |
| **Org-wide roles remain unchanged** | A user's role (e.g., Sales Manager) still controls WHAT they can do. Project access controls WHERE (which projects) they can operate. |
| **Manual assignment only** | Non-owner users must be explicitly added to projects. The only exceptions are: (1) the Org Owner, who always sees everything, and (2) the project creator, who is auto-assigned when they create a project. |
| **Cascading visibility** | If a user can't access Project X, they won't see ANY data scoped to Project X — leads, sales, units, towers, payments, invoices, commissions, construction milestones, analytics, or AI Copilot responses. |
| **Tasks are NOT filtered** | Tasks are user-level work items and are NOT filtered by project access. If a task links to an entity in an inaccessible project, the task itself is visible, but clicking through to the linked entity will return a 403. |

---

## 2. Key Concepts

### Project Assignment

A "project assignment" is a record that says: *"User X has access to Project Y in Organization Z."*

```
ProjectAssignment {
  _id: ObjectId
  organization: ObjectId     // Always auto-filled from auth context
  user: ObjectId             // The user being granted access
  project: ObjectId          // The project they can access
  assignedBy: ObjectId       // Who granted the access
  assignedAt: Date           // When it was granted
  notes: String              // Optional note (max 500 chars)
  createdAt: Date            // Mongoose timestamp
  updatedAt: Date            // Mongoose timestamp
}
```

### How It Works Under the Hood

1. When a user logs in and makes any authenticated API request, the backend middleware loads their list of accessible project IDs (`req.accessibleProjectIds`).
2. Every list/query endpoint (projects, leads, sales, units, etc.) automatically filters results to only include data from those accessible projects.
3. Every single-item endpoint (get by ID, update, delete) verifies the user has access to that item's project before returning data — otherwise returns **403**.
4. Creating an entity (lead, sale, unit, etc.) for a project the user doesn't have access to returns **403**.

---

## 3. New API Endpoints

**Base URL:** `/api/project-access`
**Authentication:** All endpoints require a valid JWT token.

---

### 3.1 Get My Projects

Returns the list of projects the currently logged-in user has access to.

```
GET /api/project-access/me
```

**Permission Required:** None (any authenticated user)

**Response (200):**
```json
{
  "success": true,
  "count": 3,
  "data": [
    {
      "_id": "assignment_id",
      "organization": "org_id",
      "user": "user_id",
      "project": {
        "_id": "project_id",
        "name": "Prestige Lakeside",
        "type": "residential",
        "status": "active",
        "location": { "city": "Bangalore", "state": "Karnataka" },
        "totalUnits": 200,
        "priceRange": { "min": 4500000, "max": 12000000 }
      },
      "assignedBy": {
        "_id": "assigner_id",
        "firstName": "Rajesh",
        "lastName": "Kumar",
        "email": "rajesh@example.com"
      },
      "assignedAt": "2026-02-15T10:30:00.000Z",
      "notes": "Auto-assigned as project creator",
      "createdAt": "2026-02-15T10:30:00.000Z"
    }
  ]
}
```

**Use this for:** Project selector dropdowns, sidebar navigation, dashboard project filters.

---

### 3.2 Get Users Assigned to a Project

Returns all users who have access to a specific project, along with their role info.

```
GET /api/project-access/projects/:projectId/users
```

**Permission Required:** `project_access:view`

**Response (200):**
```json
{
  "success": true,
  "project": {
    "_id": "project_id",
    "name": "Prestige Lakeside",
    "type": "residential",
    "status": "active"
  },
  "count": 5,
  "data": [
    {
      "_id": "assignment_id",
      "organization": "org_id",
      "user": {
        "_id": "user_id",
        "firstName": "Priya",
        "lastName": "Sharma",
        "email": "priya@example.com",
        "isActive": true,
        "roleRef": {
          "_id": "role_id",
          "name": "Sales Manager",
          "slug": "sales-manager",
          "level": 4
        }
      },
      "project": "project_id",
      "assignedBy": {
        "_id": "assigner_id",
        "firstName": "Rajesh",
        "lastName": "Kumar",
        "email": "rajesh@example.com"
      },
      "assignedAt": "2026-02-15T10:30:00.000Z",
      "notes": ""
    }
  ]
}
```

**Use this for:** "Project Team" panel, managing who has access to a project.

---

### 3.3 Get Projects Assigned to a User

Returns all projects a specific user has access to.

```
GET /api/project-access/users/:userId/projects
```

**Permission Required:** `project_access:view`

**Response (200):**
```json
{
  "success": true,
  "user": {
    "_id": "user_id",
    "firstName": "Priya",
    "lastName": "Sharma",
    "email": "priya@example.com",
    "role": "Sales Manager"
  },
  "count": 2,
  "data": [
    {
      "_id": "assignment_id",
      "project": {
        "_id": "project_id",
        "name": "Prestige Lakeside",
        "type": "residential",
        "status": "active",
        "location": { "city": "Bangalore", "state": "Karnataka" },
        "totalUnits": 200,
        "priceRange": { "min": 4500000, "max": 12000000 }
      },
      "assignedBy": {
        "_id": "assigner_id",
        "firstName": "Rajesh",
        "lastName": "Kumar",
        "email": "rajesh@example.com"
      },
      "assignedAt": "2026-02-15T10:30:00.000Z",
      "notes": ""
    }
  ]
}
```

**Use this for:** User detail/profile page, showing which projects a user can work on.

---

### 3.4 Assign User to a Project

Grant a single user access to a single project.

```
POST /api/project-access/assign
```

**Permission Required:** `project_access:manage`

**Request Body:**
```json
{
  "userId": "user_id",
  "projectId": "project_id",
  "notes": "Assigned for Q1 sales campaign"   // optional, max 500 chars
}
```

**Response (201):**
```json
{
  "success": true,
  "message": "Priya Sharma assigned to Prestige Lakeside",
  "data": {
    "_id": "assignment_id",
    "organization": "org_id",
    "user": "user_id",
    "project": "project_id",
    "assignedBy": "current_user_id",
    "assignedAt": "2026-02-17T08:00:00.000Z",
    "notes": "Assigned for Q1 sales campaign"
  }
}
```

**Error Responses:**

| Status | Code | Scenario |
|--------|------|----------|
| 400 | — | `userId` or `projectId` missing |
| 403 | — | Caller doesn't have access to the target project themselves |
| 404 | — | User or project not found in this organization |
| 409 | — | User already has access to this project (duplicate) |

**Important:** The caller can only assign users to projects they themselves have access to. You cannot grant access to a project you can't see.

---

### 3.5 Bulk Assign Users to Projects

Assign multiple users to multiple projects in one call (cross-product — every user gets access to every project in the request).

```
POST /api/project-access/bulk-assign
```

**Permission Required:** `project_access:manage`

**Request Body:**
```json
{
  "userIds": ["user_id_1", "user_id_2", "user_id_3"],
  "projectIds": ["project_id_1", "project_id_2"],
  "notes": "Onboarding batch"   // optional
}
```

This creates up to 6 assignments (3 users x 2 projects). Duplicates are automatically skipped.

**Response (201):**
```json
{
  "success": true,
  "message": "4 assignment(s) created",
  "requested": 6,
  "created": 4,
  "skippedDuplicates": 2
}
```

**Error Responses:**

| Status | Code | Scenario |
|--------|------|----------|
| 400 | — | Arrays empty or not provided |
| 403 | — | Caller doesn't have access to one or more target projects |

---

### 3.6 Revoke User Access from a Project

Remove a single user's access to a single project.

```
DELETE /api/project-access/revoke
```

**Permission Required:** `project_access:manage`

**Request Body:**
```json
{
  "userId": "user_id",
  "projectId": "project_id"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Project access revoked"
}
```

**Error Responses:**

| Status | Code | Scenario |
|--------|------|----------|
| 400 | — | `userId` or `projectId` missing |
| 404 | — | Assignment not found (user didn't have access) |

**Important behavioral note:** Revoking access does NOT delete any historical data the user created (leads, sales, etc.). It only hides that project's data from them going forward.

---

### 3.7 Bulk Revoke Access

Remove multiple users from multiple projects in one call.

```
POST /api/project-access/bulk-revoke
```

**Permission Required:** `project_access:manage`

**Request Body:**
```json
{
  "userIds": ["user_id_1", "user_id_2"],
  "projectIds": ["project_id_1"]
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "2 assignment(s) revoked",
  "revoked": 2
}
```

---

## 4. Impact on Existing Pages

### What the frontend team MUST understand

Every existing page that shows project-scoped data is now automatically filtered by the backend. **The frontend does NOT need to send a list of accessible project IDs with each request.** The backend reads the user's project assignments from the JWT/session on every request and filters automatically.

However, there are important UX implications:

### 4.1 Pages That Now Return Filtered Data

| Page / Feature | What Changed |
|---|---|
| **Projects list** (`GET /api/projects`) | Only shows projects the user is assigned to. A user with no assignments sees an empty list. |
| **Leads** (`GET /api/leads`) | Only leads belonging to accessible projects are returned. Lead stats are also filtered. |
| **Sales** (`GET /api/sales`) | Only sales for accessible projects. Pipeline and analytics are filtered. |
| **Units** (`GET /api/units`) | Only units in accessible projects. Unit statistics are filtered. |
| **Towers** (`GET /api/towers`) | Only towers in accessible projects. |
| **Payments** (all payment endpoints) | Payment plans, installments, and transactions are filtered by project. Statistics and reports are filtered. |
| **Invoices** (all invoice endpoints) | All invoice data is filtered by accessible projects. |
| **Construction Milestones** | Only milestones for accessible projects. |
| **Analytics / Dashboard** | ALL dashboard analytics, sales summaries, lead funnels, and reports only include data from accessible projects. |
| **Leadership Dashboard** | Aggregations filtered to accessible projects only. |
| **Commissions** | Partner commissions filtered by accessible projects. Commission structures for specific projects are access-checked. |
| **AI Copilot** | ALL copilot responses are scoped to accessible projects. The copilot will only query and return data the user can see. |

### 4.2 Pages That Are NOT Affected

| Page / Feature | Reason |
|---|---|
| **Tasks** | Tasks are user-level work items, not project-scoped. All tasks remain visible regardless of project access. |
| **Users / Team list** | User management is org-wide, not project-scoped. |
| **Roles / Permissions** | RBAC is org-wide. |
| **Chat / Messaging** | Not project-scoped. |
| **Documents** | Not filtered by project access (document categories are org-wide). |
| **Notifications** | Not project-scoped. |

### 4.3 New 403 Errors to Handle

Previously, a 403 only meant "you don't have the right role/permission." Now, 403 can also mean **"you don't have access to this project."**

**New 403 error message:** `"You do not have access to this project"`

The frontend should handle this gracefully — for example, if a user navigates to a project detail page via a direct URL or bookmark for a project they no longer have access to, show a clear message like:

> "You don't have access to this project. Contact your administrator to request access."

### 4.4 Empty States

With project access control, it's now very common for a new user (or a user with limited access) to see **empty lists**. Make sure every list page has a proper empty state:

| Scenario | Suggested Empty State Message |
|---|---|
| User has 0 project assignments | "You haven't been assigned to any projects yet. Contact your administrator to get access." |
| User has project access but no leads | "No leads found for your accessible projects." (not "No leads in the organization") |
| Dashboard shows zeroes | This is expected if the user only has access to projects with no activity. Don't hide sections — show them with zero values. |

---

## 5. New UI Components to Build

### 5.1 Project Access Management Page

**Location:** Settings or Admin area (e.g., `/settings/project-access` or `/admin/project-access`)
**Visibility:** Only for users with `project_access:manage` permission.

This is the primary interface for managing who has access to what.

**Recommended layout — Two-Panel View:**

```
┌─────────────────────────────────────────────────────────────┐
│  Project Access Management                                   │
├──────────────────────────┬──────────────────────────────────┤
│                          │                                   │
│  PROJECT LIST            │  USERS WITH ACCESS               │
│  (left panel)            │  (right panel)                   │
│                          │                                   │
│  ┌────────────────────┐  │  Project: Prestige Lakeside       │
│  │ 🔍 Search projects │  │  ──────────────────────────────   │
│  ├────────────────────┤  │                                   │
│  │ ● Prestige Lake... │  │  [+ Add Users]  [Bulk Add]       │
│  │   Prestige Heig... │  │                                   │
│  │   Green Valley     │  │  ┌──────────────────────────┐    │
│  │   Skyline Tower    │  │  │ Rajesh Kumar              │    │
│  └────────────────────┘  │  │ Organization Owner        │    │
│                          │  │ Added: 15 Feb 2026        │    │
│  Only shows projects     │  │              [Revoke] ✕   │    │
│  the current user has    │  ├──────────────────────────┤    │
│  access to.              │  │ Priya Sharma              │    │
│                          │  │ Sales Manager             │    │
│                          │  │ Added: 15 Feb 2026        │    │
│                          │  │              [Revoke] ✕   │    │
│                          │  └──────────────────────────┘    │
│                          │                                   │
└──────────────────────────┴──────────────────────────────────┘
```

**API calls needed:**
- Left panel: `GET /api/project-access/me` (to list projects the manager has access to)
- Right panel: `GET /api/project-access/projects/:projectId/users` (when a project is selected)
- Add user: `POST /api/project-access/assign` or `POST /api/project-access/bulk-assign`
- Remove user: `DELETE /api/project-access/revoke`

**"Add Users" modal should:**
1. Fetch all org users: `GET /api/users?status=active&limit=100`
2. Cross-reference with users already assigned (from right panel data)
3. Show a multi-select list with checkboxes for unassigned users
4. On submit, call `POST /api/project-access/bulk-assign` with selected user IDs and the current project ID

---

### 5.2 User Profile — Project Access Tab

**Location:** User detail page (e.g., `/users/:userId`)
**Visibility:** Users with `project_access:view` permission.

When viewing a user's profile, add a "Project Access" tab or section showing which projects they can access.

**API call:** `GET /api/project-access/users/:userId/projects`

**Layout:**
```
┌──────────────────────────────────────────────┐
│  User: Priya Sharma                          │
│  Role: Sales Manager                          │
├──────┬───────────┬───────────────────────────┤
│ Info │ Activity  │ Project Access             │
├──────┴───────────┴───────────────────────────┤
│                                               │
│  Assigned to 3 projects:                      │
│                                               │
│  ┌─────────────────────────────────────────┐ │
│  │ Prestige Lakeside       Residential     │ │
│  │ Assigned by: Rajesh Kumar, 15 Feb 2026  │ │
│  │                          [Revoke] ✕     │ │
│  ├─────────────────────────────────────────┤ │
│  │ Prestige Heights        Commercial      │ │
│  │ Assigned by: Rajesh Kumar, 15 Feb 2026  │ │
│  │                          [Revoke] ✕     │ │
│  └─────────────────────────────────────────┘ │
│                                               │
│  [+ Assign to More Projects]                  │
│                                               │
└───────────────────────────────────────────────┘
```

**"Assign to More Projects" modal should:**
1. Fetch projects the current manager has access to: `GET /api/project-access/me`
2. Cross-reference with projects the target user is already assigned to (from the tab data)
3. Show a multi-select list of unassigned projects
4. On submit, call `POST /api/project-access/bulk-assign`

---

### 5.3 Project Detail — Team Members Section

**Location:** Project detail page (e.g., `/projects/:projectId`)

Add a "Team" tab or sidebar section showing who has access.

**API call:** `GET /api/project-access/projects/:projectId/users`

Show avatars/initials, names, roles, and assignment date. Include [+ Add] and [Revoke] buttons if the user has `project_access:manage` permission.

---

## 6. User Invitation Flow Changes (IMPORTANT)

### Current Flow (Before This Feature)

```
Admin clicks "Invite User"
  → Fills in: Name, Email, Role
  → Backend creates user with pending status
  → Admin shares invitation link
  → New user accepts invitation, sets password
  → User can see ALL projects in the organization immediately
```

### New Flow (After This Feature)

```
Admin clicks "Invite User"
  → Fills in: Name, Email, Role
  → STEP ADDED: Select which projects to assign (multi-select)
  → Backend creates user with pending status
  → Backend creates ProjectAssignment records for selected projects
  → Admin shares invitation link
  → New user accepts invitation, sets password
  → User can ONLY see assigned projects
```

### What Needs to Change in the Invitation UI

#### 6.1 Invitation Form — Add Project Selection Step

The current invitation form (`POST /api/invitations/generate`) creates a user. After this succeeds, the frontend must immediately call the project assignment API.

**Updated flow — two API calls:**

```
Step 1: POST /api/invitations/generate
  Body: { firstName, lastName, email, role }
  → Returns: { data: { user: { _id: "new_user_id" }, invitation: {...} } }

Step 2: POST /api/project-access/bulk-assign
  Body: {
    userIds: ["new_user_id"],
    projectIds: ["project_1", "project_2", "project_3"]
  }
  → Returns: { created: 3 }
```

**UI for the invitation form:**

```
┌────────────────────────────────────────────────┐
│  Invite New Team Member                         │
├────────────────────────────────────────────────┤
│                                                 │
│  First Name:    [______________]                │
│  Last Name:     [______________]                │
│  Email:         [______________]                │
│  Role:          [▼ Select Role ]                │
│                                                 │
│  ─── Project Access ────────────────────────   │
│                                                 │
│  Assign to projects: *                          │
│  ┌──────────────────────────────────────────┐  │
│  │ ☑ Prestige Lakeside                      │  │
│  │ ☑ Prestige Heights                       │  │
│  │ ☐ Green Valley Villas                    │  │
│  │ ☐ Skyline Tower                          │  │
│  └──────────────────────────────────────────┘  │
│                                                 │
│  ⓘ The user will only be able to see data      │
│    from the selected projects.                  │
│                                                 │
│  [Select All]  [Deselect All]                  │
│                                                 │
│            [Cancel]  [Send Invitation]          │
│                                                 │
└────────────────────────────────────────────────┘

* Only shows projects the inviter has access to
  (fetched from GET /api/project-access/me)
```

**Important considerations:**
- The project list should ONLY show projects the INVITER has access to (you can't assign someone to a project you don't have access to yourself).
- Making project selection required is recommended. If the admin forgets to assign projects, the new user will log in and see absolutely nothing — confusing and bad UX.
- Show a warning if no projects are selected: *"Warning: This user won't be able to see any projects until you assign them later."*
- After invitation succeeds, show the invitation link AND a summary of assigned projects.

#### 6.2 Pending Invitations List — Show Assigned Projects

The existing pending invitations list/table should show how many projects are assigned to each pending user.

**API call:** After loading invitations, for each pending user, call:
`GET /api/project-access/users/:userId/projects`

Or batch this by displaying an "Assigned Projects" column with a count, and a detail popup.

#### 6.3 Reinvitation Flow

When regenerating an invitation for an existing pending user (`POST /api/invitations/generate` with same email), the project assignments are NOT affected — they persist. But the admin should be able to modify them from the invitation detail or user profile.

---

## 7. Permission Reference

### New Permissions

| Permission Key | String Value | Description |
|---|---|---|
| `PERMISSIONS.PROJECT_ACCESS.VIEW` | `project_access:view` | Can view who is assigned to which projects |
| `PERMISSIONS.PROJECT_ACCESS.MANAGE` | `project_access:manage` | Can assign/revoke users to/from projects |

### Permission Checks in the Frontend

Use these to conditionally show/hide UI elements:

```javascript
// Check if current user can VIEW project assignments
const canViewProjectAccess = user.roleRef.permissions.includes('project_access:view');

// Check if current user can MANAGE (assign/revoke) project access
const canManageProjectAccess = user.roleRef.permissions.includes('project_access:manage');
```

**Conditional rendering examples:**

| UI Element | Condition |
|---|---|
| "Project Access" tab on user profile | `canViewProjectAccess` |
| "Team" section on project detail page | `canViewProjectAccess` |
| "Project Access Management" in settings/admin nav | `canManageProjectAccess` |
| "Add Users" button on project team panel | `canManageProjectAccess` |
| "Revoke" button next to assigned users | `canManageProjectAccess` |
| Project multi-select in invitation form | `canManageProjectAccess` |

---

## 8. Role-Permission Matrix

| Role | Level | `project_access:view` | `project_access:manage` |
|------|-------|----|--------|
| Organization Owner | 0 | Yes | Yes |
| Business Head | 1 | Yes | Yes |
| Project Director | 2 | Yes | Yes |
| Sales Head | 3 | Yes | Yes |
| Marketing Head | 3 | Yes | Yes |
| Finance Head | 3 | Yes | Yes |
| Sales Manager | 4 | Yes | Yes |
| Finance Manager | 4 | Yes | Yes |
| Channel Partner Manager | 4 | Yes | Yes |
| Sales Executive | 5 | Yes | **No** |
| Channel Partner Admin | 5 | Yes | **No** |
| Channel Partner Agent | 6 | Yes | **No** |

**Key takeaway:** Levels 0-4 can manage project assignments. Levels 5-6 can only VIEW who is assigned but cannot add/remove users.

---

## 9. Error Handling Reference

### New Error Scenarios

| HTTP Status | Error Message | When It Occurs | Frontend Action |
|---|---|---|---|
| 403 | `"You do not have access to this project"` | User tries to access a project, lead, sale, unit, etc. that belongs to a project they're not assigned to | Show "Access Denied" message with option to request access |
| 403 | `"You can only grant access to projects you have access to"` | Manager tries to assign someone to a project they don't have access to themselves | Show error; shouldn't happen if the UI only shows accessible projects |
| 409 | `"User already has access to this project"` | Attempting to assign a user who is already assigned | Show info toast; no action needed |
| 404 | `"Assignment not found"` | Attempting to revoke a non-existent assignment | Refresh the list; assignment may have been revoked already |
| 404 | `"User not found in this organization"` | Invalid userId in assign request | Refresh user list |
| 404 | `"Project not found in this organization"` | Invalid projectId in assign request | Refresh project list |

### Differentiating 403 Errors

The frontend currently handles 403 as "insufficient permissions." Now there are two types:

1. **Role-based 403:** User doesn't have the right permission (e.g., `sales:create`). Message will reference the permission or action.
2. **Project-access 403:** User doesn't have access to the project. Message: `"You do not have access to this project"`.

**Suggested handling:**

```javascript
if (error.response?.status === 403) {
  const msg = error.response?.data?.message || '';
  if (msg.includes('do not have access to this project')) {
    // Show project-access-specific UI
    showProjectAccessDenied();
  } else {
    // Show generic permission denied
    showPermissionDenied();
  }
}
```

---

## 10. UX Recommendations

### 10.1 Project Switcher / Selector

Consider adding a **global project selector** in the top navigation bar. This helps users:
- Quickly see which projects they have access to
- Filter the entire app view to a specific project
- Understand the scope of data they're seeing

**API:** `GET /api/project-access/me`

### 10.2 "Request Access" Flow

When a user encounters a 403 project-access error, provide a way to request access rather than just showing an error. This could be as simple as:
- A "Request Access" button that opens a message/notification to users with `project_access:manage`
- Or a link to contact the admin

### 10.3 Onboarding Checklist for New Projects

When a project is created, the creator is auto-assigned but nobody else is. Prompt the creator:

> "You've created **Prestige Lakeside**. Would you like to add team members to this project?"

Then show the bulk-assign UI with the org's users.

### 10.4 Dashboard Awareness

The dashboard should subtly indicate that data is scoped:

> "Showing data for **3 projects** you have access to."

Or show a chip/badge: `3 of 5 projects` — so users know they might not be seeing everything (without exposing specific data they can't see).

### 10.5 Bulk Operations Across Pages

When performing bulk operations (e.g., bulk lead update), the backend will automatically reject any leads from inaccessible projects. The frontend should be aware that the returned list is already filtered, so all visible items are safe to bulk-operate on.

### 10.6 Revocation Confirmation

When revoking access, show a clear warning:

> "Removing **Priya Sharma** from **Prestige Lakeside** will hide all project data from her. Her existing work (leads, sales, etc.) will NOT be deleted but she won't be able to see or edit them. This can be reversed by re-assigning her."

### 10.7 Self-Revocation Warning

The API does NOT prevent a manager from revoking their own access. The frontend should add a client-side check:

```javascript
if (userId === currentUser._id) {
  showWarning("You are about to remove your own access to this project. You won't be able to see this project after this action. Are you sure?");
}
```

---

## Appendix: Quick API Cheat Sheet

| Action | Method | Endpoint | Body |
|---|---|---|---|
| My projects | GET | `/api/project-access/me` | — |
| Project's users | GET | `/api/project-access/projects/:projectId/users` | — |
| User's projects | GET | `/api/project-access/users/:userId/projects` | — |
| Assign one | POST | `/api/project-access/assign` | `{ userId, projectId, notes? }` |
| Assign many | POST | `/api/project-access/bulk-assign` | `{ userIds[], projectIds[], notes? }` |
| Revoke one | DELETE | `/api/project-access/revoke` | `{ userId, projectId }` |
| Revoke many | POST | `/api/project-access/bulk-revoke` | `{ userIds[], projectIds[] }` |

---

## Appendix: Files Changed (Backend Reference)

For backend context if needed during debugging or API inspection:

**New files:** `models/projectAssignmentModel.js`, `utils/projectAccessHelper.js`, `controllers/projectAccessController.js`, `routes/projectAccessRoutes.js`, `data/migrateProjectAccess.js`

**Modified controllers (data now filtered):** `projectController`, `leadController`, `salesController`, `towerController`, `unitController`, `paymentController`, `invoiceController`, `constructionController`, `analyticsController`, `commissionController`, `pricingController`, `leadershipDashboardController`, `aiCopilotController`

**Modified services:** `leadershipDashboardService`, `aiCopilotService`, `copilotFunctions`

**Modified config:** `config/permissions.js`, `data/defaultRoles.js`, `middleware/authMiddleware.js`, `server.js`, `data/seedDemoData.js`
