# AI Copilot Backend Requirements

## Backend Developer Handoff Document
**Feature**: AI Copilot Chat — Natural Language Query Interface
**Priority**: High
**Estimated Effort**: 3-5 days

---

## 1. Overview

Build a single AI-powered chat endpoint that accepts natural language questions from users and returns intelligent answers by querying the PropVantage database. The endpoint uses OpenAI GPT-4 (already integrated in the backend) as the reasoning engine.

**Example user questions**:
- "What does projection look like for Green Valley project?"
- "Show me my high priority leads"
- "How much revenue did we collect this month?"
- "Which units are available in Tower A?"
- "What's the overdue payment situation?"
- "Compare performance of Project A vs Project B"

---

## 2. Endpoint Specification

### POST /api/ai/copilot/chat

**Access**: Private (All authenticated roles)

**Rate Limit**: 20 requests per minute per user

**Request Body**:
```json
{
  "message": "What does the sales projection look like for Green Valley?",
  "conversationId": "conv_abc123",        // optional — for multi-turn conversations
  "context": {                             // optional — frontend can pass current page context
    "currentPage": "project-detail",
    "projectId": "507f1f77bcf86cd799439011",
    "filters": {}
  }
}
```

**Response (200)**:
```json
{
  "success": true,
  "data": {
    "conversationId": "conv_abc123",
    "messageId": "msg_xyz789",
    "response": {
      "text": "Green Valley Residency is performing well. Here's the projection for the next 6 months...",
      "type": "rich",
      "cards": [
        {
          "type": "metrics",
          "title": "Sales Projection — Green Valley",
          "metrics": [
            { "label": "Projected Sales (6M)", "value": 45, "unit": "units" },
            { "label": "Projected Revenue", "value": 337500000, "unit": "currency" },
            { "label": "Confidence", "value": 85, "unit": "percent" }
          ]
        },
        {
          "type": "chart_data",
          "chartType": "line",
          "title": "Monthly Forecast",
          "data": [
            { "month": "Feb 2024", "sales": 8, "revenue": 60000000 },
            { "month": "Mar 2024", "sales": 7, "revenue": 52500000 }
          ]
        }
      ],
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
      ],
      "sources": ["sales", "predictions", "projects"]
    },
    "intent": {
      "category": "projection",
      "confidence": 0.92,
      "entities": {
        "project": "Green Valley Residency"
      }
    }
  }
}
```

---

## 3. How It Should Work Internally

### Architecture: Function-Calling Pattern

Use OpenAI's **function calling** (tool use) to let GPT-4 decide which database queries to run.

```
User Question
    ↓
GPT-4 (with system prompt + available functions)
    ↓
GPT-4 decides which function(s) to call
    ↓
Backend executes those functions (MongoDB queries)
    ↓
Results fed back to GPT-4
    ↓
GPT-4 generates natural language response + structured cards
    ↓
Return to frontend
```

### Step-by-step Flow:

