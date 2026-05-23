/**
 * Dashboard Web Server
 *
 * Embedded HTTP server that provides a real-time visual dashboard.
 * Reads dynamically from agent-analytics, cost-tracking, and session-replay DBs.
 */


interface DashboardApiResponse {
  ok: boolean
  data?: unknown
  error?: string
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ ok: true, data } satisfies DashboardApiResponse), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  })
}

function errorResponse(error: string, status = 500): Response {
  return new Response(JSON.stringify({ ok: false, error } satisfies DashboardApiResponse), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  })
}

let server: ReturnType<typeof Bun.serve> | null = null

export function startDashboardServer(port = 4321): void {
  if (server) return

  server = Bun.serve({
    port,
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url)

      try {
        switch (url.pathname) {
          case "/": {
            return new Response(getDashboardHtml(), {
              headers: { "Content-Type": "text/html; charset=utf-8" },
            })
          }

          case "/api/agents": {
            return jsonResponse(await getAgentStats())
          }

          case "/api/cost-summary": {
            return jsonResponse(await getCostStats())
          }

          case "/api/sessions": {
            return jsonResponse(await getSessionStats())
          }

          case "/api/health": {
            return jsonResponse({ status: "ok", uptime: process.uptime() })
          }

          default: {
            return errorResponse("Not found", 404)
          }
        }
      } catch (err) {
        return errorResponse(String(err))
      }
    },
  })

  console.log(`[dashboard] Server started on http://localhost:${port}`)
}

export function stopDashboardServer(): void {
  if (server) {
    server.stop()
    server = null
    console.log("[dashboard] Server stopped")
  }
}

export function isDashboardRunning(): boolean {
  return server !== null
}

// --- API handlers ---

async function getAgentStats(): Promise<Record<string, unknown>> {
  const { tmpdir } = await import("os")
  const { join } = await import("path")
  const dbPath = join(tmpdir(), "oh-my-opencode", "agent-analytics.db")
  try {
    const db = new (await import("bun:sqlite")).Database(dbPath)
    db.run("PRAGMA journal_mode = WAL")

    const totalEvents = (db.query("SELECT COUNT(*) as c FROM agent_metrics").get() as { c: number })?.c ?? 0
    const successEvents = (db.query("SELECT COUNT(*) as c FROM agent_metrics WHERE success = 1").get() as { c: number })?.c ?? 0
    const agentRows = db.query(
      "SELECT agent_name, COUNT(*) as cnt, AVG(CASE WHEN success = 1 THEN 1 ELSE 0 END) * 100 as rate FROM agent_metrics GROUP BY agent_name ORDER BY cnt DESC LIMIT 10",
    ).all() as Array<{ agent_name: string; cnt: number; rate: number }>

    const recent = db.query(
      "SELECT event_type, tool_name, agent_name, duration_ms, success, timestamp FROM agent_metrics ORDER BY timestamp DESC LIMIT 20",
    ).all()

    db.close()
    return {
      totalEvents,
      successRate: totalEvents > 0 ? ((successEvents / totalEvents) * 100).toFixed(1) : "0",
      topAgents: agentRows,
      recentEvents: recent,
    }
  } catch {
    return { totalEvents: 0, successRate: "0", topAgents: [], recentEvents: [], error: "agent-analytics DB not available" }
  }
}

async function getCostStats(): Promise<Record<string, unknown>> {
  const { tmpdir } = await import("os")
  const { join } = await import("path")
  const dbPath = join(tmpdir(), "oh-my-opencode", "cost-tracking.db")
  try {
    const db = new (await import("bun:sqlite")).Database(dbPath)
    db.run("PRAGMA journal_mode = WAL")

    const totalCost = (db.query("SELECT COALESCE(SUM(cost_usd), 0) as t FROM cost_entries").get() as { t: number })?.t ?? 0
    const modelRows = db.query(
      "SELECT model_used, COUNT(*) as calls, COALESCE(SUM(cost_usd), 0) as total_cost FROM cost_entries GROUP BY model_used ORDER BY total_cost DESC LIMIT 10",
    ).all()

    const dailyCost = db.query(
      "SELECT date(timestamp / 1000, 'unixepoch') as day, COALESCE(SUM(cost_usd), 0) as total FROM cost_entries GROUP BY day ORDER BY day DESC LIMIT 30",
    ).all()

    db.close()
    return { totalCost, costByModel: modelRows, dailyCost }
  } catch {
    return { totalCost: 0, costByModel: [], dailyCost: [], error: "cost-tracking DB not available" }
  }
}

