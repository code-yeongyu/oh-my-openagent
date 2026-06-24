---
name: frontend
description: "MUST USE for ANY frontend, web UI, UX, or visual work — building, styling, or redesigning pages/components, React project setup, performance audits, design QA. Routes four rulesets: design (anti-slop taste router over 12 taste skills + 69 brand DESIGN.md refs — Apple, Stripe, Linear, Notion, Vercel, Claude, Nike — plus React dev tooling gate: react-grab, react-scan, react-doctor), perfection (Lighthouse 100 in every category via real Playwright Chromium audits, NEVER the lighthouse CLI, never by weakening UX), ui-ux-db (searchable 50+ styles, 97 palettes, 57 font pairings, 99 UX guidelines), designpowers (design operating layer, personas, accessibility, critique, debt, handoff, and role-reference guidance). Triggers: frontend, UI, UX, design, redesign, styling, layout, animation, motion, taste, premium, luxury, minimal, brutalist, Awwwards, anti-slop, polish, DESIGN.md, mockup, react setup, react-scan, react-doctor, lighthouse, performance, Core Web Vitals, LCP, CLS, INP, SEO, accessibility, a11y, WCAG, audit my site, make this faster, color palette, font pairing, looks generic, make it pretty, like X brand."
---

# Frontend

This file is a router, not a rulebook. The rules live in four rulesets under `references/`; your first job is to load the smallest set of files that covers the request, state which you loaded in one sentence, then execute under their guidance. Loading nothing and freestyling produces the generic AI-slop output this skill exists to prevent; loading everything wastes context and creates contradictory instructions.

**The bar is not clean-and-correct — it is work a senior designer at Linear, Stripe, or Supabase would ship.** Correct-but-flat is a failure, not a finish. Protect the surface as hard as you protect the build: design is a first-class deliverable, not a one-shot decision you lock and walk away from.

## Phase 0 — Route (before any UI work)

| Request involves… | Read |
|---|---|
| ANY UI implementation, styling, redesign, mockup, or visual decision | `references/design/README.md` FIRST. It enforces two mandatory gates — the Design System Gate (a `DESIGN.md` must exist before any component is written) and the React Dev Tooling Gate (react-grab / react-scan / react-doctor installed by default) — then routes to the taste and brand references below. |
| Writing or modifying frontend code, OR auditing performance / SEO / accessibility / quality | ALSO `references/perfection/README.md`. Lighthouse 100 in every category, measured on real Playwright Chromium (never the `lighthouse` CLI), achieved through architecture — never by dropping animations or hiding content. |
| Looking up a concrete style, color palette, font pairing, chart type, landing-page structure, or UX guideline — or generating a project design system from keywords | `references/ui-ux-db/README.md`. A searchable CSV database with a CLI; a lookup tool, not a posture. Load on demand; `design` stays the source of truth for taste and the `DESIGN.md` contract. |
| Design operating-layer work: personas, cognitive accessibility, design critique, design debt, handoff, synthetic user testing, or designpowers-style guidance | `references/designpowers/README.md`. This is an internal frontend ruleset, not a separate skill. It enriches `/frontend` routing with design brief, role-reference, accessibility, evidence, and debt language while preserving the `design` and `perfection` gates. |

**For implementation work, design + perfection load together.** A page that hits Lighthouse 100 but looks like AI slop has failed; a page that looks beautiful but ships a 2 MB bundle has failed. Both win or neither does.

## Design System and Component Workflow

Every implementation must choose one of these branches before UI code changes:

1. **Greenfield or fresh setup:** if the user gave no concrete visual reference, use `references/design/_INDEX.md` to shortlist 2-3 plausible Layer B references, then deeply load exactly one Layer A style skill and one Layer B brand/design-system reference; use `open-design` only when the curated set has no fit. Treat those references as source material, not mood labels: extract tokens, layout grammar, component anatomy, interaction states, motion, and taste decisions into `DESIGN.md`, then recombine them into project-specific primitives. Customize for the user's product and content, but do not freestyle past the selected references; never copy logos, trademarked assets, or brand-specific copy. Define Section 5 primitives with variants, default/hover/active/focus/disabled/loading/empty/error states, accessibility, and motion before code. Build them first in a component showcase or state harness; each primitive and required state must pass mobile/tablet/desktop visual QA before product screens.
2. **Existing project with `DESIGN.md` or a component system:** read it, follow it, and update it before implementation only when the requested work needs a new token, primitive, state, motion rule, accessibility constraint, or accepted debt.
3. **Existing project with UI but no `DESIGN.md` and no reusable component layer:** STOP and ask the user one focused question: should you preserve the current look with copy-nearby styling, or extract a real `DESIGN.md` plus reusable components before continuing? Do not silently choose.

