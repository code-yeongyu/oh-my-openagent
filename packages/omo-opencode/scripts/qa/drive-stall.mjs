// End-to-end stall evidence harness v3 (hardened).
// Real opencode + source-loaded plugin (with the stall detection under test) +
// mock interrupted-stream provider. Proves the 30s early exit for the actual
// idle-`unknown` state in both outcomes:
//   DELIVERABLE -> current-turn deliverable handback
//   EMPTY       -> no-deliverable abort with the stall error
//
// Usage:
//   node drive-stall.mjs DELIVERABLE|EMPTY [worktree]
//   OMO_WORKTREE=... node drive-stall.mjs DELIVERABLE   (worktree via env)
//   MOCK_PORT=8790 opencode on PATH (opencode-ai@1.18.15 recommended) required.
//
// Exit code: 0 only when the mode-specific outcome (deliverable handback or
// stall error) is observed within the deadline; 1 on mismatch, timeout, or
// harness failure.
import { spawn } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, openSync, readFileSync, rmSync, existsSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const MODE = (process.argv[2] ?? "DELIVERABLE").toUpperCase()
if (MODE !== "DELIVERABLE" && MODE !== "EMPTY") {
  console.error(`[e2e] invalid mode ${MODE}; use DELIVERABLE or EMPTY`)
  process.exit(1)
}
// Resolve any relative worktree (argv/env) against cwd before building the
// file:// plugin URI below.
const WORKTREE = resolve(process.argv[3] ?? process.env.OMO_WORKTREE ?? resolve("."))
// POSIX/macOS: rely on the PATH-installed `opencode`; Windows: fall back to the
// npm-global path used by the workflow that produced the evidence.
const OC_EXE =
  process.env.OPENCODE_EXE ??
  (process.platform === "win32"
    ? (process.env.APPDATA + "/npm/node_modules/opencode-ai/bin/opencode.exe")
    : "opencode")
const MOCK_PORT = Number(process.env.MOCK_PORT ?? 8790)
const SERVER_PORT = 8797
const PASSWORD = "stall-evidence-pw"
const DEADLINE_MS = 400_000

if (process.platform === "win32" && !existsSync(OC_EXE)) {
  console.error(`[e2e:${MODE}] opencode binary not found at ${OC_EXE} (set OPENCODE_EXE or install opencode-ai@1.18.15)`)
  process.exit(1)
}

// sanity: the source plugin must exist at the worktree path we claim to load.
if (!existsSync(join(WORKTREE, "packages", "omo-opencode", "src", "index.ts"))) {
  console.error(`[e2e:${MODE}] plugin source not found at ${WORKTREE}/packages/omo-opencode/src/index.ts (set OMO_WORKTREE)`)
  process.exit(1)
}

const sandbox = mkdtempSync(join(tmpdir(), `pr6666-e2e-${MODE}-`))
for (const d of ["data", "config", "cache", "state", "home", "proj"]) mkdirSync(join(sandbox, d))

const config = {
  plugin: [`file://${WORKTREE}/packages/omo-opencode/src/index.ts`],
  model: "opencode-go/deepseek-v4-flash",
  provider: {
    // Provider ids matching the local user's ~/.omo/omo.jsonc agent overrides
    // (opencode-go / mzy), all pointed at the mock so every resolution lands on
    // the interrupted-stream server regardless of the machine's config.
    "opencode-go": {
      npm: "@ai-sdk/openai-compatible",
      name: "Mock Stall Probe (opencode-go)",
      options: { baseURL: `http://127.0.0.1:${MOCK_PORT}/v1`, apiKey: "mock-key" },
      models: {
        "deepseek-v4-flash": { name: "Mock DsFlash", limit: { context: 32000, output: 8000 }, tool_call: true, reasoning: true },
        "claude-opus-5": { name: "Mock Opus", limit: { context: 32000, output: 8000 }, tool_call: true, reasoning: true },
      },
    },
    mzy: {
      npm: "@ai-sdk/openai-compatible",
      name: "Mock Stall Probe (mzy)",
      options: { baseURL: `http://127.0.0.1:${MOCK_PORT}/v1`, apiKey: "mock-key" },
      models: {
        "gpt-5.6-sol": { name: "Mock Sol", limit: { context: 32000, output: 8000 }, tool_call: true },
        "gpt-5.6-terra": { name: "Mock Terra", limit: { context: 32000, output: 8000 }, tool_call: true },
      },
    },
    opencode: {
      npm: "@ai-sdk/openai-compatible",
      name: "Mock Stall Probe (opencode)",
      options: { baseURL: `http://127.0.0.1:${MOCK_PORT}/v1`, apiKey: "mock-key" },
      models: {
        "claude-opus-5": { name: "Mock Opus", limit: { context: 32000, output: 8000 }, tool_call: true, reasoning: true },
      },
    },
  },
}

