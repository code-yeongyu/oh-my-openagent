import type { SenpiExtensionAPI } from "../../extension/types"
import { readGitDiff } from "./git/diff"
import type { PanelGitEntry } from "./git/parse"
import type { PanelExec } from "./git/read"
import { createTextPopup, type PopupTui } from "./popups/text-popup"
import type { PanelGitStatus } from "./sections/files"
import type { PanelRow, PanelTheme } from "./types"

/**
 * The keyboard route to the panel's viewers.
 *
 * Clicking a row would need the host's private mouse path, so every viewer is reachable by
 * command instead. No default chord is registered: picking a global key in someone else's
 * editor invites a collision with the user's own bindings.
 */

/** Structural slice of senpi's ExtensionCommandContext these commands read. */
interface PanelCommandContext {
  readonly mode?: string
  readonly ui?: PanelCommandUi
}

interface PanelCommandUi {
  notify(message: string, type?: "info" | "warning" | "error"): void
  select(title: string, options: string[]): Promise<string | undefined>
  custom?<T>(
    factory: (tui: PopupTui, theme: PanelTheme | undefined, keybindings: unknown, done: (value?: T) => void) => unknown,
    options?: Record<string, unknown>,
  ): Promise<T | undefined>
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

export function fileOptionLabel(file: PanelGitEntry): string {
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
  const rows = await readGitDiff(deps.exec, status.root, file)
  if (ui.custom === undefined) {
    // A host without the overlay seam still gets the answer, just not a scrollable one.
    ui.notify(rows.map((row) => row.text).join("\n"), "info")
    return
  }
  await openDiffPopup(ui, file.path, rows)
}

function openDiffPopup(ui: PanelCommandUi, title: string, rows: readonly PanelRow[]): Promise<unknown> {
  return (
    ui.custom?.(
      (tui, theme, _keybindings, done) =>
        createTextPopup(tui, theme, {
          title: `${title}  (diff, read-only)`,
          rows: () => rows,
          close: () => done(undefined),
        }),
      {
        overlay: true,
        // The popup owns its own height; a percentage cap here would fight it and the loser
        // is the closing border.
        overlayOptions: { width: "70%", minWidth: 52, maxHeight: "100%", anchor: "center" },
      },
    ) ?? Promise.resolve(undefined)
  )
}