1. **Receive** user message + auth token
2. **Extract** user's org, role, and permissions from JWT
3. **Build system prompt** with user context (role, org, current date)
4. **Send to GPT-4** with function definitions (see Section 4)
5. **GPT-4 returns** function calls (e.g., `get_project_sales`, `get_leads`)
6. **Execute** the function calls against MongoDB (scoped to user's org)
7. **Feed results** back to GPT-4
8. **GPT-4 generates** a natural language answer + structured response
9. **Return** the structured response to frontend

### System Prompt Template:

```
You are PropVantage AI Copilot, an intelligent assistant for a real estate CRM platform.

Current user: {{userName}} ({{userRole}})
Organization: {{orgName}}
Current date: {{currentDate}}
Currency: INR (Indian Rupees)

You help users understand their business data by answering questions about:
- Projects, towers, and unit inventory
- Leads and sales pipeline
- Revenue, payments, and collections
- Sales forecasts and projections
- Team performance
- Commissions

Rules:
1. Always scope data to the user's organization
2. Format currency in Indian format (₹ Cr, ₹ L, ₹ K)
3. Be concise but informative
4. When showing numbers, also provide context (comparisons, trends)
5. If data is insufficient to answer, say so honestly
6. Respect role-based access — don't show financial data to Sales Executives
7. Always provide actionable suggestions when relevant
8. Return structured cards when the answer contains metrics or tabular data
```

---

## 4. Function Definitions for GPT-4

Define these as OpenAI function-calling tools. Each function maps to a MongoDB query.

### 4.1 Project Functions

```javascript
{
  name: "get_projects",
  description: "Get projects list with optional filters",
  parameters: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["planning", "pre-launch", "launched", "under-construction", "completed", "on-hold"] },
      name_search: { type: "string", description: "Search project by name" },
      type: { type: "string", enum: ["apartment", "villa", "plot", "commercial"] }
    }
  }
}

{
  name: "get_project_details",
  description: "Get detailed information about a specific project including units, revenue, sales stats",
  parameters: {
    type: "object",
    properties: {
      project_id: { type: "string" },
      project_name: { type: "string", description: "If ID not known, search by name" }
    }
  }
}

{
  name: "get_project_budget_variance",
  description: "Get budget vs actual analysis for a project",
  parameters: {
    type: "object",
    properties: {
      project_id: { type: "string", description: "Project ID" }
    },
    required: ["project_id"]
  }
}
```

### 4.2 Sales & Revenue Functions

```javascript
{
  name: "get_sales_summary",
  description: "Get sales summary - total sales, revenue, by project, by status, trends",
  parameters: {
    type: "object",
    properties: {
      project_id: { type: "string", description: "Filter by project" },
      period: { type: "string", enum: ["today", "this_week", "this_month", "this_quarter", "this_year", "last_month", "last_quarter", "custom"] },
      start_date: { type: "string", description: "Custom start date (ISO format)" },
      end_date: { type: "string", description: "Custom end date (ISO format)" },
      salesperson_id: { type: "string", description: "Filter by salesperson" }
    }
  }
}

{
  name: "get_sales_forecast",
  description: "Get AI-powered sales forecast/projection",
  parameters: {
    type: "object",
    properties: {
      project_id: { type: "string" },
      period: { type: "string", enum: ["3_months", "6_months", "12_months"], default: "6_months" }
    }
  }
}

{
  name: "get_revenue_analysis",
  description: "Get revenue analysis - collected, pending, overdue, projections",
  parameters: {
    type: "object",
    properties: {
      project_id: { type: "string" },
      period: { type: "string" }
    }
  }
}
```

### 4.3 Lead Functions

```javascript
{
  name: "get_leads_summary",
  description: "Get leads overview - counts by status, source, priority, recent leads",
  parameters: {
    type: "object",
    properties: {
      project_id: { type: "string" },
      status: { type: "string" },
      priority: { type: "string", enum: ["Critical", "High", "Medium", "Low"] },
      assigned_to: { type: "string", description: "Filter by assigned user" },
      source: { type: "string" }
    }
  }
}

{
  name: "get_lead_funnel",
  description: "Get lead conversion funnel - stage-wise counts and conversion rates",
  parameters: {
    type: "object",
    properties: {
      project_id: { type: "string" },
      period: { type: "string" }
    }
  }
}

{
  name: "get_high_priority_leads",
  description: "Get leads needing immediate attention - high priority, overdue follow-ups",
  parameters: {
    type: "object",
    properties: {
      limit: { type: "number", default: 10 }
    }
  }
}

{
  name: "get_lead_details",
  description: "Get details of a specific lead by name or phone",
  parameters: {
    type: "object",
    properties: {
      search: { type: "string", description: "Lead name, phone, or email" }
    },
    required: ["search"]
  }
}
```

### 4.4 Unit/Inventory Functions

```javascript
{
  name: "get_inventory_summary",
  description: "Get unit inventory status - available, booked, sold counts by project/tower",
  parameters: {
    type: "object",
    properties: {
      project_id: { type: "string" },
      tower_id: { type: "string" },
      status: { type: "string", enum: ["available", "booked", "sold", "blocked"] },
      type: { type: "string", description: "Unit type like 2BHK, 3BHK" }
    }
  }
}

{
  name: "get_available_units",
  description: "Get list of available units with pricing, useful when customer asks for options",
  parameters: {
    type: "object",
    properties: {
      project_id: { type: "string" },
      tower_id: { type: "string" },
      unit_type: { type: "string" },
      min_price: { type: "number" },
      max_price: { type: "number" },
      floor_preference: { type: "string", enum: ["low", "mid", "high"] },
      facing: { type: "string" }
    }
  }
}
```

### 4.5 Payment Functions

```javascript
{
  name: "get_payment_summary",
  description: "Get payment collection summary - collected, pending, overdue amounts",
  parameters: {
    type: "object",
    properties: {
      project_id: { type: "string" },
      period: { type: "string" }
    }
  }
}

{
  name: "get_overdue_payments",
  description: "Get overdue payments with customer details",
  parameters: {
    type: "object",
    properties: {
      project_id: { type: "string" },
      min_overdue_days: { type: "number" },
      limit: { type: "number", default: 20 }
    }
  }
}

{
  name: "get_payments_due_today",
  description: "Get payments due today or this week",
  parameters: {
    type: "object",
    properties: {}
  }
}
```

### 4.6 Team & Performance Functions

```javascript
{
  name: "get_team_performance",
  description: "Get sales team performance - sales by person, lead conversion rates",
  parameters: {
    type: "object",
    properties: {
      period: { type: "string" },
      role: { type: "string" }
    }
  }
}

{
  name: "get_commission_summary",
  description: "Get commission overview - pending, approved, paid amounts",
  parameters: {
    type: "object",
    properties: {
      partner_id: { type: "string" },
      project_id: { type: "string" },
      status: { type: "string" }
    }
  }
}
```

### 4.7 Comparison & Analytics Functions

```javascript
{
  name: "compare_projects",
  description: "Compare two or more projects on sales, revenue, velocity metrics",
  parameters: {
    type: "object",
    properties: {
      project_ids: { type: "array", items: { type: "string" } },
      project_names: { type: "array", items: { type: "string" }, description: "If IDs unknown, search by names" },
      metrics: { type: "array", items: { type: "string" }, description: "Metrics to compare: sales, revenue, velocity, inventory" }
    }
  }
}

{
  name: "get_dashboard_overview",
  description: "Get high-level business overview - all key metrics at once",
  parameters: {
    type: "object",
    properties: {}
  }
}
```

---

## 5. Response Structure

GPT-4 should return a JSON object with this structure. Use a structured output prompt or parse its response.

```typescript
interface CopilotResponse {
  text: string;                    // Natural language answer (always present)
  type: "text" | "rich";          // "rich" when cards are included
  cards?: Card[];                  // Structured data cards (optional)
  actions?: Action[];              // Suggested navigation actions (optional)
  followUpQuestions?: string[];    // Suggested follow-up questions (optional)
  sources: string[];               // Which data sources were queried
}

interface Card {
  type: "metrics" | "table" | "chart_data" | "list" | "alert";
  title: string;

  // For type: "metrics"
  metrics?: Array<{
    label: string;
    value: number | string;
    unit: "currency" | "percent" | "number" | "units" | "text";
    trend?: "up" | "down" | "flat";
    changePercent?: number;
  }>;

  // For type: "table"
  columns?: Array<{ key: string; label: string }>;
  rows?: Array<Record<string, any>>;

  // For type: "chart_data"
  chartType?: "line" | "bar" | "pie" | "area";
  data?: Array<Record<string, any>>;
  xKey?: string;
  yKeys?: string[];

  // For type: "list"
  items?: Array<{
    title: string;
    subtitle?: string;
    value?: string;
    status?: string;
  }>;

  // For type: "alert"
  severity?: "info" | "warning" | "error" | "success";
  message?: string;
}

interface Action {
  label: string;
  type: "navigate" | "api_call";
  path?: string;                  // For navigate
  endpoint?: string;              // For api_call
}
```

---

## 6. Conversation Memory

### Short-term (within session):
- Store last 10 messages per `conversationId` in **Redis** or in-memory
- Pass conversation history to GPT-4 for context continuity
- Enables follow-ups like:
  - User: "Show leads for Green Valley"
  - User: "How many of those are high priority?" (refers to previous answer)

### Schema:
```javascript
// Redis key: copilot:conv:{conversationId}
// TTL: 30 minutes (auto-expire)
{
  conversationId: "conv_abc123",
  userId: "507f1f77bcf86cd799439011",
  messages: [
    { role: "user", content: "Show leads for Green Valley", timestamp: "..." },
    { role: "assistant", content: "Green Valley has 45 leads...", timestamp: "..." },
    { role: "user", content: "How many are high priority?", timestamp: "..." }
  ]
}
```

If Redis is not available, use a simple in-memory Map with TTL cleanup — this is acceptable since conversation context is session-scoped and non-critical.

---

## 7. Role-Based Data Scoping

**Critical**: Every database query MUST be scoped to:
1. The user's `organization` (always)
2. The user's role permissions

| Role | Data Access |
|------|------------|
| Business Head | All data across organization |
| Project Director | All data across organization |
| Sales Head | All sales, leads, projects |
| Finance Head | All financial data, payments, commissions |
| Sales Manager | Own team's leads and sales + project data |
| Sales Executive | Only own leads and sales |
| Channel Partner | Only own commissions and referred leads |

```javascript
// Example: Always add org filter
const getLeads = async (params, user) => {
  const query = {
    organization: user.organization,  // ALWAYS scope to org
    ...params
  };

  // Role-based scoping
  if (user.role === 'Sales Executive') {
    query.assignedTo = user._id;  // Only own leads
  }

  return Lead.find(query);
};
```

---

## 8. Error Handling

```json
// When GPT-4 can't determine intent
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

```json
// When data access is restricted
{
  "success": true,
  "data": {
    "response": {
      "text": "I don't have permission to show financial details for your role. Please contact your manager for this information.",
      "type": "text"
    }
  }
}
```

```json
// When OpenAI API fails
{
  "success": false,
  "message": "AI service is temporarily unavailable. Please try again.",
  "code": "AI_SERVICE_ERROR"
}
```

---

## 9. Example Conversations

### Example 1: Sales Projection
```
User: "What does projection look like for Green Valley?"

→ GPT-4 calls: get_sales_forecast({ project_name: "Green Valley", period: "6_months" })
→ Backend resolves project name → ID, queries predictions

Response:
{
  text: "Green Valley Residency is on track. Here's the 6-month forecast:",
  type: "rich",
  cards: [
    {
      type: "metrics",
      title: "6-Month Sales Forecast",
      metrics: [
        { label: "Forecasted Sales", value: 45, unit: "units" },
        { label: "Projected Revenue", value: 337500000, unit: "currency" },
        { label: "Confidence", value: 85, unit: "percent" },
        { label: "Current Velocity", value: 8, unit: "text", suffix: "units/month" }
      ]
    },
    {
      type: "chart_data",
      chartType: "bar",
      title: "Monthly Breakdown",
      data: [...],
      xKey: "month",
      yKeys: ["sales", "revenue"]
    }
  ],
  actions: [{ label: "View Detailed Forecast", type: "navigate", path: "/analytics/predictive" }],
  followUpQuestions: ["How does this compare to last quarter?", "Which unit types are selling fastest?"]
}
```

### Example 2: Lead Query
```
User: "Show me my high priority leads"

→ GPT-4 calls: get_high_priority_leads({ limit: 10 })

Response:
{
  text: "You have 8 high-priority leads that need attention. 3 have overdue follow-ups.",
  type: "rich",
  cards: [
    {
      type: "alert",
      severity: "warning",
      message: "3 leads have overdue follow-ups — oldest is 5 days overdue"
    },
    {
      type: "table",
      title: "High Priority Leads",
      columns: [
        { key: "name", label: "Name" },
        { key: "project", label: "Project" },
        { key: "score", label: "Score" },
        { key: "status", label: "Status" },
        { key: "nextFollowUp", label: "Next Follow-up" }
      ],
      rows: [...]
    }
  ],
  actions: [{ label: "View All Leads", type: "navigate", path: "/leads?priority=High" }]
}
```

### Example 3: Multi-turn Conversation
```
User: "How much revenue did we collect this month?"
→ get_payment_summary({ period: "this_month" })
→ "You collected ₹4.2 Cr this month across all projects..."

User: "And what about overdue?"
→ get_overdue_payments({})  // GPT-4 understands context from conversation history
→ "There are ₹1.8 Cr in overdue payments across 23 customers..."

User: "Which project has the most overdue?"
→ get_overdue_payments({ group_by: "project" })  // GPT-4 infers from context
→ "Green Valley has the highest overdue amount at ₹85L across 12 customers..."
```

---

## 10. Implementation Checklist

### Files to Create:
- [ ] `routes/aiCopilotRoutes.js` — Route definition
- [ ] `controllers/aiCopilotController.js` — Request handler
- [ ] `services/aiCopilotService.js` — Core logic (GPT-4 orchestration)
- [ ] `services/copilotFunctions.js` — Database query functions (the tools)
- [ ] `middleware/copilotRateLimit.js` — Rate limiting

### Implementation Steps:
1. [ ] Define all function schemas for GPT-4 function calling
2. [ ] Implement each database query function with org/role scoping
3. [ ] Build the GPT-4 orchestration loop (send → get function calls → execute → feed back → get response)
4. [ ] Add conversation memory (Redis or in-memory)
5. [ ] Add role-based data filtering
6. [ ] Add rate limiting (20 req/min/user)
7. [ ] Add error handling for OpenAI failures
8. [ ] Add request/response logging for debugging
9. [ ] Test with 20+ sample questions across different intents
10. [ ] Add to existing route registration in `server.js`

### Register Route:
```javascript
// In server.js or routes/index.js
const aiCopilotRoutes = require('./routes/aiCopilotRoutes');
app.use('/api/ai/copilot', protect, aiCopilotRoutes);
```

---

## 11. Performance Considerations

- **GPT-4 latency**: Expect 2-5 seconds per request. Frontend should show typing indicator.
- **Parallel function calls**: If GPT-4 requests multiple functions, execute them in parallel with `Promise.all()`.
- **Token limits**: Cap conversation history at 10 messages to stay within context window.
- **Caching**: Cache frequently asked dashboard-level queries (TTL: 60 seconds) to avoid redundant DB hits.
- **Streaming** (optional enhancement): Use GPT-4 streaming to show response progressively. This is nice-to-have for V2.

---

## 12. Testing Scenarios

The endpoint should handle all of these correctly:

| # | Question | Expected Behavior |
|---|----------|-------------------|
| 1 | "Hi" / "Hello" | Greet and suggest what it can help with |
| 2 | "What are my sales this month?" | Query sales for current month, return metrics |
| 3 | "Show leads for Green Valley" | Resolve project name, return lead summary |
| 4 | "Which units are available in Tower A?" | Find tower, list available units |
| 5 | "Compare Green Valley and Sunrise Heights" | Query both projects, return comparison |
| 6 | "How much is overdue?" | Return overdue payment summary |
| 7 | "What should I focus on today?" | Combine: due today payments + overdue follow-ups + high priority leads |
| 8 | "Revenue projection for next quarter" | Call sales forecast with 3-month period |
| 9 | "Who is Rahul Sharma?" | Search leads by name, return details |
| 10 | "How is my team performing?" | Team sales metrics (role-dependent) |
| 11 | "What's the weather?" | Politely say it's outside scope, suggest relevant questions |
| 12 | "Tell me about commissions" | Return commission summary for the user's scope |

---

**End of Requirements**
