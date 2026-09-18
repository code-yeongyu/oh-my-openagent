---
name: print-paged-media
description: "Layer A paged-media reference. Load it when output is a document that breaks into pages - a PDF report, a print stylesheet, a headless-Chrome print pipeline, or an HTML deck printed to paper - instead of a continuously scrolling screen. Owns the page box, fragmentation properties, the atomic-block set, and the keep-together side effect that strands a block on a near-empty page. Adds zero visual taste; the style skill and DESIGN.md still own color, type, and spacing."
---

# Paged Media

Screen layout has one viewport and infinite scroll. Paged media has a fixed page box and a fragmentation engine that cuts your content into pages whether or not you told it where. This file owns that cut. It stacks on top of a Layer A style skill and adds ZERO visual direction - color, type, radius, and spacing still come from the style skill and `DESIGN.md`.

Load this when the deliverable is a PDF report, a print stylesheet, a `chrome --headless --print-to-pdf` pipeline, a WeasyPrint render, or any HTML meant to land on paper.

## 1. The page box comes first

Declare the page before styling anything inside it. `@page { size: A4; margin: 2cm; }` sets the sheet and the content area; every measurement downstream is relative to what survives those margins.

- `@page:first` targets the cover alone. A full-bleed cover is `@page:first { margin: 0 }`, which also suppresses the running header and footer on page one.
- Running headers and footers live in the page margin boxes. In headless Chrome they come from `headerTemplate` / `footerTemplate` on `Page.printToPDF`, rendered into the margins that `@page` declared - not from a fixed-position element in the body.
- Pass `preferCSSPageSize: true` when printing through CDP so your `@page` rule wins over the caller's paper defaults. Without it, the size you declared and the size you get can differ.
- Body content flows through the page area. An element with a viewport unit (`100vh`) or a fixed position does not mean on paper what it means on screen; size page furniture in `mm` or `pt`.

## 2. Fragmentation vocabulary

Three properties decide every cut. Modern names first; the `page-break-*` aliases still work and appear in older pipelines.

| Property | Use it for |
|---|---|
| `break-before: page` | Start a section on a fresh page. |
| `break-after: avoid` | Keep a heading with the block that follows it (keep-with-next). |
| `break-inside: avoid` | Forbid a cut *through* one block: a table, a figure, a callout, a code listing. |
| `orphans` / `widows` | Minimum lines of a paragraph left at a page foot / carried to the next page. Set both to at least 2; 3 reads better in dense body copy. |

`break-inside: avoid` on a wrapper is what actually protects a table - apply it to the element that owns the whole exhibit, not to the `<table>` alone, or the caption and the rules can still separate from the rows.

## 3. The atomic set - keep it small on purpose

Mark as atomic only what is unreadable when split: a data table with its caption, a figure with its `figcaption`, a callout, a short code listing. Everything else - ordinary paragraphs, long prose lists, multi-page tables - should be allowed to break, because a block that cannot break and cannot fit is a defect generator, not a protected exhibit.

A block taller than the page area gets split regardless of what you declared. `avoid` is a request the engine honors only when honoring it is possible.

## 4. The keep-together side effect - the defect this file exists to prevent

This is the failure that looks like a bug in your CSS but is your CSS working exactly as written.

A block carrying `break-inside: avoid` reaches the bottom of a page with too little room left. The engine cannot split it, so it moves the WHOLE block to the next page. That is correct. The damage appears when the block is the LAST content of its section and the next section carries `break-before: page`: nothing can flow up to backfill the gap it left, and nothing can flow down beside it. You ship one page with a short box at the top and a column of whitespace under it, and one page before it with an unexplained gap at the foot.

Nothing in the cascade detects this. Both rules are locally correct; the artifact is their interaction with where the text happened to land.

How to prevent and repair it:

- **Shrink the atomic set.** Every unnecessary `break-inside: avoid` is one more block that can be stranded. Protect exhibits, not paragraphs.
- **Do not wrap a lead-in with its block** unless the pair reliably fits together. Binding more content into one unbreakable unit makes stranding more likely, not less.
- **Reconsider the forced section break.** `break-before: page` on every section is a strong default for a report and a poor one for short trailing sections; allowing a brief section to continue on the current page removes the trap entirely.
- **Editorial repair is legitimate.** Shortening the block by a line, or moving it a paragraph earlier, is a real fix - and often the correct one for a hand-tuned deliverable.
- **Detect it by ink, not by intent.** A page whose content coverage falls far below its neighbors is the signal. Ranking pages by rendered coverage finds stranded blocks faster than reading CSS does.

## 5. What the engine actually honors

Fragmentation support is uneven, and reading the stylesheet will not tell you what happened.

- `break-inside: avoid` inside flex, grid, and multi-column containers is partially implemented across engines; a constraint that holds in normal flow can be dropped inside a nested fragmentation context.
- Transformed, absolutely positioned, and `overflow`-clipped subtrees fragment differently from ordinary blocks, and sometimes not at all.
- Background colors and images on split blocks may or may not repaint on the continuation page. Chrome needs `printBackground: true` before any of it renders.

Treat every fragmentation rule as a hypothesis until you have seen the rendered page.

## 6. Verify by rendering every page

A paged deliverable is verified by looking at its pages. Render them and inspect each one:

```bash
pdftoppm -png -r 150 report.pdf out/page   # one PNG per page
```

Read every page image for: blank or near-empty pages, a block stranded alone after a keep-together push, a table or figure split mid-exhibit, a heading orphaned at a page foot, clipped or overflowing text, and a running header or footer that drifted or vanished.

Extracting the text proves the words are present. It cannot see any defect in this list - layout is exactly the information that extraction discards. Fix, re-render, and look again until the pages are clean; the same standard governs the `ulw-research` delivery gate and the `mass-ulw` verification wave.
