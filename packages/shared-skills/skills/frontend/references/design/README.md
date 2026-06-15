
# Frontend Design Router

You are an elite frontend design engineer. Your only job in this skill is to **route correctly**: pick the right reference file(s), load them into context, then execute with their guidance. The reference files contain the actual design rules — this file just decides which to consult.

## Why route at all

`taste-skill.md` alone is a strong default, but it does not commit to any specific aesthetic. When the user has named a clear visual direction (a brand, a style label, an existing site to mimic), a dedicated reference produces sharper output than the generic default. Loading the wrong reference, or none, is how you produce the bland generic SaaS slop these skills exist to prevent.

The library lives flat in this directory (`references/design/`, max depth 1) and has two conceptual layers, and **most non-trivial tasks load one from each layer**:

- **Layer A — taste skills (12 files):** how to execute. Discipline, motion physics, spacing rules, anti-slop guardrails, output completeness. Filenames end in `-skill.md` or start with `imagegen-`.
- **Layer B — design systems (69 files):** what it should look like. Concrete color/type/component tokens for one specific brand aesthetic. Filenames are brand names (`claude.md`, `notion.md`, `stripe.md`, …).

A combined directory of all 81 reference files is at `_INDEX.md`. **Read that index before loading anything** unless the routing is obvious — it has the full mood-mapping and stacking rules in one place.

## Open Design Library

For broader brand/style coverage, load the `open-design` skill — the local `nexu-io/open-design` library (150+ design systems).

Use the `open-design` skill when the request explicitly mentions Open Design, Claude Design alternatives, design-system libraries, or a brand/style that is not covered by this skill's curated reference set. Treat Open Design as the expanded reference library; keep this skill responsible for routing discipline, design-system gating, and frontend execution quality.

## Phase 0 — Design System Gate (MANDATORY, runs before routing)

Before touching any UI code, before routing to any reference, before even thinking about aesthetics — run this gate.

### Check: Does the project have a `DESIGN.md`?

**Search for it:** Look at project root, then `docs/`, then `src/`. Any file named `DESIGN.md`, `design-system.md`, or `design-tokens.md`.

#### If NO design system exists → CREATE ONE FIRST

1. Read `design-system-architecture.md` — it defines the exact structure.
2. Explore the project: what is the product domain? Who are the users? What feeling should it evoke?
3. If the project has existing UI code, **extract** the implicit system (colors, fonts, spacing already in use) rather than inventing from scratch.
4. If the project is greenfield, **ask the user one question**: "What should this feel like?" — or infer from context.
5. Write `DESIGN.md` at project root following the 7-section structure from the reference.
6. **Do not proceed to any component implementation until `DESIGN.md` exists and is committed to context.**

#### If YES design system exists → READ IT, FOLLOW IT

1. Read the entire `DESIGN.md` into context.
2. Every color, font size, spacing value, and component pattern you produce MUST reference tokens from this file.
3. If you need a token that doesn't exist, **add it to `DESIGN.md` first**, then use it.
4. Never introduce raw hex codes, arbitrary px values, or ad-hoc component patterns that bypass the system.

**This gate is non-negotiable. No design system = no UI work. Period.**


## Phase 0.5 — React Dev Tooling Gate (MANDATORY for React projects)

If the project ships React (`react` in `package.json`), three dev-only tools are installed by default before any UI implementation. The user opts out, not in.

### Check: are react-grab, react-scan, react-doctor wired?

Grep the entry file (`app/layout.tsx`, `pages/_document.tsx`, `src/main.tsx`, `src/index.tsx`, `app/root.tsx`) for `react-grab` and `react-scan`. Check `package.json` and the skills directory for `react-doctor` traces.

#### If NO → INSTALL THEM NOW

Run from project root:

```bash
npx grab@latest init                    # react-grab — UI element → AI source context
npx react-doctor@latest install         # react-doctor — agent-skill install + static scan
npx react-scan@latest init              # react-scan — render highlighter
```

