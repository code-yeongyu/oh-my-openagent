# Dashboard Web UI

Embedded HTTP server with real-time agent dashboard.

## Usage

```typescript
import { startDashboardServer, stopDashboardServer } from "./index"

// Start on default port 4321
startDashboardServer()

// Start on custom port
startDashboardServer(8080)

// Stop the server
stopDashboardServer()
```

## API Endpoints

| Endpoint | Data Source | Description |
|---|---|---|
| `GET /` | — | Single-page dashboard HTML |
| `GET /api/agents` | agent-analytics | Event counts, success rates, top agents |
| `GET /api/cost-summary` | cost-tracking | Total cost, cost by model, daily cost |
| `GET /api/sessions` | session-replay | Session count, snapshots, errors |
| `GET /api/health` | — | Server health check |

## Frontend

Self-contained HTML page with Chart.js loaded from CDN. Shows:
- Summary metrics cards (events, cost, sessions, errors)
- Bar chart of top agents by event count
- Doughnut chart of cost distribution by model
