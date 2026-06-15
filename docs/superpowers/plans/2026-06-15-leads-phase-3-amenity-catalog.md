# Leads Refactor — Phase 3: Amenity Catalog + Demand Report — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add an org-scoped amenity catalog so users can add new preferred amenities on the fly (shared across the org), and a "most-wanted amenities" demand report for promoters. Lead documents keep storing `requirements.amenities` as a `string[]`; the catalog is a separate collection that powers the wizard's autocomplete + "+ add" and the report.

**Architecture:** A small pure normalization util (`utils/amenity.js`), a focused `Amenity` model (org-scoped, case-insensitive-unique by a derived `nameLower`), a thin controller with idempotent upsert + a Lead aggregation for demand, a routes file, and a server mount. Pure logic is unit-tested; the DB-touching controller is boot-smoke + manually verified.

**Tech Stack:** Node ESM, Express, Mongoose, Jest (`npm run test:unit`).

**Notes:** Endpoints live under `/api/amenities` (incl. the demand report at `/api/amenities/demand`) so leadRoutes/leadController stay untouched. Permissions reuse `PERMISSIONS.LEADS` (`leads:view` read, `leads:create` write).

---

## File Structure

**Create:**
- `utils/amenity.js` — `normalizeAmenityName(raw)` + `amenityKey(raw)` (pure).
- `models/amenityModel.js` — `Amenity` model (org-scoped, unique `{organization, nameLower}`).
- `controllers/amenityController.js` — `getAmenities`, `createAmenity` (idempotent upsert), `getAmenityDemand` (Lead aggregation).
- `routes/amenityRoutes.js` — `GET /`, `POST /`, `GET /demand`.
- `tests/unit/amenity.test.js`, `tests/unit/amenityModel.test.js`.

**Modify:**
- `server.js` — import + mount `app.use('/api/amenities', amenityRoutes)`.

---

## Task 1: Amenity normalization util

**Files:** Create `utils/amenity.js`; Test `tests/unit/amenity.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/amenity.test.js
import { normalizeAmenityName, amenityKey } from '../../utils/amenity.js';

describe('amenity normalization', () => {
  it('trims and collapses internal whitespace, preserving display case', () => {
    expect(normalizeAmenityName('  Swimming   Pool ')).toBe('Swimming Pool');
    expect(normalizeAmenityName('Gym')).toBe('Gym');
  });
  it('returns empty string for blank/nullish input', () => {
    expect(normalizeAmenityName('   ')).toBe('');
    expect(normalizeAmenityName(undefined)).toBe('');
    expect(normalizeAmenityName(null)).toBe('');
  });
  it('amenityKey lowercases the normalized name (case-insensitive dedupe key)', () => {
    expect(amenityKey('  Swimming   Pool ')).toBe('swimming pool');
    expect(amenityKey('GYM')).toBe('gym');
    expect(amenityKey('Kids Play Area')).toBe('kids play area');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- amenity.test` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// File: utils/amenity.js
// Pure helpers for the org-scoped amenity catalog (2026-06 Leads refactor).
// normalizeAmenityName → display form (trimmed, single-spaced, case preserved).
// amenityKey → case-insensitive dedupe key used for the unique index.

export function normalizeAmenityName(raw) {
  return String(raw == null ? '' : raw).trim().replace(/\s+/g, ' ');
}

export function amenityKey(raw) {
  return normalizeAmenityName(raw).toLowerCase();
}
```

- [ ] **Step 4: Run test to verify it passes** — `npm run test:unit -- amenity.test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add utils/amenity.js tests/unit/amenity.test.js
git commit -m "feat(amenities): pure name-normalization helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Amenity model