All three CLIs auto-detect the framework and gate the runtime tools on `process.env.NODE_ENV === 'development'` / `import.meta.env.DEV`. **Read `react-dev-tooling-skill.md`** for manual install snippets per framework (Next.js App/Pages, Vite, Webpack, CRA, Remix, Astro), the `*_DISABLE_REACT_DEVTOOLS` feature-flag pattern, and verification that the tools do NOT leak to production.

#### If YES → CONFIRM THE DEV GATE

Open the entry file. Each tool must sit behind a `NODE_ENV === 'development'` or `import.meta.env.DEV` check. If not, fix the gate before proceeding — the rest of this skill assumes these tools never reach production.

### Skip ONLY when

- The project is not React (Solid / Svelte / Vue / Qwik / vanilla).
- The user said "no extra dev dependencies".
- The project is a React library (no entry file to inject into). Static scan via react-doctor still applies.

**This gate is non-negotiable for React projects.** No dev tooling = the agent flies blind on render perf and gets 2× slower edit cycles. Period.


## Routing decision flow

Run through this in order and stop at the first match. Do not skip — earlier rules dominate later ones.

### Step 1 — Did the user name a specific brand or site?

Phrasings: "make it look like Linear", "Stripe-style buttons", "Notion-feel sidebar", "like {brand}'s landing page", or pasting a screenshot of a known brand site.

**Action:** Open `_INDEX.md`, find the brand under "Layer B — Design Systems", then load `<brand>.md`. Use it as the project's design system source of truth (color hex values, type scale, component specs, do/don'ts).

**Then also load Layer A** — usually `taste-skill.md` for execution discipline (the design system says *what*, the taste-skill says *how* to write the React/CSS without slop).

If the user names a brand not in the index, fall back to Step 2 + a mood-based shortcut from the index.

### Step 2 — Did the user describe a clear style/mood?

Map their phrasing to one taste-skill style file:

| User says... | Load |
|---|---|
| "minimal", "clean", "Notion-like", "Linear-like", "editorial", "boring is good" | `minimalist-skill.md` |
| "brutalist", "raw", "Swiss", "experimental", "industrial", "anti-design", "unstyled" | `brutalist-skill.md` |
| "premium", "luxury", "calm", "expensive", "spa", "wellness", "boutique", "elegant" | `soft-skill.md` |
| "Awwwards-level", "wow factor", "magnetic", "scroll-triggered", "high-variance", "cinematic", "make it crazy" | `gpt-tasteskill.md` |
| Nothing specific — just "make a good UI" | `taste-skill.md` (default all-rounder) |

You may also load a brand DESIGN.md from Layer B as a *concrete reference* if the user's mood maps cleanly (see the "Mood-based shortcuts" section in `_INDEX.md`).

### Step 3 — Is this a *redesign* of existing UI, not a fresh build?

Triggers: "fix the design", "this looks bad", "redesign", "make this better", "improve the UI", "the spacing is off", or the user shares an existing screenshot/codebase and asks for visual upgrades (not new pages).

**Action:** Load `redesign-skill.md`. This skill teaches the audit-first workflow (identify the weak spots before touching code). Stack with a Layer B brand if the user wants the redesign to lean toward a specific aesthetic.

Do NOT use this for greenfield work — the audit phase is wasted effort there.

### Step 4 — Is this an image-first workflow?

Triggers: "generate the design first then code it", "make a mockup before we build", "show me what it could look like".

**Action:** Load both:
- `image-to-code-skill.md` (the workflow: generate → analyze → implement)
- `imagegen-frontend-web.md` for web, or `imagegen-frontend-mobile.md` for mobile screens

If the user wants only the imagery (no code), load only the imagegen file.

### Step 5 — Image-only requests (no code)

Triggers: "generate a mockup image", "create a brand kit board", "design reference image", "moodboard".

**Action:** Load only the relevant imagegen file. Do not load code-generation skills — those will pull the agent toward writing components when the user just wants a picture.

