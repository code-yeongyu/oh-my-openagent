#!/usr/bin/env node
// Live driver for the OpenAI lane policy (#8300). It spawns a real senpi run per scenario in a
// throwaway sandbox (own HOME, agent dir, XDG config, session dir) whose ONLY OpenAI models come
// from task-openai-lane-mock-provider.ts, delegates one task(category) child, and reads the model
// the child was actually resolved to out of the task store. What it proves: the metered `openai`
// API-key lane is never preferred over the `openai-codex` ChatGPT subscription lane when both serve
// the same model, and an API-key-only registry still resolves through the resolver's cross-provider
// fallthrough instead of failing. Set OMO_OPENAI_LANE_EXPECT_BOTH to point the same driver at a
// pre-fix tree and capture the RED (`openai/gpt-6-astra`).
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { createSandbox, credentialDigest, seedSandbox } from "./drive.mjs"
import { parseJsonEvents } from "./task-e2e-analysis.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const providerEntry = join(scriptDir, "task-openai-lane-mock-provider.ts")
const finalText = "omo e2e openai lane child final text"
const laneModelId = "gpt-6-astra"
const realAgentDir = join(homedir(), ".senpi", "agent")
const category = process.env.OMO_OPENAI_LANE_CATEGORY?.trim() || "deep"

// Expected child model per scenario. The mock registers exactly the lanes named by the scenario,
// so the recorded model is the lane that won the resolution.
function expectedModels(env = process.env) {
  return {
    "both-lanes": env.OMO_OPENAI_LANE_EXPECT_BOTH?.trim() || `openai-codex/${laneModelId}`,
    "api-key-only": `openai/${laneModelId}`,
    "codex-only": `openai-codex/${laneModelId}`,
  }
}

function selectedScenarios(env = process.env) {
  const expected = expectedModels(env)
  const all = Object.keys(expected)
  const requested = (env.OMO_OPENAI_LANE_SCENARIOS ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
  const names = requested.length === 0 ? all : requested.filter((name) => all.includes(name))
  return names.map((name) => ({ name, expectedModel: expected[name] }))
}

// An omo/senpi session exports its own runtime locators; a child senpi that inherits them boots
// against that runtime dir (and that session file) instead of the binary under test, so they are
// dropped from the spawn env - the same scrub model-profile-e2e.mjs performs.
const INHERITED_RUNTIME_KEYS = ["SENPI_PACKAGE_DIR", "OMO_PACKAGE_DIR", "PI_PACKAGE_DIR", "OMO_BIN", "PI_SESSION_FILE"]

function spawnEnv(sandbox, sessionDir, homeDir, scenario) {
  const env = { ...process.env }
  for (const key of INHERITED_RUNTIME_KEYS) delete env[key]
  return {
    ...env,
    HOME: homeDir,
    SENPI_CODING_AGENT_DIR: sandbox.agentDir,
    XDG_CONFIG_HOME: sandbox.xdgConfigHome,
    SENPI_CODING_AGENT_SESSION_DIR: sessionDir,
    OMO_SENPI_QA: "1",
    OMO_OPENAI_LANE_SCENARIO: scenario.name,
    OMO_OPENAI_LANE_CATEGORY: category,
  }
}

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
    // No category overrides: the builtin chain and the resolver alone must pick the lane.
    writeFileSync(join(omoDir, "omo.json"), `${JSON.stringify({}, null, 2)}\n`)
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
        "omo-openai-lane-mock",
        "--model",
        "parent",
        "--session-dir",
        sessionDir,
        "delegate the openai lane probe task and report its result",
      ],
      {
        cwd: sandbox.cwd,
        env: spawnEnv(sandbox, sessionDir, homeDir, scenario),
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
  const actualModel = artifacts.task?.model
  const checks = {
    exit_zero: runResult?.status === 0 ? "PASS" : "FAIL",
    final_text: stdoutText.includes(finalText) ? "PASS" : "FAIL",
    resolved_model: actualModel === scenario.expectedModel ? "PASS" : "FAIL",
    real_credentials_untouched: afterCredentials === beforeCredentials ? "PASS" : "FAIL",
    cleanup,
  }
  const result = Object.values(checks).every((value) => value === "PASS") ? "PASS" : "FAIL"
  const verdict = {
    result,
    scenario: scenario.name,
    category,
    expected_model: scenario.expectedModel,
    actual_model: actualModel ?? null,
    checks,
    task_id: artifacts.task?.task_id,
    credential_digest_before: beforeCredentials,
    credential_digest_after: afterCredentials,
  }
  writeFileSync(join(scenarioOutDir, "verdict.json"), `${JSON.stringify(verdict, null, 2)}\n`)
  return verdict
}

function run() {
  const outDir = resolve(process.env.TASK_OPENAI_LANE_OUT_DIR ?? join(process.cwd(), ".omo", "evidence", "task-openai-lane"))
  mkdirSync(outDir, { recursive: true })
  const verdicts = selectedScenarios().map((scenario) => runScenario(scenario, outDir))
  const result = verdicts.length > 0 && verdicts.every((verdict) => verdict.result === "PASS") ? "PASS" : "FAIL"
  const summary = { result, category, scenarios: verdicts }
  writeFileSync(join(outDir, "verdict.json"), `${JSON.stringify(summary, null, 2)}\n`)
  console.log(JSON.stringify(summary))
  if (result !== "PASS") process.exitCode = 1
}

function selfTest() {
  const parsed = parseJsonEvents(`${JSON.stringify({ type: "text", text: finalText })}\n`)
  if (!JSON.stringify(parsed).includes(finalText)) throw new Error("event parser did not preserve final text")
  const expected = expectedModels({})
  if (expected["both-lanes"] !== `openai-codex/${laneModelId}`) throw new Error("both-lanes must expect the subscription lane")
  if (expected["api-key-only"] !== `openai/${laneModelId}`) throw new Error("api-key-only must expect the API lane")
  if (expected["codex-only"] !== `openai-codex/${laneModelId}`) throw new Error("codex-only must expect the subscription lane")
  const overridden = expectedModels({ OMO_OPENAI_LANE_EXPECT_BOTH: `openai/${laneModelId}` })
  if (overridden["both-lanes"] !== `openai/${laneModelId}`) throw new Error("pre-fix RED expectation override ignored")
  const scenarios = selectedScenarios({})
  if (scenarios.length !== 3) throw new Error("default run must cover all three lane scenarios")
  if (scenarios.some((scenario) => typeof scenario.expectedModel !== "string")) throw new Error("every scenario needs an expected model")
  const narrowed = selectedScenarios({ OMO_OPENAI_LANE_SCENARIOS: "codex-only, nope" })
  if (JSON.stringify(narrowed.map((scenario) => scenario.name)) !== JSON.stringify(["codex-only"])) {
    throw new Error("scenario narrowing must keep known names only")
  }
  const env = spawnEnv({ agentDir: "/tmp/a", xdgConfigHome: "/tmp/x" }, "/tmp/s", "/tmp/h", { name: "both-lanes" })
  if (INHERITED_RUNTIME_KEYS.some((key) => key in env)) throw new Error("inherited runtime locators must be scrubbed from the spawn env")
  if (env.HOME !== "/tmp/h" || env.SENPI_CODING_AGENT_DIR !== "/tmp/a" || env.OMO_OPENAI_LANE_SCENARIO !== "both-lanes") {
    throw new Error("spawn env lost its sandbox isolation")
  }
  console.log("SELF-TEST OK")
}

if (process.argv.includes("--self-test")) selfTest()
else run()
