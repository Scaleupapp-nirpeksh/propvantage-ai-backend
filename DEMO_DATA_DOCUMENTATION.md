# PropVantage AI — Demo Data Seed Documentation

This document explains the demo data seed script, lists all login credentials, and provides a guide for adding new demo entries whenever new features are added.

---

## 1. How to Run

```bash
# First time — create demo organization with all data
node data/seedDemoData.js

# Delete all demo data (clean only)
node data/seedDemoData.js --clean

# Re-seed: clean first, then seed
node data/seedDemoData.js --clean && node data/seedDemoData.js
```

**Requirements:** MongoDB connection string in `.env` (`MONGO_URI`)

**Safety:** The script checks if the demo organization already exists. It will NOT overwrite unless you pass `--clean`.

---

## 2. Demo Organization

| Field | Value |
|-------|-------|
| **Name** | Prestige Horizon Developers |
| **Type** | builder |
| **City** | Pune, India |
| **Subscription** | enterprise |
| **Phone** | +91-20-67891234 |
| **Website** | https://www.prestigehorizon.com |

---

## 3. Login Credentials

**Password for ALL users:** `Demo@1234`

| # | Role | Name | Email |
|---|------|------|-------|
| 1 | **Organization Owner** | Rajesh Kapoor | `rajesh.kapoor@prestigehorizon.com` |
| 2 | **Business Head** | Ananya Sharma | `ananya.sharma@prestigehorizon.com` |
| 3 | **Project Director** | Vikram Mehta | `vikram.mehta@prestigehorizon.com` |
| 4 | **Sales Head** | Priya Nair | `priya.nair@prestigehorizon.com` |
| 5 | **Marketing Head** | Arjun Desai | `arjun.desai@prestigehorizon.com` |
| 6 | **Finance Head** | Meera Joshi | `meera.joshi@prestigehorizon.com` |
| 7 | **Sales Manager** | Sanjay Patel | `sanjay.patel@prestigehorizon.com` |
| 8 | **Finance Manager** | Kavita Reddy | `kavita.reddy@prestigehorizon.com` |
| 9 | **Channel Partner Manager** | Deepak Chauhan | `deepak.chauhan@prestigehorizon.com` |
| 10 | **Sales Executive** | Neha Gupta | `neha.gupta@prestigehorizon.com` |
| 11 | **Sales Executive** | Rohit Singh | `rohit.singh@prestigehorizon.com` |
| 12 | **Channel Partner Admin** | Aisha Khan | `aisha.khan@prestigehorizon.com` |
| 13 | **Channel Partner Agent** | Manish Verma | `manish.verma@prestigehorizon.com` |

### Role Hierarchy (highest to lowest access)

```
Level 0: Organization Owner (Rajesh)     — ALL permissions, cannot be restricted
Level 1: Business Head (Ananya)          — All except roles:delete
Level 2: Project Director (Vikram)       — Full project + construction + team management
Level 3: Sales Head / Marketing Head / Finance Head — Department-level full access
Level 4: Sales Manager / Finance Manager / CP Manager — Operational management
Level 5: Sales Executive / CP Admin      — Individual contributor
Level 6: Channel Partner Agent           — Minimal read + lead creation
```

### Recommended Test Scenarios by Role

| Login As | Best For Testing |
|----------|-----------------|
| **Rajesh (Owner)** | Full system overview, all dashboards, role management, settings |
| **Vikram (Project Director)** | Projects, towers, construction milestones, contractors, cross-functional tasks |
| **Priya (Sales Head)** | Sales pipeline, team tasks, lead analytics, commission structures |
| **Meera (Finance Head)** | Payment plans, installments, payment transactions, invoices, budget tracking |
| **Sanjay (Sales Manager)** | Team tasks, lead assignment, day-to-day sales ops |
| **Neha (Sales Executive)** | Individual tasks, lead follow-ups, notifications, limited access |
| **Deepak (CP Manager)** | Partner commissions, channel partner management |
| **Manish (CP Agent)** | Minimal access testing, lead creation only |

