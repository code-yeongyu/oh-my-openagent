# web/components — Feature UI

## OVERVIEW

Feature-first React components for the marketing site, with direct imports and no barrel convention; score 14, high component and symbol density.

## STRUCTURE

- `landing/` — hero, live stats, DAG workflow, 3D graph, sections, and install CTA.
- `docs/` — generated-doc shell, sidebar, navigation, and table wrapping.
- `manifesto/` — manifesto sections; `ledger/` — ruled layout primitives.
- `ui/` — existing shadcn-style primitives; top-level files cover navigation, footer, and icons.

## WHERE TO LOOK

| Task                     | Location           | Notes                                                                     |
| ------------------------ | ------------------ | ------------------------------------------------------------------------- |
| Change DAG behavior      | `landing/dag/`     | Layout, state transitions, camera, edges, and node cards are coupled.     |
| Change graph rendering   | `landing/graph/`   | Keep lazy loading, poster fallback, and reduced-motion gates intact.      |
| Change docs UI           | `docs/`            | Generated content is consumed here; edit source docs/scripts, not output. |
| Add a reusable primitive | `ui/` or `ledger/` | Follow the design contract before adding a new visual pattern.            |
| Change locale copy       | `../messages/`     | Keep all four catalogs structurally aligned.                              |

## CONVENTIONS

- Import feature files directly; do not create an index barrel for convenience.
- Prefer named exports and readonly props; `GraphScene` is the intentional default-export exception.
- Compose Tailwind classes through `lib/utils.ts` and use semantic design tokens from `DESIGN.md`.
- Animation must honor reduced motion and should express a state or affordance, not decoration.

## ANTI-PATTERNS

- Do not edit generated docs output or generated OG font output directly.
- Do not add `framer-motion`, GSAP, Lottie, serif typography, or floating bordered cards with shadows.
- Do not duplicate locale strings in JSX or introduce a new color system outside `DESIGN.md`.
- Do not import the `@react-three/drei` barrel; the graph budget depends on per-module imports.