async function getSessionStats(): Promise<Record<string, unknown>> {
  const { tmpdir } = await import("os")
  const { join } = await import("path")
  const dbPath = join(tmpdir(), "oh-my-opencode", "session-replay.db")
  try {
    const db = new (await import("bun:sqlite")).Database(dbPath)
    db.run("PRAGMA journal_mode = WAL")

    const totalSessions = (db.query("SELECT COUNT(DISTINCT session_id) as c FROM session_snapshots").get() as { c: number })?.c ?? 0
    const totalSnapshots = (db.query("SELECT COUNT(*) as c FROM session_snapshots").get() as { c: number })?.c ?? 0
    const errorCount = (db.query("SELECT COUNT(*) as c FROM session_snapshots WHERE event_type = 'error'").get() as { c: number })?.c ?? 0
    const toolCount = (db.query("SELECT COUNT(*) as c FROM session_snapshots WHERE event_type = 'tool_call'").get() as { c: number })?.c ?? 0

    db.close()
    return { totalSessions, totalSnapshots, totalErrors: errorCount, totalToolCalls: toolCount }
  } catch {
    return { totalSessions: 0, totalSnapshots: 0, totalErrors: 0, totalToolCalls: 0, error: "session-replay DB not available" }
  }
}

// --- Dashboard HTML (single-page, self-contained) ---

function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>OMO Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;background:#0d1117;color:#e6edf3;padding:20px}
h1{font-size:1.5rem;margin-bottom:20px;color:#58a6ff}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-bottom:24px}
.card{background:#161b22;border-radius:8px;padding:16px;border:1px solid #30363d}
.card h3{font-size:.85rem;color:#8b949e;margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px}
.card .value{font-size:1.8rem;font-weight:700;color:#f0f6fc}
.card .sub{font-size:.8rem;color:#8b949e;margin-top:4px}
table{width:100%;border-collapse:collapse;font-size:.85rem}
th{text-align:left;padding:8px;color:#8b949e;border-bottom:1px solid #30363d}
td{padding:8px;border-bottom:1px solid #21262d}
.chart-container{background:#161b22;border-radius:8px;padding:16px;border:1px solid #30363d;margin-bottom:16px}
.chart-container h3{margin-bottom:12px;color:#58a6ff}
.badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:.75rem;font-weight:600}
.badge-success{background:#238636;color:#fff}
.badge-error{background:#da3633;color:#fff}
.badge-warning{background:#d29922;color:#fff}
.loading{text-align:center;padding:40px;color:#8b949e}
</style>
</head>
<body>
<h1>OMO Agent Dashboard</h1>
<div class="grid" id="metrics"></div>
<div class="chart-container">
  <h3>Agent Performance</h3>
  <canvas id="agentChart" height="200"></canvas>
</div>
<div class="chart-container">
  <h3>Cost by Model</h3>
  <canvas id="costChart" height="200"></canvas>
</div>
<div id="details"></div>

<script>
async function loadData() {
  try {
    const [agents, cost, sessions] = await Promise.all([
      fetch('/api/agents').then(r=>r.json()),
      fetch('/api/cost-summary').then(r=>r.json()),
      fetch('/api/sessions').then(r=>r.json()),
    ])

    const a = agents.data, c = cost.data, s = sessions.data

    document.getElementById('metrics').innerHTML = \`
      <div class="card"><h3>Agent Events</h3><div class="value">\${a.totalEvents}</div><div class="sub">\${a.successRate}% success</div></div>
      <div class="card"><h3>Total Cost</h3><div class="value">$\${Number(c.totalCost).toFixed(4)}</div><div class="sub">USD</div></div>
      <div class="card"><h3>Sessions</h3><div class="value">\${s.totalSessions}</div><div class="sub">\${s.totalSnapshots} snapshots</div></div>
      <div class="card"><h3>Errors</h3><div class="value" style="color:\${s.totalErrors > 0 ? '#da3633' : '#3fb950'}">\${s.totalErrors}</div><div class="sub">\${s.totalToolCalls} tool calls</div></div>
    \`

    if (a.topAgents?.length) {
      new Chart(document.getElementById('agentChart'), {
        type: 'bar',
        data: {
          labels: a.topAgents.map(x => x.agent_name),
          datasets: [{
            label: 'Events',
            data: a.topAgents.map(x => x.cnt),
            backgroundColor: '#58a6ff55',
            borderColor: '#58a6ff',
            borderWidth: 1
          }]
        },
        options: { responsive: true, plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true, grid: { color: '#21262d' } },
            x: { grid: { display: false } } } }
      })
    }

    if (c.costByModel?.length) {
      new Chart(document.getElementById('costChart'), {
        type: 'doughnut',
        data: {
          labels: c.costByModel.map(x => x.model_used),
          datasets: [{
            data: c.costByModel.map(x => x.total_cost),
            backgroundColor: ['#58a6ff','#3fb950','#d29922','#da3633','#bc8cff','#f0883e'],
          }]
        },
        options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
      })
    }
  } catch(e) {
    document.getElementById('metrics').innerHTML = '<div class="loading">Connection error: ' + e.message + '</div>'
  }
}
loadData()
</script>
</body>
</html>`
}
