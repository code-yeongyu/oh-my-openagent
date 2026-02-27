# Wave C Execution Sheet (Rehearsal-Derived)

- Timestamp (UTC): 2026-02-28T16:20:00Z
- Strategy gate: Path **A** (downstream-preservation priority)
- Inputs used:
  - `changes/route-c-bae3bdc2-downstream-preservation/evidence/rehearsal-conflicts.md`
  - `changes/route-c-bae3bdc2-downstream-preservation/evidence/rehearsal-impact-report.md`
  - `changes/route-c-bae3bdc2-downstream-preservation/evidence/wave-a-execution-sheet.md`
  - `changes/route-c-bae3bdc2-downstream-preservation/evidence/wave-b-execution-sheet.md`
  - `changes/route-c-bae3bdc2-downstream-preservation/required-patches.md`
  - `changes/route-c-bae3bdc2-downstream-preservation/required-paths.md`
  - `git diff --name-status HEAD..rescue/pre-merge-bae3bdc2` (Wave C allowlist projection)
  - `git diff --name-status rescue/pre-merge-bae3bdc2...recovery/remerge-20260226` (rehearsal conflict context)

## Exact Wave C Allowlist Paths

1. `src/features/builtin-skills/**`
2. `src/hooks/keyword-detector/**`
3. `src/hooks/rules-injector/**`
4. `src/hooks/runtime-fallback/**`
5. `src/hooks/auto-slash-command/**`
6. `src/hooks/prometheus-md-only/**`
7. `src/hooks/start-work/**`
8. `src/features/opencode-skill-loader/**`
9. `src/shared/model-*.ts`
10. `src/shared/session-bucket-repair.ts`
11. `src/tools/background-task/**`
12. `src/tools/lsp/**`
13. `src/tools/skill/**`
14. `src/tools/slashcommand/**`
15. `src/cli/**`
16. `src/config/schema.ts`
17. `package.json`

## Itemized Resolution Plan (placeholder -> concrete)

Resolution option shorthand (from rehearsal evidence):
- `O1`: keep rescue-side behavior as source of truth for preserved paths.
- `O3`: hybrid merge used only when equivalent rewrite evidence is required.
- `S3`: semantic-risk/no-edit validation path with explicit preservation check.

### Apply Set for This Wave (sheet-listed changes only)

| Path | Ledger Mapping | Resolution Choice | Preserve/Equivalent Mapping | Concrete Action in Wave C |
|---|---|---|---|---|
| `src/cli/__snapshots__/model-fallback.test.ts.snap` | `RP-072 / PATH-072` | `O1` | `PROPOSED_DROP (EX-018)` | Apply rescue snapshot sync (test-only governed exception). |
| `src/cli/doctor/checks/version.test.ts` | `RP-005 / PATH-005` | `O1` | `PROPOSED_DROP (EX-002)` | Apply rescue test sync (test-only governed exception). |
| `src/cli/install.test.ts` | `(supporting, non-ledger)` | `O1` | `N/A` | Apply rescue test sync for CLI install behavior parity. |
| `src/cli/mcp-oauth/login.test.ts` | `(supporting, non-ledger)` | `O1` | `N/A` | Apply rescue test sync for CLI OAuth login flow parity. |
| `src/features/builtin-skills/mdsel/cli-src/selector/parser.test.ts` | `(supporting, non-ledger)` | `O1` | `N/A` | Add rescue parser test coverage file. |
| `src/features/builtin-skills/mdsel/cli-src/selector/parser.ts` | `(supporting, non-ledger)` | `O1` | `N/A` | Apply rescue parser implementation sync for mdsel selector behavior parity. |
| `src/features/builtin-skills/skills.test.ts` | `RP-015 / PATH-015` | `O1` | `PROPOSED_DROP (EX-003)` | Apply rescue test sync under approved exception governance. |
| `src/features/builtin-skills/skills.ts` | `RP-087 / PATH-087` | `O1` | `PRESERVE` | Apply rescue runtime skill catalog behavior. |
| `src/hooks/keyword-detector/index.test.ts` | `RP-091 / PATH-091` | `O1` | `PROPOSED_DROP (EX-022)` | Apply rescue test sync under approved exception governance. |
| `src/hooks/prometheus-md-only/index.test.ts` | `RP-033 / PATH-033` | `O1` | `PROPOSED_DROP (EX-007)` | Apply rescue test sync under approved exception governance. |
| `src/hooks/rules-injector/finder.test.ts` | `(supporting, non-ledger)` | `O1` | `N/A` | Apply rescue finder test sync aligned with runtime finder changes. |
| `src/hooks/rules-injector/finder.ts` | `RP-037 / PATH-037` | `O1` | `PRESERVE` | Apply rescue runtime finder behavior. |
| `src/hooks/start-work/index.test.ts` | `RP-039 / PATH-039` | `O1` | `PROPOSED_DROP (EX-009)` | Apply rescue test sync under approved exception governance. |
| `src/tools/skill/tools.test.ts` | `RP-062 / PATH-062` | `O1` | `PROPOSED_DROP (EX-015)` | Apply rescue test sync under approved exception governance. |

