#!/usr/bin/env bun
// Live QA for #8674: what the MODEL actually sees from `workflow action=snapshot` after a node
// settles and while a node's child has gone quiet. Drives the real surfaces end to end - a real
// on-disk DagFileStore and TaskRecordStore, the real DagManager, the real DagScheduler, the real
// TaskManager, and the real runDagTool. No senpi spawn: same precedent as dag-gate-proof.ts and
// dag-wait-detach-qa.ts, where the engine + adapter composition IS the surface under test.
// Writes <out-dir>/dag-node-projection-qa.json and exits non-zero on violation.
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"
import {
  createDagFileStore,
  createDagManager,
  createDagScheduler,
  type DagRunId,
} from "@oh-my-opencode/senpi-task/dag"
import { createTaskManager, createTaskRecordStore } from "@oh-my-opencode/senpi-task"

import { runDagTool, type DagToolResult } from "../../src/components/task/dag-tool"
import type { ManagedChildHandle } from "../../../senpi-task/src/manager/child-handle"
import type { ChildPlanner, ManagedRunner, ManagedStartSpec } from "../../../senpi-task/src/manager/types"
import { taskEventLogPath } from "../../../senpi-task/src/store/event-log"
import { resolveOutDirArg } from "./out-dir-arg"

const PARENT_SESSION = "session-node-projection-qa"
const CLONE_SOURCES_CLAIM = "cloned 42 source rows into sources.html; 21/21 class hooks used"
const outDir = resolveOutDirArg(process.argv.slice(2), join(tmpdir(), "dag-node-projection-qa"))
const failures: string[] = []

type Settle = { readonly status: "completed"; readonly finalResponse: string }

const settlers = new Map<string, (outcome: Settle) => void>()
const emitters = new Map<string, () => void>()

const runner: ManagedRunner = {
  start(spec: ManagedStartSpec): Promise<ManagedChildHandle> {
    const id = spec.prompt.replace(/^do /, "")
    const listeners = new Set<(event: { readonly type: string; readonly message: unknown }) => void>()
    let resolveOutcome: ((outcome: Settle) => void) | undefined
    const outcome = new Promise<Settle>((resolve) => {
      resolveOutcome = resolve
    })
    settlers.set(id, (value) => resolveOutcome?.(value))
    emitters.set(id, () => {
      for (const listener of listeners) {
        listener({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: `${id} progress` }] } })
      }
    })
    return Promise.resolve({
      task_id: spec.taskId,
      sessionId: `child-${spec.taskId}`,
      pid: undefined,
      steer: () => Promise.resolve(),
      followUp: () => Promise.resolve(),
      abort: () => Promise.resolve(),
      subscribe: (listener) => {
        listeners.add(listener as never)
        return () => listeners.delete(listener as never)
      },
      waitForOutcome: () => outcome,
      lastAssistantText: () => undefined,
      dispose: () => Promise.resolve(),
    } as ManagedChildHandle)
  },
}

const planner: ChildPlanner = (spec) => ({
  kind: "resolved",
  plan: { model: `scripted/${spec.category ?? "default"}`, ...(spec.category === undefined ? {} : { category: spec.category }) },
})

const projectDir = fs.mkdtempSync(join(tmpdir(), "dag-node-projection-qa-"))
const store = createDagFileStore({ project_dir: projectDir })
const taskManager = createTaskManager({
  store: createTaskRecordStore({ project_dir: projectDir }),
  runners: { "in-process": runner, process: runner },
  planner,
  config: OmoTaskSettingsSchema.parse({ default_concurrency: 16, max_depth: 1 }),
  cwd: projectDir,
})
const manager = createDagManager({ store, newRunId: () => "run-node-projection" as DagRunId })
const deps = { manager, parentSessionId: () => PARENT_SESSION, rootSessionId: () => PARENT_SESSION }