---

## 4. Data Summary (286 records across 21 models)

| Model | Count | Notes |
|-------|-------|-------|
| Organization | 1 | Prestige Horizon Developers |
| Roles | 12 | All default roles (Level 0-6) |
| Users | 13 | All roles represented |
| Projects | 3 | Apartment, Villa, Commercial |
| Towers | 6 | 3 for Horizon Heights, 2 for Villas, 1 for Commercial |
| Document Categories | 9 | All 9 type enums covered |
| Units | 55 | 30 apartments + 15 villas + 10 commercial |
| Leads | 20 | Mixed statuses, sources, priorities |
| Interactions | ~46 | Calls, emails, meetings, site visits, WhatsApp, notes |
| Sales | 5 | Across apartments and villas |
| Payment Plans | 5 | One per sale, mixed plan types |
| Installments | 25 | 5 per plan, mixed statuses |
| Payment Transactions | 12 | All 7 payment methods, mixed statuses |
| Invoices | 5 | Mixed types and statuses |
| Commission Structures | 3 | Percentage, tiered, flat rate |
| Partner Commissions | 4 | Paid, approved, pending states |
| Contractors | 8 | All 6 contractor types |
| Construction Milestones | 20 | All 7 phases, mixed statuses |
| Tasks | 15 | All categories and statuses |
| Task Templates | 5 | System templates with triggers |
| Notifications | 14 | All notification types |
| **TOTAL** | **~286** | |

---

## 5. Detailed Data Breakdown

### 5.1 Projects (3)

| Project | Type | Status | Units Seeded | Location |
|---------|------|--------|-------------|----------|
| **Horizon Heights** | Apartment | Under Construction | 30 | Baner, Pune |
| **Greenfield Villas** | Villa | Launched | 15 | Hinjewadi, Pune |
| **Skyline Commercial Plaza** | Commercial | Pre-Launch | 10 | Kharadi, Pune |

### 5.2 Towers (6)

| Tower | Project | Code | Floors | Type | Status |
|-------|---------|------|--------|------|--------|
| Tower A | Horizon Heights | HHA | 10 | residential | under_construction |
| Tower B | Horizon Heights | HHB | 10 | residential | under_construction |
| Tower C | Horizon Heights | HHC | 8 | mixed_use | planning |
| Phase 1 | Greenfield Villas | GFV1 | 2 | residential | completed |
| Phase 2 | Greenfield Villas | GFV2 | 2 | residential | under_construction |
| Tower 1 | Skyline Commercial | SCP1 | 12 | commercial | planning |

### 5.3 Units (55)

- **Horizon Heights (30):** 2BHK, 2BHK Premium, 3BHK, 3BHK Premium, Penthouse — mix of available/booked/sold
- **Greenfield Villas (15):** 3BHK/4BHK/5BHK Villas — 4 sold, 3 booked, 8 available
- **Skyline Commercial (10):** Office Space, Retail, Co-Working — all available (pre-launch)

### 5.4 Leads (20)

- 8 statuses covered: New, Contacted, Qualified, Site Visit Scheduled/Completed, Negotiating, Booked, Lost
- 6 sources: Website, Property Portal, Referral, Walk-in, Social Media, Advertisement
- Score ranges from 10-95 with grades D through A+

### 5.5 Sales (5) → Payment Plans (5) → Installments (25)

Each sale has a linked payment plan with 5 installments:
- **Plan types:** construction_linked, time_based, milestone_based, custom
- **Installment statuses:** paid, partially_paid, due, overdue, pending, waived, cancelled

### 5.6 Payment Transactions (12)

- **Methods:** bank_transfer, cheque, online_payment, cash, demand_draft, home_loan, card_payment
- **Statuses:** completed, cleared, bounced, processing
- Each with method-specific details (cheque numbers, UTR references, etc.)

### 5.7 Invoices (5)

