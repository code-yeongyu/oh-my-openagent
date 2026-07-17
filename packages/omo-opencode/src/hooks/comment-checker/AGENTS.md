# src/hooks/comment-checker/ (AI Slop Comment Blocker)

**Generated:** 2026-07-17 (7d664b96b)

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
tool.execute.before (write | edit | multiedit)
  → register pending call (filePath + old/new strings) keyed by callID
tool.execute.after (same callID, or apply_patch)
  → take pending call (or extract apply_patch edits from metadata)
  → resolve comment-checker CLI path (node_modules / PATH / cached download)
  → run CLI on changed content, parse JSON findings (line ranges + category)
  → if findings → inject tool-level error → agent must fix
```

## KEY FILES

| File | Purpose |
|------|---------|
| `hook.ts` | `createCommentCheckerHooks()`: main factory. `tool.execute.before` registers pending calls; `tool.execute.after` runs the CLI check. Accepts an optional `cliRunner` for dependency injection (defaults to `cli-runner.ts` exports) |
| `cli-runner.ts` | CLI orchestration: resolve path, `processWithCli` / `processApplyPatchEditsWithCli`, per-session dedup, run lock |
| `cli.ts` | Resolve `comment-checker` binary path (node_modules / PATH / cached download), spawn `runCommentChecker` |
| `downloader.ts` | Download + cache the binary (`getCachedBinaryPath`, `ensureCommentCheckerBinary`) |
| `initialization-gate.ts` | `ensureCommentCheckerInitialization()`: run CLI init once |
| `pending-calls.ts` | Pending-call registry between `tool.execute.before` and `after` (TTL cleanup) |
| `types.ts` | `PendingCall` and config types |

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

Prefix with `// @allow` or mark file scope with `// comment-checker-disable-file` at top. Use sparingly; it defeats the purpose.

## RELATED

- Doctor check: `src/cli/doctor/checks/tools.ts` verifies `comment-checker` binary availability
- Postinstall: `postinstall.mjs` downloads binary if missing
