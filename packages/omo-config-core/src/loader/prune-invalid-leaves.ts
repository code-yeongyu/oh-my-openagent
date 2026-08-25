import type * as z from "zod"

import { mergeOmoConfigRecords } from "./merge"
import type { OmoConfigDiagnostic } from "./types"

/**
 * Bounded surgical pruning of invalid config leaves.
 *
 * The loader must never wholesale-fallback to `DEFAULT_RAW_CONFIG` when a
 * single bad agent/category leaf makes the whole merged document unparseable.
 * Instead we prune only the offending record leaves (`agents.<name>` /
 * `categories.<name>`), keep every healthy sibling, and re-validate until the
 * document parses or the bounded loop is exhausted. If the bound is hit and the
 * document still fails, the caller falls back to defaults (old totality
 * preserved as the last resort, never the first).
 */

const RECORD_LEAF_PREFIXES: readonly string[] = ["agents.", "categories."]

export type PruneResult = {
  readonly config: Record<string, unknown>
  readonly dropped: readonly OmoConfigDiagnostic[]
}

export type PruneValidator = (
  candidate: Record<string, unknown>,
) => { readonly success: boolean; readonly issues?: readonly z.core.$ZodIssue[] }

function isRecordLeafPath(path: readonly PropertyKey[]): string | null {
  const segments = path.map((segment) => String(segment))
  if (segments.length < 2) return null
  const section = segments[0]
  if (section === undefined) return null
  const prefix = `${section}.`
  if (!RECORD_LEAF_PREFIXES.some((candidate) => candidate === prefix)) return null
  return section
}

function dropLeaf(
  config: Record<string, unknown>,
  section: string,
  name: string,
): Record<string, unknown> {
  const sectionValue = config[section]
  if (sectionValue === null || typeof sectionValue !== "object" || Array.isArray(sectionValue)) {
    return config
  }
  const record = sectionValue as Record<string, unknown>
  if (!(name in record)) return config
  const next = { ...record }
  delete next[name]
  return { ...config, [section]: next }
}

function diagnosticFor(section: string, name: string, issuePath: string, message: string): OmoConfigDiagnostic {
  const key = `${section}.${name}`
  return {
    kind: "validation",
    message: `Dropped invalid ${key} leaf: ${issuePath}: ${message}`,
    path: key,
    issuePaths: [issuePath],
  }
}

/**
 * Prune invalid record leaves out of `config`, re-validating through `validate`
 * after each prune pass. The loop is bounded by `droppedGroups + 1`; if it
 * still fails after the bound, `config` is returned empty and the caller falls
 * back to defaults (old totality preserved).
 */
export function pruneInvalidConfigLeaves(
  config: Record<string, unknown>,
  issues: readonly z.core.$ZodIssue[],
  validate: PruneValidator,
): PruneResult {
  const dropped: OmoConfigDiagnostic[] = []
  let candidate = mergeOmoConfigRecords({}, config)
  const droppedGroups = new Set<string>()

  for (const issue of issues) {
    const section = isRecordLeafPath(issue.path)
    if (section === null) continue
    const name = String(issue.path[1])
    const key = `${section}.${name}`
    if (droppedGroups.has(key)) continue
    droppedGroups.add(key)
    candidate = dropLeaf(candidate, section, name)
    const issuePath = issue.path.map((segment) => String(segment)).join(".")
    dropped.push(diagnosticFor(section, name, issuePath, issue.message))
  }

  if (droppedGroups.size === 0) return { config: candidate, dropped }

  let current = candidate
  let iteration = 0
  const maxIterations = droppedGroups.size + 1
  while (iteration < maxIterations) {
    const parsed = validate(mergeOmoConfigRecords({}, current))
    if (parsed.success) return { config: current, dropped }
    const remainingIssues = (parsed.issues ?? []).filter((issue) => isRecordLeafPath(issue.path) !== null)
    if (remainingIssues.length === 0) break
    for (const issue of remainingIssues) {
      const section = isRecordLeafPath(issue.path)
      if (section === null) continue
      const name = String(issue.path[1])
      const key = `${section}.${name}`
      if (droppedGroups.has(key)) continue
      droppedGroups.add(key)
      current = dropLeaf(current, section, name)
      const issuePath = issue.path.map((segment) => String(segment)).join(".")
      dropped.push(diagnosticFor(section, name, issuePath, issue.message))
    }
    iteration += 1
  }

  // Bound exhausted and still failing: signal fallback to defaults (totality).
  return { config: {}, dropped }
}
