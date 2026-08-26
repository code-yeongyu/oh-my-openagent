#!/usr/bin/env bun

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { runSenpiInstaller } from "../../src/install/install-senpi.ts"
import { createSandbox } from "./drive.mjs"
import {
  findCommand,
  parseArgs,
  processAlive,
  waitForFileEventCommand,
  waitForState,
  writeArtifact,
} from "./task-parent-restart-runtime.mjs"
import {
  childSessionHasAssistant,
  childSessionText,
  findTaskByName,
  seedResumeProject,
  startResumeRun,
} from "./resume-e2e-runtime.mjs"
import {
  MIDTURN_CONTINUED_TOKEN,
  resumeOmoConfig,
} from "./task-resume-e2e-scenarios.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "../../../..")
const mockProviderEntry = join(scriptDir, "task-resume-e2e-mock-provider.ts")
const DEFAULT_TIMEOUT_MS = 45_000

const bash = (command) => ({ type: "tool_call", name: "bash", arguments: { command } })
const text = (value) => ({ type: "text", text: value })
const spawnBackground = (prompt, name) => ({
  type: "tool_call",
  name: "task",
  arguments: { category: "mockcat", prompt, run_in_background: true, name },
})

function crashRunScript(sentinel) {
  return {
    parentSteps: [
      spawnBackground("midturn-child parent restart unit", "restartchild"),
      bash(waitForFileEventCommand(sentinel)),
      text("first parent should be killed before this text"),
    ],
  }
}

function replacementRunScript(sentinel) {
  return {
    parentSteps: [
      bash(waitForFileEventCommand(sentinel)),
      text("replacement parent settled"),
    ],
  }
}

function recordOutcome(cwd) {
  const record = findTaskByName(cwd, "restartchild")
  if (record === undefined) return undefined
  const sessionText = childSessionText(cwd, record.task_id)
  if (sessionText.includes(MIDTURN_CONTINUED_TOKEN)) return { kind: "continued", record }
  if (record.status === "lost") return { kind: "lost", record }
  return undefined
}

async function runScenario(options) {
  if (options.evidenceDir === undefined) throw new Error("--evidence-dir is required")
  const sandbox = createSandbox()
  const stateAbort = new AbortController()
  const firstSentinel = join(sandbox.root, "first-parent-release")
  const secondSentinel = join(sandbox.root, "second-parent-release")
  const runs = []
  const summary = {
    pluginMode: options.pluginPath === undefined ? "fresh-source-install" : "explicit-plugin",
    pluginPath: options.pluginPath ?? join(repoRoot, "packages", "omo-senpi", "plugin"),
    taskId: undefined,
    initialParentPid: undefined,
    replacementParentPid: undefined,
    outcome: undefined,
    errorMessage: undefined,
    cleanup: undefined,
  }

  try {
    seedResumeProject(sandbox, resumeOmoConfig())
    if (options.pluginPath === undefined) {
      await runSenpiInstaller({ agentDir: sandbox.agentDir, repoRoot })
    } else {
      const settingsPath = join(sandbox.agentDir, "settings.json")
      const settings = JSON.parse(readFileSync(settingsPath, "utf8"))
      settings.packages = [options.pluginPath]
      writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)
    }

    const senpiBin = findCommand("senpi")
    const initialRecordPromise = waitForState(
      sandbox.root,
      () => findTaskByName(sandbox.cwd, "restartchild"),
      (record) => record !== undefined && record.status === "running" && childSessionHasAssistant(sandbox.cwd, record.task_id),
      DEFAULT_TIMEOUT_MS,
      stateAbort.signal,
    )
    const firstRun = startResumeRun({
      senpiBin,
      sandbox,
      mockProviderEntry,
      script: crashRunScript(firstSentinel),
    })
    runs.push(firstRun)
    summary.initialParentPid = firstRun.pid

    const initialRecord = await initialRecordPromise
    summary.taskId = initialRecord.task_id
    firstRun.kill()
    const firstResult = await firstRun.completion
    if (firstResult.status !== null) throw new Error(`first parent was not hard-killed: ${firstResult.status}`)

    const outcomePromise = waitForState(
      sandbox.root,
      () => recordOutcome(sandbox.cwd),
      (value) => value !== undefined,
      DEFAULT_TIMEOUT_MS,
      stateAbort.signal,
    )
    const secondRun = startResumeRun({
      senpiBin,
      sandbox,
      mockProviderEntry,
      script: replacementRunScript(secondSentinel),
      sessionId: initialRecord.parent_session_id,
    })
    runs.push(secondRun)
    summary.replacementParentPid = secondRun.pid

    const outcome = await outcomePromise
    summary.outcome = outcome.kind
    summary.errorMessage = outcome.record.error_message
    writeFileSync(secondSentinel, "release\n")
    const secondResult = await secondRun.completion
    if (secondResult.status !== 0) {
      throw new Error(`replacement parent failed with status ${String(secondResult.status)}: ${secondResult.stderr}`)
    }

    const transcript = [
      "FIRST PARENT STDOUT",
      firstResult.stdout,
      "FIRST PARENT STDERR",
      firstResult.stderr,
      "REPLACEMENT PARENT STDOUT",
      secondResult.stdout,
      "REPLACEMENT PARENT STDERR",
      secondResult.stderr,
      "FINAL CHILD SESSION",
      childSessionText(sandbox.cwd, initialRecord.task_id),
    ].join("\n")
    writeArtifact(join(options.evidenceDir, "parent-restart-transcript.txt"), transcript)

    if (outcome.kind !== "continued") {
      throw new Error(outcome.record.error_message ?? `task ended with ${outcome.record.status}`)
    }
    if (outcome.record.task_id !== initialRecord.task_id) throw new Error("task id changed across parent restart")
  } finally {
    stateAbort.abort()
    for (const run of runs) run.kill()
    await Promise.all(runs.map((run) => run.completion))
    const leakedPids = runs.map((run) => run.pid).filter(processAlive)
    rmSync(sandbox.root, { recursive: true, force: true })
    summary.cleanup = {
      leakedPids,
      sandboxRemoved: !existsSync(sandbox.root),
    }
    writeArtifact(join(options.evidenceDir, "parent-restart-summary.json"), `${JSON.stringify(summary, null, 2)}\n`)
    if (leakedPids.length > 0 || !summary.cleanup.sandboxRemoved) {
      throw new Error(`cleanup failed: ${JSON.stringify(summary.cleanup)}`)
    }
  }

  console.log(`PASS parent_restart_process_child_recovered task=${summary.taskId}`)
}

function runSelfTest() {
  const parsed = parseArgs(["--evidence-dir", "./evidence", "--plugin-path", "./plugin"])
  if (parsed.evidenceDir !== resolve("./evidence")) throw new Error("evidence path parsing failed")
  if (parsed.pluginPath !== resolve("./plugin")) throw new Error("plugin path parsing failed")
  const continued = recordOutcomeFromValues("running", MIDTURN_CONTINUED_TOKEN)
  const lost = recordOutcomeFromValues("lost", "")
  if (continued !== "continued" || lost !== "lost") throw new Error("outcome classification failed")
}

function recordOutcomeFromValues(status, sessionText) {
  if (sessionText.includes(MIDTURN_CONTINUED_TOKEN)) return "continued"
  if (status === "lost") return "lost"
  return undefined
}

const options = parseArgs(process.argv.slice(2))
if (options.selfTest) {
  runSelfTest()
  console.log("SELF-TEST OK")
} else {
  await runScenario(options)
}
