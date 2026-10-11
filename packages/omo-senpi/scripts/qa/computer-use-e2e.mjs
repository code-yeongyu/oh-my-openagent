#!/usr/bin/env node
// Real-surface QA for the computer-use component: drives the REAL senpi binary (SENPI_BIN) with the built
// plugin and the omo mock provider, against the real senpi-desktop-engine on its fake backend (no real
// input ever reaches this machine). Each scenario is one scripted `senpi -p` turn in a fresh sandbox.
//
// Usage: SENPI_BIN=<senpi> node packages/omo-senpi/scripts/qa/computer-use-e2e.mjs [--engine <path>] [--evidence-dir <dir>]
import { spawnSync } from "node:child_process"
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

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

const senpiBin = process.env.SENPI_BIN?.trim()
const enginePath = resolve(argValue("--engine") ?? join(repoRoot, "target", "release", "senpi-desktop-engine"))
const evidenceDir = argValue("--evidence-dir")

function fileDigest(path) {
  return existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : "absent"
}

// Credentials only: live sessions on this machine legitimately rewrite their own settings.json at any time.
// The lane never reaches the real agent dirs anyway (HOME and every *_CODING_AGENT_DIR point into the sandbox).
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

function jsonLines(path) {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line))
}

function toolResults(agentDir) {
  return filesNamed(join(agentDir, "sessions"), (name) => name.endsWith(".jsonl"))
    .flatMap(jsonLines)
    .map((entry) => entry.message ?? entry)
    .filter((message) => message?.role === "toolResult")
}

// The engine audits mutating requests only (input, clipboard writes, AX actions), never captures.
function auditMethods(root) {
  return filesNamed(root, (name) => name === ".computer-audit.jsonl")
    .flatMap(jsonLines)
    .map((entry) => entry.action)
    .filter((action) => typeof action === "string")
}

function resultText(result) {
  return (result?.content ?? []).map((part) => (typeof part?.text === "string" ? part.text : "")).join("\n")
}

// The caller's session exports OMO_/SENPI_/PI_ variables (package dirs, session ids) that redirect a child
// senpi to the installed runtime; the scenario sees only what it sets itself.
function scrubbedEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(OMO|SENPI|PI)_/.test(key)))
}

