import { LOOP_MS, NODE_SPECS, RUN_NAME, TIMELINE, WAVES } from "./scenario-data"
import type { DagEdge, DagNode, DagRun, DagState } from "./types"

const EDGES: readonly DagEdge[] = NODE_SPECS.flatMap((node) =>
  node.dependsOn.map((from) => ({ from, to: node.id })),
)

/** Snapshot of the scripted run at `clockMs` (within one loop). Mirrors a live ThreadDagRun. */
export function runAt(clockMs: number): DagRun {
  const clock = Math.max(0, Math.min(clockMs, LOOP_MS))
  const nodes: DagNode[] = NODE_SPECS.map((spec) => {
    let state: DagState = "pending"
    let activity: string | undefined
    let startedAtMs: number | undefined
    let finishedAtMs: number | undefined
    for (const event of TIMELINE) {
      if (event.atMs > clock || event.nodeId !== spec.id) continue
      state = event.state
      activity = event.activity
      if (startedAtMs === undefined && event.state !== "pending") startedAtMs = event.atMs
      if (event.state === "completed" || event.state === "failed") finishedAtMs = event.atMs
    }
    return { ...spec, state, activity, startedAtMs, finishedAtMs }
  })
  const started = nodes.some((node) => node.state !== "pending")
  const done = nodes.every((node) => node.state === "completed" || node.state === "failed")
  return {
    name: RUN_NAME,
    status: done ? "completed" : started ? "running" : "pending",
    nodes,
    waves: WAVES,
    edges: EDGES,
  }
}

export const FINAL_RUN: DagRun = runAt(LOOP_MS)

/** Index of the last timeline event at or before `clockMs`; -1 before the first. */
export function eventIndexAt(clockMs: number): number {
  let index = -1
  for (let i = 0; i < TIMELINE.length; i += 1) {
    if ((TIMELINE[i]?.atMs ?? Infinity) <= clockMs) index = i
  }
  return index
}

export interface WaveActivity {
  readonly index: number
  readonly total: number
  readonly completed: number
  readonly running: number
  readonly failed: number
}

export function waveActivitySummary(run: DagRun): readonly WaveActivity[] {
  const stateById = new Map(run.nodes.map((node) => [node.id, node.state] as const))
  return run.waves.map((wave) => {
    let completed = 0
    let running = 0
    let failed = 0
    for (const nodeId of wave.nodeIds) {
      const state = stateById.get(nodeId) ?? "pending"
      if (state === "completed") completed += 1
      else if (state === "running") running += 1
      else if (state === "failed") failed += 1
    }
    return { index: wave.index, total: wave.nodeIds.length, completed, running, failed }
  })
}

export function currentWaveLabel(run: DagRun): string {
  const total = run.waves.length
  const states = new Map(run.nodes.map((node) => [node.id, node.state] as const))
  const openIndex = run.waves.findIndex((wave) =>
    wave.nodeIds.some((id) => {
      const state = states.get(id) ?? "pending"
      return state !== "completed" && state !== "failed"
    }),
  )
  return `wave ${openIndex === -1 ? total : openIndex + 1}/${total}`
}

/** "6/10 done · 3 running · 7 models" — the panel header line. */
export function runSummary(run: DagRun): string {
  const done = run.nodes.filter((node) => node.state === "completed").length
  const running = run.nodes.filter((node) => node.state === "running").length
  const blocked = run.nodes.filter((node) => node.state === "blocked").length
  const models = new Set(run.nodes.map((node) => node.model)).size
  return [
    `${done}/${run.nodes.length} done`,
    running > 0 ? `${running} running` : null,
    blocked > 0 ? `${blocked} blocked` : null,
    `${models} models`,
  ]
    .filter((part) => part !== null)
    .join(" · ")
}

/** Elapsed seconds for a card's "running · 3s" text, in scenario time. */
export function nodeElapsedSeconds(node: DagNode, clockMs: number): number | undefined {
  if (node.startedAtMs === undefined) return undefined
  const end = node.finishedAtMs ?? clockMs
  return Math.max(0, Math.round((end - node.startedAtMs) / 1000))
}

export interface FeedLine {
  readonly key: string
  readonly nodeId: string
  readonly state: DagState
  readonly text: string
}

/** The last `limit` activity lines at `clockMs`, newest last (the desktop activity feed). */
export function feedAt(clockMs: number, limit = 3): readonly FeedLine[] {
  const modelById = new Map(NODE_SPECS.map((node) => [node.id, node.model]))
  return TIMELINE.filter((event) => event.atMs <= clockMs)
    .slice(-limit)
    .map((event) => ({
      key: `${event.atMs}:${event.nodeId}`,
      nodeId: event.nodeId,
      state: event.state,
      text: `${event.nodeId} · ${modelById.get(event.nodeId) ?? ""} — ${event.activity}`,
    }))
}
