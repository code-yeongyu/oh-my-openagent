# Cost Tracking & Budget Management

Tracks real costs per model/agent/session with budget alerts.

## API

### Pricing
- `getModelPrice(modelId)` — Get price for a model (falls back to generic)
- `setCustomPrice(modelId, price)` — Override price for a specific model
- `calculateCost(modelId, inputTokens, outputTokens)` — Calculate USD cost
- `formatCost(usd)` — Human-readable cost string

### Storage
- `insertCostEntry(entry)` — Store a cost entry
- `getSessionCost(sessionId)` — Total cost for a session
- `getCostByAgent(since)` — Cost breakdown by agent
- `getCostByModel(since)` — Cost breakdown by model

### Budgets
- `setBudget(budget)` — Create/update a budget
- `checkBudgets(range)` — Check budgets and generate alerts if exceeded

### Reports
- `getCostSummary(range)` — Aggregated cost summary
- `formatCostReport(summary)` — Plain text report
