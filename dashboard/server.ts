/**
 * MaTrix Mission Control — Dashboard Server
 *
 * Serveur SSE + REST + ACTIONS pour le tableau de bord MaTrix.
 * Proxy panels route through KLC Router at 127.0.0.1:9642.
 *
 * Endpoints:
 *   GET  /api/snapshot       → snapshot JSON complet
 *   GET  /events             → SSE live toutes les 3s
 *   GET  /api/board          → Kanban read
 *   POST /api/board          → Kanban create
 *   POST /api/board/update   → Kanban update
 *   POST /api/board/delete   → Kanban delete
 *   GET  /api/content        → Content docs list
 *   GET  /api/content?path=  → Content doc preview
 *   POST /api/moa            → Proxy MoA vers routeur KLC
 *   POST /api/swarm          → Proxy Swarm vers routeur KLC
 *   POST /api/agent          → Proxy Agent solo vers routeur KLC
 *   GET  /api/runs           → Proxy historique exécutions vers routeur KLC
 *   POST /api/agent/kill     → Tuer une session bloquée
 *   POST /api/agent/dispatch → Dispatcher un agent
 *   POST /api/agent/restart  → Restart OpenCode
 *   POST /api/evolution/run  → Déclencher cycle Architect
 *
 * Usage: bun run server.ts
 * Port: 4321 (défaut) — configurable via MATRIX_DASHBOARD_PORT
 */

import { serve } from "bun";
import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync, statSync, renameSync } from "fs";
import { join, dirname, basename } from "path";
import { homedir, hostname } from "os";
import { Database } from "bun:sqlite";
import { spawn, execSync } from "child_process";

/* ═══════════════════════════════════════════
   CONSTANTES
   ═══════════════════════════════════════════ */

const HOME = homedir();
const DASHBOARD_DIR = import.meta.dir;
const MATRIX_DIR = process.env["MATRIX_STATE_DIR"] ?? join(HOME, ".matrix");
const PORT = parseInt(process.env["MATRIX_DASHBOARD_PORT"] ?? "4321");
const HOST = process.env["MATRIX_DASHBOARD_HOST"] ?? "127.0.0.1";
const OPENCODE_DB = process.env["OPENCODE_DB_PATH"] ?? join(HOME, ".local/share/opencode/opencode.db");
const BOARD_PATH = join(MATRIX_DIR, "board.json");
const CONTENT_DIR = process.env["MATRIX_CONTENT_DIR"] ?? join(HOME, "KLC_Vault");
const ARCHITECT_STATE_PATH = join(DASHBOARD_DIR, "architect_state.json");
const LEARNINGS_PATH = join(MATRIX_DIR, "vault", "learnings.jsonl");
const ERRORS_PATH = join(MATRIX_DIR, "logs", "errors.jsonl");
const COST_PATH = join(MATRIX_DIR, "logs", "cost.jsonl");
const CYCLE_LOG_PATH = join(MATRIX_DIR, "logs", "architect-cycle.log");
const ARCHITECT_CYCLE_SCRIPT = process.env["ARCHITECT_CYCLE_SCRIPT"] ?? join(HOME, ".matrix", "run-architect-cycle.sh");
const ROUTER_URL = process.env["KLC_ROUTER_URL"] ?? "http://127.0.0.1:9642";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html;charset=utf-8",
  ".css": "text/css;charset=utf-8",
  ".js": "application/javascript;charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

/* ═══════════════════════════════════════════
   LISTE DES 16 AGENTS MATRIX
   ═══════════════════════════════════════════ */

