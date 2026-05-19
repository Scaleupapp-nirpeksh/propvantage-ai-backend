# Regression test suite

Jest-based contract tests for the PropVantage backend. Each suite exercises a
slice of the API and verifies status codes and response shapes — without
mutating production data.

## Layout

```
tests/regression/
├── _lib/
│   ├── api.js        ← fetch wrapper (reads API_BASE_URL, API_TEST_TOKEN)
│   ├── auth.js       ← acquires a Bearer token (API_TEST_TOKEN or DB-mint)
│   └── setup.js      ← jest globalSetup: pre-flight reachability check
└── suites/
    ├── 00-health.test.js
    ├── 01-auth-gates.test.js          ← every protected route prefix rejects anon
    ├── 02-auth-flow.test.js
    ├── 10-projects.test.js
    ├── 11-leads-sales.test.js
    ├── 12-payments-tasks-notifications.test.js
    ├── 13-analytics-leadership.test.js
    ├── 14-ai-copilot.test.js          ← live LLM call gated by env flag
    ├── 15-competitive-construction.test.js
    └── 16-users-roles.test.js
```

## Running

**Locally against the dev server** (deepest coverage — mints a JWT from your local DB):
```sh
npm run server          # in one terminal
npm run test:regression # in another
```

**Against production** (read-only, safe — but skips auth-required tests unless you provide a token):
```sh
npm run test:regression:prod
# Or with auth (provides a real user token — runs full deep suite):
API_TEST_TOKEN="eyJhbGc…" npm run test:regression:prod
```

**One suite only**:
```sh
npm run test:regression -- suites/10-projects
```

## Auth strategy

Auth is acquired in this order (first one that works wins):

1. `API_TEST_TOKEN` env var — used directly as `Authorization: Bearer …`
2. Local DB mint — if `MONGO_URI` + `JWT_SECRET` are set, finds the first active
   user, signs a 1-hour JWT, uses that. This is how local runs work without
   any token configuration.
3. No auth — auth-required tests print a warning and skip themselves; smoke
   tests (health, auth gates, auth flow) still run.

## How to extend

Add a new file in `suites/`. Use the `itAuthed` helper pattern from
`11-leads-sales.test.js` for any test that needs a token; it skips cleanly if
no auth is available so the suite still runs end-to-end against production.

For tests that *mutate* data, gate them on an env var
(`PROPVANTAGE_ALLOW_MUTATIONS=true`) so they never accidentally fire against
production. None of the existing tests mutate.
