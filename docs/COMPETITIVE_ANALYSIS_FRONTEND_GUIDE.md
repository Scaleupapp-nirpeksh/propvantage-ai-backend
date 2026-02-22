# Competitive Analysis & AI Recommendation Engine — Frontend Development Guide

> **Single source of truth for building the entire Competitive Analysis UI/UX.**
> Base URL: `http://localhost:3000/api/competitive-analysis`
> All endpoints require `Authorization: Bearer <JWT>` header.

---

## Table of Contents

1. [Feature Overview](#1-feature-overview)
2. [Authentication & Permissions](#2-authentication--permissions)
3. [Data Models & Schemas](#3-data-models--schemas)
4. [API Endpoints — Complete Reference](#4-api-endpoints--complete-reference)
5. [Data Freshness System](#5-data-freshness-system)
6. [UI Pages & Components](#6-ui-pages--components)
7. [User Flows & Interactions](#7-user-flows--interactions)
8. [Enums & Constants](#8-enums--constants)
9. [Error Handling](#9-error-handling)
10. [Integration Touchpoints](#10-integration-touchpoints)
11. [CSV Import/Export](#11-csv-importexport)
12. [AI Analysis Response Schemas](#12-ai-analysis-response-schemas)

---

## 1. Feature Overview

The Competitive Analysis module allows real estate organizations to:

- **Track competitor projects** — Store and manage detailed pricing data for competitor properties in any Indian locality
- **AI-powered web research** — Automatically research competitor data from 99acres, MagicBricks, Housing.com, RERA portals, and developer websites
- **CSV import/export** — Bulk import competitor data from spreadsheets
- **Market intelligence** — View aggregated market stats, trends, demand-supply analysis
- **AI recommendations** — GPT-4 powered analysis generating pricing recommendations, revenue planning, absorption rates, launch timing, and more
- **Dashboard** — At-a-glance view of all competitive data with freshness indicators

### Data Flow

```
Data Entry Methods:
  ┌─────────────┐   ┌──────────┐   ┌──────────────┐
  │ Manual CRUD │   │ CSV File │   │ AI Research  │
  └──────┬──────┘   └────┬─────┘   └──────┬───────┘
         │               │                │
         ▼               ▼                ▼
    ┌─────────────────────────────────────────┐
    │       CompetitorProject Collection      │
    │    (Single source of truth for data)    │
    └─────────────────┬───────────────────────┘
                      │
         ┌────────────┼────────────┐
         ▼            ▼            ▼
  ┌──────────┐  ┌──────────┐  ┌──────────┐
  │ Market   │  │   AI     │  │Dashboard │
  │Overview  │  │Analysis  │  │ Summary  │
  │& Trends  │  │7 types   │  │          │
  └──────────┘  └──────────┘  └──────────┘
```

---

## 2. Authentication & Permissions

### Required Header

```
Authorization: Bearer <JWT_TOKEN>
```

### Permission Strings

| Permission | String Value | Description |
|---|---|---|
| VIEW | `competitive_analysis:view` | View competitors, dashboard, market data, CSV template |
| MANAGE_DATA | `competitive_analysis:manage_data` | Create/update/delete competitors, CSV import/export |
| AI_RESEARCH | `competitive_analysis:ai_research` | Trigger AI web research |
| AI_RECOMMENDATIONS | `competitive_analysis:ai_recommendations` | View/generate AI analysis |
| MANAGE_PROVIDERS | `competitive_analysis:manage_providers` | Configure data providers |

### Role Access Matrix

| Role | Level | VIEW | MANAGE_DATA | AI_RESEARCH | AI_RECOMMENDATIONS | MANAGE_PROVIDERS |
|---|---|---|---|---|---|---|
| Organization Owner | 0 | Yes | Yes | Yes | Yes | Yes |
| Business Head | 1 | Yes | Yes | Yes | Yes | Yes |
| Project Director | 2 | Yes | Yes | Yes | Yes | No |
| Sales Head | 3 | Yes | Yes | Yes | Yes | No |
| Marketing Head | 3 | Yes | Yes | Yes | Yes | No |
| Finance Head | 3 | Yes | No | Yes | Yes | No |
| Sales Manager | 4 | Yes | Yes | No | No | No |
| Finance Manager | 4 | Yes | No | No | No | No |
| Channel Partner Manager | 4 | Yes | No | No | No | No |
| Sales Executive | 5 | No | No | No | No | No |
| Channel Partner Admin | 6 | No | No | No | No | No |
| Channel Partner Agent | 6 | No | No | No | No | No |

---

## 3. Data Models & Schemas

### 3.1 CompetitorProject (Primary Data Model)

This is the core record. Every piece of competitor data lives here.

```typescript
interface CompetitorProject {
  _id: string;               // MongoDB ObjectId
  organization: string;      // ObjectId — auto-set by backend

  // ─── Basic Info ─────────────────────────────────
  projectName: string;       // Required, max 200 chars
  developerName: string;     // Required
  reraNumber?: string;

  // ─── Location ───────────────────────────────────
  location: {
    city: string;            // Required
    state?: string;
    area: string;            // Required — locality/neighborhood
    micromarket?: string;
    pincode?: string;
    coordinates?: {
      latitude: number;
      longitude: number;
    };
  };

  // ─── Classification ─────────────────────────────
  projectType: 'residential' | 'commercial' | 'mixed_use' | 'plotted_development';   // Required
  projectStatus: 'pre_launch' | 'newly_launched' | 'under_construction' | 'ready_to_move' | 'completed';  // Required
  possessionTimeline?: {
    expectedDate?: string;    // ISO date string
    description?: string;     // e.g., "Dec 2027"
  };

  // ─── Scale ──────────────────────────────────────
  totalUnits?: number;
  totalTowers?: number;
  totalAreaAcres?: number;

  // ─── PRICING (Core Competitive Data) ────────────
  pricing: {
    pricePerSqft: {
      min?: number;           // INR per sqft
      max?: number;
      avg?: number;
    };
    basePriceRange: {
      min?: number;           // INR (absolute, e.g., 5000000 for 50 Lakhs)
      max?: number;
    };
    floorRiseCharge?: number;          // INR per floor
    facingPremiums: {
      parkFacing?: number;             // INR
      roadFacing?: number;
      cornerUnit?: number;
      gardenFacing?: number;
      seaFacing?: number;
    };
    plcCharges?: number;               // INR
    parkingCharges: {
      covered?: number;                // INR
      open?: number;
    };
    clubMembershipCharges?: number;    // INR
    maintenanceDeposit?: number;       // INR
    legalCharges?: number;             // INR
    gstRate?: number;                  // Percentage, default 5
    stampDutyRate?: number;            // Percentage
  };

  // ─── Unit Mix ───────────────────────────────────
  unitMix: Array<{
    unitType: string;          // '1BHK', '2BHK', '3BHK', '4BHK', '5BHK', 'Penthouse', 'Studio', 'Villa', 'Shop', 'Office'
    carpetAreaRange?: { min: number; max: number };
    builtUpAreaRange?: { min: number; max: number };
    superBuiltUpAreaRange?: { min: number; max: number };
    priceRange?: { min: number; max: number };              // INR absolute
    pricePerSqftRange?: { min: number; max: number };       // INR per sqft
    totalCount?: number;
    availableCount?: number;
  }>;

  // ─── Amenities ──────────────────────────────────
  amenities: {
    gym: boolean;
    swimmingPool: boolean;
    clubhouse: boolean;
    garden: boolean;
    playground: boolean;
    powerBackup: boolean;
    security24x7: boolean;
    lifts: boolean;
    joggingTrack: boolean;
    indoorGames: boolean;
    multipurposeHall: boolean;
    rainwaterHarvesting: boolean;
    solarPanels: boolean;
    evCharging: boolean;
    concierge: boolean;
    coWorkingSpace: boolean;
    other?: string[];         // Additional custom amenities
  };

  // ─── Payment Plans ──────────────────────────────
  paymentPlans: Array<{
    planName?: string;
    planType?: 'construction_linked' | 'time_based' | 'subvention' | 'flexi' | 'possession_linked' | 'other';
    description?: string;
    bookingAmount?: number;
    bookingPercentage?: number;
  }>;

  // ─── Data Metadata ──────────────────────────────
  dataSource: 'manual' | 'csv_import' | 'ai_research' | 'propstack' | 'squareyards' | 'zapkey' | 'web_research' | 'field_visit';
  dataCollectionDate: string;     // ISO date
  confidenceScore: number;        // 0-100
  dataProvenance: Array<{
    field: string;
    source: string;
    collectedAt: string;
    collectedBy?: string;
    confidence: 'verified' | 'reliable' | 'estimated' | 'unverified';
    notes?: string;
  }>;
  lastVerifiedAt?: string;
  lastVerifiedBy?: string;        // ObjectId of User
  importBatchId?: string;

  // ─── Status & Audit ─────────────────────────────
  isActive: boolean;              // Default true
  notes?: string;                 // Max 2000 chars
  createdBy: string;              // ObjectId — auto-set
  updatedBy?: string;

  // ─── Computed Virtuals (read-only) ──────────────
  isStale: boolean;               // true if data > 90 days old
  dataAgeDays: number;            // Number of days since dataCollectionDate
  amenityCount: number;           // Count of true amenities + other.length

  // ─── Timestamps ─────────────────────────────────
  createdAt: string;
  updatedAt: string;
}
```

**Unique constraint:** `organization + projectName + location.area` — two projects with the same name in the same area within the same org will be rejected (HTTP 409).

### 3.2 MarketDataSnapshot

Periodic aggregated snapshots for trend analysis. Read-only from frontend perspective.

```typescript
interface MarketDataSnapshot {
  _id: string;
  organization: string;
  snapshotScope: {
    city: string;
    area: string;
    micromarket?: string;
  };
  snapshotDate: string;       // ISO date

  marketMetrics: {
    totalActiveProjects: number;
    totalUnitsInMarket: number;
    pricePerSqft: {
      min: number;
      max: number;
      avg: number;
      median: number;
      p25: number;            // 25th percentile
      p75: number;            // 75th percentile
      stdDev: number;
    };
    floorRiseCharge: {
      min: number;
      max: number;
      avg: number;
    };
    unitTypeDistribution: Array<{
      unitType: string;
      count: number;
      percentage: number;
      avgPricePerSqft?: number;
    }>;
    projectStatusDistribution: Array<{
      status: string;
      count: number;
      percentage: number;
    }>;
    amenityPrevalence: Array<{
      amenity: string;
      count: number;
      percentage: number;
    }>;
  };

  trends: {
    pricePerSqftChange: number;           // Percentage change from previous snapshot
    pricePerSqftChangeAbsolute: number;   // INR change
    newProjectsAdded: number;
    projectsCompleted: number;
    supplyChange: number;                 // Percentage
  };

  dataQuality: {
    totalDataPoints: number;
    verifiedDataPoints: number;
    averageConfidenceScore: number;
    staleDataPoints: number;
  };

  generatedBy: 'manual' | 'scheduled' | 'on_demand';
  createdAt: string;
  updatedAt: string;
}
```

### 3.3 CompetitiveAnalysis (AI Analysis Results)

Cached AI-generated analysis. Auto-expires after 24 hours.

```typescript
interface CompetitiveAnalysis {
  _id: string;
  organization: string;

  analysisScope: {
    project: string;              // ObjectId of the user's Project
    city: string;
    area: string;
    competitorProjectIds: string[];
    competitorCount: number;
  };

  analysisType: 'pricing_recommendations' | 'revenue_planning' | 'absorption_rate' |
    'demand_supply_gap' | 'launch_timing' | 'optimal_unit_mix' |
    'marketing_strategy' | 'comprehensive';

  results: any;                   // AI-generated JSON — shape varies by analysisType (see Section 12)

  recommendations: Array<{
    category: 'pricing' | 'revenue' | 'absorption' | 'demand_supply' |
      'launch_timing' | 'unit_mix' | 'marketing' | 'general';
    priority: 'critical' | 'high' | 'medium' | 'low';
    title: string;
    description: string;
    confidenceScore: number;      // 0-100
    estimatedImpact: string;
    actionItems: string[];
  }>;

  marketPositioning?: {
    segment: 'budget' | 'affordable' | 'mid_segment' | 'premium' | 'luxury' | 'ultra_luxury';
    pricePercentile: number;      // 0-100
    competitiveAdvantages: string[];
    competitiveDisadvantages: string[];
  };

  metadata: {
    model: string;                // 'gpt-4'
    tokensUsed?: number;
    generationTimeMs: number;
    promptVersion: string;
    dataQuality: 'high' | 'medium' | 'low' | 'very_low';
    competitorDataFreshness: {
      freshCount: number;         // <30 days
      recentCount: number;        // 30-90 days
      staleCount: number;         // >90 days
    };
  };

  expiresAt: string;              // ISO date — 24h from generation
  isExpired: boolean;
  dataHashAtGeneration: string;   // MD5 hash — if data changes, cache invalidates
  requestedBy: string;

  fromCache: boolean;             // true if returned from cache (no new GPT-4 call)

  createdAt: string;
  updatedAt: string;
}
```

### 3.4 DataProviderConfig

Configuration for data providers. Mostly for admin UI.

```typescript
interface DataProviderConfig {
  _id: string;
  organization: string;
  providerName: 'manual' | 'csv_import' | 'ai_research' | 'propstack' | 'squareyards' | 'zapkey';
  isEnabled: boolean;
  credentials?: {
    apiKey?: string;
    apiSecret?: string;
    baseUrl?: string;
    webhookUrl?: string;
  };
  syncConfig: {
    autoSyncEnabled: boolean;
    syncFrequency: 'daily' | 'weekly' | 'biweekly' | 'monthly';
    lastSyncAt?: string;
    lastSyncStatus: 'success' | 'partial' | 'failed' | 'never';
    lastSyncRecordCount: number;
    lastSyncErrors: string[];
  };
  syncFilters?: {
    cities: string[];
    areas: string[];
    projectTypes: string[];
  };
  csvColumnMapping?: Record<string, string>;
  configuredBy?: string;
  createdAt: string;
  updatedAt: string;
}
```

---

## 4. API Endpoints — Complete Reference

### 4.1 Dashboard

#### `GET /dashboard`

**Permission:** `competitive_analysis:view`

Returns a summary of all competitive data for the organization.

**Response:**
```json
{
  "success": true,
  "data": {
    "totalCompetitors": 42,
    "activeCompetitors": 38,
    "localitiesTracked": 5,
    "localities": [
      {
        "city": "Bangalore",
        "area": "Whitefield",
        "competitorCount": 12,
        "avgConfidenceScore": 65,
        "avgPricePerSqft": 8500,
        "latestDataDate": "2026-02-20T00:00:00.000Z"
      }
    ],
    "sourceDistribution": [
      { "source": "manual", "count": 15 },
      { "source": "ai_research", "count": 18 },
      { "source": "csv_import", "count": 9 }
    ],
    "recentlyAdded": [
      {
        "_id": "...",
        "projectName": "Prestige Lake Ridge",
        "developerName": "Prestige Group",
        "location": { "city": "Bangalore", "area": "Whitefield" },
        "pricing": { "pricePerSqft": { "avg": 8500 } },
        "dataSource": "ai_research",
        "dataCollectionDate": "2026-02-18T00:00:00.000Z",
        "confidenceScore": 55,
        "isStale": false,
        "dataAgeDays": 4
      }
    ],
    "dataFreshness": {
      "freshCount": 30,
      "recentCount": 6,
      "staleCount": 2,
      "oldestDataDate": "2025-11-15T00:00:00.000Z",
      "newestDataDate": "2026-02-20T00:00:00.000Z",
      "overallFreshnessScore": 82,
      "recommendation": "2 competitor records are stale (>90 days old). Consider running AI Research to refresh."
    }
  }
}
```

---

### 4.2 Competitor CRUD

#### `POST /competitors`

**Permission:** `competitive_analysis:manage_data`

Create a new competitor project. Returns HTTP 409 if a project with the same `projectName` + `location.area` already exists.

**Request Body:**
```json
{
  "projectName": "Prestige Lake Ridge",
  "developerName": "Prestige Group",
  "reraNumber": "PRM/KA/RERA/1250/2024",
  "location": {
    "city": "Bangalore",
    "state": "Karnataka",
    "area": "Whitefield",
    "micromarket": "ITPL Zone",
    "pincode": "560066"
  },
  "projectType": "residential",
  "projectStatus": "under_construction",
  "possessionTimeline": {
    "expectedDate": "2028-06-30",
    "description": "June 2028"
  },
  "totalUnits": 500,
  "totalTowers": 5,
  "totalAreaAcres": 12,
  "pricing": {
    "pricePerSqft": { "min": 7500, "max": 9500, "avg": 8500 },
    "basePriceRange": { "min": 5000000, "max": 15000000 },
    "floorRiseCharge": 50,
    "facingPremiums": {
      "parkFacing": 200000,
      "roadFacing": 100000,
      "cornerUnit": 150000
    },
    "plcCharges": 100000,
    "parkingCharges": { "covered": 500000, "open": 200000 },
    "clubMembershipCharges": 200000,
    "maintenanceDeposit": 100000,
    "legalCharges": 50000,
    "gstRate": 5,
    "stampDutyRate": 5.6
  },
  "unitMix": [
    {
      "unitType": "2BHK",
      "carpetAreaRange": { "min": 800, "max": 1000 },
      "priceRange": { "min": 5000000, "max": 8500000 },
      "pricePerSqftRange": { "min": 7500, "max": 8500 },
      "totalCount": 200,
      "availableCount": 120
    },
    {
      "unitType": "3BHK",
      "carpetAreaRange": { "min": 1200, "max": 1500 },
      "priceRange": { "min": 9000000, "max": 15000000 },
      "pricePerSqftRange": { "min": 8000, "max": 9500 },
      "totalCount": 300,
      "availableCount": 200
    }
  ],
  "amenities": {
    "gym": true,
    "swimmingPool": true,
    "clubhouse": true,
    "garden": true,
    "playground": true,
    "powerBackup": true,
    "security24x7": true,
    "lifts": true,
    "joggingTrack": true,
    "evCharging": false,
    "other": ["Yoga Room", "Kids Play Zone"]
  },
  "paymentPlans": [
    {
      "planName": "Construction Linked Plan",
      "planType": "construction_linked",
      "bookingPercentage": 10
    }
  ],
  "dataSource": "manual",
  "confidenceScore": 80,
  "notes": "Major project near ITPL. Verified from site visit."
}
```

**Response (201):**
```json
{
  "success": true,
  "data": { /* full CompetitorProject object */ },
  "message": "Competitor project created successfully"
}
```

**Error Response (409) — Duplicate:**
```json
{
  "success": false,
  "message": "A competitor project named \"Prestige Lake Ridge\" already exists in \"Whitefield\". Use PUT to update it."
}
```

---

#### `GET /competitors`

**Permission:** `competitive_analysis:view`

List all competitor projects with filtering, pagination, and data freshness summary.

**Query Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `city` | string | — | Filter by city (case-insensitive partial match) |
| `area` | string | — | Filter by area/locality (case-insensitive partial match) |
| `projectType` | string | — | Filter by project type enum |
| `projectStatus` | string | — | Filter by project status enum |
| `dataSource` | string | — | Filter by data source enum |
| `isActive` | string | `"true"` | `"true"` or `"false"` |
| `page` | number | 1 | Page number |
| `limit` | number | 20 | Records per page |
| `sortBy` | string | `"dataCollectionDate"` | Field to sort by |
| `sortOrder` | string | `"desc"` | `"asc"` or `"desc"` |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "...",
      "projectName": "Prestige Lake Ridge",
      "developerName": "Prestige Group",
      "location": { "city": "Bangalore", "area": "Whitefield" },
      "projectType": "residential",
      "projectStatus": "under_construction",
      "pricing": {
        "pricePerSqft": { "min": 7500, "max": 9500, "avg": 8500 }
      },
      "dataSource": "manual",
      "dataCollectionDate": "2026-02-20T...",
      "confidenceScore": 80,
      "isStale": false,
      "dataAgeDays": 2,
      "amenityCount": 11,
      "createdBy": { "_id": "...", "firstName": "John", "lastName": "Doe" },
      "createdAt": "2026-02-20T...",
      "updatedAt": "2026-02-20T..."
    }
  ],
  "dataFreshness": {
    "freshCount": 10,
    "recentCount": 2,
    "staleCount": 0,
    "oldestDataDate": "2026-01-15T...",
    "newestDataDate": "2026-02-20T...",
    "overallFreshnessScore": 90,
    "recommendation": null
  },
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 12,
    "totalPages": 1
  }
}
```

---

#### `GET /competitors/:id`

**Permission:** `competitive_analysis:view`

Get full details of a single competitor project.

**Response:**
```json
{
  "success": true,
  "data": { /* full CompetitorProject object with all fields */ }
}
```

---

#### `PUT /competitors/:id`

**Permission:** `competitive_analysis:manage_data`

Update an existing competitor project. Partial updates are supported (send only the fields you want to change).

**Request Body:** Any subset of the CompetitorProject fields (except `organization`, `createdBy`).

**Response:**
```json
{
  "success": true,
  "data": { /* updated CompetitorProject object */ },
  "message": "Competitor project updated successfully"
}
```

---

#### `DELETE /competitors/:id`

**Permission:** `competitive_analysis:manage_data`

Delete a competitor project permanently.

**Response:**
```json
{
  "success": true,
  "message": "Competitor project deleted successfully"
}
```

---

### 4.3 AI Web Research

#### `POST /research`

**Permission:** `competitive_analysis:ai_research`

Trigger AI-powered web research for a locality. This calls OpenAI's web search model to find competitor data from property portals, developer sites, and RERA portals, then structures and saves the results.

**Important UX notes:**
- This is a **long-running operation** (10-30 seconds). Show a loading/progress indicator.
- Costs approximately $0.15-0.25 per research call.
- Results are deduplicated — running research for the same locality again will enrich existing records instead of creating duplicates.

**Request Body:**
```json
{
  "city": "Bangalore",
  "area": "Whitefield",
  "projectType": "residential",
  "additionalContext": "Focus on 2BHK and 3BHK projects near ITPL"
}
```

| Field | Required | Description |
|---|---|---|
| `city` | Yes | City name |
| `area` | Yes | Locality/area name |
| `projectType` | No | Filter: `residential`, `commercial`, `mixed_use`, `plotted_development` |
| `additionalContext` | No | Free-text instructions for the AI researcher |

**Response:**
```json
{
  "success": true,
  "data": {
    "researchId": "67b5a1c2d3e4f5a6b7c8d9e0",
    "status": "completed",
    "projectsFound": 8,
    "projectsCreated": 5,
    "projectsUpdated": 3,
    "projects": [ /* array of saved CompetitorProject objects */ ],
    "sources": [
      { "url": "https://99acres.com/...", "title": "..." },
      { "url": "https://housing.com/...", "title": "..." }
    ],
    "researchSummary": "Found 8 projects in Whitefield, Bangalore. Created 5 new records, enriched 3 existing records.",
    "warnings": [
      "Price data for 2 projects could not be verified — marked as confidence 30"
    ],
    "cost": {
      "searchQueries": 1,
      "extractionQueries": 1,
      "estimatedCost": "$0.15-0.25"
    },
    "durationMs": 15234
  },
  "message": "Found 8 projects in Whitefield, Bangalore. Created 5 new records, enriched 3 existing records."
}
```

**Key fields for UI:**
- `status`: `"completed"` | `"partial"` — show warning badge for partial
- `projectsCreated` / `projectsUpdated`: Show as summary pills
- `warnings`: Display as dismissable alerts
- `sources`: Show as expandable "Research Sources" section with clickable links
- `cost.estimatedCost`: Show to admin users
- `durationMs`: Show as "Completed in X seconds"

---

### 4.4 CSV Import / Export

#### `POST /import-csv`

**Permission:** `competitive_analysis:manage_data`

Upload a CSV file to import competitor data. Uses `multipart/form-data`.

**Request:** `multipart/form-data`

| Field | Type | Required | Description |
|---|---|---|---|
| `file` | File | Yes | CSV file (max 10MB) |
| `city` | string | No | Default city for rows without a city column |
| `area` | string | No | Default area for rows without an area column |
| `columnMapping` | string (JSON) | No | Custom column header to field mapping as JSON string |

**Example fetch call:**
```javascript
const formData = new FormData();
formData.append('file', csvFile);
formData.append('city', 'Bangalore');
formData.append('area', 'Whitefield');

const response = await fetch('/api/competitive-analysis/import-csv', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: formData,
});
```

**Response:**
```json
{
  "success": true,
  "data": {
    "batchId": "67b5a1c2d3e4f5a6b7c8d9e0",
    "totalRows": 10,
    "created": 7,
    "updated": 2,
    "skipped": 1,
    "errors": [
      {
        "row": 5,
        "status": "skipped",
        "errors": ["Missing required field: projectName"]
      }
    ],
    "rowDetails": [
      { "row": 2, "status": "created" },
      { "row": 3, "status": "updated", "fieldsUpdated": 3 },
      { "row": 4, "status": "unchanged" },
      { "row": 5, "status": "skipped", "errors": ["Missing required field: projectName"] }
    ],
    "summary": "Processed 10 rows: 7 created, 2 updated, 1 unchanged/skipped"
  },
  "message": "Processed 10 rows: 7 created, 2 updated, 1 unchanged/skipped"
}
```

**Row status values:**
- `created` — New record created
- `updated` — Existing record enriched (shows `fieldsUpdated` count)
- `unchanged` — Existing record, no new data to merge
- `skipped` — Row skipped due to validation errors
- `error` — Database error during save

---

#### `GET /export-csv`

**Permission:** `competitive_analysis:manage_data`

Download all competitor data as a CSV file.

**Query Parameters:** Same filters as `GET /competitors` — `city`, `area`, `projectType`, `projectStatus`.

**Response:** CSV file download (`Content-Type: text/csv`, `Content-Disposition: attachment; filename="competitor_data.csv"`)

**Example:**
```javascript
const response = await fetch('/api/competitive-analysis/export-csv?city=Bangalore&area=Whitefield', {
  headers: { 'Authorization': `Bearer ${token}` },
});
const blob = await response.blob();
const url = URL.createObjectURL(blob);
// Trigger download
```

---

#### `GET /csv-template`

**Permission:** `competitive_analysis:view`

Download a blank CSV template with headers and one example row.

**Response:** CSV file download (`Content-Type: text/csv`, `Content-Disposition: attachment; filename="competitor_import_template.csv"`)

**Template columns (33 columns):**
```
Project Name, Developer Name, RERA Number, City, Area, State, Pincode,
Project Type, Project Status, Possession Date,
Total Units, Total Towers, Total Area Acres,
Min Price Per Sqft, Max Price Per Sqft, Avg Price Per Sqft,
Min Base Price, Max Base Price,
Floor Rise Charge,
Park Facing Premium, Road Facing Premium, Corner Unit Premium,
PLC Charges,
Covered Parking, Open Parking,
Club Membership, Maintenance Deposit, Legal Charges,
GST Rate, Stamp Duty Rate,
Confidence Score, Notes
```

**Price notation support:** The importer handles Indian price notation:
- `"85 Lakhs"` → 8500000
- `"1.2 Cr"` → 12000000
- `"₹8,500"` → 8500
- Plain numbers work too

---

### 4.5 Market Intelligence

#### `GET /market-overview`

**Permission:** `competitive_analysis:view`

Get aggregated market statistics for a specific locality. Also triggers a snapshot generation.

**Query Parameters:**

| Parameter | Required | Description |
|---|---|---|
| `city` | Yes | City name |
| `area` | Yes | Area/locality name |

**Response:**
```json
{
  "success": true,
  "data": {
    "totalProjects": 12,
    "totalUnitsInMarket": 6500,
    "pricePerSqft": {
      "min": 6200,
      "max": 12500,
      "avg": 8500,
      "median": 8200,
      "p25": 7500,
      "p75": 9800,
      "stdDev": 1450,
      "outliersRemoved": 1
    },
    "floorRiseCharge": {
      "min": 30,
      "max": 100,
      "avg": 55
    },
    "unitTypeDistribution": [
      { "unitType": "2BHK", "count": 2800, "percentage": 43 },
      { "unitType": "3BHK", "count": 2500, "percentage": 38 },
      { "unitType": "1BHK", "count": 800, "percentage": 12 },
      { "unitType": "4BHK", "count": 400, "percentage": 6 }
    ],
    "projectStatusDistribution": [
      { "status": "under_construction", "count": 6, "percentage": 50 },
      { "status": "newly_launched", "count": 3, "percentage": 25 },
      { "status": "ready_to_move", "count": 2, "percentage": 17 },
      { "status": "pre_launch", "count": 1, "percentage": 8 }
    ],
    "amenityPrevalence": [
      { "amenity": "lifts", "count": 12, "percentage": 100 },
      { "amenity": "security24x7", "count": 11, "percentage": 92 },
      { "amenity": "powerBackup", "count": 11, "percentage": 92 },
      { "amenity": "gym", "count": 10, "percentage": 83 },
      { "amenity": "swimmingPool", "count": 9, "percentage": 75 },
      { "amenity": "clubhouse", "count": 8, "percentage": 67 }
    ],
    "dataQuality": {
      "totalDataPoints": 12,
      "verifiedDataPoints": 4,
      "averageConfidenceScore": 62,
      "staleDataPoints": 1
    },
    "dataHash": "a3b2c1d4e5f6..."
  }
}
```

**Key UI elements:**
- Price/sqft bar chart with min/max/avg/median
- Unit type distribution pie chart
- Project status distribution horizontal bar
- Amenity prevalence list with % bars
- Data quality indicator badge
- Show "1 outlier removed" note when `outliersRemoved > 0`

---

#### `GET /market-trends`

**Permission:** `competitive_analysis:view`

Get historical market trend data from snapshots.

**Query Parameters:**

| Parameter | Required | Default | Description |
|---|---|---|---|
| `city` | Yes | — | City name |
| `area` | Yes | — | Area/locality name |
| `months` | No | `6` | Number of months of history |

**Response (with data):**
```json
{
  "success": true,
  "data": {
    "dataPoints": 5,
    "period": {
      "from": "2025-09-01T...",
      "to": "2026-02-22T..."
    },
    "priceHistory": [
      { "date": "2025-09-01T...", "avg": 7800, "min": 6000, "max": 10500, "median": 7600 },
      { "date": "2025-10-15T...", "avg": 8000, "min": 6200, "max": 10800, "median": 7800 },
      { "date": "2025-12-01T...", "avg": 8200, "min": 6200, "max": 11000, "median": 8000 },
      { "date": "2026-01-15T...", "avg": 8400, "min": 6200, "max": 12000, "median": 8200 },
      { "date": "2026-02-22T...", "avg": 8500, "min": 6200, "max": 12500, "median": 8200 }
    ],
    "supplyHistory": [
      { "date": "2025-09-01T...", "totalProjects": 8, "totalUnits": 4200 },
      { "date": "2026-02-22T...", "totalProjects": 12, "totalUnits": 6500 }
    ],
    "latestTrends": {
      "pricePerSqftChange": 1.19,
      "pricePerSqftChangeAbsolute": 100,
      "newProjectsAdded": 1,
      "projectsCompleted": 0,
      "supplyChange": 4.8
    }
  }
}
```

**Response (no data yet):**
```json
{
  "success": true,
  "data": {
    "dataPoints": 0,
    "message": "No historical snapshots. Market trends will build over time as snapshots are generated."
  }
}
```

**Key UI elements:**
- Line chart for `priceHistory` (avg, with min/max as shaded area)
- Bar chart for `supplyHistory` (total projects over time)
- Trend cards: price change %, supply change %, new projects added
- Empty state message when `dataPoints === 0`

---

#### `GET /demand-supply`

**Permission:** `competitive_analysis:view`

Get demand-supply gap analysis for a locality.

**Query Parameters:** `city` (required), `area` (required)

**Response:**
```json
{
  "success": true,
  "data": {
    "totalProjects": 12,
    "totalSupply": 6500,
    "supplyByUnitType": [
      {
        "unitType": "2BHK",
        "totalUnits": 2800,
        "availableUnits": 1500,
        "projectCount": 10,
        "avgPricePerSqft": 8200
      },
      {
        "unitType": "3BHK",
        "totalUnits": 2500,
        "availableUnits": 1800,
        "projectCount": 9,
        "avgPricePerSqft": 8800
      }
    ],
    "supplyPipeline": {
      "upcoming": 1500,
      "active": 4000,
      "completed": 1000,
      "breakdown": {
        "pre_launch": 500,
        "newly_launched": 1000,
        "under_construction": 3000,
        "ready_to_move": 1000,
        "completed": 1000
      }
    },
    "marketSaturation": {
      "projectDensity": 12,
      "supplyConcentration": [
        { "type": "2BHK", "share": 43 },
        { "type": "3BHK", "share": 38 },
        { "type": "1BHK", "share": 12 },
        { "type": "4BHK", "share": 6 }
      ]
    }
  }
}
```

**Key UI elements:**
- Stacked bar chart: supply by unit type (total vs available)
- Pipeline funnel: pre-launch → newly launched → under construction → ready to move → completed
- Supply concentration donut chart

---

### 4.6 AI Analysis & Recommendations

#### `GET /analysis/:projectId`

**Permission:** `competitive_analysis:ai_recommendations`

Get or generate AI competitive analysis for one of the user's own projects. The `projectId` is the user's **own Project** (not a CompetitorProject). The backend fetches competitor data from the project's locality automatically.

**Important UX notes:**
- First call for a project may take 10-20 seconds (GPT-4 generation). Show loading state.
- Subsequent calls within 24 hours return cached results instantly (if competitor data hasn't changed).
- The `fromCache` field indicates whether this was a cache hit.

**Query Parameters:**

| Parameter | Default | Description |
|---|---|---|
| `type` | `comprehensive` | Analysis type (see below) |

**Analysis types:**
| Type | Description |
|---|---|
| `comprehensive` | All 7 analysis types combined (recommended for overview page) |
| `pricing_recommendations` | Optimal pricing per sqft, floor rise, premiums, parking charges |
| `revenue_planning` | Revenue targets, price escalation strategy |
| `absorption_rate` | Monthly sales prediction, time to sell out |
| `demand_supply_gap` | Over/undersupply by unit type |
| `launch_timing` | Best quarter/season to launch |
| `optimal_unit_mix` | Recommended unit type split |
| `marketing_strategy` | USPs, target buyer, selling points |

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "...",
    "analysisScope": {
      "project": "PROJECT_ID",
      "city": "Bangalore",
      "area": "Whitefield",
      "competitorCount": 12
    },
    "analysisType": "comprehensive",
    "results": { /* AI-generated JSON — see Section 12 for exact shapes */ },
    "recommendations": [
      {
        "category": "pricing",
        "priority": "high",
        "title": "Price 3-5% below market average for faster absorption",
        "description": "With 12 competitors in Whitefield, market avg is ₹8,500/sqft...",
        "confidenceScore": 75,
        "estimatedImpact": "Could increase absorption rate by 20-30%",
        "actionItems": [
          "Set base price at ₹8,100-8,300/sqft",
          "Offer early bird discount of 2% for first 50 bookings"
        ]
      }
    ],
    "marketPositioning": {
      "segment": "mid_segment",
      "pricePercentile": 45,
      "competitiveAdvantages": ["Proximity to ITPL", "Better amenities"],
      "competitiveDisadvantages": ["Higher floor rise", "Later possession"]
    },
    "metadata": {
      "model": "gpt-4",
      "generationTimeMs": 12500,
      "dataQuality": "high",
      "competitorDataFreshness": {
        "freshCount": 10,
        "recentCount": 2,
        "staleCount": 0
      }
    },
    "fromCache": false,
    "expiresAt": "2026-02-23T14:30:00.000Z",
    "createdAt": "2026-02-22T14:30:00.000Z"
  },
  "message": "comprehensive analysis generated successfully"
}
```

**Cached response message:**
```json
{
  "message": "Returning cached analysis (data unchanged since last generation)"
}
```

---

#### `POST /analysis/:projectId/refresh`

**Permission:** `competitive_analysis:ai_recommendations`

Force re-generate analysis, bypassing the 24h cache.

**Request Body:**
```json
{
  "type": "pricing_recommendations"
}
```

**Response:** Same shape as `GET /analysis/:projectId` but always `fromCache: false`.

---

### 4.7 Provider Management

#### `GET /providers`

**Permission:** `competitive_analysis:manage_providers`

List all data provider configurations for the organization.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "...",
      "providerName": "ai_research",
      "isEnabled": true,
      "syncConfig": {
        "lastSyncAt": "2026-02-20T...",
        "lastSyncStatus": "success",
        "lastSyncRecordCount": 8
      }
    }
  ]
}
```

---

#### `PUT /providers/:providerName`

**Permission:** `competitive_analysis:manage_providers`

Update or create provider configuration. Upserts (creates if doesn't exist).

**Path parameter:** `providerName` — one of: `manual`, `csv_import`, `ai_research`, `propstack`, `squareyards`, `zapkey`

**Request Body:**
```json
{
  "isEnabled": true,
  "credentials": {
    "apiKey": "pk_test_..."
  },
  "syncConfig": {
    "autoSyncEnabled": true,
    "syncFrequency": "weekly"
  },
  "syncFilters": {
    "cities": ["Bangalore", "Mumbai"],
    "areas": ["Whitefield", "Bandra"]
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": { /* updated DataProviderConfig */ },
  "message": "Provider \"ai_research\" configuration updated"
}
```

---

#### `POST /providers/:providerName/sync`

**Permission:** `competitive_analysis:manage_providers`

Trigger a sync for a provider. Currently returns 501 for API providers (Propstack, SquareYards, ZapKey) as they are not yet integrated.

**Response (501 for future providers):**
```json
{
  "success": false,
  "message": "Sync for provider \"propstack\" is not yet implemented. Use manual entry, CSV import, or AI Research."
}
```

---

## 5. Data Freshness System

Every API response involving competitor data includes freshness metadata. Use these to display visual indicators.

### Freshness Categories

| Category | Age | Color | Badge |
|---|---|---|---|
| Fresh | < 30 days | Green | "Fresh" |
| Recent | 30-90 days | Yellow/Amber | "Aging" |
| Stale | > 90 days | Red | "Stale — Refresh Recommended" |

### Data Freshness Object (appears in list/dashboard responses)

```typescript
interface DataFreshness {
  freshCount: number;           // Records < 30 days old
  recentCount: number;          // Records 30-90 days old
  staleCount: number;           // Records > 90 days old
  oldestDataDate: string | null;
  newestDataDate: string | null;
  overallFreshnessScore: number; // 0-100, weighted score
  recommendation: string | null; // Action suggestion, null if all fresh
}
```

### Per-Record Indicators (virtuals)

Each `CompetitorProject` record includes:
- `isStale: boolean` — true if > 90 days old
- `dataAgeDays: number` — exact age in days
- `confidenceScore: number` — 0-100 reliability rating

### Confidence Score Guidelines

| Score Range | Badge | Color | Meaning |
|---|---|---|---|
| 80-100 | Verified | Green | Site visit / official source |
| 60-79 | Reliable | Blue | Property portal with confirmation |
| 40-59 | Estimated | Amber | AI research / unverified portal data |
| 0-39 | Unverified | Red | Needs verification |

### AI Analysis Data Quality

The `metadata.dataQuality` field on analysis results:

| Quality | Criteria |
|---|---|
| `high` | 70%+ fresh data, avg confidence >= 60, >= 5 competitors |
| `medium` | 40%+ fresh data, avg confidence >= 40, >= 3 competitors |
| `low` | >= 2 competitors |
| `very_low` | 0-1 competitors |

---

## 6. UI Pages & Components

### Recommended Page Structure

```
/competitive-analysis/
├── /dashboard              → Dashboard overview
├── /competitors            → Competitor list with filters
│   ├── /competitors/new    → Add competitor form
│   └── /competitors/:id    → Competitor detail/edit
├── /research               → AI research trigger page
├── /import                 → CSV import page
├── /market                 → Market intelligence hub
│   ├── /market/overview    → Market overview (select locality)
│   ├── /market/trends      → Historical trends charts
│   └── /market/demand      → Demand-supply analysis
├── /analysis/:projectId    → AI recommendations for own project
└── /settings/providers     → Data provider configuration
```

### 6.1 Dashboard Page

**Data source:** `GET /dashboard`

**Layout:**
```
┌──────────────────────────────────────────────────────────────┐
│ Competitive Analysis Dashboard                               │
├──────────────┬──────────────┬──────────────┬────────────────┤
│ Total        │ Active       │ Localities   │ Freshness      │
│ Competitors  │ Competitors  │ Tracked      │ Score          │
│    42        │    38        │    5         │   82/100 🟢    │
├──────────────┴──────────────┴──────────────┴────────────────┤
│                                                              │
│ Localities Tracked                    Data Sources           │
│ ┌──────────────────────────────┐   ┌────────────────────┐   │
│ │ Whitefield, BLR    12 proj  │   │ 🟦 Manual    15    │   │
│ │ ₹8,500/sqft  Conf: 65      │   │ 🟨 AI Res.   18    │   │
│ │ Koramangala, BLR    8 proj  │   │ 🟩 CSV       9     │   │
│ │ ₹12,200/sqft Conf: 70      │   │                    │   │
│ │ ...                          │   └────────────────────┘   │
│ └──────────────────────────────┘                             │
│                                                              │
│ Recently Added                                               │
│ ┌────────────────────────────────────────────────────────┐   │
│ │ Prestige Lake Ridge │ Whitefield │ ₹8,500 │ 2 days ago│   │
│ │ Brigade Horizon     │ Whitefield │ ₹9,200 │ 4 days ago│   │
│ └────────────────────────────────────────────────────────┘   │
│                                                              │
│ Data Freshness                                               │
│ 🟢 Fresh: 30  🟡 Recent: 6  🔴 Stale: 2                    │
│ ⚠ 2 competitor records are stale. [Run AI Research]          │
└──────────────────────────────────────────────────────────────┘
```

### 6.2 Competitor List Page

**Data source:** `GET /competitors`

**Features:**
- Filter bar: City, Area, Project Type, Project Status, Data Source dropdowns
- Sortable columns: Project Name, Developer, Price/sqft, Status, Data Age, Confidence
- Freshness badge per row (colored dot: green/yellow/red)
- Confidence badge per row
- Data source icon per row
- Pagination controls
- Action buttons: Add New, Import CSV, AI Research, Export CSV
- Bulk selection for delete

### 6.3 Competitor Detail/Edit Page

**Data source:** `GET /competitors/:id` + `PUT /competitors/:id`

**Sections:**
1. **Header:** Project name, developer, RERA number, status badge, freshness badge
2. **Location:** City, area, state, pincode, micromarket, map (if coordinates)
3. **Pricing Card:** Price/sqft (min/max/avg), base price range, floor rise, facing premiums, parking, club, maintenance, legal, GST, stamp duty
4. **Unit Mix Table:** Type, carpet area, built-up area, price range, count, available
5. **Amenities Grid:** Toggle chips for all 16 amenities + custom "other"
6. **Payment Plans:** Cards with plan name, type, booking amount/percentage
7. **Data Provenance:** Timeline showing who added/updated what data, when, from which source
8. **Notes:** Free text area
9. **Metadata Footer:** Data source, collection date, confidence score, last verified

### 6.4 AI Research Page

**Data source:** `POST /research`

**Flow:**
1. City + Area input fields (text inputs with autocomplete from existing localities)
2. Optional: Project Type dropdown, Additional Context textarea
3. "Start Research" button → loading state with animated indicator
4. Results panel:
   - Summary: "Found X projects, Created Y, Updated Z"
   - Projects list (cards or table)
   - Sources section (collapsible, clickable URLs)
   - Warnings (yellow alert cards)
   - Cost info (for admin visibility)

### 6.5 Market Intelligence Pages

**Market Overview** (`GET /market-overview`):
- Locality selector (city + area)
- Price/sqft statistics card with box plot visualization
- Unit type distribution pie/donut chart
- Project status distribution bar chart
- Amenity prevalence horizontal bar chart
- Data quality card

**Market Trends** (`GET /market-trends`):
- Locality selector + months dropdown (3, 6, 12)
- Price history line chart (avg line, min/max shaded area)
- Supply history bar chart
- Trend summary cards (price change %, supply change %)
- Empty state when no historical data yet

**Demand-Supply** (`GET /demand-supply`):
- Locality selector
- Supply by unit type stacked bar chart
- Supply pipeline funnel visualization
- Market saturation indicators

### 6.6 AI Analysis Page

**Data source:** `GET /analysis/:projectId` + `POST /analysis/:projectId/refresh`

**Layout:**
1. **Project selector** — dropdown of user's own projects (from existing Projects API)
2. **Analysis type tabs** — Comprehensive | Pricing | Revenue | Absorption | Demand-Supply | Launch | Unit Mix | Marketing
3. **Loading state** — "Generating AI analysis..." with skeleton
4. **Results display** — Varies by analysis type (see Section 12)
5. **Recommendations panel** — Sorted by priority (critical → high → medium → low), each with:
   - Category badge, priority badge
   - Title + description
   - Confidence score bar
   - Estimated impact text
   - Action items checklist
6. **Market positioning card** — Segment badge, percentile position on a horizontal scale, advantages/disadvantages lists
7. **Metadata footer** — "Generated X minutes ago", data quality badge, freshness breakdown, "Refresh" button
8. **Cache indicator** — Show "From cache" or "Freshly generated" badge

---

## 7. User Flows & Interactions

### 7.1 First-Time Setup Flow

```
1. User opens Competitive Analysis dashboard → Empty state
2. User clicks "Add Competitors" → Sees 3 options:
   a. "Enter Manually" → Opens competitor form
   b. "Import CSV" → Opens CSV upload page with template download
   c. "AI Research" → Opens research page
3. After adding data → Dashboard populates
4. User navigates to Analysis → Selects their project → Gets AI recommendations
```

### 7.2 AI Research Flow

```
1. User navigates to Research page
2. Enters "Bangalore" (city) and "Whitefield" (area)
3. Optionally selects project type, adds context
4. Clicks "Start Research"
5. Loading indicator shows (10-30 seconds)
6. Results appear:
   - "Found 8 projects, Created 5, Updated 3"
   - List of found projects with data preview
   - Warning alerts for any issues
   - Sources section with URLs
7. User clicks "View All Competitors" → navigates to competitor list filtered by Whitefield
8. User can manually verify/edit any AI-researched record
```

### 7.3 CSV Import Flow

```
1. User clicks "Import CSV"
2. Downloads template (link/button)
3. Fills template with competitor data
4. Uploads file, optionally sets default city/area
5. Import processes → Results table shows row-by-row status
6. User reviews errors/warnings
7. Successfully imported records appear in competitor list
```

### 7.4 AI Analysis Flow

```
1. User navigates to Analysis page
2. Selects their project from dropdown
3. Selects analysis type (default: Comprehensive)
4. If cached → Results appear instantly with "From cache" badge
5. If not cached → Loading state (10-20 seconds) → Results appear
6. User reviews recommendations by priority
7. User can click "Refresh" to force regeneration
8. User can switch between analysis type tabs
```

### 7.5 Market Comparison Flow

```
1. User navigates to Market Overview
2. Selects city + area
3. Market stats load with charts
4. User navigates to Trends tab → Historical price/supply charts
5. User navigates to Demand-Supply tab → Unit type analysis
6. User uses this data to inform pricing decisions
```

---

## 8. Enums & Constants

### Project Types
```
residential | commercial | mixed_use | plotted_development
```

Display labels:
- `residential` → "Residential"
- `commercial` → "Commercial"
- `mixed_use` → "Mixed Use"
- `plotted_development` → "Plotted Development"

### Project Statuses
```
pre_launch | newly_launched | under_construction | ready_to_move | completed
```

Display labels:
- `pre_launch` → "Pre-Launch"
- `newly_launched` → "Newly Launched"
- `under_construction` → "Under Construction"
- `ready_to_move` → "Ready to Move"
- `completed` → "Completed"

Color coding suggestion: Pre-launch (purple), Newly Launched (blue), Under Construction (orange), Ready to Move (green), Completed (gray)

### Data Sources
```
manual | csv_import | ai_research | propstack | squareyards | zapkey | web_research | field_visit
```

Display labels:
- `manual` → "Manual Entry"
- `csv_import` → "CSV Import"
- `ai_research` → "AI Research"
- `field_visit` → "Field Visit"
- `propstack` → "Propstack" (Coming Soon)
- `squareyards` → "Square Yards" (Coming Soon)
- `zapkey` → "ZapKey" (Coming Soon)
- `web_research` → "Web Research"

### Unit Types (common values)
```
1BHK | 2BHK | 3BHK | 4BHK | 5BHK | Penthouse | Studio | Villa | Shop | Office
```

### Payment Plan Types
```
construction_linked | time_based | subvention | flexi | possession_linked | other
```

Display labels:
- `construction_linked` → "Construction Linked"
- `time_based` → "Time Based"
- `subvention` → "Subvention"
- `flexi` → "Flexi Pay"
- `possession_linked` → "Possession Linked"
- `other` → "Other"

### Analysis Types
```
comprehensive | pricing_recommendations | revenue_planning | absorption_rate |
demand_supply_gap | launch_timing | optimal_unit_mix | marketing_strategy
```

Display labels:
- `comprehensive` → "Comprehensive Analysis"
- `pricing_recommendations` → "Pricing Recommendations"
- `revenue_planning` → "Revenue Planning"
- `absorption_rate` → "Absorption Rate"
- `demand_supply_gap` → "Demand-Supply Gap"
- `launch_timing` → "Launch Timing"
- `optimal_unit_mix` → "Optimal Unit Mix"
- `marketing_strategy` → "Marketing Strategy"

### Market Segments
```
budget | affordable | mid_segment | premium | luxury | ultra_luxury
```

Display labels:
- `budget` → "Budget"
- `affordable` → "Affordable"
- `mid_segment` → "Mid Segment"
- `premium` → "Premium"
- `luxury` → "Luxury"
- `ultra_luxury` → "Ultra Luxury"

### Recommendation Priority Colors
- `critical` → Red
- `high` → Orange
- `medium` → Yellow
- `low` → Blue/Gray

### Recommendation Categories
```
pricing | revenue | absorption | demand_supply | launch_timing | unit_mix | marketing | general
```

### Data Provenance Confidence
```
verified | reliable | estimated | unverified
```

### Provider Names
```
manual | csv_import | ai_research | propstack | squareyards | zapkey
```

### Provider Status
- `manual`, `csv_import`, `ai_research` → "Available"
- `propstack`, `squareyards`, `zapkey` → "Coming Soon"

---

## 9. Error Handling

### Standard Error Response Format

```json
{
  "success": false,
  "message": "Human-readable error message"
}
```

### Common HTTP Status Codes

| Code | Meaning | Frontend Action |
|---|---|---|
| 400 | Validation error (missing city/area, invalid type, etc.) | Show inline validation error |
| 401 | JWT expired or missing | Redirect to login |
| 403 | Insufficient permissions | Show "Access Denied" message |
| 404 | Resource not found | Show "Not Found" state |
| 409 | Duplicate competitor project | Show conflict dialog with option to update instead |
| 500 | Server error | Show generic error with retry button |
| 501 | Feature not implemented (future provider sync) | Show "Coming Soon" badge |

### Specific Error Messages

| Scenario | Error Message |
|---|---|
| Missing city/area for research | `Both "city" and "area" are required for AI research` |
| Missing city/area for market | `Both "city" and "area" query parameters are required` |
| Duplicate competitor | `A competitor project named "X" already exists in "Y". Use PUT to update it.` |
| No competitors for analysis | `No competitor data found for Whitefield, Bangalore. Add competitors or run AI Research first.` |
| Project missing location | `Project must have location.city and location.area set` |
| Invalid analysis type | `Invalid analysis type "X". Must be one of: pricing_recommendations, revenue_planning, ...` |
| No CSV file | `No CSV file uploaded. Send a CSV file via multipart/form-data with field name "file".` |
| Invalid CSV | `CSV parsing failed: ...` |
| Empty CSV | `CSV file is empty or contains only headers` |
| No export data | `No competitor data found for the given filters` |
| AI failure | `AI analysis failed after 2 attempts: ...` |

---

## 10. Integration Touchpoints

Competitive data surfaces in existing platform pages. These are **additive** — if no competitive data exists for a project's locality, the existing response is unchanged.

### 10.1 Project Detail Page

`GET /api/projects/:id` now includes:

```json
{
  "data": {
    "...existing project fields...",
    "competitiveData": {
      "competitorCount": 12,
      "marketAvgPricePerSqft": 8500,
      "marketMinPricePerSqft": 6200,
      "marketMaxPricePerSqft": 12500
    }
  }
}
```

If no competitive data: `"competitiveData": null`

**UI suggestion:** Show a "Market Position" card on the project detail page with:
- "12 competitors tracked in this locality"
- "Market avg: ₹8,500/sqft"
- "Range: ₹6,200 - ₹12,500/sqft"
- Link to full competitive analysis

### 10.2 AI Copilot

Three new copilot tools are available:
- `get_market_comparison` — "How does our pricing compare to competitors?"
- `get_competitive_positioning` — "What's our market position?"
- `get_pricing_recommendations` — "Should we reduce prices?"

Users can ask competitive analysis questions in the copilot chat and get AI-powered answers.

---

## 11. CSV Import/Export

### Template Columns Reference

| # | CSV Header | Maps To | Type | Required | Notes |
|---|---|---|---|---|---|
| 1 | Project Name | `projectName` | string | Yes | |
| 2 | Developer Name | `developerName` | string | No* | Defaults to "Unknown" |
| 3 | RERA Number | `reraNumber` | string | No | |
| 4 | City | `location.city` | string | Yes** | Can use default |
| 5 | Area | `location.area` | string | Yes** | Can use default |
| 6 | State | `location.state` | string | No | |
| 7 | Pincode | `location.pincode` | string | No | |
| 8 | Project Type | `projectType` | enum | No | Defaults to "residential" |
| 9 | Project Status | `projectStatus` | enum | No | |
| 10 | Possession Date | `possessionTimeline.description` | string | No | Free text |
| 11 | Total Units | `totalUnits` | number | No | |
| 12 | Total Towers | `totalTowers` | number | No | |
| 13 | Total Area Acres | `totalAreaAcres` | number | No | |
| 14 | Min Price Per Sqft | `pricing.pricePerSqft.min` | number | No | |
| 15 | Max Price Per Sqft | `pricing.pricePerSqft.max` | number | No | |
| 16 | Avg Price Per Sqft | `pricing.pricePerSqft.avg` | number | No | Also: "Rate/Sqft", "Price/Sqft" |
| 17 | Min Base Price | `pricing.basePriceRange.min` | number | No | Supports "85 Lakhs", "1.2 Cr" |
| 18 | Max Base Price | `pricing.basePriceRange.max` | number | No | Supports "85 Lakhs", "1.2 Cr" |
| 19 | Floor Rise Charge | `pricing.floorRiseCharge` | number | No | INR per floor |
| 20 | Park Facing Premium | `pricing.facingPremiums.parkFacing` | number | No | INR |
| 21 | Road Facing Premium | `pricing.facingPremiums.roadFacing` | number | No | INR |
| 22 | Corner Unit Premium | `pricing.facingPremiums.cornerUnit` | number | No | INR |
| 23 | PLC Charges | `pricing.plcCharges` | number | No | INR |
| 24 | Covered Parking | `pricing.parkingCharges.covered` | number | No | INR |
| 25 | Open Parking | `pricing.parkingCharges.open` | number | No | INR |
| 26 | Club Membership | `pricing.clubMembershipCharges` | number | No | INR |
| 27 | Maintenance Deposit | `pricing.maintenanceDeposit` | number | No | INR |
| 28 | Legal Charges | `pricing.legalCharges` | number | No | INR |
| 29 | GST Rate | `pricing.gstRate` | number | No | Percentage |
| 30 | Stamp Duty Rate | `pricing.stampDutyRate` | number | No | Percentage |
| 31 | Confidence Score | `confidenceScore` | number | No | 0-100, defaults to 60 |
| 32 | Notes | `notes` | string | No | |

\* `developerName` is required in the schema but defaults to "Unknown" on CSV import.
\** `city` and `area` are required but can be provided as request parameters instead of CSV columns.

### Flexible Header Recognition

The CSV parser recognizes multiple header name variations (case-insensitive):

| Field | Recognized Headers |
|---|---|
| Project Name | "Project Name", "Project", "Name" |
| Developer | "Developer", "Developer Name", "Builder", "Builder Name" |
| RERA | "RERA Number", "RERA", "RERA No" |
| Area | "Area", "Locality", "Location" |
| Price/sqft | "Price Per Sqft", "Rate Per Sqft", "Rate/Sqft", "Price/Sqft" |

### Deduplication Behavior

- Match key: `projectName + location.area` (case-insensitive)
- If existing record found: **merge** — only update fields that are currently null/empty/0
- If no match: create new record with `dataSource: 'csv_import'`
- Duplicate index violations are caught and reported as "skipped"

---

## 12. AI Analysis Response Schemas

### 12.1 Comprehensive Analysis (`type=comprehensive`)

```json
{
  "pricing": {
    "optimalPricePerSqft": 8300,
    "range": { "min": 7800, "max": 8800 },
    "segment": "mid_segment",
    "pricePercentile": 45
  },
  "revenue": {
    "totalTarget": 250000000,
    "escalationStrategy": "Phase 1: ₹8,100/sqft → Phase 2: ₹8,500/sqft → Phase 3: ₹9,000/sqft"
  },
  "absorption": {
    "monthlySales": 12,
    "timeToSellOut": 42
  },
  "demandSupply": {
    "assessment": "balanced",
    "gaps": ["Undersupply of 1BHK units", "Oversupply of 4BHK in premium segment"]
  },
  "launchTiming": {
    "recommended": "Q3 2026 (July-September)",
    "reason": "Post-monsoon demand uptick, fewer competitor launches"
  },
  "unitMix": [
    { "unitType": "2BHK", "percentage": 45, "rationale": "Highest demand in IT corridor" },
    { "unitType": "3BHK", "percentage": 35, "rationale": "Premium segment growth" },
    { "unitType": "1BHK", "percentage": 15, "rationale": "First-time buyer demand" },
    { "unitType": "4BHK", "percentage": 5, "rationale": "Limited luxury demand" }
  ],
  "marketing": {
    "usps": ["Proximity to ITPL", "Premium clubhouse", "EV charging infrastructure"],
    "targetBuyer": "IT professionals, dual-income families, 28-40 age group",
    "keyMessage": "Premium living at mid-segment pricing, 10 mins from ITPL"
  },
  "marketPositioning": {
    "segment": "mid_segment",
    "pricePercentile": 45,
    "advantages": ["Better amenities", "Newer construction technology"],
    "disadvantages": ["Later possession date", "Less established developer"]
  },
  "recommendations": [
    {
      "category": "pricing",
      "priority": "high",
      "title": "Price 3-5% below market average for faster absorption",
      "description": "...",
      "confidenceScore": 75,
      "estimatedImpact": "Could increase absorption rate by 20-30%",
      "actionItems": [
        "Set base price at ₹8,100-8,300/sqft",
        "Offer early bird discount of 2% for first 50 bookings"
      ]
    }
  ]
}
```

### 12.2 Pricing Recommendations (`type=pricing_recommendations`)

```json
{
  "optimalPricing": {
    "pricePerSqft": {
      "recommended": 8300,
      "range": { "min": 7800, "max": 8800 },
      "confidence": 78
    },
    "floorRiseCharge": {
      "recommended": 50,
      "range": { "min": 30, "max": 75 }
    },
    "facingPremiums": {
      "parkFacing": { "recommended": 200000 },
      "roadFacing": { "recommended": 100000 },
      "cornerUnit": { "recommended": 150000 }
    },
    "parkingCharges": { "covered": 500000, "open": 200000 },
    "clubMembership": 200000,
    "maintenanceDeposit": 100000
  },
  "marketPositioning": {
    "segment": "mid_segment",
    "pricePercentile": 45,
    "narrative": "Your project is positioned in the mid-segment of the Whitefield market..."
  },
  "recommendations": [ /* recommendation objects */ ]
}
```

### 12.3 Revenue Planning (`type=revenue_planning`)

```json
{
  "revenueTargets": {
    "totalProjectRevenue": 250000000,
    "revenuePerUnitType": [
      { "unitType": "2BHK", "avgPrice": 7500000, "count": 200, "revenue": 1500000000 },
      { "unitType": "3BHK", "avgPrice": 12000000, "count": 150, "revenue": 1800000000 }
    ],
    "priceEscalationStrategy": {
      "phase1": { "pricePerSqft": 8100, "duration": "0-6 months" },
      "phase2": { "pricePerSqft": 8500, "duration": "6-18 months" },
      "phase3": { "pricePerSqft": 9000, "duration": "18-36 months" }
    }
  },
  "recommendations": [ /* recommendation objects */ ]
}
```

### 12.4 Absorption Rate (`type=absorption_rate`)

```json
{
  "absorption": {
    "predictedMonthlySales": 12,
    "timeToSellOut": { "months": 42, "confidence": 70 },
    "priceSensitivity": [
      { "pricePoint": 7500, "estimatedMonthlySales": 18, "timeToSellOut": 28 },
      { "pricePoint": 8000, "estimatedMonthlySales": 14, "timeToSellOut": 36 },
      { "pricePoint": 8500, "estimatedMonthlySales": 10, "timeToSellOut": 50 },
      { "pricePoint": 9000, "estimatedMonthlySales": 6, "timeToSellOut": 83 }
    ]
  },
  "recommendations": [ /* recommendation objects */ ]
}
```

**UI suggestion:** Plot `priceSensitivity` as an inverse curve (price vs sales velocity).

### 12.5 Demand-Supply Gap (`type=demand_supply_gap`)

```json
{
  "demandSupply": {
    "overallAssessment": "balanced",
    "byUnitType": [
      { "unitType": "1BHK", "supply": 800, "demandIndicator": "high", "gap": "Undersupply — strong first-time buyer demand" },
      { "unitType": "2BHK", "supply": 2800, "demandIndicator": "high", "gap": "Balanced — adequate supply meets demand" },
      { "unitType": "3BHK", "supply": 2500, "demandIndicator": "medium", "gap": "Slightly oversupplied in premium range" },
      { "unitType": "4BHK", "supply": 400, "demandIndicator": "low", "gap": "Oversupply — limited luxury demand" }
    ],
    "saturationIndicators": {
      "projectDensity": "High (12 active projects)",
      "priceStability": "Stable (1.2% growth QoQ)",
      "inventoryAge": "Moderate (average 14 months unsold)"
    }
  },
  "recommendations": [ /* recommendation objects */ ]
}
```

### 12.6 Launch Timing (`type=launch_timing`)

```json
{
  "launchTiming": {
    "recommendedLaunchWindow": {
      "quarter": "Q3 2026",
      "year": 2026,
      "reason": "Post-monsoon demand uptick combined with fewer competitor launches"
    },
    "competitorPipeline": [
      { "status": "pre_launch", "count": 3, "implication": "3 projects entering market — price competition ahead" },
      { "status": "newly_launched", "count": 4, "implication": "Active competition for buyers" }
    ],
    "seasonalFactors": [
      { "period": "Jan-Mar", "demandLevel": "high", "reason": "New year buying sentiment, tax-saving season" },
      { "period": "Apr-Jun", "demandLevel": "medium", "reason": "Post-financial year, some relocation activity" },
      { "period": "Jul-Sep", "demandLevel": "medium", "reason": "Monsoon slowdown offset by festive prep" },
      { "period": "Oct-Dec", "demandLevel": "high", "reason": "Festive season — Navratri, Diwali" }
    ],
    "preLaunchStrategy": {
      "duration": "6-8 weeks",
      "priceDiscount": 5,
      "targetBookings": 50
    }
  },
  "recommendations": [ /* recommendation objects */ ]
}
```

### 12.7 Optimal Unit Mix (`type=optimal_unit_mix`)

```json
{
  "unitMix": {
    "recommended": [
      {
        "unitType": "2BHK",
        "percentage": 45,
        "count": 225,
        "carpetAreaRange": { "min": 800, "max": 1050 },
        "pricePerSqftRange": { "min": 7800, "max": 8500 },
        "rationale": "Highest demand segment in IT corridor, best absorption potential"
      },
      {
        "unitType": "3BHK",
        "percentage": 35,
        "count": 175,
        "carpetAreaRange": { "min": 1200, "max": 1500 },
        "pricePerSqftRange": { "min": 8000, "max": 9500 },
        "rationale": "Growing family segment, premium pricing opportunity"
      }
    ],
    "marketDemandSignals": [
      { "signal": "2BHK units sell out fastest (avg 18 months)", "source": "Competitor absorption data", "impact": "High demand for compact units" },
      { "signal": "4BHK supply exceeds demand by 40%", "source": "Unsold inventory analysis", "impact": "Avoid large 4BHK allocation" }
    ]
  },
  "recommendations": [ /* recommendation objects */ ]
}
```

### 12.8 Marketing Strategy (`type=marketing_strategy`)

```json
{
  "marketing": {
    "usps": [
      "Only project in Whitefield with EV charging and co-working space",
      "10 minutes drive to ITPL and 15 minutes to Varthur Lake"
    ],
    "competitiveAdvantages": [
      "Lower price than Brigade and Prestige projects in same micro-market",
      "Better amenity count (16 vs market avg of 10)"
    ],
    "competitiveDisadvantages": [
      "Later possession date compared to 3 ready-to-move competitors",
      "Less established brand compared to Prestige and Brigade"
    ],
    "pricingNarrative": "Positioned 5% below the market leader while offering 30% more amenities. The value proposition is clear — premium living at mid-segment pricing.",
    "targetBuyerPersona": {
      "demographics": "IT professionals, dual-income families, age 28-40, income ₹30L+/year",
      "motivations": ["Home investment near workplace", "Lifestyle upgrade", "Long-term asset appreciation"],
      "concerns": ["Possession timeline reliability", "Developer track record", "Resale value"]
    },
    "keySellingPoints": [
      "₹8,300/sqft vs market avg ₹8,500 — save ₹2-3L on a 2BHK",
      "16 amenities including EV charging and solar panels",
      "RERA registered, construction on track"
    ],
    "channelRecommendations": [
      { "channel": "Digital (Google/Meta Ads)", "priority": "high", "reason": "IT crowd is digital-first" },
      { "channel": "Channel Partners", "priority": "high", "reason": "Local brokers influence 40% of sales in Whitefield" },
      { "channel": "Property Portals (99acres/Housing)", "priority": "medium", "reason": "Standard discovery channel" },
      { "channel": "Billboard/Outdoor", "priority": "low", "reason": "High cost, limited tracking" }
    ]
  },
  "recommendations": [ /* recommendation objects */ ]
}
```

---

## Quick Reference Card

### All Endpoints Summary

| Method | Endpoint | Permission | Purpose |
|---|---|---|---|
| `GET` | `/dashboard` | VIEW | Dashboard summary |
| `POST` | `/competitors` | MANAGE_DATA | Create competitor |
| `GET` | `/competitors` | VIEW | List competitors (paginated, filtered) |
| `GET` | `/competitors/:id` | VIEW | Get single competitor |
| `PUT` | `/competitors/:id` | MANAGE_DATA | Update competitor |
| `DELETE` | `/competitors/:id` | MANAGE_DATA | Delete competitor |
| `POST` | `/research` | AI_RESEARCH | Trigger AI web research |
| `POST` | `/import-csv` | MANAGE_DATA | Import CSV (multipart) |
| `GET` | `/export-csv` | MANAGE_DATA | Export CSV download |
| `GET` | `/csv-template` | VIEW | Download CSV template |
| `GET` | `/market-overview` | VIEW | Aggregated market stats |
| `GET` | `/market-trends` | VIEW | Historical price/supply trends |
| `GET` | `/demand-supply` | VIEW | Demand-supply gap analysis |
| `GET` | `/analysis/:projectId` | AI_RECOMMENDATIONS | Get/generate AI analysis |
| `POST` | `/analysis/:projectId/refresh` | AI_RECOMMENDATIONS | Force refresh analysis |
| `GET` | `/providers` | MANAGE_PROVIDERS | List provider configs |
| `PUT` | `/providers/:providerName` | MANAGE_PROVIDERS | Update provider config |
| `POST` | `/providers/:providerName/sync` | MANAGE_PROVIDERS | Trigger provider sync |

### All Currency Values

**All monetary values are in INR (Indian Rupees) absolute numbers.** Never lakhs/crores in API responses.
- ₹50,00,000 is stored and returned as `5000000`
- ₹1.2 Crore is stored and returned as `12000000`
- Price per sqft ₹8,500 is stored and returned as `8500`

### Formatting Suggestions

```javascript
// Format INR
const formatINR = (value) => {
  if (!value) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value);
};
// formatINR(8500000) → "₹85,00,000"

// Format in Lakhs/Crores for display
const formatINRShort = (value) => {
  if (!value) return '—';
  if (value >= 10000000) return `₹${(value / 10000000).toFixed(2)} Cr`;
  if (value >= 100000) return `₹${(value / 100000).toFixed(2)} L`;
  return `₹${value.toLocaleString('en-IN')}`;
};
// formatINRShort(8500000) → "₹85.00 L"
// formatINRShort(12000000) → "₹1.20 Cr"

// Format price per sqft
const formatPricePerSqft = (value) => `₹${value?.toLocaleString('en-IN')}/sqft`;
// formatPricePerSqft(8500) → "₹8,500/sqft"
```

---

*Document generated for the PropVantage AI frontend team. All endpoints are live and tested. Base URL: `/api/competitive-analysis`.*
