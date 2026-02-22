
- [x] Change preemptive compaction default to enabled by default.
- [x] Update schema for default values.
- [x] Ensure configuration loader applies defaults.
- [x] Verify type safety and activation logic.
- [x] Atomic commit created.

- [x] Task 4.6 completed: updated Explore prompt with explicit security/quality/performance analysis and composite-score prioritization in `src/agents/explore.ts`.
- [x] Verification completed: `bun run typecheck`, `bun test src/agents/utils.test.ts`, and LSP diagnostics on `src/agents/explore.ts`.

- [x] Task 4.7 completed: wired stop-stage final audit execution into `src/index.ts` event lifecycle and exported `createFinalAuditHook` via `src/hooks/index.ts`.
- [x] Final audit now runs non-blocking on `session.stop`, logs both completion metadata and generated report output, and preserves default optional-check config behavior.
- [x] Verification completed: `bun test src/hooks/stop/final-audit-hook.test.ts`, `bun run typecheck`, and LSP diagnostics on changed runtime wiring files.

- [x] Task 4.5 completed: wired unified test runner into CLI doctor flow via `--test` and `DoctorOptions.test`.
- [x] Added testable integration surface `runDoctorWithTests()` plus dependency injection in `src/cli/doctor/index.ts`.
- [x] Added targeted coverage in `src/cli/doctor/index.test.ts` for disabled test mode, enabled test mode, and failed-test exit behavior.
- [x] Verification completed: `bun test src/cli/doctor/index.test.ts src/cli/doctor/runner.test.ts src/cli/test-runner.test.ts`, `bun run typecheck`, and LSP diagnostics on changed files.

- [x] Task 1.9 completed: SKILL.md frontmatter fields (`hooks`, `triggers`, `priority`) are now propagated through `src/features/opencode-skill-loader/{loader.ts,async-loader.ts}` into `LoadedSkill`.
- [x] Skill trigger pipeline updated: explicit frontmatter triggers are matched first, with priority boost support in `src/hooks/skill-auto-trigger/{trigger-generator.ts,trigger-extractor.ts}` and cache signature updates in `cache-checker.ts`.
- [x] Task 1.10 completed: context collector now applies relevance ranking via `scoreRelevance()` inside `src/features/context-injector/collector.ts`.
- [x] Task 1.11 completed: compaction prompt now injects tracker-backed "Known Failed Patterns" via `src/hooks/compaction-context-injector/index.ts`.
- [x] Tasks 1.12 + 1.13 completed: TDD guard now emits AST coverage and isolation diagnostics in `src/hooks/tdd-guard/index.ts`.
- [x] Task 4.3 completed: added `src/features/verification/index.ts` (multi-stage verification) and integrated output into `src/hooks/subagent-verification/index.ts`.
- [x] Task 4.1 validation-path completed: improved `skill-validator` heading compatibility and injected non-blocking validation metadata in `src/features/opencode-skill-loader/skill-content.ts`.
- [x] Verification completed:
  - `bun test src/features/opencode-skill-loader/loader.test.ts src/features/opencode-skill-loader/async-loader.test.ts src/hooks/skill-auto-trigger/index.test.ts src/features/context-injector/collector.test.ts src/hooks/compaction-context-injector/index.test.ts src/hooks/tdd-guard/tdd-guard.test.ts src/features/verification/index.test.ts src/hooks/subagent-verification/index.test.ts src/features/builtin-skills/skill-validator.test.ts src/features/opencode-skill-loader/skill-content.test.ts`
  - `bun run typecheck`
  - `bun run build`

- [x] Task 1.9 completed: added `src/features/builtin-skills/skill-parser.ts` and wired `src/features/builtin-skills/skills.ts` to parse/apply SKILL.md frontmatter for builtin skills.
- [x] Frontmatter is surfaced in runtime builtin skill metadata as `metadata.skillFrontmatter` (`hooks`, `triggers`, `priority`) and optional description override.
- [x] Backward compatibility retained: missing/invalid frontmatter falls back to previous behavior.
- [x] Verification completed:
  - `bun test src/features/builtin-skills/skill-parser.test.ts src/features/builtin-skills/skill-parser.integration.test.ts`
  - `bun run typecheck`
  - LSP diagnostics clean for changed files (no errors/warnings).

- [x] Plan-state sync completed for remaining unchecked tasks in this plan:
  - 1.10 relevance-scorer
  - 1.11 anti-pattern-tracker
  - 1.12 AST coverage checker
  - 1.13 isolation-checker
  - 4.1 unified skill format
  - 4.3 multi-stage verification
- [x] Verification evidence for those tasks was re-checked from runtime integration points and targeted tests:
  - `bun test src/features/opencode-skill-loader/loader.test.ts src/features/opencode-skill-loader/async-loader.test.ts src/hooks/skill-auto-trigger/index.test.ts src/features/context-injector/collector.test.ts src/hooks/compaction-context-injector/index.test.ts src/hooks/tdd-guard/tdd-guard.test.ts src/features/verification/index.test.ts src/hooks/subagent-verification/index.test.ts src/features/builtin-skills/skill-validator.test.ts src/features/opencode-skill-loader/skill-content.test.ts`
  - `bun run typecheck`
  - `bun run build`
- [~] Full `bun test` attempted but blocked by unrelated pre-existing repo-wide failures; recorded as blocker in notepad issues.
