## Summary

- Add `allowed_comment_prefixes` config to `CommentCheckerConfigSchema` with sensible defaults (Note:, TODO:, FIXME:, HACK:, WARNING:, etc.)
- Add post-processing filter in `allowed-prefix-filter.ts` that suppresses false positives from the Go binary's output before appending to tool output
- Add 11 test cases covering false positive scenarios (Note:, TODO:, FIXME:, case-insensitivity, mixed comments, agent memo header suppression)

## Problem

The comment-checker hook's upstream Go binary (`go-claude-code-comment-checker`) flags ALL non-filtered comments as problematic. Its `AgentMemoFilter` regex `(?i)^[\s#/*-]*note:\s*\w` classifies any `Note:` comment as AI-generated "agent memo" slop, triggering an aggressive warning banner.

This causes false positives for legitimate, widely-used comment patterns:
```typescript
// Note: Thread-safe implementation required due to concurrent access
// NOTE: See RFC 7231 section 6.5.4 for 404 semantics
// Note: This timeout matches the upstream service SLA
```

These are standard engineering documentation patterns, not AI slop.

## Solution

Rather than waiting for an upstream binary fix, this PR adds a configurable **post-processing filter** on the TypeScript side:

1. **Config**: `comment_checker.allowed_comment_prefixes` - array of case-insensitive prefixes (defaults: `note:`, `todo:`, `fixme:`, `hack:`, `warning:`, `important:`, `bug:`, etc.)
2. **Filter**: After the Go binary returns flagged comments, `filterAllowedComments()` parses the XML output and suppresses comments matching allowed prefixes
3. **Behavior**: If ALL flagged comments are legitimate → suppress entire warning. If mixed → remove only the legitimate entries from the XML, keep the warning for actual slop.

Users can customize via config:
```jsonc
{
  "comment_checker": {
    "allowed_comment_prefixes": ["note:", "todo:", "fixme:", "custom-prefix:"]
  }
}
```

## Test Plan

- 11 new test cases in `allowed-prefix-filter.test.ts`
- Updated assertion in `hook.apply-patch.test.ts` for new parameter
- `bun test src/hooks/comment-checker/` passes
- `bun run typecheck` clean
