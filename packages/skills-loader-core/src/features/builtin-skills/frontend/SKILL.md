---
name: frontend
description: "Builds, styles, and polishes anything drawn with HTML, CSS, or SVG: web UI, pages, components, HTML reports rendered to PDF or print, figures, PNG/SVG diagrams, slides, and images for Notion or Slack. Use for any styling, layout, animation, or visual-quality task, or when asked to make something look or feel a certain way."
---

# Frontend

This file is a router over `references/`; the rules live there. The flow is ground -> brief -> build -> subtract -> verify. The bar is restraint with a visible hierarchy: one primary action, the important thing first, nothing on the screen without a job. A quiet, correct screen that holds its hierarchy at 390 and 1440 in both themes is a finish. Atmosphere, motion, and award-grade surface work are opt-in: build them when the brief asks (a named brand, "premium", "make it stunning", a marketing page), never by default for an internal tool, dashboard, admin screen, report, or figure.

## Route: name the references, read exactly those

Before the first edit, name the references the request routes to and one reason for each, then read them. Rows stack: take every row the request matches, so a small change that also reshapes a region takes the layout row too, and any code change takes the perfection row and, on a React project, the React tooling row. A small change on an existing surface still reads only a few; only greenfield fans out. A reference you never named is one you decided to skip; one you named but never opened is a gap you still owe.

| Request | Read |
|---|---|
| Small change on an existing surface: a fix, a new control, a restyled component, a copy or spacing change | The project's `DESIGN.md` (or the nearest styled sibling when there is none) plus at most ONE design reference: the Layer A style skill the project follows, or `references/design/redesign-skill.md` when the ask is "this looks bad" / "improve this". No `DESIGN.md` and no styled sibling either: README Phase 0 (it asks). |
| A new screen or flow in an existing project | ALSO `references/design/README.md` Phase 0 (the `DESIGN.md` gate and its branches) and the Layer A skill in use. |
| A new screen or flow, a redesign ("this looks bad", "make it better"), or design-system creation or rework | ALSO `references/design/grounding.md` (step 0 below). |
| Greenfield with no concrete reference | `references/design/README.md` in full: the gate, the greenfield research lanes (`_INDEX.md` shortlist, `lazyweb.md`, `stylegallery.md`, imagen drafts), and the style routing. One Layer A + one Layer B, read in full. |
| A concrete visual reference: screenshot, mockup, Figma export, Stitch or imagen output | `references/design/image-to-code-skill.md`; a live site or URL to clone: `references/design/clone-from-url.md`. The reference is the contract and `/visual-qa` runs in reference-fidelity mode. |
| Any layout or structure change: a new or reshaped region, shell, panel, split, list or grid, sticky bar, or scroll container; "what goes where"; "this layout breaks at X" | `references/design/layout-skill.md` for the mechanics, then `references/design/stylegallery.md` for the pattern contract. Write the `Layout:` line (Brief, below) before the code; `/visual-qa` A12 checks the build against it. |
| Paged output: a PDF report, print stylesheet, headless-Chrome print pipeline, a deck printed to paper, "why is this page half empty" | `references/design/print-paged-media.md`: page box, fragmentation properties, the atomic-block set, the keep-together side effect that strands a block. |
| Interaction or motion: micro-interactions, transitions, gestures, hover/press/state feedback | `references/design/interaction-skill.md`. The beui.dev catalog is the reference: read the nearest pattern's real source through its curl recipe, adapt the mechanism to `DESIGN.md` motion tokens. |
| Ambience, only when the brief asks: an animated, shader, particle, or grid background; a typographic reveal; scroll storytelling; spotlight, tilt, or glowing-border cards | `references/design/ambience-skill.md`. The react-bits catalog is the reference: nearest pattern, real source, its retrofit checklist (reduced motion, off-screen pause, compositor-only, tokens, budget); never vendor its code. |
| Tone outside both anchors: AI-agent UI, charts, landing sections, a brutalist or Tailwind-only build, or no nearest pattern | `references/design/component-catalogs.md`: which catalog per tone, the exploration procedure, the licence gate. |
| Writing or modifying frontend code; auditing performance, SEO, accessibility, quality | `references/perfection/README.md`, `references/perfection/craft-floor.md`, and `references/perfection/detect.md` (+ `react-perf-tooling.md` before any React audit). Lighthouse 100 in every category on real Playwright Chromium, won in the architecture. Design and perfection load together for implementation work. |
| On request, or a greenfield palette, type, chart, or landing-structure question | `references/ui-ux-db/README.md` and its search CLI (library, below). A lookup tool, never the posture. |
| Creating or updating `DESIGN.md`; personas, critique, debt, handoff, synthetic user testing | `references/designpowers/README.md` + `lane-c-review.md` (lane-c is the Phase Final critique reviewer and fills the accessibility-constraint and accepted-debt sections). |
| Any code change in a React project | `references/design/README.md` Phase 0.5: the react-grab / react-scan / react-doctor check (a grep), the install when one is missing, and the dev-only gate; `react-dev-tooling-skill.md` for per-framework snippets. |
| "What do shipped apps in this space look like?"; design-direction research for an existing product | `references/design/lazyweb.md` (run its recipe verbatim) + the `references/design/_INDEX.md` shortlist. |
| Image only, no code: a mockup, app-screen concepts, a brand board | `references/design/imagegen-frontend-web.md` / `imagegen-frontend-mobile.md` / `imagegen-brandkit.md` (+ a Layer B brand if named). These never write code. |

