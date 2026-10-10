#!/usr/bin/env bun
// Live QA for the computer-use foreground-control confirm (#9651 B5b) through senpi's REAL rpc mode: the
// omo plugin and the omo mock provider drive one `computer` run that calls `desktop.control.acquire`, the
// human confirm leaves senpi as an `extension_ui_request` on stdout, and this driver plays the client.
// The engine runs on its fake backend, so no real input ever reaches this machine.
//
//   no-answer   the client never answers: the confirm times out, the run reports no grant, and the
//               engine never sees control.grant (what a desktop app that drops the dialog must mean)
//   declined    the client answers confirmed:false: no grant
//   approved    the client answers confirmed:true: the grant is audited and the end of the task
//               revokes it (control.revoke on agent_end); the positive control that keeps the other
//               two from passing vacuously
//
// Usage: SENPI_BIN=<senpi> bun computer-control-rpc-e2e.mjs [--engine <path>] [--evidence-dir <dir>] [--only a,b]
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { createSandbox, seedSandbox } from "./drive.mjs"
import { isolatedChildEnv } from "./sandbox-child-env.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "..", "..", "..", "..")
const mockProviderEntry = join(scriptDir, "mock-provider", "index.ts")
const fakeDesktop = join(repoRoot, "crates", "senpi-desktop-backend-fake", "fixtures", "two-displays-one-window.json")
const CONFIRM_TITLE = "Allow foreground computer control?"
const REASON = "QA: click Run in the fixture window"
// The host bounds the confirm at 45 s (CONTROL_CONFIRM_TIMEOUT_MS, under the 60 s run budget); the turn gets slack.
const TURN_TIMEOUT_MS = 150_000

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

const senpiBin = process.env.SENPI_BIN?.trim()
const enginePath = resolve(argValue("--engine") ?? join(repoRoot, "target", "release", "senpi-desktop-engine"))
const evidenceDir = argValue("--evidence-dir")
const only = argValue("--only")?.split(",")

function fileDigest(path) {
  return existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : "absent"
}

const protectedFiles = [join(homedir(), ".senpi", "agent", "auth.json"), join(homedir(), ".omo", "agent", "auth.json")]

function filesNamed(root, predicate, found = []) {
  if (!existsSync(root)) return found
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) filesNamed(path, predicate, found)
    else if (predicate(entry.name)) found.push(path)
  }
  return found
}

function jsonLines(text) {
  return text
    .split("\n")
    .filter((line) => line.trim().startsWith("{"))
    .flatMap((line) => {
      try {
        return [JSON.parse(line)]
      } catch {
        return []
      }
    })
}

function toolResults(agentDir) {
  return filesNamed(join(agentDir, "sessions"), (name) => name.endsWith(".jsonl"))
    .flatMap((path) => jsonLines(readFileSync(path, "utf8")))
    .map((entry) => entry.message ?? entry)
    .filter((message) => message?.role === "toolResult")
}

function auditActions(root) {
  return filesNamed(root, (name) => name === ".computer-audit.jsonl")
    .flatMap((path) => jsonLines(readFileSync(path, "utf8")))
    .map((entry) => entry.action)
    .filter((action) => typeof action === "string")
}

function resultText(result) {
  return (result?.content ?? []).map((part) => (typeof part?.text === "string" ? part.text : "")).join("\n")
}

function scrubbedEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(OMO|SENPI|PI)_/.test(key)))
}

const acquireRun = {
  action: "run",
  code: `const state = await desktop.control.acquire({ reason: ${JSON.stringify(REASON)} }); return JSON.stringify(state)`,
}

