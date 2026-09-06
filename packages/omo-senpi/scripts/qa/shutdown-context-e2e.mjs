#!/usr/bin/env node
// Live Senpi proof for shutdown-triggered reflection: print-mode session replacement, a
// discovery-disabled child that can actually see a configured mock model, and durable delivery
// into the next live session. Completion is observed through a pre-subscribed fs.watch signal,
// not a 250ms poll loop.
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, watch, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { delimiter, join, sep } from "node:path"
import { pathToFileURL } from "node:url"

import { startMockCompletionsServer } from "./mock-completions-server.mjs"

const repoRoot = process.cwd()
const drive = await import(pathToFileURL(join(repoRoot, "packages", "omo-senpi", "scripts", "qa", "drive.mjs")).href)
const COMPLETION_TIMEOUT_MS = 90_000
const DELIVERY_TIMEOUT_MS = 30_000
const SUCCESSFUL_OUTCOMES = new Set(["merged", "no_changes"])

ensurePosixMkdirOnPath()
const sandbox = drive.createSandbox()
drive.seedSandbox(sandbox)

const senpiBin = resolveSenpiBin()
const mockProvider = join(repoRoot, "packages", "omo-senpi", "scripts", "qa", "task-e2e-mock-provider.ts")
const memoryHome = join(sandbox.root, "memory")
const sessionsDir = join(sandbox.agentDir, "sessions")
const omoDir = join(sandbox.cwd, ".omo")
const nativeState = join(sandbox.agentDir, "omo-senpi", "omo-native")
mkdirSync(sessionsDir, { recursive: true })
mkdirSync(omoDir, { recursive: true })
mkdirSync(memoryHome, { recursive: true })
mkdirSync(nativeState, { recursive: true })
writeFileSync(join(nativeState, "onboarding-completed"), `${JSON.stringify({ completedAt: "2026-01-01T00:00:00.000Z", version: 1 })}\n`)

const mockServer = startMockCompletionsServer({
  steps(body) {
    return isReflectionChildRequest(body)
      ? [{ type: "text", text: "No memory changes required." }]
      : [{ type: "text", text: "OK" }]
  },
})
const baseUrl = await mockServer.ready

writeFileSync(join(sandbox.agentDir, "auth.json"), `${JSON.stringify({ "omo-mock": { type: "api_key", key: "mock" } }, null, 2)}\n`)
writeFileSync(join(sandbox.agentDir, "models.json"), `${JSON.stringify({
  providers: {
    "omo-mock": {
      name: "omo mock http provider",
      api: "openai-completions",
      baseUrl,
      apiKey: "mock",
      models: [{
        id: "mock-1",
        name: "Mock 1",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200000,
        maxTokens: 8192,
      }],
    },
  },
}, null, 2)}\n`)

function writeConfig(shutdownLaunch) {
  writeFileSync(join(omoDir, "omo.json"), `${JSON.stringify({
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
  }, null, 2)}\n`)
}

function writeScript(parentSteps) {
  writeFileSync(join(sandbox.cwd, "mock-script.json"), `${JSON.stringify({
    parentSteps,
    childSteps: [{ type: "text", text: "child done" }],
  }, null, 2)}\n`)
}

function sandboxEnv() {
  const env = { ...process.env }
  delete env.OMO_CODING_AGENT_DIR
  delete env.PI_CODING_AGENT_DIR
  delete env.SENPI_BIN
  return {
    ...env,
    SENPI_CODING_AGENT_DIR: sandbox.agentDir,
    XDG_CONFIG_HOME: sandbox.xdgConfigHome,
    XDG_DATA_HOME: sandbox.xdgDataHome,
    XDG_CACHE_HOME: sandbox.xdgCacheHome,
    HOME: sandbox.homeDir,
    USERPROFILE: sandbox.homeDir,
    OMO_MEMORY_HOME: memoryHome,
    OMO_SENPI_QA: "1",
  }
}

