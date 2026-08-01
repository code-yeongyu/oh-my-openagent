#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import {
  createSandbox,
  credentialDigest,
  seedSandbox,
} from "./drive.mjs"
import {
  changedRealPaths,
  classifyRealSenpiChanges,
  snapshotDir,
} from "./task-e2e-analysis.mjs"
import { isAlive, killTree } from "./task-e2e-process.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const mockProviderEntry = join(scriptDir, "task-e2e-mock-provider.ts")
const realSenpiAgentDir = join(homedir(), ".senpi", "agent")

const REQUESTED_MODEL = "omo-mock/mock-primary"
const FALLBACK_MODEL = "omo-mock/mock-fallback"
const FALLBACK_LINE = `fallback:${REQUESTED_MODEL}->${FALLBACK_MODEL}`

function findOnPath(bin) {
  if (bin.includes("/")) return existsSync(bin) ? bin : null
  for (const pathEntry of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = resolve(pathEntry || ".", bin)
    if (existsSync(candidate)) return candidate
  }
  return null
}

function parseArgs(argv) {
  const output = { evidenceDir: undefined, selfTest: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--self-test") {
      output.selfTest = true
      continue
    }
    if (arg === "--evidence-dir") {
      const value = argv[index + 1]
      if (value === undefined) throw new Error("--evidence-dir requires a path")
      output.evidenceDir = isAbsolute(value) ? value : resolve(process.cwd(), value)
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }
  return output
}

function scenarioScript() {
  const waitForTaskTerminal = `node -e '${[
    "const fs=require(\"node:fs\")",
    "const dir=\".omo/senpi-task/tasks\"",
    "fs.mkdirSync(dir,{recursive:true})",
    "const terminal=new Set([\"completed\",\"error\",\"cancelled\",\"interrupted\",\"lost\"])",
    "const done=()=>fs.readdirSync(dir).filter(f=>f.endsWith(\".json\")).some(f=>{const r=JSON.parse(fs.readFileSync(dir+\"/\"+f,\"utf8\"));return terminal.has(r.status)&&r.notification?.notified_epoch>=r.notification?.run_epoch})",
    "if(done())process.exit(0)",
    "const watcher=fs.watch(dir,()=>{if(done()){watcher.close();process.exit(0)}})",
    "setTimeout(()=>{watcher.close();process.exit(2)},30000)",
  ].join(";")}'`
  return {
    models: ["mock-parent", "mock-primary", "mock-fallback"],
    failChildModels: ["mock-primary"],
    parentSteps: [
      {
        type: "tool_call",
        name: "task",
        arguments: {
          subagent_type: "fallback-worker",
          description: "exercise configured fallback",
          prompt: "Return the fallback child completion marker.",
          run_in_background: true,
        },
      },
      {
        type: "tool_call",
        name: "bash",
        arguments: { command: waitForTaskTerminal },
      },
      {
        type: "tool_call",
        name: "bash",
        arguments: { command: "printf fallback-notification-boundary" },
      },
      { type: "text", text: "parent observed terminal fallback completion" },
    ],
    childSteps: [
      { type: "text", text: "fallback child completed" },
    ],
  }
}

function seedScenario() {
  const sandbox = createSandbox()
  seedSandbox(sandbox)
  const sessionDir = join(sandbox.root, "sessions")
  mkdirSync(sessionDir, { recursive: true })
  const omoDir = join(sandbox.cwd, ".omo")
  mkdirSync(omoDir, { recursive: true })
  writeFileSync(join(omoDir, "omo.json"), `${JSON.stringify({
    agents: {
      "fallback-worker": {
        model: REQUESTED_MODEL,
        models: [FALLBACK_MODEL],
        execution_mode: "process",
      },
    },
  }, null, 2)}\n`)
  writeFileSync(
    join(sandbox.cwd, "mock-script.json"),
    `${JSON.stringify(scenarioScript(), null, 2)}\n`,
  )
  return {
    sandbox,
    sessionDir,
    stateDir: join(sandbox.cwd, ".omo", "senpi-task"),
  }
}

