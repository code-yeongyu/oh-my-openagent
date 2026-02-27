# Required Patches Ledger (R0.4)

Source evidence:
- `changes/route-c-bae3bdc2-downstream-preservation/evidence/rehearsal-conflicts.md` (R0.2)
- `changes/route-c-bae3bdc2-downstream-preservation/evidence/rehearsal-impact-report.md` (R0.3)

Status legend:
- `PRESERVE`: keep downstream behavior as-is in fusion path.
- `EQUIVALENT_REWRITE`: replacement accepted only with behavior-equivalence proof.
- `PROPOSED_DROP`: candidate for removal from runtime-preservation scope (must appear in approved exceptions).

| Patch ID | Path | Conflict Type | Status | Evidence Basis | Notes |
|---|---|---|---|---|---|
| RP-001 | `.gitignore` | `content` | `PROPOSED_DROP` | R0.2 literal conflict | Documentation/repo-hygiene path outside runtime preservation scope for Route C. |
| RP-002 | `src/agents/sisyphus.ts` | `content` | `PRESERVE` | R0.2 literal conflict | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-003 | `src/agents/utils.ts` | `delete-modify` | `EQUIVALENT_REWRITE` | R0.2 literal conflict | Path was delete/modify in rehearsal; preserve behavior via replacement module or compatibility shim. |
| RP-004 | `src/cli/doctor/checks/lsp.ts` | `delete-modify` | `EQUIVALENT_REWRITE` | R0.2 literal conflict | Path was delete/modify in rehearsal; preserve behavior via replacement module or compatibility shim. |
| RP-005 | `src/cli/doctor/checks/version.test.ts` | `delete-modify` | `PROPOSED_DROP` | R0.2 literal conflict | Test/snapshot-only delta; runtime behavior governed by paired implementation entries. |
| RP-006 | `src/cli/doctor/index.ts` | `content` | `PRESERVE` | R0.2 literal conflict | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-007 | `src/cli/doctor/types.ts` | `content` | `PRESERVE` | R0.2 literal conflict | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-008 | `src/cli/index.ts` | `content` | `PRESERVE` | R0.2 literal conflict | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-009 | `src/cli/install.ts` | `content` | `PRESERVE` | R0.2 literal conflict | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-010 | `src/config/schema.ts` | `content` | `PRESERVE` | R0.2 literal conflict | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-011 | `src/features/background-agent/manager.ts` | `content` | `PRESERVE` | R0.2 literal conflict | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-012 | `src/features/boulder-state/storage.ts` | `content` | `PRESERVE` | R0.2 literal conflict | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-013 | `src/features/boulder-state/types.ts` | `content` | `PRESERVE` | R0.2 literal conflict | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-014 | `src/features/builtin-commands/templates/start-work.ts` | `content` | `PRESERVE` | R0.2 literal conflict | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-015 | `src/features/builtin-skills/skills.test.ts` | `content` | `PROPOSED_DROP` | R0.2 literal conflict | Test/snapshot-only delta; runtime behavior governed by paired implementation entries. |
| RP-016 | `src/features/opencode-skill-loader/async-loader.ts` | `content` | `PRESERVE` | R0.2 literal conflict | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-017 | `src/features/opencode-skill-loader/loader.ts` | `content` | `PRESERVE` | R0.2 literal conflict | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-018 | `src/features/opencode-skill-loader/skill-content.ts` | `content` | `PRESERVE` | R0.2 literal conflict | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-019 | `src/hooks/anthropic-context-window-limit-recovery/index.ts` | `content` | `PRESERVE` | R0.2 literal conflict | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-020 | `src/hooks/atlas/atlas-hook.ts` | `content` | `PRESERVE` | R0.2 literal conflict | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-021 | `src/hooks/atlas/event-handler.ts` | `content` | `PRESERVE` | R0.2 literal conflict | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-022 | `src/hooks/atlas/index.test.ts` | `content` | `PROPOSED_DROP` | R0.2 literal conflict | Test/snapshot-only delta; runtime behavior governed by paired implementation entries. |
| RP-023 | `src/hooks/atlas/index.ts` | `content` | `PRESERVE` | R0.2 literal conflict | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-024 | `src/hooks/atlas/system-reminder-templates.ts` | `content` | `PRESERVE` | R0.2 literal conflict | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-025 | `src/hooks/atlas/tool-execute-after.ts` | `content` | `PRESERVE` | R0.2 literal conflict | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-026 | `src/hooks/auto-slash-command/index.test.ts` | `content` | `PROPOSED_DROP` | R0.2 literal conflict | Test/snapshot-only delta; runtime behavior governed by paired implementation entries. |
| RP-027 | `src/hooks/compaction-context-injector/index.test.ts` | `content` | `PROPOSED_DROP` | R0.2 literal conflict | Test/snapshot-only delta; runtime behavior governed by paired implementation entries. |
| RP-028 | `src/hooks/compaction-context-injector/index.ts` | `content` | `PRESERVE` | R0.2 literal conflict | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-029 | `src/hooks/index.ts` | `content` | `PRESERVE` | R0.2 literal conflict | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-030 | `src/hooks/interactive-bash-session/index.ts` | `content` | `PRESERVE` | R0.2 literal conflict | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-031 | `src/hooks/keyword-detector/index.ts` | `content` | `PRESERVE` | R0.2 literal conflict | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-032 | `src/hooks/prometheus-md-only/constants.ts` | `content` | `PRESERVE` | R0.2 literal conflict | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-033 | `src/hooks/prometheus-md-only/index.test.ts` | `content` | `PROPOSED_DROP` | R0.2 literal conflict | Test/snapshot-only delta; runtime behavior governed by paired implementation entries. |
| RP-034 | `src/hooks/prometheus-md-only/index.ts` | `content` | `PRESERVE` | R0.2 literal conflict | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-035 | `src/hooks/ralph-loop/index.test.ts` | `content` | `PROPOSED_DROP` | R0.2 literal conflict | Test/snapshot-only delta; runtime behavior governed by paired implementation entries. |
| RP-036 | `src/hooks/ralph-loop/index.ts` | `content` | `PRESERVE` | R0.2 literal conflict | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-037 | `src/hooks/rules-injector/finder.ts` | `content` | `PRESERVE` | R0.2 literal conflict | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-038 | `src/hooks/rules-injector/index.ts` | `content` | `PRESERVE` | R0.2 literal conflict | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-039 | `src/hooks/start-work/index.test.ts` | `content` | `PROPOSED_DROP` | R0.2 literal conflict | Test/snapshot-only delta; runtime behavior governed by paired implementation entries. |
| RP-040 | `src/hooks/start-work/index.ts` | `content` | `PRESERVE` | R0.2 literal conflict | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-041 | `src/hooks/todo-continuation-enforcer.ts` | `delete-modify` | `EQUIVALENT_REWRITE` | R0.2 literal conflict | Path was delete/modify in rehearsal; preserve behavior via replacement module or compatibility shim. |
| RP-042 | `src/hooks/todo-continuation-enforcer/todo-continuation-enforcer.test.ts` | `content` | `PROPOSED_DROP` | R0.2 literal conflict | Test/snapshot-only delta; runtime behavior governed by paired implementation entries. |
| RP-043 | `src/index.ts` | `content` | `PRESERVE` | R0.2 literal conflict | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-044 | `src/plugin-handlers/config-handler.ts` | `content` | `PRESERVE` | R0.2 literal conflict | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-045 | `src/shared/index.ts` | `content` | `PRESERVE` | R0.2 literal conflict | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-046 | `src/shared/model-availability.test.ts` | `content` | `PROPOSED_DROP` | R0.2 literal conflict | Test/snapshot-only delta; runtime behavior governed by paired implementation entries. |
| RP-047 | `src/shared/model-availability.ts` | `content` | `PRESERVE` | R0.2 literal conflict | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-048 | `src/shared/model-requirements.ts` | `content` | `PRESERVE` | R0.2 literal conflict | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-049 | `src/shared/model-resolution-pipeline.ts` | `content` | `PRESERVE` | R0.2 literal conflict | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-050 | `src/shared/session-utils.ts` | `content` | `PRESERVE` | R0.2 literal conflict | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-051 | `src/shared/task-parser.test.ts` | `content` | `PROPOSED_DROP` | R0.2 literal conflict | Test/snapshot-only delta; runtime behavior governed by paired implementation entries. |
| RP-052 | `src/shared/task-parser.ts` | `content` | `PRESERVE` | R0.2 literal conflict | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-053 | `src/shared/tmux/tmux-utils.ts` | `content` | `PRESERVE` | R0.2 literal conflict | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-054 | `src/tools/background-task/tools.ts` | `content` | `PRESERVE` | R0.2 literal conflict | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-055 | `src/tools/delegate-task/constants.ts` | `content` | `PRESERVE` | R0.2 literal conflict | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-056 | `src/tools/delegate-task/executor.ts` | `content` | `PRESERVE` | R0.2 literal conflict | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-057 | `src/tools/delegate-task/tools.test.ts` | `content` | `PROPOSED_DROP` | R0.2 literal conflict | Test/snapshot-only delta; runtime behavior governed by paired implementation entries. |
| RP-058 | `src/tools/lsp/constants.ts` | `content` | `PRESERVE` | R0.2 literal conflict | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-059 | `src/tools/session-manager/storage.ts` | `content` | `PRESERVE` | R0.2 literal conflict | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-060 | `src/tools/session-manager/tools.context.test.ts` | `content` | `PROPOSED_DROP` | R0.2 literal conflict | Test/snapshot-only delta; runtime behavior governed by paired implementation entries. |
| RP-061 | `src/tools/session-manager/tools.ts` | `content` | `PRESERVE` | R0.2 literal conflict | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-062 | `src/tools/skill/tools.test.ts` | `content` | `PROPOSED_DROP` | R0.2 literal conflict | Test/snapshot-only delta; runtime behavior governed by paired implementation entries. |
| RP-063 | `src/tools/slashcommand/tools.test.ts` | `delete-modify` | `PROPOSED_DROP` | R0.2 literal conflict | Test/snapshot-only delta; runtime behavior governed by paired implementation entries. |
| RP-064 | `src/tools/slashcommand/tools.ts` | `delete-modify` | `EQUIVALENT_REWRITE` | R0.2 literal conflict | Path was delete/modify in rehearsal; preserve behavior via replacement module or compatibility shim. |
| RP-065 | `README.md` | `semantic-risk` | `PROPOSED_DROP` | R0.2 semantic-risk + R0.3 impact | Documentation/repo-hygiene path outside runtime preservation scope for Route C. |
| RP-066 | `package.json` | `semantic-risk` | `EQUIVALENT_REWRITE` | R0.2 semantic-risk + R0.3 impact | Keep dependency/metadata semantics through equivalent manifest reconciliation in later wave. |
| RP-067 | `src/agents/explore.ts` | `semantic-risk` | `EQUIVALENT_REWRITE` | R0.2 semantic-risk + R0.3 impact | Semantic-risk path; accept only evidence-backed equivalent behavior during fusion. |
| RP-068 | `src/agents/index.ts` | `semantic-risk` | `EQUIVALENT_REWRITE` | R0.2 semantic-risk + R0.3 impact | Semantic-risk path; accept only evidence-backed equivalent behavior during fusion. |
| RP-069 | `src/agents/momus.ts` | `semantic-risk` | `EQUIVALENT_REWRITE` | R0.2 semantic-risk + R0.3 impact | Semantic-risk path; accept only evidence-backed equivalent behavior during fusion. |
| RP-070 | `src/agents/oracle.ts` | `semantic-risk` | `EQUIVALENT_REWRITE` | R0.2 semantic-risk + R0.3 impact | Semantic-risk path; accept only evidence-backed equivalent behavior during fusion. |
| RP-071 | `src/agents/types.ts` | `semantic-risk` | `EQUIVALENT_REWRITE` | R0.2 semantic-risk + R0.3 impact | Semantic-risk path; accept only evidence-backed equivalent behavior during fusion. |
| RP-072 | `src/cli/__snapshots__/model-fallback.test.ts.snap` | `semantic-risk` | `PROPOSED_DROP` | R0.2 semantic-risk + R0.3 impact | Test/snapshot-only delta; runtime behavior governed by paired implementation entries. |
| RP-073 | `src/features/builtin-commands/commands.test.ts` | `semantic-risk` | `PROPOSED_DROP` | R0.2 semantic-risk + R0.3 impact | Test/snapshot-only delta; runtime behavior governed by paired implementation entries. |
| RP-074 | `src/features/builtin-commands/commands.ts` | `semantic-risk` | `PRESERVE` | R0.2 semantic-risk + R0.3 impact | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-075 | `src/features/builtin-commands/presets/index.ts` | `semantic-risk` | `PRESERVE` | R0.2 semantic-risk + R0.3 impact | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-076 | `src/features/builtin-commands/templates/agent-chains.ts` | `semantic-risk` | `EQUIVALENT_REWRITE` | R0.2 semantic-risk + R0.3 impact | Semantic-risk path; accept only evidence-backed equivalent behavior during fusion. |
| RP-077 | `src/features/builtin-commands/templates/build-fix.ts` | `semantic-risk` | `EQUIVALENT_REWRITE` | R0.2 semantic-risk + R0.3 impact | Semantic-risk path; accept only evidence-backed equivalent behavior during fusion. |
| RP-078 | `src/features/builtin-commands/templates/evolve.ts` | `semantic-risk` | `EQUIVALENT_REWRITE` | R0.2 semantic-risk + R0.3 impact | Semantic-risk path; accept only evidence-backed equivalent behavior during fusion. |
| RP-079 | `src/features/builtin-commands/templates/instinct-export.ts` | `semantic-risk` | `EQUIVALENT_REWRITE` | R0.2 semantic-risk + R0.3 impact | Semantic-risk path; accept only evidence-backed equivalent behavior during fusion. |
| RP-080 | `src/features/builtin-commands/templates/instinct-import.ts` | `semantic-risk` | `EQUIVALENT_REWRITE` | R0.2 semantic-risk + R0.3 impact | Semantic-risk path; accept only evidence-backed equivalent behavior during fusion. |
| RP-081 | `src/features/builtin-commands/templates/instinct-status.ts` | `semantic-risk` | `EQUIVALENT_REWRITE` | R0.2 semantic-risk + R0.3 impact | Semantic-risk path; accept only evidence-backed equivalent behavior during fusion. |
| RP-082 | `src/features/builtin-commands/templates/learn.ts` | `semantic-risk` | `EQUIVALENT_REWRITE` | R0.2 semantic-risk + R0.3 impact | Semantic-risk path; accept only evidence-backed equivalent behavior during fusion. |
| RP-083 | `src/features/builtin-commands/templates/ralph-loop.ts` | `semantic-risk` | `EQUIVALENT_REWRITE` | R0.2 semantic-risk + R0.3 impact | Semantic-risk path; accept only evidence-backed equivalent behavior during fusion. |
| RP-084 | `src/features/builtin-commands/templates/revert.ts` | `semantic-risk` | `EQUIVALENT_REWRITE` | R0.2 semantic-risk + R0.3 impact | Semantic-risk path; accept only evidence-backed equivalent behavior during fusion. |
| RP-085 | `src/features/builtin-commands/templates/status.ts` | `semantic-risk` | `EQUIVALENT_REWRITE` | R0.2 semantic-risk + R0.3 impact | Semantic-risk path; accept only evidence-backed equivalent behavior during fusion. |
| RP-086 | `src/features/builtin-commands/types.ts` | `semantic-risk` | `EQUIVALENT_REWRITE` | R0.2 semantic-risk + R0.3 impact | Semantic-risk path; accept only evidence-backed equivalent behavior during fusion. |
| RP-087 | `src/features/builtin-skills/skills.ts` | `semantic-risk` | `PRESERVE` | R0.2 semantic-risk + R0.3 impact | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-088 | `src/features/claude-code-mcp-loader/loader.test.ts` | `semantic-risk` | `PROPOSED_DROP` | R0.2 semantic-risk + R0.3 impact | Test/snapshot-only delta; runtime behavior governed by paired implementation entries. |
| RP-089 | `src/features/opencode-skill-loader/loader.test.ts` | `semantic-risk` | `PROPOSED_DROP` | R0.2 semantic-risk + R0.3 impact | Test/snapshot-only delta; runtime behavior governed by paired implementation entries. |
| RP-090 | `src/hooks/auto-slash-command/executor.ts` | `semantic-risk` | `EQUIVALENT_REWRITE` | R0.2 semantic-risk + R0.3 impact | Semantic-risk path; accept only evidence-backed equivalent behavior during fusion. |
| RP-091 | `src/hooks/keyword-detector/index.test.ts` | `semantic-risk` | `PROPOSED_DROP` | R0.2 semantic-risk + R0.3 impact | Test/snapshot-only delta; runtime behavior governed by paired implementation entries. |
| RP-092 | `src/hooks/keyword-detector/ultrawork/default.ts` | `semantic-risk` | `PRESERVE` | R0.2 semantic-risk + R0.3 impact | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-093 | `src/hooks/keyword-detector/ultrawork/planner.ts` | `semantic-risk` | `PRESERVE` | R0.2 semantic-risk + R0.3 impact | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-094 | `src/mcp/index.ts` | `semantic-risk` | `PRESERVE` | R0.2 semantic-risk + R0.3 impact | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-095 | `src/plugin-config.ts` | `semantic-risk` | `PRESERVE` | R0.2 semantic-risk + R0.3 impact | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-096 | `src/shared/model-requirements.test.ts` | `semantic-risk` | `PROPOSED_DROP` | R0.2 semantic-risk + R0.3 impact | Test/snapshot-only delta; runtime behavior governed by paired implementation entries. |
| RP-097 | `src/shared/model-resolver.test.ts` | `semantic-risk` | `PROPOSED_DROP` | R0.2 semantic-risk + R0.3 impact | Test/snapshot-only delta; runtime behavior governed by paired implementation entries. |
| RP-098 | `src/shared/model-suggestion-retry.test.ts` | `semantic-risk` | `PROPOSED_DROP` | R0.2 semantic-risk + R0.3 impact | Test/snapshot-only delta; runtime behavior governed by paired implementation entries. |
| RP-099 | `src/shared/model-suggestion-retry.ts` | `semantic-risk` | `PRESERVE` | R0.2 semantic-risk + R0.3 impact | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-100 | `src/shared/session-bucket-repair.test.ts` | `semantic-risk` | `PROPOSED_DROP` | R0.2 semantic-risk + R0.3 impact | Test/snapshot-only delta; runtime behavior governed by paired implementation entries. |
| RP-101 | `src/shared/session-bucket-repair.ts` | `semantic-risk` | `PRESERVE` | R0.2 semantic-risk + R0.3 impact | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-102 | `src/shared/wave-grouper.test.ts` | `semantic-risk` | `PROPOSED_DROP` | R0.2 semantic-risk + R0.3 impact | Test/snapshot-only delta; runtime behavior governed by paired implementation entries. |
| RP-103 | `src/shared/wave-grouper.ts` | `semantic-risk` | `PRESERVE` | R0.2 semantic-risk + R0.3 impact | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-104 | `src/tools/delegate-task/categories.ts` | `semantic-risk` | `PRESERVE` | R0.2 semantic-risk + R0.3 impact | Runtime-critical or coordination-critical behavior path must be preserved. |
| RP-105 | `src/tools/session-manager/storage.test.ts` | `semantic-risk` | `PROPOSED_DROP` | R0.2 semantic-risk + R0.3 impact | Test/snapshot-only delta; runtime behavior governed by paired implementation entries. |
| RP-106 | `src/tools/slashcommand/types.ts` | `semantic-risk` | `EQUIVALENT_REWRITE` | R0.2 semantic-risk + R0.3 impact | Semantic-risk path; accept only evidence-backed equivalent behavior during fusion. |