## 0. Ground: know the product and the bar before designing

For a new screen or flow, a redesign, or design-system work, run `references/design/grounding.md` first. It reads the guideline source in full, defines the ideal state for the product's personas and journeys, and writes every gap into a ledger. The brief and the build close rows of that ledger. A small change reads the ledger when `DESIGN.md` has one.

## 1. Brief: decide what the screen is for before drawing it

Write this for every screen you build or change, into `DESIGN.md` section 5 beside the screen's components (the `Layout:` line goes under section 4, as `references/design/stylegallery.md` says), or into the change description when the project has no `DESIGN.md`. The build follows it; `/visual-qa` checks the rendered screen against it.

- **Primary action.** Exactly one. It gets the prominent style; its peers differ by style, never by size.
- **Information priorities 1-3.** In reading order. Priority 1 is the first thing the eye lands on.
- **Left out on purpose.** What a generated version of this screen would add and this one will not: the decorative badge, the stat tile nobody acts on, the subtitle under every heading, the callout that repeats the banner.
- **Required content.** Every input, datum, label, and piece of copy the request, the reference, or the existing screen requires, listed by name. Subtraction is checked against this list; nothing on it may disappear or merge.
- **Data shape -> component** (data screens): several things to compare -> table; a ranking -> ordered list; one verdict -> conclusion banner first, evidence under it; many items -> filter + results grid; one object -> detail view with its primary action. Choose from this before reaching for cards.
- **Layout line** (any layout or structure change, an existing `DESIGN.md` included): one `Layout:` line in the format and with the unreachable-host form given in `references/design/stylegallery.md`, written before the code.
- **Before captures** (changing an existing UI): fix the cases now, states x widths, and capture `before` through `/visual-qa` Before/after mode BEFORE the first edit. A baseline reconstructed later is not a baseline.

## 2. Build

