# beta.8 publish RPC parity repair

## Evidence

- Publish run `32029562189`, job `95386274449`, failed the explicit-provider RPC catalog admission test.
- The same commit passed PR CI, proving a root-suite/environment race rather than a stable product regression.
- Existing isolation pins the agent directory and workspace CLI fallback, but the child still inherits process-wide XDG roots shared by the full suite.

## Change

- Update `packages/omo-senpi/src/components/task/task-rpc-launch-parity.test.ts` so each admission fixture owns dedicated XDG data, cache, config, and state roots under its temporary agent directory.
- Preserve the real Senpi CLI child and real mock-provider extension path; do not replace the integration with a mock.

## Verification

- Capture the failed publish log as RED evidence.
- Run the focused parity test repeatedly with CI Bun 1.3.12 after the exact publish install/build sequence.
- Run the full root `bun test` suite once with CI Bun 1.3.12.
- Run diagnostics and `git diff --check`.
- Open a focused PR, require the normal matrix, merge with a merge commit, then re-dispatch beta.8 publish.