const MATRIX_AGENTS = [
  { id: "morpheus", label: "Orchestrateur", color: "#8B5CF6", role: "Chef d'orchestre — délègue et supervise" },
  { id: "neo", label: "Exécuteur", color: "#3B82F6", role: "Code — développe, déploie, build" },
  { id: "tank", label: "Deep Worker", color: "#06B6D4", role: "Tâches complexes longue durée" },
  { id: "oracle", label: "Planificateur", color: "#10B981", role: "Architecture & design technique" },
  { id: "keymaker", label: "Pré-Plan", color: "#84CC16", role: "Analyse briefs & décomposition" },
  { id: "agent-smith", label: "Reviewer", color: "#F59E0B", role: "Code review & qualité" },
  { id: "operator", label: "Kanban", color: "#F97316", role: "Backlog & workflow" },
  { id: "trinity", label: "Design UI", color: "#EC4899", role: "UI/UX & maquettes Open Design" },
  { id: "cypher", label: "SEO/Copy", color: "#A855F7", role: "Contenu & référencement" },
  { id: "sentinel", label: "QA", color: "#EF4444", role: "Tests & monitoring qualité" },
  { id: "ghost", label: "Recherche", color: "#6366F1", role: "Codebase search & grep" },
  { id: "link", label: "Recherche Ext", color: "#14B8A6", role: "Web & documentation" },
  { id: "analyst", label: "Média", color: "#D946EF", role: "Analyse images & PDF" },
  { id: "mouse", label: "Docs", color: "#FBBF24", role: "Documentation technique" },
  { id: "dreamer", label: "Mémoire", color: "#7C3AED", role: "Mémoire persistante & état" },
  { id: "architect", label: "Évolution", color: "#059669", role: "Auto-amélioration & upstream" },
];

/* ═══════════════════════════════════════════
   UTILITIES
   ═══════════════════════════════════════════ */

function writeFileAtomically(filePath: string, content: string): void {
  const tempPath = filePath + ".tmp";
  writeFileSync(tempPath, content, "utf-8");
  renameSync(tempPath, filePath);
}

/* ═══════════════════════════════════════════
   COLLECTE DE DONNÉES
   ═══════════════════════════════════════════ */

function vpsHealth() {
  const health: Record<string, any> = { cpu: 0, ram: { used: 0, total: 0, pct: 0 }, disk: { used: 0, total: 0, pct: 0 }, uptime: 0, hostname: hostname() };
  try {
    const parts = readFileSync("/proc/stat", "utf-8").split("\n")[0].split(/\s+/).slice(1).map(Number);
    const idle = parts[3] || 0;
    const total = parts.reduce((a: number, b: number) => a + b, 0);
    health.cpu = Math.round((1 - idle / total) * 100);
    health.uptime = Math.floor(parseFloat(readFileSync("/proc/uptime", "utf-8").split(" ")[0]));
  } catch {}
  try {
    const meminfo = readFileSync("/proc/meminfo", "utf-8");
    const total = parseInt(meminfo.match(/MemTotal:\s+(\d+)/)?.[1] || "0");
    const avail = parseInt(meminfo.match(/MemAvailable:\s+(\d+)/)?.[1] || "0");
    health.ram = { total: Math.round(total / 1024), used: Math.round((total - avail) / 1024), pct: Math.round((1 - avail / total) * 100) };
  } catch {}
  try {
    const proc = Bun.spawnSync(["df", "-B1", "/"]);
    const line = proc.stdout.toString().split("\n")[1];
    if (line) {
      const parts = line.split(/\s+/);
      health.disk = {
        total: Math.round(parseInt(parts[1]) / 1073741824),
        used: Math.round(parseInt(parts[2]) / 1073741824),
        pct: Math.round((parseInt(parts[2]) / parseInt(parts[1])) * 100),
      };
    }
  } catch {}
  return health;
}

