# tests/ - Repository-Level Integration Tests

## OVERVIEW

Cross-package invariants and integration fixtures that do not belong to one package's co-located unit suite.

## STRUCTURE

```
tests/
├── omo-config-category-drift.test.ts  # Config/category contract stays synchronized
├── omo-schema-freshness.test.ts       # Generated omo.schema.json matches source
└── hashline/                          # Standalone headless Hashline exercise package
    ├── package.json
    ├── bun.lock
    ├── headless.ts
    ├── test-environment.ts   # Required env parser (HTTP/HTTPS URL, non-blank key)
    └── test-*.ts
```

## TEST SURFACES

| Surface | Command | Purpose |
|---------|---------|---------|
| Root invariants | `bun test tests/omo-config-category-drift.test.ts tests/omo-schema-freshness.test.ts` | Fast cross-package contract checks |
| Full root suite | `bun test` | Includes these tests through root `bunfig.toml` |
| Hashline fixture | Run from a disposable full-repository copy inside a filesystem-isolated VM/container | Exercises edit operations and multi-model behavior through adapter-internal imports; makes live network/model calls, and may write model-selected paths relative to cwd |

## CONVENTIONS

- Keep package-specific tests beside package source; use this directory only for real cross-package or standalone-fixture boundaries.
- Treat `tests/hashline/` as its own Bun package. Preserve its lockfile and headless entry rather than importing it into the root test preload.
- The Hashline fixture imports adapter-internal `../../packages/...` paths, performs live network/model calls, and may write model-selected paths relative to cwd. Run it only from a disposable full-repository copy inside a filesystem-isolated VM or container with no sensitive parent files and never from the primary checkout or an active worktree.
- In that sandbox, set explicit short-lived, least-privilege test-only values for `HASHLINE_TEST_BASE_URL` and `HASHLINE_TEST_API_KEY`. `test-environment.ts` requires and validates them (HTTP/HTTPS URL, non-blank key); `headless.ts` throws without them and no longer falls back to hardcoded defaults. Use a non-production endpoint and never use production or personal credentials.
- Keep generated files and raw stdout/stderr inside the disposable sandbox or local redacted evidence directory. Redact before sharing and never publish raw logs.
- Freshness tests compare generated artifacts to source-derived output; regenerate the artifact instead of changing the expected value manually.
- Pure prose changes do not get phrase-pin tests. Test machine-consumed schemas, registration, or runtime behavior.

## ANTI-PATTERNS

- Do not turn `tests/` into a second home for ordinary package unit tests.
- Do not remove, skip, or isolate a failing cross-package invariant to make the root suite green.
- The synthetic AGENTS.md benchmark fixture under `packages/omo-opencode/src/__tests__/perf/fixtures/` is governed by its own local guide; this guide only cross-references it and does not govern its contents.
