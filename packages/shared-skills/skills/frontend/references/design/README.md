
# Frontend Design Router

This file routes a UI request to the right reference files in this directory, gates the work on a `DESIGN.md`, and hands verification to `/visual-qa`. The reference files carry the design rules; this file decides which to open. The flow and the build rules (brief, draft guard, subtraction) live in the skill's `SKILL.md`; nothing here replaces them.

## The bar

Restraint with a visible hierarchy. The brief's primary action is the one prominent control, priority-1 content is where the eye lands first, and every element has a job the user would miss. A screen that is quiet, correct, and holds that hierarchy at 390 and 1440 in both themes is finished. Surface ambition (dimensional material, atmosphere, a signature moment) is a deliverable only when the brief asks for it: a named brand, "premium", "glossy", "make it stunning", a marketing page. Internal tools, dashboards, admin screens, reports, and figures ship on `taste-skill.md` and get no ambience by default. When the brief IS expressive, the failure flips: a rich reference flattened into a generic token set is the defect, and the notes under "Expressive briefs" apply.

## Two layers, one from each

- **Layer A, taste skills (12 files, named `-skill.md` or `imagegen-`):** how to execute. Discipline, spacing, motion physics, anti-slop guardrails, output completeness.
- **Layer B, design systems (70 brand files):** what it looks like. Concrete colour, type, and component tokens for one brand.

`_INDEX.md` lists all 83 with mood-to-brand mappings and stacking rules; read it when routing is not obvious. Most non-trivial tasks load one from each layer. For a brand or style outside the curated set, or when the user says "Open Design", load the `open-design` skill (the local nexu-io/open-design library, 150+ design systems) as the expanded library; this file keeps routing discipline, the `DESIGN.md` gate, and execution quality.

## Phase 0: Design System Gate (before routing, before any UI code)

Look for `DESIGN.md`, `design-system.md`, or `design-tokens.md` at the project root, then `docs/`, then `src/`.

**It exists: read all of it and follow it.** Every colour, font size, spacing value, and component pattern you produce references a token from it. A token you need and cannot find is added to `DESIGN.md` first, then used. Never introduce raw hex codes, arbitrary px values, or an ad-hoc component that bypasses the system. A layout or structure change is not covered by the existing file: it gets a `Layout:` line (`SKILL.md` Brief step) before the code.

**It does not exist: read `design-system-architecture.md` for the structure, then take the branch:**

1. **Greenfield, no concrete reference.** Research is a build step with named deliverables, not exploration to budget: run the lanes in parallel and open `DESIGN.md` with `## 0. Research Log`, one line per lane. A lane with no line did not run; skip a lane only when its tool or network is unavailable, and name the skip there.
   - *Embedded references:* shortlist 2-3 plausible Layer B candidates from `_INDEX.md`, then read ONE Layer A style skill and ONE Layer B reference in full, every line (they are 200-500 lines; a sliced read produces the flattened token set this gate exists to prevent). Log the shortlist, the pick, and why. `open-design` only when the curated set has no fit; `ui-ux-db` lookups for palette, type, and domain questions that come up here.
   - *Lazyweb real-product screens:* read `lazyweb.md` FIRST and run its recipe verbatim; it mints its own anonymous token, so never improvise curl calls against the host. Log the queries, how many screens you actually viewed, and the layout grammar taken, never pixel copies.
   - *StyleGallery:* read `stylegallery.md`, fetch the pattern whose primary spatial problem matches the screen, and write the `Layout:` line.
   - *Imagen concept drafts:* generate 2-3 drafts, each seeded with the loaded Layer A + Layer B tokens (palette, type, material); pick the strongest and treat it as the reference-fidelity contract. Log the paths and the pick.
   Synthesize the lanes into `DESIGN.md`. Sources are material, not mood labels: extract tokens, layout grammar, component anatomy, interaction states, motion, and taste decisions, then recombine them into project-specific primitives. Inventory the content blocks and give each a job (hook, explain, prove, compare, convert, navigate, retain), then order sections by the visitor's decision path, not by visual symmetry. Never freestyle past the selected references; never copy logos, trademarked assets, or brand-specific copy.
2. **Concrete reference supplied.** `image-to-code-skill.md` for a static image (screenshot, mockup, Figma export, Stitch or imagen output), `clone-from-url.md` for a live site: extract its exact tokens, layout geometry, copy, spacing, states, and responsive intent into `DESIGN.md`, then implement reusable primitives against that contract. `/visual-qa` reference-fidelity mode is the finish: pixel comparison plus proof that the code is an extensible design system, not a screenshot-matched one-off.
3. **Existing UI with implicit patterns or components.** Extract the colours, typography, spacing, primitives, states, and motion already in use into `DESIGN.md` before changing UI code.
4. **Existing UI with no reusable component layer.** STOP and ask one focused question: preserve the current look with copy-nearby styling, or extract `DESIGN.md` plus reusable components first? Do not silently choose the cheaper path or the larger refactor. With copy-nearby styling the brief and the `Layout:` line live in the change description.