No code/test path outside this table is allowed in Wave C.

### Remaining Required Entries Closure Matrix (Wave C scope)

`required-patches.md` entries matched by Wave C allowlist: **43**

| Patch ID | Path | Planned Wave C Action | Target Outcome |
|---|---|---|---|
| `RP-004` | `src/cli/doctor/checks/lsp.ts` | no-edit (`S3`) | `EQUIVALENT_REWRITE` |
| `RP-005` | `src/cli/doctor/checks/version.test.ts` | apply rescue (`O1`) | `PROPOSED_DROP` (EX-002) |
| `RP-006` | `src/cli/doctor/index.ts` | no-edit (`S3`) | `PRESERVE` |
| `RP-007` | `src/cli/doctor/types.ts` | no-edit (`S3`) | `PRESERVE` |
| `RP-008` | `src/cli/index.ts` | no-edit (`S3`) | `PRESERVE` |
| `RP-009` | `src/cli/install.ts` | no-edit (`S3`) | `PRESERVE` |
| `RP-010` | `src/config/schema.ts` | no-edit (`S3`) | `PRESERVE` |
| `RP-015` | `src/features/builtin-skills/skills.test.ts` | apply rescue (`O1`) | `PROPOSED_DROP` (EX-003) |
| `RP-016` | `src/features/opencode-skill-loader/async-loader.ts` | no-edit (`S3`) | `PRESERVE` |
| `RP-017` | `src/features/opencode-skill-loader/loader.ts` | no-edit (`S3`) | `PRESERVE` |
| `RP-018` | `src/features/opencode-skill-loader/skill-content.ts` | no-edit (`S3`) | `PRESERVE` |
| `RP-026` | `src/hooks/auto-slash-command/index.test.ts` | no-edit (`S3`) | `PROPOSED_DROP` (EX-005) |
| `RP-031` | `src/hooks/keyword-detector/index.ts` | no-edit (`S3`) | `PRESERVE` |
| `RP-032` | `src/hooks/prometheus-md-only/constants.ts` | no-edit (`S3`) | `PRESERVE` |
| `RP-033` | `src/hooks/prometheus-md-only/index.test.ts` | apply rescue (`O1`) | `PROPOSED_DROP` (EX-007) |
| `RP-034` | `src/hooks/prometheus-md-only/index.ts` | no-edit (`S3`) | `PRESERVE` |
| `RP-037` | `src/hooks/rules-injector/finder.ts` | apply rescue (`O1`) | `PRESERVE` |
| `RP-038` | `src/hooks/rules-injector/index.ts` | no-edit (`S3`) | `PRESERVE` |
| `RP-039` | `src/hooks/start-work/index.test.ts` | apply rescue (`O1`) | `PROPOSED_DROP` (EX-009) |
| `RP-040` | `src/hooks/start-work/index.ts` | no-edit (`S3`) | `PRESERVE` |
| `RP-046` | `src/shared/model-availability.test.ts` | no-edit (`S3`) | `PROPOSED_DROP` (EX-011) |
| `RP-047` | `src/shared/model-availability.ts` | no-edit (`S3`) | `PRESERVE` |
| `RP-048` | `src/shared/model-requirements.ts` | no-edit (`S3`) | `PRESERVE` |
| `RP-049` | `src/shared/model-resolution-pipeline.ts` | no-edit (`S3`) | `PRESERVE` |
| `RP-054` | `src/tools/background-task/tools.ts` | no-edit (`S3`) | `PRESERVE` |
| `RP-058` | `src/tools/lsp/constants.ts` | no-edit (`S3`) | `PRESERVE` |
| `RP-062` | `src/tools/skill/tools.test.ts` | apply rescue (`O1`) | `PROPOSED_DROP` (EX-015) |
| `RP-063` | `src/tools/slashcommand/tools.test.ts` | no-edit (`S3`) | `PROPOSED_DROP` (EX-016) |
| `RP-064` | `src/tools/slashcommand/tools.ts` | no-edit (`S3`) | `EQUIVALENT_REWRITE` |
| `RP-066` | `package.json` | no-edit (`S3`) | `EQUIVALENT_REWRITE` |
| `RP-072` | `src/cli/__snapshots__/model-fallback.test.ts.snap` | apply rescue (`O1`) | `PROPOSED_DROP` (EX-018) |
| `RP-087` | `src/features/builtin-skills/skills.ts` | apply rescue (`O1`) | `PRESERVE` |
| `RP-089` | `src/features/opencode-skill-loader/loader.test.ts` | no-edit (`S3`) | `PROPOSED_DROP` (EX-021) |
| `RP-090` | `src/hooks/auto-slash-command/executor.ts` | no-edit (`S3`) | `EQUIVALENT_REWRITE` |
| `RP-091` | `src/hooks/keyword-detector/index.test.ts` | apply rescue (`O1`) | `PROPOSED_DROP` (EX-022) |
| `RP-092` | `src/hooks/keyword-detector/ultrawork/default.ts` | no-edit (`S3`) | `PRESERVE` |
| `RP-093` | `src/hooks/keyword-detector/ultrawork/planner.ts` | no-edit (`S3`) | `PRESERVE` |
| `RP-096` | `src/shared/model-requirements.test.ts` | no-edit (`S3`) | `PROPOSED_DROP` (EX-023) |
| `RP-097` | `src/shared/model-resolver.test.ts` | no-edit (`S3`) | `PROPOSED_DROP` (EX-024) |
| `RP-098` | `src/shared/model-suggestion-retry.test.ts` | no-edit (`S3`) | `PROPOSED_DROP` (EX-025) |
| `RP-099` | `src/shared/model-suggestion-retry.ts` | no-edit (`S3`) | `PRESERVE` |
| `RP-101` | `src/shared/session-bucket-repair.ts` | no-edit (`S3`) | `PRESERVE` |
| `RP-106` | `src/tools/slashcommand/types.ts` | no-edit (`S3`) | `EQUIVALENT_REWRITE` |

## Targeted Test Commands

1. `bun test src/features/builtin-skills/skills.test.ts src/features/builtin-skills/mdsel/cli-src/selector/parser.test.ts`
2. `bun test src/hooks/keyword-detector/index.test.ts src/hooks/prometheus-md-only/index.test.ts src/hooks/rules-injector/finder.test.ts src/hooks/start-work/index.test.ts`
3. `bun test src/tools/skill/tools.test.ts`
4. `bun test src/cli/doctor/checks/version.test.ts src/cli/install.test.ts src/cli/mcp-oauth/login.test.ts`
5. `bun run build`

## Preservation Gate Expectations for Wave C

- Wave C required entries close to `PRESERVE`, `EQUIVALENT_REWRITE`, or approved `PROPOSED_DROP` exceptions only.
- No unapproved required loss is permitted in this wave.
- Required-loss statement target for this wave: `WAVE_C_REQUIRED_MISSING=0`.
