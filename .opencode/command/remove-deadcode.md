---
description: Remove unused code from this project with ultrawork mode, LSP-verified safety, atomic commits
---

<command-instruction>

Dead code removal via massively parallel deep agents. You are the ORCHESTRATOR — you scan, verify, batch, then delegate ALL removals to parallel agents.

<rules>
- **LSP is law.** Verify with `LspFindReferences(includeDeclaration=false)` before ANY removal decision.
- **Never remove entry points.** `src/index.ts`, `src/cli/index.ts`, test files, config files, `packages/` — off-limits.
- **You do NOT remove code yourself.** You scan, verify, batch, then fire deep agents. They do the work.
</rules>

<false-positive-guards>
NEVER mark as dead:
- Symbols in `src/index.ts` or barrel `index.ts` re-exports
- Symbols referenced in test files (tests are valid consumers)
- Symbols with `@public` / `@api` JSDoc tags
- Hook factories (`createXXXHook`), tool factories (`createXXXTool`), agent definitions in `agentSources`
- Command templates, skill definitions, MCP configs
- Symbols in `package.json` exports
</false-positive-guards>

---

## PHASE 1: SCAN — Find Dead Code Candidates

Run ALL of these in parallel:

<parallel-scan>

**TypeScript strict mode (your primary scanner — run this FIRST):**
```bash
bunx tsc --noEmit --noUnusedLocals --noUnusedParameters 2>&1
```
This gives you the definitive list of unused locals, imports, parameters, and types with exact file:line locations.

**Explore agents (fire ALL simultaneously as background):**

```
task(subagent_type="explore", run_in_background=true, load_skills=[],
  description="Find orphaned files",
  prompt="Find files in src/ NOT imported by any other file. Check all import statements. EXCLUDE: index.ts, *.test.ts, entry points, .md, packages/. Return: file paths.")

task(subagent_type="explore", run_in_background=true, load_skills=[],
  description="Find unused exported symbols",
  prompt="Find exported functions/types/constants in src/ that are never imported by other files. Cross-reference: for each export, grep the symbol name across src/ — if it only appears in its own file, it's a candidate. EXCLUDE: src/index.ts exports, test files. Return: file path, line, symbol name, export type.")
```

</parallel-scan>

Collect all results into a master candidate list.

---

## PHASE 2: VERIFY — LSP Confirmation (Zero False Positives)

For EACH candidate from Phase 1:

```typescript
LspFindReferences(filePath, line, character, includeDeclaration=false)
// 0 references → CONFIRMED dead
// 1+ references → NOT dead, drop from list
```

Also apply the false-positive-guards above. Produce a confirmed list:

```
| # | File | Symbol | Type | Action |
|---|------|--------|------|--------|
| 1 | src/foo.ts:42 | unusedFunc | function | REMOVE |
| 2 | src/bar.ts:10 | OldType | type | REMOVE |
| 3 | src/baz.ts:7 | ctx | parameter | PREFIX _ |
```

**Action types:**
- `REMOVE` — delete the symbol/import/file entirely
- `PREFIX _` — unused function parameter required by signature → rename to `_paramName`

If ZERO confirmed: report "No dead code found" and STOP.

---

## PHASE 3: BATCH — Group by File for Conflict-Free Parallelism

<batching-rules>

**Goal: maximize parallel agents with ZERO git conflicts.**

1. Group confirmed dead code items by FILE PATH
2. All items in the SAME file go to the SAME batch (prevents two agents editing the same file)
3. If a dead FILE (entire file deletion) exists, it's its own batch
4. Target 5-15 batches. If fewer than 5 items total, use 1 batch per item.

**Example batching:**
```
Batch A: [src/hooks/foo/hook.ts — 3 unused imports]
Batch B: [src/features/bar/manager.ts — 2 unused constants, 1 dead function]
Batch C: [src/tools/baz/tool.ts — 1 unused param, src/tools/baz/types.ts — 1 unused type]
Batch D: [src/dead-file.ts — entire file deletion]
```

Files in the same directory CAN be batched together (they won't conflict as long as no two agents edit the same file). Maximize batch count for parallelism.

</batching-rules>

---

## PHASE 4: EXECUTE — Fire Parallel Deep Agents

For EACH batch, fire a deep agent:

```
task(
  category="deep",
  load_skills=["typescript-programmer", "git-master"],
  run_in_background=true,
  description="Remove dead code batch N: [brief description]",
  prompt="[see template below]"
)
```

<agent-prompt-template>

Every deep agent gets this prompt structure (fill in the specifics per batch):

```
## TASK: Remove dead code from [file list]

## DEAD CODE TO REMOVE

### [file path] line [N]
- Symbol: `[name]` — [type: unused import / unused constant / unused function / unused parameter / dead file]
- Action: [REMOVE entirely / REMOVE from import list / PREFIX with _]

### [file path] line [N]
- ...

## PROTOCOL

1. Read each file to understand exact syntax at the target lines
2. For each symbol, run LspFindReferences to RE-VERIFY it's still dead (another agent may have changed things)
3. Apply the change:
   - Unused import (only symbol in line): remove entire import line
   - Unused import (one of many): remove only that symbol from the import list
   - Unused constant/function/type: remove the declaration. Clean up trailing blank lines.
   - Unused parameter: prefix with `_` (do NOT remove — required by signature)
   - Dead file: delete with `rm`
4. After ALL edits in this batch, run: `bun run typecheck`
5. If typecheck fails: `git checkout -- [files]` and report failure
6. If typecheck passes: stage ONLY your files and commit:
   `git add [your-specific-files] && git commit -m "refactor: remove dead code from [brief file list]"`
7. Report what you removed and the commit hash

## CRITICAL
- Stage ONLY your batch's files (`git add [specific files]`). NEVER `git add -A` — other agents are working in parallel.
- If typecheck fails after your edits, REVERT all changes and report. Do not attempt to fix.
- Pre-existing test failures in other files are expected. Only typecheck matters for your batch.
```

</agent-prompt-template>

Fire ALL batches simultaneously. Wait for all to complete.

---

## PHASE 5: FINAL VERIFICATION

After ALL agents complete:

```bash
bun run typecheck   # must pass
bun test            # note any NEW failures vs pre-existing
bun run build       # must pass
```

Produce summary:

```markdown
## Dead Code Removal Complete

### Removed
| # | Symbol | File | Type | Commit | Agent |
|---|--------|------|------|--------|-------|
| 1 | unusedFunc | src/foo.ts | function | abc1234 | Batch A |

### Skipped (agent reported failure)
| # | Symbol | File | Reason |
|---|--------|------|--------|

### Verification
- Typecheck: PASS/FAIL
- Tests: X passing, Y failing (Z pre-existing)
- Build: PASS/FAIL
- Total removed: N symbols across M files
- Total commits: K atomic commits
- Parallel agents used: P
```

---

## SCOPE CONTROL

If `$ARGUMENTS` is provided, narrow the scan:
- File path → only that file
- Directory → only that directory
- Symbol name → only that symbol
- `all` or empty → full project scan (default)

## ABORT CONDITIONS

STOP and report if:
- More than 50 candidates found (ask user to narrow scope or confirm proceeding)
- Build breaks and cannot be fixed by reverting

</command-instruction>

<user-request>
$ARGUMENTS
</user-request>
