#!/usr/bin/env node
// Task 7 real-surface leg (print mode): a scripted senpi -p session commits a persona edit
// through the MCP surface (tool_exposure "search", non-auto memory.agent) and the persisted
// omo-memory:soul-updated entry is asserted from the session JSONL. Print mode never invokes
// entry renderers, so this leg proves PERSISTENCE + the IC-17 receipt path; the TUI leg proves
// the renderer path. Isolation: fresh OMO_MEMORY_HOME + SENPI_CODING_AGENT_DIR, torn down after.
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createSandbox, seedSandbox } from "/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/memory-v2-active-learning/packages/omo-senpi/scripts/qa/drive.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const mockProviderEntry = join(
  "/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/memory-v2-active-learning/packages/omo-senpi/scripts/qa",
  "task-e2e-mock-provider.ts",
)
const senpiBin = process.env.SENPI_BIN
if (senpiBin === undefined) throw new Error("SENPI_BIN is required")

// resolveMemoryIdentity derives `<slug>-<sha256-8>` from the configured memory.agent value.
const AGENT_SETTING = "qa-soul-agent"
const IDENTITY = `${AGENT_SETTING}-${createHash("sha256").update(AGENT_SETTING, "utf8").digest("hex").slice(0, 8)}`
const results = []
function record(name, ok, detail) {
  results.push({ name, ok })
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`)
}

const sandbox = createSandbox()
seedSandbox(sandbox)
mkdirSync(join(sandbox.agentDir, "sessions"), { recursive: true })
mkdirSync(join(sandbox.cwd, ".omo"), { recursive: true })
writeFileSync(join(sandbox.agentDir, "auth.json"), `${JSON.stringify({ "omo-mock": { type: "api_key", key: "mock" } }, null, 2)}\n`)
writeFileSync(join(sandbox.cwd, ".omo", "omo.json"), `${JSON.stringify({
  memory: {
    enabled: true,
    agent: AGENT_SETTING,
    tool_exposure: "search",
    reflection: { trigger: { step_count: 0, on_compaction: false } },
  },
}, null, 2)}\n`)

const memoryHome = join(sandbox.root, "memory")
writeFileSync(join(sandbox.cwd, "mock-script.json"), `${JSON.stringify({
  parentSteps: [
    { type: "tool_call", name: "tool_search", arguments: { query: "memory" } },
    {
      type: "tool_call",
      name: "mcp_omo-memory_memory",
      arguments: {
        command: "str_replace",
        reason: "QA soul rewrite",
        file_path: "system/persona.md",
        old_string: "It is your soul and they should know.",
        new_string: "It is your soul and they should know. QA touched it.",
      },
    },
    { type: "text", text: "done" },
  ],
  childSteps: [],
}, null, 2)}\n`)

console.log(`SANDBOX=${sandbox.root}`)
const run = spawnSync(
  senpiBin,
  ["-e", mockProviderEntry, "-p", "--mode", "json", "--provider", "omo-mock", "--model", "mock-1",
    "--session-dir", join(sandbox.agentDir, "sessions"), "rewrite your persona"],
  {
    cwd: sandbox.cwd,
    env: {
      ...process.env,
      SENPI_CODING_AGENT_DIR: sandbox.agentDir,
      XDG_CONFIG_HOME: sandbox.xdgConfigHome,
      OMO_MEMORY_HOME: memoryHome,
      OMO_SENPI_QA: "1",
    },
    encoding: "utf8",
    timeout: 180_000,
  },
)
console.log(`EXIT_STATUS=${run.status}`)
console.log("--- stdout tail ---")
console.log(run.stdout.slice(-4000))
console.log("--- stderr tail ---")
console.log(run.stderr.slice(-1500))
if (process.env.QA_KEEP_SANDBOX === undefined) {
  // teardown happens at the end; this marker only aids debugging
}

const repoDir = join(memoryHome, "agents", IDENTITY, "repo")
record("bound identity repo created", existsSync(join(repoDir, ".git")), repoDir)

let head = ""
let body = ""
if (existsSync(join(repoDir, ".git"))) {
  head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoDir, encoding: "utf8" }).stdout.trim()
  body = spawnSync("git", ["log", "-1", "--format=%s%n%b", "HEAD"], { cwd: repoDir, encoding: "utf8" }).stdout
}
record("persona commit subject landed", body.startsWith("QA soul rewrite"), body.split("\n")[0] ?? "")
record(
  "IC-2 trailers present on the MCP-surface commit",
  body.includes("Omo-Writer: memory-tool") && body.includes("Omo-Session:") && body.includes("Omo-Turn:"),
  body.replaceAll("\n", " | "),
)

const toolResultHasDiscipline = run.stdout.includes("soul edit")
record("tool result carries the soul-edit discipline line", toolResultHasDiscipline)

const receiptsDir = join(memoryHome, "agents", IDENTITY, "runtime", "tool-receipts")
const leftoverReceipts = existsSync(receiptsDir) ? readdirSync(receiptsDir) : []
record("tool receipt consumed by tool_result", leftoverReceipts.length === 0, leftoverReceipts.join(","))

function* sessionFiles(dir) {
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, name.name)
    if (name.isDirectory()) yield* sessionFiles(path)
    else if (name.name.endsWith(".jsonl")) yield path
  }
}

const soulEntries = []
for (const file of sessionFiles(join(sandbox.agentDir, "sessions"))) {
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.includes("omo-memory:soul-updated")) continue
    try {
      const row = JSON.parse(line)
      const entry = row.entry ?? row
      if (entry.customType === "omo-memory:soul-updated") soulEntries.push(entry)
    } catch {}
  }
}
record("exactly one persisted soul-updated entry", soulEntries.length === 1, `count=${soulEntries.length}`)
const data = soulEntries[0]?.data ?? {}
record(
  "persisted entry carries the commit sha and affected paths",
  data.sha === head && JSON.stringify(data.affectedPaths) === JSON.stringify(["system/persona.md"]),
  JSON.stringify(data),
)

const failed = results.filter((r) => !r.ok)
console.log(`REAL_SURFACE_RESULT=${failed.length === 0 ? "PASS" : "FAIL"}`)
if (process.env.QA_KEEP_SANDBOX === "1") {
  console.log(`SANDBOX KEPT: ${sandbox.root}`)
} else {
  rmSync(sandbox.root, { recursive: true, force: true })
  console.log(`REAL-SURFACE TEARDOWN: rm -rf ${sandbox.root}`)
  console.log(`REAL-SURFACE TEARDOWN VERIFIED: ${existsSync(sandbox.root) ? "STILL PRESENT" : "absent"}`)
}
process.exitCode = failed.length === 0 ? 0 : 1
