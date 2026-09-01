#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { createSandbox, credentialDigest, seedSandbox } from "./drive.mjs"
import { parseJsonEvents } from "./task-e2e-analysis.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const providerEntry = join(scriptDir, "task-runtime-fallback-mock-provider.ts")
const finalText = "omo e2e fallback child final text"
const realAgentDir = join(homedir(), ".senpi", "agent")

// Scenario fixtures. The mock provider (task-runtime-fallback-mock-provider.ts) reads
// OMO_FALLBACK_SCENARIO to decide which category the parent spawns and which child models die.
// - user-fallback: custom category with user fallback_models (dead primary -> healthy fallback).
// - builtin-chain-fallback: builtin "quick" with rung-1 (kimi-coding) dead and rung-2
//   (openai-codex) healthy; NO user fallback_models, so the runtime chain must come from the
//   builtin category chain itself.
// - chain-exhausted: every available "quick" rung dies; the session must record
//   retry_fallback_exhausted without crashing or hanging.
const scenarios = [
  {
    name: "user-fallback",
    omoConfig: {
      categories: {
        fallbackcat: {
          model: "omo-fallback-mock/dead-primary",
          fallback_models: ["omo-fallback-mock/healthy-fallback"],
        },
      },
    },
    checks: (artifacts, stdoutText) => ({
      final_text: stdoutText.includes(finalText) ? "PASS" : "FAIL",
      fallback_event: artifacts.log.includes("retry_fallback_applied") ? "PASS" : "FAIL",
      final_model: artifacts.task?.model === "omo-fallback-mock/healthy-fallback" ? "PASS" : "FAIL",
      fallback_attempts: JSON.stringify(
        artifacts.task?.fallback_attempts?.map((model) => `${model.provider}/${model.model_id}`),
      ) === JSON.stringify([
        "omo-fallback-mock/dead-primary",
        "omo-fallback-mock/healthy-fallback",
      ]) ? "PASS" : "FAIL",
    }),
  },
  {
    name: "builtin-chain-fallback",
    omoConfig: {},
    checks: (artifacts, stdoutText) => ({
      final_text: stdoutText.includes(finalText) ? "PASS" : "FAIL",
      fallback_event: artifacts.log.includes("retry_fallback_applied") ? "PASS" : "FAIL",
      final_model: artifacts.task?.model === "openai-codex/gpt-5.6-luna-fast" ? "PASS" : "FAIL",
      requested_model: artifacts.task?.requested_model?.display === "kimi-coding/kimi-for-coding-highspeed"
        ? "PASS"
        : "FAIL",
      fallback_attempts: JSON.stringify(
        artifacts.task?.fallback_attempts?.map((model) => `${model.provider}/${model.model_id}`),
      ) === JSON.stringify([
        "kimi-coding/kimi-for-coding-highspeed",
        "openai-codex/gpt-5.6-luna-fast",
      ]) ? "PASS" : "FAIL",
    }),
  },
  {
    name: "chain-exhausted",
    omoConfig: {},
    checks: (artifacts) => ({
      exhausted_event: artifacts.log.includes("retry_fallback_exhausted") ? "PASS" : "FAIL",
      task_failed: artifacts.task?.status === "error" ? "PASS" : "FAIL",
    }),
  },
]

function readTaskArtifacts(stateDir) {
  const tasksDir = join(stateDir, "tasks")
  const names = existsSync(tasksDir)
    ? readdirSync(tasksDir).filter((name) => name.endsWith(".json"))
    : []
  const taskFile = names[0] === undefined ? undefined : join(tasksDir, names[0])
  const task = taskFile === undefined ? undefined : JSON.parse(readFileSync(taskFile, "utf8"))
  const logFile = task === undefined ? undefined : join(stateDir, "logs", `${task.task_id}.jsonl`)
  const log = logFile !== undefined && existsSync(logFile) ? readFileSync(logFile, "utf8") : ""
  return { task, log }
}

