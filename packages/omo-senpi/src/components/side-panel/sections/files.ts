import { truncateVisible } from "../format/truncate"
import type { PanelGitEntry } from "../git/parse"
import type { PanelRow } from "../types"
import { heading } from "./layout"

export interface PanelGitStatus {
  readonly root: string
  readonly files: readonly PanelGitEntry[]
}

/**
 * Files as git sees them. The two status columns are shown verbatim, because `M ` (staged)
 * and ` M` (unstaged) are genuinely different states and collapsing them would lose that.
 */
export function buildFileRows(status: PanelGitStatus | undefined, width: number, cap: number): readonly PanelRow[] {
  if (width <= 0 || status === undefined || status.files.length === 0 || cap <= 0) return []
  const shown = status.files.slice(0, cap)
  const hidden = status.files.length - shown.length
  const summary = hidden > 0 ? `${status.files.length} changed · +${hidden} more` : `${status.files.length} changed`
  const rows: PanelRow[] = [heading("FILES", summary)]
  for (const file of shown) {
    const delta = file.added === undefined && file.removed === undefined
      ? ""
      : `  +${file.added ?? 0}/-${file.removed ?? 0}`
    const text = `${file.xy} ${basename(file.path)}${delta}`
    rows.push({ text: truncateVisible(text, width), color: colorFor(file.xy) })
  }
  return rows
}

/** Untracked is dim, a conflict is loud, staged reads as done, unstaged as in-flight. */
function colorFor(xy: string): PanelRow["color"] {
  if (xy === "??") return "dim"
  if (xy.includes("U") || xy === "AA" || xy === "DD") return "error"
  if (xy[1] === " ") return "success"
  return "text"
}

/**
 * git reports an untracked DIRECTORY with a trailing slash (`?? build/`), and taking the
 * basename of that yields an empty string - the column showed a status with no name at all.
 * The slash is kept, because "build/" and "build" are different things to a reader.
 */
function basename(path: string): string {
  const directory = path.endsWith("/")
  const trimmed = directory ? path.slice(0, -1) : path
  const slash = trimmed.lastIndexOf("/")
  const name = slash === -1 ? trimmed : trimmed.slice(slash + 1)
  return directory ? `${name}/` : name
}
