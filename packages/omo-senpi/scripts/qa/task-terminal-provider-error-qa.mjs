#!/usr/bin/env node
// Live QA driver for senpi#3262 (omo #10149): a background RPC-process task child whose turn ends
// on a terminal provider error must end the task `error` with the provider's own text - never
// `running` forever. The mock provider's `provider_error` step ends the child's stream with
// stopReason "error" + the issue's canonical message; the sandbox disables in-turn retries
// (maxRetries 0) and configures no fallback chain, so `agent_end` lands `willRetry: false`, exactly
// like the reported exhausted-budget stream-start timeout.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { delimiter, dirname, extname, isAbsolute, join, resolve } from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const { digestCredentialFiles, readRecords } = await import(pathToFileURL(join(scriptDir, "task-rpc-e2e-helpers.mjs")).href)
const { prepareScenarioSandbox } = await import(pathToFileURL(join(scriptDir, "task-rpc-e2e-scenarios.mjs")).href)
const { waitForRecord, readRecordsLenient } = await import(pathToFileURL(join(scriptDir, "task-rpc-record-wait.mjs")).href)
const { isolatedChildEnv, sandboxStateDir } = await import(pathToFileURL(join(scriptDir, "sandbox-child-env.mjs")).href)
void sandboxStateDir

const PROVIDER_ERROR_TEXT = "Provider stream start timed out after 300000ms"
const TASK_NAME = "qa3262"
const SETTLE_TIMEOUT_MS = 60_000

const PROJECT_OMO_CONFIG = {
  task: { default_execution_mode: "process", process_runner: "child-process" },
  categories: { proc: { description: "Process-mode mock category.", model: "omo-mock/mock-1" } },
}

const PARENT_STEPS = [
  { type: "tool_call", name: "task", arguments: { category: "proc", run_in_background: true, name: TASK_NAME, prompt: "Run one turn; it ends on the provider error." } },
  { type: "tool_call", name: "task_output", arguments: { name: TASK_NAME, mode: "status" } },
  { type: "text", text: "qa3262 parent turn complete", delayMs: 20_000 },
]
const CHILD_STEPS = [{ type: "provider_error", errorMessage: PROVIDER_ERROR_TEXT }]

function resolveSenpi() {
  const bin = process.env.SENPI_BIN?.trim() || "senpi"
  if (isAbsolute(bin) || bin.includes("/") || bin.includes("\\")) {
    const extensions = process.platform === "win32" && extname(bin) === "" ? [bin, `${bin}.exe`, `${bin}.cmd`, `${bin}.bat`] : [bin]
    for (const candidate of extensions) {
      const absolute = resolve(candidate)
      try {
        readFileSync(absolute)
        return absolute
      } catch {
        // keep searching
      }
    }
    return null
  }
  for (const dir of new Set([join(process.cwd(), "node_modules", ".bin"), ...(process.env.PATH ?? "").split(delimiter)])) {
    for (const name of [bin, `${bin}.exe`, `${bin}.cmd`, `${bin}.bat`]) {
      const candidate = resolve(dir || ".", name)
      try {
        readFileSync(candidate)
        return candidate
      } catch {
        // keep searching
      }
    }
  }
  return null
}

const mockProviderEntry = join(scriptDir, "task-terminal-provider-error-mock-provider.ts")

function childArgv(sessionDir, prompt) {
  return ["-e", mockProviderEntry, "-p", "--mode", "json", "--provider", "omo-mock", "--model", "mock-1", "--session-dir", sessionDir, prompt]
}

function childEnv(sandbox, sessionDir, senpiBin) {
  return { ...isolatedChildEnv(process.env, sandbox.agentDir), SENPI_BIN: senpiBin, SENPI_CODING_AGENT_DIR: sandbox.agentDir, XDG_CONFIG_HOME: sandbox.xdgConfigHome, SENPI_CODING_AGENT_SESSION_DIR: sessionDir, OMO_SENPI_QA: "1" }
}

async function driveSenpi(senpiBin, sandbox, sessionDir, parentSteps, childSteps, prompt) {
  writeFileSync(join(sandbox.cwd, "mock-script.json"), `${JSON.stringify({ parentSteps, childSteps }, null, 2)}\n`)
  const child = spawn(senpiBin, childArgv(sessionDir, prompt), {
    cwd: sandbox.cwd,
    env: childEnv(sandbox, sessionDir, senpiBin),
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    windowsHide: true,
  })
  let stdout = ""
  let stderr = ""
  child.stdout?.setEncoding("utf8")
  child.stderr?.setEncoding("utf8")
  child.stdout?.on("data", (chunk) => { stdout += chunk })
  child.stderr?.on("data", (chunk) => { stderr += chunk })
  const [status, signal] = await new Promise((done) => {
    child.once("close", (code, closeSignal) => done([code, closeSignal]))
    child.once("error", () => done([null, null]))
  })
  return { status, signal, stdout, stderr, pid: child.pid }
}

function readChildErrorTimestamp(stateDir) {
  const sessionsDir = join(stateDir, "sessions")
  const files = []
  const walk = (dir) => {
    let entries = []
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith(".jsonl")) files.push(full)
    }
  }
  walk(sessionsDir)
  for (const file of files) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const trimmed = line.trim()
      if (trimmed.length === 0) continue
      try {
        const parsed = JSON.parse(trimmed)
        const message = parsed?.type === "message" ? parsed.message : undefined
        if (
          message?.role === "assistant" &&
          message.stopReason === "error" &&
          typeof message.errorMessage === "string" &&
          message.errorMessage.includes(PROVIDER_ERROR_TEXT) &&
          typeof message.timestamp === "number"
        ) {
          return message.timestamp
        }
      } catch {
        // partial writes are not the harness's concern
      }
    }
  }
  return undefined
}

