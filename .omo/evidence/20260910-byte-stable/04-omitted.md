# OMITTED (20260910-byte-stable, worktree wt-byte-stable)

* Live server probe (`server-smoke.sh --self-test`): not passed. The
  `opencode` binary on PATH is broken (node-24 ESM `require` crash, raw log
  in `server-smoke-output.txt`). Blocked by environment, not by this change.
  Retry after the shim is repaired; no code in this commit affects serving.
* SSE hook proof (`sse-hook-probe.sh --self-test`): not passed, same broken
  shim (raw log in `sse-selftest-output.txt`). No hook fired or asserted.
  Acceptable here because no hook code changed.
* TUI smoke: not attempted. Same broken shim plus docs-only scope; tmux was
  available but driving a TUI for a markdown commit adds no signal.
* DB session-count query: not possible. `sqlite3` is absent on this machine
  (`common-selfcheck-output.txt` records the missing dependency), so the
  usual before/after `SELECT count(*) FROM session` proof could not run.
  Substitute: no server started and no session command ran, so the count
  cannot have moved. Re-run the count check on a machine with `sqlite3`
  if a reviewer wants the numeric form.
* Regen run (`UPDATE_GOLDEN=1`): intentionally not run. Fixtures already
  match, and an unneeded regen would only rewrite identical bytes.

No secrets, tokens, or private paths appear in these files. Logs are local
test output only.
