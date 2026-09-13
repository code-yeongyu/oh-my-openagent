/**
 * Parsers for git's machine-readable output. `-z` everywhere, because that is the only
 * form that survives a filename containing a space, a quote or a newline: git quotes such
 * paths in its human output and the quoting rules are not worth re-implementing.
 *
 * These are pure so the parsing - the part that is actually easy to get wrong - is tested
 * without spawning anything.
 */

export interface PanelGitEntry {
  /** The two status columns: index state, then worktree state. */
  readonly xy: string
  readonly path: string
  /** Present for a rename or copy: where the file came from. */
  readonly from?: string
  readonly added?: number
  readonly removed?: number
}

/** `git status --porcelain=v1 -z`: `XY path\0` per entry, with a rename adding `origin\0`. */
export function parsePorcelainZ(output: string): readonly PanelGitEntry[] {
  const fields = output.split("\0")
  const entries: PanelGitEntry[] = []
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index]
    if (field === undefined || field.length < 4) continue
    const xy = field.slice(0, 2)
    const path = field.slice(3)
    if (path === "") continue
    // A rename or copy emits its origin path as the next NUL-separated field.
    if (xy[0] === "R" || xy[0] === "C") {
      const from = fields[index + 1]
      index += 1
      entries.push({ xy, path, ...(from === undefined || from === "" ? {} : { from }) })
      continue
    }
    entries.push({ xy, path })
  }
  return entries
}

export interface PanelGitDelta {
  readonly added: number
  readonly removed: number
}

/**
 * `git diff --numstat -z`: `added\tremoved\tpath\0`, except a rename splits into
 * `added\tremoved\t\0from\0to\0`. Binary files report `-` for both counts.
 */
export function parseNumstatZ(output: string): ReadonlyMap<string, PanelGitDelta> {
  const deltas = new Map<string, PanelGitDelta>()
  const fields = output.split("\0")
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index]
    if (field === undefined || field === "") continue
    const parts = field.split("\t")
    if (parts.length < 3) continue
    const added = count(parts[0])
    const removed = count(parts[1])
    const inlinePath = parts[2]
    if (inlinePath !== undefined && inlinePath !== "") {
      deltas.set(inlinePath, { added, removed })
      continue
    }
    // Rename form: the destination path is the second following field.
    const to = fields[index + 2]
    index += 2
    if (to !== undefined && to !== "") deltas.set(to, { added, removed })
  }
  return deltas
}

function count(value: string | undefined): number {
  if (value === undefined || value === "-") return 0
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Merge status entries with the staged and unstaged line counts. */
export function mergeGitDeltas(
  entries: readonly PanelGitEntry[],
  unstaged: ReadonlyMap<string, PanelGitDelta>,
  staged: ReadonlyMap<string, PanelGitDelta>,
): readonly PanelGitEntry[] {
  return entries.map((entry) => {
    const a = unstaged.get(entry.path)
    const b = staged.get(entry.path)
    if (a === undefined && b === undefined) return entry
    return {
      ...entry,
      added: (a?.added ?? 0) + (b?.added ?? 0),
      removed: (a?.removed ?? 0) + (b?.removed ?? 0),
    }
  })
}
