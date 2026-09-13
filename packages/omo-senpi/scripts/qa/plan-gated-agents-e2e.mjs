#!/usr/bin/env node
// Manual QA driver for the plan-gated agent tier (plan-consultant/plan-reviewer): proves on a REAL
// senpi process that task(subagent_type: "plan-reviewer"|"plan-consultant") is denied without an
// explicit USER ulw-plan request plus a .omo/plans artifact (a SKILL.md read alone stays denied),
// opens once the user prompt requests ulw-plan and a plan file is written, and closes again after a
// ulw-execute SKILL.md read. The retired-name scenarios prove the removed read alias at every input
// boundary: the retired ids (`momus`, `metis`) are ordinary names at the task tool, team_create, dag
// start and the omo.json agents key - never routed onto plan-reviewer/plan-consultant and never
// carrying a deprecation notice - plus the task tool description wording.
//   node plan-gated-agents-e2e.mjs --bundle <pluginDir> --scenario <name> --expect <gated|ungated>
//   scenarios: denial | read-unlock | sequence | retired-id | description | team-retired |
//              dag-retired | retired-config   (the retired-name scenarios only take --expect gated)
// Exit code: 0 on PASS, 1 on FAIL (the JSON verdict is printed either way).
// Isolation: SENPI_CODING_AGENT_DIR + XDG_CONFIG_HOME point at a throwaway sandbox; the real
// ~/.senpi/agent is digest-compared before/after and MUST stay identical. When launched from inside
// a live OmO/senpi session, unset SENPI_PACKAGE_DIR/OMO_PACKAGE_DIR first (they would point the
// spawned senpi at the parent's binary runtime instead of the global install).
import { spawn, spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"

import { createSandbox, digestDirectory } from "./drive.mjs"

// Isolation gate: auth/models/trust byte-identical plus settings.json compared with the live
// host session's own bookkeeping keys stripped (workflow-skills/tipsHistory/skills - proven to
// advance with no QA process running, written by the interactive session on this machine, never
// by the sandboxed run). Everything else in settings.json must stay byte-identical.
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

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(scriptDir, "..", "..")
const defaultPluginRoot = join(packageRoot, "plugin")
const mockProviderEntry = join(scriptDir, "task-e2e-mock-provider.ts")
const realSenpiAgentDir = join(homedir(), ".senpi", "agent")

const MOCK_MODEL = "omo-mock/mock-1"

const OMO_CONFIG = {
  agents: {
    "plan-reviewer": { model: MOCK_MODEL },
    "plan-consultant": { model: MOCK_MODEL },
  },
}

// Retired agents key: mapOmoConfigAgents must keep it under its own name as a plain custom agent,
// and config-startup must emit no notice about it at all.
const RETIRED_OMO_CONFIG = {
  agents: {
    momus: { model: MOCK_MODEL },
  },
}

const TOOLS_DUMP_FILE = "task-tool-dump.jsonl"
const PLAN_WRITE_STEP = { type: "tool_call", name: "write", arguments: { path: ".omo/plans/qa-plan.md", content: "# QA Plan\n\n- review me\n" } }
// The exact strings the removed alias used to emit; every retired-name scenario asserts their ABSENCE.
const RETIRED_DEPRECATION_MARKER = "is deprecated"
const RETIRED_CONFIG_NOTICE = "omo.json agents.momus is deprecated"

function parseArgs(argv) {
  const args = { bundle: defaultPluginRoot, scenario: "denial", expect: "gated" }
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i]
    const value = argv[i + 1]
    if (key === "--bundle") args.bundle = resolve(value)
    else if (key === "--scenario") args.scenario = value
    else if (key === "--expect") args.expect = value
    else throw new Error(`unknown argument: ${key}`)
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

function denialScript() {
  return {
    parentSteps: [
      { type: "tool_call", name: "task", arguments: { subagent_type: "plan-reviewer", prompt: "review the plan", run_in_background: true } },
      { type: "text", text: "denial scenario complete" },
    ],
    childSteps: [{ type: "text", text: "plan-reviewer child ran" }],
  }
}

function readUnlockScript(skillsDir) {
  return {
    parentSteps: [
      { type: "tool_call", name: "read", arguments: { path: join(skillsDir, "ulw-plan", "SKILL.md") } },
      { type: "tool_call", name: "task", arguments: { subagent_type: "plan-reviewer", prompt: "review the plan", run_in_background: true } },
      { type: "text", text: "read-unlock scenario complete" },
    ],
    childSteps: [{ type: "text", text: "plan-reviewer child ran" }],
  }
}

function sequenceScript(skillsDir) {
  return {
    parentSteps: [
      PLAN_WRITE_STEP,
      { type: "tool_call", name: "task", arguments: { subagent_type: "plan-reviewer", prompt: "review the plan", run_in_background: false } },
      { type: "tool_call", name: "read", arguments: { path: join(skillsDir, "ulw-execute", "SKILL.md") } },
      { type: "tool_call", name: "task", arguments: { subagent_type: "plan-consultant", prompt: "gap analysis", run_in_background: true } },
      { type: "text", text: "sequence scenario complete" },
    ],
    childSteps: [{ type: "text", text: "plan-reviewer review complete" }],
  }
}

// Retired id at the task tool: `momus` is not a defined agent in this sandbox, so the spawn fails
// as an unknown agent instead of silently landing on plan-reviewer, and no deprecation line appears.
function retiredIdScript() {
  return {
    parentSteps: [
      PLAN_WRITE_STEP,
      { type: "tool_call", name: "task", arguments: { subagent_type: "momus", prompt: "review the plan", run_in_background: true } },
      { type: "text", text: "retired-id scenario complete" },
    ],
    childSteps: [{ type: "text", text: "unused child" }],
  }
}

// The task tool description is only observable on the model request; the mock provider dumps it
// (MOCK_DUMP_TOOLS) on the parent's first turn, so one text step is enough.
function descriptionScript() {
  return {
    parentSteps: [{ type: "text", text: "description scenario complete" }],
    childSteps: [{ type: "text", text: "unused child" }],
  }
}

function teamRetiredScript() {
  return {
    parentSteps: [
      {
        type: "tool_call",
        name: "team_create",
        arguments: { inline_spec: { name: "qa-team", members: [{ name: "reviewer", subagent_type: "momus" }] } },
      },
      { type: "text", text: "team-retired scenario complete" },
    ],
    childSteps: [{ type: "text", text: "unused child" }],
  }
}

// The dag engine is exposed to the model as the `workflow` tool (dag-tool.ts WORKFLOW_TOOL_NAME),
// and senpi withholds it from the direct tool list whenever `eval` is registered (codemode), so the
// start goes through an eval cell exactly the way the model would call it.
const DAG_RETIRED_DEFINITION = {
  key: "qa-dag-retired",
  name: "retired id dag",
  nodes: [{ id: "consult", subagent_type: "metis", prompt: "TASK: gap analysis of .omo/plans/qa-plan.md. STOP WHEN the gaps are listed." }],
}

function dagRetiredScript() {
  return {
    parentSteps: [
      PLAN_WRITE_STEP,
      {
        type: "tool_call",
        name: "eval",
        arguments: {
          language: "js",
          summary: "start the retired-id dag through the workflow tool",
          code: `const started = await tool.workflow(${JSON.stringify({ action: "start", definition: DAG_RETIRED_DEFINITION })});\nconsole.log(JSON.stringify(started));`,
        },
      },
      { type: "text", text: "dag-retired scenario complete" },
    ],
    childSteps: [{ type: "text", text: "unused child" }],
  }
}

// The retired omo.json key defines an ordinary custom agent named momus: it is NOT plan-gated, it
// carries the key's model, and starting a session against that config emits no notice about it.
function retiredConfigScript() {
  return {
    parentSteps: [
      { type: "tool_call", name: "task", arguments: { subagent_type: "momus", prompt: "review the plan", run_in_background: false } },
      { type: "text", text: "retired-config scenario complete" },
    ],
    childSteps: [{ type: "text", text: "custom momus agent complete" }],
  }
}

// The hyphenated form arms the user-request channel without tripping the ultrawork /ulw(?!-)/ trigger.
const UNLOCK_PROMPT = "please run the ulw-plan review scripted scenario"
const PLAIN_PROMPT = "run the scripted scenario"

const SCENARIOS = {
  denial: { script: () => denialScript(), prompt: PLAIN_PROMPT, config: OMO_CONFIG },
  "read-unlock": { script: (skillsDir) => readUnlockScript(skillsDir), prompt: PLAIN_PROMPT, config: OMO_CONFIG },
  sequence: { script: (skillsDir) => sequenceScript(skillsDir), prompt: UNLOCK_PROMPT, config: OMO_CONFIG },
  "retired-id": { script: () => retiredIdScript(), prompt: UNLOCK_PROMPT, config: OMO_CONFIG },
  description: { script: () => descriptionScript(), prompt: PLAIN_PROMPT, config: OMO_CONFIG },
  "team-retired": { script: () => teamRetiredScript(), prompt: PLAIN_PROMPT, config: OMO_CONFIG },
  "dag-retired": { script: () => dagRetiredScript(), prompt: UNLOCK_PROMPT, config: OMO_CONFIG },
  "retired-config": { script: () => retiredConfigScript(), prompt: UNLOCK_PROMPT, config: RETIRED_OMO_CONFIG },
}

function seedScenario(pluginRoot, script, omoConfig) {
  const sandbox = createSandbox()
  mkdirSync(sandbox.cwd, { recursive: true })
  mkdirSync(sandbox.agentDir, { recursive: true })
  mkdirSync(sandbox.xdgConfigHome, { recursive: true })
  mkdirSync(sandbox.xdgDataHome, { recursive: true })
  mkdirSync(sandbox.xdgCacheHome, { recursive: true })
  mkdirSync(sandbox.homeDir, { recursive: true })
  writeFileSync(join(sandbox.agentDir, "settings.json"), `${JSON.stringify({ defaultProjectTrust: "ask", packages: [pluginRoot] }, null, 2)}\n`)
  writeFileSync(join(sandbox.agentDir, "trust.json"), `${JSON.stringify({ [sandbox.canonicalCwd]: true }, null, 2)}\n`)
  const sessionDir = join(sandbox.root, "sessions")
  mkdirSync(sessionDir, { recursive: true })
  const omoDir = join(sandbox.cwd, ".omo")
  mkdirSync(omoDir, { recursive: true })
  writeFileSync(join(omoDir, "omo.json"), `${JSON.stringify(omoConfig, null, 2)}\n`)
  writeFileSync(join(sandbox.cwd, "mock-script.json"), `${JSON.stringify(script, null, 2)}\n`)
  return { sandbox, sessionDir, stateDir: join(sandbox.cwd, ".omo", "senpi-task") }
}

function collectText(root) {
  if (!existsSync(root)) return ""
  const files = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile() && (path.endsWith(".json") || path.endsWith(".jsonl") || path.endsWith(".log"))) files.push(path)
    }
  }
  walk(root)
  return files.map((file) => readFileSync(file, "utf8")).join("\n")
}

