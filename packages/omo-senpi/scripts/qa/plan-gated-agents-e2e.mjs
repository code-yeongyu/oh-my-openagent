#!/usr/bin/env node
// Manual QA driver for the plan-gated agent tier (metis/momus): proves on a REAL senpi process
// that task(subagent_type: "momus"|"metis") is denied without an explicit USER ulw-plan request
// plus a .omo/plans artifact (a SKILL.md read alone stays denied), opens once the user prompt
// requests ulw-plan and a plan file is written, and closes again after a ulw-execute SKILL.md read.
//   node plan-gated-agents-e2e.mjs --bundle <pluginDir> --scenario <denial|read-unlock|sequence> --expect <gated|ungated>
// Isolation: SENPI_CODING_AGENT_DIR + XDG_CONFIG_HOME point at a throwaway sandbox; the real
// ~/.senpi/agent is digest-compared before/after and MUST stay identical.
import { spawnSync } from "node:child_process"
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

const OMO_CONFIG = {
  agents: {
    momus: { model: "omo-mock/mock-1" },
    metis: { model: "omo-mock/mock-1" },
  },
}

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
      { type: "tool_call", name: "task", arguments: { subagent_type: "momus", prompt: "review the plan", run_in_background: true } },
      { type: "text", text: "denial scenario complete" },
    ],
    childSteps: [{ type: "text", text: "momus child ran" }],
  }
}

function readUnlockScript(skillsDir) {
  return {
    parentSteps: [
      { type: "tool_call", name: "read", arguments: { path: join(skillsDir, "ulw-plan", "SKILL.md") } },
      { type: "tool_call", name: "task", arguments: { subagent_type: "momus", prompt: "review the plan", run_in_background: true } },
      { type: "text", text: "read-unlock scenario complete" },
    ],
    childSteps: [{ type: "text", text: "momus child ran" }],
  }
}

function sequenceScript(skillsDir) {
  return {
    parentSteps: [
      { type: "tool_call", name: "write", arguments: { path: ".omo/plans/qa-plan.md", content: "# QA Plan\n\n- review me\n" } },
      { type: "tool_call", name: "task", arguments: { subagent_type: "momus", prompt: "review the plan", run_in_background: false } },
      { type: "tool_call", name: "read", arguments: { path: join(skillsDir, "ulw-execute", "SKILL.md") } },
      { type: "tool_call", name: "task", arguments: { subagent_type: "metis", prompt: "gap analysis", run_in_background: true } },
      { type: "text", text: "sequence scenario complete" },
    ],
    childSteps: [{ type: "text", text: "momus review complete" }],
  }
}

const SCENARIO_PROMPTS = {
  denial: "run the scripted scenario",
  "read-unlock": "run the scripted scenario",
  // The hyphenated form arms the user-request channel without tripping the ultrawork /ulw(?!-)/ trigger.
  sequence: "please run the ulw-plan review scripted scenario",
}

function seedScenario(pluginRoot, script) {
  const sandbox = createSandbox()
  mkdirSync(sandbox.cwd, { recursive: true })
  mkdirSync(sandbox.agentDir, { recursive: true })
  mkdirSync(sandbox.xdgConfigHome, { recursive: true })
  writeFileSync(join(sandbox.agentDir, "settings.json"), `${JSON.stringify({ defaultProjectTrust: "ask", packages: [pluginRoot] }, null, 2)}\n`)
  writeFileSync(join(sandbox.agentDir, "trust.json"), `${JSON.stringify({ [sandbox.canonicalCwd]: true }, null, 2)}\n`)
  const sessionDir = join(sandbox.root, "sessions")
  mkdirSync(sessionDir, { recursive: true })
  const omoDir = join(sandbox.cwd, ".omo")
  mkdirSync(omoDir, { recursive: true })
  writeFileSync(join(omoDir, "omo.json"), `${JSON.stringify(OMO_CONFIG, null, 2)}\n`)
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

function main() {
  const args = parseArgs(process.argv)
  const senpiBin = findOnPath(process.env.SENPI_BIN?.trim() || "senpi")
  if (senpiBin === null) {
    console.log(JSON.stringify({ result: "SKIP", reason: "senpi-binary-unavailable" }))
    return
  }
  const skillsDir = join(args.bundle, "skills")
  const script =
    args.scenario === "sequence" ? sequenceScript(skillsDir)
    : args.scenario === "read-unlock" ? readUnlockScript(skillsDir)
    : denialScript()
  const scenarioPrompt = SCENARIO_PROMPTS[args.scenario] ?? SCENARIO_PROMPTS.denial
  // A live dev machine (including the session driving this QA) keeps writing session JSONL and
  // logs into the real agent dir, so the whole-directory digest is informational only; the
  // isolation gate is the four credential files staying byte-identical (drive.mjs convention).
  const beforeCredentials = isolationDigest(realSenpiAgentDir)
  const beforeDigest = digestDirectory(realSenpiAgentDir)
  const { sandbox, sessionDir, stateDir } = seedScenario(args.bundle, script)
  const pids = []
  try {
    const run = spawnSync(
      senpiBin,
      ["-e", mockProviderEntry, "-p", "--mode", "json", "--provider", "omo-mock", "--model", "mock-1", "--session-dir", sessionDir, scenarioPrompt],
      {
        cwd: sandbox.cwd,
        env: { ...process.env, SENPI_CODING_AGENT_DIR: sandbox.agentDir, XDG_CONFIG_HOME: sandbox.xdgConfigHome, SENPI_CODING_AGENT_SESSION_DIR: sessionDir, OMO_SENPI_QA: "1" },
        encoding: "utf8",
        timeout: 120_000,
        maxBuffer: 64 * 1024 * 1024,
      },
    )
    if (typeof run.pid === "number") pids.push(run.pid)

    const transcript = `${run.stdout ?? ""}\n${collectText(sessionDir)}`
    const records = storeTaskRecords(stateDir)
    const missingRequestDenial = transcript.includes("available only after the user explicitly requests")
    const missingArtifactDenial = transcript.includes("no plan artifact")
    const ulwExecuteDenial = transcript.includes("is plan-gated and cannot be spawned:")
    const anyDenial = missingRequestDenial || missingArtifactDenial || ulwExecuteDenial
    const childCompleted = transcript.includes("momus review complete")

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
    }
    checks.exit_zero = run.status === 0

    const afterCredentials = isolationDigest(realSenpiAgentDir)
    const afterDigest = digestDirectory(realSenpiAgentDir)
    const passed = Object.values(checks).every((value) => value === true) && beforeCredentials === afterCredentials
    console.log(JSON.stringify({
      result: passed ? "PASS" : "FAIL",
      scenario: args.scenario,
      expect: args.expect,
      checks,
      realSenpiCredentialsUntouched: beforeCredentials === afterCredentials,
      informationalDirectoryDigestStable: beforeDigest === afterDigest,
      taskRecords: records.map((record) => ({ task_id: record.task_id, subagent_type: record.subagent_type, status: record.status })),
      stdoutTail: (run.stdout ?? "").split("\n").filter((line) => line.includes("plan-gated") || line.includes("momus review complete")).slice(0, 6),
      stderrTail: (run.stderr ?? "").split("\n").slice(-4),
    }))
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
    console.error(`cleanup: removed sandbox ${sandbox.root}`)
  }
}

main()
