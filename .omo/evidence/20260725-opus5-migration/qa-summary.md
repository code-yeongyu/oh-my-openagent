# Opus 5 migration QA evidence

## What was tested

- `bun test script/opus5-model-recommendation-audit.test.ts`
  - Proves user-facing README, guide, JSONC example, model requirement, and website locale recommendations contain no Opus 4.6 or 4.8 recommendation.
- `bun test packages/model-core/src/model-requirements-agents.test.ts packages/model-core/src/model-requirements-categories.test.ts`
  - Proves Metis resolves to Opus 5 high then Kimi K3 low and Prometheus resolves to Fable 5 xhigh then Kimi K3 max.
- `bun run typecheck`
  - Verifies TypeScript across root, scripts, and packages.
- `cd packages/web && bun run type-check && bun run build`
  - Verifies the website build surface.
- Headless Playwright against the built site at `/en`
  - Observed `Claude Opus 5 High` and `Claude Fable 5 XHigh` in rendered content.
- `bun test --reporter=dot`
  - Final full repository gate.

## What was observed

- The stale-recommendation audit was captured RED before the migration, then GREEN after it: 1 pass, 0 fail.
- Focused role and capability contracts passed after migration.
- Final full gate: 12,151 pass, 3 skip, 0 fail across 1,555 files.
- The built English website page exposed both migrated model labels.

## Why this is enough

The audit protects the user-facing recommendation surface. The model-core tests protect exact Metis and Prometheus selection order and variants. Typecheck, website build, browserless render verification, and the full suite cover integration and packaged behavior.

## What was omitted

Raw environment dumps, provider credentials, and generated logs are omitted. Temporary local web servers used for browserless QA were terminated after verification.
