#!/usr/bin/env bun

import { createHash } from "node:crypto"
import { existsSync, lstatSync, readFileSync, readdirSync, rmSync, watch, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { runSenpiInstaller } from "../../src/install/install-senpi.ts"
import { OMO_SENPI_TASK_RPC_CHILD } from "../../../senpi-task/src/runners/rpc/spawn.ts"
import { createSandbox } from "./drive.mjs"
import {
  findCommand,
  parseArgs,
  processAlive,
  waitForState,
  writeArtifact,
} from "./task-parent-restart-runtime.mjs"
import {
  childSessionHasAssistant,
  findTaskByName,
  seedResumeProject,
  sessionIdFromEvents,
  startResumeRun,
  taskEventText,
  taskStateDir,
} from "./resume-e2e-runtime.mjs"
import {
  NESTED_RECOVERY_CHILD,
  NESTED_RECOVERY_PARENT,
} from "./task-resume-e2e-mock-provider.ts"
import { terminateProcessTree } from "./team-e2e-process.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "../../../..")
const mockProviderEntry = join(scriptDir, "task-resume-e2e-mock-provider.ts")
const DEFAULT_TIMEOUT_MS = 45_000
const NO_REATTACH_WINDOW_MS = 3_000

const nestedConfig = {
  task: {
    default_execution_mode: "process",
    reattach_on_reconcile: true,
    resume_children: true,
  },
  categories: {
    mockcat: {
      description: "Process-mode nested recovery fixture.",
      model: "omo-mock/mock-1",
    },
  },
}

const parentScript = {
  parentSteps: [{ type: "text", text: "parent fallback" }],
}

async function runScenario(options) {
  if (options.evidenceDir === undefined) throw new Error("--evidence-dir is required")
  const realSenpiAgentDir = join(homedir(), ".senpi", "agent")
  const realSenpiBefore = snapshotTree(realSenpiAgentDir)
  const sandbox = createSandbox()
  const stateAbort = new AbortController()
  const runs = []
  const ownedPids = new Set()
  const summary = {
    pluginMode: options.pluginPath === undefined ? "fresh-source-install" : "explicit-plugin",
    pluginPath: options.pluginPath ?? join(repoRoot, "packages", "omo-senpi", "plugin"),
    parentSessionId: undefined,
    nestedTaskId: undefined,
    originalNestedPid: undefined,
    observedNestedPid: undefined,
    recursiveReconcileObserved: false,
    reconcileEventObserved: false,
    isolatedAgentDir: sandbox.agentDir,
    realSenpiAgentDir,
    realSenpiUntouched: undefined,
    cleanup: undefined,
  }
  let failure

  try {
    seedResumeProject(sandbox, nestedConfig)
    if (options.pluginPath === undefined) {
      await runSenpiInstaller({ agentDir: sandbox.agentDir, homeDir: sandbox.homeDir, repoRoot })
    } else {
      const settingsPath = join(sandbox.agentDir, "settings.json")
      const settings = JSON.parse(readFileSync(settingsPath, "utf8"))
      settings.packages = [options.pluginPath]
      writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)
    }

    const senpiBin = findCommand("senpi")
    const firstRecordPromise = waitForState(
      sandbox.root,
      () => findTaskByName(sandbox.cwd, NESTED_RECOVERY_CHILD),
      (record) =>
        record !== undefined &&
        record.status === "running" &&
        typeof record.pid === "number" &&
        childSessionHasAssistant(sandbox.cwd, record.task_id),
      DEFAULT_TIMEOUT_MS,
      stateAbort.signal,
    )
    const first = startResumeRun({
      senpiBin,
      sandbox,
      mockProviderEntry,
      script: parentScript,
      prompt: `You are running as an omo senpi-task child. ${NESTED_RECOVERY_PARENT}`,
      extraEnv: { [OMO_SENPI_TASK_RPC_CHILD]: "1" },
      onPid: (pid) => ownedPids.add(pid),
      onClose: (pid) => ownedPids.delete(pid),
    })
    runs.push(first)

    const nested = await firstRecordPromise
    summary.nestedTaskId = nested.task_id
    summary.originalNestedPid = nested.pid
    ownedPids.add(nested.pid)

    first.kill()
    const firstResult = await first.completion
    summary.parentSessionId = sessionIdFromEvents(firstResult.events)
    if (summary.parentSessionId === undefined) throw new Error("first marked child emitted no session id")
    await terminateProcessTree(nested.pid)
    ownedPids.delete(nested.pid)

    const observed = observeNestedPid(
      taskStateDir(sandbox.cwd),
      nested.task_id,
      nested.pid,
      NO_REATTACH_WINDOW_MS,
    )
    const second = startResumeRun({
      senpiBin,
      sandbox,
      mockProviderEntry,
      script: parentScript,
      sessionId: summary.parentSessionId,
      prompt: `resume ${NESTED_RECOVERY_PARENT}`,
      extraEnv: { [OMO_SENPI_TASK_RPC_CHILD]: "1" },
      onPid: (pid) => ownedPids.add(pid),
      onClose: (pid) => ownedPids.delete(pid),
    })
    runs.push(second)

    const observation = await observed
    summary.observedNestedPid = observation.pid
    summary.recursiveReconcileObserved = observation.changed
    summary.reconcileEventObserved = taskEventText(sandbox.cwd, nested.task_id).includes("reconcile_reattached")
    if (typeof observation.pid === "number") ownedPids.add(observation.pid)
    if (observation.changed || summary.reconcileEventObserved) {
      failure = new Error(
        `marked RPC child recursively reconciled nested task ${nested.task_id}: ` +
        `oldPid=${nested.pid} newPid=${String(observation.pid)}`,
      )
    }
  } catch (error) {
    failure = error
  } finally {
    stateAbort.abort()
    for (const run of runs) run.kill()
    await Promise.all(runs.map((run) => run.completion))
    const current = summary.nestedTaskId === undefined
      ? undefined
      : findTaskByName(sandbox.cwd, NESTED_RECOVERY_CHILD)
    if (typeof current?.pid === "number") ownedPids.add(current.pid)
    for (const pid of ownedPids) await terminateProcessTree(pid)
    const leakedPids = [...ownedPids].filter(processAlive)
    rmSync(sandbox.root, { recursive: true, force: true })
    summary.realSenpiUntouched = snapshotTree(realSenpiAgentDir) === realSenpiBefore
    summary.cleanup = {
      leakedPids,
      sandboxRemoved: !existsSync(sandbox.root),
    }
    writeArtifact(
      join(options.evidenceDir, "task-child-reconcile-summary.json"),
      `${JSON.stringify(summary, null, 2)}\n`,
    )
    if (leakedPids.length > 0 || !summary.cleanup.sandboxRemoved || !summary.realSenpiUntouched) {
      failure = new Error(`cleanup failed: ${JSON.stringify(summary.cleanup)}`)
    }
  }

  if (failure !== undefined) throw failure
  console.log(`PASS marked_rpc_child_did_not_reconcile_nested_task task=${summary.nestedTaskId}`)
}

