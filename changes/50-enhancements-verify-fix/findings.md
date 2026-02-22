
- Change `experimental.preemptive_compaction` default from optional to `true` by default.
- Updated `src/config/schema.ts` to include default values for `preemptive_compaction` and the `experimental` object itself.
- Updated `src/plugin-config.ts` to ensure that `OhMyOpenCodeConfigSchema.parse()` is called on the final merged configuration to apply defaults.
- This change ensures that the preemptive compaction feature is enabled by default for all users unless explicitly disabled in their configuration.

- For task 4.6, the Explore agent prompt source is `src/agents/explore.ts` in this branch (no standalone `src/agents/explore-prompt.ts` exists).
- Added explicit three-dimension intent framing (security, quality, performance) and deterministic composite-score ranking instructions to the prompt output contract.

- Task 4.5 closure required integration wiring, not new core runner implementation: existing `src/cli/test-runner.ts` was reused and wired into `doctor` via a new `--test` CLI flag and `DoctorOptions.test`.
- To keep testability and avoid cross-file runtime mocking side effects, `src/cli/doctor/index.ts` now exposes `runDoctorWithTests(options, dependencies)` and `DoctorDependencies` for deterministic unit testing.
- Unified doctor+test exit semantics: return non-zero when either doctor checks fail or aggregated test run reports failed tests.

- Task 1.9 wired SKILL.md frontmatter (`hooks`, `triggers`, `priority`) into runtime `LoadedSkill` objects in both sync and async skill loaders.
- Skill auto-trigger generation now prefers explicit frontmatter triggers over description keyword extraction and applies trigger-priority boost (`high`/`medium`/`low`) on top of scope priority.
- Cache invalidation logic for skill trigger extraction now hashes full skill signature (description + hooks + triggers + triggerPriority), preventing stale cache when trigger metadata changes without description changes.
- Task 1.10 integrated relevance scoring into context collector ordering: after source and priority ordering, entries are ranked by `scoreRelevance()` using metadata (`intentMode`, `resourcePath`, `resourceType`).
- Task 1.11 integrated anti-pattern tracker into compaction context injection by appending a dynamic "Known Failed Patterns" section sourced from `.opencode/anti-patterns.json`.
- Tasks 1.12/1.13 integrated into TDD guard post-edit flow: if source+expected test files exist, the hook now appends AST coverage gaps and test isolation violations to the tool output.
- Task 4.3 added new feature module `src/features/verification/index.ts` implementing a 3-stage verification pipeline and wired it into `subagent-verification` hook output.
- Task 4.1 validation path was implemented as non-blocking enforcement: validator now supports flexible heading levels (`#`-`######`) and builtin loaded skills carry validation metadata (`skill_validation_status`, `skill_validation_missing_sections`) when required sections are missing.

- Task 1.9 (builtin path) root cause confirmed: `src/features/builtin-skills/skills.ts` previously parsed only markdown body and discarded SKILL.md frontmatter.
- Added `src/features/builtin-skills/skill-parser.ts` to normalize and safely expose frontmatter (`description`, `hooks`, `triggers`, `priority`) via shared frontmatter parser.
- Builtin skill creation now applies parsed frontmatter when available, surfacing data at `skill.metadata.skillFrontmatter` while preserving fallback behavior on missing/invalid frontmatter.

- Re-validation sweep for unchecked plan items confirmed existing runtime integrations:
  - 1.10: `collector.ts` uses `scoreRelevance()` from `src/shared/relevance-scorer.ts` for ordering.
  - 1.11: compaction injector appends `Known Failed Patterns` using `src/shared/anti-pattern-tracker.ts`.
  - 1.12/1.13: `tdd-guard/index.ts` emits AST coverage and isolation diagnostics.
  - 4.3: multi-stage verification provided by `src/features/verification/index.ts` and consumed by `subagent-verification` hook.
  - 4.1: skill validation compatibility implemented in `skill-validator.ts` + `skill-content.ts` metadata path.

- Full-suite blocker observed: global `bun test` currently fails due to unrelated repository-wide failures outside this task scope; targeted suites, typecheck, and build for this plan slice are passing.
