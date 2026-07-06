# Issue 5788 Ultrawork Notepad

## Bootstrap
- Tier: LIGHT. One narrow pure-function bug fix in an existing TypeScript resolver; no new module, schema, auth, persistence, concurrency, or design decision.
- Skills used:
  - `omo-programming`: required for TypeScript edits and failing-first discipline.
  - `opencode-qa`: consulted to confirm this model-core-only resolver change does not require broader OpenCode harness QA; no OpenCode process/hook/TUI surface is touched.
  - `git-master`: required for history inspection, commit, push, and PR.
  - `commit`: required for atomic commit creation.
- Explicitly skipped `work-with-pr`: its fresh-worktree workflow conflicts with the user's instruction to work only in this pre-created worktree/branch.

## Success Criteria
- Regression test: `resolveActualContextLimit("anthropic", "claude-sonnet-5", ...) === 1_000_000` fails before product code changes.
- Product fix: only add `sonnet` to the anchored 5-family alternation.
- Verification: `bun test packages/model-core`, `bun run typecheck`, and before/after resolver-output captures are written under this evidence directory.
- Delivery: atomic commit pushed to `sisyphus-bot/fix-5788`, PR targets `dev`, and auto-merge is enabled with merge commit semantics.

## Findings
- `bash script/agent/setup.sh` was run before repository reads/edits. It failed during build because strict Codex plugin materialization reran submodule init and Git rejected local `file` transport for `packages/shared-skills/upstreams/taste-skill` and `ui-ux-pro-max`. This is bootstrap infrastructure noise, not part of the model-core defect.
- Local resolver currently recognizes `claude-(fable|mythos)-5` but not `claude-sonnet-5`.
- `git log -- packages/model-core/src/context-limit-resolver.ts` shows prior fix `d4c5226ac fix(model-core): add claude-fable-5 and claude-mythos-5 to hasGA1MContext`.

## Self-Review
- Scope stayed mechanical: one regression assertion and one alternation entry.
- TypeScript strict scan passed with no `any`, assertions, non-null assertions, or suppressed errors.
- Pure LOC check passed: `context-limit-resolver.ts` 40, `context-limit-resolver.test.ts` 131, resolver evidence script 7.
- No broader harness QA was added because the changed behavior is a pure resolver output and the requested real-surface script exercises that output directly.
