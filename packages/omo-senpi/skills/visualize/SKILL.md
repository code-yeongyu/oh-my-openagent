---
name: visualize
description: "Builds a self-contained HTML page (chart, table, diagram, dashboard) to show inline in a thread. Use before calling show_html_page, html_preview or html_render, or whenever an answer reads better as a page than as prose."
---

# Visualize

A page shown inline sits beside a reply, in the reader's theme, and is read in a few seconds. It earns its place only by being clearer than the paragraph it replaces. This skill owns what is particular to such a page. The data work belongs to `data-scientist` and the design work to `frontend`: load those skills for their parts instead of improvising them here.

## The loop

Do these in order. Never show a page you have not looked at.

1. **Data: load `data-scientist`.** Compute every figure with its engines (DuckDB or Polars), at the grain the reader needs, and follow its `references/visualization.md` for which chart answers which question. Keep the query: every number on the page must trace back to it.
2. **Design: load `frontend`.** Use it for hierarchy, type, spacing and states. This page's constraints replace its design-system gate: the page brings no palette or fonts of its own and uses the theme the host injects (below).
3. **Build one self-contained page** under the constraints below.
4. **Preview and look.** Render with `html_preview` in dark and in light, at the reply's width and at 390 px. Read the screenshot and the console, fix what you see, and preview again. Where `html_preview` is not offered, open the page file in a browser through the `browser` skill and capture the same four views.
5. **Show it** with `show_html_page` (OmO) or `html_render` (other hosts), with the height the preview measured. Then write only what the page does not already say.

## Constraints of an inline page

- **No network.** Inline every script, style, font and image (`data:` URIs); the sandbox blocks every request, so a CDN library leaves a blank chart. Draw with hand-written SVG when a library cannot be inlined.
- **Theme from the host.** Color only through the injected custom properties: `--background`, `--foreground`, `--muted`, `--muted-foreground`, `--card`, `--border`, `--primary`, `--accent`, `--destructive`, `--warning`, `--success`, the series colors `--chart-1` to `--chart-6`, and `--font-sans`, `--font-mono`, `--radius`. They hold in both themes and change live; a literal color does neither. A page opened outside the app gets only a few of them, so give each a fallback for both themes: `var(--chart-2, light-dark(#0d9488, #2dd4bf))`.
- **Part of the reply, not a card.** Fluid width, no outer padding, border or banner. Give charts fixed pixel heights, not heights that scale with the width. A fluid SVG stretched with `preserveAspectRatio="none"` stretches its text too, so put axis labels in HTML beside it, positioned by percentage.
- **Readable without scripts.** On the web a page first renders with scripts off, until the reader presses Run page. Put the figure itself in markup or SVG, and use scripts only for interaction.
- **Traceable.** Show how the numbers were computed in a small, muted "How this was computed" block (the query or aggregation), and state caveats near the figure when they change how a number reads: dropped rows, a partial window, a small sample.
- **Designed empty and error states.** No data, or a failed query, is stated in the same visual language, never as a blank frame.
- **Links.** A link opens only after the reader confirms it in the app, which shows its full address. Keep data out of link addresses.

## Before you show it

- The title states the finding, not the dataset name.
- Axis labels carry units, numbers use tabular figures and a sensible precision, and nothing clips at 390 px.
- The series colors separate in both themes, and the console is clean.