function run(prompt) {
  return spawnSync(senpiBin.command, [
    ...senpiBin.prefixArgs,
    "-e", mockProvider,
    "-p",
    "--mode", "json",
    "--provider", "omo-mock",
    "--model", "mock-1",
    "--session-dir", sessionsDir,
    prompt,
  ], {
    cwd: sandbox.cwd,
    env: sandboxEnv(),
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

function parseJsonFile(path) {
  const text = readFileSync(path, "utf8")
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    return { ok: false, error }
  }
}

function isCompletionPath(path) {
  const parts = path.split(/[\\/]/)
  return parts.includes("reflection") && parts.includes("completions") && path.endsWith(".json") && !path.includes(".tmp-")
}

function readShutdownCompletions() {
  const records = []
  const parseErrors = []
  for (const path of collectFiles(memoryHome).filter(isCompletionPath)) {
    const parsed = parseJsonFile(path)
    if (!parsed.ok) {
      parseErrors.push({ path: redact(path), message: parsed.error.message })
      continue
    }
    if (parsed.value?.origin === "shutdown" && parsed.value?.schemaVersion === 1) {
      records.push({ path: redact(path), value: parsed.value })
    }
  }
  return { records, parseErrors }
}

function waitForCondition(inspect, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    let settled = false
    let watcher
    const finish = (value, error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearInterval(recheck)
      watcher?.close()
      if (error !== undefined) reject(error)
      else resolve(value)
    }
    const check = () => {
      try {
        const value = inspect()
        if (value !== undefined) finish(value)
      } catch (error) {
        finish(undefined, error)
      }
    }
    const timer = setTimeout(() => {
      finish(undefined, new Error(`${label} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    const recheck = setInterval(check, 25)
    try {
      watcher = watch(memoryHome, { recursive: true }, check)
      watcher.on("error", () => {
        watcher?.close()
        watcher = undefined
      })
    } catch {
      // The 25ms state recheck remains authoritative when fs.watch is unavailable.
    }
    check()
  })
}

function redact(path) {
  return path.split(sandbox.root).join("<sandbox>").split(sep).join("/")
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
    const parsed = parseJsonFileLine(line)
    if (parsed.ok) visit(parsed.value)
  }
  return [...new Set(texts)]
}

function parseJsonFileLine(line) {
  try {
    return { ok: true, value: JSON.parse(line) }
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    return { ok: false, error }
  }
}

function isReflectionChildRequest(body) {
  const tools = Array.isArray(body?.tools) ? body.tools : []
  const names = tools.map((tool) => tool?.function?.name ?? tool?.name).filter(Boolean)
  return names.includes("bash") && names.includes("edit")
}

function resolveSenpiBin() {
  const bun = process.platform === "win32" ? "bun.exe" : "bun"
  const cli = join(repoRoot, "node_modules", "@code-yeongyu", "senpi", "dist", "cli.js")
  if (existsSync(cli)) return { command: bun, prefixArgs: [cli] }
  const exe = join(repoRoot, "node_modules", ".bin", process.platform === "win32" ? "senpi.exe" : "senpi")
  if (existsSync(exe)) return { command: exe, prefixArgs: [] }
  throw new Error("Senpi CLI not found; run bun install first")
}

function ensurePosixMkdirOnPath() {
  if (process.platform !== "win32") return
  const gitUsrBin = join("C:", "Program Files", "Git", "usr", "bin")
  if (!existsSync(join(gitUsrBin, "mkdir.exe"))) return
  if ((process.env.PATH ?? "").split(delimiter).includes(gitUsrBin)) return
  process.env.PATH = `${gitUsrBin}${delimiter}${process.env.PATH ?? ""}`
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
const completionWait = waitForCondition(() => {
  const snapshot = readShutdownCompletions()
  const successful = snapshot.records.filter(({ value }) => SUCCESSFUL_OUTCOMES.has(value.outcome))
  return successful.length > 0 ? snapshot : undefined
}, COMPLETION_TIMEOUT_MS, "successful shutdown completion")

const probe = run(`Return exactly OK. ${"x".repeat(10_000)}`)
let completionSnapshot
let completionError
try {
  completionSnapshot = await completionWait
} catch (error) {
  completionError = error
  completionSnapshot = readShutdownCompletions()
}

writeConfig(false)
writeScript([{ type: "text", text: "delivered" }])
const deliveryWait = waitForCondition(() => {
  const snapshot = readShutdownCompletions()
  const delivered = snapshot.records.filter(({ value }) => (
    SUCCESSFUL_OUTCOMES.has(value.outcome) && value.delivery?.status === "consumed"
  ))
  return delivered.length > 0 ? snapshot : undefined
}, DELIVERY_TIMEOUT_MS, "durable consumed delivery")
const deliveryProbe = run("confirm shutdown delivery")
let deliverySnapshot
let deliveryError
try {
  deliverySnapshot = await deliveryWait
} catch (error) {
  deliveryError = error
  deliverySnapshot = readShutdownCompletions()
}

const transcript = `${probe.stdout ?? ""}\n${probe.stderr ?? ""}`
const observedAssistantTexts = assistantTexts(probe.stdout ?? "")
const shutdownRecords = (deliverySnapshot ?? completionSnapshot).records
const successful = shutdownRecords.filter(({ value }) => SUCCESSFUL_OUTCOMES.has(value.outcome))
const delivered = successful.filter(({ value }) => value.delivery?.status === "consumed")
const realAfter = drive.credentialDigest(realAgentDir)
const checks = {
  seedExitZero: seed.status === 0,
  probeExitZero: probe.status === 0,
  exactAnswerObserved: observedAssistantTexts.includes("OK"),
  staleExtensionContextAbsent: !transcript.includes("stale extension ctx"),
  shutdownOriginRecorded: shutdownRecords.length > 0,
  shutdownOutcomeSuccessful: successful.length > 0,
  durableDeliveryConsumed: delivered.length > 0,
  realSenpiUntouched: realBefore === realAfter,
}

const report = {
  result: Object.values(checks).every(Boolean) ? "PASS" : "FAIL",
  checks,
  errors: {
    ...(completionError === undefined ? {} : { completion: String(completionError) }),
    ...(deliveryError === undefined ? {} : { delivery: String(deliveryError) }),
  },
  observedAssistantTexts,
  shutdownRecords: shutdownRecords.map(({ path, value }) => ({
    path,
    outcome: value.outcome,
    reason: value.reason,
    detail: value.detail,
    origin: value.origin,
    deliveryStatus: value.delivery?.status,
  })),
  parseErrors: (deliverySnapshot ?? completionSnapshot).parseErrors,
}

console.log(JSON.stringify(report, null, 2))
mockServer.close()
process.exit(Object.values(checks).every(Boolean) ? 0 : 1)
