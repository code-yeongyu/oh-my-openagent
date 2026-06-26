# Frontend Design State — Design System Fidelity

## Current Objective

Set up the web design-system source of truth without changing the current rendered product. This PR treats the existing `/`, `/docs`, and `/manifesto` surfaces as the visual contract, then extracts the existing global CSS layers into `packages/web/app/styles/design-system.css`.

## Locked Decisions

- Preserve current copy, routes, layout, visual styling, and interactions.
- Use `packages/web/DESIGN.md` as the implementation contract before and during code changes.
- Keep `packages/web/app/globals.css` as a filesystem alias to the design-system entry.
- Keep the Tailwind entrypoint, theme mappings, root tokens, base styles, utilities, docs prose styles, and motion primitives in `packages/web/app/styles/design-system.css`.
- Do not fix the known `/docs` mobile overflow in this extraction PR; only verify it does not worsen.

## Source Inputs

- `packages/web/DESIGN.md`
- `packages/web/app/globals.css`
- `packages/web/app/_components/landing-page.tsx`
- `packages/web/components/docs/docs-shell.tsx`
- `packages/web/components/nav-header.tsx`
- Baseline evidence: `.omo/ultrawork/design-system-fidelity/evidence/baseline/`
- Restart plan: `.omo/plans/design-system-fidelity-restart.md`

## Design Brief

The product should continue to feel like a dark terminal command center: near-black surfaces, cyan interactive punctuation, restrained borders, Geist Sans and Geist Mono, dense but readable docs, and CSS-only motion that respects reduced-motion preferences.

This is not a visual redesign. Any future changes to accent consolidation, typography rhythm, landing-page decomposition, dynamic OG image, or motion choreography must happen in a separate visual-refinement PR with new before/after evidence.

## Inclusive Personas

- Terminal power user: scans commands and docs quickly, often with keyboard navigation.
- Mobile evaluator: verifies the project from a narrow phone viewport before installing.
- CJK reader: needs Korean/Japanese/Chinese headings and body text to wrap without clipped glyphs.
- Motion-sensitive user: requires reduced-motion preferences to be honored.

## Adaptive Preferences

- Preserve `prefers-reduced-motion` handling for hero/background/reveal motion.
- Preserve visible focus rings and current mobile touch target sizing.
- Preserve dark color scheme and current contrast ratios.
- Preserve locale-aware CJK heading/body wrapping rules.
- Preserve the current localized shell structure: root `<html lang="en">` with per-locale wrapper `lang` and `data-locale`.

## Verification Matrix

| Scenario | Surface | Pass Criteria |
| --- | --- | --- |
| Landing fidelity | `/` at 1280x800 and 390x844 | Visual diff is zero or near-zero; console/page errors are zero; overflow remains zero |
| Docs fidelity | `/docs` at 1280x800 and 390x844 | Visual diff is zero or near-zero; console/page errors are zero; desktop overflow remains zero; mobile overflow does not exceed baseline delta 538 |
| Manifesto fidelity | `/manifesto` at 1280x800 and 390x844 | Visual diff is zero or near-zero; console/page errors are zero; overflow remains zero |
| Landing behavior | `/` mobile and desktop | Mobile menu opens/closes; Docs and Manifesto links navigate |
| Docs behavior | `/docs` mobile and desktop | Mobile sidebar toggles; search filters; section/hash navigation reaches targets |
| Regression gates | `packages/web` | format, lint, type-check, build, and Playwright e2e pass or any pre-existing blocker is logged with evidence |

## Design Debt Register

- `/docs` at 390x844 has pre-existing horizontal overflow (`scrollWidth - innerWidth = 538`) in the baseline. This PR must not worsen it.
- Landing sections currently use many decorative accent colors. This remains intentionally unchanged for pixel fidelity; `DESIGN.md` records it as future refinement debt.
- Existing JSX still contains raw hex/arbitrary color utilities in rendered surfaces. This extraction preserves them to avoid visual churn; future visual-refinement PRs should replace them with design-system tokens.
- `landing-page.tsx` remains a large page composition file. This PR does not decompose it because component edits would increase fidelity risk.

## Evidence Index

- Baseline JSON: `.omo/ultrawork/design-system-fidelity/evidence/baseline/baseline-capture.json`
- Baseline screenshots: `.omo/ultrawork/design-system-fidelity/evidence/baseline/screenshots/`
- After-change evidence will be written under `.omo/ultrawork/design-system-fidelity/evidence/after/`.
