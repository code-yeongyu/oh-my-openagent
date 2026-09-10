# memorian trigger coverage / late-judge salvage / run retention - evidence

Evidence for PR feat/memorian-trigger-coverage (follow-up to #7841 / #7846). Each todo of the plan
lands its remote test logs, live driver captures, and manual QA notes here.

## What will be tested
- toolArgTexts harvesting from eval code/summary and long commands (unit, remote ASCII box)
- deadline salvage of already-accepted nudges + 90 s tool-call deadline (unit, remote ASCII box)
- judge run outcome.json + retention prune (unit, remote ASCII box)
- live RPC driver S3-S6 incl. the new S6 long-command trigger scenario (mock provider, sandboxed)
- package gate bun test packages/omo-senpi on the ASCII box; tsgo; bundle --check

## Isolation
The live driver builds its own SENPI_CODING_AGENT_DIR sandbox; realSenpiUntouched is recorded per scenario.
Unit and package suites run on a disposable ASCII box (never on the orchestrating host).