Take the branch in `references/design/README.md` Phase 0 first (a small change on a surface with no `DESIGN.md` follows its small-change rule), and on a React project its Phase 0.5 tooling check: `DESIGN.md` (or, under the small-change rule, the styled sibling) exists before components do, and every colour, size, and spacing value traces to a token in it. A new system is built in this order: colour roles in both themes, then type and spacing, then components, which start from shadcn/ui anatomy (or the project's own kit) restyled with the tokens, never invented shapes. Then build to these rules; `/visual-qa` verifies them afterwards and should find nothing new.

- **Hit targets.** Touch layouts: at least 44x44 pt (44 CSS px) per interactive element, 8-12 pt between neighbours. Pointer-only: at least 24x24 CSS px (WCAG 2.5.8), about 10 px beyond the glyph. Grow the hit area with padding or a pseudo-element, never the glyph; adjacent bar buttons share continuous hit areas.
- **Hierarchy.** The brief's primary action is the one prominent control; the most important content sits top-leading in reading order; each screen's title says what it is; neither a destructive action nor Cancel is the Enter default.
- **States.** A control ships with hover, pressed, focus-visible, and disabled states beside its default. It keeps one box in every state: the label, icon, and spinner swap inside slots that exist in all states (a min-width sized to the longest label, a spinner overlaying the hidden label), so width, height, and padding never change when the state does, and an arrow or spinner never adds padding when it appears. A data view ships empty (offering the next action), loading (a placeholder at once, a spinner only past about a second), error (cause beside the object), and offline.
- **Keyboard.** Every action reachable in reading order with a visible focus ring that no sticky bar or overlay covers; Escape closes the topmost overlay; Enter triggers the non-destructive default; standard shortcuts keep their meaning; icon-only controls carry an accessible name and a tooltip.
- **Motion.** Only for a cause (an interaction, a state change, an arrival), on `transform`, `opacity`, `filter`; interruptible, never gating input; movement becomes a cross-fade under `prefers-reduced-motion`. A hover that changes nothing or motion on a non-interactive element is slop: leave it out.
- **Icons.** One SVG set (Lucide, Heroicons, Radix, Phosphor); never an emoji.
- **Browser surfaces.** Text selection, the caret, visible scrollbars, the focus ring, link underline offset, and tabular numerals are themed from the palette in both themes; none ships as the browser default. `references/perfection/craft-floor.md` has the property for each.
- **Type and spacing floor.** Each heading step (display to h3, and the smallest heading to body) differs by at least 1.25x, and body-family roles that sit closer also differ by weight, colour or case; the space above a section heading is at least 1.5x the space below it; the gap between groups is at least 2x the gap inside one; body text runs 65-75 characters per line on desktop; display type stays at or under 6rem and tracking at or above -0.04em unless the chosen style route sets its own. Check computed values, not the source.
- **Concrete reference = contract.** Match its pixels, copy, component structure, and responsive intent unless the user accepts a deviation.
- **Never weaken UX to buy points.** No dropping animations, hiding content, or simplifying interactions for a Lighthouse score or a deadline.

### Draft guard: tells kept out of the first draft

Some tells regenerate by default, so they are kept out of the first draft rather than left for QA to find.

- **No coloured bar on one side of a box, rounded or square, and no accent outline on a rounded card, decorative or state.** A card, callout, warning, cover block, stat tile, testimonial, alert, or list row never carries a coloured stripe on one side: `border-left: 4px solid <accent>` or `border-l-4 border-indigo-500`, a coloured `::before`/`::after` bar inside it, an inset `box-shadow` stripe, or a hard-stop gradient band or gradient `border-image` along one edge. A rounded card never wears a 2px-or-wider accent outline either (`border: 2px solid var(--primary)`, `ring-2 ring-indigo-500`, an inset ring). Both read as generated whether they decorate the box or mark it selected, focused, or active, and an accent underline under a heading, tab, or link counts too: use a neutral 1px rule, or set the text itself in the accent ink. Give the card its identity another way: a tonal surface (one ink at a low alpha, or the next step of the surface ramp), a heading set in the accent ink, a leading glyph, or more space between groups. Encode state with one ink at many alphas (hover/selected/active washes), a check glyph for selection, and tonal layering for focus. The coloured edges that stay allowed: keyboard `focus-visible` rings, validation states on form inputs, neutral 1px hairlines and dividers between rows or sections, table rules, and a blockquote's neutral rule. This covers pre-existing instances on any surface you touch.
- **Lint before visual QA.** Run `bun $SKILL_DIR/scripts/perfection/check-draft-guard.ts <changed files or dirs>` on every stylesheet, component, and HTML file you wrote, including a report or figure you will print, screenshot, or render to an image. It reads CSS/SCSS/Less, HTML, JSX/TSX, Vue, Svelte, Astro, Tailwind classes (including `@apply` and `cva`/`cn` strings), inline styles, and styled-components, and flags the stripes above plus promotional filler copy, emoji used as icons, hype badges, and hard-coded vanity numbers in stat tiles. Exit 1 means a tell is in the draft: remove it, do not argue with the finding.
- **Detect after the build renders.** Once the page renders, run the detect SDK on it at 1440 and 390 with reflow on (`references/perfection/detect.md`): `detectPage({ kind: "url", url }, { reflow: true })` from code, or `bun $SKILL_DIR/scripts/detect/cli.ts --reflow <url-or-html-files>`. It reads the rendered page (contrast on the painted background, type scale, heading order, overflow, decoration and copy tells). Fix every error and warning before `/visual-qa`; record a decision for each advisory.
- **No decorative badge without a state behind it.** A pill, chip, or tag appears only when it carries a value that can change: a status, a count, a category the user filters by. "New", "Pro", or "AI-powered" on a static heading is decoration.
- **No stat tile without a decision behind it.** A number earns a tile when someone acts on it; four tiles above a table that already holds the numbers are filler.
- **No invented proof.** Testimonials, quotes, customer logos, ratings, user counts, and prices come from the project or stay out. A section that needs proof the project does not have is cut, or ships as an empty slot labelled for the owner to fill; a "sample" testimonial is still a fabricated one.
- **No prop decoration.** A device tilted for effect, a floating reassurance card, decorative coordinates, sparkles, and ornaments that say nothing about the product are the generated version of "premium". A product preview shows a real state of the product, with its text readable at the rendered size.
- **No repeated formula.** A treatment that carries one heading (a serif line with an italic accent phrase, a gradient word, a headline-subtitle pair) becomes a template when every section repeats it; so does one image reused across sections. Use each once, where it means something.
- **No subtitle under every heading.** A heading explains itself; a one-line description under each one is the generated rhythm. Keep a subtitle only where the heading alone would be misread.
- **One fact, one place.** A conclusion banner and a callout that restates it, a summary card and a table row with the same figure, a label repeated as its placeholder: keep one.
- **No dated or borrowed surface.** Glass and blur panels (they read as a clone of a popular open-source chat app), neumorphism, mesh-gradient heroes, heavy drop shadows, and 2019-era SaaS illustration date a draft on sight. Surfaces come from `DESIGN.md` section 7; a material ships only when the brief or a concrete reference supplies it.
- **No generated scaffold.** No kicker label above a heading, no icon tile stacked over a heading in a grid of same-size cards, no hero metric (a giant number with a small label and supporting stats), no card inside a card, no neutral gray text on a coloured surface, no monospace as a "technical" costume, and no zero-offset coloured glow standing in for a shadow. `references/perfection/craft-floor.md` gives the replacement for each, and says when the brief or its chosen route brings one back.
- **No promotional copy.** Interface copy states what a thing is or does. "Seamlessly", "effortlessly", "smart", "powerful", "at a glance", "supercharge", and their Korean counterparts ("한눈에", "손쉽게", "스마트한", "효율적으로", "간편하게") are marketing, not interface: rewrite as the plain fact or delete.

## 3. Subtract

After the draft renders and the lint exits 0, walk every element on the screen and ask what the user could not do or know without it. No answer: delete it, whatever the reference or the previous version showed. Then open the brief's required-content list and confirm every item is still on the screen by name, with its own control or field. Subtraction that merges two required inputs into one, drops a datum, or shortens required copy is a regression, not a cleanup. Record what you removed under "Left out on purpose". Then count the controls: a secondary action most visits do not need moves into a menu or to the object it acts on, and groups separate by whitespace, not by boxes and borders. Fewer controls with room around them is the target.

## 4. Verify

Done is the `/visual-qa` gate, not your own glance. It owns the visual checks; this skill keeps build rules. Hand it the brief (B7 checks the primary action and priorities), the `Layout:` line (A12), the required-content list (Pass A), and, for a changed surface, the `before` set so it runs Before/after mode and the pair shows what improved. Its review loop is bounded (its Step 4 sets the budget): defects earn another round, and taste findings are recorded and stop it. A concrete reference runs reference-fidelity mode. Fix passes are scoped: after the first build, each fix names one change and the regions it owns (a token fix may own every region) and leaves everything else untouched, because a whole-page "make it better" pass breaks what was already right. Pass design-system decisions, evidence, and unresolved debt into `/review-work` for significant work.

Every UI or design-system deliverable states its WCAG 2.2 AA result. Probe the built surface in the real browser and put a table in the deliverable (PR body, change description, or reply): one row per item below, PASS / FAIL / N/A, with its evidence. A FAIL is fixed, or recorded as accepted debt in `DESIGN.md` section 8 with the user's sign-off.

- **Contrast** (1.4.3, 1.4.11): text 4.5:1 (large 3:1), icons and control edges 3:1, both themes, placeholder text included.
- **Focus** (2.4.7, 2.4.11): Tab through every control and screenshot each ring; none missing, none entirely hidden by a sticky bar or overlay (the AA line; the target is none covered at all).
- **Target size** (2.5.8): every pointer target at least 24x24 CSS px, or an undersized one whose 24 px circle, centred on it, intersects no other target and no other undersized target's circle. Exempt: inline links in a sentence, targets the browser draws unstyled, a target with a same-function equivalent that passes, and a size the information requires.
- **Keyboard** (2.1.1, 2.1.2): every action works from the keyboard, and focus never gets trapped.
- **Reflow and text spacing** (1.4.10, 1.4.12): at 320 CSS px no content scrolls sideways, except content that needs two dimensions (a data table, a map, a diagram); with line-height 1.5, paragraph spacing 2em, letter spacing 0.12em, and word spacing 0.16em applied, nothing clips or overlaps.
- **Dragging, authentication, help, entry** (2.5.7, 3.3.8, 3.2.6, 3.3.7): a single-pointer alternative for every drag, no cognitive test to sign in unless an alternative exists, paste and password managers work, or the test is object or personal-content recognition, help in the same place on every page, nothing asked twice in one flow. N/A only when the surface has none of these.
- **State-stable controls** (build rule above): read each control's `getBoundingClientRect()` in every state (idle, hover, loading, success, disabled); width and height match across states.
- **System and surfaces** (build rules above): colour roles exist in `DESIGN.md` before any component; each component names its shadcn/ui or project-kit source; a grep of the shipped styles finds no `backdrop-filter`, neumorphic double shadows, or mesh-gradient backgrounds unless the brief or a concrete reference supplies them.

On the grounded path, close the gap ledger row by row: each fixed gap has its before/after pair and the check that proves it.

## The reference library (`references/`)

`design/` holds one architecture file (`design-system-architecture.md`: the `DESIGN.md` structure, 8 sections plus a greenfield-only Research Log and the grounding gap ledger), 12 taste skills (Layer A: how to execute), 70 brand design systems (Layer B: what it looks like), and the project-original routers in the table above. `_INDEX.md` catalogs all 83 with mood-to-brand mappings; read it when routing is not obvious. Most non-trivial work loads one Layer A + one Layer B. `README.md` carries the `DESIGN.md` gate, the style routing flow, stacking rules, and Phase Final.

Layer A (pick AT MOST ONE style skill; they encode opposing philosophies):

| File | Read when the brief says |
|---|---|
| `taste-skill.md` | Operational or neutral UI: internal tools, dashboards, admin, "just make it usable". The default. |
| `minimalist-skill.md` | "minimal", "clean", "Notion-like", "Linear-like", "editorial". |
| `soft-skill.md` | "premium", "luxury", "calm", "elegant", glossy or glass product surfaces; pair with a high-craft Layer B (`supabase`, `linear.app`, `vercel`, `stripe`). |
| `gpt-tasteskill.md` | "Awwwards-tier", "wow factor", "cinematic", "scroll-triggered" marketing experiences; stacks `ambience-skill.md`. |
| `brutalist-skill.md` | "brutalist", "raw", "Swiss", "experimental", "anti-design". |
| `redesign-skill.md` | Improving EXISTING UI; audit first; never on greenfield. |
| `image-to-code-skill.md` | A supplied or generated image is the contract. |
| `output-skill.md` / `stitch-skill.md` (worked export: `stitch-design-example.md`) | Stack on any style skill: output completeness; Google Stitch compatibility or a `DESIGN.md` export. |
| `layout-skill.md` / `interaction-skill.md` / `ambience-skill.md` | Stack on any style skill; mechanics only, no visual direction. |
| `imagegen-frontend-web.md` / `imagegen-frontend-mobile.md` / `imagegen-brandkit.md` | Image-only output; never code. |

Layer B: when the user names a brand or site ("Linear-style", "like Stripe's landing", "Aside-style browser agent"), load `references/design/<brand>.md` as the token source of truth: `aside` `apple` `stripe` `linear.app` `notion` `vercel` `claude` `figma` `airbnb` `nike` `tesla` `spotify` `raycast` `revolut` and ~56 more in `_INDEX.md`. Extract the tokens and apply them to the project's own content; never copy logos or trademarked imagery. A missing brand falls back to a Layer A mood match or the `open-design` skill.

`perfection/`: `README.md` (the seven tenets: real-browser audits only, 100 in every category, fix at the architecture, never weaken UX for points, design-system compliance, the audit report format) and `react-perf-tooling.md` (Playwright + `playwright-lighthouse` + `react-scan/lite` injection, per-route render budgets). Audit CLI, production build only, mobile and desktop presets, 3-5 runs, take the median:

```bash
uv run $SKILL_DIR/scripts/perfection/lighthouse-audit.py https://localhost:3000
```

`ui-ux-db/`: `README.md` documents the search CLI and the master-plus-overrides persistence pattern. The CLI finds `data/` next to itself, so run it from the user's project directory: `--persist` writes `design-system/` into the current directory, and the skill directory can sit inside a signed app bundle that must never change. Keep `-B` for the same reason:

```bash
python3 -B $SKILL_DIR/references/ui-ux-db/scripts/search.py "<query>" --design-system -p "Project"   # design-system generation
python3 -B $SKILL_DIR/references/ui-ux-db/scripts/search.py "<query>" --domain <domain>             # product style typography color landing chart ux react web prompt
python3 -B $SKILL_DIR/references/ui-ux-db/scripts/search.py "<query>" --stack <stack>               # html-tailwind react nextjs vue svelte astro swiftui react-native flutter shadcn jetpack-compose
```

`designpowers/`: `README.md` routes the pinned `Owl-Listener/designpowers` corpus (personas, accessibility and cognitive constraints, critique, debt, handoff, synthetic user testing, motion, role prompts) into `DESIGN.md` first, then into the implementation contract. It replaces nothing: not this skill, `/visual-qa`, `/ulw-plan`, `/ulw-execute`, or `/review-work`.

## When to load something else instead

| Situation | Load |
|---|---|
| Brand/style not among the 70 in `references/design/`, or the user says "Open Design" | `open-design` skill: the local nexu-io/open-design library (137+ design skills, 150+ design systems) |
| Driving a browser for captures | `visual-qa` skill: omowright from js eval (owned engine for renders, attached engine for signed-in pages) |
| Pure TypeScript/logic work with zero visual surface | `programming` skill alone; this skill adds nothing there |

## Activation

Use for any frontend, web UI, UX, visual, design, styling, layout, animation, performance, accessibility, or SEO work, and for every HTML/CSS/SVG artifact that ends up as a PDF, print page, report, figure, diagram, slide, or image: building, redesigning, auditing, or generating mockups. Not for backend, CLI, or pure-logic tasks with no visual surface.
