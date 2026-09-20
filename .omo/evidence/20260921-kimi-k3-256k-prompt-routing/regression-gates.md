# Regression gates for OMO #8469

Date: 2026-09-21

## Required gates

| Gate | Result | Observation |
|---|---|---|
| Targeted detector and routing tests | PASS | Bun 1.4.2: 111 passed, 0 failed, 324 assertions across six files. |
| Repository typecheck | PASS | `bun run typecheck` completed successfully for the root, scripts, and package projects. |
| Repository build | PASS | `bun run build` completed with `build: all steps completed`. A workspace-local Bun executable was used so nested Windows build steps could resolve `bun.exe`. |
| Real OpenCode HTTP QA | PASS | OpenCode 1.14.31: 79 assertions passed, 0 failed across target K3, known K3, K2.7, and unrelated control scenarios. |
| Diff whitespace validation | PASS | `git diff --check` exited successfully. |

Targeted test command:

```text
bun test --timeout 20000 packages/model-core/src/model-family-detectors.test.ts packages/prompts-core/src/variant-resolver.test.ts packages/omo-opencode/src/agents/sisyphus-agent-factory.test.ts packages/omo-opencode/src/agents/sisyphus-junior/index.test.ts packages/omo-opencode/src/agents/atlas/prompt-routing.test.ts packages/omo-opencode/src/agents/metis.test.ts
```

The live OpenCode run and isolation proof are documented in `live-opencode/EVIDENCE.md`. Its transcript, classifications, process receipts, and cleanup receipts all come from the same successful execution.

## Non-gating repository-wide observation

A raw, unsharded `bun test --timeout 20000` run was stopped after approximately 40 minutes because it is not the repository's supported Windows CI layout and had already produced environment-specific failures unrelated to this patch. Examples included missing Unix utilities, Git Bash path translation, host-directory marker leakage into temporary-directory tests, duplicate TUI module identities, and a 240-second Senpi chaos-benchmark timeout. The changed detector and routing surfaces passed both their dedicated final run and the corresponding portions reached by that exploratory run.

The supported targeted, typecheck, build, and real-harness gates above are the release evidence for this change. GitHub CI remains the authoritative repository-wide matrix.