await runDagTool(deps, {
  action: "start",
  definition: {
    key: "node-projection-qa",
    name: "node projection qa",
    nodes: [
      { id: "clone-profile", prompt: "do clone-profile", category: "quick" },
      { id: "clone-sources", prompt: "do clone-sources", category: "quick" },
    ],
  },
})
const runId = "run-node-projection" as DagRunId
const scheduler = createDagScheduler({ store, taskManager, initialRecord: manager.record(runId, PARENT_SESSION) })
const run = scheduler.run()

await until(() => manager.record(runId, PARENT_SESSION).nodes.every((node) => node.taskId !== undefined))
emitters.get("clone-profile")?.()
emitters.get("clone-sources")?.()
settlers.get("clone-sources")?.({ status: "completed", finalResponse: CLONE_SOURCES_CLAIM })
await until(() => manager.record(runId, PARENT_SESSION).nodes.some((node) => node.id === "clone-sources" && node.state === "completed"))

const quietTaskId = manager.record(runId, PARENT_SESSION).nodes.find((node) => node.id === "clone-profile")?.taskId ?? ""
const quietSince = new Date(Date.now() - 51 * 60_000)
fs.utimesSync(taskEventLogPath(store.stateDir, quietTaskId), quietSince, quietSince)

const snapshot = await runDagTool(deps, { action: "snapshot", run_id: runId })
const modelVisibleText = snapshot.content[0]?.type === "text" ? snapshot.content[0].text : "(non-text)"
const nodes = snapshotNodes(snapshot)

const completed = nodes.find((node) => node.id === "clone-sources")
const quiet = nodes.find((node) => node.id === "clone-profile")
if (completed?.output !== CLONE_SOURCES_CLAIM) {
  failures.push(`settled node did not carry its child's claim: ${JSON.stringify(completed?.output)}`)
}
if (completed?.outputBytes !== Buffer.byteLength(CLONE_SOURCES_CLAIM, "utf8")) {
  failures.push(`settled node outputBytes wrong: ${String(completed?.outputBytes)}`)
}
if (completed?.completedAt === undefined) failures.push("settled node carried no completedAt")
if (quiet?.lastActivityAt !== quietSince.toISOString()) {
  failures.push(`quiet node activity clock wrong: ${String(quiet?.lastActivityAt)}`)
}
if (!modelVisibleText.includes("Quiet children, no transcript activity: clone-profile (51m)")) {
  failures.push(`model-visible text did not name the quiet child: ${modelVisibleText}`)
}

settlers.get("clone-profile")?.({ status: "completed", finalResponse: "profile.html written" })
await run

const report = {
  what_was_tested: "workflow action=snapshot against a real DagManager/DagScheduler/TaskManager, one settled node and one running node whose child last wrote 51 minutes ago",
  model_visible_text: modelVisibleText,
  settled_node: completed,
  quiet_node: quiet,
  failures,
}
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(join(outDir, "dag-node-projection-qa.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8")
fs.rmSync(projectDir, { recursive: true, force: true })

console.log("=== model-visible snapshot text ===")
console.log(modelVisibleText)
console.log("=== settled node projection ===")
console.log(JSON.stringify(completed, null, 2))
console.log("=== quiet node projection ===")
console.log(JSON.stringify(quiet, null, 2))
if (failures.length > 0) {
  console.error(`FAILURES:\n${failures.join("\n")}`)
  process.exit(1)
}
console.log(`OK - report written to ${join(outDir, "dag-node-projection-qa.json")}`)

type ProjectedNode = {
  readonly id: string
  readonly state: string
  readonly output?: string
  readonly outputBytes?: number
  readonly completedAt?: string
  readonly lastActivityAt?: string
}

function snapshotNodes(result: DagToolResult): readonly ProjectedNode[] {
  return result.details.kind === "snapshot" ? result.details.snapshot.nodes : []
}

async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 2000 && !predicate(); attempt += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  if (!predicate()) throw new Error("condition never became true")
}
