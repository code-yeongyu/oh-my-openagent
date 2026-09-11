# memorian tool-boundary live RPC

## What was tested
S3 mid-turn steer after the first tool result, S4 turn-tail with no extra parent round and next-prompt delivery, S5 idle never wakes (assertUnchangedFor 5s).

## Observed
- ok: true
- S3: PASS parentRequests=3
- S4: PASS parentRequests=3
- S5: PASS parentRequestsBefore=2 parentRequestsAfter=2
- realSenpiUntouched: s3=true s4=true s5=true

## Why it is enough
Assertions read parent session JSONL custom_message/custom entries and the mock server's parent/judge request counts. Stdout text is never treated as proof.

## What was omitted
No live network provider. Judge and parent both hit 127.0.0.1. Real ~/.senpi and ~/.omo are digested, not used as the agent dir.


## Final verification wave (orchestrator re-run at PR head b6987a435)

| Check | Result | Artifact |
|---|---|---|
| `bun run build:senpi-plugin` + `build-extension.mjs --check` | exit 0 / current | `final-f3/build-check.log` |
| `memorian-tool-boundary-e2e.mjs --scenario all` | S3 PASS (parentRequests 3, recall 1, nudged 1 via steer), S4 PASS, S5 PASS (parentRequests 2 -> 2, assistant 2 -> 2 over the 5s window) | `final-f3/driver-result.json`, `final-f3/s*-session.jsonl` |
| `memorian-gate-e2e.mjs --scenario all` | ok=true, 20 checks, 0 failures | `final-f3/memorian-gate-e2e.json` |
| `bun run test:senpi` | 2747 pass / 0 fail / 32 pre-existing skips + resolve-evidence-dir 10 pass | `final-f5/test-senpi.log` |
| `bun run typecheck` | exit 0 | `final-f5/typecheck.log` |