- **Types:** booking_invoice, milestone_invoice, final_invoice, adjustment_invoice, cancellation_invoice
- **Statuses:** paid, partially_paid, sent, draft, generated
- Auto-generated invoice numbers per financial year

### 5.8 Commission Structures (3) + Partner Commissions (4)

| Structure | Method | Rate |
|-----------|--------|------|
| Standard Channel Partner | percentage | 2% on sale price |
| Tiered Performance | tiered | 1.5%-3% based on volume |
| Referral Flat Fee | flat_rate | ₹50,000 per referral |

Partner commissions: 2 paid, 1 approved, 1 pending_approval

### 5.9 Contractors (8)

All 6 types covered: General Contractor, Subcontractor, Specialist (3), Supplier, Service Provider, Consultant. Statuses: 6 Active, 1 Inactive, 1 Under Review.

### 5.10 Construction Milestones (20)

All 7 phases for Horizon Heights:
- Pre-Construction (2): Completed
- Foundation Phase (3): Completed / In Progress
- Structure Phase (3): In Progress / Not Started
- MEP Phase (3): Not Started / Planning
- Finishing Phase (4): Not Started
- Inspection Phase (2): Not Started
- Handover Phase (2): Not Started
- Plus 1 Delayed milestone (Landscaping)

### 5.11 Tasks (15)

All 6 statuses: Open (5), In Progress (3), Under Review (1), Completed (2), On Hold (1), Cancelled (1), Critical (1)
Features: checklists, comments with @mentions, escalations, linked entities, SLA tracking

### 5.12 Notifications (14)

All types: task_assigned, task_overdue, task_due_today, task_due_soon, task_mention, task_comment, task_escalated, task_completed, task_status_changed, task_auto_generated

---

## 6. Models NOT Seeded

| Model | Reason |
|-------|--------|
| **File** | Requires S3 uploads — skip in seed |
| **DocumentTemplate** | Requires file references — skip in seed |

---

## 7. Guide: Adding Demo Data for New Features

### Step 1: Import Your New Model

```javascript
import YourNewModel from '../models/yourNewModel.js';
```

### Step 2: Add Seed Section

**Important:** If the model has a pre-save hook that auto-generates a required field (like `transactionNumber` or `invoiceNumber`), you must provide that field manually because Mongoose validation runs before pre-save hooks.

```javascript
// ─── STEP N: CREATE YOUR_ENTITY ──────────────────────────────
console.log('N️⃣  Creating your entities...');

// Use .create() one-at-a-time for models with pre-save hooks
// Use .insertMany() for models without pre-save hooks
const createdEntities = await YourNewModel.insertMany([...]);
console.log(`   ✅ Created ${createdEntities.length} entities\n`);
```

### Step 3: Add to Cleanup

In `cleanDemoData()`, add deletion in reverse dependency order.

### Step 4: Update Summary + This Documentation

### Data Relationship Reference

```
Organization:  org._id
Owner:         owner._id (users['organization-owner'][0])
Projects:      project1, project2, project3
Towers:        towerMap['HHA'], towerMap['HHB'], etc.
Units:         createdUnits, p1Units, p2Units
Leads:         createdLeads[0..19]
Sales:         createdSales[0..4]
Plans:         createdPlans[0..4]
Installments:  createdInstallments[0..24]
Contractors:   createdContractors[0..7]
Milestones:    createdMilestones[0..19]
Tasks:         createdTasks[0..14]
```

---

## 8. Troubleshooting

| Issue | Solution |
|-------|---------|
| "Organization already exists" | Run `node data/seedDemoData.js --clean` first |
| "Duplicate key error" | Clean first, then re-seed |
| Validation error on required field | Check if the model's pre-save hook generates it; if so, provide it manually |
| "Password comparison failed" | Ensure `Demo@1234` — password is stored as plain text, bcrypt hook hashes it |
| Can't login after seed | Check `isActive: true` and `invitationStatus: 'accepted'` on user |

---

*Last Updated: February 2026*
