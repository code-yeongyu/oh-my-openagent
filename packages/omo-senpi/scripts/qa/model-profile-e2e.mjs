#!/usr/bin/env node
// Manual QA driver for model profiles (`model_profile` / `model_profiles` in omo.json): proves on a
// REAL senpi process with an isolated home that the profile component selects the main-session
// model through the SESSION-ONLY setter and never persists it.
//   node model-profile-e2e.mjs [--bundle <pluginDir>] [--scenario <name>]
// Scenarios (all run by default, each in its own throwaway sandbox):
//   daily-normal-opus / daily-heavy-fable / geeky-normal-sol-fast / geeky-heavy-astra
//                    each leaf's first rung + thinking level in the applied notice.
//   daily-normal-kimi / daily-normal-glm  later Daily · Normal rungs.
//   geeky-normal-nonfast-sol-omo-mock  gpt-6-sol medium via omo-mock model-id matching (not a github-copilot registration).
//   unset            empty omo.json applies Daily · Normal (kimi-k3 here).
//   empty-registry   Daily · Normal against only mock-1: unavailable, session keeps mock-1.
//   literal-pin      model_profile "anthropic/claude-opus-5": that model id is applied.
//   unknown-profile / capable-removed / deep-work-removed / simple-work-removed
//                    unknown-profile notice listing the four lane ids.
//   custom-profile   user model_profiles.night-shift applies its chain.
//   cli-model-wins   `--model` (provenance "cli") with an active lane: the CLI model survives.
//   lane-beats-recommended-models  senpi recommended-models first auto-switches to gpt-5.6-sol;
//                    Daily · Normal still wins with glm-5.3.
// Isolation: SENPI_CODING_AGENT_DIR + XDG_CONFIG_HOME point at a throwaway sandbox; the real
// ~/.senpi/agent credential files are digest-compared before/after and MUST stay identical.
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"

import { createSandbox } from "./drive.mjs"

const HOST_VOLATILE_SETTINGS_KEYS = ["workflow-skills", "tipsHistory", "skills"]

function isolationDigest(agentDir) {
  const hash = createHash("sha256")
  for (const name of ["auth.json", "models.json", "trust.json"]) {
    const path = join(agentDir, name)
    hash.update(name)
    hash.update("\0")
    hash.update(existsSync(path) ? readFileSync(path) : Buffer.from("absent"))
    hash.update("\0")
  }
  const settingsPath = join(agentDir, "settings.json")
  if (existsSync(settingsPath)) {
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"))
    for (const key of HOST_VOLATILE_SETTINGS_KEYS) delete settings[key]
    hash.update(JSON.stringify(settings))
  } else {
    hash.update("settings-absent")
  }
  return hash.digest("hex")
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(scriptDir, "..", "..")
const defaultPluginRoot = join(packageRoot, "plugin")
const mockProviderEntry = join(scriptDir, "model-profile-e2e-mock-provider.ts")
const realSenpiAgentDir = join(homedir(), ".senpi", "agent")

import { APPLIED_TYPE, UNKNOWN_TYPE, UNAVAILABLE_TYPE, PROFILE_TYPES, KNOWN_LANES, SCENARIOS } from "./model-profile-e2e-scenarios.mjs"

function parseArgs(argv) {
  const args = { bundle: defaultPluginRoot, scenarios: Object.keys(SCENARIOS) }
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i]
    const value = argv[i + 1]
    if (key === "--bundle") args.bundle = resolve(value)
    else if (key === "--scenario") {
      if (!(value in SCENARIOS)) throw new Error(`unknown scenario: ${value}`)
      args.scenarios = [value]
    } else throw new Error(`unknown argument: ${key}`)
  }
  return args
}

function findOnPath(bin) {
  if (bin.includes("/")) return existsSync(bin) ? bin : null
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = resolve(dir || ".", bin)
    if (existsSync(candidate)) return candidate
  }
  return null
}

