---
name: interaction-skill
description: "Layer A interaction-mechanics reference anchored to the beui.dev catalog. Stacks on any style skill whenever work adds or changes motion or interaction — micro-interactions, animated components, transitions, gestures, hover/press/state feedback, loading/success/error morphs, 'make it feel alive'. Mandates reading the mapped beui.dev component source before designing an interaction; owns interaction mechanics and reduced-motion discipline; owns zero visual taste. Load it alongside a style skill; it does not replace one."
---

# Interaction Mechanics — beui.dev-Anchored

Style skills decide how a surface looks. This file decides how it *moves and responds* — spring physics, layout morphs, enter/exit orchestration, gesture feel, and reduced-motion discipline. It stacks on top of any Layer A style skill and any Layer B brand, exactly like `layout-skill.md`, and adds ZERO visual direction: color, type, and material still come from the style skill and `DESIGN.md`.

Load this whenever the deliverable includes interaction feel: micro-interactions, animated components, transitions, hover/press/focus/state feedback, gestures, loading/success/error morphs, animated tabs/menus/modals/drawers/toasts — or the user says "make it feel alive", "polish the interactions", "add micro-interactions".

## 1. The reference contract — never design an interaction from memory

[beui.dev](https://beui.dev) is the interaction benchmark: free, open-source animated React components (Motion + Tailwind CSS) where every component ships reduced-motion support and the full TypeScript source is one `curl` away. Improvised interaction design produces slop motion the same way freestyled styling produces generic SaaS slop, and the fix is the same: consult the reference before designing.

The contract, in order:

1. **Find the nearest pattern** in the catalog (section 3). The live catalog is `https://beui.dev/llms.txt`; refresh from it when a pattern seems missing from the tables below.
2. **Read its real source** through the recipe (section 2). Never guess spring values, exit orchestration, or gesture thresholds from a preview description.
3. **Extract the mechanism**, not the pixels: the spring config, the layout strategy (`layoutId` shared layout vs height morph vs clip-path), what animates in what order on enter/exit, where blur crossfades sit, and what the reduced-motion path swaps to.
4. **Adapt to the project.** Concrete durations, easings, and spring params come from the project `DESIGN.md` Motion & Interaction section. Where beui.dev and `DESIGN.md` disagree, `DESIGN.md` wins. A value that is not in `DESIGN.md` gets added there first, then used.
5. **No matching pattern?** Compose from the nearest two, or state explicitly that the interaction is novel and record its mechanism in `DESIGN.md` before building it.

## 2. Consultation recipe (curl-only, verified 2026-07)

All endpoints are public, no auth, no browser:

```bash
curl -s https://beui.dev/llms.txt                          # full catalog: every component + one-line feel
curl -s https://beui.dev/r                                 # registry index (JSON): slugs, categories, endpoints
curl -s https://beui.dev/r/{slug}                          # component detail (JSON): files, dependencies, dates
curl -s https://beui.dev/r/{slug}/raw                      # component source (TypeScript) — the thing to read
curl -s https://beui.dev/components/{category}/{slug}.md   # component doc page as markdown
```

Categories are `motion` (primitives) and `blocks` (composed patterns). When the user wants the component itself rather than the mechanism, a shadcn-style item registry exists at `https://beui.dev/r/{slug}.json`. Read source to learn; do not vendor beui.dev files into reference docs, and do not paste whole components into a project when only the mechanism is needed.

## 3. Catalog — pattern routing map

### Buttons, state feedback, and progress

| Pattern (slug) | Mechanism | Reach for it when |
|---|---|---|
| `button` | Spring press; StatefulButton idle → loading → success/error with blur-swap slots and morphing width; MagneticButton cursor pull | Any submit/CTA that has async states — never leave a button state-less |
| `action-swap` | Text/icon swap with blur motion | Copy → check, send → stop, any label that changes meaning in place |
| `expanding-arrow-button` | Expanding, hold-to-confirm, and slide CTA interactions | Expressive marketing CTAs, destructive hold-to-confirm |
| `animated-badge` | Animated state icons, pulse feedback | Connection/status dots, live activity indicators |
| `loader` | 17 variants incl. terminal-ascii; reduced motion swaps every transform for an opacity pulse | Any loading state; copy its reduced-motion contract even when hand-rolling |
| `otp-input` | Gliding focus ring, per-slot digit roll, error shake, success check draw | Code entry, verification flows |
| `file-upload` | Progress rows, retry/remove, reduced-motion-safe state changes | Upload queues, long-running item lists |
| `feedback-widget` | Trigger morphs into a popup with sending/success/retry states | Corner feedback affordances, inline report flows |

### Selection and form controls

| Pattern (slug) | Mechanism | Reach for it when |
|---|---|---|
| `switch` | Spring-driven thumb with press feedback | Boolean toggles |
| `checkbox` | Draw-on checkmark, indeterminate support | Multi-select, tree selection |
| `radio` | Gliding `layoutId` indicator dot | Single-select groups |
| `input` | Label, icons, error shake, success check draw | Validated text entry |
| `select` | Panel bouncily unfolds from the trigger; Morph variant grows the trigger into the panel | Dropdown selection with spatial continuity |
| `range-slider` | Bouncy vertical-bar thumb gliding between snapped steps | Stepped value entry |
| `wheel-picker` | iOS-style 3D drum on native momentum scroll with notch snap | Date/time or option drums, mobile-feel pickers |
| `availability-scheduler` | Per-day spring toggles, blur-slide range add/remove | Schedule/slot editors |

### Navigation and wayfinding

| Pattern (slug) | Mechanism | Reach for it when |
|---|---|---|
| `tabs` | Pill/segment/underline with a spring `layoutId` indicator | Tab bars, view-mode selectors |
| `expandable-tabs` | Active icon tab expands to a labelled pill; panel morphs height, slides direction-aware | Compact tab bars with rich panels |
| `shared-layout-bg` | Pill glides between hovered items via shared layout, blur enter/exit | Sidebar/menu hover and active states |
| `dock` | macOS-style grouped actions with a gliding active pill | Toolbars, grouped action rails |
| `bounce-sidebar` | Active dot jumps between destinations on a curved spring path | Vertical navigation with a playful indicator |
| `preview-rail` | Compact ticks form a hover pyramid and reveal a floating destination preview | Dense navigation rails, session/thread switchers |
| `expandable-action-bar` | Icon actions expand into labelled controls on hover/focus | Compact action clusters |
| `overflow-actions` | Connected pill rail springs open to reveal extra controls | Primary-plus-overflow action groups |
| `command-palette` | Fuzzy filter with a spring-animated active row | Cmd-K surfaces |
| `bloom-menu` | Button morphs into a menu blooming iris-out from center with radial stagger | Radial/launcher menus |

### Overlays and surfaces

| Pattern (slug) | Mechanism | Reach for it when |
|---|---|---|
| `tooltip` | Blur enter/exit, spring spawn | Hover/focus hints |
| `popover` | Gooey SVG-filter ooze from the trigger; Morph variant clip-morphs from the trigger corner | Anchored panels that should feel attached to their trigger |
| `context-menu` | Pointer-origin clip morph, gliding active row, keyboard nav, typeahead, long-press | Right-click and long-press menus |
| `morphing-modal` | One panel morphs height between inner views, blur cross-fade on content | Multi-step dialogs, settings panes |
| `center-morph-modal` | Surface unfolds from its exact center toward every edge and folds back | Focused confirm/detail modals |
| `drawer` | Spring side panel, backdrop blur, body scroll lock, esc-to-close | Side panels, inspector panes |
| `bottom-sheet` | Draggable sheet with snap points, inertia, glass surface | Mobile-feel sheets on any platform |
| `dynamic-island` | Pill morphs between live-activity views with bouncy shell resize and blur crossfades | Live status surfaces, compact expanding widgets |
| `notification-stack` | Cards spring from a stacked summary into a readable list on hover/focus/tap | Notification centers, grouped alerts |
| `animated-toast-stack` | Status morphs, swipe dismissal, layout-aware stacking | Toast systems — layout-aware stacking is the bar |
| `theme-toggle` | Full-page clip-path reveal via the View Transition API | Theme switching that should feel like one gesture |

### Content, data, and gestures

| Pattern (slug) | Mechanism | Reach for it when |
|---|---|---|
| `bouncy-accordion` | Single-open accordion with weighted spring layout, reduced-motion-safe reveals | Disclosure groups, expandable rows |
| `table` | Virtualized 10k+ rows, sortable, resizable, minimal reduced-motion-safe motion | Data grids — proof that restraint is also a motion decision |
| `infinite-masonry` | Virtualized variable-height masonry with progressive load | Media/card walls |
| `swipeable-list` | Rows swipe to reveal contextual actions | Mobile-style lists with hidden actions |
| `pull-to-refresh` | Drag resistance, threshold feedback, async refresh | Refreshable feeds |
| `marquee` | Infinite horizontal/vertical scroll, pause on hover | Logo walls, tickers |
| `text-animation` | Spring reveals, chromatic sweeps, shimmer loading, letter-cascade swaps | Hero copy, streaming/loading text |
| `number` | Count-up values, rolling digit tickers | Metrics, token/cost counters |
| `cylinder-carousel` | Items line a 3D cylinder with springy glide and snap | Showcase carousels |
| `knockout-bracket` | Animated tournament fixtures paging through rounds | Bracket/progression views |
| `prediction-market` / `swap` / `wallet-card` | Trade tickets, morphing swap views, morphing account surfaces | Finance-shaped composite widgets |
| `not-found` | Five animated 404 styles | Error pages that keep the product's feel |

### Ambience and scroll

| Pattern (slug) | Mechanism | Reach for it when |
|---|---|---|
| `tilt-card` | 3D perspective tilt with cursor-tracked glare | Hero/product cards that should feel physical |
| `shader-background` | Canvas shader variants (mesh gradient, grain, warp, waves…); reduced motion freezes them | Atmospheric backgrounds with dimension |
| `scroll-animation` | Lenis smooth-scroll provider plus a reading-progress indicator | Scroll-driven storytelling |

## 4. Mechanics rules

These sharpen the shared axioms for interaction work; none of them replace the style skill.

- **Motion serves meaning.** Every animation maps to a real interaction, state change, or affordance. A hover that changes nothing is slop — beui.dev patterns all animate *state*, never decoration.
- **Reduced motion is part of the component, not an afterthought.** Every beui.dev component ships a reduced-motion path; match that bar. Web: `prefers-reduced-motion: reduce` disables or replaces every transform-based animation (the `loader` pattern's opacity-pulse swap is the model). React Native: respect the system reduce-motion setting.
- **GPU-composited properties only** — `transform`, `opacity`, `filter`. Never animate layout properties; morph layout through shared-layout (`layoutId`) or measured height primitives instead.
- **Springs move things; easings tint things.** Spatial movement (position, scale, layout morphs) wants spring physics so it stays interruptible and retargetable. Color, opacity, and blur want short duration + easing. Do not put a fixed-duration tween on a gesture-driven surface.
- **Interruptibility is non-negotiable.** A press, hover-out, or route change mid-animation must retarget smoothly, never queue or block input. This is the practical reason beui.dev uses springs — copy that property, not just the bounce.
- **Motion never regresses input latency or stream rendering.** Measure with the `perfection` ruleset when in doubt; a virtualized list's measurement contract beats a pretty reveal.
- **Library choice is a project decision, not a default.** beui.dev assumes Motion (motion.dev) + Tailwind. If the project already has a motion stack, adapt the mechanism to it. If it has none: CSS transitions/WAAPI cover micro-interactions; adding a library is justified by shared-layout or spring-physics needs and gets recorded (with bundle cost) in `DESIGN.md`. Check `package.json` before importing anything.

## 5. DESIGN.md integration

`design-system-architecture.md` defines a Motion & Interaction section in every `DESIGN.md`. This file feeds it:

- Extracted spring configs, durations, and easings land there as named tokens before components use them.
- Each shipped interaction traces to a catalog pattern (or a recorded novel mechanism) plus its reduced-motion behavior.
- New reusable interaction patterns (used 2+ times) get documented back into `DESIGN.md` Section 5 with their states, like any other primitive.

## 6. Verification

Interaction work is verified through `/visual-qa` with motion actually driven and inspected — hover, press, open/close, swipe, and theme transitions exercised on the rendered surface, plus a reduced-motion pass (emulate `prefers-reduced-motion: reduce`) proving the fallback exists. Timing-sensitive changes record a short screen capture, not just stills.