// Route every OMO agent/category at the mock model BEFORE the server starts.
{
  const mockModel = "opencode/claude-opus-5"
  const agents = {}
  for (const a of ["sisyphus", "sisyphus-junior", "explore", "librarian", "oracle", "build", "plan", "atlas", "hephaestus", "metis", "momus", "quick", "deep", "ultrabrain", "writing", "artistry", "unspecified-low", "unspecified-high"]) {
    agents[a] = { model: mockModel }
  }
  const categories = {}
  for (const c of ["quick", "deep", "ultrabrain", "writing", "artistry", "explore", "librarian", "oracle", "general"]) {
    categories[c] = { model: mockModel }
  }
  const cfg = JSON.stringify({ agents, categories }, null, 2)
  mkdirSync(join(sandbox, "home", ".omo"), { recursive: true })
  writeFileSync(join(sandbox, "home", ".omo", "omo.jsonc"), cfg)
  mkdirSync(join(sandbox, "proj", ".omo"), { recursive: true })
  writeFileSync(join(sandbox, "proj", ".omo", "omo.jsonc"), cfg)
}

const logPath = join(sandbox, "serve.log")
const logFd = openSync(logPath, "a")

const childEnv = {
  ...process.env,
  HOME: join(sandbox, "home"),
  USERPROFILE: join(sandbox, "home"),
  XDG_DATA_HOME: join(sandbox, "data"),
  XDG_CONFIG_HOME: join(sandbox, "config"),
  XDG_CACHE_HOME: join(sandbox, "cache"),
  XDG_STATE_HOME: join(sandbox, "state"),
  OPENCODE_DISABLE_AUTOUPDATE: "1",
  OPENCODE_DISABLE_MODELS_FETCH: "1",
  OPENCODE_SERVER_PASSWORD: PASSWORD,
  OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
}

let child = null
let exitCode = 1

// Host-session-count guard: run opencode WITHOUT the sandbox env and count the
// real user's sessions before/after, so the evidence proves the run did not
// write to the user's database. The child (serve) never touches it; this is a
// belt-and-braces assertion on top of the writer isolation in childEnv.
async function hostSessionCount() {
  try {
    const r = await new Promise((resolveP, rejectP) => {
      const p = spawn(OC_EXE, ["db", "SELECT COUNT(*) FROM session", "--format", "json"], {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "ignore"],
      })
      let out = ""
      p.stdout.on("data", (d) => { out += String(d) })
      p.on("exit", (code) => (code === 0 ? resolveP(out) : rejectP(new Error(`opencode db exited ${code}`))))
      p.on("error", rejectP)
    })
    const m = r.match(/\d+/)
    return m ? Number(m[0]) : null
  } catch {
    return null // host query unavailable -> skip the numeric guard, still isolated by childEnv
  }
}
const hostCountBefore = await hostSessionCount()
console.log(`[e2e:${MODE}] host-session-count-before=${hostCountBefore ?? "n/a"}`)

