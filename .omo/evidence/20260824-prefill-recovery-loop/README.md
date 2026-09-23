# QA Evidence: fix(opencode) assistant prefill recovery infinite loop (#7150)

Date: 2026-08-24 | Branch: `issue/7150-prefill-recovery-loop` | Worktree: `/home/viprix/projects/oom-wt-7150`

## WHAT WAS TESTED

Surface: `experimental.chat.messages.transform` handler
(`packages/omo-opencode/src/plugin/messages-transform.ts` + new
`packages/omo-opencode/src/plugin/assistant-prefill-recovery.ts`), the component
that appends `[internal] Continue from the previous assistant state.` when a
request payload ends with an assistant tail for prefill-unsupported models.

1. **Regression unit suite** (`assistant-prefill-recovery.test.ts`, given/when/then):
   - complete prior turn (finished tool result / `time.completed`) -> NO injection
   - genuinely truncated state (dangling running tool call) -> exactly one marked injection
   - injected continuation completing -> no second injection chains onto it
   - attempt cap (max 3 per user-turn epoch) stops runaway repeats
   - marker on last user turn -> never inject on top of own continuation
   - compaction continuation + plain finished turn -> not recovered again
   - positive control: partial text tail still recovers once (genuine resume keeps working)
2. **Pinned behavior suites**: existing `messages-transform.test.ts` +
   `messages-transform-prefill-alias.test.ts` must stay green unchanged.
3. **Issue-scenario loop driver** (`loop-driver-before.txt` / `loop-driver-after.txt`):
   30 consecutive auto-continue cycles, provider `opencode`, model
   `claude-opus-4-8`, each cycle ending with an executed completion-signal tool.
4. **Real harness boot**: real `opencode serve` in an isolated XDG sandbox with
   this worktree's built `dist/index.js` loaded as the plugin; OMO agent registry
   served; session created through the real HTTP API.

## WHAT WAS OBSERVED

- New tests RED before the fix (6 of 7 failing; only the already-working positive
  control passed), GREEN after: `tests-scoped.txt` = 31 pass / 0 fail across the
  three transform suites. Full plugin dir: `tests-plugin-dir.txt` = 345 pass / 0 fail.
- Loop driver, identical scenario:
  - before fix: `injections_over_30_autocontinue_cycles=30` (the reported infinite loop)
  - after fix: `injections_over_30_autocontinue_cycles=0`
- Real harness: server booted, `omo_agents_served=17 plugin_loaded=true`
  (Sisyphus/Atlas registry present => plugin config pipeline ran), session
  `ses_fcb794adfffeTFqnVvc1OdRIwE` created via `POST /session`.
- Isolation: probe state confined to a `mktemp` sandbox with all four XDG dirs
  redirected (`harness-isolation.txt`); real `~/.local/share/opencode` untouched.
- `bun run typecheck` (tsgo root + script + all packages): exit 0.

## WHY IT IS ENOUGH

The bug is a request-payload transform; its full observable contract is captured
by the transform suites (injection vs suppression per transcript shape) plus the
driver reproducing the issue's exact 30-cycle loop end-to-end at the handler
level. The real-harness boot proves the modified module loads and registers in
genuine opencode (agent registry + session creation through the live API).
Remaining risk: provider-format interactions beyond the transform payload are
unchanged by design (no provider sets/prefixes touched).

## WHAT WAS OMITTED

- No live model turn was driven (no provider credentials in this environment);
  the transform fires before provider I/O and is fully covered at the payload level.
- Server log copied to `harness-server.log` may contain local paths only; no
  tokens, auth headers, or credentials are present in any artifact here.
- `bun run build` required `OMO_SKIP_MATERIALIZE=1`: the shared-skills upstream
  git submodules cannot initialize in this sandboxed environment (pre-existing
  infrastructure limitation, unrelated to this change; bundle itself succeeded).
