
# Frontend Design Router

You are an elite frontend design engineer. Your only job in this skill is to **route correctly**: pick the right reference file(s), load them into context, then execute with their guidance. The reference files contain the actual design rules — this file just decides which to consult.

## The bar

You are not done when it is clean and correct. You are done when a senior product designer at Linear, Stripe, or Supabase would ship it: surfaces read as real materials (depth, light, layering), color carries a story and a ramp, type has personality, and motion has intent. **Correct-but-flat is a failure, not a finish.** The most common way this skill fails is effort drain: the build, lint, file-size, and test gates eat all the attention and the surface ships at the floor. Spend on the surface like it is the deliverable, because for an expressive brief it is. When you render and find only bug-level issues, you are not done — you are at the start of the part that separates good from generic.

Two things ship flat most often, and both read as "clean but generic": the **hero's focal object** and the **atmosphere**. Render the focal object as a real, lit, dimensional thing — a generated bitmap (imagegen) for a product/brand/object hero, or CSS/SVG art that carries light, shadow, gradient, and depth. Flat geometric primitives (plain circles and rounded rects) for a brand hero are the flat trap. Give the background depth too — gradient, glow, layered light, an atmospheric band, or a real image — not one flat fill. Glass is only one material: a dark glossy brand wants tint+blur+rim+sheen+glow, a bright playful brand wants gradient fills+soft depth shadows+a lit focal object. Pick what the brand calls for, but it must have dimension.

## Why route at all

`taste-skill.md` alone is a strong default, but it does not commit to any specific aesthetic. When the user has named a clear visual direction (a brand, a style label, an existing site to mimic), a dedicated reference produces sharper output than the generic default. Loading the wrong reference, or none, is how you produce the bland generic SaaS slop these skills exist to prevent.

The library lives flat in this directory (`references/design/`, max depth 1) and has two conceptual layers, and **most non-trivial tasks load one from each layer**:

- **Layer A — taste skills (12 files):** how to execute. Discipline, motion physics, spacing rules, anti-slop guardrails, output completeness. Filenames end in `-skill.md` or start with `imagegen-`.
- **Layer B — design systems (70 files):** what it should look like. Concrete color/type/component tokens for one specific brand aesthetic. Filenames are brand names (`aside.md`, `claude.md`, `notion.md`, `stripe.md`, ...).

The combined reference catalog is at `_INDEX.md`. Read it before loading anything unless routing is obvious; it carries the mood mapping, structural mechanics, and stacking rules in one place.

Two project-original structural references sit outside those visual layers. `composition-skill.md` owns eligible multi-section page shape and proof inputs. `layout-skill.md` owns app-shell mechanics and scroll ownership. Neither chooses a visual style.

## Optional Open Design boundary

OMO already ships a curated, pinned subset of Open Design material as Layer B references. It does not ship a separate Open Design skill or workflow. Query a configured local Open Design service through its `od` CLI or MCP only when built-in OMO curation has no suitable fit or the user explicitly requests Open Design. Do not install or invoke an unconfigured service implicitly. If the integration is unavailable, state that boundary and continue with the closest curated fallback in `_INDEX.md`.

## Phase 0 — Design System Gate (MANDATORY, runs before routing)

Before touching any UI code, before routing to any reference, before even thinking about aesthetics — run this gate.

### Check: Does the project have a `DESIGN.md`?

**Search for it:** Look at project root, then `docs/`, then `src/`. Any file named `DESIGN.md`, `design-system.md`, or `design-tokens.md`.

#### If NO design system exists → RUN THE TRIAGE

