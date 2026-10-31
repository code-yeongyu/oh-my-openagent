# QA evidence - issue 6304 (PostToolUse LSP hook blocks edits in sibling Git worktrees)

Date: 2026-08-26. Worktree: <repo-root> (branch fix/lsp-hook-worktree-edits-6304, base origin/dev 8c57e463e).

## WHAT WAS TESTED

1. **Live ground-truth matrix on unmodified dev** (before any edit), driving the real built
   component CLI (`dist/cli.js hook post-tool-use`) with the real shared daemon and a real
   typescript-language-server, sandbox repo + sibling `git worktree` under
   /tmp/opencode/issue-6304/:

   | Case | Observed |
   |------|----------|
   | in-cwd broken .ts | block with real TS2322 diagnostic |
   | sibling worktree broken .ts | block with real TS2322 diagnostic (no opaque scope error) |
   | sibling worktree clean .ts | silent |
   | sibling worktree .md | silent (not_configured classified before any scope error) |
   | unrelated external dir broken .ts | block with real diagnostic |
   | symlink escape to sibling file | block with real diagnostic |

   Conclusion: the historically reported opaque failure is currently masked on dev by the
   lsp-core read-only outside-cwd relaxation (8d58e75c6, first shipped v5.0.0-beta.11; the
   reporter's 4.19.1 predates it). The residual defect is that the hook still converts ANY
   containment-rejection text into `decision: "block"` - nothing in the hook vertical
   guarantees or tests the issue's required non-blocking behavior.

2. **TDD RED->GREEN for the hook-level guard** (`test/codex-hook-outside-cwd.test.ts`):
   RED log shows 4 failing tests against unmodified src (containment rejection blocked,
   classifier missing); GREEN log shows 5/5 after the fix.

3. **Post-fix live matrix re-run** (qa-transcript.txt): identical non-regressed behavior;
   sibling-worktree edits keep producing real diagnostics or silence, never an opaque scope
   failure.

4. **Gates x2 on the identical final tree** (gates-run1-tests.txt, gates-run2-tests.txt):
   component suite vitest 29/29 + node script tests 8/8; `tsgo --noEmit` exit 0 on the
   component tsconfig; `git diff --check` clean; hygiene grep zero hits on changed paths;
   biome check clean on changed files.

## WHY IT IS SUFFICIENT

- The guard is pinned at the exact seam the issue targets: `runLspPostToolUseHook` can no
  longer emit a blocking PostToolUse result whose reason is the LSP request-cwd containment
  rejection, regardless of which layer produced that text (current daemon, older daemon
  build served from a stale runtime, or a future regression).
- Real-surface runs prove the normal paths are untouched: diagnostics still flow for
  sibling worktrees (rooted by findWorkspaceRootOutsideContext), unsupported extensions stay
  silent, mutations stay confined (lsp-core tests unchanged).
- The rejection is deliberately NOT cached per extension (scope mismatch is per-file);
  pinned by the no-cache test.

## ISOLATION INCIDENT (found and fixed during QA)

The first version of the new tests passed `session_id` without isolating `PLUGIN_DATA`, so
`writeLspPostEditCache` fell back to the REAL `~/.codex/codex-lsp/sessions/` and wrote four
state files there (mtime Aug 26 04:07-04:09). Remediation: the four files were deleted and
the recreated empty `sessions/` directory removed (`~/.codex/codex-lsp/` restored to its
prior contents: only the pre-existing `daemon/` dir); the tests were rewritten - session_id
dropped where state semantics are irrelevant, and the cache-semantics test now uses a temp
PLUGIN_DATA harness (same pattern as codex-hook-unavailable.test.ts). Re-runs verified no
further writes outside the sandbox. All hook/daemon QA commands ran with isolated HOME,
CODEX_HOME, PLUGIN_DATA, OMO_LSP_DAEMON_DIR and XDG_* dirs under /tmp/opencode/issue-6304/.

## WHAT WAS OMITTED / REDACTED

- No live Codex app-server session was driven; the hook was exercised through its real CLI
  entry with production-shaped stdin payloads (the same surface Codex spawns). Daemon spawn,
  socket auth, LSP server lifecycle and diagnostics freshness were all exercised for real.
- Absolute home paths inside logs are redacted to `~`; no tokens or credentials appear in
  any artifact (sandbox used no auth material).
- Per-worktree project LSP config re-rooting (raised by issue commenters) is out of scope;
  documented in plan.md.