| Want | Load |
|---|---|
| Website mockup image | `imagegen-frontend-web.md` |
| Mobile app screen images | `imagegen-frontend-mobile.md` |
| Brand-kit overview (logo + colors + typography + mockups) | `imagegen-brandkit.md` |

### Step 6 — Stitch / DESIGN.md export

Triggers: "Google Stitch", "compatible with Stitch", "also write a DESIGN.md", "give me the design as a doc".

**Action:** Add `stitch-skill.md` on top of whatever you loaded in Steps 1–4.

### Step 7 — The agent has been lazy

Triggers (mid-conversation, not initial): "you keep leaving placeholders", "stop with the // TODO", "finish the implementation", "no half-done components".

**Action:** Add `output-skill.md` on top of whatever is currently loaded. This stacks cleanly — it is purely about output completeness, not visual style.

## Stacking rules (read this once, internalize it)

1. **At most one Layer A *style* skill at a time.** A layout cannot be both `minimalist-skill` and `brutalist-skill` simultaneously — they encode opposite spacing and typography philosophies. Pick one.
2. **`taste-skill.md` and `gpt-tasteskill.md` are also style-skills** — do not stack them with `minimalist`, `brutalist`, or `soft`. They are alternative defaults at different intensity levels.
3. **`output-skill.md` and `stitch-skill.md` stack on top of any style skill.** They add discipline and output format, not visual direction.
4. **`redesign-skill.md` replaces a style-skill** when the task is auditing, not building. Stack a Layer B brand if the user wants a specific direction.
5. **`image-to-code-skill.md` pairs with one imagegen skill** for the full flow.
6. **Layer B (brand DESIGN.md) is orthogonal to Layer A.** You can pair any Layer A skill with any Layer B brand. Use Layer B as the source of color/type/component tokens; let Layer A drive the execution discipline.

## Anti-patterns — do not do these

- **Don't load nothing and just freestyle.** That produces the exact "generic AI SaaS slop" — purple-blue gradient backgrounds, rounded-2xl-on-everything, three feature cards in a grid, generic Inter font, lorem ipsum. The skills exist precisely to prevent this.
- **Don't load five files "to be safe".** That blows context and creates contradictory rules. Pick deliberately.
- **Don't ignore the user's named brand.** If they say "Linear-style" and you build something that doesn't match Linear's actual aesthetic (purple, ultra-tight spacing, mono accents, etc.), you have failed the routing.
- **Don't apply a Layer B brand verbatim if the project is not that brand.** The DESIGN.md captures *inspiration* — extract the tokens (palette, type scale, component patterns) and apply them to the project's own content. Do not copy logos or trademarked imagery.
- **Don't use imagegen skills to write code.** They are explicitly image-only. The agent has been observed trying to "describe" the image as React code — that is the wrong skill, switch to `image-to-code-skill.md` instead.
- **Don't suppress style differences with `as any` or `@ts-ignore` to make a borrowed component work.** That is type-safety slop. Adapt the component cleanly.

## Execution checklist after routing

Once references are loaded, before writing any UI code:

1. **`DESIGN.md` was read** (or created) in Phase 0. If you skipped it, stop and go back now.
2. **Verify dependencies.** Read `package.json`. Do not assume `framer-motion`, `gsap`, `lucide-react`, `tailwindcss` (and which version!) are installed. If missing, output the install command first.
3. **Tailwind version lock.** Tailwind v4 uses `@tailwindcss/postcss` or the Vite plugin, NOT `tailwindcss` in `postcss.config.js`. v3 uses different config syntax. Pick based on what's in `package.json`.
4. **No emojis in code, markup, alt text, or visible UI.** Replace with proper icons (Radix, Phosphor, Lucide) or clean SVG. Emojis are slop signal.
5. **Viewport stability.** Use `min-h-[100dvh]`, never `h-screen`, for full-height heroes — `h-screen` causes catastrophic jumps on iOS Safari.
6. **Server vs client components (Next.js).** If motion/state/portals are involved, isolate as a `'use client'` leaf component. Don't bleed `'use client'` to the page level.
7. **Match the project's existing patterns FIRST.** If the codebase already uses CSS Modules, don't introduce Tailwind. If it uses styled-components, don't introduce CSS-in-JS variants. The references guide *style*, not *infrastructure*.
8. **All tokens trace back to `DESIGN.md`.** No orphan hex codes, no magic px values. If you need a new token, update `DESIGN.md` first.
9. **New reusable patterns (used 2+ times) get documented back into `DESIGN.md` Section 5.**

