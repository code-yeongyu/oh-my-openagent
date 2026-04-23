# src/hooks/comment-checker/ — AI Slop Comment Blocker

**Generated:** 2026-04-18

## OVERVIEW

Tool Guard tier hook. Runs after `write`/`edit` tools to detect AI-generated comment patterns in code and block them before they land. Backed by `@code-yeongyu/comment-checker` binary (trusted dependency).

## WHAT IT BLOCKS

AI slop comment smells:
- Restating what code literally does (`// increment counter`)
- Filler phrases (`// obviously`, `// clearly`, `// simply`)
- Decorative separators without purpose
- JSDoc on trivially-named functions
- `// TODO:` without context
- Comments contradicting surrounding code

See `@code-yeongyu/comment-checker` for the authoritative blocklist.

## EXECUTION FLOW

```
tool.execute.after (write | edit | hashline edit)
  → extract changed lines from tool output
  → spawn comment-checker binary with changed file path
  → parse findings (line ranges + violation category)
  → if findings → inject tool-level error → agent must fix
```

## KEY FILES

| File | Purpose |
|------|---------|
| `hook.ts` | `createCommentCheckerHook()` — main factory, tool.execute.after handler |
| `comment-checker-runner.ts` | Spawn binary, parse JSON output |
| `changed-line-extractor.ts` | Extract which lines changed from tool result |
| `findings-formatter.ts` | Format violations as actionable error message |
| `binary-resolver.ts` | Locate `comment-checker` binary (node_modules + PATH) |

## CONFIG

```jsonc
// oh-my-opencode.jsonc
{
  "comment_checker": {
    "enabled": true,      // default: true
    "severity": "error"   // error blocks, warning notifies only
  }
}
```

Disable via `"disabled_hooks": ["comment-checker"]`.

## BYPASS FOR LEGITIMATE COMMENTS

Prefix with `// @allow` or mark file scope with `// comment-checker-disable-file` at top. Use sparingly — defeating the purpose.

## RELATED

- Doctor check: `src/cli/doctor/checks/tools.ts` verifies `comment-checker` binary availability
- Postinstall: `postinstall.mjs` downloads binary if missing
