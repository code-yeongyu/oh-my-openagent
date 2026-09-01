# Production RPC routing sufficiency

## Required blocker

Review comment `3790854397` required the production Senpi task driver to prove that `execution_mode: "process"` reaches the RPC runner with `wiringFixed: true` and a real child PID.

## Raw artifact

`routing-green.json`

## Required observations

- `wiringFixed: true`
- `process_mode_routes_to_rpc_runner`: `PASS`
- Real process task: `st_01a008a4`
- Real RPC child PID: `29366`
- Residency state: `rpc_detached`
- Child session JSONL existed.
- Mid-run steer acknowledgement passed.
- Completion push arrived.
- Kill behavior produced `killed: true`.
- Real credential files and the whole real agent-directory digest were unchanged.
- Caller-provided agent directory was ignored in favor of the sandbox directory.
- `leakedPids: 0`

## Aggregate-result interpretation

The raw driver artifact retains its truthful aggregate `result: "FAIL"` because its separate reconcile scenario did not record `lostWithPid`, even though the orphan process was dead. That check is unrelated to the submitted process-routing blocker and was not relabeled or hidden.

The blocker-specific route is GREEN because every observable named by the review passed: process mode selected the RPC runner, a real child PID and session JSONL existed, the child remained steerable, credentials were untouched, and no child leaked.
