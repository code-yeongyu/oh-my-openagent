import { padVisible, truncateVisible } from "../format/truncate"
import type { PanelRow, PanelTheme } from "../types"
import { clampScroll, popupBudget, POPUP_CHROME_ROWS } from "./viewport"

/** The renderer facts the popup needs; everything else about the host is irrelevant here. */
export interface PopupTui {
  readonly terminal?: { readonly rows?: number }
  requestRender(force?: boolean): void
}

export interface PopupComponent {
  render(width: number): string[]
  handleInput(data: string): void
  invalidate(): void
}

export interface PopupOptions {
  readonly title: string
  /** Recomputed per paint, so a viewer can fill in while it is open. */
  readonly rows: () => readonly PanelRow[]
  readonly ratio?: number
  /** A viewer may claim a key before the shell's close and scroll keys. */
  readonly onKey?: (data: string) => boolean
  readonly close: () => void
}

const ESCAPE_KEYS = new Set(["\x1b", "q", "\r", "\n"])
// With the Kitty keyboard protocol Escape arrives as CSI 27 u, optionally with modifiers.
const KITTY_ESCAPE = /^\x1b\[27(;[\d;]*)?u$/

/**
 * One framed, scrollable viewer used by every popup, so a second viewer cannot drift from
 * the first on borders, scrolling or close keys.
 */
export function createTextPopup(tui: PopupTui, theme: PanelTheme | undefined, options: PopupOptions): PopupComponent {
  let scroll = 0
  const paint = (color: PanelRow["color"], text: string): string =>
    theme !== undefined && color !== undefined ? theme.fg(color, text) : text

  return {
    render(width: number): string[] {
      const budget = popupBudget(tui.terminal?.rows ?? 24, options.ratio ?? 0.72)
      const inner = Math.max(10, width - 4)
      const body = options.rows()
      scroll = clampScroll(scroll, body.length, budget.body)
      const border = "─".repeat(Math.max(0, width - 2))
      const lines: string[] = [paint("dim", `┌${border}┐`)]
      lines.push(frame(paint, padVisible(paint("accent", truncateVisible(options.title, inner)), inner), inner))
      for (const row of body.slice(scroll, scroll + budget.body)) {
        const text = truncateVisible(row.text, inner)
        lines.push(frame(paint, padVisible(paint(row.color, text), inner), inner))
      }
      const hint =
        body.length > budget.body
          ? `${scroll + 1}-${Math.min(body.length, scroll + budget.body)}/${body.length}  ↑↓ scroll  esc close`
          : "esc close"
      lines.push(frame(paint, padVisible(paint("dim", hint.padStart(inner).slice(0, inner)), inner), inner))
      lines.push(paint("dim", `└${border}┘`))
      // Exactly the budget: one row more and the host would slice the closing border off.
      return lines.slice(0, budget.total)
    },

    handleInput(data: string): void {
      if (options.onKey?.(data) === true) {
        tui.requestRender()
        return
      }
      if (ESCAPE_KEYS.has(data) || KITTY_ESCAPE.test(data)) {
        options.close()
        return
      }
      const step = scrollStep(data)
      if (step === 0) return
      scroll = Math.max(0, scroll + step)
      tui.requestRender()
    },

    invalidate(): void {
      // Rows are recomputed per paint.
    },
  }
}

function frame(paint: (color: PanelRow["color"], text: string) => string, content: string, _inner: number): string {
  return `${paint("dim", "│")} ${content} ${paint("dim", "│")}`
}

function scrollStep(data: string): number {
  if (data === "\x1b[B" || data === "j") return 1
  if (data === "\x1b[A" || data === "k") return -1
  if (data === "\x1b[6~") return 10
  if (data === "\x1b[5~") return -10
  return 0
}

export { POPUP_CHROME_ROWS }
