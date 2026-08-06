---
name: layout-skill
description: "Layer A layout-mechanics reference. Stacks on any style skill when the screen is an app shell, dashboard, settings, list-detail, mail/inbox, or any layout with fixed regions plus a scrolling body — or when a layout breaks under long, empty, or unbroken content. Owns spatial structure and scroll ownership; owns zero visual taste. Load it alongside a style skill; it does not replace one."
---

# Layout Mechanics

Style skills decide how a surface looks. This file decides how it is *built to hold content* — what scrolls, what stays fixed, how regions shrink, and which layouts survive real data. It stacks on top of any Layer A style skill (`taste-skill`, `minimalist-skill`, `soft-skill`, `brutalist-skill`, `gpt-tasteskill`) and any Layer B brand. It adds ZERO visual direction — color, type, shadow, radius, and motion still come from the style skill and `DESIGN.md`.

Load this when the screen is an **application shell**, not a scroll-the-whole-document marketing page: dashboards, settings, list-detail, mail/inbox, command surfaces, split panes, sidebars — or when a page that looked fine breaks the moment content gets long, empty, or unbroken.

## 1. Scroll ownership — decide this BEFORE writing layout CSS

The single most common agent-built layout bug is an app shell where the wrong thing scrolls: the whole page scrolls when only a panel should, two panels fight over the scrollbar, or a "fixed" header scrolls away. Prevent it by naming ownership up front, in `DESIGN.md` and in the component:

- **What scrolls?** Name the ONE element that owns vertical scroll for this region.
- **What stays fixed?** Header, sidebar, footer, toolbar — list them.
- **Where is height determined?** The scroll container needs a bounded height ancestor, or it will grow instead of scroll.

Rules:

- **One scroll container per region unless each extra one has a named job.** Nested scrollbars with no declared responsibility are a defect — the user loses track of what a wheel/trackpad gesture will move.
- Full-height shells are bounded by `100dvh`/`100dvb` (dynamic viewport units), never `100vh` — `vh` causes the iOS Safari address-bar jump.
- A sticky element (`position: sticky`) follows document scroll; a fixed shell region (grid row/column with `overflow: auto` body) owns its own scroll. Do not mix the two models in one region without reason.

## 2. The two CSS contracts agents get wrong

These two are worth memorizing verbatim. They fail *silently* — the layout looks right until content arrives.

**Bounded scroll shell** (fixed header/footer, scrolling body):

```css
.shell {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto; /* header / body / footer */
  max-block-size: 100dvb;
}
.shell__body {
  min-block-size: 0; /* WITHOUT THIS the grid child refuses to shrink and overflow never fires */
  overflow: auto;
}
```

The `min-block-size: 0` (or `min-height: 0`) on the scroll child is the fix for "why won't my panel scroll — it just pushes the footer off-screen." A grid/flex child's default `min-*-size: auto` refuses to shrink below its content. The same applies to a flex column: the scrollable child needs `min-height: 0`.

**Overflow-safe intrinsic grid** (repeat as many columns as fit, no media queries):

```css
.grid {
  display: grid;
  gap: var(--gap);
  grid-template-columns: repeat(auto-fit, minmax(min(16rem, 100%), 1fr));
}
```

The inner `min(16rem, 100%)` is load-bearing: plain `minmax(16rem, 1fr)` forces a 16rem track even when the container is 12rem wide, causing horizontal overflow on narrow screens. `min(…, 100%)` lets the track collapse below its floor when space is genuinely tight. Use `auto-fit` to stretch the last row, `auto-fill` to keep empty tracks.

## 3. Named layout primitives (shared vocabulary)

Build shells from these named primitives instead of ad-hoc fl/grid. Naming them makes `DESIGN.md` Section 5 and subagent handoffs precise ("wrap it in a `sidebar` with a 20rem aside" beats "put it on the left, roughly"). Lineage: Every Layout + web.dev one-line layouts.