function readTaskArtifacts(stateDir) {
  const tasksDir = join(stateDir, "tasks")
  const taskFile = existsSync(tasksDir)
    ? readdirSync(tasksDir).find((entry) => entry.endsWith(".json"))
    : undefined
  if (taskFile === undefined) {
    throw new Error(`No task record found under ${tasksDir}`)
  }
  const taskId = taskFile.replace(/\.json$/u, "")
  const recordText = readFileSync(join(tasksDir, taskFile), "utf8")
  const eventsPath = join(stateDir, "logs", `${taskId}.jsonl`)
  const eventsText = existsSync(eventsPath) ? readFileSync(eventsPath, "utf8") : ""
  return {
    taskId,
    recordText,
    record: JSON.parse(recordText),
    eventsText,
  }
}

function readSessionTranscript(sessionDir) {
  const files = []
  const walk = (dir) => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path)
    }
  }
  walk(sessionDir)
  return files.map((path) => readFileSync(path, "utf8")).join("\n")
}

function count(text, needle) {
  return text.split(needle).length - 1
}

function containsSandboxToken(path, tokens) {
  if (tokens.some((token) => path.includes(token))) return true
  const absolutePath = join(realSenpiAgentDir, path)
  if (!existsSync(absolutePath)) return false
  try {
    const content = readFileSync(absolutePath, "utf8")
    return tokens.some((token) => content.includes(token))
  } catch {
    return false
  }
}

function assertScenario(run, artifacts, sessionTranscript) {
  const stdout = run.stdout ?? ""
  const stderr = run.stderr ?? ""
  const parentSurface = `${stdout}\n${stderr}\n${sessionTranscript}`
  const checks = {
    process_exit: run.status === 0,
    terminal_fallback_once: count(sessionTranscript, FALLBACK_LINE) === 1,
    no_premature_capacity_line: !parentSurface.includes("mock provider capacity exhausted"),
    no_raw_quota_line: !parentSurface.includes("403:")
      && !parentSurface.includes('"status":403')
      && !parentSurface.includes("access_terminated_error")
      && !parentSurface.includes("You've reached your usage limit"),
    task_completed: artifacts.record.status === "completed",
    requested_model_preserved: artifacts.record.requested_model?.display === REQUESTED_MODEL,
    actual_model_recorded: artifacts.record.resolved_model?.display === FALLBACK_MODEL,
    configured_chain_consumed: Array.isArray(artifacts.record.fallback_models)
      && artifacts.record.fallback_models.length === 0,
    fallback_event_once: count(artifacts.eventsText, '"type":"task_model_fallback"') === 1,
  }
  return {
    result: Object.values(checks).every(Boolean) ? "PASS" : "FAIL",
    checks,
    stdout,
    stderr,
    sessionTranscript,
  }
}

function writeEvidence(evidenceDir, result, artifacts, isolation, cleanup) {
  if (evidenceDir === undefined) return
  mkdirSync(evidenceDir, { recursive: true })
  writeFileSync(join(evidenceDir, "stdout.jsonl"), result.stdout)
  writeFileSync(join(evidenceDir, "stderr.txt"), result.stderr)
  writeFileSync(join(evidenceDir, "task-record.json"), artifacts.recordText)
  writeFileSync(join(evidenceDir, "task-events.jsonl"), artifacts.eventsText)
  writeFileSync(join(evidenceDir, "parent-session.jsonl"), result.sessionTranscript)
  writeFileSync(join(evidenceDir, "cleanup.txt"), `${cleanup}\n`)
  writeFileSync(join(evidenceDir, "summary.json"), `${JSON.stringify({
    result: result.result,
    checks: result.checks,
    isolation,
    taskId: artifacts.taskId,
    fallbackLine: FALLBACK_LINE,
  }, null, 2)}\n`)
}

