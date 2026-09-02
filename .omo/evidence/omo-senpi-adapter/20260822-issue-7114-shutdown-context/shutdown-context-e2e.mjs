import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = process.cwd()
const drive = await import(pathToFileURL(join(repoRoot, "packages", "omo-senpi", "scripts", "qa", "drive.mjs")).href)
const sandbox = drive.createSandbox()
drive.seedSandbox(sandbox)

const senpiBin = join(repoRoot, "node_modules", ".bin", "senpi.exe")
const mockProvider = join(repoRoot, "packages", "omo-senpi", "scripts", "qa", "task-e2e-mock-provider.ts")
const memoryHome = join(sandbox.root, "memory")
const sessionsDir = join(sandbox.agentDir, "sessions")
const omoDir = join(sandbox.cwd, ".omo")
mkdirSync(sessionsDir, { recursive: true })
mkdirSync(omoDir, { recursive: true })
writeFileSync(join(sandbox.agentDir, "auth.json"), `${JSON.stringify({ "omo-mock": { type: "api_key", key: "mock" } }, null, 2)}\n`)

function writeConfig(shutdownLaunch) {
  const config = {
    categories: { quick: { description: "QA mock quick category", model: "omo-mock/mock-1" } },
    memory: {
      enabled: true,
      reflection: { trigger: { step_count: 0, on_compaction: false } },
      facts: { enabled: false, debounce_settles: 4 },
      dream: {
        enabled: true,
        idle_minutes: 0,
        min_hours_between: 0,
        shutdown_launch: shutdownLaunch,
        auto_select_max: 5,
        auto_select_max_chars: 150000,
      },
    },
  }
  writeFileSync(join(omoDir, "omo.json"), `${JSON.stringify(config, null, 2)}\n`)
}

function writeScript(parentSteps) {
  writeFileSync(join(sandbox.cwd, "mock-script.json"), `${JSON.stringify({ parentSteps, childSteps: [{ type: "text", text: "child done" }] }, null, 2)}\n`)
}

function run(prompt) {
  return spawnSync(senpiBin, [
    "-e", mockProvider,
    "-p",
    "--mode", "json",
    "--provider", "omo-mock",
    "--model", "mock-1",
    "--session-dir", sessionsDir,
    prompt,
  ], {
    cwd: sandbox.cwd,
    env: {
      ...process.env,
      SENPI_CODING_AGENT_DIR: sandbox.agentDir,
      XDG_CONFIG_HOME: sandbox.xdgConfigHome,
      OMO_MEMORY_HOME: memoryHome,
      OMO_SENPI_QA: "1",
    },
    encoding: "utf8",
    timeout: 120_000,
  })
}

function collectFiles(root, files = []) {
  if (!existsSync(root)) return files
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) collectFiles(path, files)
    else if (entry.isFile()) files.push(path)
  }
  return files
}

function readJsonRecords(root) {
  const records = []
  for (const path of collectFiles(root).filter((candidate) => candidate.endsWith(".json"))) {
    try {
      records.push({ path, value: JSON.parse(readFileSync(path, "utf8")) })
    } catch {}
  }
  return records
}

function isShutdownRecord(value) {
  return JSON.stringify(value).includes('"origin":"shutdown"')
}

function assistantTexts(stdout) {
  const texts = []
  const visit = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (typeof value !== "object" || value === null) return
    if (value.role === "assistant" && Array.isArray(value.content)) {
      for (const part of value.content) {
        if (part?.type === "text" && typeof part.text === "string") texts.push(part.text)
      }
    }
    for (const child of Object.values(value)) visit(child)
  }
  for (const line of stdout.split(/\r?\n/)) {
    if (line.trim() === "") continue
    try { visit(JSON.parse(line)) } catch {}
  }
  return [...new Set(texts)]
}

const realAgentDir = join(homedir(), ".senpi", "agent")
const realBefore = drive.credentialDigest(realAgentDir)

writeConfig(false)
writeScript([
  {
    type: "tool_call",
    name: "memory",
    arguments: {
      command: "create",
      file_path: "system/facts.md",
      description: "shutdown context QA seed",
      file_text: "seed for shutdown context lifecycle QA",
      reason: "create the isolated memory repo before the quit drain probe",
    },
  },
  { type: "text", text: "seeded" },
])
const seed = run("seed isolated memory")

writeConfig(true)
writeScript([{ type: "text", text: "OK" }])
const probe = run(`Return exactly OK. ${"x".repeat(10_000)}`)

let records = []
const waitDeadline = Date.now() + 30_000
do {
  records = readJsonRecords(memoryHome)
  if (records.some(({ value }) => isShutdownRecord(value))) break
  await new Promise((resolve) => setTimeout(resolve, 250))
} while (Date.now() < waitDeadline)

const transcript = `${probe.stdout ?? ""}\n${probe.stderr ?? ""}`
const observedAssistantTexts = assistantTexts(probe.stdout ?? "")
const shutdownRecords = records.filter(({ value }) => isShutdownRecord(value))
const completionRecords = records.filter(({ path }) => path.includes(`${join("reflection", "completions")}`))
const finalRecords = records.filter(({ path }) => path.endsWith(`${join("final.json")}`))
const realAfter = drive.credentialDigest(realAgentDir)
const checks = {
  seedExitZero: seed.status === 0,
  probeExitZero: probe.status === 0,
  exactAnswerObserved: observedAssistantTexts.includes("OK"),
  staleExtensionContextAbsent: !transcript.includes("stale extension ctx"),
  shutdownOriginRecorded: shutdownRecords.length > 0,
  realSenpiUntouched: realBefore === realAfter,
}

console.log(JSON.stringify({
  result: Object.values(checks).every(Boolean) ? "PASS" : "FAIL",
  checks,
  sandboxRoot: sandbox.root,
  sandboxAgentDir: sandbox.agentDir,
  sandboxMemoryHome: memoryHome,
  seed: { status: seed.status, signal: seed.signal, stderrTail: (seed.stderr ?? "").slice(-1200) },
  probe: { status: probe.status, signal: probe.signal, stdoutTail: (probe.stdout ?? "").slice(-1200), stderrTail: (probe.stderr ?? "").slice(-2400) },
  observedAssistantTexts,
  shutdownRecords: shutdownRecords.map(({ path, value }) => ({ path, value })),
  completionRecords: completionRecords.map(({ path, value }) => ({ path, value })),
  finalRecords: finalRecords.map(({ path, value }) => ({ path, value })),
}, null, 2))

process.exit(Object.values(checks).every(Boolean) ? 0 : 1)
