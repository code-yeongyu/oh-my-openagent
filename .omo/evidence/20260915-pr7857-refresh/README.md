# PR #7857: verified local refresh

Integration prepared on `maintenance/pr7857-refresh-20260915-st01a0a574`:

- Original PR head: `512d2abd5aff4dd6294875d13b00618d664c1759`
- MERGE_HEAD/base: `820b02f040a53750ba5d53fb45d8bdc8d3b6b905`
- Source delta against base: the existing seven PR files, 216 insertions.
  Merge was clean; no production source or test adjustments were necessary.
- At initial handoff, no commit, push, comment, PR mutation, or manual common-config edit was made.
  Main checkout and pre-existing worktrees were not edited.

## Real OpenCode proof

`live-result.json` records OpenCode 1.18.30 driven through HTTP + SSE, using a
local deterministic Responses provider. This is not a generic model-success
check. The real native tool executor called `qa_terminal_child`, which created
and seeded a real child, then invoked the production `executeSyncContinuation`
with the real SDK client and `BackgroundManager`. Its event hook forwarded real
OpenCode events to that manager; no event or poller was mocked.

Assertions in the final replay:

- SSE subscription connected before the child was triggered.
- OpenCode emitted `session.error` for `openai/pr7857-missing`.
- Child database messages were exactly two user messages, zero assistant
  messages. The existing assistant-message error path could not satisfy this.
- The native synchronous tool completed in 10,110 ms, respecting the real
  ten-second fallback grace, rather than the 30-second poll timeout.
- The parent's actual provider request contained a `function_call_output`
  byte-equal to the child's SSE terminal error and persisted native tool output.
- Real database session counts: 8107 before, 8107 after.

The fixture deliberately exposes the production continuation at a narrow native
plugin tool boundary. It does NOT load the full OMO plugin registry, exercise
category/model selection, or prove initial-task dispatch end-to-end. Initial
runner callback wiring is preserved in the inspected PR diff; manager, poller,
and continuation unit tests cover the affected behavior. Recovery grace and
clearing are tested deterministically with the existing fake clock tests.

## Isolation

Docker was available, but the existing dev image had no OpenCode executable.
The permitted rigorously isolated native path used the installed executable
with a newly constructed environment (not a spread of process.env), fresh
HOME and all four XDG directories, fresh TMPDIR, and empty sandbox cwd outside
the repository. Real credentials, configuration and private skill directories
were not mounted or copied. Only public source was bundled into the fixture.
The sole provider key was the public dummy `public-fake-key` for loopback HTTP.
The real database was opened read-only for counts; no real-home OpenCode CLI
was spawned. `live-result.json` lists the exact environment key allowlist.
Raw logs and preserved sandbox locations remain in the local raw directory.

## Commands and results

Commands ran in the fresh worktree with verified Bun 1.4.0 and Node v24.18.0
explicitly selected on PATH. `$QA_BUN`, `$QA_NODE`, `$QA_OPENCODE`, `$QA_REAL_DB`
stand for explicitly selected binaries and the read-only real database path.

```sh
git -c user.name=MoerAI -c user.email=friendnt@g.skku.edu \
  merge origin/dev --no-commit --no-ff
# PASS: clean merge, stopped before committing

bun test packages/omo-opencode/src/features/background-agent/manager.test.ts \
  packages/omo-opencode/src/tools/delegate-task/sync-session-poller.test.ts \
  packages/omo-opencode/src/tools/delegate-task/sync-continuation.test.ts
# PASS in one run: 243 pass, 0 fail, 759 assertions

node node_modules/@typescript/native-preview/bin/tsgo \
  --noEmit -p packages/omo-opencode/tsconfig.json
# PASS: exit 0

GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=protocol.file.allow \
  GIT_CONFIG_VALUE_0=always bun run build
# PASS: build: all steps completed

node --check .omo/evidence/20260915-pr7857-refresh/replay.mjs
# PASS; probe TS also passed a scoped compiler config importing the
# adapter tsconfig, terminal-probe.ts and existing markdown-modules.d.ts.

QA_RAW="$PWD/.local-ignore/pr7857-raw/replay" \
  "$QA_NODE" .omo/evidence/20260915-pr7857-refresh/replay.mjs
# Export QA_BUN, QA_NODE, QA_OPENCODE and QA_REAL_DB before replaying.
# Final recorded run PASS: real error -> synchronous caller + database proof.

git diff --cached origin/dev --stat
git diff --cached origin/dev -- packages/omo-opencode/src
```

## Failures retained, not hidden

- `bun install --frozen-lockfile` installed dependencies, then its prepare build
  failed with `fatal: transport 'file' not allowed` during submodule materializing.
  The explicit full build succeeded using the authorized command-scoped setting;
  no permanent Git setting was changed and install was not claimed successful.
- First compiler command mistakenly targeted `bin/tsgo.js`: `MODULE_NOT_FOUND`.
  Inspection found the real `bin/tsgo` entry; the adapter compiler then passed.
- LSP diagnostics were requested for all seven PR files but the tool rejected
  every sibling path: `LSP file path must be inside request cwd`. Adapter compiler
  diagnostics substitute for production files; tests executed under Bun.
- Supplemental fixture-only compiler setup initially omitted the repository's
  Markdown ambient declaration (`TS2307`); a broad include then inadvertently
  checked adapter test fixtures (1,659 diagnostic output lines, e.g. `TS2741`
  missing `experimental_workspace` and `TS2739` incomplete `ToolContext`).
  The final fixture-plus-existing-ambient scope passed. No source, tests, or
  type declarations were weakened or changed to clear those setup errors.
- Live attempt 1 failed before server startup: `EEXIST` because the isolated
  version command had already created `config/opencode`. Setup now uses
  recursive mkdir. Attempt 2 passed SSE/caller assertions. Attempt 3 added and
  passed database, byte-equality, grace, and automatic real-DB isolation asserts.
  Three initial child attempts. A later QA-only event-synchronization improvement was replayed once and passed.

## Review artifacts and limits

`terminal-probe.ts` + `replay.mjs` are the public reproduction. `live-result.json`
is the audited event/caller/database capture. `verification.json` records gates
and raw-log hashes; `test-summary.txt` is the actual test-command summary.
`validation-output.txt` publishes the actual test, compiler and full-build output with machine path prefixes and trailing console whitespace normalized. Raw logs, generated build diff and sandboxes are retained locally under
`.local-ignore/pr7857-raw/` and are not staged. Public captures omit machine-user
paths, environment values, full model request bodies and private skill data.

Unrelated generated Codex/Senpi build drift was captured locally and restored
from the merge index, not staged. Full repository tests, Windows CI, full-plugin
category dispatch and fallback-provider recovery were not exercised live.
The old Windows Senpi facts-payload timeout was not reproduced, fixed, skipped,
or used to discount any local failure. Inspect the staged delta against
`origin/dev`, not HEAD: default cached diff includes the entire base refresh.

## Lead replay synchronization check

The driver now awaits the exact buffered or future SSE error matching the real
child ID and caller output, fails if SSE closes prematurely, and bounds child
cleanup. The updated replay passed with zero child assistant messages and
byte-equal error delivery. Normal shutdown completed without a forced kill.
