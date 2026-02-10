# Custom Roles & Permissions - Frontend Developer Guide

## Version 2.0.0 | Complete Integration Guide for Role Management UI

---

## Table of Contents

1. [Overview](#1-overview)
2. [What Changed (Migration Summary)](#2-what-changed)
3. [Auth Responses — New Shape](#3-auth-responses--new-shape)
4. [Permission System Concepts](#4-permission-system-concepts)
5. [Frontend Permission Checking](#5-frontend-permission-checking)
6. [Role Management APIs](#6-role-management-apis)
7. [Permission Catalog API](#7-permission-catalog-api)
8. [User Management Changes](#8-user-management-changes)
9. [Ownership Transfer](#9-ownership-transfer)
10. [UI Pages to Build](#10-ui-pages-to-build)
11. [Default Roles & Hierarchy](#11-default-roles--hierarchy)
12. [Error Codes Reference](#12-error-codes-reference)
13. [Complete Permission Catalog](#13-complete-permission-catalog)

---

## 1. Overview

PropVantage now has a **dynamic, organization-scoped permission system**. Instead of hardcoded roles, each organization can:

- Create custom roles with granular permissions
- Define hierarchy levels (who manages whom)
- Assign any combination of 100+ permissions per role
- Protect the Organization Owner role (can't be deleted/modified)

**Key concepts:**
- Permissions follow `module:action` format (e.g., `projects:create`, `sales:view`)
- Roles have a `level` (0 = highest/Owner, 100 = lowest) controlling hierarchy
- The **Organization Owner** role bypasses all permission checks automatically
- 12 default roles are seeded for every new organization (customizable)

---

## 2. What Changed

### Login/Register Response
Both `/api/auth/login` and `/api/auth/register` now return a `roleRef` object containing permissions. **This is the primary source of truth for access control on the frontend.**

### User Objects
All user objects throughout the API now include a populated `roleRef` with the user's role details and permissions array.

### New API Endpoints
A complete `/api/roles` endpoint set for managing roles.

### Backward Compatibility
The legacy `role` string field (e.g., `"Sales Head"`) is still returned for backward compat. You should migrate to reading from `roleRef` instead.

---

## 3. Auth Responses — New Shape

### POST `/api/auth/login`

```json
{
  "_id": "64abc123...",
  "firstName": "Nirpeksh",
  "lastName": "Nandan",
  "email": "n@example.com",
  "role": "Business Head",
  "roleRef": {
    "_id": "64def456...",
    "name": "Organization Owner",
    "slug": "organization-owner",
    "level": 0,
    "permissions": [
      "projects:view",
      "projects:create",
      "projects:update",
      "projects:delete",
      "sales:view",
      "sales:create",
      ...
    ],
    "isOwnerRole": true
  },
  "organization": "64ghi789...",
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```

### POST `/api/auth/register`

Same shape as login, with an additional `organization` object:

```json
{
  "_id": "...",
  "firstName": "...",
  "lastName": "...",
  "email": "...",
  "role": "Business Head",
  "roleRef": {
    "_id": "...",
    "name": "Organization Owner",
    "slug": "organization-owner",
    "level": 0,
    "permissions": ["projects:view", "projects:create", ...],
    "isOwnerRole": true
  },
  "organization": {
    "_id": "...",
    "name": "My Company"
  },
  "token": "..."
}
```

**Important:** The first user to register an organization is always assigned the **Organization Owner** role (level 0, full access).

---

## 4. Permission System Concepts

### Permission Format

All permissions follow `module:action`:

```
projects:view        — Can view projects
projects:create      — Can create new projects
sales:cancel         — Can cancel sales
payments:verify      — Can verify payment transactions
```

### Role Hierarchy (Levels)

Lower number = higher authority. Users can only manage users/roles with a **higher** level number than their own.

| Level | Default Role |
|-------|-------------|
| 0 | Organization Owner (protected) |
| 1 | Business Head |
| 2 | Project Director |
| 3 | Sales Head, Marketing Head, Finance Head |
| 4 | Sales Manager, Finance Manager, Channel Partner Manager |
| 5 | Sales Executive, Channel Partner Admin |
| 6 | Channel Partner Agent |

Custom roles can use any level from 0-100. The level determines:
- **Who can manage whom** — a level 3 user can manage level 4+ users but NOT level 0-3
- **Who can create/modify which roles** — same rule applies
- **Organization Owner (level 0)** always bypasses all checks

### Owner Role Special Behavior

- Bypasses ALL permission checks on every endpoint
- Cannot be deleted
- Cannot have permissions/level/name modified
- Only one user can hold it at a time
- Must be transferred via the dedicated `/api/roles/transfer-ownership` endpoint

---

## 5. Frontend Permission Checking

### Store Permissions on Login

When the user logs in, store `roleRef.permissions` and `roleRef.isOwnerRole` in your auth state (Redux store, Context, etc.):

```javascript
// After login/register API call
const { roleRef, token } = response.data;

const authState = {
  token,
  permissions: roleRef?.permissions || [],
  isOwner: roleRef?.isOwnerRole || false,
  roleLevel: roleRef?.level ?? 100,
  roleName: roleRef?.name || 'Unknown',
};
```

### Permission Check Utility

```javascript
/**
 * Check if the current user has a specific permission
 * @param {string} permission - e.g., "projects:create"
 * @returns {boolean}
 */
function hasPermission(permission) {
  const { isOwner, permissions } = getAuthState();
  if (isOwner) return true; // Owner bypasses everything
  return permissions.includes(permission);
}

/**
 * Check if user has ALL listed permissions (AND logic)
 */
function hasAllPermissions(...perms) {
  const { isOwner, permissions } = getAuthState();
  if (isOwner) return true;
  return perms.every(p => permissions.includes(p));
}

/**
 * Check if user has at least ONE of the listed permissions (OR logic)
 */
function hasAnyPermission(...perms) {
  const { isOwner, permissions } = getAuthState();
  if (isOwner) return true;
  return perms.some(p => permissions.includes(p));
}
```

### React Component Example

```jsx
// PermissionGate component
function PermissionGate({ permission, children, fallback = null }) {
  if (!hasPermission(permission)) return fallback;
  return children;
}

// Usage
<PermissionGate permission="projects:create">
  <Button onClick={createProject}>New Project</Button>
</PermissionGate>

<PermissionGate permission="sales:cancel">
  <Button variant="danger" onClick={cancelSale}>Cancel Sale</Button>
</PermissionGate>
```

### Navigation/Sidebar Filtering

```javascript
const navItems = [
  { label: 'Dashboard', path: '/dashboard', permission: null }, // always visible
  { label: 'Projects', path: '/projects', permission: 'projects:view' },
  { label: 'Leads', path: '/leads', permission: 'leads:view' },
  { label: 'Sales', path: '/sales', permission: 'sales:view' },
  { label: 'Payments', path: '/payments', permission: 'payments:view' },
  { label: 'Invoices', path: '/invoices', permission: 'invoices:view' },
  { label: 'Commissions', path: '/commissions', permission: 'commissions:view' },
  { label: 'Documents', path: '/documents', permission: 'documents:view' },
  { label: 'Construction', path: '/construction', permission: 'construction:view' },
  { label: 'Analytics', path: '/analytics', permission: 'analytics:basic' },
  { label: 'Users', path: '/users', permission: 'users:view' },
  { label: 'Roles', path: '/roles', permission: 'roles:view' },
  { label: 'AI Copilot', path: '/copilot', permission: 'ai:copilot' },
];

const visibleNav = navItems.filter(item =>
  !item.permission || hasPermission(item.permission)
);
```

---

## 6. Role Management APIs

**Base URL:** `/api/roles`
**Auth:** All endpoints require Bearer token

### GET `/api/roles` — List All Roles

**Permission required:** `roles:view`

**Response:**
```json
{
  "success": true,
  "data": {
    "roles": [
      {
        "_id": "64abc...",
        "name": "Organization Owner",
        "slug": "organization-owner",
        "description": "Full access owner role. Cannot be deleted or modified.",
        "level": 0,
        "permissions": ["projects:view", "projects:create", ...],
        "isDefault": true,
        "isOwnerRole": true,
        "isActive": true,
        "createdBy": "64user...",
        "userCount": 1,
        "createdAt": "2025-01-15T...",
        "updatedAt": "2025-01-15T..."
      },
      {
        "_id": "64def...",
        "name": "Sales Head",
        "slug": "sales-head",
        "description": "Leads the sales department with full sales and team access.",
        "level": 3,
        "permissions": ["projects:view", "sales:view", "sales:create", ...],
        "isDefault": true,
        "isOwnerRole": false,
        "isActive": true,
        "userCount": 2,
        ...
      }
    ],
    "total": 12
  }
}
```

**Notes:**
- Sorted by `level` ascending (Owner first, lowest roles last)
- `userCount` shows how many users are assigned to each role
- Only active roles are returned

---

### GET `/api/roles/:id` — Get Role Details

**Permission required:** `roles:view`

**Response:**
```json
{
  "success": true,
  "data": {
    "role": {
      "_id": "64abc...",
      "name": "Sales Manager",
      "slug": "sales-manager",
      "description": "Manages sales team, leads, and day-to-day sales operations.",
      "level": 4,
      "permissions": ["projects:view", "sales:view", "sales:create", ...],
      "isDefault": true,
      "isOwnerRole": false,
      "isActive": true,
      "userCount": 3,
      ...
    }
  }
}
```

---

### POST `/api/roles` — Create Custom Role

**Permission required:** `roles:create`

**Request body:**
```json
{
  "name": "Junior Sales Associate",
  "description": "Entry-level sales role with basic access",
  "level": 7,
  "permissions": [
    "projects:view",
    "units:view",
    "leads:view",
    "leads:create",
    "sales:view",
    "ai:copilot"
  ]
}
```

**Validation rules:**
- `name` — required, max 50 chars, must be unique in org (slug auto-generated)
- `level` — required, 0-100, must be **higher** than the requesting user's level
- `permissions` — required, array of valid permission strings (validated against catalog)

**Response (201):**
```json
{
  "success": true,
  "data": {
    "role": {
      "_id": "64new...",
      "name": "Junior Sales Associate",
      "slug": "junior-sales-associate",
      "description": "Entry-level sales role with basic access",
      "level": 7,
      "permissions": ["projects:view", "units:view", ...],
      "isDefault": false,
      "isOwnerRole": false,
      "isActive": true,
      "createdBy": "64user...",
      ...
    }
  }
}
```

**Error cases:**
| Status | Message |
|--------|---------|
| 400 | `Name, level, and permissions array are required` |
| 400 | `Invalid permissions: xyz:invalid, abc:wrong` |
| 400 | `A role with this name already exists in your organization` |
| 403 | `Cannot create a role at or above your own hierarchy level` |

---

### PUT `/api/roles/:id` — Update Role

**Permission required:** `roles:update`

**Request body (all fields optional):**
```json
{
  "name": "Senior Sales Associate",
  "description": "Updated description",
  "level": 6,
  "permissions": ["projects:view", "sales:view", "sales:create", "leads:view", "leads:create"]
}
```

**Rules:**
- Cannot modify Owner role's name, level, or permissions (only description)
- Cannot modify roles at same or higher level than your own
- If changing level, new level must be lower than your own level (higher number)
- All permission strings validated against the catalog

**Error cases:**
| Status | Message |
|--------|---------|
| 403 | `Cannot modify the Organization Owner role permissions, level, or name` |
| 403 | `Cannot modify a role at or above your own hierarchy level` |
| 403 | `Cannot set role level at or above your own hierarchy level` |
| 400 | `Invalid permissions: ...` |

---

### DELETE `/api/roles/:id` — Delete Role (Soft Delete)

**Permission required:** `roles:delete`

**Rules:**
- Cannot delete the Owner role
- Cannot delete roles at same or higher level
- **Cannot delete roles that still have users assigned** — reassign users first

**Response:**
```json
{
  "success": true,
  "message": "Role \"Junior Sales Associate\" has been deleted"
}
```

**Error cases:**
| Status | Message |
|--------|---------|
| 403 | `Cannot delete the Organization Owner role` |
| 403 | `Cannot delete a role at or above your own hierarchy level` |
| 400 | `Cannot delete role "Sales Manager" — 3 user(s) are still assigned to it. Reassign them first.` |

---

### POST `/api/roles/:id/duplicate` — Clone a Role

**Permission required:** `roles:create`

**Request body (optional):**
```json
{
  "name": "Custom Sales Manager"
}
```

If name is not provided, defaults to `"Original Name (Copy)"`.

**Response (201):**
```json
{
  "success": true,
  "data": {
    "role": {
      "_id": "64new...",
      "name": "Custom Sales Manager",
      "slug": "custom-sales-manager",
      "description": "Manages sales team...",
      "level": 4,
      "permissions": [...same as source...],
      "isDefault": false,
      ...
    }
  }
}
```

This is useful for the UI — let users pick an existing role as a template, then customize permissions.

---

## 7. Permission Catalog API

### GET `/api/roles/permissions/catalog`

**Permission required:** `roles:view`

Returns the full permission catalog grouped by module. **Use this to render permission checkboxes in the role creation/editing UI.**

**Response:**
```json
{
  "success": true,
  "data": {
    "groups": [
      {
        "module": "projects",
        "label": "Projects",
        "permissions": [
          { "key": "projects:view", "action": "view", "label": "View" },
          { "key": "projects:create", "action": "create", "label": "Create" },
          { "key": "projects:update", "action": "update", "label": "Update" },
          { "key": "projects:delete", "action": "delete", "label": "Delete" }
        ]
      },
      {
        "module": "sales",
        "label": "Sales",
        "permissions": [
          { "key": "sales:view", "action": "view", "label": "View" },
          { "key": "sales:create", "action": "create", "label": "Create" },
          { "key": "sales:update", "action": "update", "label": "Update" },
          { "key": "sales:cancel", "action": "cancel", "label": "Cancel" },
          { "key": "sales:analytics", "action": "analytics", "label": "Analytics" },
          { "key": "sales:pipeline", "action": "pipeline", "label": "Pipeline" },
          { "key": "sales:documents", "action": "documents", "label": "Documents" }
        ]
      },
      ...
    ],
    "total": 100
  }
}
```

### Rendering Permission Checkboxes

```jsx
function PermissionEditor({ selectedPermissions, onChange }) {
  const [catalog, setCatalog] = useState(null);

  useEffect(() => {
    fetch('/api/roles/permissions/catalog', { headers: authHeaders() })
      .then(res => res.json())
      .then(data => setCatalog(data.data.groups));
  }, []);

  const togglePermission = (key) => {
    const next = selectedPermissions.includes(key)
      ? selectedPermissions.filter(p => p !== key)
      : [...selectedPermissions, key];
    onChange(next);
  };

  const toggleModule = (module) => {
    const modulePerms = module.permissions.map(p => p.key);
    const allSelected = modulePerms.every(p => selectedPermissions.includes(p));
    if (allSelected) {
      onChange(selectedPermissions.filter(p => !modulePerms.includes(p)));
    } else {
      onChange([...new Set([...selectedPermissions, ...modulePerms])]);
    }
  };

  return (
    <div>
      {catalog?.map(group => (
        <div key={group.module}>
          <h4>
            <input
              type="checkbox"
              checked={group.permissions.every(p => selectedPermissions.includes(p.key))}
              onChange={() => toggleModule(group)}
            />
            {group.label}
          </h4>
          <div style={{ marginLeft: 20 }}>
            {group.permissions.map(perm => (
              <label key={perm.key} style={{ display: 'block' }}>
                <input
                  type="checkbox"
                  checked={selectedPermissions.includes(perm.key)}
                  onChange={() => togglePermission(perm.key)}
                />
                {perm.label}
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

---

## 8. User Management Changes

### User Objects Now Include `roleRef`

All user-related endpoints (`GET /api/users`, `GET /api/users/:id`, `GET /api/users/me`) now return a populated `roleRef`:

```json
{
  "_id": "64abc...",
  "firstName": "Rahul",
  "lastName": "Kumar",
  "email": "rahul@example.com",
  "role": "Sales Manager",
  "roleRef": {
    "_id": "64role...",
    "name": "Sales Manager",
    "slug": "sales-manager",
    "level": 4,
    "permissions": ["projects:view", "sales:view", ...],
    "isOwnerRole": false
  },
  ...
}
```

### Available Roles in Users List

`GET /api/users` now returns `filters.available.roles` from the Role model instead of a hardcoded list:

```json
{
  "success": true,
  "data": {
    "users": [...],
    "filters": {
      "available": {
        "roles": [
          { "name": "Organization Owner", "slug": "organization-owner", "level": 0 },
          { "name": "Business Head", "slug": "business-head", "level": 1 },
          { "name": "Project Director", "slug": "project-director", "level": 2 },
          { "name": "Custom Role", "slug": "custom-role", "level": 7 },
          ...
        ],
        "statuses": ["active", "inactive", "pending", "revoked"]
      }
    }
  }
}
```

Use this to populate role filter dropdowns and role assignment selectors.

### Changing a User's Role

`PUT /api/users/:id` now accepts `roleRef` (the Role document ObjectId):

```json
{
  "roleRef": "64roleObjectId..."
}
```

**Validation rules:**
- Cannot assign a role at the same or higher level than your own (unless you're Owner)
- Cannot assign the Owner role via this endpoint (use transfer-ownership)
- The role must belong to the same organization and be active

**Error cases:**
| Status | Code | Message |
|--------|------|---------|
| 400 | `INVALID_ROLE` | `Invalid role specified` |
| 403 | `INSUFFICIENT_PERMISSIONS` | `You don't have permission to assign this role` |
| 403 | `OWNER_ROLE_RESTRICTED` | `Owner role can only be transferred via the ownership transfer endpoint` |

### User Permissions Object

`GET /api/users/:id` includes a `permissions` object indicating what actions the requesting user can take:

```json
{
  "data": {
    "user": {
      ...
      "permissions": {
        "canEdit": true,
        "canDelete": true,
        "canChangeRole": true,
        "canResendInvitation": false,
        "canRevokeInvitation": false
      }
    }
  }
}
```

Use this to conditionally show/hide edit, delete, and role change buttons.

---

## 9. Ownership Transfer

### POST `/api/roles/transfer-ownership`

**Access:** Only the current Organization Owner can call this.

**Request body:**
```json
{
  "newOwnerId": "64targetUserId..."
}
```

**What happens:**
1. The target user gets the Organization Owner role (level 0, full access)
2. The current owner is demoted to Business Head (level 1)
3. Both changes happen atomically

**Response:**
```json
{
  "success": true,
  "message": "Ownership transferred to Rahul Kumar"
}
```

**Error cases:**
| Status | Message |
|--------|---------|
| 403 | `Only the Organization Owner can transfer ownership` |
| 400 | `newOwnerId is required` |
| 404 | `Target user not found or inactive` |
| 400 | `You are already the owner` |

**UI Recommendation:** Show this as a button only for users with `isOwnerRole: true`. Use a confirmation dialog with password re-entry or a "type the user's name to confirm" pattern, since this action is irreversible without the new owner's cooperation.

---

## 10. UI Pages to Build

### 10.1 Roles List Page (`/roles`)

**Permission gate:** `roles:view`

**Features:**
- Table/card list of all roles from `GET /api/roles`
- Show: name, description, level, user count, isDefault badge, isOwnerRole badge
- Sort by level (hierarchy) — already sorted by API
- "Create Role" button (gate: `roles:create`)
- "Duplicate" action per role (gate: `roles:create`)
- "Edit" action per role (gate: `roles:update`)
- "Delete" action per role (gate: `roles:delete`, disabled if `userCount > 0` or `isOwnerRole`)

**Visual hierarchy suggestion:**
```
Level 0  ┊ Organization Owner    ★ Protected  │ 1 user
Level 1  ┊ Business Head         Default      │ 2 users
Level 2  ┊ Project Director      Default      │ 1 user
Level 3  ┊ Sales Head            Default      │ 3 users
Level 3  ┊ Marketing Head        Default      │ 0 users
Level 3  ┊ Finance Head          Default      │ 1 user
Level 4  ┊ Sales Manager         Default      │ 5 users
Level 4  ┊ Finance Manager       Default      │ 2 users
Level 7  ┊ Junior Associate      Custom       │ 0 users   [Edit] [Delete]
```

### 10.2 Create/Edit Role Page

**Permission gate:** `roles:create` (create) or `roles:update` (edit)

**Form fields:**
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Name | text input | Yes | Max 50 chars. Slug auto-generated by backend |
| Description | textarea | No | Max 200 chars |
| Level | number input/slider | Yes | Must be > requesting user's level. Show "Level 1 = high authority, Level 100 = low authority" |
| Permissions | checkbox grid | Yes | Fetch from `/api/roles/permissions/catalog`. Group by module. "Select All" per module |

**UI flow for creation:**
1. Optionally "Start from template" — load existing role via duplicate endpoint or just copy its permissions
2. Set name, description, level
3. Select permissions via the grouped checkbox grid
4. Submit to `POST /api/roles`

**UI flow for editing:**
1. Load role details from `GET /api/roles/:id`
2. Pre-fill form, pre-check existing permissions
3. Submit to `PUT /api/roles/:id`
4. If Owner role — only description is editable, all other fields disabled

### 10.3 Role Detail Page

**Permission gate:** `roles:view`

Show:
- Role name, description, level, isDefault, isOwnerRole badges
- Number of assigned users (link to users filtered by role)
- Full permissions list grouped by module (read-only view)
- Edit/Delete actions if user has permission

### 10.4 User Profile — Role Display

On the Users tab and individual user profiles, show:
- Role name (from `roleRef.name`)
- Role level indicator (visual badge or hierarchy position)
- Permission count (e.g., "47 permissions")
- Expandable permission list or link to role detail

### 10.5 User Role Assignment

When changing a user's role on the edit user form:
- Show a dropdown of available roles from `GET /api/roles`
- **Filter out roles** with level <= the current user's level (they can't assign those)
- **Filter out** the Owner role (requires separate transfer flow)
- On submit, send `{ roleRef: selectedRole._id }` to `PUT /api/users/:id`

---

## 11. Default Roles & Hierarchy

These 12 roles are seeded automatically for every new organization:

| Level | Role Name | Description | Permission Count |
|-------|-----------|-------------|-----------------|
| 0 | Organization Owner | Full access. Protected. | ALL (~100) |
| 1 | Business Head | Near-complete access. | ~99 |
| 2 | Project Director | Cross-functional operations oversight. | ~93 |
| 3 | Sales Head | Full sales + team management. | ~72 |
| 3 | Marketing Head | Leads, analytics, campaigns. | ~42 |
| 3 | Finance Head | Payments, invoices, commissions. | ~64 |
| 4 | Sales Manager | Day-to-day sales operations. | ~68 |
| 4 | Finance Manager | Financial operations. | ~53 |
| 4 | Channel Partner Manager | Partner relationships. | ~37 |
| 5 | Sales Executive | Frontline sales. | ~36 |
| 5 | Channel Partner Admin | Partner admin access. | ~21 |
| 6 | Channel Partner Agent | External agents, limited access. | ~14 |

Organizations can customize these (rename, add/remove permissions) and create entirely new custom roles.

---

## 12. Error Codes Reference

### Permission-Related Errors

| HTTP Status | Error Message Pattern | Meaning |
|-------------|----------------------|---------|
| 403 | `Missing required permission(s): projects:create` | User's role doesn't include the required permission |
| 403 | `Requires at least one of: sales:view, sales:analytics` | OR-check failed, user has none of the listed permissions |
| 403 | `Cannot create a role at or above your own hierarchy level` | Level constraint |
| 403 | `Cannot modify the Organization Owner role...` | Trying to edit protected Owner role |
| 403 | `Owner role can only be transferred via the ownership transfer endpoint` | Trying to assign Owner via user update |
| 400 | `Invalid permissions: xyz:invalid` | Permission string not in the catalog |
| 400 | `Cannot delete role "..." — N user(s) are still assigned` | Must reassign users before deleting |

### Handling 403 Errors on the Frontend

```javascript
// In your API interceptor (Axios example)
api.interceptors.response.use(
  response => response,
  error => {
    if (error.response?.status === 403) {
      const msg = error.response?.data?.message || '';

      if (msg.includes('Missing required permission')) {
        // Show "You don't have access to this feature" toast
        showToast('Access Denied', 'You lack the required permission for this action.', 'warning');
      } else if (msg.includes('hierarchy level')) {
        showToast('Access Denied', 'You cannot manage roles at or above your own level.', 'warning');
      }
    }
    return Promise.reject(error);
  }
);
```

---

## 13. Complete Permission Catalog

Here is every permission, organized by module. Use this as a reference for building UI gates and understanding what each permission controls.

### Projects (4 permissions)
| Permission | Controls |
|-----------|----------|
| `projects:view` | View project list and details |
| `projects:create` | Create new projects |
| `projects:update` | Edit project details |
| `projects:delete` | Delete projects |

### Towers (6 permissions)
| Permission | Controls |
|-----------|----------|
| `towers:view` | View tower list and details |
| `towers:create` | Create new towers |
| `towers:update` | Edit tower details |
| `towers:delete` | Delete towers |
| `towers:analytics` | View tower analytics |
| `towers:bulk_create_units` | Bulk create units for a tower |

### Units (5 permissions)
| Permission | Controls |
|-----------|----------|
| `units:view` | View unit inventory |
| `units:create` | Create new units |
| `units:update` | Edit unit details |
| `units:delete` | Delete units |
| `units:statistics` | View unit statistics |

### Leads (8 permissions)
| Permission | Controls |
|-----------|----------|
| `leads:view` | View lead list and details |
| `leads:create` | Create new leads |
| `leads:update` | Edit lead details |
| `leads:delete` | Delete leads |
| `leads:assign` | Assign leads to team members |
| `leads:scoring_view` | View AI lead scores |
| `leads:scoring_config` | Configure lead scoring rules |
| `leads:bulk_operations` | Bulk update/import leads |

### Sales (7 permissions)
| Permission | Controls |
|-----------|----------|
| `sales:view` | View sales records |
| `sales:create` | Create new sales |
| `sales:update` | Edit sale details |
| `sales:cancel` | Cancel a sale |
| `sales:analytics` | View sales analytics dashboard |
| `sales:pipeline` | View sales pipeline |
| `sales:documents` | Generate sale documents |

### Payments (8 permissions)
| Permission | Controls |
|-----------|----------|
| `payments:view` | View payment plans and installments |
| `payments:create_plan` | Create payment plans |
| `payments:update_plan` | Modify payment plan terms |
| `payments:record` | Record payment transactions |
| `payments:update_transaction` | Edit payment transaction amounts |
| `payments:verify` | Verify payment transactions |
| `payments:waive` | Waive installments |
| `payments:reports` | View payment reports (overdue, statistics) |

### Project Payments (6 permissions)
| Permission | Controls |
|-----------|----------|
| `project_payments:view_config` | View project payment config |
| `project_payments:update_config` | Update project payment config |
| `project_payments:view_templates` | View payment templates |
| `project_payments:manage_templates` | Create/edit payment templates |
| `project_payments:manage_bank` | Manage bank account details |
| `project_payments:calculate` | Run payment calculations |

### Invoices (7 permissions)
| Permission | Controls |
|-----------|----------|
| `invoices:view` | View invoices |
| `invoices:create` | Create invoices |
| `invoices:update` | Edit invoice details |
| `invoices:cancel` | Cancel invoices |
| `invoices:record_payment` | Record invoice payments |
| `invoices:statistics` | View invoice statistics |
| `invoices:export` | Export invoices to CSV |

### Commissions (9 permissions)
| Permission | Controls |
|-----------|----------|
| `commissions:view` | View commissions |
| `commissions:create` | Create commissions for sales |
| `commissions:manage_structures` | CRUD commission structures |
| `commissions:approve` | Approve commissions |
| `commissions:reject` | Reject commissions |
| `commissions:hold` | Put/release commission holds |
| `commissions:record_payment` | Record commission payments |
| `commissions:reports` | View commission reports and analytics |
| `commissions:recalculate` | Recalculate commissions |

### Documents (9 permissions)
| Permission | Controls |
|-----------|----------|
| `documents:view` | View documents |
| `documents:upload` | Upload documents |
| `documents:update` | Edit document metadata |
| `documents:delete` | Delete documents |
| `documents:manage_categories` | Create/edit/delete document categories |
| `documents:approve` | Approve/reject document submissions |
| `documents:version_control` | Upload new versions of documents |
| `documents:share` | Share documents with users |
| `documents:analytics` | View document analytics |

### Construction (9 permissions)
| Permission | Controls |
|-----------|----------|
| `construction:view` | View construction milestones |
| `construction:create` | Create construction entries |
| `construction:update` | Edit construction data |
| `construction:progress` | Update construction progress |
| `construction:quality_control` | Manage quality control |
| `construction:issues` | Manage construction issues |
| `construction:upload_photos` | Upload construction photos |
| `construction:timeline` | View construction timeline |
| `construction:analytics` | View construction analytics |

### Contractors (7 permissions)
| Permission | Controls |
|-----------|----------|
| `contractors:view` | View contractor list |
| `contractors:create` | Add new contractors |
| `contractors:update` | Edit contractor details |
| `contractors:manage` | Full contractor management |
| `contractors:documents` | Manage contractor documents |
| `contractors:reviews` | View/create contractor reviews |
| `contractors:analytics` | View contractor analytics |

### Pricing (2 permissions)
| Permission | Controls |
|-----------|----------|
| `pricing:cost_sheet` | Access cost sheets |
| `pricing:dynamic_pricing` | Access dynamic pricing controls |

### Budgets (4 permissions)
| Permission | Controls |
|-----------|----------|
| `budgets:view` | View budgets |
| `budgets:update_target` | Update budget targets |
| `budgets:variance_view` | View budget variance reports |
| `budgets:dashboard` | View budget dashboard |

### Analytics (6 permissions)
| Permission | Controls |
|-----------|----------|
| `analytics:basic` | Basic analytics dashboards |
| `analytics:advanced` | Advanced analytics and forecasts |
| `analytics:reports` | Detailed analytics reports |
| `analytics:predictive` | AI predictive analytics |
| `analytics:budget_vs_actual` | Budget vs actual reports |
| `analytics:marketing_roi` | Marketing ROI analysis |

### Users (4 permissions)
| Permission | Controls |
|-----------|----------|
| `users:view` | View user list and profiles |
| `users:update` | Edit user details and roles |
| `users:delete` | Delete/deactivate users |
| `users:invite` | Send invitations to new users |

### Roles (5 permissions)
| Permission | Controls |
|-----------|----------|
| `roles:view` | View roles and permission catalog |
| `roles:create` | Create custom roles |
| `roles:update` | Edit existing roles |
| `roles:delete` | Delete roles |
| `roles:assign` | Assign roles to users |

### Files (2 permissions)
| Permission | Controls |
|-----------|----------|
| `files:upload` | Upload files |
| `files:view` | View/download files |

### AI Features (3 permissions)
| Permission | Controls |
|-----------|----------|
| `ai:insights` | Access AI-powered insights |
| `ai:conversation` | Access AI conversation analysis |
| `ai:copilot` | Access AI Copilot chat |

---

**Total: 100 permissions across 19 modules**
