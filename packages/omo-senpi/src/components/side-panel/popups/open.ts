import type { PanelOverlayUi, PanelRow } from "../types"
import { sanitizeTerminalText } from "../format/sanitize"
import { createTextPopup, type PopupComponent } from "./text-popup"
import { parsePanelWheelEvent, WHEEL_ROWS } from "./wheel"

/** The popup owns its own height; a percentage cap here would fight it and cost the bottom border. */
const OVERLAY_OPTIONS: Record<string, unknown> = {
  overlay: true,
  overlayOptions: { width: "70%", minWidth: 52, maxHeight: "100%", anchor: "center" },
}

/**
 * Open the shared framed viewer. One function for every entry point, so a click and a command
 * cannot drift apart on borders, scrolling or close keys - and a host without the overlay seam
 * still gets the content, just not a scrollable copy of it.
 */
export async function openPanelViewer(ui: PanelOverlayUi, title: string, rows: readonly PanelRow[]): Promise<void> {
  if (ui.custom === undefined) {
    ui.notify(rows.map((row) => sanitizeTerminalText(row.text)).join("\n"), "info")
    return
  }
  let stopWheel: (() => void) | undefined
  try {
    await ui.custom((tui, theme, _keybindings, done) => {
      const popup = createTextPopup(tui, theme, { title, rows: () => rows, close: () => done(undefined) })
      stopWheel = listenForWheel(ui, popup, tui)
      return popup
    }, OVERLAY_OPTIONS)
  } finally {
    stopWheel?.()
  }
}

/**
 * While the viewer is open the wheel belongs to it: every wheel report is claimed, so the
 * transcript behind stops scrolling under a popup the user is reading.
 */
function listenForWheel(
  ui: PanelOverlayUi,
  popup: PopupComponent,
  _tui: { requestRender(force?: boolean): void },
): (() => void) | undefined {
  return ui.onTerminalInput?.((data) => {
    const wheel = parsePanelWheelEvent(data)
    if (wheel === undefined) return undefined
    popup.scrollBy(wheel.direction * WHEEL_ROWS)
    return { consume: true }
  })
}
