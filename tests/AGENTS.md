# tests/ - Repository-Level Integration Tests

## OVERVIEW

Cross-package invariants and standalone black-box fixtures that do not belong to one package's co-located unit suite.

## STRUCTURE

```
tests/
├── omo-config-category-drift.test.ts  # Config/category contract stays synchronized
├── omo-schema-freshness.test.ts       # Generated omo.schema.json matches source
└── hashline/                          # Standalone headless Hashline exercise package
    ├── package.json
    ├── bun.lock
    ├── headless.ts
    └── test-*.ts
```

## TEST SURFACES

| Surface | Command | Purpose |
|---------|---------|---------|
| Root invariants | `bun test tests/omo-config-category-drift.test.ts tests/omo-schema-freshness.test.ts` | Fast cross-package contract checks |
| Full root suite | `bun test` | Includes these tests through root `bunfig.toml` |
| Hashline fixture | Run commands from `tests/hashline/package.json` | Exercises edit operations and multi-model behavior outside adapter internals |

## CONVENTIONS

- Keep package-specific tests beside package source; use this directory only for real cross-package or standalone-fixture boundaries.
- Treat `tests/hashline/` as its own Bun package. Preserve its lockfile and headless entry rather than importing it into the root test preload.
- Freshness tests compare generated artifacts to source-derived output; regenerate the artifact instead of changing the expected value manually.
- Pure prose changes do not get phrase-pin tests. Test machine-consumed schemas, registration, or runtime behavior.

## ANTI-PATTERNS

- Do not turn `tests/` into a second home for ordinary package unit tests.
- Do not remove, skip, or isolate a failing cross-package invariant to make the root suite green.
- Do not expand synthetic AGENTS.md benchmark fixtures under `packages/omo-opencode/src/__tests__/perf/fixtures/`; they are intentionally minimal test data.
