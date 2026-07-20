# PR #5747 snapshot safety QA — 2026-07-20

## What changed

- Bound rendered snapshot fields by UTF-8 byte length so multibyte CJK/emoji input cannot consume the 32 KiB snapshot budget and remove required tail sections.
- Treat `BEGIN TRANSCRIPT` / `END TRANSCRIPT` delimiters case-insensitively in both writer redaction and continuation-reader rejection.

## What was tested

```text
node node_modules/.bun/vitest@4.1.10+91dafe736c534b74/node_modules/vitest/vitest.mjs --run packages/omo-codex/plugin/components/ulw-loop/test/snapshot.test.ts packages/omo-codex/plugin/components/ulw-loop/test/snapshot-redaction.test.ts
```

Observed: 2 files / 9 tests passed. The CJK/emoji regression asserts output stays within 32 KiB while `## Next Action` and `## Safety Notes` remain present. The redaction regression covers mixed-case and lowercase transcript delimiters.

```text
OMO_QA_SANDBOX_ROOT=D:/Vibe Project/Contribute/oh-my-openagent-5747/.qa-sandbox/start-work-continuation node node_modules/.bun/vitest@4.1.10+91dafe736c534b74/node_modules/vitest/vitest.mjs --run packages/omo-codex/plugin/components/start-work-continuation/test/ulw-snapshot-reader.test.ts
```

Observed: 1 file / 47 tests passed. The reader rejects the mixed-case and lowercase unsafe snapshot fixtures. Temporary test roots stayed under the fixed QA sandbox; no cleanup/deletion was run.

## Static validation

LSP error diagnostics were clear for `snapshot-renderer.ts`, `snapshot-redaction.ts`, and `ulw-snapshot-reader.ts`. `git diff --check` was also clear.

## Omitted live Codex QA

The repository `codex-qa` live scripts automatically remove their isolated temporary `CODEX_HOME` on exit. They were not run because this task's active deletion constraint does not authorize that cleanup. Focused component tests and static diagnostics above cover the changed producer/consumer behavior without touching the real user Codex home.
