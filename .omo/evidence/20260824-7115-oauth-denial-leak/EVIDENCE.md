WHAT WAS TESTED
===============

Change: packages/omo-senpi new component `host-denial-guard` (message_end guard neutralizing the
senpi claude-sdk-oauth host-tool denial literal, upstream issue #7115).

1. Failing-first regression proof (RED):
   Command: `bun test packages/omo-senpi/src/components/host-denial-guard/`
   Result: 0 pass / 1 fail - "Cannot find module './constants'" (implementation absent).
   Artifact: red-run.log

2. Green run after implementation:
   Command: `bun test packages/omo-senpi/src/components/host-denial-guard/`
   Result: 7 pass / 0 fail, 29 expect() calls. Covers:
   - assistant echo of the denial literal is replaced (role preserved, surroundings intact)
   - mid-sentence and repeated literals swap; clean text unchanged
   - clean assistant/toolResult messages and user-role messages pass through untouched
     (user wording is never rewritten)
   - following-turn composition: sanitized turn-1 + later toolCall/toolResult history contains no
     denial literal, while the unsanitized control does (leak regression proof)
   - malformed message_end payloads keep the guard silent
   - drift tripwire: literal extracted from installed @code-yeongyu/senpi dist tools.js equals the
     locally pinned constant

3. Typecheck:
   Command: `bunx tsgo --noEmit -p packages/omo-senpi/tsconfig.json`
   Result: exit 0.

4. Full Senpi package gate:
   Command: `OMO_SKIP_MATERIALIZE=1 bun run test:senpi`
   Result: exit 0. lsp-daemon + ast-grep-mcp builds, runtime staging, build-extension bundle,
   sync-skills, embed-directive --check, build-install all completed; package suite
   "Ran 2240 tests across 307 files ... 0 fail" (6946 expect calls); evidence-dir script suite
   "Ran 10 tests across 1 file", 10 pass.
   Artifact: test-senpi-gate.log (first attempt), test-senpi-gate2.log (green run)

WHAT WAS OBSERVED
=================

- Root cause (host side, external dep @code-yeongyu/senpi@2026.8.23): dist
  core/extensions/builtin/claude-sdk-oauth/tools.js lines 21/25-40 define
  HOST_TOOL_EXECUTION_DENIED_MESSAGE and HOST_TOOL_DENIAL_HOOKS (PreToolUse deny with that reason
  for Bash|Write|Edit|Read|Grep|Glob|mcp__custom-tools__.*); options.js line 215 wires the hooks
  into every claude-sdk-oauth query. The denial reason becomes model-facing transcript content
  that surfaces in assistant replies and replays into later turns.
- Upstream check: senpi 2026.8.24's claude-sdk-oauth dist directory is byte-identical to 2026.8.23
  (diff verified from the published tarball), so a version bump alone does not fix #7115.
- OMO-side seam: senpi ExtensionAPI types.d.ts MessageEndEventResult.message ("Replace the
  finalized message. The replacement must keep the original message role.") - the guard uses it.
- Isolation: unit-only verification; no senpi agent dir was written (no live driver run; see
  OMITTED). No real ~/.senpi/agent or ~/.codex paths touched by any command in this evidence.

WHY IT IS ENOUGH
================

The regression test proves the exact issue contract: a host denial (the pinned literal) does not
leak into following tool turns - after the guard processes turn 1, composed later-turn history is
free of the instruction, and the unsanitized control shows the test would catch a regression.
Identity-passthrough cases bound the blast radius (clean messages, user wording, malformed
payloads). The drift tripwire keeps the local literal honest against the installed runtime without
value-importing the dep (bundle purity). tsgo plus the full 2240-test package gate show no
regression across the adapter, including session-start ordering and bundle checks.

Residual risk: sessions whose assistant reply merely QUOTES the sentence in legitimate prose get
the quote swapped too; accepted because the sentence is a reserved host wire literal authored by
the lane itself, and the replacement marker preserves readability.

WHAT WAS OMITTED
================

- Live senpi QA drivers were not run: exercising the real claude-sdk-oauth lane requires an
  explicit stored Claude OAuth account, which this environment does not have. The hermetic unit
  gate plus the leak-regression test stand in; live-lane confirmation remains open for review.
- First full-gate attempt hung in `git submodule update --init --recursive` cloning
  packages/shared-skills/upstreams/open-design (network-restricted environment). This matches the
  pre-existing hazard noted in the task brief; rerun used the script's own sanctioned
  OMO_SKIP_MATERIALIZE=1 skip. Side effects left UNSTAGED and UNCOMMITTED: regenerated tracked
  bundles under packages/omo-senpi/plugin/extensions/*.js and a submodule content touch on
  packages/shared-skills/upstreams/designpowers. Neither is part of this change.
- Raw gate logs are summarized above; no tokens, auth material, or private paths are copied here.
