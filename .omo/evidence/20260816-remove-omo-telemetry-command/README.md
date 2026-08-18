# QA evidence: remove `/omo-telemetry` and local payload history

## What is being tested

- The omo-senpi TUI no longer registers `/omo-telemetry`.
- OmO Native telemetry events are still sent through the validated transport but no
  `last-payloads.json` history is retained.
- The first-run disclosure notice and all configuration/environment opt-outs remain.

## Evidence index

- `red-focused-tests.txt`: failing-first proof before production changes.
- `green-focused-tests.txt`: focused GREEN and LSP result.
- `control-mutation-proof.txt`: opt-out/config/disclosure mutation proof.
- `telemetry-suite-typecheck.txt`: full telemetry suite and package typecheck.
- `bundle-check.txt`: CI-Bun bundle rebuild and freshness verification.
- `manual-qa-summary.md`: real TUI and local-capture-server observations.
- `cleanup-receipt.txt`: browser, PTY, server, and sandbox cleanup.

## Privacy handling

No real telemetry credentials, auth headers, user prompts, environment dumps, or private
payloads are captured in this evidence directory. Later transport evidence uses only a
local stub and synthetic allowlisted events.
- full-suite-transcript.txt: committed transcript of the post-rebase full omo-senpi suite run (1582 pass / 0 fail).
