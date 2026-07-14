# scripts/ - Root Node Helpers

## OVERVIEW

Small Node ESM helpers that are intentionally separate from the primary Bun/TypeScript automation in singular `script/`.

## WHERE TO LOOK

| File | Purpose |
|------|---------|
| `check-third-party-notices.mjs` | Validate third-party notice coverage for source and shipped payloads |
| `third-party-notice-requirements.mjs` | Declarative notice requirements and path/package matching |
| `check-third-party-notices.test.mjs` | Node test coverage for spawn invocation resolution on Windows and non-Windows |

## COMMANDS

```bash
node --test scripts/check-third-party-notices.test.mjs
node scripts/check-third-party-notices.mjs
node scripts/check-third-party-notices.mjs --ship
```

`bun run test:codex` invokes the `--ship` check after building the Codex payload. Release workflows also rely on this surface before publication.

The checker test covers only spawn invocation resolution on Windows and non-Windows; it does not cover notice discovery or failure cases. The default checker command is not a claim that the checker currently passes.

## CONVENTIONS

- Keep these files plain Node ESM; they run in packaging and compatibility flows that should not depend on Bun APIs.
- Put general build, release, QA, and repository-invariant automation in `script/`, not here.
- Add notice requirements declaratively in `third-party-notice-requirements.mjs`; keep traversal and reporting in the checker.
- Error output must identify the missing requirement or unexpected shipped path without exposing credentials or environment dumps.

## ANTI-PATTERNS

- Do not move these helpers into `script/` without updating package scripts, CI, and published-path assumptions.
- Do not skip the `--ship` mode when changing the Codex or npm payload.
- Do not duplicate third-party package rules inside tests; test the exported requirement table.
