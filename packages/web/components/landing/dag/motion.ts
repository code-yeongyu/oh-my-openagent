import type { DagState, DagWave } from "./types"

/** Port of the desktop app's workflowMotion helpers. Everything here is pure. */
export interface NodeEntryTiming {
  readonly durationMs: number
  readonly delayMs: number
}

/** Wave-advance cascade: each node enters `staggerMs` after the previous one. */
export function nodeEntryDelay(index: number, baseMs = 260, staggerMs = 60): NodeEntryTiming {
  return { durationMs: baseMs, delayMs: Math.min(index, 10) * staggerMs }
}

/** Dependency edges draw only on their source node's pending → running/completed transition. */
export function shouldDrawEdge(previous: DagState | undefined, next: DagState): boolean {
  return previous === "pending" && (next === "running" || next === "completed")
}

export function isClickGesture(
  downX: number,
  downY: number,
  upX: number,
  upY: number,
  thresholdPx = 4,
): boolean {
  return Math.hypot(upX - downX, upY - downY) < thresholdPx
}

const TERMINAL_STATES: ReadonlySet<DagState> = new Set<DagState>(["completed", "failed"])

/** The first wave still holding a non-terminal node; null once the run is over. */
export function waveUnderlineTarget(
  waves: readonly DagWave[],
  stateByNodeId: ReadonlyMap<string, DagState>,
): number | null {
  for (const wave of waves) {
    const open = wave.nodeIds.some(
      (nodeId) => !TERMINAL_STATES.has(stateByNodeId.get(nodeId) ?? "pending"),
    )
    if (open) return wave.index
  }
  return null
}

export function diffNodeStates(
  previous: ReadonlyMap<string, DagState>,
  next: ReadonlyMap<string, DagState>,
): ReadonlySet<string> {
  const changed = new Set<string>()
  for (const [id, state] of next) {
    const prior = previous.get(id)
    if (prior !== undefined && prior !== state) changed.add(id)
  }
  return changed
}

export function easeInOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t))
  return c < 0.5 ? 4 * c ** 3 : 1 - (-2 * c + 2) ** 3 / 2
}

/**
 * `@keyframes` body for one edge's travelling light. Only transform and opacity are
 * animated, positions baked in as literal translations — the one legal shape for a
 * smooth infinite animation under DESIGN.md §6. Run it `linear`; the easing already
 * lives in the sample spacing.
 */
export function edgeLightKeyframes(
  name: string,
  points: readonly { readonly x: number; readonly y: number }[],
  size: number,
  fadeFraction = 0.12,
): string {
  const half = size / 2
  const stops = points.map((point, index) => {
    const progress = points.length < 2 ? 0 : index / (points.length - 1)
    const rampIn = progress / fadeFraction
    const rampOut = (1 - progress) / fadeFraction
    const opacity = Math.min(1, Math.max(0, Math.min(rampIn, rampOut)))
    const x = Math.round((point.x - half) * 100) / 100
    const y = Math.round((point.y - half) * 100) / 100
    return `${Math.round(progress * 10000) / 100}%{transform:translate3d(${x}px,${y}px,0);opacity:${Math.round(opacity * 100) / 100}}`
  })
  return `@keyframes ${name}{${stops.join("")}}`
}
