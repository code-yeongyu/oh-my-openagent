# Oh My OpenAgent Web — Design System

> **Extracted from existing code and rendered baseline evidence. Refreshed 2026-06-24.** This document is the implementation contract for the current site. The dark + cyan terminal/hacker identity is the brand and stays. This contract preserves the current rendered experience first; consolidation ideas are design debt unless a later PR explicitly changes the visual language.

## 0. Implementation Contract

- CSS source of truth: `app/styles/design-system.css` owns the Tailwind entrypoint, theme mappings, root tokens, base rules, shared utilities, docs prose styles, and motion primitives. `app/globals.css` is a filesystem alias to that entry so Next/Tailwind continue to read the same single global stylesheet surface without an import-wrapper layer.
- Component primitives: `components/ui/*` provide shadcn-style Button, Badge, Card, Input, Section, and Separator variants. New repeated UI patterns must use these primitives or document a new primitive here first.
- Page surfaces: `app/_components/landing-page.tsx`, `components/landing/**`, `components/docs/docs-shell.tsx`, `components/nav-header.tsx`, and `components/footer.tsx` consume the contract.
- Current PR intent: no redesign, no copy change, no interaction change. Extraction work must be pixel-identical to the baseline screenshots under `.omo/ultrawork/design-system-fidelity/evidence/baseline/screenshots/`.
- Pre-existing accepted debt for this extraction: `/docs` at 390x844 has horizontal overflow in the baseline (`scrollWidth - innerWidth = 538`). Do not worsen it in this PR; fixing it requires a docs-shell layout PR with fresh design review.

## 1. Atmosphere & Identity

A senior engineer's command center, glowing in the dark. Surfaces are near-black with a faint cool undertone; cyan punctuation marks the live wires of the system — install commands, primary CTAs, terminal cursors, hover affordances. Density is purposeful: stats bar, code blocks, agent cards. Whitespace exists but is _engineered_, never decorative.

**Signature**: cyan-on-near-black with razor-thin borders and a single hero photograph receding into the canvas — like a screenshot of `htop` lit by a moon. The terminal mockup in the Ultrawork section is the visual anchor: this product _is_ the terminal, not a marketing site about the terminal.

## 2. Color

### Palette

| Role                    | Token                     | Hex                       | Usage                                         |
| ----------------------- | ------------------------- | ------------------------- | --------------------------------------------- |
| Surface / 0             | `--surface-0`             | `#0a0a0a`                 | Page background                               |
| Surface / 1             | `--surface-1`             | `rgba(255,255,255,0.018)` | Subtle section/card tint                      |
| Surface / 2             | `--surface-2`             | `rgba(255,255,255,0.035)` | Default elevated tint                         |
| Surface / 3             | `--surface-3`             | `rgba(255,255,255,0.055)` | Hover/elevated tint                           |
| Text / primary          | `--text-primary`          | `#ededed`                 | Headlines, body emphasis                      |
| Text / secondary        | `--text-secondary`        | `#a1a1a1`                 | Body copy (current `--muted-foreground`)      |
| Text / tertiary         | `--text-tertiary`         | `#71717a`                 | Captions, metadata (zinc-500)                 |
| Border / default        | `--border-default`        | `#262626`                 | Card borders, dividers (current `--border`)   |
| Border / subtle         | `--border-subtle`         | `rgba(255,255,255,0.06)`  | Whisper-thin separators (used in nav/footer)  |
| Accent / primary        | `--accent-primary`        | `#00d4ff`                 | Brand cyan — CTAs, links, focus, terminal `$` |
| Accent / primary-soft   | `--accent-primary-soft`   | `rgba(0,212,255,0.10)`    | Cyan backgrounds, glow tints                  |
| Accent / primary-border | `--accent-primary-border` | `rgba(0,212,255,0.20)`    | Cyan-tinted borders on badges                 |
| Accent / secondary      | legacy `--secondary`      | `#7c3aed`                 | Reserved — currently overused (see below)     |
| Status / success        | `--status-success`        | `#10b981`                 | Success indicators only                       |
| Status / warning        | `--status-warning`        | `#f59e0b`                 | Cautions only                                 |
| Status / error          | `--status-error`          | `#ef4444`                 | Errors / destructive only                     |
| Code / bg               | `--code-bg`               | `#1e1e2e`                 | Code block backgrounds                        |
| Code / fg               | `--code-text`             | `#cdd6f4`                 | Code text                                     |

### Rules

