import { padVisible, truncateVisible } from "./format/truncate"
import { withActionLink } from "./links"
import type { PanelComponent, PanelRowSource, PanelTheme } from "./types"

/**
 * The panel column itself: it paints whatever rows the source reports for the width
 * the layout engine hands it. Rows are cut to the column and padded back out to it, so
 * the column reads as one block instead of ragged text over the transcript. The theme
 * arrives with the host renderer, so it is read through a getter rather than captured.
 */
export function createPanelBody(
  source: PanelRowSource,
  theme: () => PanelTheme | undefined,
  clickable: () => boolean,
): PanelComponent {
  return {
    render(width: number): string[] {
      const inner = Math.max(0, width)
      const paint = theme()
      const links = clickable()
      return source.rows(inner).map((row) => {
        const text = truncateVisible(row.text, inner)
        const styled = paint !== undefined && row.color !== undefined ? paint.fg(row.color, text) : text
        const padded = padVisible(styled, inner)
        // The link goes on last, over the padding too, so a click anywhere on the row counts.
        return links && row.action !== undefined ? withActionLink(padded, row.action) : padded
      })
    },
    invalidate(): void {
      // Rows are recomputed per frame, so there is no cached state to drop.
    },
  }
}