When `references/designpowers/README.md` is loaded for implementation, redesign, or design-system work, feed its personas, accessibility, critique, debt, handoff, and role-reference guidance into the branch above. The resulting `DESIGN.md` is the implementation contract: tokens, typography, spacing, primitives, motion, responsive behavior, accessibility constraints, and accepted debt must be named there before code uses them. Verify component primitives, states, and final screens with real visual QA evidence; pass design-system decisions, implementation evidence, and unresolved debt into `/review-work` for significant implementation work.

## Ruleset 1 — design (`references/design/`)

The reference library has one architecture file, 12 taste skills (Layer A — *how to execute*), and 69 brand design systems (Layer B — *what it should look like*). Most non-trivial tasks load **one Layer A + one Layer B**. `README.md` carries the full routing flow, stacking rules, anti-patterns, and the mandatory browser-based Design QA phase; `_INDEX.md` catalogs all 81 files with mood-to-brand mappings — read it whenever routing is not obvious from the tables below.

### Layer 0 — architecture

| File | Read when |
|---|---|
| `design-system-architecture.md` | The project has no `DESIGN.md` (defines the 7-section structure you must create first), or you are extracting a design system from existing UI code. |

### Layer A — taste skills (pick AT MOST ONE style skill; they encode opposing philosophies)

| File | Read when the user says… |
|---|---|
| `taste-skill.md` | Neutral or operational UI with no surface ambition — internal tools, dashboards, "just make it usable". The safe default; do NOT settle here when the brief signals glossy / premium / startup-grade craft. |
| `gpt-tasteskill.md` | "Awwwards-tier", "wow factor", "cinematic", "scroll-triggered" marketing/landing experiences. |
| `minimalist-skill.md` | "minimal", "clean", "Notion-like", "Linear-like", "editorial". |
| `brutalist-skill.md` | "brutalist", "raw", "Swiss", "experimental", "anti-design". |
| `soft-skill.md` | "premium", "luxury", "calm", "expensive", "elegant", AND glossy / glassy / liquid-glass / startup-grade product surfaces — pair with a high-craft Layer B (`supabase`, `linear.app`, `vercel`, `stripe`). |
| `redesign-skill.md` | Improving EXISTING UI — "this looks bad", "fix the design". Audit-first workflow; never use on greenfield. |
| `image-to-code-skill.md` | "Generate the design first, then code it." Pair with one imagegen file below. |
| `output-skill.md` | Stacks on any style skill when output is incomplete — placeholders, `// TODO`, half-done components. |
| `stitch-skill.md` | Stacks on any style skill for Google Stitch compatibility or a `DESIGN.md` doc export. |
| `imagegen-frontend-web.md` / `imagegen-frontend-mobile.md` / `imagegen-brandkit.md` | Image-only output (mockup, app-screen concepts, brand board). These NEVER write code — switch to `image-to-code-skill.md` if code is wanted. |

### Layer B — brand design systems (orthogonal to Layer A; stack freely)

