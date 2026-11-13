import { truncateVisibleStart } from "../format/truncate"
import type { PanelRow } from "../types"

/** Where the session is working; pinned at the bottom of the column. */
export interface PanelLocation {
  readonly cwd: string
  readonly branch?: string
}

/**
 * The location row: directory, then branch when the working copy is a git repository.
 * Long paths lose their leading segments rather than their tail, because the part that
 * identifies the project sits at the end.
 */
export function buildLocationRows(location: PanelLocation, width: number, home?: string): readonly PanelRow[] {
  if (width <= 0) return []
  const directory = collapseHome(location.cwd, home)
  const branch = location.branch === undefined || location.branch === "" ? undefined : location.branch
  const suffix = branch === undefined ? "" : ` ${SEPARATOR} ${branch}`
  const room = width - suffix.length
  if (room <= 0) return [{ text: truncateVisibleStart(branch ?? directory, width), color: "muted" }]
  return [{ text: `${truncateVisibleStart(directory, room)}${suffix}`, color: "muted" }]
}

const SEPARATOR = "\u00b7"

function collapseHome(cwd: string, home: string | undefined): string {
  if (home === undefined || home === "" || !cwd.startsWith(home)) return cwd
  const rest = cwd.slice(home.length)
  if (rest === "") return "~"
  if (rest.startsWith("/") || rest.startsWith("\\")) return `~${rest}`
  return cwd
}
