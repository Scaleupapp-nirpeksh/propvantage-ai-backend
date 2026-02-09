# AI Copilot — Frontend Developer Guide

**Feature**: AI Copilot Chat — Natural Language Query Interface
**Backend Version**: 1.9.0
**Base URL**: `http://localhost:3000`
**Last Updated**: February 2026

---

## Table of Contents

1. [Overview](#1-overview)
2. [Endpoint Specification](#2-endpoint-specification)
3. [Authentication](#3-authentication)
4. [Request Format](#4-request-format)
5. [Response Format](#5-response-format)
6. [Card Types & Rendering Guide](#6-card-types--rendering-guide)
7. [Actions & Navigation](#7-actions--navigation)
8. [Conversation Memory (Multi-turn)](#8-conversation-memory-multi-turn)
9. [Error Handling](#9-error-handling)
10. [Rate Limiting](#10-rate-limiting)
11. [Complete Example Conversations](#11-complete-example-conversations)
12. [UI/UX Recommendations](#12-uiux-recommendations)
13. [TypeScript Interfaces](#13-typescript-interfaces)

---

## 1. Overview

The AI Copilot is a single chat endpoint that accepts natural language questions and returns intelligent answers backed by real database data. Users can ask business questions in plain English and receive:

- **Natural language text answers** (always present)
- **Structured data cards** (metrics, tables, charts, lists, alerts)
- **Suggested navigation actions** (links to relevant pages)
- **Follow-up question suggestions** (to guide further exploration)

### What Users Can Ask

| Category | Example Questions |
|----------|-------------------|
| **Projects** | "Show me all launched projects", "Details of Green Valley" |
| **Sales** | "What are my sales this month?", "Compare Project A vs B" |
| **Leads** | "Show high priority leads", "Who is Rahul Sharma?" |
| **Payments** | "How much revenue collected this month?", "What's overdue?" |
| **Inventory** | "Available units in Tower A", "Show 3BHK options under ₹1 Cr" |
| **Team** | "How is my team performing?", "Top salesperson this quarter" |
| **Forecasts** | "Sales projection for next 6 months", "Revenue forecast" |
| **Commissions** | "Commission summary", "Pending partner payouts" |
| **Overview** | "How is business?", "Dashboard overview", "What should I focus on?" |
| **General** | "Hi", "What can you help with?" |

---

## 2. Endpoint Specification

### `POST /api/ai/copilot/chat`

| Property | Value |
|----------|-------|
| **Method** | `POST` |
| **URL** | `/api/ai/copilot/chat` |
| **Auth** | Required — Bearer token (JWT) |
| **Rate Limit** | 20 requests per minute per user |
| **Expected Latency** | 2–8 seconds (GPT-4 + database queries) |
| **Max Request Body** | 10 MB (server limit) |

---

## 3. Authentication

All requests must include the JWT token in the `Authorization` header.

```
Authorization: Bearer <jwt_token>
```

The token is obtained from `POST /api/auth/login`. The copilot uses the authenticated user's identity to:
- Scope all data to the user's **organization**
- Apply **role-based data filtering** (e.g., Sales Executives only see their own leads)
- Personalize responses with the user's name and role

### Role-Based Data Access

| Role | What They Can See |
|------|-------------------|
| Business Head | All data across organization |
| Project Director | All data across organization |
| Sales Head | All sales, leads, projects, payments |
| Finance Head | All financial data, payments, commissions |
| Marketing Head | All data across organization |
| Sales Manager | All org data (team-level filtering planned) |
| Finance Manager | All financial data |
| Sales Executive | **Only own leads and own sales** |
| Channel Partner Manager | All org data |
| Channel Partner Admin | **Only own commissions and referred leads** |
| Channel Partner Agent | **Only own commissions and referred leads** |

---

## 4. Request Format

### Request Body

```json
{
  "message": "What does the sales projection look like for Green Valley?",
  "conversationId": "conv_abc123xyz",
  "context": {
    "currentPage": "project-detail",
    "projectId": "507f1f77bcf86cd799439011",
    "filters": {}
  }
}
```

### Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `message` | `string` | **Yes** | The user's natural language question. Max 2000 characters. |
| `conversationId` | `string` | No | Pass to continue a multi-turn conversation. If omitted, a new conversation is created. |
| `context` | `object` | No | Current UI context — helps the AI give more relevant answers. |
| `context.currentPage` | `string` | No | Current page identifier (e.g., `"project-detail"`, `"leads-list"`, `"dashboard"`). |
| `context.projectId` | `string` | No | Currently viewed project's MongoDB ObjectId. |
| `context.filters` | `object` | No | Any active filters on the current page (reserved for future use). |

### cURL Example

```bash
curl -X POST http://localhost:3000/api/ai/copilot/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..." \
  -d '{
    "message": "How much revenue did we collect this month?",
    "conversationId": "conv_abc123"
  }'
```

---

## 5. Response Format

### Success Response (HTTP 200)

```json
{
  "success": true,
  "data": {
    "conversationId": "conv_r4k8m2xnlq1s6b7f",
    "messageId": "msg_p3j7n1wmlq1s6b8g",
    "response": {
      "text": "You collected ₹4.2 Cr this month across all projects. Here's the breakdown:",
      "type": "rich",
      "cards": [ ... ],
      "actions": [ ... ],
      "followUpQuestions": [ ... ],
      "sources": ["payments", "projects"]
    },
    "intent": {
      "category": "payments",
      "confidence": 0.85,
      "entities": {
        "period": "this_month"
      }
    },
    "tokensUsed": 1847
  }
}
```

### Top-Level Response Fields

| Field | Type | Always Present | Description |
|-------|------|----------------|-------------|
| `success` | `boolean` | Yes | `true` on success |
| `data.conversationId` | `string` | Yes | Conversation ID — pass back in next request for multi-turn. |
| `data.messageId` | `string` | Yes | Unique ID for this specific message. |
| `data.response` | `CopilotResponse` | Yes | The actual answer (see below). |
| `data.intent` | `Intent` | Yes | Detected intent/category of the question. |
| `data.tokensUsed` | `number` | Yes | OpenAI tokens consumed (useful for monitoring). |

### CopilotResponse Fields

| Field | Type | Always Present | Description |
|-------|------|----------------|-------------|
| `text` | `string` | **Yes** | Natural language answer — always render this. |
| `type` | `"text" \| "rich"` | **Yes** | `"text"` = plain answer, `"rich"` = answer + cards. |
| `cards` | `Card[]` | No | Structured data cards to render below the text. Empty array if none. |
| `actions` | `Action[]` | No | Navigation buttons/links. Empty array if none. |
| `followUpQuestions` | `string[]` | No | 2-3 suggested follow-up questions as clickable chips. |
| `sources` | `string[]` | No | Data sources queried (e.g., `["sales", "projects"]`). |

### Intent Fields

| Field | Type | Description |
|-------|------|-------------|
| `intent.category` | `string` | One of: `general`, `projection`, `leads`, `sales`, `payments`, `inventory`, `projects`, `team`, `commissions`, `comparison`, `overview` |
| `intent.confidence` | `number` | Confidence score 0–1 |
| `intent.entities` | `object` | Extracted entities like `{ project: "Green Valley", period: "this_month" }` |

---

## 6. Card Types & Rendering Guide

Cards are the structured data components returned in `response.cards[]`. Each card has a `type` field that determines how to render it.

### 6.1 Metrics Card (`type: "metrics"`)

Displays key metric values — render as a grid of stat boxes.

```json
{
  "type": "metrics",
  "title": "Revenue Summary — January 2026",
  "metrics": [
    {
      "label": "Total Collected",
      "value": 42000000,
      "unit": "currency",
      "trend": "up",
      "changePercent": 12.5
    },
    {
      "label": "Total Outstanding",
      "value": 18500000,
      "unit": "currency"
    },
    {
      "label": "Overdue Amount",
      "value": 5200000,
      "unit": "currency",
      "trend": "down",
      "changePercent": -8.3
    },
    {
      "label": "Collection Rate",
      "value": 78,
      "unit": "percent",
      "trend": "up"
    }
  ]
}
```

**Metric Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `label` | `string` | Metric name |
| `value` | `number \| string` | The value |
| `unit` | `string` | How to format: `"currency"` → ₹ format, `"percent"` → %, `"number"` → plain, `"units"` → append "units", `"text"` → display as-is |
| `trend` | `string?` | Optional: `"up"` (green ↑), `"down"` (red ↓), `"flat"` (gray →) |
| `changePercent` | `number?` | Optional: percentage change (positive = increase) |

**Currency Formatting Rules (INR):**

```javascript
function formatINR(value) {
  if (value >= 10000000) return `₹${(value / 10000000).toFixed(2)} Cr`;
  if (value >= 100000) return `₹${(value / 100000).toFixed(2)} L`;
  if (value >= 1000) return `₹${(value / 1000).toFixed(1)} K`;
  return `₹${value.toLocaleString('en-IN')}`;
}
```

**Rendering suggestion:**
```
┌─────────────────┐ ┌─────────────────┐
│ Total Collected  │ │ Outstanding     │
│ ₹4.20 Cr    ↑12%│ │ ₹1.85 Cr       │
└─────────────────┘ └─────────────────┘
┌─────────────────┐ ┌─────────────────┐
│ Overdue Amount  │ │ Collection Rate │
│ ₹52 L       ↓8% │ │ 78%         ↑   │
└─────────────────┘ └─────────────────┘
```

---

### 6.2 Table Card (`type: "table"`)

Displays tabular data — render as a data table with column headers.

```json
{
  "type": "table",
  "title": "High Priority Leads",
  "columns": [
    { "key": "name", "label": "Name" },
    { "key": "project", "label": "Project" },
    { "key": "score", "label": "Score" },
    { "key": "status", "label": "Status" },
    { "key": "nextFollowUp", "label": "Next Follow-up" }
  ],
  "rows": [
    {
      "name": "Rahul Sharma",
      "project": "Green Valley",
      "score": 92,
      "status": "Negotiating",
      "nextFollowUp": "2026-02-10"
    },
    {
      "name": "Priya Patel",
      "project": "Sunrise Heights",
      "score": 87,
      "status": "Site Visit Completed",
      "nextFollowUp": "2026-02-11"
    }
  ]
}
```

**Table Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `columns` | `{ key: string, label: string }[]` | Column definitions |
| `rows` | `Record<string, any>[]` | Row data — keys match column `key` values |

---

### 6.3 Chart Data Card (`type: "chart_data"`)

Provides data for rendering a chart. **You choose the chart library** (Recharts, Chart.js, etc.).

```json
{
  "type": "chart_data",
  "chartType": "bar",
  "title": "Monthly Sales Forecast",
  "data": [
    { "month": "Mar 2026", "sales": 8, "revenue": 60000000 },
    { "month": "Apr 2026", "sales": 7, "revenue": 52500000 },
    { "month": "May 2026", "sales": 9, "revenue": 67500000 },
    { "month": "Jun 2026", "sales": 8, "revenue": 60000000 },
    { "month": "Jul 2026", "sales": 10, "revenue": 75000000 },
    { "month": "Aug 2026", "sales": 9, "revenue": 67500000 }
  ],
  "xKey": "month",
  "yKeys": ["sales", "revenue"]
}
```

**Chart Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `chartType` | `string` | `"line"`, `"bar"`, `"pie"`, or `"area"` |
| `data` | `object[]` | Array of data points |
| `xKey` | `string` | Key in data objects for the x-axis |
| `yKeys` | `string[]` | Keys in data objects for the y-axis series |

**Rendering tips:**
- For `"pie"` charts, `xKey` is the label and the first `yKey` is the value.
- When `yKeys` has multiple entries (e.g., `["sales", "revenue"]`), render as a multi-series chart. Consider using dual y-axes if units differ.
- Format revenue values using the INR formatter.

---

### 6.4 List Card (`type: "list"`)

Displays a simple list of items — render as a vertical list.

```json
{
  "type": "list",
  "title": "Overdue Follow-ups",
  "items": [
    {
      "title": "Rahul Sharma",
      "subtitle": "Green Valley — Negotiating",
      "value": "5 days overdue",
      "status": "overdue"
    },
    {
      "title": "Amit Kumar",
      "subtitle": "Sunrise Heights — Site Visit Scheduled",
      "value": "2 days overdue",
      "status": "overdue"
    },
    {
      "title": "Sneha Reddy",
      "subtitle": "Green Valley — Qualified",
      "value": "Due today",
      "status": "due"
    }
  ]
}
```

**List Item Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `title` | `string` | Primary text |
| `subtitle` | `string?` | Secondary text (smaller, muted) |
| `value` | `string?` | Right-aligned value or badge |
| `status` | `string?` | Status for color coding: `"overdue"` (red), `"due"` (orange), `"completed"` (green), `"active"` (blue) |

---

### 6.5 Alert Card (`type: "alert"`)

Displays a prominent alert/notification banner.

```json
{
  "type": "alert",
  "severity": "warning",
  "title": "Attention Required",
  "message": "3 leads have overdue follow-ups — oldest is 5 days overdue"
}
```

**Alert Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `severity` | `string` | `"info"` (blue), `"warning"` (yellow/orange), `"error"` (red), `"success"` (green) |
| `title` | `string` | Alert card title |
| `message` | `string` | Alert body text |

---

## 7. Actions & Navigation

Actions are suggested navigation buttons rendered below the response.

```json
{
  "actions": [
    {
      "label": "View Full Forecast",
      "type": "navigate",
      "path": "/analytics/predictive"
    },
    {
      "label": "View Project",
      "type": "navigate",
      "path": "/projects/507f1f77bcf86cd799439011"
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `label` | `string` | Button text |
| `type` | `string` | `"navigate"` — use your frontend router to navigate |
| `path` | `string` | Frontend route path (for `navigate` type) |

**Render as:** Compact outlined buttons or chips below the cards.

---

## 8. Conversation Memory (Multi-turn)

The copilot supports multi-turn conversations. The backend stores the last 10 message pairs for 30 minutes.

### How It Works

1. **First message**: Don't send `conversationId` (or send `null`). The response will include a new `conversationId`.
2. **Follow-up messages**: Send the `conversationId` from the previous response. The AI will have context from earlier messages.

### Example Flow

```
Turn 1:
  Request:  { "message": "Show leads for Green Valley" }
  Response: { "data": { "conversationId": "conv_r4k8m2xn...", ... } }

Turn 2:
  Request:  { "message": "How many of those are high priority?", "conversationId": "conv_r4k8m2xn..." }
  Response: (AI remembers it was talking about Green Valley leads)

Turn 3:
  Request:  { "message": "Send me details of the top one", "conversationId": "conv_r4k8m2xn..." }
  Response: (AI provides details of the highest-scoring lead from the Green Valley set)
```

### Frontend Implementation Notes

- Store `conversationId` in the chat component's state.
- When the user starts a **new conversation** (e.g., clicks "New Chat"), clear the stored `conversationId`.
- Conversations **auto-expire after 30 minutes** of inactivity — if the backend generates a new `conversationId`, treat it as a new conversation.

---

## 9. Error Handling

### Error Response Format

All errors follow this structure:

```json
{
  "success": false,
  "message": "Human-readable error message",
  "code": "ERROR_CODE"
}
```

### Error Codes Reference

| HTTP Status | Code | Cause | Frontend Action |
|-------------|------|-------|-----------------|
| `400` | — | Empty or invalid message | Show validation error under input |
| `401` | — | Missing/expired JWT | Redirect to login |
| `403` | — | Role not authorized | Show "Access denied" message |
| `429` | `COPILOT_RATE_LIMITED` | Exceeded 20 req/min | Show "Please wait" + disable input for `retryAfter` seconds |
| `429` | `AI_RATE_LIMITED` | OpenAI rate limit | Show "AI is busy, try again shortly" |
| `503` | `AI_SERVICE_ERROR` | OpenAI API down | Show "AI temporarily unavailable" with retry button |
| `503` | `AI_MODEL_ERROR` | Model unavailable | Show "AI temporarily unavailable" |
| `500` | — | Unexpected error | Show generic "Something went wrong" with retry |

### Handling Rate Limits

When receiving a `429`, the response includes standard rate-limit headers:

```
RateLimit-Limit: 20
RateLimit-Remaining: 0
RateLimit-Reset: 1707500000
```

Show a countdown timer or disable the input until `RateLimit-Reset` epoch time.

### Graceful Degradation for Unrecognized Questions

The AI will **never return an error** for unrecognized questions. Instead, it responds with:

```json
{
  "success": true,
  "data": {
    "response": {
      "text": "I'm not sure I understand. I can help you with:\n- Sales projections and forecasts\n- Lead pipeline and status\n- Payment and collection updates\n- Unit inventory and availability\n- Team performance metrics\n\nCould you rephrase your question?",
      "type": "text",
      "followUpQuestions": [
        "What are my sales this month?",
        "Show overdue payments",
        "Which projects have available units?"
      ]
    }
  }
}
```

---

## 10. Rate Limiting

| Property | Value |
|----------|-------|
| Window | 1 minute (60 seconds) |
| Max requests | 20 per user per window |
| Key | User ID + IP address |
| Response headers | Standard `RateLimit-*` headers |

The rate limiter is **per authenticated user**, so different users don't affect each other.

---

## 11. Complete Example Conversations

### Example 1: Sales Projection (Rich Response)

**Request:**
```json
{
  "message": "What does projection look like for Green Valley project?"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "conversationId": "conv_r4k8m2xnlq1s6b7f",
    "messageId": "msg_p3j7n1wmlq1s6b8g",
    "response": {
      "text": "Green Valley Residency is performing well. Based on the last 6 months of sales data, here's the forecast for the next 6 months:",
      "type": "rich",
      "cards": [
        {
          "type": "metrics",
          "title": "6-Month Sales Forecast — Green Valley",
          "metrics": [
            { "label": "Projected Sales", "value": 45, "unit": "units" },
            { "label": "Projected Revenue", "value": 337500000, "unit": "currency" },
            { "label": "Confidence", "value": 85, "unit": "percent" },
            { "label": "Current Velocity", "value": 8, "unit": "text" }
          ]
        },
        {
          "type": "chart_data",
          "chartType": "bar",
          "title": "Monthly Breakdown",
          "data": [
            { "month": "Mar 2026", "sales": 8, "revenue": 60000000 },
            { "month": "Apr 2026", "sales": 7, "revenue": 52500000 },
            { "month": "May 2026", "sales": 8, "revenue": 60000000 },
            { "month": "Jun 2026", "sales": 8, "revenue": 60000000 },
            { "month": "Jul 2026", "sales": 7, "revenue": 52500000 },
            { "month": "Aug 2026", "sales": 7, "revenue": 52500000 }
          ],
          "xKey": "month",
          "yKeys": ["sales", "revenue"]
        }
      ],
      "actions": [
        { "label": "View Detailed Forecast", "type": "navigate", "path": "/analytics/predictive" },
        { "label": "View Project", "type": "navigate", "path": "/projects/507f1f77bcf86cd799439011" }
      ],
      "followUpQuestions": [
        "How does this compare to last quarter?",
        "Which unit types are selling fastest?",
        "What is the overdue payment situation for Green Valley?"
      ],
      "sources": ["sales", "predictions", "projects"]
    },
    "intent": {
      "category": "projection",
      "confidence": 0.92,
      "entities": { "project": "Green Valley" }
    },
    "tokensUsed": 2134
  }
}
```

---

### Example 2: Lead Query (Table Response)

**Request:**
```json
{
  "message": "Show me my high priority leads"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "conversationId": "conv_x7m9p2rnlq1s7c3d",
    "messageId": "msg_k2h6m4wnlq1s7c4e",
    "response": {
      "text": "You have 8 high-priority leads that need attention. 3 have overdue follow-ups.",
      "type": "rich",
      "cards": [
        {
          "type": "alert",
          "severity": "warning",
          "title": "Overdue Follow-ups",
          "message": "3 leads have overdue follow-ups — oldest is 5 days overdue"
        },
        {
          "type": "table",
          "title": "High Priority Leads",
          "columns": [
            { "key": "name", "label": "Name" },
            { "key": "project", "label": "Project" },
            { "key": "score", "label": "Score" },
            { "key": "status", "label": "Status" },
            { "key": "nextFollowUp", "label": "Next Follow-up" }
          ],
          "rows": [
            { "name": "Rahul Sharma", "project": "Green Valley", "score": 92, "status": "Negotiating", "nextFollowUp": "2026-02-07" },
            { "name": "Priya Patel", "project": "Sunrise Heights", "score": 87, "status": "Site Visit Completed", "nextFollowUp": "2026-02-08" },
            { "name": "Amit Kumar", "project": "Green Valley", "score": 85, "status": "Qualified", "nextFollowUp": "2026-02-12" }
          ]
        }
      ],
      "actions": [
        { "label": "View All Leads", "type": "navigate", "path": "/leads?priority=High" }
      ],
      "followUpQuestions": [
        "Tell me more about Rahul Sharma",
        "Which projects have the most leads?",
        "What is the overall lead funnel?"
      ],
      "sources": ["leads"]
    },
    "intent": {
      "category": "leads",
      "confidence": 0.85,
      "entities": {}
    },
    "tokensUsed": 1567
  }
}
```

---

### Example 3: Simple Text Response (Greeting)

**Request:**
```json
{
  "message": "Hi"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "conversationId": "conv_a1b2c3d4lq1s8e5f",
    "messageId": "msg_e5f6g7h8lq1s8e6g",
    "response": {
      "text": "Hello! I'm your PropVantage AI Copilot. I can help you with:\n\n- **Sales & Revenue**: Monthly sales, projections, comparisons\n- **Leads**: Pipeline status, high priority leads, lead details\n- **Payments**: Collections, overdue payments, dues today\n- **Inventory**: Available units, unit options by criteria\n- **Team**: Sales performance, conversion rates\n- **Overview**: Business dashboard, key metrics\n\nWhat would you like to know?",
      "type": "text",
      "followUpQuestions": [
        "How is business this month?",
        "Show me overdue payments",
        "What are my sales this quarter?"
      ],
      "sources": []
    },
    "intent": {
      "category": "general",
      "confidence": 0.5,
      "entities": {}
    },
    "tokensUsed": 385
  }
}
```

---

### Example 4: Multi-turn Conversation

**Turn 1 — Request:**
```json
{ "message": "How much revenue did we collect this month?" }
```

**Turn 1 — Response (abbreviated):**
```json
{
  "data": {
    "conversationId": "conv_m4n5o6p7lq1s9f8g",
    "response": {
      "text": "You collected ₹4.2 Cr this month across all projects...",
      "type": "rich",
      "cards": [{ "type": "metrics", "title": "Revenue — Feb 2026", "metrics": [...] }]
    }
  }
}
```

**Turn 2 — Request:**
```json
{
  "message": "And what about overdue?",
  "conversationId": "conv_m4n5o6p7lq1s9f8g"
}
```

**Turn 2 — Response:**
```json
{
  "data": {
    "conversationId": "conv_m4n5o6p7lq1s9f8g",
    "response": {
      "text": "There are ₹1.8 Cr in overdue payments across 23 customers...",
      "type": "rich",
      "cards": [...]
    }
  }
}
```

**Turn 3 — Request:**
```json
{
  "message": "Which project has the most overdue?",
  "conversationId": "conv_m4n5o6p7lq1s9f8g"
}
```

---

### Example 5: Dashboard Overview (Multiple Card Types)

**Request:**
```json
{ "message": "How is business?" }
```

**Response:**
```json
{
  "success": true,
  "data": {
    "response": {
      "text": "Here's your business overview for today:",
      "type": "rich",
      "cards": [
        {
          "type": "metrics",
          "title": "Business Overview",
          "metrics": [
            { "label": "Active Projects", "value": 5, "unit": "number" },
            { "label": "Active Leads", "value": 142, "unit": "number" },
            { "label": "Sales This Month", "value": 12, "unit": "units" },
            { "label": "Revenue This Month", "value": 89000000, "unit": "currency", "trend": "up", "changePercent": 15 },
            { "label": "Total Collected", "value": 420000000, "unit": "currency" },
            { "label": "Overdue Amount", "value": 18500000, "unit": "currency", "trend": "down", "changePercent": -8 }
          ]
        },
        {
          "type": "chart_data",
          "chartType": "pie",
          "title": "Inventory Status",
          "data": [
            { "status": "Available", "count": 234 },
            { "status": "Booked", "count": 89 },
            { "status": "Sold", "count": 156 },
            { "status": "Blocked", "count": 12 }
          ],
          "xKey": "status",
          "yKeys": ["count"]
        },
        {
          "type": "alert",
          "severity": "info",
          "title": "Hot Leads",
          "message": "You have 18 high-priority leads that need attention today"
        }
      ],
      "actions": [
        { "label": "View Dashboard", "type": "navigate", "path": "/dashboard" },
        { "label": "View Leads", "type": "navigate", "path": "/leads?priority=High" }
      ],
      "followUpQuestions": [
        "Show me sales by project",
        "What's the overdue payment situation?",
        "How is the team performing this month?"
      ],
      "sources": ["projects", "leads", "sales", "payments", "units"]
    }
  }
}
```

---

## 12. UI/UX Recommendations

### Chat Interface Layout

```
┌───────────────────────────────────────────┐
│  🤖 PropVantage AI Copilot          [New] │
├───────────────────────────────────────────┤
│                                           │
│  ┌─ User ─────────────────────────────┐   │
│  │ How is business this month?        │   │
│  └────────────────────────────────────┘   │
│                                           │
│  ┌─ AI ───────────────────────────────┐   │
│  │ Here's your business overview...   │   │
│  │                                    │   │
│  │ ┌──── Metrics Card ────────────┐   │   │
│  │ │ Sales: 12  Revenue: ₹8.9 Cr │   │   │
│  │ └─────────────────────────────┘   │   │
│  │                                    │   │
│  │ ┌──── Chart Card ─────────────┐   │   │
│  │ │  📊 (rendered chart)        │   │   │
│  │ └─────────────────────────────┘   │   │
│  │                                    │   │
│  │ [View Dashboard] [View Leads]      │   │
│  │                                    │   │
│  │ Follow-up:                         │   │
│  │ [Show sales by project]            │   │
│  │ [What's overdue?]                  │   │
│  │ [Team performance?]                │   │
│  └────────────────────────────────────┘   │
│                                           │
├───────────────────────────────────────────┤
│  [Type your question...        ] [Send ➤] │
└───────────────────────────────────────────┘
```

### Key UX Guidelines

1. **Loading State**: Show a typing indicator / skeleton animation during the 2-8 second wait.

2. **Follow-up Chips**: Render `followUpQuestions` as clickable chips/buttons below the response. On click, send the text as a new message with the same `conversationId`.

3. **Action Buttons**: Render `actions` as compact outlined buttons. On click, use your frontend router to navigate to `action.path`.

4. **Card Rendering Order**: Render cards in the order they appear in the array. Typically: alert → metrics → table/chart → list.

5. **Source Badges**: Optionally show `sources` as small badges (e.g., "📊 sales · 👥 leads") below the response for transparency.

6. **New Chat Button**: Provide a "New Chat" button that clears the `conversationId` and chat history.

7. **Error Messages**: Display error messages in the chat flow as system messages (not as modal popups).

8. **Message Input**:
   - Max 2000 characters
   - Submit on Enter, Shift+Enter for newline
   - Disable input while waiting for response
   - Disable input during rate limit cooldown

9. **Scroll Behavior**: Auto-scroll to the latest message when a new response arrives.

10. **Intent Badge**: Optionally show `intent.category` as a small tag on the AI's response (e.g., "📈 projection").

11. **Empty State**: When opening the chat for the first time, show the greeting + suggested questions:
    - "How is business this month?"
    - "Show me high priority leads"
    - "Revenue collected this month?"
    - "What should I focus on today?"

---

## 13. TypeScript Interfaces

Use these interfaces for type-safe development:

```typescript
// ---- Request ----

interface CopilotChatRequest {
  message: string;                    // Required, max 2000 chars
  conversationId?: string;            // Optional, for multi-turn
  context?: {
    currentPage?: string;
    projectId?: string;
    filters?: Record<string, any>;
  };
}

// ---- Response ----

interface CopilotChatResponse {
  success: true;
  data: {
    conversationId: string;
    messageId: string;
    response: CopilotResponse;
    intent: Intent;
    tokensUsed: number;
  };
}

interface CopilotResponse {
  text: string;                       // Always present — natural language answer
  type: 'text' | 'rich';             // "rich" when cards are included
  cards?: Card[];                     // Structured data cards
  actions?: Action[];                 // Navigation actions
  followUpQuestions?: string[];       // Suggested follow-up questions
  sources?: string[];                 // Data sources queried
}

interface Intent {
  category:
    | 'general'
    | 'projection'
    | 'leads'
    | 'sales'
    | 'payments'
    | 'inventory'
    | 'projects'
    | 'team'
    | 'commissions'
    | 'comparison'
    | 'overview';
  confidence: number;                 // 0 to 1
  entities: Record<string, string>;   // Extracted entities
}

// ---- Cards ----

type Card = MetricsCard | TableCard | ChartDataCard | ListCard | AlertCard;

interface MetricsCard {
  type: 'metrics';
  title: string;
  metrics: Metric[];
}

interface Metric {
  label: string;
  value: number | string;
  unit: 'currency' | 'percent' | 'number' | 'units' | 'text';
  trend?: 'up' | 'down' | 'flat';
  changePercent?: number;
}

interface TableCard {
  type: 'table';
  title: string;
  columns: { key: string; label: string }[];
  rows: Record<string, any>[];
}

interface ChartDataCard {
  type: 'chart_data';
  chartType: 'line' | 'bar' | 'pie' | 'area';
  title: string;
  data: Record<string, any>[];
  xKey: string;
  yKeys: string[];
}

interface ListCard {
  type: 'list';
  title: string;
  items: ListItem[];
}

interface ListItem {
  title: string;
  subtitle?: string;
  value?: string;
  status?: 'overdue' | 'due' | 'completed' | 'active' | string;
}

interface AlertCard {
  type: 'alert';
  severity: 'info' | 'warning' | 'error' | 'success';
  title: string;
  message: string;
}

// ---- Actions ----

interface Action {
  label: string;
  type: 'navigate';
  path: string;                       // Frontend route path
}

// ---- Error ----

interface CopilotErrorResponse {
  success: false;
  message: string;
  code?: 'COPILOT_RATE_LIMITED' | 'AI_RATE_LIMITED' | 'AI_SERVICE_ERROR' | 'AI_MODEL_ERROR';
  retryAfter?: number;                // Seconds to wait before retrying
}
```

### React Hook Example (Minimal)

```typescript
import { useState, useCallback } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  response?: CopilotResponse;
}

export function useCopilotChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendMessage = useCallback(async (text: string, context?: CopilotChatRequest['context']) => {
    setIsLoading(true);
    setError(null);

    // Add user message to chat
    setMessages(prev => [...prev, { role: 'user', content: text }]);

    try {
      const res = await fetch('/api/ai/copilot/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({
          message: text,
          conversationId,
          context,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || 'Something went wrong');
      }

      const data: CopilotChatResponse = await res.json();
      const { response, conversationId: newConvId } = data.data;

      setConversationId(newConvId);

      // Add AI response to chat
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: response.text, response },
      ]);
    } catch (err: any) {
      setError(err.message);
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: err.message },
      ]);
    } finally {
      setIsLoading(false);
    }
  }, [conversationId]);

  const resetChat = useCallback(() => {
    setMessages([]);
    setConversationId(null);
    setError(null);
  }, []);

  return { messages, isLoading, error, sendMessage, resetChat, conversationId };
}
```

---

**End of AI Copilot Frontend Guide**
