---
name: visualize
description: "Builds a self-contained HTML page (chart, table, diagram, dashboard) to show inline in a thread. Use before calling show_html_page, html_preview or html_render, or whenever an answer reads better as a page than as prose."
---

# Visualize

A page shown inline sits beside a reply, in the reader's theme, and is read in a few seconds. It earns its place only by being clearer than the paragraph it replaces. This skill owns what is particular to such a page. The data work belongs to `data-scientist` and the design work to `frontend`: load those skills for their parts instead of improvising them here.

## The loop

Do these in order. Never show a page you have not looked at.

1. **Data: load `data-scientist`.** Compute every figure at its source, at the grain the reader needs: SQL in the database when the data lives in one, DuckDB or Polars over files, and only the aggregate the chart draws comes back. Follow its `references/visualization.md` for which chart answers which question, where a day starts, and the cross-check. Keep the query: every number on the page must trace back to it.
2. **Design: load `frontend`.** Use it for hierarchy, type, spacing and states. `frontend` exempts an inline page from its `DESIGN.md` gate, Lighthouse audit and research lanes, and the constraints below replace them: the page brings no palette or fonts of its own and uses the theme the host injects.
3. **Build one self-contained page** under the constraints below and the Draft guard in `frontend`. Give each role its own class name, prefixed or scoped under its chart's parent selector: a short global class such as `.k` that a KPI grid and a bar segment share styles both, and lifted every cache bar off its baseline in one shipped page.
4. **Lint before you render.** Run `bun $SKILL_DIR/../frontend/scripts/perfection/check-draft-guard.ts <page file>`, where `$SKILL_DIR` is this skill's own directory, the folder containing this SKILL.md (the script ships with `frontend`, next to this skill; write a page you built as a string to a file first). Exit 1 means a coloured edge bar, an accent outline, promotional filler copy, an emoji icon, a hype badge, or a hard-coded vanity stat is in the page: remove it and rerun. Nothing is previewed or shown until it exits 0.
5. **Preview and look.** Render with `html_preview` in dark and in light, at the reply's width and at 390 px: all four views every time, because a page checked in one theme or one width ships broken in another. In each view, measure two things on every chart: the largest bar's rendered height against value ÷ axis maximum × plot height, and each legend swatch's computed colour against its series' colour. Then check that the first and last axis labels are whole. The draft-guard lint cannot catch a misdrawn bar; only these measurements do. Read the screenshot and the console, fix what you see, and preview again. Where `html_preview` is not offered, open the page file in a browser through the `browser` skill and capture the same four views.
6. **Show it** with `show_html_page` (OmO) or `html_render` (other hosts), with the height the preview measured. Then write only what the page does not already say.

## Constraints of an inline page

- **No network.** Inline every script, style, font and image (`data:` URIs); the sandbox blocks every request, so a CDN library leaves a blank chart. Draw with hand-written SVG when a library cannot be inlined.
- **Theme from the host.** Color only through the injected custom properties: `--background`, `--foreground`, `--muted`, `--muted-foreground`, `--card`, `--border`, `--primary`, `--accent`, `--destructive`, `--warning`, `--success`, the series colors `--chart-1` to `--chart-6`, and `--font-sans`, `--font-mono`, `--radius`. They hold in both themes and change live; a literal color does neither. A page opened outside the app gets only a few of them, so give each a fallback for both themes: `var(--chart-2, light-dark(#0d9488, #2dd4bf))`. `light-dark()` follows the theme only when the page declares `:root { color-scheme: light dark; }`; without it every fallback renders its light value in the dark theme.
- **Part of the reply, not a card.** Fluid width, no outer padding, border or banner. Give charts fixed pixel heights, not heights that scale with the width. Draw bars as HTML elements in a fixed-height container, each sized as a percentage of it, not as a fluid SVG stretched with `preserveAspectRatio="none"`, which stretches its text and strokes too. Put axis labels in HTML, positioned by percentage: centre the inner labels on their tick, but align the first label's left edge and the last label's right edge to the chart's edges, or both clip at 390 px.
- **Readable without scripts.** On the web a page first renders with scripts off, until the reader presses Run page. Put the figure itself in markup or SVG, and use scripts only for interaction.
- **Traceable.** Show how the numbers were computed in a small, muted "How this was computed" block (the query or aggregation), and state caveats near the figure when they change how a number reads: dropped rows, a partial window (today's unfinished day, marked on its own bar with a lighter fill or hatch and a label, not only in a subtitle), a small sample. Name the second source the figures were checked against.
- **Designed empty and error states.** No data, or a failed query, is stated in the same visual language, never as a blank frame.
- **Links.** A link opens only after the reader confirms it in the app, which shows its full address. Keep data out of link addresses.

## Before you show it

- The title states the finding, not the dataset name.
- Axis labels carry units, numbers use tabular figures and a sensible precision, and nothing clips at 390 px.
- The series colors separate in both themes, and the console is clean.
