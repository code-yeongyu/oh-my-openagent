# PR: fix(comment-checker): relax regex to stop flagging legitimate Note: comments

**Title:** `fix(comment-checker): relax regex to stop flagging legitimate Note: comments`
**Base:** `dev`
**Branch:** `fix/comment-checker-note-false-positive`

---

## Summary

- Add `exclude_patterns` config to comment-checker schema, allowing users to whitelist comment prefixes (e.g. `["^Note:", "^TODO:"]`) that should not be flagged as AI slop
- Thread the exclude patterns through `cli-runner.ts` and `cli.ts` to the Go binary via `--exclude-pattern` flags
- Add test cases covering false positive scenarios: legitimate technical notes, RFC references, and AI memo detection with/without exclusions

## Context

The comment-checker Go binary (`go-claude-code-comment-checker` v0.4.1) contains the regex `(?i)^[\s#/*-]*note:\s*\w` which matches ALL comments starting with "Note:" followed by a word character. This produces false positives for legitimate technical comments:

```typescript
// Note: Thread-safe by design          <- flagged as AI slop
# Note: See RFC 7231 for details        <- flagged as AI slop
// Note: This edge case requires...     <- flagged as AI slop
```

These are standard engineering comments, not AI agent memos.

## Changes

| File | Change |
|------|--------|
| `src/config/schema/comment-checker.ts` | Add `exclude_patterns: string[]` optional field |
| `src/hooks/comment-checker/cli.ts` | Pass `--exclude-pattern` flags to binary |
| `src/hooks/comment-checker/cli-runner.ts` | Thread `excludePatterns` through `processWithCli` and `processApplyPatchEditsWithCli` |
| `src/hooks/comment-checker/hook.ts` | Pass `config.exclude_patterns` to CLI runner calls |
| `src/hooks/comment-checker/cli.test.ts` | Add 6 new test cases for false positive scenarios |
| `src/hooks/comment-checker/hook.apply-patch.test.ts` | Add test verifying exclude_patterns config threading |

## Usage

```jsonc
// .opencode/oh-my-opencode.jsonc
{
  "comment_checker": {
    "exclude_patterns": ["^Note:", "^TODO:", "^FIXME:"]
  }
}
```

## Related

- Go binary repo: `code-yeongyu/go-claude-code-comment-checker` (needs corresponding `--exclude-pattern` flag support)