// Plays the rpc client: sends one prompt, answers (or not) the confirm, resolves on agent_end.
function runScenario({ name, answer }) {
  const sandbox = createSandbox()
  seedSandbox(sandbox)
  mkdirSync(join(sandbox.cwd, ".omo"), { recursive: true })
  writeFileSync(
    join(sandbox.cwd, ".omo", "omo.jsonc"),
    JSON.stringify({ computer: { engine_path: enginePath, allow_host_relay_only_stop: true } }),
  )
  const steps = [
    { type: "tool_call", name: "computer", arguments: acquireRun },
    { type: "text", text: "done" },
  ]
  writeFileSync(join(sandbox.cwd, "mock-script.json"), `${JSON.stringify({ steps }, null, 2)}\n`)
  return new Promise((resolvePromise) => {
    const started = Date.now()
    const child = spawn(senpiBin, ["-e", mockProviderEntry, "--mode", "rpc", "--provider", "omo-mock", "--model", "mock-1"], {
      cwd: sandbox.cwd,
      env: {
        ...isolatedChildEnv(scrubbedEnv(), sandbox.agentDir),
        OMO_CODING_AGENT_DIR: sandbox.agentDir,
        SENPI_CODING_AGENT_DIR: sandbox.agentDir,
        PI_CODING_AGENT_DIR: sandbox.agentDir,
        HOME: sandbox.homeDir,
        USERPROFILE: sandbox.homeDir,
        XDG_CONFIG_HOME: sandbox.xdgConfigHome,
        XDG_DATA_HOME: sandbox.xdgDataHome,
        XDG_CACHE_HOME: sandbox.xdgCacheHome,
        PI_OFFLINE: "1",
        OMO_SENPI_QA: "1",
        SENPI_DESKTOP_BACKEND: `fake:${fakeDesktop}`,
      },
      stdio: ["pipe", "pipe", "pipe"],
      // Own process group: the launcher re-execs under bun, so the kill must reach the whole group.
      detached: true,
    })
    let stdout = ""
    let stderr = ""
    let buffered = ""
    let ended = false
    let finished = false
    const confirms = []
    const finish = (reason) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      if (typeof child.pid === "number") {
        try {
          process.kill(-child.pid, "SIGKILL")
        } catch {}
      }
      child.once("exit", () => settle(reason))
      if (child.exitCode !== null || child.signalCode !== null) settle(reason)
    }
    let settled = false
    const settle = (reason) => {
      if (settled) return
      settled = true
      const results = toolResults(sandbox.agentDir)
      const audits = auditActions(sandbox.root)
      const outcome = { name, reason, ended, elapsedMs: Date.now() - started, confirms, results, audits }
      if (evidenceDir !== undefined) {
        writeFileSync(
          join(evidenceDir, `${name}.json`),
          `${JSON.stringify({ ...outcome, stdout: stdout.slice(-20_000), stderr: stderr.slice(-4000) }, null, 2)}\n`,
        )
      }
      rmSync(sandbox.root, { recursive: true, force: true })
      resolvePromise(outcome)
    }
    const timer = setTimeout(() => finish("turn-timeout"), TURN_TIMEOUT_MS)
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    child.stdout.on("data", (chunk) => {
      stdout += chunk
      buffered += chunk
      const lines = buffered.split("\n")
      buffered = lines.pop() ?? ""
      for (const event of jsonLines(lines.join("\n"))) {
        if (event.type === "extension_ui_request" && event.method === "confirm") {
          confirms.push({ title: event.title, message: event.message, timeout: event.timeout, atMs: Date.now() - started })
          if (answer !== undefined) {
            child.stdin.write(`${JSON.stringify({ type: "extension_ui_response", id: event.id, confirmed: answer })}\n`)
          }
        }
        if (event.type === "agent_end" && !ended) {
          ended = true
          if (answer !== true) {
            finish("agent_end")
            continue
          }
          // The grant's revoke rides agent_end: wait for its audit line (bounded), not a fixed delay.
          const deadline = Date.now() + 10_000
          const awaitRevoke = () => {
            if (auditActions(sandbox.root).includes("control.revoke") || Date.now() > deadline) finish("agent_end")
            else setTimeout(awaitRevoke, 100)
          }
          awaitRevoke()
        }
      }
    })
    child.stdin.write(`${JSON.stringify({ type: "prompt", message: `computer-control QA: ${name}` })}\n`)
  })
}

const computerResult = (outcome) => outcome.results.find((result) => result.toolName === "computer")

const scenarios = [
  {
    name: "no-answer",
    answer: undefined,
    verify: (outcome) => [
      ["the confirm left senpi as an extension_ui_request", outcome.confirms.length === 1],
      ["it carries the upstream title", outcome.confirms[0]?.title === CONFIRM_TITLE],
      ["it carries the model's reason", outcome.confirms[0]?.message?.includes(REASON) === true],
      ["the turn ended on its own", outcome.ended],
      ["the run reported no grant", resultText(computerResult(outcome)).includes('"active":false')],
      ["the engine never saw control.grant", !outcome.audits.includes("control.grant")],
    ],
  },
  {
    name: "declined",
    answer: false,
    verify: (outcome) => [
      ["the confirm left senpi as an extension_ui_request", outcome.confirms.length === 1],
      ["the turn ended", outcome.ended],
      ["the run reported no grant", resultText(computerResult(outcome)).includes('"active":false')],
      ["the engine never saw control.grant", !outcome.audits.includes("control.grant")],
    ],
  },
  {
    name: "approved",
    answer: true,
    verify: (outcome) => [
      ["the confirm left senpi as an extension_ui_request", outcome.confirms.length === 1],
      ["the turn ended", outcome.ended],
      ["the run reported an active grant", resultText(computerResult(outcome)).includes('"active":true')],
      ["the engine audited control.grant", outcome.audits.includes("control.grant")],
      ["the end of the task revoked it", outcome.audits.includes("control.revoke")],
    ],
  },
]

if (!senpiBin) {
  console.log(JSON.stringify({ verdict: "SKIP", reason: "SENPI_BIN is unset; this is not a pass" }))
  process.exit(1)
}
if (!existsSync(enginePath)) {
  console.log(JSON.stringify({ verdict: "FAIL", reason: `no engine at ${enginePath}; run cargo build --release -p senpi-desktop-engine` }))
  process.exit(1)
}
if (evidenceDir !== undefined) mkdirSync(evidenceDir, { recursive: true })

const before = protectedFiles.map(fileDigest)
const report = []
for (const scenario of scenarios.filter((candidate) => only === undefined || only.includes(candidate.name))) {
  const outcome = await runScenario(scenario)
  const checks = scenario.verify(outcome).map(([check, ok]) => ({ check, ok }))
  report.push({ scenario: scenario.name, reason: outcome.reason, elapsedMs: outcome.elapsedMs, audits: outcome.audits, checks })
}
const realStateUntouched = protectedFiles.map(fileDigest).every((digest, index) => digest === before[index])
const passed = realStateUntouched && report.length > 0 && report.every(({ checks }) => checks.every(({ ok }) => ok))
console.log(JSON.stringify({ verdict: passed ? "PASS" : "FAIL", senpiBin, enginePath, realStateUntouched, report }, null, 2))
process.exit(passed ? 0 : 1)
