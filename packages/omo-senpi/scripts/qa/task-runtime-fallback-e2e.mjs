#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process"
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { createHash } from "node:crypto"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { createSandbox, credentialDigest, seedSandbox } from "./drive.mjs"
import { parseJsonEvents } from "./task-e2e-analysis.mjs"
import { isolatedChildEnv, sandboxStateDir } from "./sandbox-child-env.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const providerEntry = join(scriptDir, "task-runtime-fallback-mock-provider.ts")
const pluginRoot = resolve(scriptDir, "..", "..", "plugin")
const finalText = "omo e2e fallback child final text"
const realAgentDir = join(homedir(), ".senpi", "agent")
const daemonMockProviderName = "omo-qa-runtime-fallback-mock-provider.ts"

// Every runner a task child can run on; each scenario runs once per runner. The mock provider
// reaches each child the way a real provider extension would: an in-process child shares the
// parent's registry, a per-child process inherits the parent's `-e` entry, and a session of the
// task daemon gets it from the daemon's launch spec (the daemon loads extensions from nothing
// else), so the host runner uses a sandbox copy of the plugin whose spec lists the mock provider.
// `runner` is read back from the task record so a silent fallback to another runner fails.
// Where the hop happens depends on the runner: an in-process child switches models inside its own
// session (`retry_fallback_applied`), while a process child's failed turn is handed to the next
// model by the task manager (`task_model_fallback`). Either one is the fallback record.
const fallbackRecorded = (log) =>
  log.includes("retry_fallback_applied") || log.includes("task_model_fallback") ? "PASS" : "FAIL"
const runners = [
  {
    name: "in-process",
    task: { default_execution_mode: "in-process" },
    runner: (task) => task?.execution_mode === "in-process" ? "PASS" : "FAIL",
  },
  {
    name: "child-process",
    task: { default_execution_mode: "process", process_runner: "child-process" },
    runner: (task) => task?.execution_mode === "process" && task?.runner_kind !== "host-session" ? "PASS" : "FAIL",
  },
  {
    name: "host-session",
    task: { default_execution_mode: "process", process_runner: "host" },
    daemon: true,
    runner: (task) => task?.execution_mode === "process" && task?.runner_kind === "host-session" ? "PASS" : "FAIL",
  },
]