async function main() {
  const outDir = process.env.TASK_E2E_OUT_DIR
  if (outDir === undefined || outDir.length === 0) {
    console.error("TASK_E2E_OUT_DIR is required")
    process.exit(2)
  }
  mkdirSync(outDir, { recursive: true })
  const senpiBin = resolveSenpi()
  if (senpiBin === null) {
    writeFileSync(join(outDir, "qa-3262.json"), `${JSON.stringify({ verdict: "SKIP", reason: "senpi binary not found" }, null, 2)}\n`)
    console.log("SKIP: senpi binary not found")
    process.exit(0)
  }

  const realSenpiAgentDir = join(homedir(), ".senpi", "agent")
  const realDigestBefore = digestCredentialFiles(realSenpiAgentDir)
  const { sandbox, sessionDir, stateDir } = prepareScenarioSandbox(PROJECT_OMO_CONFIG)

  // The repro's terminality comes from an exhausted retry budget; force it directly: with
  // maxRetries 0 and no fallback chain the FIRST provider error is terminal (willRetry:false).
  const settingsPath = join(sandbox.agentDir, "settings.json")
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"))
  settings.retry = { enabled: true, maxRetries: 0 }
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)

  const startedAt = Date.now()
  const parent = await driveSenpi(senpiBin, sandbox, sessionDir, PARENT_STEPS, CHILD_STEPS, "drive the terminal-provider-error scenario")

  // The parent's print-mode turn is done; the background child's rpc process now ends on the
  // provider error. The fix settles it even when the session never emits agent_idle: inside one
  // heartbeat interval (10 s) the confirmation probe must find the session idle with no wake
  // source and fail the record with the provider's text.
  const settled = await waitForRecord(
    stateDir,
    (r) => r.name === TASK_NAME && (r.status === "error" || r.status === "completed" || r.status === "cancelled"),
    SETTLE_TIMEOUT_MS,
  )
  const settledMs = settled === undefined ? undefined : Date.now() - startedAt
  const latest = readRecordsLenient(stateDir).find((r) => r.name === TASK_NAME)

  // Which edge settled the turn: `agent_idle` fires sub-second after agent_end in the
  // no-continuation case, while the fix's settle-confirmation waits one heartbeat interval
  // (10 s). The lag between the child's errored message and the record's terminal_at names
  // the path: inside the confirmation window = the confirmation settled it (the bug's shape).
  const childErrorAt = readChildErrorTimestamp(stateDir)
  const terminalAt = latest?.terminal_at === undefined ? undefined : Date.parse(latest.terminal_at)
  const settleLagMs =
    childErrorAt === undefined || terminalAt === undefined ? undefined : terminalAt - childErrorAt
  const settlePath =
    settleLagMs === undefined ? "unknown" : settleLagMs >= 5_000 ? "settle_confirmation" : "agent_idle_or_unknown"
  const errorMessage = typeof latest?.error_message === "string" ? latest.error_message : ""
  const carriesProviderText = errorMessage.includes(PROVIDER_ERROR_TEXT)
  const pass = settled !== undefined && settled.status === "error" && carriesProviderText

  const realDigestAfter = digestCredentialFiles(realSenpiAgentDir)
  const result = {
    check: "terminal_provider_error_ends_task_failed",
    verdict: pass ? "PASS" : "FAIL",
    ...(pass
      ? {}
      : {
          reason:
            settled === undefined
              ? `no terminal record for ${TASK_NAME} within ${SETTLE_TIMEOUT_MS}ms (record stayed ${latest?.status ?? "absent"})`
              : settled.status !== "error"
                ? `task ended ${settled.status}, expected error`
                : `error_message does not carry the provider text: ${errorMessage.slice(0, 200)}`,
        }),
    facts: {
      senpiBin,
      settledMs,
      parentExit: { status: parent.status, signal: parent.signal ?? null },
      record: latest === undefined
        ? null
        : {
            task_id: latest.task_id,
            status: latest.status,
            execution_mode: latest.execution_mode,
            runner_kind: latest.runner_kind,
            residency_state: latest.residency_state,
            error_message: errorMessage,
            terminal_at: latest.terminal_at ?? null,
            updated_at: latest.updated_at,
          },
      allRecords: readRecords(stateDir).map((r) => ({ name: r.name, status: r.status, error_message: r.error_message ?? null })),
      sandboxAgentDir: sandbox.agentDir,
      stateDir,
      realSenpiUntouched: JSON.stringify(realDigestBefore) === JSON.stringify(realDigestAfter),
      realDigestBefore,
      realDigestAfter,
      settingsRetryOverride: settings.retry,
      settlePath,
      childErrorAt: childErrorAt === undefined ? null : new Date(childErrorAt).toISOString(),
      settleLagMs: settleLagMs ?? null,
      stderrExcerpt: (parent.stderr ?? "").slice(-600),
    },
  }
  writeFileSync(join(outDir, "qa-3262.json"), `${JSON.stringify(result, null, 2)}\n`)

  // Cleanup: the sandbox is task-owned; the background child's process must not outlive the run.
  rmSync(sandbox.root, { recursive: true, force: true })
  writeFileSync(
    join(outDir, "cleanup-receipt.json"),
    `${JSON.stringify({ removedSandbox: sandbox.root, removedAt: new Date().toISOString() }, null, 2)}\n`,
  )
  console.log(JSON.stringify({ verdict: result.verdict, settledMs, status: latest?.status, error_message: errorMessage.slice(0, 120) }))
  process.exit(pass ? 0 : 1)
}

await main()
