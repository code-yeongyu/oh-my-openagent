# Web Design-System Fidelity Evidence

Date: 2026-06-24

Worktree: `/Users/yeongyu/local-workspaces/omo-wt/design-system-fidelity`

## Scope

- Refreshed `packages/web/DESIGN.md` as the current rendered UI contract.
- Extracted the existing global stylesheet into `packages/web/app/styles/design-system.css`.
- Converted `packages/web/app/globals.css` into a filesystem alias for the design-system entry.
- Preserved current UI copy, routes, component behavior, and visual language.

## Visual QA

Baseline evidence:

- `.omo/ultrawork/design-system-fidelity/evidence/baseline/baseline-capture.json`
- `.omo/ultrawork/design-system-fidelity/evidence/baseline/screenshots/`

Control comparison used a fresh `origin/dev` worktree on port 3109 and the current branch on port 3108:

- Control capture: `.omo/ultrawork/design-system-fidelity/evidence/base-control/after-capture.json`
- Current capture/diffs: `.omo/ultrawork/design-system-fidelity/evidence/after-control/after-capture.json`

Results:

| Route | Viewport | Diff pixels | Overflow delta |
| --- | --- | ---: | ---: |
| `/` | 1280x800 | 0 | 0 |
| `/` | 390x844 | 0 | 0 |
| `/docs` | 1280x800 | 34,654 on a 1280x151508 full-page capture | 0 |
| `/docs` | 390x844 | 0 | 538, unchanged from baseline |
| `/manifesto` | 1280x800 | 0 | 0 |
| `/manifesto` | 390x844 | 0 | 0 |

All captured routes had zero console warnings/errors and zero page errors. The `/docs` mobile overflow delta of 538 is pre-existing and intentionally not changed in this extraction.

Dynamic landing stats are normalized in the visual QA script before screenshots because the server-rendered hero subtitle includes build-time GitHub/download counts. The live client stats are separately covered by e2e tests.

## Manual Behavior QA

Script: `.omo/ultrawork/design-system-fidelity/scripts/behavior-scenarios.mjs`

Result: 7 passed, 0 failed.

Covered:

- Landing mobile menu opens and exposes Docs/Manifesto links.
- Landing desktop Docs navigation works.
- Landing desktop Manifesto navigation works.
- Docs mobile sidebar toggle works.
- Docs search filters to the Agent section.
- Docs section/hash navigation reaches Installation.
- `/ko/docs` localized wrapper remains visible with `data-locale="ko"` and `lang="ko"`.

## Automated Gates

- `bun run format:check`: pass.
- `bun run lint`: pass.
- `bun run type-check`: pass.
- `bun run build`: pass.
- `bun --bun playwright test --config=playwright.3110.config.ts`: pass, 66/66.

Note: the package's default Playwright config reuses `127.0.0.1:3000` locally. That port was already occupied by an unrelated Node server, so the first `bun run test:e2e` attempt hit the wrong app (`Sionic AI` / `STORM Console`). The verified run used a temporary in-package config on port 3110 to avoid touching the unrelated process.

## Lighthouse

Evidence: `.omo/ultrawork/design-system-fidelity/evidence/after/lighthouse/`

| Route | Performance | Accessibility | Best Practices | SEO |
| --- | ---: | ---: | ---: | ---: |
| `/` | 0.95 | 1.00 | 1.00 | 0.92 |
| `/docs` | 0.88 | 0.96 | 1.00 | 0.91 |
| `/manifesto` | 0.94 | 0.96 | 1.00 | 0.92 |