function storeTaskRecords(stateDir) {
  const tasksDir = join(stateDir, "tasks")
  if (!existsSync(tasksDir)) return []
  return readdirSync(tasksDir)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => JSON.parse(readFileSync(join(tasksDir, entry), "utf8")))
}

function readToolDump(cwd) {
  const path = join(cwd, TOOLS_DUMP_FILE)
  if (!existsSync(path)) return []
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => JSON.parse(line))
}

// Tool results reach the transcript JSON-encoded (an eval cell's console.log of a tool result is
// encoded twice), so a needle with double quotes (the deprecation and team_create messages) is
// matched verbatim and at one and two levels of JSON escaping.
function mentions(haystack, needle) {
  const once = JSON.stringify(needle).slice(1, -1)
  const twice = JSON.stringify(once).slice(1, -1)
  return haystack.includes(needle) || haystack.includes(once) || haystack.includes(twice)
}

// Every task tool_execution_end event's details, straight from the JSON event stream (the store
// record is flushed after the turn, which rpc mode does not wait for).
function taskSpawnDetails(stdout) {
  const details = []
  for (const line of stdout.split("\n")) {
    if (!line.includes('"tool_execution_end"') || !line.includes('"toolName":"task"')) continue
    try {
      const event = JSON.parse(line)
      if (event.type === "tool_execution_end" && event.toolName === "task" && event.result?.details !== undefined) details.push(event.result.details)
    } catch {
      // partial or non-JSON line: not an event
    }
  }
  return details
}

