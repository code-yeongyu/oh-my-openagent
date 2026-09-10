import { padVisible, truncateVisible } from "./format/truncate"
import type { PanelComponent, PanelRowSource, PanelTheme } from "./types"

/**
 * The panel column itself: it paints whatever rows the source reports for the width
 * the layout engine hands it. Rows are cut to the column and padded back out to it, so
 * the column reads as one block instead of ragged text over the transcript. The theme
 * arrives with the host renderer, so it is read through a getter rather than captured.
 */
export function createPanelBody(source: PanelRowSource, theme: () => PanelTheme | undefined): PanelComponent {
  return {
    render(width: number): string[] {
      const inner = Math.max(0, width)
      const paint = theme()
      return source.rows(inner).map((row) => {
        const text = truncateVisible(row.text, inner)
        const styled = paint !== undefined && row.color !== undefined ? paint.fg(row.color, text) : text
        return padVisible(styled, inner)
      })
    },
    invalidate(): void {
      // Rows are recomputed per frame, so there is no cached state to drop.
    },
  }
}