When the user names a brand or site — "Linear-style", "like Stripe's landing" — load `references/design/<brand>.md` as the token source of truth (palette, type scale, components, do/don'ts). Coverage includes `apple` `stripe` `linear.app` `notion` `vercel` `claude` `figma` `airbnb` `nike` `tesla` `spotify` `raycast` `revolut` and ~56 more; the full list with mood shortcuts is in `_INDEX.md`. Extract the tokens and apply them to the project's own content — never copy logos or trademarked imagery. If the named brand is missing, fall back to a Layer A mood match or the `open-design` skill.

### React dev tooling

| File | Read when |
|---|---|
| `react-dev-tooling-skill.md` | A React project lacks react-grab / react-scan / react-doctor, or you need per-framework install snippets and the dev-only gating pattern (`NODE_ENV === 'development'`). |

## Ruleset 2 — perfection (`references/perfection/`)

| File | Read when |
|---|---|
| `README.md` | Any frontend code is written or audited. Carries the seven tenets: real-browser audits only, 100-in-every-category floor, fix-at-the-architecture, never weaken UX for points, design-system compliance checks, and the response format for audit reports. |
| `react-perf-tooling.md` | Before ANY React audit. The Playwright + `playwright-lighthouse` + `react-scan/lite` injection recipe, per-route render budgets, and the React-specific root-cause checklist. Lighthouse 100 with 30+ unnecessary renders is NOT done. |

Audit CLI (build for production first; never measure a dev server):

```bash
uv run $SKILL_DIR/scripts/perfection/lighthouse-audit.py https://localhost:3000
```

Run mobile AND desktop presets, 3–5 runs, take the median, diagnose from the JSON report.

## Ruleset 3 — ui-ux-db (`references/ui-ux-db/`)

`README.md` documents the search CLI and the master-plus-overrides persistence pattern. The CLI (run from the ruleset directory so it finds `data/`):

```bash
python3 $SKILL_DIR/references/ui-ux-db/scripts/search.py "<query>" --design-system -p "Project"   # full design-system generation
python3 $SKILL_DIR/references/ui-ux-db/scripts/search.py "<query>" --domain <domain>             # targeted lookup
python3 $SKILL_DIR/references/ui-ux-db/scripts/search.py "<query>" --stack <stack>               # stack best practices
```

Domains: `product` `style` `typography` `color` `landing` `chart` `ux` `react` `web` `prompt`. Stacks: `html-tailwind` (default) `react` `nextjs` `vue` `svelte` `astro` `swiftui` `react-native` `flutter` `shadcn` `jetpack-compose`.

## Ruleset 4 — designpowers (`references/designpowers/`)

`README.md` routes design operating-layer guidance from the pinned `Owl-Listener/designpowers` reference corpus into the existing frontend workflow. Load it when a frontend task needs explicit personas, accessibility and cognitive constraints, design critique, design debt, handoff, synthetic user testing, motion guidance, or role-reference prompts. It does not replace this frontend skill, `/visual-qa`, `/ulw-plan`, `/start-work`, or `/review-work`; it supplies richer design context that must first be distilled into the project `DESIGN.md`, then used as the design-system contract for implementation and verification.

## Quick routes — most common requests

| Request | Load |
|---|---|
| "Build a landing page" (no direction given) | `design/README.md` + `design/_INDEX.md` shortlist → exactly one Layer B reference + `design/taste-skill.md` + `perfection/README.md` |
| "Linear-style landing page" | `design/README.md` + `design/linear.app.md` + `design/taste-skill.md` + `perfection/README.md` |
| "Premium SaaS hero like Stripe" | `design/README.md` + `design/stripe.md` + `design/soft-skill.md` + `perfection/README.md` |
| "Improve this existing dashboard" | `design/README.md` + `design/redesign-skill.md` + `perfection/README.md` |
| "Audit my site" / "make this page faster" | `perfection/README.md` (+ `perfection/react-perf-tooling.md` if React) |
| "Mockup image of a fintech app" — no code | `design/imagegen-frontend-mobile.md` (+ a Layer B brand if named) |
| "What palette/fonts fit a wellness brand?" | `ui-ux-db/README.md` → search CLI |
| "Set up this React project" | `design/README.md` + `design/react-dev-tooling-skill.md` |
| "Use designpowers", "make the design workflow stronger", "add personas/accessibility/debt/handoff" | `design/README.md` + `designpowers/README.md` (+ `perfection/README.md` if implementation or audit follows) |

## Shared axioms (all four rulesets agree — apply always)

- **No design system = no UI work.** `DESIGN.md` exists before components do; every color, font size, and spacing value traces back to a token in it.
- **Never weaken UX OR flatten the surface to buy points.** No dropping animations, hiding content, simplifying interactions, or replacing rendered/lit material with flat fills and flat geometric primitives for a Lighthouse score or a deadline. Hit 100 AND keep the surface dimensional — both, or neither.
- **No emojis as icons.** SVG icon sets only (Lucide, Heroicons, Radix, Phosphor).
- **GPU-composited animation only** — `transform`, `opacity`, `filter`; never animate layout properties.
- **Verify in a real browser before declaring done.** Screenshots at 375 / 768 / 1280px; hover, focus, loading, empty, and error states all exercised.

## When to load something else instead

| Situation | Load |
|---|---|
| Brand/style not among the 69 in `references/design/`, or the user says "Open Design" | `open-design` skill — the local nexu-io/open-design library (137+ design skills, 150+ design systems) |
| Driving a browser for the Design QA phase | `agent-browser` skill |
| Pure TypeScript/logic work with zero visual surface | `programming` skill alone — this skill adds nothing there |

## Activation

Use for any frontend, web UI, UX, visual, design, styling, layout, animation, performance, accessibility, or SEO work — building, redesigning, auditing, or generating mockups. Not for backend, CLI, or pure-logic tasks with no visual surface.
