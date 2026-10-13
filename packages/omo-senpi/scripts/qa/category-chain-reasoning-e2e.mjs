#!/usr/bin/env node
// Live QA for a category chain that runs ONE model at two thinking levels. Drives the REAL senpi
// binary with the built plugin in two sandboxes:
//
//   keep  - the child answers on the first request, so the task record still holds the chain the
//           plugin built. A chain that drops a rung whose model id repeats shows up here as a
//           missing same-model rung.
//   retry - the mock fails the child's first request, so senpi's retry-fallback controller walks the
//           chain. This is where the level the child actually runs at is observable.
//
// The lane asserts only what this repository owns: which rungs the plugin keeps, and which thinking
// level the child's head request carries. Where senpi's controller walks next is recorded as an
// observation, not a check - its candidate scan deliberately skips a chain entry whose model equals
// the current model (retry-fallback/candidates.js "self"), which is outside this package.
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createSandbox, digestDirectory, seedSandbox } from "./drive.mjs"
import { changedRealPaths, classifyRealSenpiChanges, snapshotDir } from "./task-e2e-analysis.mjs"
import { isolatedChildEnv, sandboxStateDir } from "./sandbox-child-env.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const mockProviderEntry = join(scriptDir, "category-chain-reasoning-mock-provider.ts")
const realSenpiAgentDir = join(homedir(), ".senpi", "agent")
const REQUEST_LOG = "chain-requests.jsonl"
const CHILD_ANSWER = "chain child answered"
const CATEGORY = "chaincat"
const HEAD_MODEL = "mock-1"
const SECOND_MODEL = "mock-2"
const HEAD_THINKING = "high"
const RETRY_THINKING = "off"

const OMO_CONFIG = {
  task: { default_execution_mode: "in-process" },
  categories: {
    [CATEGORY]: {
      description: "Chain QA category: one model at two thinking levels, then a second model.",
      models: [
        { model: `omo-mock/${HEAD_MODEL}`, reasoning: HEAD_THINKING },
        { model: `omo-mock/${HEAD_MODEL}`, reasoning: RETRY_THINKING },
        { model: `omo-mock/${SECOND_MODEL}` },
      ],
    },
  },
}

function laneScript(failChildHeadRequests) {
  return {
    models: [HEAD_MODEL, SECOND_MODEL],
    failChildHeadRequests,
    parentSteps: [
      {
        type: "tool_call",
        name: "task",
        arguments: { category: CATEGORY, prompt: "answer the chain unit", name: "chainchild" },
      },
      { type: "text", text: "parent turn done" },
    ],
    childSteps: [{ type: "text", text: CHILD_ANSWER }],
  }
}

function findOnPath(bin) {
  if (bin.includes("/")) return existsSync(bin) ? bin : null
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = resolve(dir || ".", bin)
    if (existsSync(candidate)) return candidate
  }
  return null
}

