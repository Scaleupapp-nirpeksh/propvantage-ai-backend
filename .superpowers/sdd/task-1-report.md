# Task 1 Report: Hierarchy Resolver + Role.department

**Status:** DONE  
**Date:** 2026-06-22  
**Tests:** 44/44 passing

---

## What was built

### Files created / modified

| File | Action |
|---|---|
| `services/people/hierarchyService.js` | Created (new service) |
| `tests/unit/hierarchyService.test.js` | Created (unit tests, TDD-first) |
| `models/roleModel.js` | Modified (added optional `department: String` field) |

---

## Design decisions

### Owner detection
The spec said "org owner OR Business Head". Inspecting the codebase revealed:
- There is **no `isOwner` field on User**. The org-owner concept is expressed via `roleRef.isOwnerRole: Boolean` on the Role model (set on the default owner role record).
- The legacy `role` enum has `'Business Head'` as the top-tier named role.
- `isOwnerLevel(user)` therefore returns true when **either** `user.role === 'Business Head'` **or** `user.roleRef?.isOwnerRole === true`. Both cases are covered in tests.

### DEPARTMENT_BY_ROLE map (exact role strings from userModel.js enum)
```
Sales Manager, Sales Executive, Channel Partner Manager,
Channel Partner Admin, Channel Partner Agent  →  Sales Head

Finance Manager  →  Finance Head

Sales Head, Finance Head, Legal Head, CRM Head,
Marketing Head, Project Director  →  Business Head
```
No roles exist yet for Legal, CRM, or Marketing team members in the enum (only their heads). When such roles are added, they can be mapped. Custom roleRef roles use `roleRef.department` to self-declare their department.

### HEAD_ROLE_BY_DEPARTMENT
Maps each head-role key to itself (identity map for the head roles). This lets consumers look up "what is the head role for department X?" by key.

### resolveDepartment resolution order
1. `isOwnerLevel(user)` → `'Business Head'`
2. `user.role` in `DEPARTMENT_BY_ROLE` → mapped head role
3. `user.roleRef?.department` (custom role with explicit tag) → that value
4. Else → `'unassigned'`

### getHeadRoleForUser
Returns the role string of the manager above. `'unassigned'` maps to `'Business Head'` so no user is invisible. Owner-level returns `null`.

### getTeam
Queries the DB for org members whose `role` is in the set of roles that map to the head's role. For owner-level, queries all org members (no role filter). Excludes the head themselves.

### getManagerChain
Walks up the hierarchy step by step. Looks up the first user in the org with the next head role. Stops at owner level or if no user found for that role. MAX_DEPTH=10 guards against runaway loops (practical max is 3: member → head → owner).

### getSubtree
- Owner → `scope: 'org'`, all org member ids
- Head role (in HEAD_ROLES Set) → `scope: 'department'`, team member ids via `getTeam`
- Member / unassigned custom role → `scope: 'self'`, `[user._id]`

Note: `getSubtree` for a custom-role user with a valid `roleRef.department` (e.g. `'Sales Head'`) currently returns `scope: 'self'` because `HEAD_ROLES` only checks `user.role`. This is correct per the brief — the brief's acceptance tests don't require custom-role heads, and `getSubtree` is subtree access control (a custom role user is a member unless their role string is a known Head role). This can be extended later.

---

## Test coverage (44 tests)

| Describe block | Tests |
|---|---|
| DEPARTMENT_BY_ROLE | 7 |
| HEAD_ROLE_BY_DEPARTMENT | 2 |
| resolveDepartment | 8 |
| isOwnerLevel | 5 |
| getHeadRoleForUser | 7 |
| getTeam | 3 |
| getManagerChain | 5 |
| getSubtree | 7 |

All acceptance criteria from task-1-brief.md are covered:
- Sales exec → Sales Head ✓
- CP agent → Sales Head ✓
- Finance manager → Finance Head ✓
- Unmapped custom role → unassigned → Owner subtree ✓
- Owner getSubtree scope 'org' ✓
- Head getSubtree scope 'department' with correct userIds ✓
- Member getSubtree = self only ✓

---

## Concerns / notes for later tasks

1. **Legal/CRM/Marketing member roles**: the user role enum only has their Head roles — no subordinate roles like 'Legal Executive' etc. The `DEPARTMENT_BY_ROLE` map is correct for what exists today; extend when those roles are added to the enum.
2. **Multiple users per head role**: `getManagerChain` uses the first match. PropVantage orgs are expected to have one person per head role. If this assumption is violated, the chain is still valid (just picks one head).
3. **`getTeam` for custom-role heads**: not implemented since no acceptance test requires it and the spec is silent on it. The `getSubtree` design for custom-role heads is self-only, consistent with treating them as members.

---

## Fix round 1

**Date:** 2026-06-22

### Changes made

1. **`tests/unit/hierarchyService.test.js` — `getTeam` Sales Head test tightened (fix 1)**
   - Added assertion that `User.find` is called with `role: { $in: expect.arrayContaining([...]) }` containing all 5 Sales department member roles (Sales Manager, Sales Executive, Channel Partner Manager, Channel Partner Admin, Channel Partner Agent). A bug in the role list will now fail this test.

2. **`tests/unit/hierarchyService.test.js` — new boundary test for `getManagerChain` (fix 2)**
   - Added: `'head role not found in roster → chain terminates gracefully (no hang/throw)'`
   - Mocks `User.find` returning an empty array; asserts the returned chain is `[]` with no throw and no infinite loop.

3. **`services/people/hierarchyService.js` — stale JSDoc comment removed (fix 3)**
   - Deleted the draft line `3. If user.role === 'Business Head' already handled above` from the `resolveDepartment` JSDoc and renumbered the remaining steps.
   - Added a note: `(owner check runs first by design — it short-circuits all other steps)`.

4. **`services/people/hierarchyService.js` — doc contract added to `getSubtree` and note to `resolveDepartment` (fix 4)**
   - `getSubtree`: added a `CONTRACT — scope 'org'` paragraph explaining that when `scope === 'org'` access is unrestricted, the caller must NOT rely on `userIds` membership for self (owner's own id is intentionally excluded), and downstream code should use the scope flag.
   - `resolveDepartment`: the renumbered step 1 now states the owner-level check runs first by design. No behavior changed.

### Test command

```
node --experimental-vm-modules node_modules/jest/bin/jest.js --config jest.unit.config.mjs tests/unit/hierarchyService.test.js
```

### Result

```
Tests: 45 passed, 45 total
```
