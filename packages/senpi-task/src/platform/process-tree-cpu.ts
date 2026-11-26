import { readParentPids, readProcessCpuSeconds, readProcessStartTime } from "./native-process"

export interface ProcessTable {
  readonly parents: ReadonlyMap<number, number>
  readonly cpuSeconds: (pid: number) => number | null
  /** A start stamp that orders processes by creation on this platform, or null when it cannot be read. */
  readonly startTime: (pid: number) => bigint | null
}

/**
 * CPU seconds of the process rooted at `pid` plus every live descendant, or null when the root cannot be read.
 *
 * A process counts as a child of the parent it names only if it was not created before that parent. Windows records
 * the parent pid at creation and never updates it, and it reuses pids, so a long-lived process whose original parent
 * has exited can name a fresh pid as its parent; without the check its whole lifetime of CPU lands in the new
 * process's tree (#13953).
 */
export function sumProcessTreeCpuSeconds(pid: number, table: ProcessTable): number | null {
  const root = table.cpuSeconds(pid)
  if (root === null) return null
  const children = new Map<number, number[]>()
  for (const [child, parent] of table.parents) {
    if (child === parent) continue
    const siblings = children.get(parent)
    if (siblings === undefined) children.set(parent, [child])
    else siblings.push(child)
  }
  let total = root
  const seen = new Set([pid])
  const pending = (children.get(pid) ?? []).map((child) => ({ child, parent: pid }))
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (seen.has(next.child) || bornBefore(next.child, next.parent, table)) continue
    seen.add(next.child)
    total += table.cpuSeconds(next.child) ?? 0
    pending.push(...(children.get(next.child) ?? []).map((child) => ({ child, parent: next.child })))
  }
  return total
}

function bornBefore(child: number, parent: number, table: ProcessTable): boolean {
  const childStart = table.startTime(child)
  const parentStart = table.startTime(parent)
  return childStart !== null && parentStart !== null && childStart < parentStart
}

/**
 * The live tree CPU of `pid`. A launcher that spawns the real engine as its own child (an npm shim, a wrapper script)
 * stays CPU-flat while the engine works, so a progress bound on the launcher alone would call a booting engine
 * stalled (#14820).
 */
export function readProcessTreeCpuSeconds(pid: number): number | null {
  const parents = readParentPids()
  if (parents === null) return readProcessCpuSeconds(pid)
  return sumProcessTreeCpuSeconds(pid, {
    parents,
    cpuSeconds: readProcessCpuSeconds,
    startTime: readProcessStartTime,
  })
}
