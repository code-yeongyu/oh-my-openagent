# Execution Plan: Relax comment-checker hook false positives

## Problem Analysis

The comment-checker hook delegates to an external Go binary (`code-yeongyu/go-claude-code-comment-checker`). The binary:
1. Detects ALL comments in written/edited code using tree-sitter
2. Filters out only BDD markers, linter directives, and shebangs
3. Flags every remaining comment as problematic (exit code 2)
4. In the output formatter (`formatter.go`), uses `AgentMemoFilter` to categorize comments for display

The `AgentMemoFilter` in `pkg/filters/agent_memo.go` contains the overly aggressive regex:
```go
regexp.MustCompile(`(?i)^[\s#/*-]*note:\s*\w`),
```

This matches ANY comment starting with `Note:` (case-insensitive) followed by a word character, causing legitimate comments like `// Note: Thread-safe implementation` or `// NOTE: See RFC 7231` to be classified as "AGENT MEMO" AI slop with an aggressive warning banner.

Additionally, the binary flags ALL non-filtered comments (not just agent memos), so even without the `Note:` regex, `// Note: ...` comments would still be flagged as generic "COMMENT DETECTED."

## Architecture Understanding

```
TypeScript (oh-my-opencode)              Go Binary (go-claude-code-comment-checker)
─────────────────────────────             ──────────────────────────────────────────
hook.ts                                   main.go
 ├─ tool.execute.before                    ├─ Read JSON from stdin
 │   └─ registerPendingCall()              ├─ Detect comments (tree-sitter)
 └─ tool.execute.after                     ├─ applyFilters (BDD, Directive, Shebang)
     └─ processWithCli()                   ├─ FormatHookMessage (uses AgentMemoFilter for display)
         └─ runCommentChecker()            └─ exit 0 (clean) or exit 2 (comments found, message on stderr)
             └─ spawn binary, pipe JSON
             └─ read stderr → message
             └─ append to output
```

Key files in oh-my-opencode:
- `src/hooks/comment-checker/hook.ts` - Hook factory, registers before/after handlers
- `src/hooks/comment-checker/cli-runner.ts` - Orchestrates CLI invocation, semaphore
- `src/hooks/comment-checker/cli.ts` - Binary resolution, process spawning, timeout handling
- `src/hooks/comment-checker/types.ts` - PendingCall, CommentInfo types
- `src/config/schema/comment-checker.ts` - Config schema (currently only `custom_prompt`)

Key files in Go binary:
- `pkg/filters/agent_memo.go` - Contains the aggressive `note:\s*\w` regex (line 20)
- `pkg/output/formatter.go` - Uses AgentMemoFilter to add "AGENT MEMO" warnings
- `cmd/comment-checker/main.go` - Filter pipeline (BDD + Directive + Shebang only)

## Step-by-Step Plan

### Step 1: Create feature branch
```bash
git checkout dev
git pull origin dev
git checkout -b fix/comment-checker-note-false-positive
```

### Step 2: Extend CommentCheckerConfigSchema
**File: `src/config/schema/comment-checker.ts`**

Add `allowed_comment_prefixes` field with sensible defaults. This lets users configure which comment prefixes should be treated as legitimate (not AI slop).

### Step 3: Add a post-processing filter in cli-runner.ts
**File: `src/hooks/comment-checker/cli-runner.ts`**

After the Go binary returns its result, parse the stderr message to identify and suppress comments that match allowed prefixes. The binary's output contains XML like:
```xml
<comments file="/path/to/file.ts">
  <comment line-number="5">// Note: Thread-safe</comment>
</comments>
```

Add a function `filterAllowedComments()` that:
1. Extracts `<comment>` elements from the message
2. Checks if the comment text matches any allowed prefix pattern
3. If ALL flagged comments match allowed patterns, suppress the entire warning
4. If some comments are legitimate and some aren't, rebuild the message without the legitimate ones

### Step 4: Create dedicated filter module
**File: `src/hooks/comment-checker/allowed-prefix-filter.ts`** (new)

Extract the filtering logic into its own module per the 200 LOC / single-responsibility rule.

### Step 5: Pass allowed_comment_prefixes through the hook chain
**File: `src/hooks/comment-checker/hook.ts`**

Thread the `allowed_comment_prefixes` config from `createCommentCheckerHooks()` down to `processWithCli()` and `processApplyPatchEditsWithCli()`.

### Step 6: Add test cases
**File: `src/hooks/comment-checker/allowed-prefix-filter.test.ts`** (new)

Test cases covering:
- `// Note: Thread-safe implementation` - should NOT be flagged (false positive)
- `// NOTE: See RFC 7231 for details` - should NOT be flagged
- `// Note: changed from X to Y` - SHOULD still be flagged (genuine AI slop)
- `// TODO: implement caching` - should NOT be flagged
- `// FIXME: race condition` - should NOT be flagged
- `// HACK: workaround for upstream bug` - should NOT be flagged
- `// Added new validation logic` - SHOULD be flagged
- Custom allowed patterns from config

**File: `src/hooks/comment-checker/cli-runner.test.ts`** (new or extend cli.test.ts)

Integration-level tests for the post-processing pipeline.

### Step 7: Verify
```bash
bun test src/hooks/comment-checker/
bun run typecheck
```

### Step 8: Commit and push
```bash
git add -A
git commit -m "fix(comment-checker): add allowed-prefix filter to reduce false positives on Note: comments"
git push -u origin fix/comment-checker-note-false-positive
```

### Step 9: Create PR
```bash
gh pr create --title "fix(comment-checker): reduce false positives for legitimate Note: comments" --body-file /tmp/pr-body.md --base dev
```

### Step 10 (Follow-up): Upstream Go binary fix
File an issue or PR on `code-yeongyu/go-claude-code-comment-checker` to:
1. Relax `(?i)^[\s#/*-]*note:\s*\w` to be more specific (e.g., `note:\s*(changed|modified|updated|added|removed|implemented|refactored)`)
2. Add a dedicated `LegitimateCommentFilter` to the filter pipeline in `main.go`
3. Support `--allow-prefix` CLI flag for external configuration