**Files:** Create `models/amenityModel.js`; Test `tests/unit/amenityModel.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/amenityModel.test.js
import mongoose from 'mongoose';
import Amenity from '../../models/amenityModel.js';

const valid = (over = {}) => ({
  organization: new mongoose.Types.ObjectId(),
  name: 'Swimming Pool',
  ...over,
});

describe('Amenity model', () => {
  it('validates a minimal valid document', () => {
    expect(new Amenity(valid()).validateSync()).toBeUndefined();
  });
  it('requires organization and name', () => {
    const err = new Amenity({}).validateSync();
    expect(err.errors.organization).toBeDefined();
    expect(err.errors.name).toBeDefined();
  });
  it('defaults usageCount to 0 and createdBy to null', () => {
    const doc = new Amenity(valid());
    expect(doc.usageCount).toBe(0);
    expect(doc.createdBy).toBeNull();
  });
  it('trims the display name', () => {
    const doc = new Amenity(valid({ name: '  Gym  ' }));
    expect(doc.name).toBe('Gym');
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npm run test:unit -- amenityModel` → FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// File: models/amenityModel.js
// Org-scoped amenity catalog (2026-06 Leads refactor). Users can add new
// preferred amenities on the fly; they become available to everyone in the org
// for future leads, and feed the "most-wanted amenities" demand report.
// Leads still store requirements.amenities as a string[]; this is the catalog.

import mongoose from 'mongoose';
import { amenityKey } from '../utils/amenity.js';

