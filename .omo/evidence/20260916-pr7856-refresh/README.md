# PR 7856: uncommitted upstream refresh

## Scope and result

Related to #7666; this does not close that issue. This change logs conflict
paths already emitted by the no-clobber migration engine, without their values.
It does NOT restore legacy agents/categories omitted by transformLegacyKeys,
change precedence, or claim migration coverage for all legacy settings.
The existing injected agents.sisyphus.model unit case tests the logging seam,
not the actual legacy transform. No source changes beyond the original PR.

Fresh branch: maintenance/pr7856-refresh-20260916-st01a0aaf4.
Original PR head: ff85cb0b2881c5bb9b8848482e8460072d25f703.
Merged origin/dev: 776c4668d12976f816cd7c580ac7728e313d0029.
Plan was successfully written using apply_patch by the lead and read before
merge. Merge used command-only user.name=MoerAI and
user.email=friendnt@g.skku.edu, --no-commit --no-ff. No commits or remote writes.

## Verified gates

- Host Bun 1.4.0 (34cbb9a40), exact required binary; Node v24.18.0 from node@24.
- Focused factory, startup and migration tests: 75 pass, 0 fail, 265 assertions,
  18 files, one run. See tests.txt.
- Full bun run typecheck: exit 0, including root, scripts and package compilers.
- Full bun run build: exit 0, all steps completed.
- First bun install --frozen-lockfile ran prepare and failed because local
  submodule file transport was forbidden. Recovery used command-scoped
  GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=protocol.file.allow
  GIT_CONFIG_VALUE_0=always for the full build. No persistent Git config edit.
- LSP requests for both changed files were refused by the tool because the
  sibling worktree is outside its request cwd. Compiler checks passed; do not
  label the unavailable LSP check as passing.
- Schema parse of both synthetic plugin configs and the unified layer passed.
- node --check live-replay.mjs passed; PR delta git diff --cached --check
  origin/dev passed before evidence staging.
- After staging the exact SSE capture, that whitespace check reports
  events.sse:6: new blank line at EOF (exit 2). This is the required final SSE
  frame delimiter; it is retained as captured rather than silently altered.

## Real factory receipt

OpenCode 1.18.30 served inside disposable omo-qa:latest Docker, with the
sole plugin file:///plugin/dist/index.js built from this integration.
No factory overrides, stub logger, model turn, private skills, auth or real
config mounts were used. Node in the container was v24.18.0. Container Bun
1.3.12 only installed the pinned OpenCode package; all source tests, compiler
and build ran with host Bun 1.4.0.

The driver subscribed to /global/event and awaited server.connected before
GET /config initialized the actual factory. The returned config contains
the sole plugin and Sisyphus agents. Exact events.sse captures the migration
toast: Migrated 1 legacy source. Kept 2 existing values.

disabled_tools is schema-valid but is omitted by the current migration
allowlist, so it cannot exercise this path. The synthetic fixtures instead
use retained, schema-valid disabled_providers arrays and model_fallback
booleans. There was no initial _migrations marker.

startup-completed.log is the exact production entry, not a reconstruction:
skippedConflictCount=2; skippedConflictPaths are
[opencode].disabled_providers and [opencode].model_fallback. Its payload has
only journalResumed, migratedFrom, skippedConflictCount and
skippedConflictPaths. Neither provider sentinel nor legacy=/kept= appears.
The boolean values also have no payload field in this entry. The target kept
its original array and false flag, and migration markers were written.
live-report.json records all assertions. The log file watcher was subscribed
before triggering the factory; waits use exact signals with bounded timeout,
not fixed sleeps or polling. Prior unsuccessful QA is not counted as passing.

## Isolation and artifact policy

Host opencode session count: 8104 before and 8104 after (read-only SQLite).
Container isolated session count: 0. HOME, OPENCODE_TEST_HOME and all XDG
paths were synthetic /qa/migration paths. mounts.json records the complete
mount list with only the host worktree prefix replaced by <WORKTREE>:
read-only built dist and zod, plus this evidence directory for outputs.
No host home, config, skills, auth or DB mount. Container stopped and removed.

The lead replay added an explicit bounded await for the already-subscribed
migration toast, then passed again with the same count/path/value assertions
and 8104 -> 8104 host session count. That disposable run additionally mounted
the public root package.json read-only; it was auto-removed after completion.
The preserved mounts.json describes the initial run.

Only allowlisted sanitized evidence is staged. *.raw.txt and factory.raw.log
remain local and untracked; do not publish them. They may include verbose
runtime/build information outside this proof. Tests.txt contains synthetic
test names only. No personal skill content is included in staged evidence.
Build-generated Codex/Senpi deltas were restored from the merge index.
An upstream historical ANSI transcript remains reported dirty solely due to
its indexed CRLF versus text/eol=lf attributes; ignore-space-at-eol shows no
change. It was not staged or modified for this PR.

Built dist/index.js SHA256:
c8be1c38aa39959fcc75196379fc6aae9040f5d6621fbbe68dc880bca214da35

## Replay

From a worktree with dist built, create a fresh disposable container (never
reuse /qa/migration because this intentionally tests a missing marker):

```sh
docker run -d --name pr7856-replay --network bridge --entrypoint bash \
  -v "$PWD/dist:/plugin/dist:ro" \
  -v "$PWD/node_modules/zod:/plugin/node_modules/zod:ro" \
  -v "$PWD/.omo/evidence/20260916-pr7856-refresh:/evidence" \
  omo-qa:latest -lc "exec tail -f /dev/null"
docker exec -u root pr7856-replay bash -lc 'mkdir -p /qa/runtime /qa/home /qa/config /qa/data /qa/state /qa/cache; cd /qa/runtime; HOME=/qa/home XDG_CONFIG_HOME=/qa/config XDG_DATA_HOME=/qa/data XDG_STATE_HOME=/qa/state XDG_CACHE_HOME=/qa/cache bun add opencode-ai@1.18.30; printf "{\"type\":\"module\"}\n" > /plugin/package.json; ./node_modules/.bin/opencode --version'
docker exec -u root pr7856-replay node /evidence/live-replay.mjs
docker stop --timeout 10 pr7856-replay
docker rm pr7856-replay
```

Read-only host DB counts should bracket replay. The driver writes exact
events, the startup entry, fixtures, config summary and report to /evidence.
Use a separate evidence output directory to preserve this original capture.

## Limitations

Linux arm64 Docker startup/config surface only; no model/provider request,
TUI, Windows live run or broad end-to-end config-migration fix is claimed.
Privacy assertion is for the startup-completed entry, not every log in the
application. Upstream merge spans many unrelated files; focused verification
does not claim full behavioral coverage of every upstream change.
