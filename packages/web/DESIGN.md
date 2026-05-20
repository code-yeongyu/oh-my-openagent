# Oh My OpenAgent Web — Design System

> **Extracted from existing code as of 2026-05-20.** This document codifies the current system and flags inconsistencies for consolidation. The dark + cyan terminal/hacker identity is the brand and stays. Refinement consolidates the rainbow secondary accents into a disciplined token set, sharpens typography rhythm, and tightens motion choreography — without altering the soul of the site.

## 1. Atmosphere & Identity

A senior engineer's command center, glowing in the dark. Surfaces are near-black with a faint cool undertone; cyan punctuation marks the live wires of the system — install commands, primary CTAs, terminal cursors, hover affordances. Density is purposeful: stats bar, code blocks, agent cards. Whitespace exists but is _engineered_, never decorative.

**Signature**: cyan-on-near-black with razor-thin borders and a single hero photograph receding into the canvas — like a screenshot of `htop` lit by a moon. The terminal mockup in the Ultrawork section is the visual anchor: this product _is_ the terminal, not a marketing site about the terminal.

## 2. Color

### Palette

| Role                    | Token                     | Hex                      | Usage                                                 |
| ----------------------- | ------------------------- | ------------------------ | ----------------------------------------------------- |
| Surface / primary       | `--surface-primary`       | `#0a0a0a`                | Page background                                       |
| Surface / secondary     | `--surface-secondary`     | `#111111`                | Cards (current `--card`)                              |
| Surface / elevated      | `--surface-elevated`      | `#1a1a1a`                | Popovers, hover states (current `--muted`/`--accent`) |
| Surface / tint          | `--surface-tint`          | `rgba(255,255,255,0.02)` | Subtle card backgrounds                               |
| Text / primary          | `--text-primary`          | `#ededed`                | Headlines, body emphasis                              |
| Text / secondary        | `--text-secondary`        | `#a1a1a1`                | Body copy (current `--muted-foreground`)              |
| Text / tertiary         | `--text-tertiary`         | `#71717a`                | Captions, metadata (zinc-500)                         |
| Border / default        | `--border-default`        | `#262626`                | Card borders, dividers (current `--border`)           |
| Border / subtle         | `--border-subtle`         | `rgba(255,255,255,0.05)` | Whisper-thin separators (used in nav/footer)          |
| Accent / primary        | `--accent-primary`        | `#00d4ff`                | Brand cyan — CTAs, links, focus, terminal `$`         |
| Accent / primary-soft   | `--accent-primary-soft`   | `rgba(0,212,255,0.10)`   | Cyan backgrounds, glow tints                          |
| Accent / primary-border | `--accent-primary-border` | `rgba(0,212,255,0.20)`   | Cyan-tinted borders on badges                         |
| Accent / secondary      | `--accent-secondary`      | `#7c3aed`                | Reserved — currently overused (see below)             |
| Status / success        | `--status-success`        | `#10b981`                | Success indicators only                               |
| Status / warning        | `--status-warning`        | `#f59e0b`                | Cautions only                                         |
| Status / error          | `--status-error`          | `#ef4444`                | Errors / destructive only                             |
| Code / bg               | `--code-bg`               | `#1e1e2e`                | Code block backgrounds                                |
| Code / fg               | `--code-text`             | `#cdd6f4`                | Code text                                             |

### Rules

- **Cyan is the only chromatic brand color.** Every interactive element should resolve through it.
- **Surface hierarchy via luminance, not borders where possible.** `0a0a0a` → `111111` → `1a1a1a` is the depth stack. Borders are the punctuation, not the wall.
- **Never use pure `#000000`** — `#0a0a0a` or `#08090a` is the floor. Pure black is too harsh and signals "AI dark mode".
- **Never use pure `#ffffff`** for text — `#ededed` is the ceiling. Pure white screams.
- **No purple/blue "AI gradient"** decoratively. The `--accent-secondary` purple (`#7c3aed`) exists as a token but should be reserved for genuine semantic moments (Sisyphus / agent identity), not as eye candy on CTAs or backgrounds.

### Inconsistencies to consolidate (current state → target)

