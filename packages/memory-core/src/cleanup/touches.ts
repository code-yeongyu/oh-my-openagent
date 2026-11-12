// Which repository paths a finding writes, and whether one of them holds the finding back from apply.

import { ARCHIVE_PATH } from "../reflection/link-rewrite"
import type { CleanupCorpus } from "./corpus"
import { LOAD_BEARING_PATHS, type CleanupAction, type MemoryCleanupFinding, type ResolvedCleanupOptions } from "./types"

/** Paths an action writes directly, as opposed to notes touched only because a link inside them is repointed. */
export function ownedBy(finding: Pick<MemoryCleanupFinding, "actions">, path: string): boolean {
  return path === ARCHIVE_PATH || finding.actions.some((action) => writtenPath(action) === path)
}

function writtenPath(action: CleanupAction): string {
  switch (action.kind) {
    case "archive":
      return action.path
    case "merge":
      return action.into
    case "mark-conflict":
      return action.path
  }
}

export function touchedPaths(finding: Pick<MemoryCleanupFinding, "actions">, corpus: CleanupCorpus): string[] {
  const touched = new Set<string>()
  for (const action of finding.actions) {
    switch (action.kind) {
      case "archive":
        touched.add(action.path)
        touched.add(ARCHIVE_PATH)
        for (const source of corpus.inbound.get(action.path) ?? []) touched.add(source)
        break
      case "merge":
        touched.add(action.into)
        break
      case "mark-conflict":
        touched.add(action.path)
        break
    }
  }
  return [...touched].sort()
}

export function holdReason(
  finding: MemoryCleanupFinding,
  corpus: CleanupCorpus,
  options: ResolvedCleanupOptions,
): string | undefined {
  for (const path of finding.touches) {
    const note = corpus.notes.get(path)
    const role = ownedBy(finding, path) ? "would write" : "would repoint a link in"
    if (note?.readOnly === true) return `${role} ${path}, which is read_only`
    if (!options.includeLoadBearing && LOAD_BEARING_PATHS.has(path))
      return `${role} ${path} (load-bearing; pass --include-load-bearing)`
  }
  return undefined
}
