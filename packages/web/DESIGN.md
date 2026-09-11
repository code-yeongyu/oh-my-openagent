# Oh My OpenAgent Web — Design System v2 ("Phosphor Ledger")

> **Redesign contract. Written 2026-09-08 from runtime extraction of three reference sites, StyleGallery pattern contracts, the frontend skill's Layer A/B references, and three imagen concept drafts.** This document replaces the 2026-06-24 extraction contract. Every color, size, spacing value, motion value, and component the site renders must trace to a token or primitive named here. If a value is missing, add it here first, then use it.

## 0. Research Log

One line per lane. A lane with no line did not run.

- **Reference site — omp.sh** (runtime `getComputedStyle`, 330 elements × 3 viewports, 17 hover targets driven): single-viewport poster console; substrate `#09090b`, hairlines `rgba(255,255,255,0.08)`, **0px radii everywhere**, Geist 500 display `clamp(2.4rem, 1.2rem + 3.8vw, 4.4rem)` / lh 0.98 / tracking -0.03em, uppercase Geist captions 10–12px tracking 2.2–2.6px, the install command bar IS the CTA (accent prompt cell + mono command + fixed-width COPY), nav underline `scaleX(0→1)` 320ms `cubic-bezier(0.2,0.8,0.2,1)`, color transitions 150ms `cubic-bezier(0.4,0,0.2,1)`, scrolled header `black/72% + blur(12px)`; focal object is a procedural Canvas2D grain horizon (not 3D). Report: `/tmp/omo-web-research/omp-sh/report.md`, tokens `tokens.json`, screenshots 375/768/1280 + hero.
- **Reference site — factory.ai** (runtime extraction, 12→4 track grid measured): pale industrial paper inverted for us; 1440px frame, 24/16px gutters, 3px controls vs 6–12px panels, `box-shadow: none` everywhere, header diffusion `backdrop-filter: blur(64px) saturate(1.5)` without a hard glass card, primary CTA inverts over 150ms, section separation by generous margins (96–160px), one real product demonstration (video) instead of decorative WebGL, headline text-resolution reveal with immediately readable fallback. Report: `/tmp/omo-web-research/factory-ai/report.md`.
- **Reference site — herdr.dev** (runtime extraction, 28 baseline colors): ink `#17171a`, 1440px frame with 1px side rules, gutters 16/20/34px, Archivo 900 display with heavy negative tracking, lavender single accent used sparingly, **stats strip** (large tabular numerals + 10px mono uppercase labels, 4 → 2×2 columns), feature rows as an **index / explanation / evidence ledger** (130 + 1fr + 1fr at 1280, evidence stacks below at ≤768), row hover tint accent/4%, 120ms feature hovers, 2200ms status-dot pulse, interactive HTML terminal as the product visual. Report: `/tmp/omo-web-research/herdr-dev/report.md`. (herdr shows a "backed by" investor line — explicitly NOT copied; see §12.)
- **StyleGallery spatial patterns** (curl, raw.githubusercontent.com/changeroa/StyleGallery): adopted `sticky-header` (nav; no internal scroll), `cover` (hero: `grid-template-rows: auto 1fr auto; min-block-size: 100dvh`), `grid-wrapper` (page frame: `1fr minmax(0, 90rem) 1fr` with full-bleed breakout tracks), `sticky-aside` (mass-ulw section: sticky title column beside the terminal), `reel` (reviews: horizontal scroll container OWNS scroll), `content-limiter` (manifesto prose 68ch), `fixed-sidenav-shell` (docs: `16rem minmax(0,1fr)` grid, `min-block-size: 0`, **`<main>` owns the scroll**). Structural decisions restated in our words; upstream prose not copied.
- **Embedded refs**: shortlisted `linear.app`, `warp`, `vercel`; picked **Layer A `gpt-tasteskill`** (AIDA chapters, 2-line hero rule, gapless bento, massive section spacing; GSAP replaced by CSS scroll-driven animation + IntersectionObserver per §6) + **Layer B `linear.app`** (luminance ladder, `rgba(255,255,255,0.05–0.08)` borders, single chromatic accent, weight ~500 UI text) with `warp` for the mono uppercase editorial labels. `redesign-skill` audit list applied to the existing UI (findings in §11).
- **Imagen concept drafts** (gpt-image-2 via Quotio, 1536×1024): `/tmp/omo-web-research/concepts/a-centered-graph.png`, `b-editorial-split.png`, `c-canvas-bottom-left.png` → **picked B (editorial split)** as the hero reference-fidelity contract: left text column (eyebrow → 2-line display → tagline → command bar → primary + text link), right two-thirds a lit DAG of icosahedral nodes in three waves with a numbered wave rail. A contributes the glass command pill; C contributes pulses travelling along edges.
- **Prior art (own)**: `planet-simulator/src/components/asteroid/Asteroid3D.tsx` — R3F scene with IntersectionObserver defer, WebGL probe + static image fallback, `prefers-reduced-motion` gate, `dpr=[1,2]`, Suspense SVG fallback; LHCI 100/100/100/100 mobile asserts; size-limit budgets. Adopted and tightened in §9.
- **Lazyweb**: skipped — the three user-supplied live references already cover real shipped agent-tool landing pages; recorded as intentional.