// `--thinking` persists the chosen level for the CLI model; that write belongs to senpi, so a
// CLI scenario allows exactly those two per-model keys and nothing else.
function onlyCliThinkingPersisted(beforeJson, afterJson, modelKey, level) {
  if (afterJson === null) return true
  const before = JSON.parse(beforeJson)
  const after = JSON.parse(afterJson)
  const cliKeys = ["modelThinkingLevels", "modelLastOnThinkingLevels"]
  for (const key of cliKeys) {
    const value = after[key]
    if (value === undefined) continue
    if (JSON.stringify(value) !== JSON.stringify({ [modelKey]: level })) return false
    delete after[key]
  }
  return JSON.stringify(after) === JSON.stringify(before)
}

function seedScenario(pluginRoot, scenario) {
  const sandbox = createSandbox()
  mkdirSync(sandbox.cwd, { recursive: true })
  mkdirSync(sandbox.agentDir, { recursive: true })
  mkdirSync(sandbox.xdgConfigHome, { recursive: true })
  const settingsPath = join(sandbox.agentDir, "settings.json")
  const settings = { defaultProjectTrust: "ask", packages: [pluginRoot] }
  if (scenario.cliThinking !== undefined) settings.defaultThinkingLevel = scenario.cliThinking
  if (!("recommendedModels" in scenario)) settings.recommendedModels = ["mock-1"]
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)
  writeFileSync(join(sandbox.agentDir, "trust.json"), `${JSON.stringify({ [sandbox.canonicalCwd]: true }, null, 2)}\n`)
  const sessionDir = join(sandbox.root, "sessions")
  mkdirSync(sessionDir, { recursive: true })
  const omoDir = join(sandbox.cwd, ".omo")
  mkdirSync(omoDir, { recursive: true })
  writeFileSync(join(omoDir, "omo.json"), `${JSON.stringify(scenario.omoConfig, null, 2)}\n`)
  const script = {
    models: scenario.mockModels,
    parentSteps: [{ type: "text", text: "model profile scenario complete" }],
    childSteps: [{ type: "text", text: "unused" }],
  }
  writeFileSync(join(sandbox.cwd, "mock-script.json"), `${JSON.stringify(script, null, 2)}\n`)
  return { sandbox, sessionDir, settingsPath }
}

import { readSessionEntries, loadStreamCaptures, observeEngineThinking } from "./model-profile-e2e-observations.mjs"

// An omo/senpi session exports its own runtime locators; a child senpi that inherits them boots
// against that runtime dir instead of the binary on PATH, so they are dropped from the spawn env.
const INHERITED_RUNTIME_KEYS = ["SENPI_PACKAGE_DIR", "OMO_PACKAGE_DIR", "OMO_BIN", "PI_SESSION_FILE"]

function spawnEnv(sandbox, sessionDir, scenario) {
  const env = { ...process.env }
  for (const key of INHERITED_RUNTIME_KEYS) delete env[key]
  env.OMO_PROFILE_QA_PROVIDERS = (scenario.registerProviders ?? []).join(",")
  return {
    ...env,
    SENPI_CODING_AGENT_DIR: sandbox.agentDir,
    XDG_CONFIG_HOME: sandbox.xdgConfigHome,
    XDG_DATA_HOME: sandbox.xdgDataHome,
    XDG_CACHE_HOME: sandbox.xdgCacheHome,
    SENPI_CODING_AGENT_SESSION_DIR: sessionDir,
    OMO_SENPI_QA: "1",
  }
}


