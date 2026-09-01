# QA Evidence: Grok 4.5/4.6 native Sisyphus system prompt

Change scope: `packages/model-core` (2 new detectors) + `packages/omo-opencode/src/agents/`
(new `sisyphus/grok-4.ts` variant, factory routing, Grok agent-config wrapper, tests, docs).

## WHAT WAS TESTED

1. **Real-harness agent bake (opencode-qa, server route).** A real `opencode serve`
   (v1.18.18) instance was started twice in fully isolated XDG sandboxes (`mktemp` dirs for
   `XDG_DATA_HOME`/`XDG_CONFIG_HOME`/`XDG_CACHE_HOME`/`XDG_STATE_HOME`,
   `OPENCODE_DISABLE_AUTOUPDATE=1`, `OPENCODE_DISABLE_MODELS_FETCH=1`), each loading the
   built plugin bundle via the opencode config `plugin` array with the project config
   `"model": "xai/grok-4.6"`:
   - BEFORE: dist built from `origin/dev` (3cb1d63c4), port 45818.
   - AFTER: dist built from this branch, port 45817.
   `GET /agent` was asserted for the Sisyphus entry. This proves the intended behavior on
   the exact surface users hit: plugin init -> config hook -> baked agent prompt.
2. **Unit gates.** New detector tests (`model-family-detectors.test.ts`) and factory routing
   tests (`sisyphus-agent-factory.test.ts`) incl. negative cases (grok-4.20, grok-4-1-fast,
   grok-code-fast-1 stay on the fallback family), plus repo-wide `bun run typecheck`,
   root `bun test`, and `bun run build`.

## WHAT WAS OBSERVED

- AFTER (`sisyphus-agent-after.json`): Sisyphus resolved to `{"modelID":"grok-4.6",
  "providerID":"xai"}` and its baked prompt contains `running on Grok 4.6` (1x),
  `<grok_calibration>` (1x), `production ready` (3x), and NO `<Constraints>` fallback body.
- BEFORE (`sisyphus-agent-before.json`): identical model resolution, ZERO grok anchors, and
  the `<Constraints>` dynamic fallback body present - i.e. Grok previously got the generic
  Claude-flavored fallback prompt.
- Anchor transcript: `anchor-checks.txt`. Unit gates: `unit-gates.txt` (26 pass / 0 fail on
  the touched suites; typecheck + build exit 0).
- Isolation: the real `~/.local/share/opencode/opencode.db` did not exist before or after
  QA (fresh VM; both servers wrote only inside their mktemp sandboxes) - see the isolation
  section of `anchor-checks.txt`. Both serve processes were killed by exact PID afterwards.
- Root `bun test` in the worktree: 15487 pass / 3 fail. All 3 failures are NOT from this
  change: the 2 `reflection completion flow` failures reproduce identically on a clean
  `origin/dev` checkout and are the exact failures shown in the latest red dev CI run
  (run for merge commit 3cb1d63c4, jobs `test (*)` / `senpi-compatibility (*)`); the
  `task RPC launch profile parity` failure passes in isolation on both base and worktree
  (full-suite interference flake). Details below.

## WHY IT IS ENOUGH

The change is a pure prompt-family routing addition: model string -> prompt body + request
config. The unit tests pin the routing table (incl. digit-boundary negatives against
grok-4.20/fast tiers) and the config contract (`reasoningEffort: "high"`, no Anthropic
`thinking` block). The server QA proves the full production path (real opencode loading the
real built bundle) bakes the new prompt for grok-4.6 and that no other agent surface
changed. `GET /agent` does not serialize `reasoningEffort` for ANY agent (verified against
GPT-family Hephaestus in the same capture), so the effort contract is pinned at the unit
level where the AgentConfig is observable. Regression risk to other families is covered by
the pre-existing factory tests, which all still pass.

## WHAT WAS OMITTED

- No real xAI API call was made (no credential in the environment; none needed - the change
  is config/prompt bake, not runtime inference).
- Server logs were not copied verbatim (they contain only local temp paths, no secrets;
  nothing redacted from the committed artifacts).
- Pre-existing base failures NOT fixed here (out of scope, actively churning subsystem):
  `packages/omo-senpi/src/components/memory/worker/completion.test.ts` - 2 failures
  reproduce on clean `origin/dev` and in the latest dev CI run on every platform.