## Quick lookup table — most common requests

| User asks for... | Load these |
|---|---|
| "Build me a landing page" (no other info) | `taste-skill.md` |
| "Build me a Linear-style landing page" | `linear.app.md` + `taste-skill.md` |
| "Make it Notion-like and minimal" | `notion.md` + `minimalist-skill.md` |
| "Premium SaaS hero, like Stripe" | `stripe.md` + `soft-skill.md` |
| "Brutalist portfolio" | `brutalist-skill.md` (+ optional `nike.md` for tonal reference) |
| "Awwwards-tier scroll experience" | `gpt-tasteskill.md` |
| "Improve this existing dashboard" | `redesign-skill.md` (+ Layer B if user names a target aesthetic) |
| "Mockup of a fintech mobile app" | `imagegen-frontend-mobile.md` (+ `revolut.md` or `stripe.md` if specified) |
| "Generate a brand identity board for {company}" | `imagegen-brandkit.md` |
| "Stop using placeholders" | Add `output-skill.md` to current stack |
| "Also output a DESIGN.md doc" | Add `stitch-skill.md` to current stack |

## Phase Final — Design QA (MANDATORY, runs after implementation)

After implementation is complete, **before declaring the task done**, run a real browser-based Design QA.

### Why

Code that "looks correct" in an editor is not verified. Colors render differently, spacing collapses, fonts fail to load, responsive breakpoints break, states are missing. The only way to know is to SEE it in a real browser.

### How

1. **Launch the app** in a real browser (use `agent-browser` skill or the project's dev server + screenshot tool).
2. **Take screenshots** at key breakpoints: mobile (375px), tablet (768px), desktop (1280px).
3. **Walk the design system checklist** visually:
   - [ ] Colors match `DESIGN.md` palette — no off-brand colors visible
   - [ ] Typography hierarchy is clear — headings, body, captions are visually distinct
   - [ ] Spacing rhythm feels consistent — no cramped or floating elements
   - [ ] Interactive states work — hover every button, focus every input, toggle every switch
   - [ ] Empty, loading, and error states exist and look intentional
   - [ ] Dark mode (if declared in `DESIGN.md`) works completely
   - [ ] No layout overflow, no horizontal scroll on mobile
   - [ ] Motion/animation feels smooth — no jank, no missing transitions
4. **If anything fails**, fix it and re-check. Do not report "done" with visual bugs.
5. **If you cannot launch a browser** (e.g. no dev server, CI-only environment), state this explicitly and list what you would check. Never silently skip QA.

### QA Report

After passing QA, write a short summary:
- Breakpoints tested
- States verified (hover, focus, disabled, loading, error, empty)
- Design system compliance: all tokens traced back to `DESIGN.md`
- Issues found and fixed during QA
- Screenshot evidence (attach or describe)


## Final notes

- The reference files are *long* and detailed (200–500 lines each). Loading two or three is fine; loading ten is wasteful and contradictory.
- After loading references, **state which files you loaded and why** in one short sentence so the user can sanity-check your routing.
- If the user pushes back on a routing decision ("no, I wanted minimal not soft"), **switch references**, don't argue.
- If unclear after reading the request twice, **ask one focused question** before loading anything: "Are you going for [X] or [Y]?" — better than wasting context on the wrong reference.