function opencodeSessions(): { recent: any[], stats: any, active: any[], errors: any[] } {
  const result = { recent: [], stats: { total_sessions: 0, total_messages: 0, total_tokens: 0 }, active: [], errors: [] };
  try {
    if (!existsSync(OPENCODE_DB)) return result;
    const db = new Database(OPENCODE_DB, { readonly: true });

    const recent = db.query(`
      SELECT id, title, agent, model, time_created, time_updated,
             tokens_input, tokens_output, summary_files, summary_additions, summary_deletions
      FROM session
      WHERE agent IS NOT NULL
      ORDER BY time_updated DESC LIMIT 50
    `).all() as any[];

    const stats = db.query(`
      SELECT COUNT(*) as total_sessions,
             COALESCE(SUM(tokens_input + tokens_output),0) as total_tokens,
             COUNT(DISTINCT agent) as total_agents
      FROM session WHERE time_created > (unixepoch()*1000 - 86400000)
    `).get() as any;

    const active = db.query(`
      SELECT id, agent, title, time_created, time_updated,
             (time_updated - time_created)/60000.0 as duration_min,
             (unixepoch()*1000 - time_updated)/60000.0 as idle_min
      FROM session
      WHERE time_updated > (unixepoch()*1000 - 1800000)
      ORDER BY time_updated DESC
    `).all() as any[];

    const errors = db.query(`
      SELECT s.id, s.agent, s.title, s.time_created
      FROM session s
      WHERE s.id IN (
        SELECT DISTINCT e.aggregate_id FROM event e
        WHERE (e.type LIKE '%fail%' OR e.type LIKE '%reject%' OR e.data LIKE '%\"status\":\"error\"%' OR e.data LIKE '%\"level\":\"error\"%')
        ORDER BY e.rowid DESC LIMIT 10
      )
      ORDER BY s.time_updated DESC LIMIT 5
    `).all() as any[];

    db.close();
    return {
      recent: recent.map(r => ({
        ...r,
        time_created: new Date(r.time_created / 1000).toISOString(),
        time_updated: new Date(r.time_updated / 1000).toISOString(),
      })),
      stats: stats || { total_sessions: 0, total_tokens: 0, total_agents: 0 },
      active: active.map(r => ({
        ...r,
        time_created: new Date(r.time_created / 1000).toISOString(),
        time_updated: new Date(r.time_updated / 1000).toISOString(),
      })),
      errors,
    };
  } catch (e: any) {
    console.error("OpenCode DB error:", e.message);
    return result;
  }
}

function agentActivity(sessions: any[]): Record<string, any> {
  const stats: Record<string, any> = {};
  for (const agent of MATRIX_AGENTS) {
    stats[agent.id] = { total: 0, lastSeen: null, lastTask: "", sessions: [], status: "idle", duration_min: 0, idle_min: 0 };
  }
  for (const s of sessions) {
    const name = s.agent?.toLowerCase().replace(" - ultraworker", "").replace(" - moa", "") || "unknown";
    const baseName = name.includes("-") ? name.split("-")[0] : name;
    if (!stats[baseName]) {
      stats[baseName] = { total: 0, lastSeen: null, lastTask: "", sessions: [], status: "idle", duration_min: 0, idle_min: 0 };
    }
    stats[baseName].total++;
    stats[baseName].lastSeen = s.time_updated;
    stats[baseName].lastTask = s.title || "";
    stats[baseName].sessions.push(s.id);
    stats[baseName].duration_min = Math.max(stats[baseName].duration_min, s.duration_min || 0);
    stats[baseName].idle_min = Math.max(stats[baseName].idle_min, s.idle_min || 0);
  }
  const now = Date.now();
  for (const [id, info] of Object.entries(stats) as [string, any][]) {
    if (info.lastSeen) {
      const lastMs = new Date(info.lastSeen).getTime();
      const agoMin = (now - lastMs) / 60000;
      if (agoMin < 2) info.status = "active";
      else if (agoMin < 15) info.status = "recent";
      else info.status = "idle";
    }
  }
  return stats;
}

function boardData() {
  try {
    if (existsSync(BOARD_PATH)) return JSON.parse(readFileSync(BOARD_PATH, "utf-8"));
  } catch {}
  return [];
}