## Wave A Execution Outcome (Task 3)

| Patch ID | Wave A Action | Outcome | Notes |
|---|---|---|---|
| RP-019 | no-edit | `PRESERVE` | File present and unchanged in this wave. |
| RP-020 | applied | `PRESERVE` | `src/hooks/atlas/atlas-hook.ts` added from rescue Wave A source. |
| RP-021 | applied | `PRESERVE` | `src/hooks/atlas/event-handler.ts` added from rescue Wave A source. |
| RP-022 | applied (test sync) | `PROPOSED_DROP` | EX-004 remains unchanged; test was kept aligned for targeted verification. |
| RP-023 | applied | `PRESERVE` | Atlas monolith entry replaced by modular barrel export. |
| RP-024 | applied | `PRESERVE` | `system-reminder-templates.ts` added from rescue Wave A source. |
| RP-025 | applied | `PRESERVE` | `tool-execute-after.ts` added from rescue Wave A source. |
| RP-027 | no-edit | `PROPOSED_DROP` | EX-006 unchanged. |
| RP-028 | no-edit | `PRESERVE` | File present and unchanged in this wave. |
| RP-029 | no-edit | `PRESERVE` | File present and unchanged in this wave. |
| RP-043 | applied (hybrid rewrite) | `PRESERVE` | Startup/session-created repair behavior forward-ported with local equivalent import rewrite. |
| RP-044 | no-edit | `PRESERVE` | File present and unchanged in this wave. |