| Primitive | Spatial job | Core mechanic |
|---|---|---|
| **stack** | Vertical rhythm between siblings | flex column + `gap`, or `> * + *` margin |
| **cluster** | Wrapping row of items (tags, actions) | `flex-wrap: wrap` + `gap`; wraps before overflow |
| **content-limiter** | Readable prose measure inside a fluid parent | `max-inline-size: ~65ch; margin-inline: auto` |
| **sidebar** | Narrow aside + fluid main, wraps when tight | flex; aside fixed basis, main `min-inline-size` floor, both `flex-wrap` |
| **switcher** | N equal regions: row when roomy, stack when tight, NO breakpoint | flex + `min()` basis so it flips at a content threshold |
| **cover** | Centered region between optional header/footer, min viewport tall | grid rows `auto 1fr auto`, `min-block-size: 100dvb` |
| **frame** | Media held to an aspect ratio | `aspect-ratio` + `object-fit: cover` |
| **reel** | Row that scrolls horizontally instead of wrapping | `overflow-inline: auto` + `scroll-snap`; declare keyboard access |
| **imposter** | Overlay centered over a parent without changing document order | `position: absolute` + translate; do not use to reorder focus |
| **overlay-stack** | Several layers intentionally in one cell | single grid cell, all children `grid-area: 1/1` |
| **scroll-body-shell** | Fixed shell regions, only the body scrolls | §2 bounded scroll shell |
| **fixed-sidenav-shell** | Side nav stays put, main scrolls | grid columns `auto 1fr`, main is the scroll owner |
| **list-detail** | Explorable list beside its detail region | two-column grid, each pane's scroll ownership named |
| **sticky-aside** | Support content stays visible during a long read | `position: sticky; top:` on the aside, document scroll |

## 4. Container-local vs viewport-level responsiveness

Ask **what the layout is responding to** before reaching for a breakpoint:

- The component should adapt to *its own available width* (a card that's wide in main but narrow in a rail) → wrap it in `container-type: inline-size` and use `@container`. This is correct far more often than agents assume, because a component rarely knows the viewport it lands in.
- The *page frame itself* changes (sidebar collapses, columns drop) → `@media`.

Prefer intrinsic adaptation (`switcher`, `sidebar`, intrinsic grid, `clamp()`) over any query — the best breakpoint is often none. Use breakpoint *names* for layout states, never device names (`--bp-wide`, not `--bp-ipad`).

## 5. Recipes are spatial models, not product categories

Choose a layout by the screen's spatial shape, not its product label. A settings page and a docs app both want `fixed-sidenav-shell`; a support inbox and a file browser both want `list-detail`; a metrics view and a photo gallery both want an intrinsic grid. Do not invent a bespoke "dashboard layout" when `page-grid + intrinsic grid + cluster` already covers it — and do not force marketing-page structure (hero, zigzag, bento) onto a task app.

## 6. Content stress — the layout is not done until it survives this

Landing pages fail on taste; app shells fail on *content*. Before declaring any layout done, stress every region against:

- **Empty** — no rows, no avatar, no value. Does the region collapse gracefully or leave a broken frame?
- **Long label** — a 40-char name in a 12-char slot. Truncate (`text-overflow: ellipsis`) or wrap by design, never by accident.
- **Long paragraph** — does the measure stay readable, or does text run 200 chars wide?
- **Unbroken string** — a URL or token with no spaces. Needs `overflow-wrap: anywhere` / `min-inline-size: 0`, or it forces horizontal scroll.
- **Reflow** — at 375px width the layout reflows to a single readable column with NO horizontal scrollbar. Two-dimensional scrolling of primary content is a fail.
- **Direction** — if the app supports RTL, the layout uses logical properties (`margin-inline`, `inset-inline-start`) so it mirrors correctly.

A layout that only holds the happy-path mock is not finished. Drive these states in `/visual-qa` alongside the interaction states the style skill requires.

## Boundary

This file owns spatial structure only. It never sets color, typography, shadow, radius, or motion values — those trace to `DESIGN.md` and the loaded style skill. If you find yourself adding a brand color to a layout primitive, stop: the primitive stays layout-only and the styling wraps or composes around it.