const amenitySchema = new mongoose.Schema(
  {
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    // Display form (case preserved).
    name: { type: String, required: true, trim: true },
    // Lowercased dedupe key — set by the pre-validate hook (and explicitly by
    // the controller's idempotent upsert). Backs the case-insensitive unique index.
    nameLower: { type: String, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    usageCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// One catalog entry per (org, case-insensitive name).
amenitySchema.index({ organization: 1, nameLower: 1 }, { unique: true });

// Keep nameLower in sync for document .save() paths (e.g. seeders). The
// controller's findOneAndUpdate sets nameLower directly, so it does not depend
// on this hook.
amenitySchema.pre('validate', function (next) {
  if (this.name) this.nameLower = amenityKey(this.name);
  next();
});

const Amenity = mongoose.model('Amenity', amenitySchema);
export default Amenity;
```

- [ ] **Step 4: Run test to verify it passes** — `npm run test:unit -- amenityModel` → PASS. Then `npm run test:unit` (full) → all green.

- [ ] **Step 5: Commit**

```bash
git add models/amenityModel.js tests/unit/amenityModel.test.js
git commit -m "feat(amenities): org-scoped Amenity model with case-insensitive uniqueness

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Controller + routes + server mount

**Files:** Create `controllers/amenityController.js`, `routes/amenityRoutes.js`; Modify `server.js`

- [ ] **Step 1: Implement the controller**

```js
// File: controllers/amenityController.js
// Org-scoped amenity catalog endpoints + the lead amenity-demand report.

import asyncHandler from 'express-async-handler';
import Amenity from '../models/amenityModel.js';
import Lead from '../models/leadModel.js';
import { normalizeAmenityName, amenityKey } from '../utils/amenity.js';

/**
 * @desc    List the org's amenity catalog (for the lead form autocomplete)
 * @route   GET /api/amenities
 * @access  Private (leads:view)
 */
const getAmenities = asyncHandler(async (req, res) => {
  const amenities = await Amenity.find({ organization: req.user.organization })
    .sort({ name: 1 })
    .select('name usageCount');
  res.json({ success: true, count: amenities.length, data: amenities });
});

/**
 * @desc    Add an amenity to the org catalog (idempotent on case-insensitive name)
 * @route   POST /api/amenities
 * @access  Private (leads:create)
 */
const createAmenity = asyncHandler(async (req, res) => {
  const name = normalizeAmenityName(req.body?.name);
  if (!name) {
    res.status(400);
    throw new Error('Amenity name is required.');
  }
  const nameLower = amenityKey(name);

  // Idempotent: repeated adds of the same (case-insensitive) name return the
  // existing catalog entry instead of erroring on the unique index.
  const amenity = await Amenity.findOneAndUpdate(
    { organization: req.user.organization, nameLower },
    {
      $setOnInsert: {
        organization: req.user.organization,
        name,
        nameLower,
        createdBy: req.user._id,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  res.status(201).json({ success: true, data: amenity });
});

/**
 * @desc    "Most-wanted amenities" — how many leads requested each amenity.
 * @route   GET /api/amenities/demand
 * @access  Private (leads:view)
 */
const getAmenityDemand = asyncHandler(async (req, res) => {
  const demand = await Lead.aggregate([
    { $match: { organization: req.user.organization } },
    { $unwind: '$requirements.amenities' },
    { $group: { _id: '$requirements.amenities', count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
    { $project: { _id: 0, name: '$_id', count: 1 } },
  ]);
  res.json({ success: true, count: demand.length, data: demand });
});

export { getAmenities, createAmenity, getAmenityDemand };
```

- [ ] **Step 2: Implement the routes** (`/demand` is a literal path — it sits before any `/:id` route; there is none here, so order is simple)

```js
// File: routes/amenityRoutes.js
// Org-scoped amenity catalog + lead amenity-demand report.

import express from 'express';
import { getAmenities, createAmenity, getAmenityDemand } from '../controllers/amenityController.js';
import { protect, hasPermission } from '../middleware/authMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';

const router = express.Router();
router.use(protect);

router.get('/demand', hasPermission(PERMISSIONS.LEADS.VIEW), getAmenityDemand);

router.route('/')
  .get(hasPermission(PERMISSIONS.LEADS.VIEW), getAmenities)
  .post(hasPermission(PERMISSIONS.LEADS.CREATE), createAmenity);

export default router;
```

- [ ] **Step 3: Mount in `server.js`**

Add the import alongside the other route imports (near the top route-import block — match the existing style, e.g. next to `import leadRoutes from './routes/leadRoutes.js';`):
```js
import amenityRoutes from './routes/amenityRoutes.js';
```
Then add the mount immediately after the leads mounts. Find:
```js
app.use('/api/leads', leadRoutes);
app.use('/api/leads', leadScoringRoutes);
```
Replace with:
```js
app.use('/api/leads', leadRoutes);
app.use('/api/leads', leadScoringRoutes);
app.use('/api/amenities', amenityRoutes);
```

- [ ] **Step 4: Syntax + boot smoke**

Run:
```bash
node --check controllers/amenityController.js && node --check routes/amenityRoutes.js && node --check server.js
OPENAI_API_KEY=smoke-test node -e "import('./models/amenityModel.js').then(()=>import('./controllers/amenityController.js')).then(()=>import('./routes/amenityRoutes.js')).then(()=>{console.log('OK');process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})"
```
Expected: all parse; prints `OK`.

- [ ] **Step 5: Full unit suite** — `npm run test:unit` → all green (no regressions).

- [ ] **Step 6: Commit**

```bash
git add controllers/amenityController.js routes/amenityRoutes.js server.js
git commit -m "feat(amenities): catalog endpoints + demand report, mounted at /api/amenities

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Verification

- [ ] **Step 1: Full suite** — `npm run test:unit` → all pass (incl. `amenity`, `amenityModel`).
- [ ] **Step 2: Optional live smoke (running server):**
  - `POST /api/amenities {name:"Rooftop Garden"}` → 201, returns the amenity.
  - `POST /api/amenities {name:"  rooftop   garden "}` again → 201, returns the SAME `_id` (idempotent, case/space-insensitive).
  - `GET /api/amenities` → includes "Rooftop Garden".
  - `GET /api/amenities/demand` → array of `{name, count}` sorted by count desc (counts from seeded leads' `requirements.amenities`).

## Self-Review (completed during planning)
- **Coverage:** catalog model ✓, add-on-the-fly idempotent endpoint ✓ (#11 "user gets a + sign to add an amenity, visible to others next time"), demand report ✓ (#11 "report to see what amenities users want most by count"). Leads keep `requirements.amenities: string[]` (no model change). Frontend "+ add" UI is Phase 4.
- **Placeholders:** none.
- **Consistency:** `normalizeAmenityName`/`amenityKey` used by both model hook and controller; `nameLower` set explicitly in the upsert so it doesn't rely on document middleware (findOneAndUpdate skips hooks).
