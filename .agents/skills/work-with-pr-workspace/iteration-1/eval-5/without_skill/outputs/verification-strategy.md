# Verification Strategy

## 1. Unit Tests

### New test file: `allowed-prefix-filter.test.ts`
Run: `bun test src/hooks/comment-checker/allowed-prefix-filter.test.ts`

| # | Scenario | Input | Expected |
|---|----------|-------|----------|
| 1 | Only Note: comments (default prefixes) | `// Note: Thread-safe`, `// NOTE: See RFC` | `hasRemainingComments: false`, empty message |
| 2 | Only TODO/FIXME/HACK (default prefixes) | `// TODO: impl`, `// FIXME: race`, `# HACK: workaround` | Suppressed |
| 3 | Only AI slop comments | `// Added validation`, `// Refactored for perf` | Full message preserved |
| 4 | Mixed legitimate + slop | `// Note: Thread-safe`, `// Changed from old to new` | Message kept, Note: entry removed from XML |
| 5 | Case-insensitive Note: | `// note: lowercase test` | Suppressed |
| 6 | Hash-prefixed comments | `# Note: Python`, `# TODO: something` | Suppressed (prefix stripped before matching) |
| 7 | Security: prefix | `// Security: validate input` | Suppressed |
| 8 | Warning: prefix | `// WARNING: mutates input` | Suppressed |
| 9 | Empty allowed prefixes | `// Note: should pass through` | Full message preserved (no filtering) |
| 10 | Custom prefix | `// PERF: O(n log n)` with `["perf:"]` | Suppressed |
| 11 | Agent memo header + Note: | Full agent memo banner + `// Note: Thread-safe` | Entire message suppressed including banner |

### Existing test: `hook.apply-patch.test.ts`
Run: `bun test src/hooks/comment-checker/hook.apply-patch.test.ts`

Verify the updated mock assertion accepts the new `allowedPrefixes` array parameter.

### Existing test: `cli.test.ts`
Run: `bun test src/hooks/comment-checker/cli.test.ts`

Verify no regressions in binary spawning, timeout, and semaphore logic.

## 2. Type Checking

```bash
bun run typecheck
```

Verify:
- `CommentCheckerConfigSchema` change propagates correctly to `CommentCheckerConfig` type
- All call sites in `hook.ts` and `cli-runner.ts` pass the new parameter
- `filterAllowedComments` return type matches usage in `cli-runner.ts`
- No new type errors introduced

## 3. LSP Diagnostics

```bash
# Check all changed files for errors
lsp_diagnostics src/config/schema/comment-checker.ts
lsp_diagnostics src/hooks/comment-checker/allowed-prefix-filter.ts
lsp_diagnostics src/hooks/comment-checker/cli-runner.ts
lsp_diagnostics src/hooks/comment-checker/hook.ts
lsp_diagnostics src/hooks/comment-checker/allowed-prefix-filter.test.ts
```

## 4. Full Test Suite

```bash
bun test src/hooks/comment-checker/
```

All 4 test files should pass:
- `cli.test.ts` (existing - no regressions)
- `pending-calls.test.ts` (existing - no regressions)
- `hook.apply-patch.test.ts` (modified assertion)
- `allowed-prefix-filter.test.ts` (new - all 11 cases)

## 5. Build Verification

```bash
bun run build
```

Ensure the new module is properly bundled and exported.

## 6. Integration Verification (Manual)

If binary is available locally:

```bash
# Test with a file containing Note: comment
echo '{"session_id":"test","tool_name":"Write","transcript_path":"","cwd":"/tmp","hook_event_name":"PostToolUse","tool_input":{"file_path":"/tmp/test.ts","content":"// Note: Thread-safe implementation\nconst x = 1"}}' | ~/.cache/oh-my-opencode/bin/comment-checker check
echo "Exit code: $?"
```

Expected: Binary returns exit 2 (comment detected), but the TypeScript post-filter should suppress it.

## 7. Config Validation

Test that config changes work:

```jsonc
// .opencode/oh-my-opencode.jsonc
{
  "comment_checker": {
    // Override: only allow Note: and TODO:
    "allowed_comment_prefixes": ["note:", "todo:"]
  }
}
```

Verify Zod schema accepts the config and defaults are applied when field is omitted.

## 8. Regression Checks

Verify the following still work correctly:
- AI slop comments (`// Added new feature`, `// Refactored for performance`) are still flagged
- BDD comments (`// given`, `// when`, `// then`) are still allowed (binary-side filter)
- Linter directives (`// eslint-disable`, `// @ts-ignore`) are still allowed (binary-side filter)
- Shebangs (`#!/usr/bin/env node`) are still allowed (binary-side filter)
- `custom_prompt` config still works
- Semaphore prevents concurrent comment-checker runs
- Timeout handling (30s) still works

## 9. Edge Cases to Watch

- Empty message from binary (exit code 0) - filter should be no-op
- Binary not available - hook gracefully degrades (existing behavior)
- Message with no `<comment>` XML elements - filter passes through
- Very long messages with many comments - regex performance
- Comments containing XML-special characters (`<`, `>`, `&`) in text
