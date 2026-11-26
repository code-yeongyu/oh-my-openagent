// Runs for the stack's composition tests (#15125 under #11381): a run created by the real DAG manager
// whose children the real TaskManager started through `startOwned`, with no scheduler of any process
// holding it. A test then writes the checkpoint a crash, a park or a settle would leave, so every
// entry under test (cancel, send, retry, recovery) decides from that record alone.
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { DagRunRecordV1 } from "../manager"
import { startSpec, taskOwner } from "../recovery-start"
import { createDagRunReservations, reserveWhenFree } from "../run-reservations"
import type { DagNode, DagNodeId, DagRunId } from "../types"
import { categoryNode, createE2eFixture, definition, identityMaterializer, parentSessionId } from "./controlled-dag-e2e"
import { ControlledRunner } from "./controlled-runner"

export const THIS_HOST = process.pid
export const DEAD_HOST = 2_147_483_000

export type Leased = DagRunRecordV1 & { readonly leaseHolderPid?: number }

export async function unscheduledRun(
  roots: string[],
  nodeIds: readonly string[],
  setup: { readonly connectable?: boolean; readonly start?: readonly string[] } = {},
) {
  const root = fs.mkdtempSync(join(tmpdir(), "senpi-dag-stack-"))
  roots.push(root)
  const runner = new ControlledRunner(undefined, { connectable: setup.connectable === true })
  const fixture = createE2eFixture({ project: root, runner, materializeSkills: identityMaterializer })
  const started = await fixture.manager.start({
    definition: definition("stack", nodeIds.map((id) => categoryNode(id))),
    parentSessionId,
    rootSessionId: parentSessionId,
  })
  const runId = started.snapshot.runId
  const created = fixture.manager.record(runId, parentSessionId)
  const tasks = new Map<string, string>()
  const toStart = setup.start ?? nodeIds
  for (const id of toStart) {
    const result = await fixture.taskManager.startOwned(startSpec(created, id as DagNodeId, 0), taskOwner(created, id as DagNodeId))
    if (result.kind !== "started") throw new Error(`node ${id} did not start: ${result.kind}`)
    tasks.set(id, result.task_id)
  }
  await runner.whenStarted(toStart.length)
  const sendCalls: string[] = []
  const taskManager = new Proxy(fixture.taskManager, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target)
      if (property === "sendToTask" && typeof value === "function")
        return (input: { readonly idOrName: string }) => {
          sendCalls.push(input.idOrName)
          return value.call(target, input)
        }
      return typeof value === "function" ? value.bind(target) : value
    },
  })
  const taskOf = (id: string): string => tasks.get(id) ?? ""
  /** Writes the checkpoint a crash, park or settle would leave: `nodes` keeps only the listed nodes. */
  const write = (
    status: DagRunRecordV1["status"],
    nodes: Readonly<Record<string, Partial<DagNode>>>,
    extra: Partial<Leased> = {},
  ): Leased => {
    const base = fixture.manager.record(runId, parentSessionId)
    const kept = new Set(Object.keys(nodes))
    const record: Leased = {
      ...base,
      status,
      definition: { ...base.definition, nodes: base.definition.nodes.filter((node) => kept.has(node.id)) },
      nodes: base.nodes.filter((node) => kept.has(node.id)).map((node) => ({ ...node, ...nodes[node.id] })),
      waves: [{ index: 0, nodeIds: [...kept] as DagNodeId[] }],
      edges: [],
      criticalPath: [],
      ...extra,
    }
    fixture.store.writeCheckpoint(runId, record)
    return record
  }
  const read = () => fixture.store.readCheckpoint<Leased>(runId)
  const reservations = createDagRunReservations()
  const isProcessAlive = (pid: number): boolean => pid === THIS_HOST
  const options = { store: fixture.store, taskManager, hostPid: THIS_HOST, isProcessAlive }
  /** Runs `verb` the way the runtime's controls do: under the run's reservation, from the fresh record. */
  const reserved = async <T>(operation: string, verb: (context: VerbContext) => T | Promise<T>): Promise<T> => {
    const reservation = await reserveWhenFree(reservations, runId as DagRunId, operation)
    try {
      return await verb({ ...options, initialRecord: read() ?? created, reservation, reservations })
    } finally {
      reservation.release()
    }
  }
  return { fixture, runner, runId: runId as DagRunId, taskOf, write, read, reservations, options, sendCalls, reserved }
}

type VerbContext = {
  readonly store: ReturnType<typeof createE2eFixture>["store"]
  readonly taskManager: ReturnType<typeof createE2eFixture>["taskManager"]
  readonly hostPid: number
  readonly isProcessAlive: (pid: number) => boolean
  readonly initialRecord: DagRunRecordV1
  readonly reservation: Awaited<ReturnType<typeof reserveWhenFree>>
  readonly reservations: ReturnType<typeof createDagRunReservations>
}

export async function answerOf(verb: () => unknown): Promise<string> {
  try {
    await verb()
    return "accepted"
  } catch (error) {
    return (error as { readonly code?: string }).code ?? String(error)
  }
}
