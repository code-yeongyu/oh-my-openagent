# GPT context metadata QA

## What was tested

- `bun test packages/model-core/src/model-capabilities.test.ts`
- `node packages/omo-senpi/scripts/qa/drive.mjs --self-test`
- `tsgo --noEmit -p packages/omo-senpi/tsconfig.json`
- `bun run test:senpi`
- Direct JSON validation for `gpt-5.6-sol`, `gpt-5.6-terra`, and `gpt-5.6`.

## What was observed

- Focused model capability tests: 22 passed, 0 failed.
- Senpi driver self-test: `SELF-TEST OK`.
- Senpi TypeScript check completed successfully.
- Senpi package gate: 2,274 passed, 1 skipped, 0 failed.
- Generated model snapshot resolves the three GPT-5.6 entries to `1,050,000` context tokens.
- The real Senpi live-session driver was not run because this metadata-only change does not alter adapter wiring; the required isolated driver self-test passed.

## Why this is enough

The changed source is model metadata and the regression test exercises the bundled snapshot merge, including the supplemental override that protects the authoritative 1M values from stale generated entries. The Senpi package gate and TypeScript check cover downstream adapter compatibility.

## What was omitted

No credentials, auth headers, environment dumps, or live provider requests were captured. No production session or real `~/.senpi/agent` directory was used.