function taskToolDescription(cwd) {
  const task = readToolDump(cwd).find((tool) => tool.name === "task")
  return typeof task?.description === "string" ? task.description : ""
}

const SENPI_TIMEOUT_MS = 120_000

// HOME is redirected too: the omo config loader reads the user scope (~/.omo/omo.jsonc), and a
// developer's real file with its own agents keys would leak into every scenario's roster and the
// retired-config scenario (drive.mjs convention).
function senpiEnv(sandbox, sessionDir) {
  return {
    ...process.env,
    SENPI_CODING_AGENT_DIR: sandbox.agentDir,
    HOME: sandbox.homeDir,
    USERPROFILE: sandbox.homeDir,
    XDG_CONFIG_HOME: sandbox.xdgConfigHome,
    XDG_DATA_HOME: sandbox.xdgDataHome,
    XDG_CACHE_HOME: sandbox.xdgCacheHome,
    SENPI_CODING_AGENT_SESSION_DIR: sessionDir,
    OMO_SENPI_QA: "1",
    MOCK_DUMP_TOOLS: join(sandbox.cwd, TOOLS_DUMP_FILE),
  }
}

function runSenpi(senpiBin, scenario, sandbox, sessionDir) {
  const run = spawnSync(
    senpiBin,
    ["-e", mockProviderEntry, "-p", "--mode", "json", "--provider", "omo-mock", "--model", "mock-1", "--session-dir", sessionDir, scenario.prompt],
    { cwd: sandbox.cwd, env: senpiEnv(sandbox, sessionDir), encoding: "utf8", timeout: SENPI_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
  )
  return { status: run.status, pid: run.pid, stdout: run.stdout ?? "", stderr: run.stderr ?? "" }
}

// Startup notices go through ui.notify, which print mode swallows (senpi's noOpUIContext) and rpc
// mode emits as an `extension_ui_request` event. The probe starts a second senpi in rpc mode against
// the same sandbox, sends no prompt (the notice fires on session_start), resolves on the first
// notify event carrying the expected text, and kills the process; bounded by SENPI_TIMEOUT_MS.
function probeStartupNotice(senpiBin, sandbox, sessionDir, expectedText) {
  return new Promise((resolvePromise) => {
    const child = spawn(
      senpiBin,
      ["-e", mockProviderEntry, "--mode", "rpc", "--provider", "omo-mock", "--model", "mock-1", "--session-dir", sessionDir],
      // Own process group: the senpi launcher re-execs itself under bun, so the kill must reach the
      // whole group or the grandchild keeps writing into the sandbox after the launcher is gone.
      { cwd: sandbox.cwd, env: senpiEnv(sandbox, sessionDir), stdio: ["pipe", "pipe", "pipe"], detached: true },
    )
    let stdout = ""
    let found = false
    let killed = false
    // Resolve only after the rpc process has exited: the sandbox is rm'd right after, and a
    // process still flushing its session file would race that removal.
    const stop = (matched) => {
      if (killed) return
      killed = true
      found = matched
      clearTimeout(timer)
      if (typeof child.pid === "number") process.kill(-child.pid, "SIGKILL")
    }
    const timer = setTimeout(() => stop(false), SENPI_TIMEOUT_MS)
    child.stdout.on("data", (chunk) => {
      stdout += chunk
      if (stdout.includes('"method":"notify"') && stdout.includes(expectedText)) stop(true)
    })
    child.on("exit", () => {
      clearTimeout(timer)
      const notices = stdout
        .split("\n")
        .filter((line) => line.includes('"extension_ui_request"') && line.includes('"method":"notify"'))
        .map((line) => JSON.parse(line))
        .map((event) => ({ message: event.message, notifyType: event.notifyType }))
      resolvePromise({ found, notices, pid: child.pid })
    })
  })
}

async function main() {
  const args = parseArgs(process.argv)
  const senpiBin = findOnPath(process.env.SENPI_BIN?.trim() || "senpi")
  if (senpiBin === null) {
    console.log(JSON.stringify({ result: "SKIP", reason: "senpi-binary-unavailable" }))
    return
  }
  const scenario = SCENARIOS[args.scenario]
  if (scenario === undefined) throw new Error(`unknown scenario: ${args.scenario} (expected one of ${Object.keys(SCENARIOS).join(", ")})`)
  const skillsDir = join(args.bundle, "skills")
  const script = scenario.script(skillsDir)
  // A live dev machine (including the session driving this QA) keeps writing session JSONL and
  // logs into the real agent dir, so the whole-directory digest is informational only; the
  // isolation gate is the four credential files staying byte-identical (drive.mjs convention).
  const beforeCredentials = isolationDigest(realSenpiAgentDir)
  const beforeDigest = digestDirectory(realSenpiAgentDir)
  const { sandbox, sessionDir, stateDir } = seedScenario(args.bundle, script, scenario.config)
  const pids = []
  try {
    const run = runSenpi(senpiBin, scenario, sandbox, sessionDir)
    if (typeof run.pid === "number") pids.push(run.pid)

    const stdout = run.stdout
    const stderr = run.stderr
    const transcript = `${stdout}\n${collectText(sessionDir)}`
    const records = storeTaskRecords(stateDir)
    const missingRequestDenial = transcript.includes("available only after the user explicitly requests")
    const missingArtifactDenial = transcript.includes("no plan artifact")
    const ulwExecuteDenial = transcript.includes("is plan-gated and cannot be spawned:")
    const anyDenial = missingRequestDenial || missingArtifactDenial || ulwExecuteDenial
    const childCompleted = transcript.includes("plan-reviewer review complete")
    const reviewerRecords = records.filter((record) => record.agent_type === "plan-reviewer")
    const description = taskToolDescription(sandbox.cwd)
    let startupNotices = []

    const checks = {}
    if (args.scenario === "denial" && args.expect === "gated") {
      checks.denial_present = missingRequestDenial
      checks.no_child_spawned = records.length === 0
    } else if (args.scenario === "denial" && args.expect === "ungated") {
      checks.no_gate_text = !anyDenial
      checks.child_spawned = records.length > 0
    } else if (args.scenario === "read-unlock" && args.expect === "gated") {
      checks.read_does_not_unlock = missingRequestDenial
      checks.no_child_spawned = records.length === 0
    } else if (args.scenario === "read-unlock" && args.expect === "ungated") {
      checks.no_gate_text = !anyDenial
      checks.child_spawned = records.length > 0
    } else if (args.scenario === "sequence" && args.expect === "gated") {
      checks.first_spawn_allowed = childCompleted
      checks.second_denied_ulw_execute = ulwExecuteDenial
      checks.exactly_one_child = records.length === 1
    } else if (args.scenario === "sequence" && args.expect === "ungated") {
      checks.no_gate_text = !anyDenial
      checks.both_spawned = records.length === 2
    } else if (args.scenario === "retired-id") {
      const spawns = taskSpawnDetails(stdout)
      checks.retired_id_not_routed_to_canonical = spawns.every((details) => details.subagent_type !== "plan-reviewer")
      checks.no_reviewer_child_started = reviewerRecords.length === 0
      checks.spawn_reported_unresolved = spawns.length === 1 && spawns[0].status !== "running"
      checks.no_deprecation_notice = !mentions(transcript, RETIRED_DEPRECATION_MARKER)
      checks.no_legacy_alias_field = spawns.every((details) => details.legacy_subagent_type === undefined)
    } else if (args.scenario === "description") {
      checks.description_captured = description.length > 0
      checks.plan_gated_roster_named = /Plan-gated agents[^\n]*plan-consultant, plan-reviewer/.test(description)
      checks.no_retired_persona = !/Sisyphus|Momus|Metis/i.test(description)
    } else if (args.scenario === "team-retired") {
      checks.team_create_rejected_naming_retired_id = mentions(transcript, "unknown subagent_type 'momus'")
      checks.rejection_never_names_canonical = !mentions(transcript, '(requested as "momus")')
      checks.no_member_spawned = records.length === 0
    } else if (args.scenario === "dag-retired") {
      checks.dag_run_started = /Started dag run/.test(transcript)
      checks.no_deprecation_warning = !mentions(transcript, RETIRED_DEPRECATION_MARKER)
      checks.route_keeps_retired_id = mentions(transcript, '"agent":"metis"')
    } else if (args.scenario === "retired-config") {
      const spawns = taskSpawnDetails(stdout).filter((details) => details.subagent_type === "momus")
      checks.retired_key_defines_custom_agent =
        spawns.length === 1 && spawns[0].resolved_model?.display === MOCK_MODEL && spawns[0].resolved_model?.source === "agent"
      checks.custom_agent_spawn_completed = transcript.includes("custom momus agent complete")
      checks.plan_reviewer_untouched = !records.some((record) => record.agent_type === "plan-reviewer")
      const probe = await probeStartupNotice(senpiBin, sandbox, sessionDir, RETIRED_CONFIG_NOTICE)
      if (typeof probe.pid === "number") pids.push(probe.pid)
      startupNotices = probe.notices
      checks.no_startup_alias_notice = !probe.found && !probe.notices.some((notice) => notice.message.includes(RETIRED_DEPRECATION_MARKER))
    } else {
      throw new Error(`scenario ${args.scenario} does not take --expect ${args.expect}`)
    }
    checks.exit_zero = run.status === 0

    const afterCredentials = isolationDigest(realSenpiAgentDir)
    const afterDigest = digestDirectory(realSenpiAgentDir)
    const passed = Object.values(checks).every((value) => value === true) && beforeCredentials === afterCredentials
    process.exitCode = passed ? 0 : 1
    const interesting = (line) =>
      line.length < 2000 &&
      (line.includes("is plan-gated") || line.includes("review complete") || line.includes("is deprecated") || line.includes("requested as") || line.includes("dag run"))
    console.log(JSON.stringify({
      result: passed ? "PASS" : "FAIL",
      scenario: args.scenario,
      expect: args.expect,
      checks,
      realSenpiCredentialsUntouched: beforeCredentials === afterCredentials,
      informationalDirectoryDigestStable: beforeDigest === afterDigest,
      startupNotices,
      taskRecords: records.map((record) => ({ task_id: record.task_id, agent_type: record.agent_type, status: record.status, model: record.resolved_model?.display })),
      stdoutTail: stdout.split("\n").filter(interesting).slice(0, 6),
      stderrTail: stderr.split("\n").filter((line) => line.trim().length > 0).slice(-6),
    }))
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    console.error(`cleanup: removed sandbox ${sandbox.root}`)
  }
}

await main()