try {
  child = spawn(OC_EXE, ["serve", "--port", String(SERVER_PORT), "--hostname", "127.0.0.1", "--print-logs"], {
    cwd: join(sandbox, "proj"),
    env: childEnv,
    stdio: ["ignore", logFd, logFd],
  })
  console.log(`[e2e:${MODE}] opencode pid ${child.pid}, sandbox ${sandbox}, worktree ${WORKTREE}`)

  const sleep = (ms) => new Promise(r => setTimeout(r, ms))

  // Wait for listening.
  let up = false
  for (let i = 0; i < 40; i++) {
    await sleep(500)
    try { await fetch(`http://127.0.0.1:${SERVER_PORT}/doc`); up = true; break } catch { /* retry */ }
    if (existsSync(logPath) && readFileSync(logPath, "utf8").includes("listening")) { up = true; break }
  }
  if (!up) {
    console.log(`[e2e:${MODE}] server failed to start`);
    if (existsSync(logPath)) console.log(readFileSync(logPath, "utf8").slice(-2000))
    throw new Error("server did not start")
  }
  await sleep(3000) // let the plugin finish loading

  // Isolation assertion: the server MUST have written its database inside the
  // sandbox (a real-XDG leak would break the "isolated" claim of the evidence).
  await sleep(500)
  const dbCandidates = [
    join(sandbox, "data", "opencode", "opencode.db"),
    join(sandbox, "data", "opencode", "node.db"),
    join(sandbox, "state", "opencode", "opencode.db"),
  ]
  const dbInsideSandbox = dbCandidates.some((p) => existsSync(p))
  console.log(`[e2e:${MODE}] db-inside-sandbox=${dbInsideSandbox} (${dbCandidates.find((p) => existsSync(p)) ?? "none"})`)
  if (!dbInsideSandbox) {
    throw new Error(`isolation assertion failed: no opencode db inside ${sandbox}`)
  }

  const auth = "Basic " + Buffer.from(`opencode:${PASSWORD}`).toString("base64")
  const H = { "Content-Type": "application/json", Authorization: auth }
  const base = `http://127.0.0.1:${SERVER_PORT}`

  async function getJSON(url) {
    const r = await fetch(url, { headers: { Authorization: auth } })
    return r.json()
  }

  // The HTTP API can accept /doc before the app is fully bootstrapped (plugin
  // load, skills index). Retry session creation briefly so a slow first boot
  // does not fail the run.
  let createRes
  let sid
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      createRes = await fetch(`${base}/session`, { method: "POST", headers: H, body: JSON.stringify({ title: `stall-e2e-${MODE}` }) })
      const createdJson = await createRes.json()
      sid = createdJson?.id
      if (sid) break
    } catch { /* not ready yet */ }
    await sleep(2000)
  }
  if (!sid) {
    throw new Error(`session creation failed after retries (last status ${createRes?.status ?? "n/a"})`)
  }
  console.log(`[e2e:${MODE}] parent session ${sid}`)

  const promptT0 = Date.now()
  const prRes = await fetch(`${base}/session/${sid}/prompt_async`, {
    method: "POST", headers: H,
    body: JSON.stringify({
      model: { providerID: "opencode-go", modelID: "deepseek-v4-flash" },
      parts: [{ type: "text", text: MODE === "EMPTY" ? "PARENTDELEGATE EMPTYMODE please delegate the probe now" : "PARENTDELEGATE DELIVERMODE please delegate the probe now" }],
    }),
  })
  console.log(`[e2e:${MODE}] prompt(async) status ${prRes.status}`)

  let taskDone = false
  let taskOutput = ""
  let taskError = ""
  const statusLog = []
  const deadline = Date.now() + DEADLINE_MS
  while (Date.now() < deadline) {
    await sleep(1000)
    const elapsed = Math.round((Date.now() - promptT0) / 1000)
    try {
      const st = await getJSON(`${base}/session/status`)
      const summary = Object.entries(st ?? {}).map(([k, v]) => `${k.slice(0, 12)}=${v?.type}`).join(" ")
      if (statusLog[statusLog.length - 1] !== summary) statusLog.push(summary)
      const msgs = await getJSON(`${base}/session/${sid}/message?limit=100`)
      const arr = Array.isArray(msgs) ? msgs : (msgs?.data ?? [])
      for (const m of arr) {
        for (const p of m?.parts ?? []) {
          if (p?.type === "tool" && p?.tool === "task") {
            const status = p?.state?.status
            if (status === "completed" || status === "error") {
              if (!taskDone) {
                taskDone = true
                taskOutput = String(p.state?.output ?? "")
                taskError = String(p.state?.error ?? "")
                console.log(`[e2e:${MODE}] t+${elapsed}s TASK tool reached status=${status}`)
              }
            }
          }
        }
      }
      if (taskDone) break
    } catch (e) {
      console.log(`[e2e:${MODE}] t+${elapsed}s poll err: ${String(e).slice(0, 120)}`)
    }
  }

  const totalSecs = Math.round((Date.now() - promptT0) / 1000)
  console.log(`\n[e2e:${MODE}] status-map timeline:`)
  statusLog.forEach((s, i) => console.log(`  [${i}] ${s}`))

  if (taskDone) {
    console.log(`\n[e2e:${MODE}] === TASK TOOL OUTPUT (t+${totalSecs}s) ===`)
    if (taskError) console.log(`[e2e:${MODE}] task error: ${taskError.slice(0, 300)}`)
    console.log(taskOutput.slice(0, 900))
    console.log(`\n[e2e:${MODE}] VERDICT: task tool returned at ~${totalSecs}s`)
  } else {
    console.log(`\n[e2e:${MODE}] TASK TOOL DID NOT FINISH within ${Math.round(DEADLINE_MS / 1000)}s`)
  }

  // Dump the parent transcript for the record.
  {
    const msgs = await getJSON(`${base}/session/${sid}/message?limit=100`)
    const arr = Array.isArray(msgs) ? msgs : (msgs?.data ?? [])
    console.log(`\n[e2e:${MODE}] --- PARENT TRANSCRIPT (${arr.length}) ---`)
    for (const m of arr) {
      const info = m?.info ?? {}
      console.log(`[e2e:${MODE}] ${info.role} finish=${JSON.stringify(info.finish)}`)
      for (const p of m?.parts ?? []) {
        const d = { type: p.type }
        if (p.text) d.text = String(p.text).slice(0, 100)
        if (p.tool) d.tool = p.tool
        if (p.state) { d.status = p.state.status; d.output = String(p.state.output ?? "").slice(0, 220) }
        console.log(`[e2e:${MODE}]   part`, JSON.stringify(d).slice(0, 400))
      }
    }
  }

  // Relevant server log lines for the record.
  if (existsSync(logPath)) {
    const log = readFileSync(logPath, "utf8")
    const stallLines = log.split("\n").filter((l) => /stall|Stall|task\]|delegate|sync/i.test(l)).slice(-40)
    console.log(`\n[e2e:${MODE}] --- relevant log lines ---`)
    for (const l of stallLines) console.log("[log]", l.slice(0, 220))
  }

  // Mode-specific success validation -> exit code.
  if (!taskDone) {
    console.error(`[e2e:${MODE}] FAIL: task tool did not complete within the deadline`)
    exitCode = 1
  } else if (taskError) {
    console.error(`[e2e:${MODE}] FAIL: task tool reported an error: ${taskError.slice(0, 200)}`)
    exitCode = 1
  } else if (MODE === "DELIVERABLE") {
    const ok = taskOutput.includes("Task completed") && taskOutput.includes("child deliverable")
    console.log(`[e2e:${MODE}] ${ok ? "PASS" : "FAIL"}: expected deliverable handback`)
    exitCode = ok ? 0 : 1
  } else {
    const ok = taskOutput.includes("Subagent stalled") && taskOutput.includes('finish="unknown"')
    console.log(`[e2e:${MODE}] ${ok ? "PASS" : "FAIL"}: expected stall abort`)
    exitCode = ok ? 0 : 1
  }
} catch (err) {
  console.error(`[e2e:${MODE}] FAIL: ${String(err).slice(0, 300)}`)
  exitCode = 1
} finally {
  if (child) {
    try { child.kill() } catch { /* already gone */ }
  }
  // Close the log fd; keep the sandbox dir (serve.log / evidence artifacts live
  // there) unless OMO_CLEANUP_SANDBOX=1 is set for a fully tidy run.
  try { logFd && (await import("node:fs")).closeSync(logFd) } catch { /* ignore */ }
  if (process.env.OMO_CLEANUP_SANDBOX === "1") {
    try { rmSync(sandbox, { recursive: true, force: true }) } catch { /* ignore */ }
  }
  // Host isolation guard: the user's session count must be unchanged.
  const hostCountAfter = await hostSessionCount()
  console.log(`[e2e:${MODE}] host-session-count-after=${hostCountAfter ?? "n/a"}`)
  if (hostCountBefore !== null && hostCountAfter !== null && hostCountAfter !== hostCountBefore) {
    console.error(`[e2e:${MODE}] FAIL: host session count changed ${hostCountBefore} -> ${hostCountAfter}; run is NOT isolated`)
    exitCode = 1
  }
}

process.exit(exitCode)