**Small-change rule.** A small change (the `SKILL.md` router's first row: a fix, a new control, a restyled component, a copy or spacing change) on a surface with no `DESIGN.md` copies the nearest styled sibling: no extraction, no question, with the brief and any `Layout:` line in the change description. Branches 3 and 4 apply to a new screen or flow. When there is no styled sibling to copy, it is not a small change: take branch 3 or 4.

**Primitive Showcase Gate.** No product screen until `DESIGN.md` section 5 names the reusable primitives and their states, and each primitive plus required state passes mobile/tablet/desktop visual QA in a component showcase or equivalent state harness. Skipping it ships ad-hoc-styled screens and re-enters the redesign loop.

### Expressive briefs (only when the brief asks for surface ambition)

- Commit a direction in 1-2 sentences BEFORE extracting tokens: the atmosphere, the signature material, the colour story, the one moment a visitor remembers. Sketch 2-3 genuinely different directions and pick the one you can defend with the loaded reference; do not average them, the average is the generic default.
- The reference's distinctive material survives extraction, each decision naming its source: the actual elevation recipe (the layers that make a surface read as glass, not a single blur), a multi-stop perceptual colour ramp (not one hex at varied opacity), the explicit display/body/mono choices, one signature interaction. If your `DESIGN.md` could describe any generic dark SaaS, you flattened the reference; go back.
- Before QA, grep the shipped styles: `Inter` where a display face was declared, a lone `backdrop-filter: blur` on "glass", or one brand hex reused everywhere means you regressed to priors. Fix it before declaring done.

## Phase 0.5: React Dev Tooling Gate (React projects)

If `react` is in `package.json`, three dev-only tools are installed before any UI implementation, a small change included; the user opts out, not in. Grep the entry file (`app/layout.tsx`, `pages/_document.tsx`, `src/main.tsx`, `src/index.tsx`, `app/root.tsx`) for `react-grab` and `react-scan`, and `package.json` plus the skills directory for `react-doctor`.

Missing: run from the project root, then read `react-dev-tooling-skill.md` for per-framework manual snippets, the `*_DISABLE_REACT_DEVTOOLS` flag pattern, and the production-leak check.

```bash
npx grab@latest init                    # react-grab: UI element -> AI source context
npx react-doctor@latest install         # react-doctor: agent-skill install + static scan
npx react-scan@latest init              # react-scan: render highlighter
```

Present: open the entry file and confirm each tool sits behind `NODE_ENV === 'development'` or `import.meta.env.DEV`; fix the gate before proceeding. Skip only when the project is not React, the user said "no extra dev dependencies", or it is a React library with no entry file (react-doctor's static scan still applies).

## Routing: pick the style skill

Run in order and stop at the first match.

1. **The user named a brand or site** ("make it look like Linear", "Stripe-style buttons", "Aside-style browser agent", a screenshot of a known brand site). Find it under Layer B in `_INDEX.md`, load `<brand>.md` as the token source of truth, and add a Layer A for execution (usually `taste-skill.md`). A brand not in the index: fall through to step 2 plus a mood shortcut from the index.
2. **Ambition, then mood.** Operational (internal tool, dashboard, admin, report, "just make it usable") is the default and takes `taste-skill.md` plus the `_INDEX.md` shortlist for exactly one Layer B. Expressive only when the brief says so, then map the words:

   | The brief says | Load |
   |---|---|
   | "minimal", "clean", "Notion-like", "Linear-like", "editorial", "boring is good" | `minimalist-skill.md` |
   | "brutalist", "raw", "Swiss", "experimental", "industrial", "anti-design", "unstyled" | `brutalist-skill.md` |
   | "premium", "luxury", "calm", "elegant", "spa", "boutique", "glossy", "glassy", "liquid glass", "startup-grade", "make it beautiful" | `soft-skill.md` + a high-craft Layer B (`supabase` / `linear.app` / `vercel` / `stripe`) |
   | "Awwwards-level", "wow factor", "magnetic", "scroll-triggered", "cinematic", "make it crazy" | `gpt-tasteskill.md` + `ambience-skill.md` for the backgrounds and scroll scenes its sections 5 and 7 demand |
3. **Redesign of existing UI** ("fix the design", "this looks bad", "improve the UI", "the spacing is off", an existing screenshot or codebase with a request for visual upgrades). Load `redesign-skill.md`: audit first, then upgrade; stack a Layer B if the user wants a direction. Fix the before/after cases and capture `before` (`SKILL.md` Brief step) before the first edit. Never on greenfield.
4. **Image-first, on request** ("generate the design first then code it", "show me what it could look like"). `image-to-code-skill.md` plus `imagegen-frontend-web.md` or `imagegen-frontend-mobile.md`; the chosen draft is the reference-fidelity contract.
5. **Image only, no code** ("generate a mockup image", "brand kit board", "moodboard"). Only the imagegen file: `imagegen-frontend-web.md` (website mockup), `imagegen-frontend-mobile.md` (app screens), `imagegen-brandkit.md` (logo + colours + typography + mockups). No code-generation skill, or the agent writes components.
6. **Stitch or a `DESIGN.md` export** ("Google Stitch", "give me the design as a doc"). Add `stitch-skill.md`; `stitch-design-example.md` shows a finished export.
7. **The agent has been lazy** (mid-conversation: "stop with the TODOs", "finish the implementation"). Add `output-skill.md`.
8. **App shell, not a scroll-the-page site** (dashboard, settings, inbox, list-detail, split panes, fixed sidebar + scrolling body), or a layout that breaks when content gets long, empty, or unbroken. Add `layout-skill.md` (scroll ownership, the two silently-failing CSS contracts, named primitives, container-vs-viewport, content stress) and fetch the pattern through `stylegallery.md`. Skip for a pure scroll-the-document marketing page.
9. **Interaction or motion** (micro-interactions, transitions, gestures, hover/press/focus feedback, loading/success/error morphs, "make it feel alive"). Add `interaction-skill.md`: nearest beui.dev pattern, real source through its curl recipe, mechanism adapted to `DESIGN.md`.
10. **Ambience, when the brief asks** (animated, shader, particle, or grid background; split, blur, shimmer, typewriter, count-up, scramble, or marquee text; scroll chapters; spotlight, tilt, glare, or glowing-border cards). Add `ambience-skill.md`: nearest react-bits pattern, real source, retrofit checklist. One atmosphere per hero; cursor effects stay quarantined to `gpt-tasteskill.md` briefs.

### Stacking

- At most ONE Layer A style skill at a time: `taste-skill`, `gpt-tasteskill`, `minimalist`, `brutalist`, and `soft` are alternatives with opposing spacing and typography philosophies. `redesign-skill.md` replaces the style skill when the task is auditing, not building.
- `output`, `stitch`, `layout`, `interaction`, and `ambience` stack on any style skill: discipline, format, or mechanics, never visual direction, so they also stack with each other.
- Layer B is orthogonal to Layer A: any brand with any style skill. Layer B supplies the tokens; Layer A drives the execution.
- `image-to-code-skill.md` pairs with exactly one imagegen file.

## Execution checklist after routing

1. `DESIGN.md` was read or created in Phase 0 (or, under the small-change rule, the styled sibling was copied); the screen brief (`SKILL.md`) is written.
2. Verify dependencies in `package.json`; never assume `framer-motion`, `gsap`, `lucide-react`, or `tailwindcss` (and which version). If missing, output the install command first.
3. Tailwind version lock: v4 uses `@tailwindcss/postcss` or the Vite plugin, never `tailwindcss` in `postcss.config.js`; v3 uses different config syntax. Pick from what is installed.
4. Full-height heroes use `min-h-[100dvh]`, never `h-screen` (iOS Safari jumps).
5. Next.js: motion, state, and portals live in a `'use client'` leaf, never at the page level.
6. Match the project's existing patterns FIRST: CSS Modules stay CSS Modules, styled-components stay styled-components. The references guide style, not infrastructure.
7. Every token traces to `DESIGN.md`; a pattern used 2+ times is documented back into section 5.
8. The draft guard and `check-draft-guard.ts` (`SKILL.md`) are clean before Phase Final.
9. State which files you loaded and why in one sentence. If the user pushes back on a routing choice, switch references; if the request is unclear after two reads, ask one focused question before loading anything.

## Anti-patterns

- Loading nothing and freestyling: purple-blue gradients, rounded-2xl everywhere, three feature cards, Inter, lorem ipsum. The references exist to prevent this.
- Ignoring the named brand: "Linear-style" that does not match Linear's purple, tight spacing, and mono accents is a routing failure.
- Applying a Layer B verbatim to a project that is not that brand: extract the tokens, apply them to the project's content, never copy logos or trademarked imagery.
- Using an imagegen file to write code: they are image-only; switch to `image-to-code-skill.md`.
- `as any` or `@ts-ignore` to make a borrowed component fit: adapt it cleanly.
- Coloured edge bars and accent outlines: the `SKILL.md` draft guard carries the rule, the replacements, and the lint.

## Phase Final: Design QA (after implementation)

The verification authority is `/visual-qa`, not a checklist here. Run it with the screen brief, the `Layout:` line, the required-content list, and, for a changed surface, the `before` set, so it judges the brief (B7), the layout contract (A12), required content (Pass A), and the before/after pair alongside its HIG checklist on its full capture matrix. Its loop is bounded (its Step 4 sets the budget); taste findings stop it and are recorded. A concrete reference or clone runs reference-fidelity mode.

For an expressive brief only, this skill adds the one judgment `/visual-qa` cannot make: a bug-free render that reads generic next to the loaded reference is not done. Raise the material layering, give the colour a real ramp, render the hero's focal object as a lit, dimensional thing (a generated bitmap or real light, shadow, and depth; never flat geometric primitives), and add the one signature moment, then re-check. An operational brief is done when `/visual-qa` passes within its budget and the brief holds.
