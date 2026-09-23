import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { createRunRoot, provisionRuntime, injectDaemonMockProvider, createScenarioSandbox } from "./task-host-e2e-sandbox.mjs"
import { readTaskRecords, spawnParent, cleanupScenario, sandboxProcesses } from "./task-host-e2e-process.mjs"
import { generationHostPid } from "./task-host-e2e-daemon-state.mjs"
import { CHILD_BUSY, hostConfig, spawnScript, jsonlLines } from "./task-host-e2e-support.mjs"
import { observeState, stopParent } from "./task-host-e2e-events.mjs"

// Read the store on both sides of the transcript read: do not combine different task epochs.
export function terminalChildSnapshots(sandbox) {
  return readTaskRecords(sandbox).flatMap((record) => {
    const path = record.host_session?.session_path
    if (!path) return []
    const storePath = join(sandbox.stateDir, "tasks", `${record.task_id}.json`)
    const storeBefore = readFileSync(storePath, "utf8")
    const rows = jsonlLines(path).map((line) => JSON.parse(line))
    const storeAfter = readFileSync(storePath, "utf8")
    if (storeBefore !== storeAfter) return []
    const store = JSON.parse(storeAfter)
    const messages = rows.filter((row) => row.type === "message")
    const terminal = messages.at(-1)
    if (terminal?.message?.role !== "assistant" ||
      !["aborted", "error"].includes(terminal.message.stopReason)) return []
    return [{
      observedAt: new Date().toISOString(),
      taskId: store.task_id,
      taskName: store.name,
      storeStatus: store.status,
      storeUpdatedAt: store.updated_at,
      runEpoch: store.notification?.run_epoch,
      terminalEntry: terminal,
      sessionPath: path,
      storeStableDuringRead: true,
    }]
  })
}

async function diagnose(bin, out) {
  mkdirSync(out, { recursive: true })
  const runRoot = createRunRoot()
  const runtime = provisionRuntime(bin, runRoot)
  const mockEntry = join(dirname(fileURLToPath(import.meta.url)), "task-e2e-mock-provider.ts")
  injectDaemonMockProvider(runtime.pluginRoot, mockEntry)
  const sandbox = createScenarioSandbox({ runRoot, home: runtime.home, bin }, "sA1", {
    omoConfig: hostConfig(), script: spawnScript(16, CHILD_BUSY, "s"),
  })
  let parent
  let receipt
  const evidence = { binary: bin, runRoot, observationMs: 60_000 }
  try {
    evidence.first = await observeState(sandbox.root, () => {
      const rows = terminalChildSnapshots(sandbox).filter((row) => row.storeStatus === "running")
      return rows.length ? rows : undefined
    }, { timeoutMs: 180_000, trigger: () => {
      parent = spawnParent(sandbox, mockEntry, "fan out sixteen daemon children from one parent", { capture: true })
    } })
    writeFileSync(join(out, "first.json"), `${JSON.stringify(evidence, null, 2)}\n`)
    console.log(`STRANDED_FIRST ${JSON.stringify(evidence.first ?? [])}`)
    if (evidence.first) {
      const ids = new Set(evidence.first.map((row) => row.taskId))
      evidence.converged = await observeState(sandbox.root, () => {
        const records = readTaskRecords(sandbox).filter((row) => ids.has(row.task_id))
        return records.length === ids.size && records.every((row) =>
          ["completed", "error", "lost", "cancelled"].includes(row.status)) ? records : undefined
      }, { timeoutMs: evidence.observationMs })
      evidence.after = terminalChildSnapshots(sandbox).filter((row) => ids.has(row.taskId))
      evidence.storeAfter = readTaskRecords(sandbox).filter((row) => ids.has(row.task_id))
      evidence.pendingAfter = readTaskRecords(sandbox).filter((row) => row.status === "pending").length
    }
    evidence.parentOutput = parent.chunks.stdout
  } finally {
    await stopParent(parent)
    receipt = await cleanupScenario(sandbox, { hostPids: [generationHostPid(sandbox.agentDir)].filter(Boolean) })
    const survivors = sandboxProcesses({ root: runRoot })
    if (survivors.length === 0) rmSync(runRoot, { recursive: true, force: true })
    evidence.cleanup = { receipt, survivors, runRootRemoved: survivors.length === 0 }
    writeFileSync(join(out, "convergence.json"), `${JSON.stringify(evidence, null, 2)}\n`)
  }
  console.log(`STRANDED_RESULT ${JSON.stringify({
    matched: evidence.first?.length ?? 0, converged: evidence.converged !== undefined,
    after: evidence.after?.map((row) => ({ taskId: row.taskId, storeStatus: row.storeStatus, stopReason: row.terminalEntry.message.stopReason })),
    cleanup: evidence.cleanup,
  })}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  await diagnose(resolve(args[args.indexOf("--bin") + 1]), resolve(args[args.indexOf("--out") + 1]))
}
