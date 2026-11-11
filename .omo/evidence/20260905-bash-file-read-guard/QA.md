# QA Evidence — `bash-file-read-guard` warning in `tool.execute.after`

Date: 2026-09-05
PR: https://github.com/code-yeongyu/oh-my-openagent/pull/7021
Issue: https://github.com/code-yeongyu/oh-my-openagent/issues/7020
Branch: `fix/bash-file-read-guard` (worktree `oh-my-openagent-wt/fix-bash-file-read-guard`, rebased onto `dev` @ `579c1759d`)

## WHAT WAS TESTED

Surface: `bash-file-read-guard` lifecycle hook in OpenCode plugin runtime:
- `packages/omo-opencode/src/hooks/bash-file-read-guard.ts`
- `packages/omo-opencode/src/plugin/tool-execute-after.ts`
- `packages/omo-opencode/src/plugin/tool-execute-before.ts`
- `packages/omo-opencode/src/hooks/bash-file-read-guard.test.ts`

Scenarios tested:
1. **Shell file-read command (`cat package.json`)**:
   - Live execution under real headless `opencode serve` in an isolated sandbox.
   - Verified that the `bash` tool execution completes.
   - Verified that the tool output received by the LLM is prefixed **exactly once** with:
     `[WARNING: Prefer the Read tool over \`cat\`/\`head\`/\`tail\` for reading file contents. The Read tool provides line numbers and hash anchors for precise editing.]`
   - Verified that the underlying file content is preserved intact directly following the warning prefix.
2. **Unrelated shell command (`echo hello world`)**:
   - Live execution under real headless `opencode serve` in an isolated sandbox.
   - Verified that the `bash` tool execution completes.
   - Verified that the output is completely **unchanged** (`hello world\n`) and carries **no** warning prefix.
3. **Idempotency & Deduplication**:
   - Verified via unit test that calling `tool.execute.after` on an already-prefixed output does not duplicate the warning.
4. **Unit test suite & typechecks**:
   - Unit tests covering `cat`, `head`, `tail`, non-bash tools, complex/piped commands, unrelated commands (`echo hello`), and idempotency.
   - Monorepo full typecheck across all 30 packages (`bun run typecheck`).
   - Plugin build (`bun run build`).

## WHAT WAS OBSERVED

### 1. Real OpenCode Runtime Evidence (`run-qa.mjs`)

Driver script: `.omo/evidence/20260905-bash-file-read-guard/run-qa.mjs`
Logged to: `.omo/evidence/20260905-bash-file-read-guard/qa-run.log`

#### Scenario 1: `cat package.json` (File read command)
- Session created: `ses_f8cd072c2ffeqH6RT948oIu084`
- Command: `cat package.json`
- Output captured in `.omo/evidence/20260905-bash-file-read-guard/cat-tool-output.txt`:
```
[WARNING: Prefer the Read tool over `cat`/`head`/`tail` for reading file contents. The Read tool provides line numbers and hash anchors for precise editing.]

{
  "name": "bash-guard-qa-fixture",
  "version": "1.0.0",
  "description": "fixture for bash-file-read-guard QA"
}
```
- **ASSERTION PASSED**: Tool output starts with `[WARNING: ...]`.
- **ASSERTION PASSED**: Warning text count = 1 (prefixed exactly once).
- **ASSERTION PASSED**: Full original file content preserved after warning header.

#### Scenario 2: `echo hello world` (Unrelated bash command)
- Session created: `ses_f8cd06cb6ffeikadxioGhsHULy`
- Command: `echo hello world`
- Output captured in `.omo/evidence/20260905-bash-file-read-guard/echo-tool-output.txt`:
```
hello world
```
- **ASSERTION PASSED**: Output contains no warning prefix.
- **ASSERTION PASSED**: Output is completely unchanged (`hello world\n`).

### 2. Sandbox DB & Isolation Proof
- Logged in `.omo/evidence/20260905-bash-file-read-guard/isolation-receipt.txt`:
```
real_db_path=/home/cye/.local/share/opencode/opencode.db
real_db_sessions_before=585
real_db_sessions_after=585
sandbox_db_path=/tmp/oqa-bash-guard-U92MfE/data/opencode/opencode.db
sandbox_db_sessions=2
isolation_verified=true
```
- Real host database session count was 585 before and 585 after. Zero host DB pollution.

### 3. Unit & Integration Suites
```
bun test packages/omo-opencode/src/hooks/bash-file-read-guard.test.ts
6 pass, 0 fail, 9 expect() calls

bun test packages/omo-opencode/src/plugin/tool-execute-after.test.ts packages/omo-opencode/src/plugin/tool-execute-before.test.ts
25 pass, 0 fail, 44 expect() calls

bun run typecheck
tsgo --noEmit across all packages: exit 0, no errors.

bun run build
Full plugin build: exit 0.
```

## WHY IT IS ENOUGH

- Proves the fix directly resolves issue #7020 by surfacing the warning to the model through OpenCode's `tool.execute.after` hook contract (`output.output`).
- Directly addresses maintainer feedback from `MoerAI`:
  - Demonstrates that a shell file-read command (`cat package.json`) completes and is prefixed **exactly once** with the guidance.
  - Demonstrates that an unrelated shell command (`echo hello world`) completes with its output **completely unchanged**.
  - Shows that the branch is synchronized with current `dev` (`579c1759d`).
- Verified against a real running `opencode serve` headless instance with the live plugin loaded, and confirmed through both the LLM transport payload and the sandbox SQLite `part` records.

## WHAT WAS OMITTED

- Temporary sandbox directory `/tmp/oqa-bash-guard-*` was cleaned up automatically after run completion.
- Sensitive authentication tokens were not generated; random throwaway ephemeral credentials (`pass-...`) were used for local socket authentication.