function selfTest() {
  if (count(`x ${FALLBACK_LINE} y`, FALLBACK_LINE) !== 1) {
    throw new Error("fallback line counter failed")
  }
  const script = scenarioScript()
  if (script.failChildModels[0] !== "mock-primary") {
    throw new Error("primary failure model mismatch")
  }
  console.log("SELF-TEST OK")
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.selfTest) {
    selfTest()
    return
  }

  const senpiBin = findOnPath(process.env.SENPI_BIN?.trim() || "senpi")
  if (senpiBin === null) {
    console.log(JSON.stringify({ result: "SKIP", reason: "senpi-binary-unavailable" }))
    process.exitCode = 1
    return
  }

  const beforeCredentials = credentialDigest(realSenpiAgentDir)
  const beforeAgentDir = snapshotDir(realSenpiAgentDir)
  const scenario = seedScenario()
  let report
  try {
    const run = spawnSync(
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
        "mock-parent",
        "--session-dir",
        scenario.sessionDir,
        "spawn the fallback worker and report its terminal completion",
      ],
      {
        cwd: scenario.sandbox.cwd,
        env: {
          ...process.env,
          SENPI_CODING_AGENT_DIR: scenario.sandbox.agentDir,
          SENPI_CODING_AGENT_SESSION_DIR: scenario.sessionDir,
          XDG_CONFIG_HOME: scenario.sandbox.xdgConfigHome,
          OMO_SENPI_QA: "1",
        },
        encoding: "utf8",
        timeout: 120_000,
        maxBuffer: 64 * 1024 * 1024,
      },
    )

    const artifacts = readTaskArtifacts(scenario.stateDir)
    const sessionTranscript = readSessionTranscript(scenario.sessionDir)
    const result = assertScenario(run, artifacts, sessionTranscript)
    const childPid = typeof artifacts.record.pid === "number" ? artifacts.record.pid : undefined
    const childAlive = childPid !== undefined && isAlive(childPid)
    if (childAlive) killTree(childPid)
    const afterCredentials = credentialDigest(realSenpiAgentDir)
    const afterAgentDir = snapshotDir(realSenpiAgentDir)
    const changedPaths = changedRealPaths(beforeAgentDir, afterAgentDir)
    const sandboxTokens = [
      scenario.sandbox.root,
      scenario.sandbox.canonicalCwd,
      artifacts.taskId,
    ]
    const classified = classifyRealSenpiChanges(changedPaths, sandboxTokens)
    const qaAttributedPaths = classified.qaAttributedPaths.filter((path) =>
      containsSandboxToken(path, sandboxTokens)
    )
    const concurrentGlobalPaths = classified.qaAttributedPaths.filter((path) =>
      !containsSandboxToken(path, sandboxTokens)
    )
    const isolation = {
      credentialDigestUnchanged: beforeCredentials === afterCredentials,
      qaAttributedPaths,
      concurrentGlobalPaths,
      concurrentSessionPaths: classified.concurrentSessionPaths,
    }
    if (isolation.qaAttributedPaths.length > 0 || childAlive) {
      result.result = "FAIL"
    }
    report = { result, artifacts, isolation, childAlive }
  } finally {
    rmSync(scenario.sandbox.root, { recursive: true, force: true })
  }
  const sandboxRemoved = !existsSync(scenario.sandbox.root)
  const cleanup = `child_alive_before_cleanup=${report.childAlive}; sandbox_removed=${sandboxRemoved}`
  if (!sandboxRemoved) report.result.result = "FAIL"
  writeEvidence(
    args.evidenceDir,
    report.result,
    report.artifacts,
    report.isolation,
    cleanup,
  )
  console.log(JSON.stringify({
    result: report.result.result,
    checks: report.result.checks,
    isolation: report.isolation,
    cleanup,
    taskId: report.artifacts.taskId,
    fallbackLine: FALLBACK_LINE,
  }, null, 2))
  if (report.result.result !== "PASS") process.exitCode = 1
}

main()