## 1. Atmosphere & Identity

An operations ledger read at night. The whole site is one framed sheet of ink ruled by hairlines; content lives in rows and cells, never in floating cards. Everything is still until it is _live_: the only light on the page comes from wires that carry work — the edges of the agent graph, the prompt glyph in the install bar, the active node, the cursor in the terminal — and that light is OmO cyan with a white-hot core.

**Signature material: ink + phosphor.** Flat ink surfaces step by luminance (`ink-0 → ink-3`), separated by 1px `line` hairlines with square corners. Cyan appears only where something is running, selectable, or verified. No gradients as decoration, no purple, no drop shadows.

**The memorable moment:** the hero's agent graph lights up wave by wave — the orchestrator, then the planners, then the workers — and you can grab it and orbit it. Two sections later the same wave grammar plays inside a terminal as `mass ulw` runs. The product's idea (a DAG of specialised agents scheduled in waves and verified at the end) is understood before a paragraph is read.

## 2. Color

### Palette (dark only — the site has no light theme)

| Role          | Token           | Value                    | Usage                                                                                                                 |
| ------------- | --------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Ink / 0       | `--ink-0`       | `#09090b`                | Page substrate                                                                                                        |
| Ink / 1       | `--ink-1`       | `#0e0e11`                | Ledger rows, section bands, command bar                                                                               |
| Ink / 2       | `--ink-2`       | `#14141a`                | Hovered row / tile, terminal chrome                                                                                   |
| Ink / 3       | `--ink-3`       | `#1b1b22`                | Popover, mobile nav sheet, terminal sidebar                                                                           |
| Text / hi     | `--text-hi`     | `#f5f5f7`                | Display, H1–H3, numerals, primary UI                                                                                  |
| Text / mid    | `--text-mid`    | `#c3c4c9`                | Body copy, nav links                                                                                                  |
| Text / lo     | `--text-lo`     | `#8b8c95`                | Captions, metadata, eyebrows                                                                                          |
| Text / faint  | `--text-faint`  | `#55565e`                | Wave rail numerals, disabled, quiet indices — decorative only (2.7:1), never for text that carries meaning on its own |
| Line / strong | `--line-strong` | `rgba(255,255,255,0.12)` | Focused cell, active tab underline base                                                                               |
| Line          | `--line`        | `rgba(255,255,255,0.08)` | Frame, rows, dividers (the default hairline)                                                                          |
| Line / faint  | `--line-faint`  | `rgba(255,255,255,0.04)` | Dot grid, quiet cell separators                                                                                       |
| Accent        | `--accent`      | `#00d4ff`                | Prompt glyph, live wires, active state, links on hover, primary CTA fill                                              |
| Accent / hot  | `--accent-hot`  | `#e6fdff`                | White-hot node core, cursor block, verified flash                                                                     |
| Accent / dim  | `--accent-dim`  | `#0ea5c4`                | Primary CTA hover fill, edge idle color in the 3D scene                                                               |
| Accent / 4    | `--accent-4`    | `rgba(0,212,255,0.04)`   | Row hover tint                                                                                                        |
| Accent / 8    | `--accent-8`    | `rgba(0,212,255,0.08)`   | Selected tile fill, glass chip fill                                                                                   |
| Accent / 16   | `--accent-16`   | `rgba(0,212,255,0.16)`   | Node halo, glow wash center                                                                                           |
| Accent / 32   | `--accent-32`   | `rgba(0,212,255,0.32)`   | 1px inset selection ring, focus ring                                                                                  |
| Status / ok   | `--status-ok`   | `#10b981`                | Done dots, health                                                                                                     |
| Status / busy | `--status-busy` | `#f5c451`                | Working dots (terminal, team grid)                                                                                    |
| Status / err  | `--status-err`  | `#ef4444`                | Blocked / failed dots only                                                                                            |
| Code / bg     | `--code-bg`     | `#0b0b0e`                | Code blocks, terminal body                                                                                            |
| Code / fg     | `--code-fg`     | `#cdd6f4`                | Code text                                                                                                             |