1. Read `design-system-architecture.md` — it defines the exact structure.
2. Identify the branch: greenfield setup, existing UI with implicit patterns/components, or existing UI with no reusable component layer.
3. **Greenfield setup:** route by surface. Marketing, editorial, portfolio, and discovery work uses `_INDEX.md` to shortlist 2-3 plausible Layer B references, then reads exactly one Layer A style skill and one Layer B reference in full. Operational product UI uses the `taste-skill.md` **Brief to Design System Map** only to choose an official design system, then follows that system and `layout-skill.md`. Query a configured local Open Design service only at the optional boundary above. Open `DESIGN.md` with a `## 0. Research Log` recording the applicable deliverables. For an eligible multi-section page, let approved content, proof inputs, and layout research produce the Section 4 Page Structure outcome below, then keep it aligned as the concept evolves. Extract palette, typography, material, component anatomy, interaction states, motion, and taste decisions into project-specific primitives. Never copy logos, trademarked assets, brand-specific copy, or unsupported proof claims.
   - **Commit a distinctive direction BEFORE extracting tokens.** In 1-2 sentences, name the atmosphere, the signature material, the color story, and the one moment a visitor will remember. For an expressive brief, sketch 2-3 genuinely different directions and pick the boldest one you can defend with the loaded reference; do not average them, because the average IS the generic default this skill exists to beat. A locked, never-revisited one-shot decision is how a page ends up flat.
   - **The reference's distinctive material MUST survive extraction (expressive briefs).** The common failure is loading a rich reference and then distilling it into a generic dark-SaaS token set. Your `DESIGN.md` must carry the *non-default* decisions forward and name which reference each came from: the actual elevation recipe (the specific layers that make a surface read as glass/glossy, not a single blur), a multi-stop perceptual color ramp (not one brand hex reused at varied opacity), the explicit display/body/mono type choices, and one signature interaction. Self-check before writing code: if your `DESIGN.md` could describe any generic dark SaaS, you flattened the reference — go back and put the specific material in.
4. **Existing UI with implicit patterns/components:** extract the colors, typography, spacing, primitives, states, and motion already in use. Write `DESIGN.md` to codify what exists before changing UI code.
5. **Existing UI with no reusable component layer:** STOP and ask whether to preserve the current style with copy-nearby edits or extract a `DESIGN.md` plus reusable components first. Do not silently choose the cheaper path or the larger refactor.
6. Finish the triage at the Primitive Showcase Gate below.

#### If YES design system exists → READ IT, FOLLOW IT

1. Read the entire `DESIGN.md` into context.
2. Every color, font size, spacing value, and component pattern you produce MUST reference tokens from this file.
3. If you need a token that doesn't exist, **add it to `DESIGN.md` first**, then use it.
4. Never introduce raw hex codes, arbitrary px values, or ad-hoc component patterns that bypass the system.

**The Design System Gate is non-negotiable. No design system = no UI work. Period.**

### Primitive Showcase Gate (MANDATORY)

**Do not proceed to product screens until `DESIGN.md` exists, Section 5 names the reusable primitives and their states, and each primitive plus required state passes mobile/tablet/desktop visual QA in a component showcase or equivalent state harness.** Skipping this gate ships ad-hoc-styled product screens and re-enters the redesign loop.

### Page composition outcome

Load `composition-skill.md` for a new or substantially restructured multi-section marketing, editorial, portfolio, or discovery page without a user-supplied exact visual reference. Its output is a concise Section 4 record of the content decision path, dominant composition, nav/footer voice, proof basis, and any intentional reuse rationale.

Judge structural variety only against routes with similar purpose, audience, and content scale. If a route intentionally shares a publishing template or established information architecture, document that reason instead of forcing novelty. Otherwise, color, font, illustration, and copy changes alone should not disguise an unexplained structural clone. Keep the record aligned with the selected concept and implementation when evidence leads the design to evolve.

Component-only work, app shells, and exact-reference reproduction do not need a Page Structure row. These exemptions never authorize invented proof.


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

Phrasings: "make it look like Linear", "Stripe-style buttons", "Notion-feel sidebar", "Aside-style browser agent", "like {brand}'s landing page", or pasting a screenshot of a known brand site.

**Action:** Open `_INDEX.md`, find the brand under "Layer B — Design Systems", then load `<brand>.md`. Use it as the project's design system source of truth (color hex values, type scale, component specs, do/don'ts).

**Then also load Layer A** — usually `taste-skill.md` for execution discipline (the design system says *what*, the taste-skill says *how* to write the React/CSS without slop).

If the user names a brand not in the index, use a mood-based shortcut from the index. Query a configured local Open Design service only when that built-in route has no suitable fit or the user explicitly requests Open Design.

### Step 2 — Read the brief's ambition, THEN map style/mood

Decide the lane by **ambition first** — this is what your output gets judged on, and the wrong read is how a high-craft request ships clean-but-flat:

- **Expressive brief** — any surface-ambition signal: "glossy", "glassy", "liquid glass", "premium", "luxe", "startup-grade", "brand-grade", "make it beautiful / pretty / wow", or a named product company to feel like. The page is a showcase and rich material IS the deliverable. Commit to a high-craft Layer A (`soft-skill` or `gpt-tasteskill`) and ALWAYS pair a high-craft Layer B exemplar (`supabase`, `linear.app`, `vercel`, `stripe`) as the token source. This lane OVERRIDES any default "keep it quiet / utilitarian" instinct.
- **Operational brief** — internal tool, dashboard, admin, "just make it usable". Restraint is correct here and `taste-skill` is the right default.