- **Cyan is the only chromatic brand color.** Every interactive element should resolve through it.
- **Surface hierarchy via luminance, not borders where possible.** `0a0a0a` → `111111` → `1a1a1a` is the depth stack. Borders are the punctuation, not the wall.
- **Never use pure `#000000`** — `#0a0a0a` or `#08090a` is the floor. Pure black is too harsh and signals "AI dark mode".
- **Never use pure `#ffffff`** for text — `#ededed` is the ceiling. Pure white screams.
- **No purple/blue "AI gradient"** decoratively. The `--accent-secondary` purple (`#7c3aed`) exists as a token but should be reserved for genuine semantic moments (Sisyphus / agent identity), not as eye candy on CTAs or backgrounds.

### Inconsistencies to consolidate (design debt, not this extraction)

The current landing page assigns a distinct accent color _per section_ — purple, orange, pink, fuchsia, teal, indigo, amber, green, blue. Because this PR must preserve the current rendered baseline, these colors remain in component class names for now. Refinement target:

- **Cyan**: Primary CTA, install command, hero, CTA section, default link/hover.
- **Legacy `--secondary` / future `--accent-secondary` (single muted indigo `#7c3aed`)**: Agent identity (Sisyphus, sub-agents) — when an agent name appears, it gets the secondary accent badge. Not the whole card.
- **Status colors**: ONLY for actual status (success/warning/error). NOT for decorative section accents.
- **Everything else**: monochrome (white opacity ladder for surfaces, zinc/neutral for text).

Target for a future visual-refinement PR: 2 chromatic colors total (cyan + indigo), all per-section colors removed. This extraction PR does not apply that visual change because it must preserve the current rendered baseline exactly.

## 3. Typography

### Font Stack

- **Primary sans**: `var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif` (Geist via `next/font/sans`)
- **Mono**: `var(--font-geist-mono), ui-monospace, SFMono-Regular, monospace` (Geist Mono via `next/font/mono`)
- **No serif**: Banned for this product — technical dev tool, not editorial.

`next/font` is used → fonts are self-hosted, `display: swap` is the default, CLS is zero.

### Scale

| Level      | Class                  | Size    | Weight | Line | Tracking            | Usage                           |
| ---------- | ---------------------- | ------- | ------ | ---- | ------------------- | ------------------------------- |
| Display XL | `text-7xl md:text-8xl` | 72→96px | 700    | 1.00 | `-0.04em` (tighter) | Reserved — manifesto only       |
| Display    | `text-5xl md:text-7xl` | 48→72px | 700    | 1.05 | `-0.03em`           | Hero H1                         |
| H1         | `text-4xl md:text-5xl` | 36→48px | 700    | 1.10 | `-0.025em`          | Section headlines               |
| H2         | `text-3xl md:text-4xl` | 30→36px | 700    | 1.15 | `-0.02em`           | Sub-section headlines           |
| H3         | `text-2xl md:text-3xl` | 24→30px | 600    | 1.25 | `-0.015em`          | Card titles                     |
| H4         | `text-xl md:text-2xl`  | 20→24px | 600    | 1.30 | `-0.01em`           | Subheads                        |
| Lead       | `text-xl md:text-2xl`  | 20→24px | 300    | 1.50 | normal              | Hero subtitle                   |
| Body L     | `text-lg`              | 18px    | 400    | 1.60 | normal              | Long-form paragraphs            |
| Body       | `text-base`            | 16px    | 400    | 1.60 | normal              | Default                         |
| Body S     | `text-sm`              | 14px    | 400    | 1.55 | normal              | Card descriptions               |
| Caption    | `text-xs`              | 12px    | 500    | 1.45 | `0.02em`            | Metadata, badges                |
| Overline   | `text-xs uppercase`    | 12px    | 600    | 1.40 | `0.10em`            | Section labels (PHASE 1, BADGE) |
| Mono       | `font-mono text-sm`    | 14px    | 400    | 1.50 | normal              | Install command, code labels    |

### Rules

- **Body never below 14px.** Captions at 12px must be uppercase or tabular.
- **Display sizes always run negative tracking.** From `-0.04em` at 72px down to `-0.015em` at 24px.
- **Geist 700 is the workhorse weight** for headlines. 600 for sub-heads, 400 reading. Avoid 800/900 — Geist's heaviest weights are too thick at small sizes.
- **CJK locales** (ko/ja/zh) reset `letter-spacing: normal`, use `text-wrap: pretty`, and apply `word-break: keep-all` (Korean) or `word-break: normal; line-break: strict` (Japanese/Chinese). Already in `globals.css:183-219`.
- **No serif. No Inter.** Geist Sans + Geist Mono only.

## 4. Spacing & Layout

### Base Unit