function contentDocs(dir = CONTENT_DIR, maxDepth = 3): any[] {
  const docs: any[] = [];
  try {
    if (!existsSync(dir)) return [];
    function walk(d: string, depth: number) {
      if (depth > maxDepth) return;
      for (const entry of readdirSync(d)) {
        if (entry.startsWith(".") || entry === "keys") continue;
        const full = join(d, entry);
        try {
          const st = statSync(full);
          if (st.isDirectory()) { if (depth < maxDepth) walk(full, depth + 1); }
          else if (entry.endsWith(".md")) {
            const content = readFileSync(full, "utf-8");
            const title = content.match(/^#\s+(.+)/m)?.[1] || entry.replace(".md", "");
            const rel = full.replace(CONTENT_DIR, "").replace(/^\//, "");
            const agent = rel.split("/").slice(0, -1).join("/") || "vault";
            docs.push({ agent, filename: entry, title, modified: st.mtime.toISOString(), path: full });
          }
        } catch {}
      }
    }
    walk(dir, 0);
  } catch {}
  return docs;
}

function architectData() {
  try {
    if (existsSync(ARCHITECT_STATE_PATH)) return JSON.parse(readFileSync(ARCHITECT_STATE_PATH, "utf-8"));
  } catch {}
  return { lastScan: null, errorsDetected: 0, pendingProposals: 0, upstreamStatus: "idle", upstreamDiff: 0, status: "active", cycle: 0 };
}

function readJsonl(path: string): any[] {
  try {
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf-8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

function cronArchitectActive(): boolean {
  try {
    const out = execSync("crontab -l 2>/dev/null", { timeout: 3000 }).toString();
    return out.includes("run-architect-cycle.sh");
  } catch { return false; }
}

function lastCycleDone(): string | null {
  try {
    if (!existsSync(CYCLE_LOG_PATH)) return null;
    const lines = readFileSync(CYCLE_LOG_PATH, "utf-8").split("\n").reverse();
    for (const line of lines) {
      const m = line.match(/cycle done (\S+)/);
      if (m) return m[1];
    }
  } catch {}
  return null;
}

function evolutionData() {
  const learnings = readJsonl(LEARNINGS_PATH);
  const errors = readJsonl(ERRORS_PATH);
  const costs = readJsonl(COST_PATH);
  const arch = architectData();

  const recentErrors = errors.slice(-12).reverse().map((e: any) => ({
    agent: e.agent || "unknown",
    errorType: e.errorType || "error",
    message: (e.message || "").slice(0, 140),
    timestamp: e.timestamp || null,
  }));

  const highCost = costs
    .filter((c: any) => typeof c.total_cost === "number")
    .sort((a: any, b: any) => b.total_cost - a.total_cost)
    .slice(0, 5)
    .map((c: any) => ({
      agent: c.agent || "unknown",
      model: c.model || "?",
      total_cost: c.total_cost,
      timestamp: c.timestamp || null,
    }));

  return {
    l1: { active: true, label: "Capture live des erreurs (hook error-signal-logger)" },
    l2: { active: true, label: "Règles injectées aux agents (.omo/rules/matrix-learnings.md)" },
    learningsCount: learnings.length,
    learnings: learnings.slice(-15).reverse().map((l: any) => ({
      target: l.target || "unknown",
      rule: l.rule || "",
      occurrences: l.occurrences || 0,
      confidence: l.confidence || 0,
      created_at: l.created_at || null,
    })),
    errorsCount: errors.length,
    recentErrors,
    highCostCount: costs.length,
    highCost,
    cronActive: cronArchitectActive(),
    lastCycle: lastCycleDone() || arch.lastScan || null,
    cycle: arch.cycle || 0,
  };
}

function snapshot() {
  const vps = vpsHealth();
  const sessions = opencodeSessions();
  const agentStats = agentActivity(sessions.active);
  const board = boardData();
  const content = contentDocs();
  const arch = architectData();

  const activity = (sessions.active || []).map((s: any) => ({
    agent: s.agent?.replace(" - ultraworker", "").replace(" - moa", "") || "unknown",
    task: s.title || "",
    status: s.idle_min > 15 ? "idle" : "running",
    created_at: s.time_created,
    duration: s.duration_min,
    session_id: s.id,
  })).concat(
    (sessions.recent || []).slice(0, 5).map((s: any) => ({
      agent: s.agent?.replace(" - ultraworker", "") || "unknown",
      task: s.title || "",
      status: "completed",
      created_at: s.time_updated,
      duration: (s.time_updated - s.time_created)/60000,
      session_id: s.id,
    }))
  );

  return {
    vps,
    sessions: {
      recent: sessions.recent,
      stats: sessions.stats,
      active: sessions.active,
      errors: sessions.errors,
    },
    agentStats,
    activity: activity.slice(0, 20),
    board,
    content,
    architect: arch,
    evolution: evolutionData(),
    agents: MATRIX_AGENTS,
    timestamp: new Date().toISOString(),
  };
}

/* ════════════════════════════════════════════
   ACTIONS DE CONTRÔLE
   ════════════════════════════════════════════ */

function actionKillSession(sessionId: string): { success: boolean; message: string } {
  try {
    execSync(`tmux kill-session -t "opencode-${sessionId}" 2>/dev/null`, { timeout: 5000 });
    execSync(`curl -s -X POST http://localhost:9642/session/${sessionId}/kill 2>/dev/null`, { timeout: 3000 });
    return { success: true, message: `Session ${sessionId.slice(0, 12)}... tuée` };
  } catch (e: any) {
    return { success: false, message: `Impossible de tuer la session: ${e.message}` };
  }
}

function actionDispatchAgent(agentId: string, task: string): { success: boolean; message: string } {
  try {
    const board = boardData();
    const newTask = {
      id: crypto.randomUUID(),
      title: task,
      agent: agentId,
      status: "ready",
      priority: "high",
      source: "mission-control",
      created_at: new Date().toISOString(),
    };
    board.push(newTask);
    writeFileAtomically(BOARD_PATH, JSON.stringify(board, null, 2));
    return { success: true, message: `Tâche dispatchée à ${agentId}: "${task.slice(0, 50)}"` };
  } catch (e: any) {
    return { success: false, message: `Erreur dispatch: ${e.message}` };
  }
}

function actionRestartOpenCode(): { success: boolean; message: string } {
  try {
    execSync("pkill -f opencode 2>/dev/null; sleep 1; bunx opencode agent --daemon 2>/dev/null &", { timeout: 5000 });
    return { success: true, message: "Redémarrage OpenCode initié" };
  } catch (e: any) {
    return { success: false, message: `Erreur restart: ${e.message}` };
  }
}

function actionRunCycle(): { success: boolean; message: string } {
  try {
    if (existsSync(ARCHITECT_CYCLE_SCRIPT)) {
      spawn("bash", [ARCHITECT_CYCLE_SCRIPT], { detached: true, stdio: "ignore" });
      return { success: true, message: "Cycle Architect déclenché" };
    }
    return { success: false, message: "Script de cycle Architect non trouvé" };
  } catch (e: any) {
    return { success: false, message: `Erreur cycle: ${e.message}` };
  }
}

/* ════════════════════════════════════════════
   SERVEUR HTTP + SSE
   ════════════════════════════════════════════ */

const sseClients: Set<ReadableStreamController<any>> = new Set();

function broadcastSSE(data: any) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.enqueue(new TextEncoder().encode(msg)); } catch { sseClients.delete(client); }
  }
}

setInterval(() => {
  const snap = snapshot();
  broadcastSSE(snap);
}, 3000);

const server = serve({
  port: PORT,
  hostname: HOST,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    const headers: Record<string, string> = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Credentials": "true",
    };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });

    // ── SSE endpoint ──
    if (path === "/events") {
      const stream = new ReadableStream({
        start(controller) {
          sseClients.add(controller);
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(snapshot())}\n\n`));
          req.signal.addEventListener("abort", () => sseClients.delete(controller));
        },
        cancel() {},
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          ...headers,
        },
      });
    }

    // ── API Snapshot ──
    if (path === "/api/snapshot") {
      return new Response(JSON.stringify(snapshot()), {
        headers: { "Content-Type": "application/json", ...headers },
      });
    }

    // ── API Content ──
    if (path === "/api/content") {
      const filePath = url.searchParams.get("path");
      if (filePath && existsSync(filePath)) {
        const content = readFileSync(filePath, "utf-8");
        const html = `<pre style="font-family:var(--font-mono);font-size:var(--font-size-sm);line-height:1.6;white-space:pre-wrap;color:#E2E8F0;">${content.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`;
        return new Response(html, { headers: { "Content-Type": "text/html;charset=utf-8", ...headers } });
      }
      return new Response(JSON.stringify(contentDocs()), {
        headers: { "Content-Type": "application/json", ...headers },
      });
    }

    // ── API Kanban CRUD ──
    if (path === "/api/board" && req.method === "GET") {
      return new Response(JSON.stringify(boardData()), {
        headers: { "Content-Type": "application/json", ...headers },
      });
    }
    if (path === "/api/board" && req.method === "POST") {
      try {
        const body = JSON.parse(await req.text());
        const board = boardData();
        const task = {
          id: crypto.randomUUID(),
          title: body.title,
          status: "pending",
          priority: body.priority || "medium",
          agent: body.agent || "",
          notes: body.notes || "",
          created_at: new Date().toISOString(),
        };
        board.push(task);
        writeFileAtomically(BOARD_PATH, JSON.stringify(board, null, 2));
        return new Response(JSON.stringify(task), { status: 201, headers: { "Content-Type": "application/json", ...headers } });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers });
      }
    }
    if (path.startsWith("/api/board/update") && req.method === "POST") {
      try {
        const id = url.searchParams.get("id");
        if (!id) return new Response(JSON.stringify({ error: "Missing id" }), { status: 400, headers });
        const body = JSON.parse(await req.text());
        const board = boardData();
        const idx = board.findIndex((t: any) => t.id === id);
        if (idx === -1) return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers });
        board[idx] = { ...board[idx], ...body, updated_at: new Date().toISOString() };
        writeFileAtomically(BOARD_PATH, JSON.stringify(board, null, 2));
        return new Response(JSON.stringify(board[idx]), { headers });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers });
      }
    }
    if (path === "/api/board/delete" && req.method === "POST") {
      try {
        const id = url.searchParams.get("id");
        if (!id) return new Response(JSON.stringify({ error: "Missing id" }), { status: 400, headers });
        const board = (boardData() as any[]).filter((t: any) => t.id !== id);
        writeFileAtomically(BOARD_PATH, JSON.stringify(board, null, 2));
        return new Response(JSON.stringify({ success: true }), { headers });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers });
      }
    }

    // ── ACTIONS DE CONTRÔLE ──
    if (path === "/api/agent/kill" && req.method === "POST") {
      const id = url.searchParams.get("id");
      if (!id) return new Response(JSON.stringify({ error: "Missing session id" }), { status: 400, headers });
      return new Response(JSON.stringify(actionKillSession(id)), { headers });
    }

    if (path === "/api/agent/dispatch" && req.method === "POST") {
      try {
        const body = JSON.parse(await req.text());
        if (!body.agent || !body.task) return new Response(JSON.stringify({ error: "Missing agent or task" }), { status: 400, headers });
        return new Response(JSON.stringify(actionDispatchAgent(body.agent, body.task)), { headers });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), { status: 400, headers });
      }
    }

    if (path === "/api/agent/restart" && req.method === "POST") {
      return new Response(JSON.stringify(actionRestartOpenCode()), { headers });
    }

    if (path === "/api/evolution/run" && req.method === "POST") {
      return new Response(JSON.stringify(actionRunCycle()), { headers });
    }

    // ── KLC Router Proxies ──
    // POST /api/moa → KLC Router /v1/moa (Mixture of Agents)
    if (path === "/api/moa" && req.method === "POST") {
      try {
        const body = await req.text();
        const resp = await fetch(ROUTER_URL + "/v1/moa", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
        if (resp.headers.get("content-type")?.includes("text/event-stream")) {
          return new Response(resp.body, {
            status: resp.status,
            headers: {
              "Content-Type": "text/event-stream",
              "cache-control": "no-cache",
              "x-klc-moa-synthesizer": resp.headers.get("x-klc-moa-synthesizer") ?? "",
              ...headers,
            },
          });
        }
        const text = await resp.text();
        return new Response(text, {
          status: resp.status,
          headers: {
            "Content-Type": "application/json",
            "x-klc-moa-candidates": resp.headers.get("x-klc-moa-candidates") ?? "",
            "x-klc-moa-failed": resp.headers.get("x-klc-moa-failed") ?? "",
            "x-klc-moa-synthesizer": resp.headers.get("x-klc-moa-synthesizer") ?? "",
            ...headers,
          },
        });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: `MoA router unreachable: ${e.message}` }), {
          status: 502,
          headers,
        });
      }
    }

    // POST /api/swarm → KLC Router /v1/swarm (Agent Swarm)
    if (path === "/api/swarm" && req.method === "POST") {
      try {
        const body = await req.text();
        const resp = await fetch(ROUTER_URL + "/v1/swarm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
        if (resp.headers.get("content-type")?.includes("text/event-stream")) {
          return new Response(resp.body, {
            status: resp.status,
            headers: {
              "Content-Type": "text/event-stream",
              "cache-control": "no-cache",
              "x-klc-orchestrator": resp.headers.get("x-klc-orchestrator") ?? "",
              "x-klc-auto-selected": resp.headers.get("x-klc-auto-selected") ?? "",
              "x-klc-selected-agents": resp.headers.get("x-klc-selected-agents") ?? "",
              "x-klc-swarm-agents": resp.headers.get("x-klc-swarm-agents") ?? "",
              "x-klc-swarm-failed": resp.headers.get("x-klc-swarm-failed") ?? "",
              "x-klc-moa-synthesizer": resp.headers.get("x-klc-moa-synthesizer") ?? "",
              ...headers,
            },
          });
        }
        const text = await resp.text();
        return new Response(text, {
          status: resp.status,
          headers: {
            "Content-Type": "application/json",
            "x-klc-swarm-agents": resp.headers.get("x-klc-swarm-agents") ?? "",
            "x-klc-swarm-failed": resp.headers.get("x-klc-swarm-failed") ?? "",
            "x-klc-moa-synthesizer": resp.headers.get("x-klc-moa-synthesizer") ?? "",
            ...headers,
          },
        });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: `Swarm router unreachable: ${e.message}` }), {
          status: 502,
          headers,
        });
      }
    }

    // POST /api/agent → KLC Router /v1/agent (Agent solo + outils)
    if (path === "/api/agent" && req.method === "POST") {
      try {
        const body = await req.text();
        const resp = await fetch(ROUTER_URL + "/v1/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
        if (resp.headers.get("content-type")?.includes("text/event-stream")) {
          return new Response(resp.body, {
            status: resp.status,
            headers: {
              "Content-Type": "text/event-stream",
              "cache-control": "no-cache",
              "x-klc-tools-used": resp.headers.get("x-klc-tools-used") ?? "",
              ...headers,
            },
          });
        }
        const text = await resp.text();
        return new Response(text, {
          status: resp.status,
          headers: {
            "Content-Type": "application/json",
            "x-klc-tools-used": resp.headers.get("x-klc-tools-used") ?? "",
            ...headers,
          },
        });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: `Agent router unreachable: ${e.message}` }), {
          status: 502,
          headers,
        });
      }
    }

    // GET /api/runs → KLC Router /v1/runs (Run history)
    if (path === "/api/runs" && req.method === "GET") {
      try {
        const resp = await fetch(ROUTER_URL + "/v1/runs", { method: "GET" });
        const text = await resp.text();
        return new Response(text, {
          status: resp.status,
          headers: { "Content-Type": "application/json", ...headers },
        });
      } catch (e: any) {
        return new Response(JSON.stringify({ error: `Runs router unreachable: ${e.message}` }), {
          status: 502,
          headers,
        });
      }
    }

    // ── Fichiers statiques ──
    let filePath = path === "/" ? "/index.html" : path;
    const fullPath = join(DASHBOARD_DIR, filePath);
    try {
      if (existsSync(fullPath) && statSync(fullPath).isFile()) {
        const ext = filePath.substring(filePath.lastIndexOf("."));
        const mime = MIME_TYPES[ext] || "application/octet-stream";
        return new Response(readFileSync(fullPath), {
          headers: { "Content-Type": mime, ...headers },
        });
      }
    } catch {}

    return new Response("Not Found", { status: 404, headers });
  },
});

console.log(`\n  🧠 MaTrix Mission Control`);
console.log(`  ┌────────────────────────────────────────────┐`);
console.log(`  │  Dashboard : http://${HOST}:${PORT}      │`);
console.log(`  │  API       : http://${HOST}:${PORT}/api/snapshot  │`);
console.log(`  │  SSE       : http://${HOST}:${PORT}/events  │`);
console.log(`  │  Kanban    : http://${HOST}:${PORT}/api/board  │`);
console.log(`  │  Control   : POST /api/agent/{kill,dispatch,restart}  │`);
console.log(`  │  KLC Router: ${ROUTER_URL}  │`);
console.log(`  │  MoA       : POST /api/moa  │`);
console.log(`  │  Swarm     : POST /api/swarm  │`);
console.log(`  │  Agent     : POST /api/agent  │`);
console.log(`  │  Runs      : GET  /api/runs  │`);
console.log(`  └────────────────────────────────────────────┘`);
console.log(`\n  📡 Broadcast toutes les 3s — Contrôle en direct\n`);
