import type { SenpiExtensionAPI } from "../../extension/types"
import { readGitDiff } from "./git/diff"
import type { PanelGitEntry } from "./git/parse"
import type { PanelExec } from "./git/read"
import { openPanelViewer } from "./popups/open"
import type { PanelGitStatus } from "./sections/files"
import type { PanelOverlayUi } from "./types"

/**
 * The named route to the panel's viewers.
 *
 * Rows are clickable in their own right (`links.ts`), and this is the same destination reached
 * by name - for keyboards, and for a host that hands out no URL hook. No default chord is
 * registered: picking a global key in someone else's editor invites a collision with the
 * user's own bindings.
 */

/** Structural slice of senpi's ExtensionCommandContext these commands read. */
interface PanelCommandContext {
  readonly mode?: string
  readonly ui?: PanelCommandUi
}

interface PanelCommandUi extends PanelOverlayUi {
  select(title: string, options: string[]): Promise<string | undefined>
}

export interface PanelCommandDeps {
  readonly status: () => PanelGitStatus | undefined
  readonly exec: PanelExec | undefined
}

export const SIDE_PANEL_DIFF_COMMAND = "side-panel-diff"

export function registerPanelCommands(pi: SenpiExtensionAPI, deps: PanelCommandDeps): void {
  pi.registerCommand(SIDE_PANEL_DIFF_COMMAND, {
    description: "Open the diff of a file the side panel lists as changed.",
    handler: (_args: string, ctx: PanelCommandContext) => runDiffCommand(deps, ctx),
  })
}

function fileOptionLabel(file: PanelGitEntry): string {
  const delta = file.added === undefined && file.removed === undefined ? "" : `  +${file.added ?? 0}/-${file.removed ?? 0}`
  return `${file.xy} ${file.path}${delta}`
}

async function runDiffCommand(deps: PanelCommandDeps, ctx: PanelCommandContext): Promise<void> {
  const ui = ctx.ui
  if (ui === undefined) return
  const status = deps.status()
  if (status === undefined || status.files.length === 0) {
    ui.notify("No changes in the working copy.", "info")
    return
  }
  if (deps.exec === undefined) {
    ui.notify("This host exposes no exec, so git cannot be run.", "warning")
    return
  }
  const options = status.files.map(fileOptionLabel)
  const choice = await ui.select("Show the diff of", options)
  if (choice === undefined) return
  const file = status.files[options.indexOf(choice)]
  if (file === undefined) return
  await openFileDiff(ui, deps.exec, status, file)
}

/** One file's diff in the shared viewer. Both the command and a clicked row land here. */
export async function openFileDiff(
  ui: PanelOverlayUi,
  exec: PanelExec,
  status: PanelGitStatus,
  file: PanelGitEntry,
): Promise<void> {
  const rows = await readGitDiff(exec, status.root, file)
  await openPanelViewer(ui, `${file.path}  (diff, read-only)`, rows)
}
