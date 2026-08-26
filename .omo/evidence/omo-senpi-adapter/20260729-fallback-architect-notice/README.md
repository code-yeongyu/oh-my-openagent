# 20260729-fallback-architect-notice

Change under test: fallback-architect reminder never user-visible (queued path no longer
transform-appends; always hidden custom message) + new visible `omo-fallback-architect:notice`
upgrade card (display:true, details {from,to}) with a registered TUI renderer.

Commands:
- bun test packages/omo-senpi/src/components/fallback-architect/  -> 48 pass / 0 fail
  (RED first: 13 pass / 4 fail — queued transform + missing notice, captured before impl)
- node packages/omo-senpi/scripts/qa/fallback-architect-e2e.mjs --self-test -> PASS
- SENPI_BIN=$(command -v senpi) node packages/omo-senpi/scripts/qa/fallback-architect-e2e.mjs
  -> e2e-run.json: all 4 scenarios PASS (notice display:true + details in A/B, absent in C/D,
     reminderLeaks 0 everywhere); overall FAIL only via isolatedRealAgentDir=false caused by the
     developer's LIVE senpi session writing ~/.senpi/agent/settings.json (tipsHistory) at 13:06:20
     during the run window — the QA sandbox itself uses isolated SENPI_CODING_AGENT_DIR + HOME.
  -> e2e-run-2.json: clean re-run (see file for final verdict).

Isolation: sandboxes created under mktemp roots by drive.mjs createSandbox and removed by the
driver's finally-rmSync; the real ~/.senpi/agent was only ever READ for the credential digest.

Redactions: none; transcripts contain only mock-provider content.