function runScenario(name, scenario, args, senpiBin) {
  const { sandbox, sessionDir, settingsPath } = seedScenario(args.bundle, scenario)
  const settingsBefore = sha256File(settingsPath)
  const settingsBeforeJson = readFileSync(settingsPath, "utf8")
  const modelArgs = scenario.cliModel === undefined ? [] : ["--provider", "omo-mock", "--model", scenario.cliModel]
  const thinkingArgs = scenario.cliThinking === undefined ? [] : ["--thinking", scenario.cliThinking]
  try {
    const spawnSenpi = (extraArgs, prompt) =>
      spawnSync(senpiBin, ["-e", mockProviderEntry, "-p", "--mode", "json", ...extraArgs, "--session-dir", sessionDir, prompt], {
        cwd: sandbox.cwd,
        env: spawnEnv(sandbox, sessionDir, scenario),
        encoding: "utf8",
        timeout: 120_000,
        maxBuffer: 64 * 1024 * 1024,
      })
    // A resume scenario first runs a turn on the CLI model, then continues that session with the
    // lane configured: the continued session must keep its own model and get no profile notice.
    const runs = [spawnSenpi([...modelArgs, ...thinkingArgs], "run the scripted scenario")]
    if (scenario.resumeRun === true) runs.push(spawnSenpi(["--continue"], "continue the scripted scenario"))
    const run = runs.at(-1)
    const settingsAfter = sha256File(settingsPath)
    const settingsAfterJson = settingsBefore === settingsAfter ? null : readFileSync(settingsPath, "utf8")
    const entries = readSessionEntries(sessionDir)
    const assistantMessages = entries
      .filter((entry) => entry.type === "message" && entry.message?.role === "assistant")
      .map((entry) => ({ provider: entry.message.provider, model: entry.message.model }))
    const profileNotices = entries
      .filter((entry) => entry.type === "custom_message" && PROFILE_TYPES.includes(entry.customType))
      .map((entry) => ({ customType: entry.customType, content: entry.content, details: entry.details ?? null }))
    const lastAssistant = assistantMessages.at(-1) ?? null

    const checks = {
      exit_zero: runs.every((each) => each.status === 0),
      turn_ran: run.stdout.includes("model profile scenario complete"),
      settings_json_unchanged:
        scenario.cliThinking === undefined
          ? settingsBefore === settingsAfter
          : onlyCliThinkingPersisted(settingsBeforeJson, settingsAfterJson, `omo-mock/${scenario.cliModel}`, scenario.cliThinking),
      turn_model: lastAssistant?.model === scenario.expect.model,
      notice:
        scenario.expect.notice === null
          ? profileNotices.length === 0
          : profileNotices.length === 1 && profileNotices[0].customType === scenario.expect.notice,
    }
    const provider = scenario.expect.provider ?? "omo-mock"
    const engine = observeEngineThinking(entries, loadStreamCaptures(sandbox.cwd))
    checks.stream_model = engine.captures.some((capture) => capture.model === scenario.expect.model)
    if (scenario.expect.notice === APPLIED_TYPE) {
      const applied = profileNotices[0]
      checks.notice_names_model = applied?.content.includes(`selected ${provider}/${scenario.expect.model}`) === true
      checks.applied_details = applied?.details?.model === `${provider}/${scenario.expect.model}`
      if (scenario.expect.thinking !== undefined) {
        checks.notice_names_thinking =
          applied?.content.includes(`${provider}/${scenario.expect.model} ${scenario.expect.thinking}`) === true
        checks.details_thinking = applied?.details?.reasoning === scenario.expect.thinking
      }
    }
    if (scenario.expect.label !== undefined) {
      checks.notice_names_lane = profileNotices[0]?.content.includes(scenario.expect.label) === true
    }
    if (scenario.expect.thinking !== undefined) {
      checks.engine_thinking = engine.fromCapture === scenario.expect.thinking
    }
    if (scenario.expect.thinkingAbsent !== undefined) {
      checks.engine_thinking_not_profile = engine.observed !== scenario.expect.thinkingAbsent
    }
    if (scenario.expect.provider !== undefined) {
      checks.stream_provider = engine.captures.some((capture) => capture.provider === scenario.expect.provider) === true
    }
    if (name === "daily-normal-kimi") {
      const applied = profileNotices[0]
      checks.notice_lists_skipped =
        applied?.content.includes("skipped: anthropic-subscription/claude-opus-5-5") === true
      checks.notice_mentions_retry_chains = applied?.content.includes("retry chains") === true
    }
    if (name === "unset") {
      checks.default_lane = profileNotices[0]?.details?.profile === "daily-normal"
    }
    if (name === "empty-registry") {
      checks.unavailable_names_registry = profileNotices[0]?.content.includes("model registry") === true
      checks.unavailable_does_not_infer_auth = /connected/i.test(profileNotices[0]?.content ?? "") === false
    }
    if (name === "unknown-profile") {
      checks.notice_lists_known_profiles =
        profileNotices[0]?.content.includes(`model_profile "nope" is not defined; known profiles: ${KNOWN_LANES}`) === true
    }
    if (name === "capable-removed" || name === "deep-work-removed" || name === "simple-work-removed") {
      const retired = name.replace("-removed", "")
      checks.notice_lists_remaining_profiles =
        profileNotices[0]?.content.includes(`model_profile "${retired}" is not defined; known profiles: ${KNOWN_LANES}`) === true
    }
    if (name === "lane-beats-recommended-models") {
      const changes = entries.filter((entry) => entry.type === "model_change").map((entry) => entry.modelId)
      checks.recommended_models_switched_first = changes.indexOf("gpt-5.6-sol") !== -1 && changes.indexOf("gpt-5.6-sol") < changes.lastIndexOf("glm-5.3")
    }
    if (scenario.resumeRun === true) {
      checks.resumed_one_session = entries.filter((entry) => entry.type === "session").length === 1
      checks.resumed_turns = assistantMessages.length === 2 && assistantMessages.every((message) => message.model === scenario.expect.model)
    }
    if (name === "cli-model-wins") {
      checks.cli_model_kept = lastAssistant?.provider === "omo-mock" && lastAssistant?.model === "mock-1"
    }

    return {
      scenario: name,
      result: Object.values(checks).every((value) => value === true) ? "PASS" : "FAIL",
      checks,
      settingsSha256: { before: settingsBefore, after: settingsAfter },
      settingsAfterJson,
      turnModel: lastAssistant,
      profileNotices,
      engineThinking: engine,
      modelChanges: entries.filter((entry) => entry.type === "model_change").map((entry) => `${entry.provider}/${entry.modelId}`),
      stderrTail: (run.stderr ?? "").split("\n").filter((line) => line.trim().length > 0).slice(-4),
    }
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
    console.error(`cleanup: removed sandbox ${sandbox.root}`)
  }
}

