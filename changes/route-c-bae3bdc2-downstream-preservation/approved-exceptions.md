# Approved Exceptions Draft (R0.4)

This draft enumerates all `PROPOSED_DROP` entries from `required-patches.md` / `required-paths.md`.
Each row includes explicit rationale and evidence pointers.

| Exception ID | Path | Status | Rationale | Evidence |
|---|---|---|---|---|
| EX-001 | `.gitignore` | `PROPOSED_DROP` | Documentation/repo-hygiene path outside runtime preservation scope for Route C. | `RP-001`, `PATH-001` |
| EX-002 | `src/cli/doctor/checks/version.test.ts` | `PROPOSED_DROP` | Test-only delta. Keep runtime parity via implementation-path adjudication; no standalone runtime value. | `RP-005`, `PATH-005` |
| EX-003 | `src/features/builtin-skills/skills.test.ts` | `PROPOSED_DROP` | Test-only delta. Runtime behavior controlled by `src/features/builtin-skills/skills.ts`. | `RP-015`, `PATH-015` |
| EX-004 | `src/hooks/atlas/index.test.ts` | `PROPOSED_DROP` | Test-only delta. Atlas runtime preservation is covered by non-test atlas hook files. | `RP-022`, `PATH-022` |
| EX-005 | `src/hooks/auto-slash-command/index.test.ts` | `PROPOSED_DROP` | Test-only delta. Runtime scope preserved through hook implementation paths. | `RP-026`, `PATH-026` |
| EX-006 | `src/hooks/compaction-context-injector/index.test.ts` | `PROPOSED_DROP` | Test-only delta. Runtime behavior preserved through implementation entry. | `RP-027`, `PATH-027` |
| EX-007 | `src/hooks/prometheus-md-only/index.test.ts` | `PROPOSED_DROP` | Test-only delta. Runtime path retained separately. | `RP-033`, `PATH-033` |
| EX-008 | `src/hooks/ralph-loop/index.test.ts` | `PROPOSED_DROP` | Test-only delta. Runtime path retained separately. | `RP-035`, `PATH-035` |
| EX-009 | `src/hooks/start-work/index.test.ts` | `PROPOSED_DROP` | Test-only delta. Runtime path retained separately. | `RP-039`, `PATH-039` |
| EX-010 | `src/hooks/todo-continuation-enforcer/todo-continuation-enforcer.test.ts` | `PROPOSED_DROP` | Test-only delta. Runtime continuation behavior tracked in implementation entries. | `RP-042`, `PATH-042` |
| EX-011 | `src/shared/model-availability.test.ts` | `PROPOSED_DROP` | Test-only delta. Runtime model availability logic preserved through implementation path. | `RP-046`, `PATH-046` |
| EX-012 | `src/shared/task-parser.test.ts` | `PROPOSED_DROP` | Test-only delta. Runtime parser implementation remains in preservation ledger. | `RP-051`, `PATH-051` |
| EX-013 | `src/tools/delegate-task/tools.test.ts` | `PROPOSED_DROP` | Test-only delta. Runtime delegate-task behavior captured in tool implementation entries. | `RP-057`, `PATH-057` |
| EX-014 | `src/tools/session-manager/tools.context.test.ts` | `PROPOSED_DROP` | Test-only delta. Session-manager runtime behavior retained in `storage.ts` and `tools.ts`. | `RP-060`, `PATH-060` |
| EX-015 | `src/tools/skill/tools.test.ts` | `PROPOSED_DROP` | Test-only delta. Runtime skill tool path is handled by non-test entries. | `RP-062`, `PATH-062` |
| EX-016 | `src/tools/slashcommand/tools.test.ts` | `PROPOSED_DROP` | Test-only delta. Slashcommand runtime path is tracked as `EQUIVALENT_REWRITE` in implementation entry. | `RP-063`, `PATH-063` |
| EX-017 | `README.md` | `PROPOSED_DROP` | Documentation path outside runtime preservation scope. | `RP-065`, `PATH-065` |
| EX-018 | `src/cli/__snapshots__/model-fallback.test.ts.snap` | `PROPOSED_DROP` | Snapshot-only artifact; no direct runtime behavior surface. | `RP-072`, `PATH-072` |
| EX-019 | `src/features/builtin-commands/commands.test.ts` | `PROPOSED_DROP` | Test-only delta. Runtime command behavior retained in `commands.ts`. | `RP-073`, `PATH-073` |
| EX-020 | `src/features/claude-code-mcp-loader/loader.test.ts` | `PROPOSED_DROP` | Test-only delta. Runtime loader behavior tracked via implementation paths. | `RP-088`, `PATH-088` |
| EX-021 | `src/features/opencode-skill-loader/loader.test.ts` | `PROPOSED_DROP` | Test-only delta. Runtime loader behavior tracked via implementation paths. | `RP-089`, `PATH-089` |
| EX-022 | `src/hooks/keyword-detector/index.test.ts` | `PROPOSED_DROP` | Test-only delta. Runtime keyword detector paths remain preserved separately. | `RP-091`, `PATH-091` |
| EX-023 | `src/shared/model-requirements.test.ts` | `PROPOSED_DROP` | Test-only delta. Runtime requirements implementation preserved separately. | `RP-096`, `PATH-096` |
| EX-024 | `src/shared/model-resolver.test.ts` | `PROPOSED_DROP` | Test-only delta. Runtime resolver behavior tracked via implementation entries. | `RP-097`, `PATH-097` |
| EX-025 | `src/shared/model-suggestion-retry.test.ts` | `PROPOSED_DROP` | Test-only delta. Runtime retry logic kept in `model-suggestion-retry.ts`. | `RP-098`, `PATH-098` |
| EX-026 | `src/shared/session-bucket-repair.test.ts` | `PROPOSED_DROP` | Test-only delta. Runtime bucket repair path retained separately. | `RP-100`, `PATH-100` |
| EX-027 | `src/shared/wave-grouper.test.ts` | `PROPOSED_DROP` | Test-only delta. Runtime wave grouper path retained separately. | `RP-102`, `PATH-102` |
| EX-028 | `src/tools/session-manager/storage.test.ts` | `PROPOSED_DROP` | Test-only delta. Runtime session storage path retained separately. | `RP-105`, `PATH-105` |

## Wave A Task 3 Note

- No new exception IDs were added in Wave A.
- Existing Wave A-adjacent exception entries remain unchanged:
  - `EX-004` (`src/hooks/atlas/index.test.ts`)
  - `EX-006` (`src/hooks/compaction-context-injector/index.test.ts`)
- `UNAPPROVED_REQUIRED_PATH_LOSS=0` for Wave A required runtime paths.