The current landing page assigns a distinct accent color _per section_ — purple, orange, pink, fuchsia, teal, indigo, amber, green, blue. This is the candy-store anti-pattern. Refinement target:

- **Cyan**: Primary CTA, install command, hero, CTA section, default link/hover.
- **`--accent-secondary` (single muted indigo `#7c3aed`)**: Agent identity (Sisyphus, sub-agents) — when an agent name appears, it gets the secondary accent badge. Not the whole card.
- **Status colors**: ONLY for actual status (success/warning/error). NOT for decorative section accents.
- **Everything else**: monochrome (white opacity ladder for surfaces, zinc/neutral for text).

Result: 2 chromatic colors total (cyan + indigo), all per-section colors removed.

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

- **Structure**: `<section className="relative flex min-h-[100dvh] items-center pt-32 md:pt-24">` with absolute-positioned background image (decorative, ~30% opacity) and gradient overlay.
- **Background**: `hero.webp` preloaded `fetchPriority="low"` so the headline is the LCP. Image fades in via CSS keyframe over 600ms, respects `prefers-reduced-motion`.
- **Variants**: Landing hero (centered), manifesto hero (centered with stronger gradient).
- **Spacing**: `gap-8` between stack items, max-width `max-w-3xl` for headline.
- **Motion**: CSS-only fade-in on the background.

### Button (shadcn-based)

- **Structure**: cva variants `default | secondary | ghost | outline | link | destructive` × sizes `sm | default | lg | icon`.
- **Primary CTA**: `bg-cyan-500 text-black hover:bg-cyan-600` — black-on-cyan reads as a primary "system action".
- **Outline**: `border-zinc-700 text-white hover:bg-zinc-800` — secondary.
- **States**: default, hover (color shift), focus-visible (ring), active (`-translate-y-px` for tactile feedback — to be added).
- **Radius**: 6px (`rounded-md`).
- **Padding**: lg = `h-12 px-8`, default = `h-10 px-6`, sm = `h-9 px-3`.

### Card (shadcn-based)

- **Structure**: `Card / CardHeader / CardTitle / CardDescription / CardContent`.
- **Background**: `bg-zinc-900/30` (translucent over page bg) → consolidate to `bg-[--surface-tint]`.
- **Border**: `border-zinc-800` → `border-[--border-default]`.
- **Radius**: 8px (`rounded-lg`).
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

- `lang` on `<html>` and on locale wrapper.
- `<title>` per route (`generateMetadata` provides).
- Every `<button>` and `<a>` has a discernible name (icon-only buttons require `aria-label`).
- Skip link to `#main-content` at the top of `<body>`.
- Focus-visible ring on all interactive elements.
- Contrast ≥ 4.5:1 for body text, ≥ 3:1 for large text. Current cyan `#00d4ff` on `#0a0a0a` = 11.4:1 (AAA). Text-zinc-400 on `#0a0a0a` = 7.2:1 (AAA). Text-zinc-500 = 5.0:1 (AA).
- Touch targets ≥ 44px on mobile (`h-12` buttons meet this; `h-9` small buttons need vertical padding).
- `prefers-reduced-motion: reduce` disables animations.
- Form fields: label above input, helper/error below.

## 9. Refinement Targets

The 5 areas the refinement PR will improve while keeping the soul:

1. **Consolidate per-section accents**: Replace purple/orange/pink/fuchsia/teal/indigo/amber/green section colors with cyan (primary) + indigo (agent identity) + neutral grays. The dev-tool feel sharpens; the rainbow goes away.
2. **Tighten typography rhythm**: Move display from `text-5xl md:text-7xl` to a more disciplined scale with consistent negative tracking. Set `text-wrap: balance` on H1/H2.
3. **Decompose the 832-LOC landing monolith**: Each section → its own file ≤250 LOC. Composition shell stays under 100 LOC.
4. **Dynamic OG image**: Static `hero.webp` (1024×683) → `app/opengraph-image.tsx` via `next/og` at 1200×630, brand-aligned.
5. **Motion choreography**: Add cascaded fade-in-up on section entry via CSS + IntersectionObserver. Respect `prefers-reduced-motion`. No motion library.

## 10. Banned Patterns (project-specific)

- Inline raw hex outside this file or `globals.css`.
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
