# Plan: issue 6304 - PostToolUse LSP hook blocks edits in sibling Git worktrees

## Verified ground truth (live, current dev 8c57e463e)

Driven end-to-end through the real built CLI (`dist/cli.js hook post-tool-use`) with a real
daemon + real typescript-language-server, sandbox under /tmp/opencode/issue-6304/:

| Case | Observed on dev |
|------|-----------------|
| in-cwd broken .ts | block with REAL TS2322 diagnostic (correct) |
| sibling worktree broken .ts | block with REAL TS2322 diagnostic (read-only outside-cwd fix 8d58e75c6 works) |
| sibling worktree clean .ts | silent |
| sibling worktree .md | silent (not_configured classified before any scope error) |
| unrelated external dir .ts | block with real diagnostic (read-only policy) |
| symlink escape to sibling | block with real diagnostic (lexical read policy b75406420) |

So the historically reported opaque failure is currently masked by the lsp-core read-only
relaxation. The remaining defect is structural:

## Root cause of the residual defect

`runLspPostToolUseHook` converts EVERY collected diagnostics text into `decision: "block"`.
The only suppression is `isLspDaemonUnreachableDiagnostics`. A request-cwd containment
rejection (`LSP file path must be inside request cwd: <path>`, thrown by
`resolvePathInsideContext` in packages/lsp-core/src/lsp/client-wrapper.ts:77 and surfaced as
bare error text with no details by handleToolCall) would again become an opaque blocking
PostToolUse result for an automatic post-edit hook. That is precisely the failure mode
issue 6304 forbids: "the hook should avoid returning an opaque blocking failure" for files
outside the request CWD. Nothing in the hook vertical guarantees or tests this today; all
existing hook tests inject runners and never pin scope-mismatch handling.

## Change (minimal, Codex lsp component only)

1. `src/codex-hook.ts`: add `isRequestCwdRejectionDiagnostics(text)` matching the exact LSP
   core containment-rejection message prefix, and filter such blocks out next to the
   daemon-unreachable filter. Per-file, deliberately NOT cached per extension (scope
   mismatch is not an extension-wide property). Silent skip matches the established
   suppression precedents (42d8a1f33, 8f61bfab3): the edit already succeeded, diagnostics
   are unavailable for that path, and blocking would only inject noise.
2. `test/codex-hook-outside-cwd.test.ts` (new): given/when/then tests pinning
   - containment rejection -> no blocking output,
   - mixed batch (real error + rejection) -> only the real error blocks,
   - rejection does not poison later edits (no caching),
   - guard precision (similar-but-different error text still blocks).

## Verification

- RED first: new tests fail against unmodified src (rejection currently blocks); log saved.
- GREEN after fix.
- Gates x2 on identical final tree: component vitest suite, `bunx tsgo --noEmit` on the
  component tsconfig, `git diff --check`, hygiene grep on changed paths.
- Real-surface QA matrix re-run under /tmp/opencode/issue-6304/ with isolated HOME /
  CODEX_HOME / PLUGIN_DATA / OMO_LSP_DAEMON_DIR / XDG dirs; real ~/.codex, ~/.omo,
  ~/.config/opencode untouched.

## Out of scope (documented)

- Per-worktree project LSP config re-rooting (llc1123's note) - larger context-policy change.
- Daemon timeout/cancel texts still blocking - pre-existing policy, not scope mismatch.
- OpenCode Web/Desktop CWD issues (#6207, #6221, #6227).
