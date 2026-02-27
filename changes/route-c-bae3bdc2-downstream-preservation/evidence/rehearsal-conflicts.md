# R0.2 Rehearsal Pull-in Conflict Evidence

- Timestamp (UTC): 2026-02-27T16:02:00Z
- Rehearsal worktree: `E:/github/oh-my-opencode-merge-r0-2-rehearsal`
- Rehearsal branch: `rehearsal/r0-2-pullin-20260227`
- Base side: `rescue/pre-merge-bae3bdc2` (`e27d53e7`)
- Pull-in side: `recovery/remerge-20260226` (`566774e2`)

## Command Evidence (exact commands + short outputs)

1) Create isolated worktree/branch

```bash
git worktree add -b "rehearsal/r0-2-pullin-20260227" "E:/github/oh-my-opencode-merge-r0-2-rehearsal" "rescue/pre-merge-bae3bdc2"
```

Output (short):

```text
Preparing worktree (new branch 'rehearsal/r0-2-pullin-20260227')
HEAD is now at e27d53e7 docs: finalize Task 6 merge and cleanup evidence
```

2) Pull-in rehearsal merge (Git-style)

```bash
git merge --no-commit --no-ff "recovery/remerge-20260226"
```

Output (short):

```text
CONFLICT (content): Merge conflict in .gitignore
CONFLICT (content): Merge conflict in src/agents/sisyphus.ts
CONFLICT (modify/delete): src/agents/utils.ts deleted in recovery/remerge-20260226 and modified in HEAD.
...
Automatic merge failed; fix conflicts and then commit the result.
```

3) Enumerate unresolved conflict paths

```bash
git diff --name-only --diff-filter=U
```

Output (short):

```text
.gitignore
src/agents/sisyphus.ts
...
src/tools/slashcommand/tools.ts
```

4) Classify conflict codes from porcelain-v2

```bash
git status --porcelain=v2
```

Output (short, parsed):

```text
UNMERGED_TOTAL 64
COUNTS {'content': 58, 'delete-modify': 6}
```

5) Semantic-risk candidate scan (both sides changed, but not literal U-conflict)

```bash
python -c "... merge-base + both-side diff overlap ..."
```

Output:

```text
MERGE_BASE d3999d79df5e4586e4e67b35d57fe34447a3b87a
BOTH_CHANGED 105
UNMERGED 64
SEMANTIC_RISK_CANDIDATES 42
```

6) Grep conflict markers in source tree

```bash
grep pattern: ^<<<<<<<  (path: .../src, include: *.ts)
```

Output:

```text
Found 130 match(es) in 57 file(s)
```

7) AST-grep structural cross-check support

```bash
ast-grep search: export const $NAME = $$$
```

Output (short):

```text
Found 3 match(es)
```

8) Abort rehearsal merge to keep isolated branch non-destructive

```bash
git merge --abort && git status -sb
```

Output:

```text
## rehearsal/r0-2-pullin-20260227
```

## Conflict Count by Type

- content: **58**
- rename: **0**
- delete-modify: **6**
- semantic-risk (non-literal conflict but coexistence ambiguous): **42**

## Literal Conflict Entries (64)

Resolution option shorthand used below:
- **O1**: keep rescue-side control flow, forward-port missing recovery behavior.
- **O2**: keep recovery-side implementation, adapt rescue entrypoints.
- **O3**: hybrid merge (preferred where behavior + architecture both matter).
- **D1** (delete-modify): restore deleted path as compatibility shim/re-export.
- **D2** (delete-modify): accept deletion and migrate callers immediately.
- **D3** (delete-modify): temporary wrapper now, hard removal in later wave.