function snapshotTree(root) {
  if (!existsSync(root)) return "absent"
  const hash = createHash("sha256")
  const visit = (path) => {
    const entries = readdirSync(path, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const child = join(path, entry.name)
      const stats = lstatSync(child)
      hash.update(`${relative(root, child)}\0${stats.mode}\0${stats.size}\0${stats.mtimeMs}\0`)
      if (entry.isDirectory()) visit(child)
    }
  }
  visit(root)
  return hash.digest("hex")
}

function observeNestedPid(stateDir, taskId, originalPid, windowMs) {
  const taskPath = join(stateDir, "tasks", `${taskId}.json`)
  const read = () => {
    const record = JSON.parse(readFileSync(taskPath, "utf8"))
    const pid = typeof record.pid === "number" ? record.pid : undefined
    return { changed: pid !== undefined && pid !== originalPid, pid }
  }
  return new Promise((resolveObservation, reject) => {
    let settled = false
    let timer
    let watcher
    const finish = (value, error) => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      watcher?.close()
      if (error !== undefined) reject(error)
      else resolveObservation(value)
    }
    const check = () => {
      try {
        const value = read()
        if (value.changed) finish(value)
      } catch (error) {
        finish(undefined, error)
      }
    }
    watcher = watch(dirname(taskPath), check)
    timer = setTimeout(() => finish(read()), windowMs)
    queueMicrotask(check)
  })
}

function runSelfTest() {
  const options = parseArgs(["--evidence-dir", "./evidence", "--plugin-path", "./plugin"])
  if (options.evidenceDir !== resolve("./evidence")) throw new Error("evidence path parsing failed")
  if (options.pluginPath !== resolve("./plugin")) throw new Error("plugin path parsing failed")
  if (nestedConfig.task.reattach_on_reconcile !== true) throw new Error("fixture must exercise enabled reattach")
  if (nestedConfig.task.resume_children !== true) throw new Error("fixture must exercise enabled child resume")
}

const options = parseArgs(process.argv.slice(2))
if (options.selfTest) {
  runSelfTest()
  console.log("SELF-TEST OK")
} else {
  await runScenario(options)
}