function main() {
  const wrongThinking = process.env.OMO_PROFILE_QA_WRONG_THINKING?.trim()
  if (wrongThinking !== undefined && wrongThinking.length > 0 && SCENARIOS["daily-normal-opus"] !== undefined) {
    SCENARIOS["daily-normal-opus"].expect.thinking = wrongThinking
  }
  const args = parseArgs(process.argv)
  const senpiBin = findOnPath(process.env.SENPI_BIN?.trim() || "senpi")
  if (senpiBin === null) {
    console.log(JSON.stringify({ result: "SKIP", reason: "senpi-binary-unavailable" }))
    return
  }
  const beforeCredentials = isolationDigest(realSenpiAgentDir)
  const scenarios = args.scenarios.map((name) => runScenario(name, SCENARIOS[name], args, senpiBin))
  const afterCredentials = isolationDigest(realSenpiAgentDir)
  const realSenpiCredentialsUntouched = beforeCredentials === afterCredentials
  const passed = scenarios.every((scenario) => scenario.result === "PASS") && realSenpiCredentialsUntouched
  console.log(JSON.stringify({ result: passed ? "PASS" : "FAIL", bundle: args.bundle, realSenpiCredentialsUntouched, scenarios }, null, 2))
  process.exitCode = passed ? 0 : 1
}

main()