Do NOT let an expressive brief fall through to `taste-skill`. Then map the phrasing:

| User says... | Load |
|---|---|
| "minimal", "clean", "Notion-like", "Linear-like", "editorial", "boring is good" | `minimalist-skill.md` |
| "brutalist", "raw", "Swiss", "experimental", "industrial", "anti-design", "unstyled" | `brutalist-skill.md` |
| "premium", "luxury", "calm", "expensive", "elegant", "spa", "boutique", "glossy", "glassy", "liquid glass", "startup-grade", "make it beautiful/pretty" | `soft-skill.md` + a high-craft Layer B (`supabase` / `linear.app` / `vercel` / `stripe`) |
| "Awwwards-level", "wow factor", "magnetic", "scroll-triggered", "high-variance", "cinematic", "make it crazy" | `gpt-tasteskill.md` |
| Neutral or operational: internal tool, dashboard, admin, "just make it usable" with no surface ambition | Use the `taste-skill.md` **Brief to Design System Map** to choose an official design system, then add `layout-skill.md`; do not use the marketing Layer B shortlist. |

You may also load a brand DESIGN.md from Layer B as a *concrete reference* if the user's mood maps cleanly (see the "Mood-based shortcuts" section in `_INDEX.md`).

### Step 3 — Is this a *redesign* of existing UI, not a fresh build?

Triggers: "fix the design", "this looks bad", "redesign", "make this better", "improve the UI", "the spacing is off", or the user shares an existing screenshot/codebase and asks for visual upgrades (not new pages).

**Action:** Load `redesign-skill.md`. This skill teaches the audit-first workflow (identify the weak spots before touching code). Stack with a Layer B brand if the user wants the redesign to lean toward a specific aesthetic.

Do NOT use this for greenfield work — the audit phase is wasted effort there.

### Step 4 — Is this an image-first workflow?

Triggers: "generate the design first then code it", "make a mockup before we build", "show me what it could look like" — AND, by default, any expressive greenfield brief (glossy / premium / wow / brand-grade) with no user-supplied reference.

**Action:** Load both:
- `image-to-code-skill.md` (the workflow: generate → analyze → implement)
- `imagegen-frontend-web.md` for web, or `imagegen-frontend-mobile.md` for mobile screens

For an expressive greenfield brief, default to generating **2-3 imagen concept drafts**, each prompt **seeded with the loaded Layer A + Layer B tokens** (palette, type, signature material) so the drafts inherit the reference's taste instead of generic priors. Pick the strongest, then treat the chosen draft as the reference-fidelity contract for `/visual-qa`.

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

**Action:** Add `stitch-skill.md` on top of whatever you loaded in Steps 1–4. For the shape of a finished export, see the worked example in `stitch-design-example.md`.

### Step 7 — The agent has been lazy

Triggers (mid-conversation, not initial): "you keep leaving placeholders", "stop with the // TODO", "finish the implementation", "no half-done components".

**Action:** Add `output-skill.md` on top of whatever is currently loaded. This stacks cleanly — it is purely about output completeness, not visual style.

### Step 8 — Is the screen an app shell, not a scroll-the-page site?