function runScenario({ name, permission, steps, computer = {} }) {
  const sandbox = createSandbox()
  try {
    seedSandbox(sandbox)
    mkdirSync(join(sandbox.cwd, ".omo"), { recursive: true })
    writeFileSync(
      join(sandbox.cwd, ".omo", "omo.jsonc"),
      JSON.stringify({ computer: { engine_path: enginePath, allow_host_relay_only_stop: true, ...computer } }),
    )
    writeFileSync(join(sandbox.cwd, "mock-record-tools"), "")
    writeFileSync(join(sandbox.cwd, "mock-script.json"), `${JSON.stringify({ steps }, null, 2)}\n`)
    const args = ["-e", mockProviderEntry, "-p", "--provider", "omo-mock", "--model", "mock-1"]
    if (permission !== undefined) args.push("--permission", permission)
    args.push(`computer-use QA: ${name}`)
    const run = spawnSync(senpiBin, args, {
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
      encoding: "utf8",
      timeout: 90_000,
    })
    const results = toolResults(sandbox.agentDir)
    const methods = auditMethods(sandbox.root)
    const toolsFile = join(sandbox.cwd, "mock-tools.jsonl")
    const declaredTools = existsSync(toolsFile) ? jsonLines(toolsFile) : []
    if (evidenceDir !== undefined) {
      writeFileSync(
        join(evidenceDir, `${name}.json`),
        `${JSON.stringify({ exit: run.status, stdout: run.stdout, stderr: run.stderr.slice(-4000), results, methods, declaredTools }, null, 2)}\n`,
      )
    }
    return { exit: run.status, results, methods, declaredTools, stderr: run.stderr }
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
}

const screenshotChain = { action: "call", chain: [{ method: "screenshot" }] }
// Coordinate input is bound to the last capture of its target, so the click runs after a screenshot; a
// multi-step sequence is `run` code (a `chain` is one fluent call on a window or element).
const clickChain = { action: "run", code: "await desktop.screenshot(); await desktop.click(5, 5); return 'clicked'" }

const scenarios = [
  {
    name: "read-allowed-under-exec-deny",
    permission: "computer:exec=deny",
    steps: [
      { type: "tool_call", name: "computer", arguments: screenshotChain },
      { type: "text", text: "done" },
    ],
    verify: ({ results, methods }) => [
      ["the screenshot call succeeded", results.find((r) => r.toolName === "computer")?.isError === false],
      ["the result carries a captured frame", resultText(results.find((r) => r.toolName === "computer")).includes('"frameId"')],
      ["nothing mutating was audited", methods.length === 0],
    ],
  },
  {
    name: "exec-denied",
    permission: "computer:exec=deny",
    steps: [
      { type: "tool_call", name: "computer", arguments: clickChain },
      { type: "text", text: "done" },
    ],
    verify: ({ results, methods }) => [
      ["the click call was refused", results.find((r) => r.toolName === "computer")?.isError === true],
      ["by the permission rule, not the stop path", !resultText(results.find((r) => r.toolName === "computer")).includes("StopPathUnavailable")],
      ["no click reached the engine", !methods.includes("click")],
    ],
  },
  {
    name: "exec-allowed",
    permission: undefined,
    steps: [
      { type: "tool_call", name: "computer", arguments: clickChain },
      { type: "text", text: "done" },
    ],
    verify: ({ results, methods }) => [
      ["the click call succeeded", results.find((r) => r.toolName === "computer")?.isError === false],
      ["the click reached the engine", methods.includes("click")],
    ],
  },
  {
    name: "kernel-prelude-after-activation",
    permission: undefined,
    steps: [
      { type: "tool_call", name: "computer", arguments: screenshotChain },
      { type: "tool_call", name: "eval", arguments: { language: "js", code: "return typeof computer", summary: "probe" } },
      { type: "text", text: "done" },
    ],
    verify: ({ results }) => [
      ["eval sees the computer global", resultText(results.find((r) => r.toolName === "eval")).includes("object")],
    ],
  },
  {
    // Discovery the way a model reaches a deferred tool: search the catalog, then call the match by name.
    name: "tool-search-discovers-computer",
    permission: undefined,
    steps: [
      { type: "tool_call", name: "tool_search", arguments: { query: "control the desktop: screenshot, click and type in apps" } },
      { type: "tool_call", name: "computer", arguments: screenshotChain },
      { type: "tool_call", name: "eval", arguments: { language: "js", code: "return typeof computer", summary: "probe" } },
      { type: "text", text: "done" },
    ],
    verify: ({ results }) => [
      ["tool_search returns computer", resultText(results.find((r) => r.toolName === "tool_search")).includes("computer")],
      ["the searched tool runs by name", results.find((r) => r.toolName === "computer")?.isError === false],
      ["eval then sees the computer global", resultText(results.find((r) => r.toolName === "eval")).includes("object")],
    ],
  },
  {
    // Providers without native deferred-tool search reach a tool only once it is active (#9048).
    name: "cua-adapter-activates-computer-actions",
    permission: undefined,
    computer: { cua_adapter: true },
    steps: [
      { type: "tool_call", name: "computer", arguments: screenshotChain },
      { type: "tool_call", name: "computer_actions", arguments: { action: "screenshot" } },
      { type: "text", text: "done" },
    ],
    verify: ({ results, declaredTools }) => [
      ["computer_actions is not declared before activation", declaredTools[0]?.includes("computer_actions") === false],
      ["activation declares computer_actions on the next request", declaredTools[1]?.includes("computer_actions") === true],
      ["the computer_actions call succeeded", results.find((r) => r.toolName === "computer_actions")?.isError === false],
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
const report = scenarios.map((scenario) => {
  const outcome = runScenario(scenario)
  const checks = scenario.verify(outcome).map(([check, ok]) => ({ check, ok }))
  return { scenario: scenario.name, exit: outcome.exit, checks }
})
const realStateUntouched = protectedFiles.map(fileDigest).every((digest, index) => digest === before[index])
const passed = realStateUntouched && report.every(({ exit, checks }) => exit === 0 && checks.every(({ ok }) => ok))
console.log(JSON.stringify({ verdict: passed ? "PASS" : "FAIL", senpiBin, enginePath, realStateUntouched, report }, null, 2))
process.exit(passed ? 0 : 1)