### Ramp rules

- **Cyan is the only chromatic brand color** and it always means _live_: running, selectable, focused, verified. Decorative cyan is a defect. The ramp above is the only way cyan appears; never re-tint `#00d4ff` at an opacity that is not in the table.
- **Status colors mean status.** Green/amber/red appear as 8px dots or 1px indicators next to a state label, never as fills or headings.
- **Depth is luminance, not shadow.** `ink-0 → ink-3` is the elevation stack. `box-shadow` is banned except the two glow recipes in §7.
- **No pure `#000000` or `#ffffff`.** Floor `#09090b`, ceiling `#f5f5f7`.
- **Per-section accent colors are removed** (the violet/orange/pink/fuchsia/teal/indigo/amber/green/blue classes of the previous site). Agent identity is carried by the icon, the mono label, and position in the graph — not by a color.

## 3. Typography

### Stack

- Sans: `var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif` (Geist via `next/font`, self-hosted, `display: swap`).
- Mono: `var(--font-geist-mono), ui-monospace, SFMono-Regular, monospace`.
- No serif. No Inter. Two families only. (omp.sh renders Geist too; herdr's Archivo 900 is _not_ adopted — Geist 500 with tight tracking gives the same authority without the shouting weight.)

### Scale

| Level      | CSS                                       | Weight | Line | Tracking                                      | Usage                                                              |
| ---------- | ----------------------------------------- | ------ | ---- | --------------------------------------------- | ------------------------------------------------------------------ |
| Display    | `clamp(2.5rem, 1.35rem + 4.4vw, 5.25rem)` | 500    | 0.98 | -0.03em                                       | Hero H1 (2 lines max, `text-wrap: balance`, container `max-w-6xl`) |
| Title      | `clamp(2rem, 1.3rem + 2.4vw, 3.25rem)`    | 500    | 1.04 | -0.025em                                      | Section headlines, manifesto H2                                    |
| Heading    | `1.5rem`                                  | 500    | 1.2  | -0.015em                                      | Ledger row titles, bento card titles                               |
| Subheading | `1.125rem`                                | 500    | 1.35 | -0.01em                                       | Agent names, terminal pane titles                                  |
| Numeral    | `clamp(2rem, 1.4rem + 2vw, 2.75rem)`      | 500    | 1.0  | -0.03em, `font-variant-numeric: tabular-nums` | Proof strip                                                        |
| Lead       | `1.125rem` / `1.25rem` ≥ md               | 400    | 1.6  | 0                                             | Hero tagline, section intros                                       |
| Body       | `1rem`                                    | 400    | 1.6  | 0                                             | Default                                                            |
| Body / sm  | `0.875rem`                                | 400    | 1.55 | 0                                             | Row descriptions, review text                                      |
| Eyebrow    | `0.6875rem` mono, uppercase               | 500    | 1.4  | 0.2em                                         | Section labels with meaning ("PRIMARY ORCHESTRATOR"), wave rail    |
| Meta       | `0.75rem` mono                            | 400    | 1.45 | 0.04em                                        | Model chips, timestamps, footer                                    |
| Command    | `0.875rem` mono (`0.8125rem` < sm)        | 400    | 1.55 | -0.01em                                       | Install bar, terminal body                                         |

### Rules

- Display and Title always carry negative tracking; body never does.
- Body never below 14px; the 11px eyebrow is uppercase mono with 0.2em tracking, which is the readability floor for that role.
- Eyebrows are content labels, not chapter numerals. "SECTION 01" / "ABOUT" style meta-labels are banned; "01 / 02 / 03" appears only on the wave rail where the number _is_ the meaning.
- CJK locales keep the existing base-layer rules: `letter-spacing: normal` on headings, `text-wrap: pretty`, `word-break: keep-all` (ko), `line-break: strict` (ja/zh). Display size for CJK drops one clamp step (`clamp(2.25rem, 1.25rem + 3.6vw, 4.5rem)`) so two lines still hold.

## 4. Spacing & Layout

### Base unit: 4px

| Token        | Value | Usage                                           |
| ------------ | ----- | ----------------------------------------------- |
| `--space-1`  | 4px   | icon-to-label                                   |
| `--space-2`  | 8px   | inline groups, dot-to-label                     |
| `--space-3`  | 12px  | chip padding, cell padding (compact)            |
| `--space-4`  | 16px  | mobile gutter, cell padding                     |
| `--space-5`  | 20px  | tablet gutter                                   |
| `--space-6`  | 24px  | row padding, bento card padding                 |
| `--space-8`  | 32px  | desktop gutter, command bar height rhythm       |
| `--space-12` | 48px  | block gap inside a section                      |
| `--space-16` | 64px  | section padding (mobile)                        |
| `--space-24` | 96px  | section padding (desktop)                       |
| `--space-40` | 160px | hero → proof strip separation, final CTA margin |

### Frame and grid

- **Frame** (`grid-wrapper`): `grid-template-columns: 1fr minmax(0, 90rem) 1fr`; content sits in the center track (max 1440px) and is bounded by 1px `--line` side rules at ≥ lg; full-bleed sections (hero glow, CTA band) span all three tracks.
- Gutters: 16px (< sm) → 20px (sm–lg) → 32px (≥ lg). Never `px-8` on mobile.
- Inner grid: 12 tracks / 24px gap at ≥ lg; 4 tracks / 16px gap below.
- Breakpoints: Tailwind defaults (sm 640, md 768, lg 1024, xl 1280, 2xl 1536). The hero switches from stacked to editorial split at **lg**.
- Section rhythm: `py-16 lg:py-24`; the hero → proof strip and reviews → CTA gaps use `--space-40`. Sections are chapters; do not cramp.
- Hero: `cover` pattern, `min-h-[100dvh]` (never `h-screen`), `grid-template-rows: auto 1fr auto` with nav / content / proof-strip anchor.
- Docs shell: `fixed-sidenav-shell` — `grid-template-columns: 16rem minmax(0, 1fr)`, `min-block-size: 0` on the grid and both children, `<main>` is the scroll owner (`overflow: auto`), sidebar sticky inside its column. On < lg the sidebar collapses into a top disclosure; `<main>` keeps `min-inline-size: 0` and prose gets `overflow-wrap: anywhere`, code blocks `overflow-x: auto` — this fixes the recorded 390px horizontal overflow debt instead of carrying it.
- Manifesto: `content-limiter` at 68ch for prose; section breaks are ruled by `--line`, not by background swaps.

### Rules

- Grid for multi-column; no flexbox percentage math.
- Radius scale: **0px** for panels, rows, cards, terminals; **2px** for buttons, chips, inputs; **50%** for status dots only. `rounded-xl`/`rounded-3xl` are gone.
- Cards exist only as bento cells inside a ruled grid (agents). No free-floating cards with borders + shadows.

## 5. Components (primitives + states)

All primitives live in `components/ui/*` (existing shadcn shells re-tokened) or `components/ledger/*` (new). Every state below must be visible in the primitive showcase route (`/design` in dev builds, excluded from the sitemap) at 375/768/1280 before any product screen uses it.

### Frame (`components/ledger/frame.tsx`)

- `grid-wrapper` implementation; renders the two side rules at ≥ lg. Props: `bleed?: boolean` for full-bleed children.

### Nav (`components/nav-header.tsx`)

- Sticky (`sticky-header`), height 60px, `--ink-0/72%` + `backdrop-filter: blur(12px)` after `scrollY > 24px` (transparent before), bottom hairline `--line`.
- Left: OmO mark (24px SVG from `.github/assets/omo-icon-light.svg` re-exported to `public/brand/omo-mark.svg`) + wordmark `Oh My OpenAgent` (Geist 500 15px, -0.02em).
- Center/right: links `Agents · Docs · Manifesto` in `--text-mid` mono 12px uppercase 0.12em; hover → `--text-hi` with a 1px underline growing `scaleX(0→1)` 320ms.
- Right: GitHub chip (mono `★ 68.8k` live count, `--ink-1` fill, `--line` border) and primary button `Install` (sm size).
- Mobile: hamburger 44×44; sheet `--ink-3` with `--line` top rule; items 44px tall.
- States: default, scrolled, open (mobile), link hover/focus-visible (2px `--accent-32` outline offset 2px), active route (underline visible at scaleX(1), `--text-hi`).

### Button (`components/ui/button.tsx`)

- Variants: `primary` (fill `--accent`, text `#09090b`, hover fill `--accent-dim`, active `translateY(1px)`), `secondary` (fill `--ink-1`, border `--line-strong`, text `--text-hi`, hover border `--accent-32` + text `--accent`), `ghost` (text `--text-mid`, hover `--text-hi`), `link` (mono uppercase 12px with arrow, underline scaleX on hover).
- Sizes: sm `h-9 px-3 text-sm`, md `h-11 px-5 text-sm`, lg `h-12 px-6 text-base`. Radius 2px. Focus-visible: 2px `--accent-32` outline, offset 2px. Disabled: opacity .5, no pointer.
- Transitions: color/background/border 150ms `cubic-bezier(0.4,0,0.2,1)`; transform 150ms.

### CommandBar (`components/landing/install-command.tsx`)

- The primary CTA of the site (omp.sh grammar). Row: prompt cell (40px wide, `--accent` `$`/`>` glyph on `--ink-2`), mono command in `--text-hi` on `--ink-1`, fixed-width COPY cell (mono uppercase 11px, `--text-lo` → `--text-hi` on hover, → `--accent` + "COPIED" for 2s after click). 1px `--line` border, 0px radius, height 48px; on < sm the command scrolls horizontally inside the cell (no wrap) and COPY stays reachable.
- Optional tab row above (e.g. `OPENCODE · CODEX · SENPI`): mono 11px uppercase, inactive `--text-lo`, active `--text-hi` with a 1px `--accent` bottom border; 150ms color.
- Glow: none by default; `focus-within` adds the inset ring `0 0 0 1px var(--accent-32)`.

### Eyebrow (`components/ledger/eyebrow.tsx`)

- Mono 11px uppercase 0.2em `--text-lo`; optional leading 24px hairline rule (`--line-strong`) like a ledger tab. Optional trailing status dot.

### ProofStrip (`components/landing/proof-strip.tsx`)

- 4 cells (2×2 < lg) separated by `--line`; each cell: Numeral (live from `/api/stats`, tabular, `--text-hi`) + Eyebrow label + icon 14px. Hover: cell fill `--accent-4`. Numbers count up once on enter (600ms) — meaning: they are live; reduced motion renders the final value.

### LedgerRow (`components/ledger/ledger-row.tsx`)

- Grid `[minmax(0,130px)] 1fr 1fr` at ≥ lg (index / explanation / evidence); `[54px] 1fr` below with evidence stacked under the explanation. Row padding 24px 0, hairline between rows, `--accent-4` fill on hover, index in Numeral style `--text-faint`. Used by Editions, Orchestration flow, Profiles, Principles.
- States: default, hover, focus-within (index turns `--accent`), `data-active` (left 2px `--accent` rule) when linked from the graph.

### BentoCell (`components/ledger/bento-cell.tsx`)

- Cells of the agents grid (`grid-flow-dense`, 1px gaps revealing `--line`, so the grid itself draws the rules). Cell fill `--ink-1`, hover `--ink-2` + icon `--accent`, spans: orchestrator 2×2, planner 2×1, others 1×1; mobile 1 column, tablet 2. Content: icon 20px (Lucide/Phosphor SVG), name (Subheading), role (Body/sm `--text-mid`), model chip (Meta mono on `--ink-2`, `--line` border, 2px radius).
- Gapless verification: 4 columns × 4 rows desktop = 16 units: orchestrator 4 + planner 2 + 10 singles = 16. Tablet 2 columns: orchestrator 2×2, planner 2×1, 10 singles → 4 + 2 + 10 = 16 = 2 × 8 rows. No holes.

### Terminal (`components/landing/terminal.tsx`)

- HTML/CSS terminal (herdr grammar): chrome bar (`--ink-2`, three 8px status dots `--text-faint`, title mono meta), sidebar `--ink-3` at ≥ md listing waves, body `--code-bg` mono 13px `--code-fg`. Cursor block `--accent-hot` blinking 1s steps(1). Scroll-gated typewriter of `mass ulw …` at 40ms/char once 40% visible; then wave rows render one by one with status dots `--status-busy → --status-ok`; final line `verified ✓` flashes `--accent-hot` → `--text-hi`. Reduced motion: renders the final frame immediately.
- Interactive: clicking a wave row highlights that wave's nodes in the hero graph if the hero is mounted (shared `useGraphFocus` store), otherwise it is inert but styled as `data-active`.

### Reel (`components/ledger/reel.tsx`)

- `display: grid; grid-auto-flow: column; grid-auto-columns: minmax(280px, 34%); overflow-x: auto; scroll-snap-type: x mandatory;` the reel owns the scroll; edge fade masks 32px; keyboard: cells are focusable, arrow keys scroll by one cell. Used by Reviews.

### Chip (`components/ui/badge.tsx` → `Chip`)

- Mono Meta text, `--ink-2` fill, `--line` border, 2px radius, 24px tall; `accent` variant fills `--accent-8` with `--accent` text (live/selected only).

### DocsShell (`components/docs/docs-shell.tsx`)

- `fixed-sidenav-shell` as in §4; sidebar: search input (Chip-styled, focus ring), section list with active item marked by a 2px `--accent` left rule; main: prose with `--line` ruled H2s, code blocks `--code-bg` with `overflow-x: auto`.

### Footer (`components/footer.tsx`)

- Top hairline, `py-12`, grid 2 → 4 columns: brand + copyright (mono meta: "© {year} Sisyphus Labs · Source-available under SUL-1.0"), Product (Docs, Manifesto, Releases), Community (GitHub, Discord, X @justsisyphus), Legal (Privacy, Terms). Links `--text-lo` → `--text-hi`. No investor/affiliation lines.

## 6. Motion & Interaction

| Token              | Value                            | Usage                                                    |
| ------------------ | -------------------------------- | -------------------------------------------------------- |
| `--ease-standard`  | `cubic-bezier(0.4, 0, 0.2, 1)`   | color/opacity                                            |
| `--ease-out-quart` | `cubic-bezier(0.16, 1, 0.3, 1)`  | entrance                                                 |
| `--ease-underline` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | link underline                                           |
| `--dur-micro`      | 150ms                            | hover color, press                                       |
| `--dur-underline`  | 320ms                            | nav/link underline                                       |
| `--dur-reveal`     | 600ms                            | section entrance (`translate3d(0,16px,0) → 0` + opacity) |
| `--dur-count`      | 600ms                            | proof-strip count-up                                     |
| `--dur-type`       | 40ms/char                        | terminal typewriter                                      |
| `--dur-pulse`      | 2200ms                           | status dot pulse (opacity 1 → .55 → 1)                   |
| `--dur-wave`       | 12s cycle                        | graph wave loop (shared by 3D scene and terminal)        |

### Rules

- Only `transform`, `opacity`, `filter` and the color family (`color`, `background-color`, `border-color`, `fill`, `stroke`) animate — never layout properties (`width`, `height`, `top`, `left`, margin, padding). Height morphs (mobile nav) use `grid-template-rows: 0fr → 1fr` on a wrapper, not `max-height`.
- Entrance: `.reveal` uses `animation-timeline: view()` (`animation-range: entry 0% entry 40%`) when `@supports (animation-timeline: view())`, else the IntersectionObserver `.is-visible` class. Stagger `calc(var(--index) * 60ms)`. Each element reveals once.
- Every motion maps to a state or affordance: hover → underline/tint, press → 1px translate, live data → count-up, scene progress → wave lights. Motion on non-interactive decoration is banned (this includes floating shapes, parallax, cursor trails, magnetic buttons, scroll-jacking).
- No motion library. GSAP, Lottie, `framer-motion` are banned; `motion/react` is allowed only for a `layoutId` shared-layout need, currently unused.
- `prefers-reduced-motion: reduce`: reveals render final state, count-ups render final numbers, terminal renders its final frame, typewriter and pulses stop, the 3D scene is not mounted (poster only).
- Interaction mechanics traced to beui.dev catalog patterns: `action-swap` (COPY → COPIED), `number` (count-up), `tabs` underline indicator (command bar tabs, CSS-only), `tooltip`-style label chip for hovered graph nodes (opacity 150ms).

## 7. Depth & Surface

Strategy: **tonal shift + hairline**. Surfaces are flat ink; separation is 1px `--line`; elevation is one ink step.

| Level | Fill      | Rule            | Usage                          |
| ----- | --------- | --------------- | ------------------------------ |
| 0     | `--ink-0` | —               | page                           |
| 1     | `--ink-1` | `--line`        | rows, command bar, bento cells |
| 2     | `--ink-2` | `--line`        | hover, terminal chrome, chips  |
| 3     | `--ink-3` | `--line-strong` | mobile sheet, terminal sidebar |

Allowed glow recipes (the only `box-shadow`/gradient decoration on the site):

- **Selection ring**: `box-shadow: inset 0 0 0 1px var(--accent-32)` (focus-within, selected tile).
- **Hero wash**: `radial-gradient(circle at 70% 45%, var(--accent-16), transparent 46%)` behind the graph, plus a `--line-faint` dot grid (`radial-gradient(var(--line-faint) 1px, transparent 1px)` at 28px) — both static.
- **Scrolled nav**: `--ink-0/72%` + `backdrop-filter: blur(12px)`.
- The 3D node halos are additive sprites inside the canvas, not CSS.

Grain is not used (omp.sh's canvas grain and factory's texture PNG would fight the 3D scene); the dot grid is the texture.

## 8. Accessibility

- `<html lang>` per locale; unique `<title>` per route; skip link to `#main-content`; landmarks `header/nav/main/footer/section[aria-labelledby]`.
- Contrast: `--text-hi` on `--ink-0` 17.8:1, `--text-mid` 11.5:1, `--text-lo` 5.9:1 (AA for 11px+ mono uppercase is met because eyebrows are ≥ 11px 500 with tracking; body never uses `--text-faint`), `--accent` on `--ink-0` 11.4:1, primary button `#09090b` on `--accent` 11.4:1.
- Focus-visible ring on every interactive element (2px `--accent-32`, offset 2px); the canvas wrapper is focusable with arrow-key orbit and is `aria-hidden` for AT while the poster `<img alt>` describes the scene.
- Touch targets ≥ 44px on mobile (nav items, COPY cell, bento cells are ≥ 44px tall).
- Reduced motion honored everywhere (§6). Reduced data (`navigator.connection.saveData`) and low memory skip the 3D chunk (§9).
- Reel and docs main announce as scroll regions (`role="region"` + `aria-label`, `tabindex=0`).
- Personas: terminal power user (keyboard-first, copyable commands, dense reference), mobile evaluator (no horizontal overflow on `/`, `/manifesto`, `/docs` at 375), CJK reader (heading tracking reset, keep-all), motion-sensitive user (poster hero, static terminal).

## 9. The Graph — 3D interactive hero scene

### Meaning

The GitHub one-liner calls the user "the master of graph engineering". The focal object is that graph: a directed acyclic graph of agent nodes scheduled in waves by `mass ulw`. Wave 1 = orchestrator (lead) → wave 2 = Ultrawork Planner, Plan Consultant, Plan Reviewer (plan + gates) → wave 3 = Kibitzer, Architect, Deep, Quick, Visual Engineering, Explore, Librarian (categories and curated agents, execution). A 12s loop lights the waves in order, pulses travel down the edges, and a final "verified" flash settles the graph.

### Content and geometry

- Desktop 11 nodes / mobile 7 (drop Plan Consultant, Kibitzer, Quick, Visual Engineering). Positions precomputed in `components/landing/graph/graph-data.ts` (seeded, three planes along -Z).
- Node = icosahedron (detail 1) `MeshStandardMaterial` (`--ink-3` base, emissive `--accent-dim`, emissiveIntensity 0.2 idle → 1.6 lit) + one additive-blended halo sprite (shared 64×64 radial CanvasTexture, `--accent-16` → transparent). No bloom / postprocessing.
- Edges = one `LineSegments` geometry, `--accent-dim` at 0.35 opacity; lit edge 0.8.
- Pulses = one `Points` object (≤ 48 desktop / 24 mobile) whose `t` along its edge advances per frame in a typed array; size 6px, `--accent-hot`.
- Labels: a single drei `<Html>` chip (Chip primitive, mono) for the hovered/focused node only.
- Lights: 1 ambient (0.25) + 1 directional (1.2, cool). No shadows, no env map.

### Interaction

- Drag/touch-drag orbits (OrbitControls: `enableZoom=false`, `enablePan=false`, `enableDamping`, `dampingFactor 0.08`, polar angle clamped to `[π/3, 2π/3]`). Auto-rotate 0.15 rad/s when idle; pauses on interaction, resumes 4s after the last input.
- Hover → node halo brightens + label chip; click/tap → camera eases to the node (600ms `--ease-out-quart`) and the matching agent bento cell receives `data-active`; Escape / empty click resets.
- Keyboard: wrapper is focusable; ← → rotate 15°, Enter focuses the nearest node, Escape resets.

### Performance contract (planet-simulator pattern, tightened)

- `next/dynamic(() => import("./graph-scene"), { ssr: false })` mounted only when ALL hold: hero IntersectionObserver hit; `requestIdleCallback` fired (fallback 200ms timeout); `!matchMedia("(prefers-reduced-motion: reduce)").matches`; WebGL2 context probe succeeded; `navigator.deviceMemory` ≥ 2 when present; `navigator.connection?.saveData !== true`.
- Poster `/images/graph-poster.webp` (1600×1000, ≤ 60 KB, rendered from the scene) is the LCP: explicit `width/height`, `fetchPriority="high"`, `sizes` per breakpoint. The canvas fades in over it (opacity 400ms) after its first frame; the poster stays as the fallback for reduced-motion / no-WebGL / low-end / runtime error (ErrorBoundary).
- Canvas: `dpr={[1, isMobile ? 1.25 : 1.75]}`, `gl={{ antialias: !isMobile, powerPreference: "high-performance", alpha: true }}`, `frameloop="always"` only while the hero is on screen and the tab visible, otherwise `"demand"`; after 20s without interaction, `"demand"` with one `invalidate()` per second to keep the wave loop alive.
- Budget: the lazy renderer chunks (three core + @react-three/fiber + react-reconciler + the two drei modules) ≤ 224 KB gzip total, asserted by `scripts/check-graph-budget.mjs` (`bun run check:graph-budget`); three must not appear in the first-load JS of `/` (checked against the app build manifest). Measured 2026-09-08: 209.3 KB gzip across two chunks (163.4 + 45.9); three's core alone is ~150 KB gzip and is irreducible, so the budget is set at measured + 7% headroom rather than the 190 KB first estimate. drei is imported per module, never the barrel.
- Lighthouse guard: chunk loads after LCP; TBT contribution ≤ 50ms on the mobile preset; the poster keeps CLS at 0.

## 10. Verification Matrix

| Scenario           | Surface                         | Evidence                                                                                                                                                                       |
| ------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Primitive showcase | `/design` (dev) at 375/768/1280 | Screenshot per primitive state before product screens                                                                                                                          |
| Landing fidelity   | `/` at 375/768/1280 (+ `/ko`)   | Screenshots; hero matches concept B structure; `scrollWidth <= innerWidth` at 375                                                                                              |
| Manifesto          | `/manifesto` at 375/1280        | Screenshots; no overflow at 375                                                                                                                                                |
| Docs shell         | `/docs` at 375/1280             | Screenshots; sidebar toggle, search, hash nav; **no horizontal overflow at 375** (debt closed)                                                                                 |
| 3D hero            | `/` desktop                     | Canvas present; drag before/after screenshots; poster-only with `prefers-reduced-motion` and with WebGL disabled; chunk size + route-table proof                               |
| Motion             | `/`                             | Reveal fires once; terminal typewriter gated by visibility; reduced-motion final frames                                                                                        |
| Gates              | `packages/web`                  | `format:check`, `lint`, `type-check`, `opennextjs-cloudflare build`, Playwright e2e, Lighthouse (real Chromium, prod build): perf ≥ 90 mobile / ≥ 95 desktop, a11y/BP/SEO ≥ 95 |
| Token compliance   | `packages/web`                  | `rg` for raw hex outside `DESIGN.md` and `app/styles/design-system.css` returns only `lib/og/palette.ts` (satori has no CSS variables; it mirrors §2)                          |

## 11. Redesign audit (what the previous site got wrong, per `redesign-skill`)

- Per-section rainbow accents (violet/orange/pink/fuchsia/teal/indigo/amber/green/blue) — removed (§2).
- Three-equal-column feature grids (Reviews, Architecture) and 5-column step rows — replaced by ledger rows, a gapless bento, and a reel (§5).
- `rounded-xl/3xl` cards with `bg-zinc-900/30` + border + shadow — replaced by ruled ink cells with 0px radius (§4, §7).
- Stats crammed into the hero — moved to the proof strip; the hero carries one statement, one tagline, one command, two actions (§5, gpt-tasteskill hero rule).
- Static hero photograph fading behind text — replaced by the meaningful 3D graph with a poster LCP (§9).
- Bold-everywhere headlines (`font-bold` 700 at 72px) — Geist 500 with -0.03em tracking (§3).
- Docs horizontal overflow at 390px carried as debt — fixed by the shell contract (§4).
- Static OG PNG — dynamic `next/og` image using the same palette, Geist subsets, and the graph glyph (`app/opengraph-image.tsx`).

## 12. Banned Patterns (project-specific)

- Any mention of investors, accelerators, or "backed by" lines anywhere on the site, in OG images, or in metadata. (Confidential; the reference site herdr.dev carries one — do not mirror it.)
- Raw hex or rgba outside this file, `app/styles/design-system.css`, and `lib/og/palette.ts`.
- `#000000`, `#ffffff`, purple/blue gradients, decorative cyan, per-section accent colors.
- Border radius other than 0 / 2px / 50%.
- `h-screen`; `max-height` animations; animating layout properties.
- Three-equal-column feature card grids; floating bordered cards with shadows.
- Emojis in JSX, alt text, or visible UI. Icons are SVG (Lucide / Phosphor).
- Meta-labels ("SECTION 01", "ABOUT US"); generic hype copy ("seamless", "unleash", "next-gen").
- `framer-motion`, GSAP, Lottie; `export const runtime = "edge"`; `any` casts and TS suppressions.
- Importing the `@react-three/drei` barrel; mounting the 3D scene before the gates in §9 pass; shipping the scene without the poster.
- Serif or Inter typefaces; Korean serif fallbacks.

## 13. Accepted debt

- `/design` showcase route is dev-only and not localized.
- The 3D poster is rendered once per design change by `scripts/render-graph-poster.mjs` (Playwright screenshot of the mounted scene); it is a committed asset, not generated at build.
- Satori cannot read CSS variables, so `lib/og/palette.ts` duplicates §2 values; a `scripts/check-og-palette.mjs` diff against `design-system.css` guards drift.
