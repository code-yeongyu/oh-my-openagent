import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/** Marker file proving the regular-mode notice was already shown for this install. */
export const REGULAR_MODE_NOTICE_MARKER = "side-panel-regular-mode-notice"

/**
 * Claim the right to show the regular-mode notice, once per install: an exclusive-create marker
 * in the install state dir, so parallel sessions on one machine cannot both show it. Fails
 * closed - an unwritable state dir means no notice rather than a broken panel.
 */
export function claimRegularModeNotice(stateDir: string): boolean {
  try {
    mkdirSync(stateDir, { recursive: true })
  } catch {
    return false
  }
  try {
    writeFileSync(
      join(stateDir, REGULAR_MODE_NOTICE_MARKER),
      JSON.stringify({ shownAt: new Date().toISOString() }),
      { flag: "wx", mode: 0o600 },
    )
    return true
  } catch {
    return false
  }
}

/** Mirrors docs/reference/omo-json.md `side_panel`: the column is a fullscreen-TUI layout. */
export const REGULAR_MODE_NOTICE_MESSAGE =
  'side_panel: the column beside the transcript needs the fullscreen TUI. In the default regular mode the panel renders as a block above the editor. Use --tui-mode fullscreen, or set tuiMode to "fullscreen" in senpi\'s settings, for the side-by-side column.'