function seedScenario(failChildHeadRequests) {
  const sandbox = createSandbox()
  seedSandbox(sandbox)
  const sessionDir = join(sandbox.root, "sessions")
  mkdirSync(sessionDir, { recursive: true })
  const settings = JSON.parse(readFileSync(join(sandbox.agentDir, "settings.json"), "utf8"))
  settings.retry = { enabled: true, maxRetries: 2, baseDelayMs: 1, modelFallback: true }
  writeFileSync(join(sandbox.agentDir, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`)
  mkdirSync(join(sandbox.cwd, ".omo"), { recursive: true })
  writeFileSync(join(sandbox.cwd, ".omo", "omo.json"), `${JSON.stringify(OMO_CONFIG, null, 2)}\n`)
  writeFileSync(
    join(sandbox.cwd, "mock-script.json"),
    `${JSON.stringify(laneScript(failChildHeadRequests), null, 2)}\n`,
  )
  return { sandbox, sessionDir, stateDir: sandboxStateDir(sandbox) }
}

function driveSenpi(senpiBin, scenario) {
  return spawnSync(
    senpiBin,
    [
      "-e",
      mockProviderEntry,
      "-p",
      "--mode",
      "json",
      "--provider",
      "omo-mock",
      "--model",
      SECOND_MODEL,
      "--session-dir",
      scenario.sessionDir,
      "run the category chain unit",
    ],
    {
      cwd: scenario.sandbox.cwd,
      env: {
        ...isolatedChildEnv(process.env, scenario.sandbox.agentDir),
        XDG_CONFIG_HOME: scenario.sandbox.xdgConfigHome,
        SENPI_CODING_AGENT_SESSION_DIR: scenario.sessionDir,
        OMO_SENPI_QA: "1",
      },
      encoding: "utf8",
      timeout: 180_000,
      maxBuffer: 64 * 1024 * 1024,
    },
  )
}

function readRequests(cwd) {
  const path = join(cwd, REQUEST_LOG)
  if (!existsSync(path)) return []
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line))
}

function readTaskRecord(stateDir) {
  const tasksDir = join(stateDir, "tasks")
  if (!existsSync(tasksDir)) return undefined
  const entries = readdirSync(tasksDir).filter((entry) => entry.endsWith(".json"))
  if (entries.length === 0) return undefined
  return JSON.parse(readFileSync(join(tasksDir, entries[0]), "utf8"))
}

function rungLabel(rung) {
  const level = rung.reasoning ?? rung.reasoning_effort ?? rung.variant
  return level === undefined ? rung.display : `${rung.display}:${level}`
}

function runScenario(senpiBin, failChildHeadRequests) {
  const scenario = seedScenario(failChildHeadRequests)
  const run = driveSenpi(senpiBin, scenario)
  const requests = readRequests(scenario.sandbox.cwd)
  const record = readTaskRecord(scenario.stateDir)
  return {
    scenario,
    exit: run.status,
    stdout: run.stdout ?? "",
    stderrTail: (run.stderr ?? "").split("\n").slice(-12),
    childRequests: requests.filter((request) => request.isChild === true),
    record,
    fallbackRungs: (record?.fallback_models ?? []).map(rungLabel),
    attempts: (record?.fallback_attempts ?? []).map(rungLabel),
  }
}

async function main() {
  const outDir = process.env.CHAIN_QA_OUT_DIR?.trim()
  const beforeSnapshot = snapshotDir(realSenpiAgentDir)
  const beforeDigest = digestDirectory(realSenpiAgentDir)
  const providedAgentDir = process.env.SENPI_CODING_AGENT_DIR ? "IGNORED" : "unset"
  const senpiBin = findOnPath(process.env.SENPI_BIN?.trim() || "senpi")
  if (senpiBin === null) {
    console.log(JSON.stringify({ result: "SKIP", reason: "senpi-binary-unavailable", providedAgentDir }))
    return
  }

  const keep = runScenario(senpiBin, false)
  const retry = runScenario(senpiBin, true)
  const headRequest = retry.childRequests[0]

  const checks = {}
  checks.keep_child_completed =
    keep.exit === 0 && keep.stdout.includes(CHILD_ANSWER) ? "PASS" : "FAIL"
  checks.keep_chain_holds_second_level =
    keep.fallbackRungs.join(" | ") === `omo-mock/${HEAD_MODEL}:${RETRY_THINKING} | omo-mock/${SECOND_MODEL}`
      ? "PASS"
      : "FAIL"
  checks.retry_child_completed =
    retry.exit === 0 && retry.stdout.includes(CHILD_ANSWER) ? "PASS" : "FAIL"
  checks.retry_head_runs_selected_level = headRequest?.thinking === HEAD_THINKING ? "PASS" : "FAIL"

  const afterDigest = digestDirectory(realSenpiAgentDir)
  const allChangedRealPaths = changedRealPaths(beforeSnapshot, snapshotDir(realSenpiAgentDir))
  const sandboxTokens = [basename(keep.scenario.sandbox.root), basename(retry.scenario.sandbox.root)]
  const { qaAttributedPaths, concurrentSessionPaths } = classifyRealSenpiChanges(
    allChangedRealPaths,
    sandboxTokens,
  )
  const realSenpiUntouched = qaAttributedPaths.length === 0
  checks.real_senpi_untouched = realSenpiUntouched ? "PASS" : "FAIL"

  const values = Object.values(checks)
  const result = values.every((verdict) => verdict === "PASS") ? "PASS" : "FAIL"
  const payload = {
    result,
    checks,
    providedAgentDir,
    isolatedAgentDirs: [keep.scenario.sandbox.agentDir, retry.scenario.sandbox.agentDir],
    sandboxCwds: [keep.scenario.sandbox.cwd, retry.scenario.sandbox.cwd],
    sandboxTokens,
    keep: {
      exit: keep.exit,
      childRequests: keep.childRequests,
      resolvedModel: keep.record?.resolved_model ?? null,
      fallbackRungs: keep.fallbackRungs,
      taskId: keep.record?.task_id ?? null,
      stderrTail: keep.stderrTail,
    },
    retry: {
      exit: retry.exit,
      childRequests: retry.childRequests,
      resolvedModel: retry.record?.resolved_model ?? null,
      fallbackRungs: retry.fallbackRungs,
      attempts: retry.attempts,
      taskId: retry.record?.task_id ?? null,
      stderrTail: retry.stderrTail,
    },
    engineRetryObservation: {
      head: headRequest === undefined ? null : `omo-mock/${headRequest.model}:${headRequest.thinking ?? "none"}`,
      walkedTo: retry.childRequests[1] === undefined ? null : `omo-mock/${retry.childRequests[1].model}`,
      note: "senpi's candidate scan skips a chain entry whose model equals the current model, so a same-model rung is never walked; recorded, not asserted",
    },
    realSenpiUntouched,
    realSenpiChangedPaths: qaAttributedPaths,
    concurrentRealSenpiChangedPaths: concurrentSessionPaths,
    realSenpiDigestUnchanged: beforeDigest === afterDigest,
  }

  if (outDir !== undefined && outDir.length > 0) {
    const target = resolve(outDir)
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, "category-chain-reasoning.json"), `${JSON.stringify(payload, null, 2)}\n`)
    writeFileSync(join(target, "keep-stdout.json"), keep.stdout)
    writeFileSync(join(target, "retry-stdout.json"), retry.stdout)
  }
  console.log(JSON.stringify(payload, null, 2))
  if (result !== "PASS") process.exitCode = 1
}

await main()