| Path | Type | Resolution options |
|---|---|---|
| `.gitignore` | `content` | O1 / O2 / O3 |
| `src/agents/sisyphus.ts` | `content` | O1 / O2 / O3 |
| `src/agents/utils.ts` | `delete-modify` | D1 / D2 / D3 |
| `src/cli/doctor/checks/lsp.ts` | `delete-modify` | D1 / D2 / D3 |
| `src/cli/doctor/checks/version.test.ts` | `delete-modify` | D1 / D2 / D3 |
| `src/cli/doctor/index.ts` | `content` | O1 / O2 / O3 |
| `src/cli/doctor/types.ts` | `content` | O1 / O2 / O3 |
| `src/cli/index.ts` | `content` | O1 / O2 / O3 |
| `src/cli/install.ts` | `content` | O1 / O2 / O3 |
| `src/config/schema.ts` | `content` | O1 / O2 / O3 |
| `src/features/background-agent/manager.ts` | `content` | O1 / O2 / O3 |
| `src/features/boulder-state/storage.ts` | `content` | O1 / O2 / O3 |
| `src/features/boulder-state/types.ts` | `content` | O1 / O2 / O3 |
| `src/features/builtin-commands/templates/start-work.ts` | `content` | O1 / O2 / O3 |
| `src/features/builtin-skills/skills.test.ts` | `content` | O1 / O2 / O3 |
| `src/features/opencode-skill-loader/async-loader.ts` | `content` | O1 / O2 / O3 |
| `src/features/opencode-skill-loader/loader.ts` | `content` | O1 / O2 / O3 |
| `src/features/opencode-skill-loader/skill-content.ts` | `content` | O1 / O2 / O3 |
| `src/hooks/anthropic-context-window-limit-recovery/index.ts` | `content` | O1 / O2 / O3 |
| `src/hooks/atlas/atlas-hook.ts` | `content` (add/add) | O1 / O2 / O3 |
| `src/hooks/atlas/event-handler.ts` | `content` (add/add) | O1 / O2 / O3 |
| `src/hooks/atlas/index.test.ts` | `content` | O1 / O2 / O3 |
| `src/hooks/atlas/index.ts` | `content` | O1 / O2 / O3 |
| `src/hooks/atlas/system-reminder-templates.ts` | `content` (add/add) | O1 / O2 / O3 |
| `src/hooks/atlas/tool-execute-after.ts` | `content` (add/add) | O1 / O2 / O3 |
| `src/hooks/auto-slash-command/index.test.ts` | `content` | O1 / O2 / O3 |
| `src/hooks/compaction-context-injector/index.test.ts` | `content` | O1 / O2 / O3 |
| `src/hooks/compaction-context-injector/index.ts` | `content` | O1 / O2 / O3 |
| `src/hooks/index.ts` | `content` | O1 / O2 / O3 |
| `src/hooks/interactive-bash-session/index.ts` | `content` | O1 / O2 / O3 |
| `src/hooks/keyword-detector/index.ts` | `content` | O1 / O2 / O3 |
| `src/hooks/prometheus-md-only/constants.ts` | `content` | O1 / O2 / O3 |
| `src/hooks/prometheus-md-only/index.test.ts` | `content` | O1 / O2 / O3 |
| `src/hooks/prometheus-md-only/index.ts` | `content` | O1 / O2 / O3 |
| `src/hooks/ralph-loop/index.test.ts` | `content` | O1 / O2 / O3 |
| `src/hooks/ralph-loop/index.ts` | `content` | O1 / O2 / O3 |
| `src/hooks/rules-injector/finder.ts` | `content` | O1 / O2 / O3 |
| `src/hooks/rules-injector/index.ts` | `content` | O1 / O2 / O3 |
| `src/hooks/start-work/index.test.ts` | `content` | O1 / O2 / O3 |
| `src/hooks/start-work/index.ts` | `content` | O1 / O2 / O3 |
| `src/hooks/todo-continuation-enforcer.ts` | `delete-modify` | D1 / D2 / D3 |
| `src/hooks/todo-continuation-enforcer/todo-continuation-enforcer.test.ts` | `content` | O1 / O2 / O3 |
| `src/index.ts` | `content` | O1 / O2 / O3 |
| `src/plugin-handlers/config-handler.ts` | `content` | O1 / O2 / O3 |
| `src/shared/index.ts` | `content` | O1 / O2 / O3 |
| `src/shared/model-availability.test.ts` | `content` | O1 / O2 / O3 |
| `src/shared/model-availability.ts` | `content` | O1 / O2 / O3 |
| `src/shared/model-requirements.ts` | `content` | O1 / O2 / O3 |
| `src/shared/model-resolution-pipeline.ts` | `content` | O1 / O2 / O3 |
| `src/shared/session-utils.ts` | `content` | O1 / O2 / O3 |
| `src/shared/task-parser.test.ts` | `content` (add/add) | O1 / O2 / O3 |
| `src/shared/task-parser.ts` | `content` (add/add) | O1 / O2 / O3 |
| `src/shared/tmux/tmux-utils.ts` | `content` | O1 / O2 / O3 |
| `src/tools/background-task/tools.ts` | `content` | O1 / O2 / O3 |
| `src/tools/delegate-task/constants.ts` | `content` | O1 / O2 / O3 |
| `src/tools/delegate-task/executor.ts` | `content` | O1 / O2 / O3 |
| `src/tools/delegate-task/tools.test.ts` | `content` | O1 / O2 / O3 |
| `src/tools/lsp/constants.ts` | `content` | O1 / O2 / O3 |
| `src/tools/session-manager/storage.ts` | `content` | O1 / O2 / O3 |
| `src/tools/session-manager/tools.context.test.ts` | `content` (add/add) | O1 / O2 / O3 |
| `src/tools/session-manager/tools.ts` | `content` | O1 / O2 / O3 |
| `src/tools/skill/tools.test.ts` | `content` | O1 / O2 / O3 |
| `src/tools/slashcommand/tools.test.ts` | `delete-modify` | D1 / D2 / D3 |
| `src/tools/slashcommand/tools.ts` | `delete-modify` | D1 / D2 / D3 |

## Semantic-risk Conflict Entries (42)

Definition used: changed on both sides from merge-base but **no literal U-conflict**, therefore coexistence policy must be explicit.