4px grid (Tailwind default). All multiples derived from `--space-1 = 4px`.

| Token        | Tailwind | Value | Usage                                  |
| ------------ | -------- | ----- | -------------------------------------- |
| `--space-1`  | `p-1`    | 4px   | Icon-to-label                          |
| `--space-2`  | `p-2`    | 8px   | List items, inline groups              |
| `--space-3`  | `p-3`    | 12px  | Form padding                           |
| `--space-4`  | `p-4`    | 16px  | Card padding (compact)                 |
| `--space-6`  | `p-6`    | 24px  | Card padding (default)                 |
| `--space-8`  | `p-8`    | 32px  | Card padding (featured)                |
| `--space-10` | `p-10`   | 40px  | Section inner                          |
| `--space-12` | `p-12`   | 48px  | Hero vertical                          |
| `--space-16` | `p-16`   | 64px  | Section vertical                       |
| `--space-24` | `py-24`  | 96px  | Major section breaks (current default) |
| `--space-32` | `py-32`  | 128px | Hero top padding                       |

### Grid

- Max content width: `container mx-auto` resolves to `max-w-7xl` (1280px). Hero/manifesto use `max-w-4xl` (896px) or `max-w-5xl` (1024px) for typographic density.
- Breakpoints: Tailwind defaults — sm 640, md 768, lg 1024, xl 1280, 2xl 1536.
- Padding: `px-4 md:px-6` on every container — never `px-8` on mobile (cramped).

### Rules

- **No `h-screen`.** Always `min-h-[100dvh]` — current `min-h-screen` and `min-h-[90vh]` should migrate to `dvh` for iOS Safari stability.
- **No flexbox percentage math.** CSS Grid for multi-column.
- **Container** wraps every section content. No edge-bleed except hero background image.
- **3-column equal card grids** for _features_ are banned. The current Reviews and Architecture sections use 3-column — acceptable for testimonial/principle tiles where uniformity is the point. The Hephaestus 5-column step row is also acceptable (sequential numbered steps).

## 5. Components

### Hero

- **Structure**: `<section className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden pt-16">` with absolute-positioned background image (decorative, ~30% opacity) and gradient overlay.
- **Background**: `hero.webp` preloaded `fetchPriority="low"` so the headline is the LCP. Image fades in via CSS keyframe over 600ms, respects `prefers-reduced-motion`.
- **Variants**: Landing hero (centered), manifesto hero (centered with stronger gradient).
- **Spacing**: `gap-8` between stack items, max-width `max-w-3xl` for headline.
- **Motion**: CSS-only fade-in on the background.

### Button (shadcn-based)

- **Structure**: cva variants `default | secondary | ghost | outline | link | destructive` × sizes `sm | default | lg | icon`.
- **Primary CTA**: `bg-cyan-500 text-black hover:bg-cyan-600` — black-on-cyan reads as a primary "system action".
- **Outline**: `border-zinc-700 text-white hover:bg-zinc-800` — secondary.
- **States**: default, hover (color shift), focus-visible (`ring-1 ring-ring`), disabled (`pointer-events-none opacity-50`). Active translation is not part of the current implementation.
- **Radius**: 6px (`rounded-md`).
- **Primitive sizes**: lg = `h-10 px-8`, default = `h-9 px-4 py-2`, sm = `h-8 px-3 text-xs`, icon = `h-9 w-9`.
- **Hero/CTA overrides**: primary hero buttons add `h-12 px-8 text-lg font-bold` and outline hero buttons add `h-12 px-8 text-lg`.

### Card (shadcn-based)

- **Structure**: `Card / CardHeader / CardTitle / CardDescription / CardContent`.
- **Background**: primitive default is `bg-card`; landing sections commonly override with `bg-zinc-900/30`, `bg-black/40`, or related white-alpha tints. New shared surfaces should map to `--surface-1/2/3`.
- **Border**: primitive default is `border`; landing sections commonly override with `border-zinc-800`, `border-white/10`, and `border-border`. New shared surfaces should map to `--border-default` or `--border-subtle`.
- **Radius**: primitive default is 12px (`rounded-xl`); section-local cards may use `rounded-lg`, `rounded-xl`, or `rounded-3xl` where currently rendered.
- **Shadow**: primitive default includes Tailwind `shadow`; many landing card usages visually rely on border + translucent surface more than strong shadows. Do not remove the primitive shadow in this extraction.
- **Hover**: Optional border-color shift to `border-cyan-500/30` for interactive cards.
- **States**: default, hover (border lifts), focus-within (cyan border).

### Badge

