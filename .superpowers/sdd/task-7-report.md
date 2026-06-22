# Task 7 Report — Dashboards API + Access Control

**Status:** Complete  
**Branch:** `feat/people-performance`

---

## Files produced

| File | Action |
|---|---|
| `services/people/dashboardService.js` | Created |
| `controllers/peopleController.js` | Created |
| `routes/peopleRoutes.js` | Created |
| `server.js` | Modified — added `import peopleRoutes` + `app.use('/api/people', peopleRoutes)` |
| `middleware/authMiddleware.js` | Modified — throttled `lastActiveAt` bump after auth |
| `models/userModel.js` | Modified — added `lastActiveAt: { type: Date, default: null }` field |
| `tests/unit/dashboardService.test.js` | Created |
| `tests/unit/peopleController.test.js` | Created |

---

## Test results

```
Test Suites: 2 passed, 2 total
Tests:       45 passed, 45 total  (0.671 s)
```

### Access-control coverage (key cases)

| Scenario | Result |
|---|---|
| Member requests own dashboard (`/me`) | ✓ allowed |
| Member requests another member (`/member/:otherId`) | ✓ 403 |
| Head requests member OUTSIDE their team | ✓ 403 |
| Head requests their own team member | ✓ allowed |
| Owner requests any user | ✓ allowed (scope=org) |
| `setTargets` guard delegates to `targetService.setTarget` | ✓ non-manager propagates error |
| `getMoraleTeam` for member (scope=self) | ✓ 403 |
| `getMoraleOrg` for non-owner | ✓ 403 |
| Range parsing: all 5 presets + `?from&to` + invalid date | ✓ |

---

## Architecture decisions

- **`assertCanView`** lives in `dashboardService` (not middleware) so it can be called selectively from handlers that need it (flags `?userId`, targets). The controller's `getMe` passes `req.user._id` directly to `getMemberDashboard`, which skips getSubtree entirely for self-view.
- **`lastActiveAt` bump** — fire-and-forget `updateOne` (no await) with an atomic filter `{ lastActiveAt: { $lt: now - 1h } }` prevents concurrent writes from racing past the throttle window.
- **Multer** — memory storage, 25 MB limit, single `audio` field, declared before the `:isoWeek` routes in `peopleRoutes.js` so Express matches the fixed path `/reflections/transcribe` before the parameterized patterns.
- **`protect` applied internally** via `router.use(protect)` inside `peopleRoutes.js`, matching the pattern used by `supportRoutes.js`. Server.js mounts without a second `protect` call.
- **Range default** — `this_month` (resolved via `resolveWindow('month', now)`).
- **Org dashboard** — uses `getTeam(owner)` which returns all org members excluding self; each gets a live `computeMetrics` call. Rate-metric rollup values (conversionRate, taskSlaRate) are replaced with the medians rather than summed.
- **Morale endpoints** — read latest `MoraleSummary` document by descending `isoWeek` sort; no AI calls. Owner can query any head's team morale via `?headId=`.

---

## Concerns / notes

1. **N+1 on org/team dashboards** — each member gets two DB-aggregate queries (`computeMetrics`). For large teams this is acceptable during the initial release (the nightly snapshot job will serve cached values in a later optimization pass).
2. **`computeMetrics` called twice per member dashboard** (current + prior window for trend). This is correct per spec ("live for requested range, prior-window for trend") but doubles query load on the member view. Worth batching in a future optimization.
3. **`teamMedians` in `getMemberDashboard`** — passes the viewer's own `headUser` doc to `teamMedians`. If the viewer is the member themselves, `teamMedians` will compute medians for the member's department head's team (via `getTeam(member)`). The hierarchy service's `getTeam` for a non-head returns the member's own department members, which is the semantically correct peer group.
4. **No rate-limiting** on the people routes. The nightly snapshot job already caps DB load; live endpoints should be rate-limited at the reverse-proxy level for the initial release.

---

Fix round 1