function runScenario(scenario, outDir) {
  const scenarioOutDir = join(outDir, scenario.name)
  mkdirSync(scenarioOutDir, { recursive: true })
  const sandbox = createSandbox()
  const beforeCredentials = credentialDigest(realAgentDir)
  let afterCredentials = beforeCredentials
  let cleanup = "FAIL"
  let runResult
  let artifacts = { task: undefined, log: "" }
  try {
    seedSandbox(sandbox)
    const omoDir = join(sandbox.cwd, ".omo")
    mkdirSync(omoDir, { recursive: true })
    writeFileSync(join(omoDir, "omo.json"), `${JSON.stringify(scenario.omoConfig, null, 2)}\n`)
    const sessionDir = join(sandbox.root, "sessions")
    mkdirSync(sessionDir, { recursive: true })
    // HOME-based user config (~/.omo/config.jsonc) would otherwise leak the developer's real
    // category overrides into the fixture and hijack builtin category resolution.
    const homeDir = join(sandbox.root, "home")
    mkdirSync(homeDir, { recursive: true })
    runResult = spawnSync(
      process.env.SENPI_BIN?.trim() || "senpi",
      [
        "-e",
        providerEntry,
        "-p",
        "--mode",
        "json",
        "--provider",
        "omo-fallback-mock",
        "--model",
        "parent",
        "--session-dir",
        sessionDir,
        "run the fallback category task and report its result",
      ],
      {
        cwd: sandbox.cwd,
        env: {
          ...process.env,
          HOME: homeDir,
          SENPI_CODING_AGENT_DIR: sandbox.agentDir,
          XDG_CONFIG_HOME: sandbox.xdgConfigHome,
          SENPI_CODING_AGENT_SESSION_DIR: sessionDir,
          OMO_SENPI_QA: "1",
          OMO_FALLBACK_SCENARIO: scenario.name,
        },
        encoding: "utf8",
        timeout: 120_000,
        maxBuffer: 64 * 1024 * 1024,
      },
    )
    artifacts = readTaskArtifacts(join(sandbox.cwd, ".omo", "senpi-task"))
  } finally {
    writeFileSync(join(scenarioOutDir, "stdout.json.log"), runResult?.stdout ?? "")
    writeFileSync(join(scenarioOutDir, "stderr.log"), runResult?.stderr ?? "")
    writeFileSync(join(scenarioOutDir, "task.json"), `${JSON.stringify(artifacts.task ?? {}, null, 2)}\n`)
    writeFileSync(join(scenarioOutDir, "task.jsonl.log"), artifacts.log)
    rmSync(sandbox.root, { recursive: true, force: true })
    cleanup = existsSync(sandbox.root) ? "FAIL" : "PASS"
  }

  const events = parseJsonEvents(runResult?.stdout ?? "")
  const stdoutText = JSON.stringify(events)
  afterCredentials = credentialDigest(realAgentDir)
  const checks = {
    exit_zero: runResult?.status === 0 ? "PASS" : "FAIL",
    ...scenario.checks(artifacts, stdoutText),
    real_credentials_untouched: afterCredentials === beforeCredentials ? "PASS" : "FAIL",
    cleanup,
  }
  const result = Object.values(checks).every((value) => value === "PASS") ? "PASS" : "FAIL"
  const verdict = {
    result,
    scenario: scenario.name,
    checks,
    task_id: artifacts.task?.task_id,
    credential_digest_before: beforeCredentials,
    credential_digest_after: afterCredentials,
  }
  writeFileSync(join(scenarioOutDir, "verdict.json"), `${JSON.stringify(verdict, null, 2)}\n`)
  return verdict
}

function run() {
  const outDir = resolve(process.env.TASK_RUNTIME_FALLBACK_OUT_DIR ?? join(process.cwd(), ".omo", "evidence", "task-runtime-fallback"))
  mkdirSync(outDir, { recursive: true })
  const verdicts = scenarios.map((scenario) => runScenario(scenario, outDir))
  const result = verdicts.every((verdict) => verdict.result === "PASS") ? "PASS" : "FAIL"
  const summary = { result, scenarios: verdicts }
  writeFileSync(join(outDir, "verdict.json"), `${JSON.stringify(summary, null, 2)}\n`)
  console.log(JSON.stringify(summary))
  if (result !== "PASS") process.exitCode = 1
}

function selfTest() {
  const parsed = parseJsonEvents(`${JSON.stringify({ type: "text", text: finalText })}\n`)
  if (!JSON.stringify(parsed).includes(finalText)) throw new Error("event parser did not preserve final text")
  console.log("SELF-TEST OK")
}

if (process.argv.includes("--self-test")) selfTest()
else run()
