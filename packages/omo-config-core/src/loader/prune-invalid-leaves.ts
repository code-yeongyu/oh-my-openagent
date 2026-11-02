import type * as z from "zod"

/**
 * Bounded surgical pruning of invalid config values.
 *
 * One bad value must not take down the file that carries it: every validation issue names a path,
 * and the loader drops only the smallest subtree that fails (the value at that path, or the object
 * that lacks a required key), keeps every healthy sibling at every depth, and re-validates after
 * each pass until the document parses. A container left empty because every child was dropped
 * goes with them, so a document with nothing valid left comes back empty. If the pass bound is hit,
 * or an issue targets the document root, the caller rejects the whole layer fail-closed (old
 * totality preserved as the last resort, never the first).
 */

export type ConfigPathSegment = string | number

export type PrunedConfigPath = {
  /** Dotted key of the dropped value, e.g. `task.host_engine_policy` or `teams.alpha.members.0.color`. */
  readonly key: string
  readonly message: string
  readonly path: readonly ConfigPathSegment[]
}

export type PruneResult =
  | { readonly ok: true; readonly config: Record<string, unknown>; readonly dropped: readonly PrunedConfigPath[] }
  | { readonly ok: false; readonly dropped: readonly PrunedConfigPath[] }

export type PruneValidator = (
  candidate: Record<string, unknown>,
) => { readonly success: true } | { readonly success: false; readonly issues: readonly z.core.$ZodIssue[] }

/** Each pass drops every path the current issues name, so a real document settles in a few passes. */
export const MAX_PRUNE_PASSES = 32

type Container = Record<string, unknown> | unknown[]

function isContainer(value: unknown): value is Container {
  return typeof value === "object" && value !== null
}

function childOf(container: Container, segment: ConfigPathSegment): unknown {
  return Array.isArray(container) ? container[Number(segment)] : container[String(segment)]
}

function hasChild(container: Container, segment: ConfigPathSegment): boolean {
  if (Array.isArray(container)) {
    const index = Number(segment)
    return Number.isInteger(index) && index >= 0 && index < container.length
  }
  return Object.hasOwn(container, String(segment))
}

function segmentsOf(path: readonly PropertyKey[]): ConfigPathSegment[] {
  return path.map((segment) => typeof segment === "number" ? segment : String(segment))
}

/**
 * The smallest subtree an issue condemns: the deepest prefix of its path that exists in the
 * document. A wrong value resolves to its own path; a missing required key resolves to the object
 * that lacks it. An empty result means the issue is about the document root itself.
 */
function targetPaths(root: Record<string, unknown>, issue: z.core.$ZodIssue): ConfigPathSegment[][] {
  const base = segmentsOf(issue.path)
  if (issue.code === "unrecognized_keys") return issue.keys.map((key) => [...base, key])
  let node: unknown = root
  let depth = 0
  for (const segment of base) {
    if (!isContainer(node) || !hasChild(node, segment)) break
    node = childOf(node, segment)
    depth += 1
  }
  return [base.slice(0, depth)]
}

function isAncestor(ancestor: readonly ConfigPathSegment[], path: readonly ConfigPathSegment[]): boolean {
  return ancestor.length < path.length && ancestor.every((segment, index) => segment === path[index])
}

// Later array indices first, so removing one element never shifts a path still waiting to be removed.
function compareDescending(left: readonly ConfigPathSegment[], right: readonly ConfigPathSegment[]): number {
  const length = Math.min(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const a = left[index]
    const b = right[index]
    if (a === b) continue
    if (typeof a === "number" && typeof b === "number") return b - a
    return String(b).localeCompare(String(a))
  }
  return right.length - left.length
}

function removeChild(container: Container, segment: ConfigPathSegment): void {
  if (Array.isArray(container)) container.splice(Number(segment), 1)
  else delete container[String(segment)]
}

function isEmpty(container: Container): boolean {
  return Array.isArray(container) ? container.length === 0 : Object.keys(container).length === 0
}

function removePathAndEmptiedAncestors(root: Record<string, unknown>, path: readonly ConfigPathSegment[]): void {
  const chain: Container[] = [root]
  for (const segment of path.slice(0, -1)) {
    const current = chain[chain.length - 1]
    if (current === undefined) return
    const next = childOf(current, segment)
    if (!isContainer(next)) return
    chain.push(next)
  }
  for (let depth = path.length - 1; depth >= 0; depth -= 1) {
    const container = chain[depth]
    const segment = path[depth]
    if (container === undefined || segment === undefined) return
    removeChild(container, segment)
    if (depth === 0 || !isEmpty(container)) return
  }
}

function prunePass(
  root: Record<string, unknown>,
  issues: readonly z.core.$ZodIssue[],
): { readonly dropped: readonly PrunedConfigPath[]; readonly next: Record<string, unknown> } | null {
  const byKey = new Map<string, PrunedConfigPath>()
  for (const issue of issues) {
    for (const path of targetPaths(root, issue)) {
      if (path.length === 0) return null
      const key = path.map((segment) => String(segment)).join(".")
      if (!byKey.has(key)) byKey.set(key, { key, message: issue.message, path })
    }
  }
  const targets = [...byKey.values()]
  const outermost = targets
    .filter((target) => !targets.some((other) => isAncestor(other.path, target.path)))
    .sort((left, right) => compareDescending(left.path, right.path))
  const next = structuredClone(root)
  for (const target of outermost) removePathAndEmptiedAncestors(next, target.path)
  return { dropped: outermost, next }
}

/**
 * Prune every invalid value out of `config`, re-validating through `validate` after each pass.
 * `issues` are the validation issues of `config` as given. The result is `ok: false` when the
 * bound is exhausted, an issue targets the document root, or nothing valid is left; the caller
 * then rejects the layer fail-closed.
 */
export function pruneInvalidConfigPaths(
  config: Record<string, unknown>,
  issues: readonly z.core.$ZodIssue[],
  validate: PruneValidator,
  maxPasses: number = MAX_PRUNE_PASSES,
): PruneResult {
  const dropped: PrunedConfigPath[] = []
  let current = config
  let pending = issues
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const step = prunePass(current, pending)
    if (step === null || step.dropped.length === 0) return { ok: false, dropped }
    dropped.push(...step.dropped)
    current = step.next
    if (Object.keys(current).length === 0) return { ok: false, dropped }
    const validation = validate(current)
    if (validation.success) return { ok: true, config: current, dropped }
    pending = validation.issues
  }
  // Bound exhausted and still failing: signal the caller to reject the layer.
  return { ok: false, dropped }
}