Semantic option shorthand:
- **S1**: preserve downstream behavior first, then refactor into rescue architecture.
- **S2**: preserve rescue architecture first, then reintroduce required downstream deltas.
- **S3**: prove equivalent rewrite with targeted evidence/tests before accepting replacement.

| Path | Type | Resolution options |
|---|---|---|
| `README.md` | `semantic-risk` | S1 / S2 / S3 |
| `package.json` | `semantic-risk` | S1 / S2 / S3 |
| `src/agents/explore.ts` | `semantic-risk` | S1 / S2 / S3 |
| `src/agents/index.ts` | `semantic-risk` | S1 / S2 / S3 |
| `src/agents/momus.ts` | `semantic-risk` | S1 / S2 / S3 |
| `src/agents/oracle.ts` | `semantic-risk` | S1 / S2 / S3 |
| `src/agents/types.ts` | `semantic-risk` | S1 / S2 / S3 |
| `src/cli/__snapshots__/model-fallback.test.ts.snap` | `semantic-risk` | S1 / S2 / S3 |
| `src/features/builtin-commands/commands.test.ts` | `semantic-risk` | S1 / S2 / S3 |
| `src/features/builtin-commands/commands.ts` | `semantic-risk` | S1 / S2 / S3 |
| `src/features/builtin-commands/presets/index.ts` | `semantic-risk` | S1 / S2 / S3 |
| `src/features/builtin-commands/templates/agent-chains.ts` | `semantic-risk` | S1 / S2 / S3 |
| `src/features/builtin-commands/templates/build-fix.ts` | `semantic-risk` | S1 / S2 / S3 |
| `src/features/builtin-commands/templates/evolve.ts` | `semantic-risk` | S1 / S2 / S3 |
| `src/features/builtin-commands/templates/instinct-export.ts` | `semantic-risk` | S1 / S2 / S3 |
| `src/features/builtin-commands/templates/instinct-import.ts` | `semantic-risk` | S1 / S2 / S3 |
| `src/features/builtin-commands/templates/instinct-status.ts` | `semantic-risk` | S1 / S2 / S3 |
| `src/features/builtin-commands/templates/learn.ts` | `semantic-risk` | S1 / S2 / S3 |
| `src/features/builtin-commands/templates/ralph-loop.ts` | `semantic-risk` | S1 / S2 / S3 |
| `src/features/builtin-commands/templates/revert.ts` | `semantic-risk` | S1 / S2 / S3 |
| `src/features/builtin-commands/templates/status.ts` | `semantic-risk` | S1 / S2 / S3 |
| `src/features/builtin-commands/types.ts` | `semantic-risk` | S1 / S2 / S3 |
| `src/features/builtin-skills/skills.ts` | `semantic-risk` | S1 / S2 / S3 |
| `src/features/claude-code-mcp-loader/loader.test.ts` | `semantic-risk` | S1 / S2 / S3 |
| `src/features/opencode-skill-loader/loader.test.ts` | `semantic-risk` | S1 / S2 / S3 |
| `src/hooks/auto-slash-command/executor.ts` | `semantic-risk` | S1 / S2 / S3 |
| `src/hooks/keyword-detector/index.test.ts` | `semantic-risk` | S1 / S2 / S3 |
| `src/hooks/keyword-detector/ultrawork/default.ts` | `semantic-risk` | S1 / S2 / S3 |
| `src/hooks/keyword-detector/ultrawork/planner.ts` | `semantic-risk` | S1 / S2 / S3 |
| `src/mcp/index.ts` | `semantic-risk` | S1 / S2 / S3 |
| `src/plugin-config.ts` | `semantic-risk` | S1 / S2 / S3 |
| `src/shared/model-requirements.test.ts` | `semantic-risk` | S1 / S2 / S3 |
| `src/shared/model-resolver.test.ts` | `semantic-risk` | S1 / S2 / S3 |
| `src/shared/model-suggestion-retry.test.ts` | `semantic-risk` | S1 / S2 / S3 |
| `src/shared/model-suggestion-retry.ts` | `semantic-risk` | S1 / S2 / S3 |
| `src/shared/session-bucket-repair.test.ts` | `semantic-risk` | S1 / S2 / S3 |
| `src/shared/session-bucket-repair.ts` | `semantic-risk` | S1 / S2 / S3 |
| `src/shared/wave-grouper.test.ts` | `semantic-risk` | S1 / S2 / S3 |
| `src/shared/wave-grouper.ts` | `semantic-risk` | S1 / S2 / S3 |
| `src/tools/delegate-task/categories.ts` | `semantic-risk` | S1 / S2 / S3 |
| `src/tools/session-manager/storage.test.ts` | `semantic-risk` | S1 / S2 / S3 |
| `src/tools/slashcommand/types.ts` | `semantic-risk` | S1 / S2 / S3 |

## Notes

- No rename conflict was emitted by Git in this rehearsal (`rename = 0`).
- Semantic-risk list is intentionally retained even when Git auto-merges cleanly; these paths need coexistence policy decisions in R0.4/R0.5.