// Scenario fixtures. The mock provider (task-runtime-fallback-mock-provider.ts) reads
// OMO_FALLBACK_SCENARIO to decide which category the parent spawns and which child models die.
// - user-fallback: custom category with user fallback_models (dead primary -> healthy fallback).
// - builtin-chain-fallback: builtin "quick" with rung-1 (chatgpt-subscription/gpt-6-luna-fast)
//   dead and rung-2 (deepseek/deepseek-flash) healthy; NO user fallback_models, so the runtime
//   chain must come from the builtin category chain itself.
// - chain-exhausted: every available "quick" rung dies; the task must record
//   retry_fallback_exhausted and end in error without crashing or hanging.
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
      fallback_event: fallbackRecorded(artifacts.log),
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
      fallback_event: fallbackRecorded(artifacts.log),
      final_model: artifacts.task?.model === "deepseek/deepseek-flash" ? "PASS" : "FAIL",
      requested_model: artifacts.task?.requested_model?.display === "chatgpt-subscription/gpt-6-luna-fast"
        ? "PASS"
        : "FAIL",
      fallback_attempts: JSON.stringify(
        artifacts.task?.fallback_attempts?.map((model) => `${model.provider}/${model.model_id}`),
      ) === JSON.stringify([
        "chatgpt-subscription/gpt-6-luna-fast",
        "deepseek/deepseek-flash",
      ]) ? "PASS" : "FAIL",
    }),
  },
  // Usage-limit scenarios (#8296): a visual-engineering-shaped chain, two rungs on one account and a
  // third on another provider. An account-wide limit must reach the other provider without spending
  // the same-account sibling; a limit that names one model must continue on that sibling.
  ...[
    // An in-process child hops inside senpi's own retry-fallback, which orders the spent account's
    // sibling last only from senpi#2319 on; the task manager owns the hop on the process runners.
    {
      name: "limit-account",
      finalModel: "omo-fallback-other/limit-kimi",
      attempts: ["omo-fallback-mock/limit-fable", "omo-fallback-other/limit-kimi"],
      senpiOwnedAttempts: [
        ["omo-fallback-mock/limit-fable", "omo-fallback-other/limit-kimi"],
        ["omo-fallback-mock/limit-fable", "omo-fallback-mock/limit-opus", "omo-fallback-other/limit-kimi"],
      ],
    },
    { name: "limit-model", finalModel: "omo-fallback-mock/limit-opus", attempts: ["omo-fallback-mock/limit-fable", "omo-fallback-mock/limit-opus"] },
  ].map((limit) => ({
    name: limit.name,
    omoConfig: {
      categories: {
        limitcat: {
          model: "omo-fallback-mock/limit-fable",
          fallback_models: ["omo-fallback-mock/limit-opus", "omo-fallback-other/limit-kimi"],
        },
      },
    },
    checks: (artifacts, stdoutText) => {
      const attempts = JSON.stringify(artifacts.task?.fallback_attempts?.map((model) => `${model.provider}/${model.model_id}`))
      const accepted = artifacts.task?.execution_mode === "in-process" && limit.senpiOwnedAttempts !== undefined
        ? limit.senpiOwnedAttempts
        : [limit.attempts]
      return {
        final_text: stdoutText.includes(finalText) ? "PASS" : "FAIL",
        fallback_event: fallbackRecorded(artifacts.log),
        final_model: artifacts.task?.model === limit.finalModel ? "PASS" : "FAIL",
        fallback_attempts: accepted.some((expected) => JSON.stringify(expected) === attempts) ? "PASS" : "FAIL",
      }
    },
  })),
  // #9512: the child's primary makes a tool call, then hits a usage limit inside the same turn. A
  // host-session child carries its own chain on open_session (retry_fallback_profile), so the hop
  // happens inside the session; the user's settings file must not be touched by it.
  {
    name: "limit-after-tool",
    omoConfig: {
      categories: {
        toolcat: {
          model: "omo-fallback-mock/limit-after-tool",
          fallback_models: ["omo-fallback-mock/healthy-fallback"],
        },
      },
    },
    checks: (artifacts, stdoutText, runner) => ({
      final_text: stdoutText.includes(finalText) ? "PASS" : "FAIL",
      fallback_event: fallbackRecorded(artifacts.log),
      // The task event log records each finished tool call as `tool_execution`; the in-session hop must come
      // after it. Only a host-session child carries its own chain (retry_fallback_profile, #9512); a per-child
      // process cannot receive one, so its manager-level fallback is a different path and is not judged here.
      tool_ran_before_limit: runner.name !== "host-session"
        ? "N/A"
        : /"type":"tool_execution","payload":\{"tool":"bash"/.test(artifacts.log) ? "PASS" : "FAIL",
      settings_byte_identical: artifacts.settingsBefore !== undefined && artifacts.settingsBefore === artifacts.settingsAfter
        ? "PASS"
        : "FAIL",
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

// The sandbox's own copy of the plugin, with the mock provider listed in its daemon launch spec.
// Settings point the parent at the copy, so the daemon it ensures resolves this spec; the repo's
// plugin and any real install stay untouched.
function seedDaemonPlugin(sandbox) {
  const sandboxPlugin = join(sandbox.root, "plugin")
  cpSync(pluginRoot, sandboxPlugin, { recursive: true })
  copyFileSync(providerEntry, join(sandboxPlugin, daemonMockProviderName))
  const specPath = join(sandboxPlugin, "daemon-launch-spec.json")
  const spec = JSON.parse(readFileSync(specPath, "utf8"))
  spec.core.extensions.push(`./${daemonMockProviderName}`)
  writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`)
  chmodSync(specPath, 0o600)
  const settingsPath = join(sandbox.agentDir, "settings.json")
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"))
  writeFileSync(settingsPath, `${JSON.stringify({ ...settings, packages: [sandboxPlugin] }, null, 2)}\n`)
}

// The user's settings file as the parent and every child see it; a per-session fallback chain must
// never be written there.
function settingsDigest(sandbox) {
  const path = join(sandbox.agentDir, "settings.json")
  return existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : undefined
}

function sandboxProcesses(sandbox) {
  const table = execFileSync("ps", ["-axo", "pid=,args="], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
  return table.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line)
    return match !== null && match[2].includes(sandbox.root) ? [Number(match[1])] : []
  })
}

function descendants(pid) {
  const result = spawnSync("pgrep", ["-P", String(pid)], { encoding: "utf8" })
  const direct = (result.stdout ?? "").split("\n").filter(Boolean).map(Number)
  return direct.flatMap((child) => [child, ...descendants(child)])
}

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function signal(pids, name) {
  for (const pid of pids) {
    try {
      process.kill(pid, name)
    } catch {
      continue
    }
  }
}

// The daemon a host-session run ensured outlives the parent (it idles out after minutes). Its argv
// names the sandbox plugin, so it and its process tree are stopped before the sandbox is removed;
// the receipt fails when anything naming the sandbox, or any stopped pid, survives. Process exit of
// a non-child pid has no event to await, so the grace period is a bounded liveness re-check.
async function stopSandboxProcesses(sandbox) {
  const found = sandboxProcesses(sandbox)
  const owned = [...new Set(found.flatMap((pid) => [pid, ...descendants(pid)]))]
  signal(owned, "SIGTERM")
  const deadline = Date.now() + 10_000
  while (owned.some(alive) && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 200))
  }
  signal(owned.filter(alive), "SIGKILL")
  return { stopped: owned, survivors: [...sandboxProcesses(sandbox), ...owned.filter(alive)] }
}

async function runScenario(scenario, runner, outDir) {
  const scenarioOutDir = join(outDir, runner.name, scenario.name)
  mkdirSync(scenarioOutDir, { recursive: true })
  const sandbox = createSandbox()
  const beforeCredentials = credentialDigest(realAgentDir)
  let afterCredentials = beforeCredentials
  let cleanup = "FAIL"
  let processes = { stopped: [], survivors: [] }
  let runResult
  let artifacts = { task: undefined, log: "" }
  let settingsBefore
  let settingsAfter
  try {
    seedSandbox(sandbox)
    if (runner.daemon === true) seedDaemonPlugin(sandbox)
    const omoDir = join(sandbox.cwd, ".omo")
    mkdirSync(omoDir, { recursive: true })
    const omoConfig = { ...scenario.omoConfig, task: runner.task }
    writeFileSync(join(omoDir, "omo.json"), `${JSON.stringify(omoConfig, null, 2)}\n`)
    const sessionDir = join(sandbox.root, "sessions")
    mkdirSync(sessionDir, { recursive: true })
    // HOME-based user config (~/.omo/config.jsonc) would otherwise leak the developer's real
    // category overrides into the fixture and hijack builtin category resolution.
    const homeDir = join(sandbox.root, "home")
    mkdirSync(homeDir, { recursive: true })
    settingsBefore = settingsDigest(sandbox)
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
          ...isolatedChildEnv(process.env, sandbox.agentDir),
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
    settingsAfter = settingsDigest(sandbox)
    artifacts = { ...readTaskArtifacts(sandboxStateDir(sandbox)), settingsBefore, settingsAfter }
  } finally {
    writeFileSync(join(scenarioOutDir, "stdout.json.log"), runResult?.stdout ?? "")
    writeFileSync(join(scenarioOutDir, "stderr.log"), runResult?.stderr ?? "")
    writeFileSync(join(scenarioOutDir, "task.json"), `${JSON.stringify(artifacts.task ?? {}, null, 2)}\n`)
    writeFileSync(join(scenarioOutDir, "task.jsonl.log"), artifacts.log)
    processes = await stopSandboxProcesses(sandbox)
    rmSync(sandbox.root, { recursive: true, force: true })
    cleanup = existsSync(sandbox.root) || processes.survivors.length > 0 ? "FAIL" : "PASS"
  }

  const events = parseJsonEvents(runResult?.stdout ?? "")
  const stdoutText = JSON.stringify(events)
  afterCredentials = credentialDigest(realAgentDir)
  const checks = {
    exit_zero: runResult?.status === 0 ? "PASS" : "FAIL",
    runner: runner.runner(artifacts.task),
    ...scenario.checks(artifacts, stdoutText, runner),
    real_credentials_untouched: afterCredentials === beforeCredentials ? "PASS" : "FAIL",
    cleanup,
  }
  const result = Object.values(checks).every((value) => value === "PASS" || value === "N/A") ? "PASS" : "FAIL"
  const verdict = {
    result,
    runner: runner.name,
    scenario: scenario.name,
    checks,
    task_id: artifacts.task?.task_id,
    execution_mode: artifacts.task?.execution_mode,
    runner_kind: artifacts.task?.runner_kind,
    stopped_sandbox_processes: processes.stopped,
    credential_digest_before: beforeCredentials,
    credential_digest_after: afterCredentials,
  }
  writeFileSync(join(scenarioOutDir, "verdict.json"), `${JSON.stringify(verdict, null, 2)}\n`)
  return verdict
}

async function run() {
  const outDir = resolve(process.env.TASK_RUNTIME_FALLBACK_OUT_DIR ?? join(process.cwd(), ".omo", "evidence", "task-runtime-fallback"))
  mkdirSync(outDir, { recursive: true })
  const pick = (variable, entries, label) => {
    const names = process.env[variable]?.split(",").map((name) => name.trim()).filter(Boolean)
    const unknown = names?.filter((name) => !entries.some((entry) => entry.name === name)) ?? []
    if (unknown.length > 0) throw new Error(`unknown ${label}(s): ${unknown.join(", ")}`)
    return entries.filter((entry) => names === undefined || names.includes(entry.name))
  }
  const verdicts = []
  for (const runner of pick("TASK_RUNTIME_FALLBACK_RUNNERS", runners, "runner")) {
    for (const scenario of pick("TASK_RUNTIME_FALLBACK_SCENARIOS", scenarios, "scenario")) {
      verdicts.push(await runScenario(scenario, runner, outDir))
    }
  }
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
else await run()
