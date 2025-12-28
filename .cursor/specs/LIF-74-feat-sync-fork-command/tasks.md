# Sync Fork Command - Task Breakdown

**Linear Issue**: [LIF-74](https://linear.app/lifelogger/issue/LIF-74/sync-fork-command-recurring-workflow-for-upstream-synchronization)
**Created**: 2025-12-24
**Updated**: 2025-12-24 (revised for agent-consumable output)
**Total Estimate**: 15h (includes ~20% verification buffer)

## Vision

This command is the **intake funnel for automated fork maintenance**:
```
/sync-fork → OmO parses JSON → Creates Linear issues → /specify → /plan → /implement
```

Each recommendation = one spec unit = one Linear issue = one development cycle.

## Phase 1: Foundation / Setup (2h 55m)

**Goal**: Establish tool skeleton, strict boundaries, safe Git preflight.

| ID | Task | Status | Estimate | Dependencies | Notes |
|----|------|--------|----------|--------------|-------|
| T1.1 | Create `src/tools/sync-fork/` directory + empty files | Not Started | 15m | - | Files: `index.ts`, `types.ts`, `constants.ts`, `tools.ts`, `git-adapter.ts`, `commit-parser.ts`, `risk-scorer.ts`, `priority-scorer.ts`, `report-generator.ts`, `utils.ts` |
| T1.2 | Define core domain interfaces in `types.ts` | Not Started | 40m | T1.1 | Align with `plan.md` (GitContext, ParsedCommit, ScoredCommit, DirectoryHeat, SyncForkArgs/Result) |
| T1.3 | Define defaults/patterns in `constants.ts` | Not Started | 25m | T1.1 | `SECURITY_KEYWORDS`, risk config, priority weights, thresholds |
| T1.4 | Implement `GitAdapter` repo discovery + worktree-safe repoRoot | Not Started | 25m | T1.1 | Must work when `.git` is a file (worktrees); always run git with `cwd=repoRoot` |
| T1.5 | Implement `GitAdapter` preflight safety gates | Not Started | 45m | T1.2,T1.4 | Detect: missing upstream, detached HEAD, dirty working tree. Default: analysis OK; scaffold/script blocked if unsafe |
| T1.6 | Implement upstream branch resolution | Not Started | 25m | T1.5 | Prefer `refs/remotes/upstream/HEAD` → fallback `main` → `master` → else error listing upstream branches |
| T1.7 | Implement tool skeleton in `tools.ts` + barrel exports in `index.ts` | Not Started | 25m | T1.2,T1.3,T1.5 | Tool args schema + success/error envelope; no side effects outside GitAdapter |
| T1.8 | Register tool export + plugin registration | Not Started | 35m | T1.7 | Update `src/tools/index.ts` + `src/index.ts` to register `sync_fork` |

**Checkpoint**:
- `bun run typecheck` passes
- Tool registers without runtime errors
- Preflight errors include actionable suggestions

---

## Phase 2: Core Analysis (CommitCollector + Parser) (3h 05m)

**Goal**: Collect upstream-only commits + metadata robustly and efficiently (avoid per-commit spawns).

| ID | Task | Status | Estimate | Dependencies | Notes |
|----|------|--------|----------|--------------|-------|
| T2.1 | Decide and implement robust `git log` format (delimiter-safe) | Not Started | 45m | T1.4,T1.6 | Prefer `git log -z` or `%x1f/%x1e` delimiters to avoid newline ambiguity; document parsing contract |
| T2.2 | Implement upstream-only commit collection (headers-only pass) | Not Started | 30m | T2.1 | Apply `--since` + internal clamp on `--limit` early (cheap pass) |
| T2.3 | Implement conventional commit parsing | Not Started | 45m | T1.2 | Regex parser; handle `type(scope)!:` + `BREAKING CHANGE:` footers; fallback to `other` |
| T2.4 | Implement security detection heuristics | Not Started | 30m | T1.3,T2.3 | Keyword scoring + high-confidence path weighting; label commit type as `security` when confidence high |
| T2.5 | Implement commit type classification + merge detection | Not Started | 35m | T2.2,T2.3,T2.4 | Detect merges via parents (`%P`); default: mark merges `REVIEW` and exclude from scaffold unless `--include-merges` (optional future) |

**Checkpoint**:
- `/sync-fork --filter security` returns only security-labeled commits
- Parsing handles subjects with colons/spaces/newlines safely (no record desync)
- Total git invocations stays bounded (target ≤ 5 per run)

---

## Phase 3: Basic Report (1h 45m)

**Goal**: Produce readable report + machine JSON output.

| ID | Task | Status | Estimate | Dependencies | Notes |
|----|------|--------|----------|--------------|-------|
| T3.1 | Implement ReportGenerator base | Not Started | 25m | T2.5 | Inputs: context + commits; outputs: markdown + JSON |
| T3.2 | Implement markdown report format (grouped by type) | Not Started | 50m | T3.1 | Include: merge-base, counts, warnings (shallow/detached/dirty), top recommendations |
| T3.3 | Implement JSON output format | Not Started | 10m | T3.1 | Shape matches `SyncForkResult` |
| T3.4 | Wire `--output` handling in tool | Not Started | 20m | T3.2,T3.3 | `report|json|markdown` |

**Checkpoint**:
- `/sync-fork --output json` returns valid JSON
- `/sync-fork --output markdown` is readable and stable across runs

---

## Phase 4: Risk Assessment (2h 25m)

**Goal**: Classify file risk, build heatmap, estimate conflict likelihood (offline).

| ID | Task | Status | Estimate | Dependencies | Notes |
|----|------|--------|----------|--------------|-------|
| T4.1 | Implement file risk classification | Not Started | 40m | T1.3 | Map file paths → `HIGH|MEDIUM|LOW` with reason/points |
| T4.2 | Implement commit file change extraction (batched where possible) | Not Started | 45m | T2.1,T2.2 | Avoid `git show` per commit for large N; consider second batched pass; support `R/C` safely |
| T4.3 | Build directory heatmap | Not Started | 30m | T4.1,T4.2 | Aggregate risk + file counts by directory |
| T4.4 | Estimate conflict probability | Not Started | 30m | T4.2 | Heuristics: path overlap vs fork diff, churn if `--numstat` available, scatter factor; normalize 0..1 |

**Checkpoint**:
- Report includes heatmap section
- High-risk paths (e.g. `src/index.ts`, `src/config/schema.ts`) flagged as HIGH
- ConflictProb stable and bounded (0..1)

---

## Phase 5: Priority Classification (1h 15m)

**Goal**: Categorize commits by priority (P0-P3) using simple rules, not complex formulas.

| ID | Task | Status | Estimate | Dependencies | Notes |
|----|------|--------|----------|--------------|-------|
| T5.1 | Implement categorical priority classification | Not Started | 30m | T2.5,T4.1 | P0=security, P1=fix+risk, P2=perf, P3=rest |
| T5.2 | Implement effort estimation | Not Started | 20m | T4.2 | trivial/small/medium/large based on file count + risk |
| T5.3 | Implement conflict likelihood heuristic | Not Started | 25m | T4.4 | likely/possible/unlikely based on path overlap |

**Checkpoint**:
- Security commits always P0
- Priority is deterministic (same input → same output)
- No complex scoring formulas

---

## Phase 6: Spec Unit Grouping (1h 30m)

**Goal**: Group commits into "spec units" — each group becomes one Linear issue.

| ID | Task | Status | Estimate | Dependencies | Notes |
|----|------|--------|----------|--------------|-------|
| T6.1 | Implement explicit marker detection | Not Started | 30m | T2.3 | PR refs (`#123`), issue refs (`ABC-123`), fixup/squash |
| T6.2 | Implement scope-based grouping | Not Started | 35m | T4.2,T6.1 | Same conventional scope within 10 commits |
| T6.3 | Generate deterministic group IDs | Not Started | 25m | T6.2 | Stable IDs for repeat runs |

**Grouping Principle**: Each group should be independently cherry-pickable and spec-worthy.

**Checkpoint**:
- Each group is a valid "spec unit" for Linear issue creation
- Repeat runs produce same groups

---

## Phase 7: Recommendation Generation (1h)

**Goal**: Generate SyncRecommendation objects with Linear-ready fields.

| ID | Task | Status | Estimate | Dependencies | Notes |
|----|------|--------|----------|--------------|-------|
| T7.1 | Generate `SyncRecommendation` objects | Not Started | 25m | T5.3,T6.3 | suggestedIssueTitle, suggestedIssueDescription, cherryPickCommand |
| T7.2 | Generate Linear-ready issue descriptions | Not Started | 20m | T7.1 | Markdown with context, commits, risk summary |
| T7.3 | Add suggested labels based on priority/type | Not Started | 15m | T7.1 | ["sync-upstream", "P0", "security"] etc. |

**Each recommendation is a complete "spec unit"**: OmO can directly call `linear_create_issue` with output.

**Checkpoint**:
- JSON output contains recommendations with all required fields
- OmO can create Linear issues without additional processing

---

## Phase 8: Polish & Cross-Cutting Concerns (4h 10m)

**Goal**: Harden edge cases, add command file, verification + perf guardrails.

| ID | Task | Status | Estimate | Dependencies | Notes |
|----|------|--------|----------|--------------|-------|
| T8.1 | Add `--since` and `--limit` support end-to-end | Not Started | 25m | T2.2,T3.4 | `since` parsing best-effort; document accepted formats; internal clamp on limit |
| T8.2 | Offline/degraded mode behavior for `fetch` failures | Not Started | 30m | T1.5,T1.6 | If fetch fails, continue with existing refs (warn) unless required refs missing; consider `--no-fetch` flag [ ? ] |
| T8.3 | Shallow clone handling + remediation text | Not Started | 15m | T1.5 | Warn + suggest `git fetch --unshallow` / `--depth` |
| T8.4 | Command markdown `.opencode/command/sync-fork.md` | Not Started | 20m | T3.4,T7.1 | Frontmatter: `category: git`, `description`, `argument-hint`; include `$ARGUMENTS` and examples |
| T8.5 | Perf guardrails + “large limit degrade” rules | Not Started | 45m | T2.1,T4.2 | Define: when to skip file analysis/heatmap/groups for huge N; keep runtime bounded |
| T8.6 | Manual E2E dogfood in this repo | Not Started | 45m | T8.1,T8.2,T8.4 | Run against real upstream; validate readability + actionable errors |
| T8.7 | Unit tests: commit parser + security detection [ ? ] | Not Started | 45m | T2.3,T2.4 | Repo has `bun:test` tests, but LSP shows missing `bun:test` types; may require TS config tweak |
| T8.8 | Unit tests: risk/priority scoring stability [ ? ] | Not Started | 55m | T4.4,T5.3 | Table-driven tests for deterministic ordering/threshold behavior |
| T8.9 | Unit tests: git output parsers (mocked strings) [ ? ] | Not Started | 30m | T2.1,T4.2 | No real git needed; parser-only |

**Checkpoint**:
- Edge cases: no-upstream, detached HEAD, dirty tree, shallow clone handled cleanly
- `bun run typecheck` passes
- If tests enabled, `bun test` passes
- Command discovered by slashcommand loader

---

## Dependency Graph (Overview)

- Foundation: `T1.*`
- Commit analysis: `T1.* → T2.*`
- Reporting: `T2.* → T3.*`
- Risk: `T2.* + T1.3 → T4.*`
- Priority: `T4.* + T2.5 → T5.*`
- Grouping: `T4.2 + T2.3 → T6.*`
- Scaffold: `T1.5 + T5.4 + T6.3 → T7.*`
- Polish/tests/perf: `T1–T7 → T8.*`

## Summary

| Phase | Tasks | Estimate | Status |
|-------|-------|----------|--------|
| Phase 1: Foundation / Setup | 8 | 2h 55m | Not Started |
| Phase 2: Core Analysis | 5 | 3h 05m | Not Started |
| Phase 3: Basic Report | 4 | 1h 45m | Not Started |
| Phase 4: Risk Assessment | 4 | 2h 25m | Not Started |
| Phase 5: Priority Classification | 3 | 1h 15m | Not Started |
| Phase 6: Spec Unit Grouping | 3 | 1h 30m | Not Started |
| Phase 7: Recommendation Generation | 3 | 1h | Not Started |
| Phase 8: Polish & Cross-Cutting | 9 | 4h 10m | Not Started |
| **Total** | **39** | **~18h** | - |

**Key Change**: Output is agent-consumable JSON for OmO to create Linear issues.

## Recommended Execution Order

1. **T1.1–T1.8** (tool wired + safety preflight)
2. **T2.1–T2.5** (collection + parsing + filters)
3. **T3.1–T3.4** (JSON output usable early for OmO testing)
4. **T4.1–T4.4** then **T5.1–T5.3** (risk + priority classification)
5. **T6.1–T6.3** then **T7.1–T7.3** (spec units + recommendations)
6. **T8.1–T8.9** (edge cases + perf + tests)

## Notes

- **Agent-Consumable Output**: Primary output is JSON that OmO can directly use to create Linear issues
- Offline constraint interpreted as "no external APIs/deps"; `git fetch` may still require network
- Performance risk: avoid per-commit `git show` spawns at large N; prioritize batched log formats
- Each recommendation = one spec unit = one Linear issue = one `/specify` run
