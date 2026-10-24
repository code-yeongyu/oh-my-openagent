# QA transcript — issue #6303 (isolated real-surface QA)

Date: 2026-08-26
Worktree: /home/viprix/projects/oom-wt-6303
Branch: fix/boulder-continuation-compaction-loop-6303

## Environment isolation

- Sandbox helper: `source script/agent/qa-sandbox.sh` (repo-sanctioned).
- Sandbox root: `/tmp/omo-qa-sandbox.ukdkmo` (fresh mktemp dir).
- Exported for the spawned opencode: `XDG_DATA_HOME`, `XDG_CONFIG_HOME`,
  `XDG_CACHE_HOME`, `XDG_STATE_HOME` -> sandbox dirs; `HOME` -> `$OMO_QA_ROOT/home`;
  `OPENCODE_DISABLE_AUTOUPDATE=1`, `OPENCODE_DISABLE_MODELS_FETCH=1`.
- Plugin wired via sandbox-only config
  `$XDG_CONFIG_HOME/opencode/opencode.json` ->
  `"plugin": ["file:///home/viprix/projects/oom-wt-6303/dist/index.js"]`
  (dist built from this worktree with the fix, `bun run build`, exit 0).

## Isolation proof

1. Sandbox opencode log
   (`$OMO_QA_ROOT/data/opencode/log/opencode.log`) shows config loaded ONLY from
   sandbox paths:
   - `loading path=/tmp/omo-qa-sandbox.ukdkmo/config/opencode/config.json`
   - `loading path=/tmp/omo-qa-sandbox.ukdkmo/config/opencode/opencode.json`
   No read of the host `~/.config/opencode`.
2. Sandbox DB session count after the run: `session count: 1`
   (exactly the one QA session created by this run; counted via bun:sqlite,
   sqlite3 CLI not installed on this machine).
3. Host `~/.local/share/opencode/opencode.db`: size/mtime recorded before and
   after (`real-db-stat-before.txt` / `real-db-stat-after.txt`). The file DID
   change during the window, but the host is running several concurrent live
   opencode sessions of its own (visible as continuous host activity in the
   shared `/tmp/oh-my-opencode.log`), so the delta is NOT attributable to this
   QA run. Primary isolation proof is items 1-2: the spawned process used the
   sandbox data dir exclusively.
4. Nothing under the real `~/.omo`, `~/.senpi`, `~/.config/opencode`,
   `~/.codex`, `~/.cache/opencode` was read or written by the QA spawn
   (sandbox HOME + XDG vars; sandbox config was the one loaded, see item 1).

## What was tested on the real surface

Command:

    cd /tmp/opencode/issue-6303 && timeout 90 opencode run "reply with exactly: qa-ok" --format json

Observed:

- Real opencode 1.18.23 booted with the worktree-built plugin bundle
  (dist/index.js includes this fix; build exit 0, see `qa-build.txt`).
- Session created: `ses_fc2b682ddffe4RaWcdW4tG7NJV` (sandbox DB, count 1).
- The plugin executed inside the sandbox: it wrote
  `$OMO_QA_ROOT/data/opencode/storage/oh-my-openagent/tui-state/e1cdef9ba00dd5d7.json`
  (plugin-owned storage layout), proving the bundled hook graph initialized
  and ran against the real server.
- The prompt failed fast with a structured error event on the wire (no provider
  credentials in the sandbox):
  `{"type":"error",...,"error":{"name":"UnknownError","data":{"message":"Unexpected server error..."}}}`
  This exercises the same `session.error` delivery path the fix classifies.

## What was omitted, and why

- A live reproduction of the Anthropic 400 `tool_use`/`tool_result` compaction
  failure requires provider credentials plus a tool-heavy history large enough
  to trigger opencode auto-compaction. Not available/safe in this environment.
  Compensating coverage: `atlas/compaction-loop-guard.test.ts` drives the REAL
  composed atlas handler (`createAtlasHook`) end-to-end with the exact reported
  error payload (HTTP 400, `isRetryable: false`, orphaned `tool_use` message),
  asserting no continuation injection on error and on the following idle, plus
  resume-after-user-message and transient-retry-preserved semantics.
- TUI smoke was skipped: the changed behavior is an event-path guard with no
  visual surface; boot health is covered by the successful real boot above.
