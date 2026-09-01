# RPC launch profile parity — root-suite env isolation fix

CI run 32020990147, Ubuntu root-suite job 95360460811 failed one test:

    task RPC launch profile parity > explicit provider extension -> model visible
    Expected promise that resolves
    Received promise that rejected

The same file passed its sibling negative case and passes in isolation. The
failure signature is therefore full-suite-only fixture contamination, not an
extension forwarding regression. Structural search found multiple root-suite
test files replacing `process.env` wholesale while Bun executes test modules in
the same process. The parity fixture copied the LIVE `process.env` when its test
body ran, so another file's temporary environment could become the detached
catalog child's launch profile.

## Fix

Capture the baseline environment at module load and build every child profile
from that snapshot. Set `OMO_DISABLE_POSTHOG=true` in the test child so its
credential-free catalog probe cannot add telemetry/network state. Directly await
the admission promise so any future rejection prints the actual RunnerError
instead of Bun's opaque `Promise { <rejected> }` wrapper.

No production code changes. No retry, timeout increase, test skip, or CI override.

## Evidence

- RED: `rpc-parity-ci-red.txt` — exact Ubuntu root-suite rejection.
- GREEN focused: 2 pass / 0 fail.
- GREEN contention stress: parity + three root-suite env mutator files, 20/20 runs.
- GREEN task component: 371 pass / 0 fail across 53 files.
- `packages/omo-senpi` typecheck: exit 0.
- `packages/senpi-task` typecheck: exit 0.
- CI bun 1.3.12 extension freshness: current.
- Full output: `rpc-parity-green.txt`, `rpc-parity-verification.txt`.
