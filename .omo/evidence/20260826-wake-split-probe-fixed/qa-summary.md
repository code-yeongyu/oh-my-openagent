# QA summary — wake-split probe rerun (conclusive)

Resolves the inconclusive wake-split probe recorded in `20260721-task-result-distillation-dist/`.

## What was tested

The full serve-topology wake runner-split probe
(`.agents/skills/opencode-qa/scripts/serve-wake-split-probe.sh --expect fixed`)
against the branch's built plugin (`dist/index.js`, rebuilt from branch HEAD):
real `opencode serve` in an isolated XDG sandbox, fake-LLM provider, one parent
session driving `call_omo_agent` plus the bash hold, then DB metrics, plugin-init
count, and live-listener route provenance.

## What was observed

- Verdict line (also in `harness.log`): `RESULT=FIXED parent_assistant_messages=3
  parent_tool_call_turns=2 terminal_stops=1 child_task_sessions=1 plugin_inits=1
  WAKE_DISPATCHED_DURING_PARENT_TURN=true route_live_dispatch=true
  branch_counts=parent-tool-call:1,parent-hold:1,child:1,wake:0,default:1`
- Exactly one terminal stop and one child task session: no second runner forked.
- The wake dispatched during the parent turn (mechanism arm armed) and routed
  through the live listener (`route-provenance.log`), which is the fixed topology.
- Isolation held: real DB session count 5530 before and after (`isolation-receipt.txt`).
- Sandbox DB snapshot captured as `sandbox-opencode.db`.

## Why the earlier run was inconclusive, and what changed

Two harness defects, both fixed in this branch:

1. Every curl in the probe and in `oqa_wait_http` ran without per-request
   timeouts, so one hung request defeated the outer polling deadline. All curl
   sites now carry `--connect-timeout`/`--max-time` (plus `--noproxy '*'` for the
   localhost endpoints).
2. Serve-mode first-request plugin loading reifies the `$HOME/.opencode` plugin
   store; its in-process registry fetch stalled indefinitely inside the offline
   QA sandbox (observed with and without proxy env), wedging every `/session`
   route before session creation — the exact stall the July run recorded. The
   sandbox serve now launches with `npm_config_offline=true` +
   `npm_config_prefer_offline=true` and stripped proxy env, so the store reify
   no-ops and the path plugin loads directly. `--self-test` remains 16/16 green.

## What was omitted

No external network access is required or used by the probe (fake LLM on
localhost; npm forced offline). Raw serve stdout/stderr kept as
`opencode-serve.stdout`/`opencode-serve.stderr`; no secrets are present in any
artifact.