Triggers: dashboard, settings, mail/inbox, list-detail, command surface, split panes, fixed sidebar + scrolling body, admin console — or the user reports a layout that breaks when content gets long, empty, or unbroken (panel won't scroll, footer pushed off-screen, horizontal overflow on mobile).

**Action:** For operational product UI, pair `layout-skill.md` with the official design system selected through the `taste-skill.md` map. For a marketing app shell, add it to the selected style skill. It owns scroll behavior, spatial primitives, container routing, and content stress without choosing visual taste. Skip it for a document-scrolling marketing page.

## Stacking rules (read this once, internalize it)

1. **At most one Layer A *style* skill at a time.** A layout cannot be both `minimalist-skill` and `brutalist-skill` simultaneously — they encode opposite spacing and typography philosophies. Pick one.
2. **`taste-skill.md` and `gpt-tasteskill.md` are also style-skills** — do not stack them with `minimalist`, `brutalist`, or `soft`. They are alternative defaults at different intensity levels.
3. **`output-skill.md` and `stitch-skill.md` stack on top of any style skill.** They add discipline and output format, not visual direction.
4. **`redesign-skill.md` replaces a style-skill** when the task is auditing, not building. Stack a Layer B brand if the user wants a specific direction.
5. **`image-to-code-skill.md` pairs with one imagegen skill** for the full flow.
6. **Layer B (brand DESIGN.md) is orthogonal to Layer A.** You can pair any Layer A skill with any Layer B brand. Use Layer B as the source of color/type/component tokens; let Layer A drive the execution discipline.
7. **`layout-skill.md` owns app-shell, dashboard, and split-pane structure.** Pair operational product UI with its selected official design system; pair a marketing app shell with the applicable style skill. It owns spatial mechanics and scroll behavior, not visual direction.
8. **`composition-skill.md` stacks on top of any style skill** for eligible multi-section pages. It owns page sequence, dominant composition, nav/footer voice, route comparison, and proof inputs; the style skill still owns visual taste.

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
10. **No generic-default drift (expressive briefs).** The shipped CSS must use the `DESIGN.md` material, not the model's priors. Load the declared fonts (do not silently fall back to Inter or system fonts), build elevated surfaces from the declared multi-layer recipe (not a lone `backdrop-filter: blur`), and color from the ramp stops (not one tint at varied opacity). Grep your styles before QA: finding `Inter`, a single blur on "glass", or one brand hex reused everywhere means you regressed to priors — fix it before declaring done.

## Quick lookup table — most common requests

| User asks for... | Load these |
|---|---|
| "Build me a landing page" (no other info) | `composition-skill.md` + `_INDEX.md` shortlist, then exactly one Layer B reference + `taste-skill.md` |
| "Build me an Aside-style AI browser / agent page" | `aside.md` + `taste-skill.md` |
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
| "Build a dashboard / settings / inbox / app shell" | `taste-skill.md` **Brief to Design System Map**, then the selected official design system + `layout-skill.md` |
| "Panel won't scroll / footer pushed off-screen / mobile overflow" | Add `layout-skill.md` to current stack |

## Phase Final — Design QA (MANDATORY, runs after implementation)

Before declaring the task done, verify the rendered UI. **The verification authority is `/visual-qa`, not a hand-rolled checklist here.** Run `/visual-qa`: it captures every page and breakpoint (375 / 768 / 1280px) on fresh evidence, drives and inspects interaction states (hover/focus/active) and motion (transitions, scroll-triggered, load), runs the dual-oracle pass, and loops until an independent reviewer passes. For a concrete reference or clone, run it in reference-fidelity mode.

This skill adds only the design-taste judgments `/visual-qa` cannot make for you:

1. **Two kinds of failure count equally — fix both, then re-check.** Defects: clipping, wrong font, missing state, jank. Flatness: a surface that reads generic next to the loaded reference. When the render is bug-free but flat, you are NOT done — RAISE the design: deepen the material layering, give the color a real perceptual ramp (multiple stops / OKLCH, not one tint at varied opacity), render the hero focal object as real dimensional material (a generated bitmap, or real light/shadow/gradient/depth — never flat geometric primitives), and add the one signature moment. Patching only bugs while the surface stays at the floor is the single most common way this skill ships clean-but-generic work.
2. **Motion serves meaning; slop animation is forbidden.** Every interactive element must communicate its affordance and state changes — but a hover that changes nothing, motion on a non-interactive element, or a decorative micro-animation with no informational purpose is slop. Do not add it, and treat any you find as a defect. The hero may carry one signature moment; the rest of the surface earns motion only where it signals interaction or state.
3. **Structure and proof survive styling.** For an eligible page, the current Page Structure row, DOM order, dominant composition, nav/footer behavior, and responsive captures agree. Comparable routes do not become unexplained color-only variants, and every proof-shaped claim traces to an approved input.

Report "done" only when `/visual-qa` has passed on fresh evidence AND neither a visual bug nor a floor-level or slop-laden surface remains.


## Final notes

- The reference files are *long* and detailed (200–500 lines each). Loading two or three is fine; loading ten is wasteful and contradictory.
- After loading references, **state which files you loaded and why** in one short sentence so the user can sanity-check your routing.
- If the user pushes back on a routing decision ("no, I wanted minimal not soft"), **switch references**, don't argue.
- If unclear after reading the request twice, **ask one focused question** before loading anything: "Are you going for [X] or [Y]?" — better than wasting context on the wrong reference.