## Wave B Execution Outcome (Task 4)

| Patch ID | Wave B Action | Outcome | Notes |
|---|---|---|---|
| RP-012 | no-edit | `PRESERVE` | File present and unchanged in this wave. |
| RP-013 | no-edit | `PRESERVE` | File present and unchanged in this wave. |
| RP-035 | no-edit | `PROPOSED_DROP` | EX-governed test path remains unchanged in this wave. |
| RP-036 | no-edit | `PRESERVE` | File present and unchanged in this wave. |
| RP-041 | applied (compatibility keep) | `EQUIVALENT_REWRITE` | `todo-continuation-enforcer.ts` synced from rescue; fallback-agent + active-boulder-session guard behavior preserved. |
| RP-042 | applied (test sync, equivalent surface) | `PROPOSED_DROP` | Synced legacy test path `src/hooks/todo-continuation-enforcer.test.ts` to match Wave B runtime behavior under EX governance. |
| RP-050 | no-edit | `PRESERVE` | File present and unchanged in this wave. |
| RP-052 | no-edit | `PRESERVE` | File present and unchanged in this wave. |
| RP-055 | no-edit | `PRESERVE` | File present and unchanged in this wave. |
| RP-056 | no-edit | `PRESERVE` | File present and unchanged in this wave. |
| RP-057 | applied (test sync) | `PROPOSED_DROP` | Delegate-task verification updated from rescue while remaining EX-governed test scope. |
| RP-059 | applied | `PRESERVE` | Session storage normalization logic synced from rescue (Windows/Git-Bash/WSL path variants). |
| RP-060 | applied (test sync) | `PROPOSED_DROP` | Added context-directory test coverage for `session_list` behavior. |
| RP-061 | applied | `PRESERVE` | `session_list` now resolves directory from tool context when `project_path` is absent. |
| RP-103 | no-edit | `PRESERVE` | File present and unchanged in this wave. |
| RP-104 | no-edit | `PRESERVE` | File present and unchanged in this wave. |
| RP-105 | applied (test sync) | `PROPOSED_DROP` | Added cross-platform directory match tests for storage query behavior. |
