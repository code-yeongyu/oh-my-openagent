# OBSERVED (20260910-byte-stable, worktree wt-byte-stable)

* Golden gate: 6 pass, 0 fail, 18 expect() calls. Fixtures
  (`registry_export.json`, `messages_transform.json`, `model_switch.json`)
  match bytes without `UPDATE_GOLDEN=1`. Full text: `golden-test-output.txt`.
* Neighbor suites: 20 pass, 0 fail, 41 expect() calls across 6 files.
  Full text: `scoped-suites-output.txt`.
* Typecheck: exit 0, zero output. Full text: `typecheck-output.txt`.
* opencode-qa `common.sh --self-check`: sandbox checks pass (free port,
  XDG sandbox auto-removed, HOME isolation preserved). Two failures, both
  environmental: `sqlite3` binary absent on this machine, so `oqa_db_path`
  returns empty. Full text: `common-selfcheck-output.txt`.
* opencode-qa `sse-hook-probe.sh --self-test`: FAIL, server did not start.
  The `opencode` shim on PATH (`~/.bun/bin/opencode` resolving into
  `/home/victor/opencode`) crashes under node 24 with
  `ReferenceError: require is not defined in ES module scope`. Pre-existing
  environment defect, unrelated to this change. Full text:
  `sse-selftest-output.txt`.
* opencode-qa `server-smoke.sh --self-test`: FAIL at readiness for the same
  broken-shim reason. Full text: `server-smoke-output.txt`.

Isolation proof: no live opencode server ever started (both probes failed
before serving), so zero sessions could be written. The only passing
sandbox assertion that ran (`common.sh`: isolated XDG sandbox auto-removed
on exit) confirms the harness cleans up after itself. No `opencode run`,
prompt, or DB write was attempted. Session count is unchanged because no
session operation occurred; `sqlite3` absence means a count query was not
possible, recorded as a gap in `04-omitted.md`. Summary: `isolation-proof.txt`.
