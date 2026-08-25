# Parallelism v3 QA evidence

- Surface: `bun test packages/omo-senpi/src/components/telemetry`
- Result: 191 tests passed in one run, including multi-wave prefix accumulation, eval-cell attribution, zero-prefix behavior, schema v3 emission, allowlist, and generated schema checks.
- Surface: `node packages/omo-senpi/plugin/scripts/build-extension.mjs --check`
- Result: all tracked Senpi extension artifacts current.
- Surface: `bun run typecheck`
- Result: completed successfully, including `packages/omo-senpi/tsconfig.json`.
