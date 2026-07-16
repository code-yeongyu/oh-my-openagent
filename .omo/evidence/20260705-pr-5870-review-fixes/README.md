# QA Evidence: PR #5870 cubic review fixes (question-command-handoff)

Date: 2026-07-05. Branch: `feat/actionable-question-command-handoff`.

## What changed

Four cubic review findings fixed:

1. **P1 dedupe fallback** (`hook.ts`): the dedupe key no longer falls back to the
   answer label when `callID` is missing. Dedupe now applies only to real call
   IDs; missing-callID duplicate events are collapsed by the prompt-async-gate's
   semantic dedupe (`DEFAULT_PROMPT_SEMANTIC_DEDUPE_HOLD_MS = 15s`, identical
   session + prompt body). Previously a later legitimate answer with the same
   visible label in the same session was silently dropped.
2. **P2 negation matching** (`constants.ts` + `detector.ts`): negation markers
   now match as whole words via `NEGATION_PATTERNS` (lookaround-bounded
   regexes), and curly apostrophes (U+2018/U+2019/U+02BC) are normalized to
   ASCII before matching. Fixes both failure modes: "Don't run /start-work yet"
   written with a curly quote now suppresses dispatch, and "collateral" no
   longer false-positives on the "later" marker.
3. **P2 slash-token regex** (`constants.ts`): `SLASH_COMMAND_TOKEN_REGEX` now
   carries a `(?<![a-z0-9./])` lookbehind so command names inside URLs or
   path-like text (`https://example.com/start-work`, `path.to/start-work`,
   `://` remnants) never match.
4. **P2 docs** (`docs/reference/features.md`): description now states the
   command is dispatched as an internal prompt in addition to the answer label
   being returned to the planner (the hook is an observational PostToolUse; it
   never suppressed the tool output).

## What was tested

- `hook-boundary-scenarios.txt`: a driver invoking the exact
  `"tool.execute.after"` function OpenCode calls, with the real detector and
  command-name resolution, only the dispatch gate stubbed. 5 scenarios, one
  per finding plus the pre-existing duplicate-collapse guarantee:
  A) same callID twice -> 1 dispatch; B) two missing-callID answers with the
  same label -> 2 dispatches (the P1 regression); C) curly-apostrophe negation
  -> 0 dispatches; D) command name inside a URL -> 0 dispatches; E) "collateral"
  containing "later" -> 1 dispatch. All PASS.
- `sandbox-serve-boot.txt`: real `opencode serve` (v1.17.13) booted in an
  isolated XDG sandbox with the freshly built worktree `dist/index.js` as the
  only plugin. `/global/health` healthy, serve log free of plugin load errors.
  The shared omo logger also shows real `[question-command-handoff] Dispatched
  /start-work` lines emitted during the boundary-driver run, proving the
  changed hook's dispatch/log path executes for sessions s1, s2 (twice), s5
  and stays silent for the suppressed scenarios C and D.
- `sse-probe-self-test.txt`: `sse-hook-probe.sh --self-test` PASS - the SSE
  `/event` stream opens and delivers `server.connected` on this machine, so
  hook-bearing events reach the wire.
- `bun-test-handoff.txt`: 23 tests / 0 fail across detector unit tests, hook
  tests, and the test that drives the hook through the real composed
  `tool.execute.after` chain. Includes 4 new regression tests (curly
  apostrophe, marker-inside-word, URL path, missing-callID same-label).
- Dist verification: after `bun run build`, `dist/index.js` contains the new
  `(?<![a-z0-9./])` lookbehind and the callID-only dedupe.
- Repo gates: `bun run typecheck` clean; prompt-async-route-audit and
  mock-module-lifecycle-audit meta-tests pass (11/11).

## What was observed

- Isolation proof: real DB session count 795 before and 795 after the sandbox
  boot; sandbox `mktemp` dir removed on exit. The real
  `~/.local/share/opencode/opencode.db` was never written.
- Before/after behavior delta is pinned by the new tests: the old code
  dropped scenario B's second dispatch and suppressed scenario E; both now
  behave correctly, and scenarios C/D that previously dispatched are now
  suppressed.

## Why it is enough

The change is pure in-hook decision logic (dedupe key derivation, negation
matching, token extraction) plus a docs wording fix. The QA drives the exact
hook boundary OpenCode invokes with the real detector, proves the built
artifact ships the change, proves the plugin loads in a real isolated
opencode server, and proves the event plumbing that carries the hook's
trigger works. A full live-model Prometheus session is not exercisable on
this machine (no provider credentials in the sandbox); the original PR's
end-to-end wiring is unchanged and remains covered by the real-chain test.

## What was omitted

- No secrets, tokens, or env dumps were captured. The serve log tail includes
  only the unsecured-server warning and the listen address.
- Stale unrelated log lines from 2026-07-03 (codegraph tool failures from a
  different session) appear in the shared logger excerpt; they predate this
  QA run and were left in place for honesty about the log source.