- **Structure**: cva variants `default | secondary | outline | destructive`.
- **Primary**: `border-cyan-500/20 bg-cyan-500/10 text-cyan-400` — cyan-tinted pill.
- **Outline**: `border-zinc-700 text-zinc-400` — neutral.
- **Radius**: 9999px (`rounded-full`) for status pills, `rounded-md` (6px) for badges.

### Install Command

- **Structure**: `<div className="relative rounded-lg border bg-black/50 backdrop-blur-sm p-4 font-mono">` with copy button.
- **States**: default (copy icon), copied (check icon, 2s timeout).
- **Glow**: `shadow-2xl shadow-cyan-500/10` — restrained.

### Terminal Mockup (Ultrawork section)

- **Structure**: rounded card with `chrome dots`, title bar, content with monospace text + animated typewriter for the command input.
- **Border**: `border-zinc-800`.
- **Background**: pure black to mimic terminal.
- **Motion**: TerminalTypewriter via IntersectionObserver — once visible, types out at 40ms/char. No motion library dep — pure JS.

### Nav

- **Structure**: sticky header `border-b border-white/10 bg-black/50 backdrop-blur-xl`.
- **Brand**: `text-lg font-bold tracking-tight`.
- **Links**: `text-sm font-medium text-zinc-400 hover:text-cyan-400 transition-colors`.
- **Mobile**: hamburger toggles a max-height transition panel (`transition-[max-height,opacity] duration-200`).

### Footer

- **Structure**: `border-t border-white/10 bg-black py-12`.
- **Links**: matched nav style — zinc-400 → cyan-400 on hover.

## 6. Motion & Interaction

### Timing

| Type       | Duration  | Easing                          | Usage                                           |
| ---------- | --------- | ------------------------------- | ----------------------------------------------- |
| Micro      | 150ms     | `ease-out`                      | Hover color shift, button press                 |
| Standard   | 200ms     | `ease-in-out`                   | Mobile nav reveal, accordion                    |
| Emphasis   | 400-600ms | `cubic-bezier(0.16, 1, 0.3, 1)` | Hero background fade, scroll-triggered entrance |
| Typewriter | 40ms/char | linear                          | Terminal command typing                         |

### Rules

- **Only `transform` and `opacity`** for animation. Never `width / height / top / left / margin / padding`.
- **No motion library imports.** The site uses CSS keyframes + Tailwind's `animate-pulse` + a custom typewriter component. Adding `motion/react` is allowed ONLY for shared layout transitions (`<motion.div layoutId>`) — and never the full `framer-motion` package.
- **`prefers-reduced-motion: reduce`** disables non-essential animation. The hero background already respects this.
- **Scroll-triggered animation** uses `IntersectionObserver`, never scroll listeners.
- **Stagger on entrance**: section entries get `animation-delay: calc(var(--index) * 80ms)` for cascaded fade-in-up on first paint.

### Forbidden

- Scroll-jacking (smooth-scroll hijacking).
- Parallax on images.
- Magnetic buttons.
- Cursor trails / custom cursors.
- GSAP / Lottie / Three.js — overkill for a marketing page.

## 7. Depth & Surface

**Strategy**: `tonal-shift` primary, with `border` as the punctuation.

Surfaces stack by background opacity (luminance), not by shadow:

| Level                 | Background                                                               | Border            | Usage               |
| --------------------- | ------------------------------------------------------------------------ | ----------------- | ------------------- |
| 0 (page)              | `#0a0a0a`                                                                | none              | Body background     |
| 1 (section bg accent) | `rgba(255,255,255,0.01)` or `bg-[#0a0a0a]` with border-top/border-bottom | `border-white/5`  | Section separations |
| 2 (card)              | `rgba(255,255,255,0.02)` (`bg-zinc-900/30`)                              | `border-zinc-800` | Default card        |
| 3 (elevated)          | `rgba(255,255,255,0.05)`                                                 | `border-zinc-700` | Hover state on card |
| 4 (popover)           | `#1a1a1a` solid                                                          | `border-zinc-800` | Mobile nav drawer   |

Shadows are reserved for the cyan glow accent on the install command (`shadow-2xl shadow-cyan-500/10`) and on the primary CTA (`shadow-sm`). No generic black drop-shadows.

## 8. Accessibility (mandatory checks)

- Root `<html lang="en">` plus locale wrapper `lang`/`data-locale` for localized routes.
- `<title>` per route (`generateMetadata` provides).
- Every `<button>` and `<a>` has a discernible name (icon-only buttons require `aria-label`).
- Skip link to `#main-content` at the top of `<body>`.
- Focus-visible ring on all interactive elements.
- Contrast ≥ 4.5:1 for body text, ≥ 3:1 for large text. Current cyan `#00d4ff` on `#0a0a0a` = 11.4:1 (AAA). Text-zinc-400 on `#0a0a0a` = 7.2:1 (AAA). Text-zinc-500 = 5.0:1 (AA).
- Touch targets ≥ 44px on mobile (`h-12` buttons meet this; `h-9` small buttons need vertical padding).
- `prefers-reduced-motion: reduce` disables animations.
- Form fields: label above input, helper/error below.

## 9. Inclusive Personas & Adaptive Constraints

- **Terminal power user**: keyboard-first, scans dense command/reference content, expects instant docs section navigation and copyable commands. Pass criteria: nav/search/focus states are visible and keyboard reachable; code blocks remain readable.
- **Mobile evaluator**: checks the project from a narrow viewport before installing. Pass criteria: landing and manifesto have no horizontal overflow; docs mobile behavior is preserved and its known overflow debt is not worsened.
- **CJK reader**: reads Korean/Japanese/Chinese localized pages. Pass criteria: heading letter spacing resets to normal, CJK line breaking avoids clipped glyphs, and body text can wrap without layout breakage.
- **Motion-sensitive user**: uses reduced motion. Pass criteria: hero/background/reveal motion respects `prefers-reduced-motion`; no layout-property animation is required for comprehension.

Adaptive preferences:

- Honor `prefers-reduced-motion`.
- Maintain dark color scheme and current contrast ratios.
- Preserve visible focus rings and 44px mobile hit targets where current components provide them.
- Preserve locale-aware CJK line-breaking rules in the design-system base layer.

## 10. Verification Matrix

This contract is valid only when implementation evidence proves the current surface still matches it:

| Scenario                  | Surface                              | Evidence                                                                          |
| ------------------------- | ------------------------------------ | --------------------------------------------------------------------------------- |
| Landing visual fidelity   | `/` at 1280x800 and 390x844          | Baseline/after screenshots plus image diff                                        |
| Docs visual fidelity      | `/docs` at 1280x800 and 390x844      | Baseline/after screenshots plus image diff; mobile overflow delta must not worsen |
| Manifesto visual fidelity | `/manifesto` at 1280x800 and 390x844 | Baseline/after screenshots plus image diff                                        |
| Docs interactions         | `/docs` mobile and desktop           | Sidebar toggle, search filtering, section/hash navigation                         |
| Landing navigation        | `/` mobile and desktop               | Mobile nav toggle and Docs/Manifesto navigation                                   |
| Regression gates          | `packages/web`                       | format, lint, type-check, build, Playwright e2e; Lighthouse when available        |

## 11. Refinement Targets

The 5 areas the refinement PR will improve while keeping the soul:

1. **Consolidate per-section accents**: Replace purple/orange/pink/fuchsia/teal/indigo/amber/green section colors with cyan (primary) + indigo (agent identity) + neutral grays. The dev-tool feel sharpens; the rainbow goes away.
2. **Tighten typography rhythm**: Move display from `text-5xl md:text-7xl` to a more disciplined scale with consistent negative tracking. Set `text-wrap: balance` on H1/H2.
3. **Decompose the 832-LOC landing monolith**: Each section → its own file ≤250 LOC. Composition shell stays under 100 LOC.
4. **Dynamic OG image**: Static `hero.webp` (1024×683) → `app/opengraph-image.tsx` via `next/og` at 1200×630, brand-aligned.
5. **Motion choreography**: Add cascaded fade-in-up on section entry via CSS + IntersectionObserver. Respect `prefers-reduced-motion`. No motion library.

## 12. Banned Patterns (project-specific)

- New or changed UI hardcoding raw hex outside this file or `app/styles/design-system.css`. Existing rendered class names such as `bg-[#0a0a0a]`, `text-[#ededed]`, and gradient stops remain accepted debt in this extraction because this PR preserves the current pixels.
- Pure `#000000` or `#ffffff`.
- Per-section accent colors not in the consolidated palette.
- `h-screen` (use `min-h-[100dvh]`).
- 3-column equal feature card grids (use 2-col zig-zag or 1-col + visual).
- Emojis in JSX, alt text, or visible UI.
- Any-casts and TypeScript suppression directives.
- `export const runtime = "edge"` (incompatible with `@opennextjs/cloudflare`).
- Animating `width / height / top / left / margin / padding`.
- Importing the full `framer-motion` package (use `motion/react` + `LazyMotion` if needed; currently not needed).
- Generic hype copy. Use concrete product language instead.
- Lorem ipsum or "John Doe" placeholders.
