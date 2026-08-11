# PR #6498 remediation QA

## What was tested

- The repository `opencode-qa` skill's Case A router: `opencode run --model openai/mock-1 --format json` against its local deterministic fake OpenAI provider. `opencode-run-qa.sh` creates the isolated XDG sandbox and checks the text event.
- The PR's real doctor CLI entrypoint in a separate isolated sandbox. It asserts the exact missing `models.json` path and actionable refresh guidance.
- `spawn-with-timeout.test.ts` at the unchanged PR head and at merge-base `4ca872b57`, plus the GitHub Actions CI rerun of unchanged head `97e9a3f64`.

## What was observed

- `opencode-run-text-event.json` records the real router's `fake response 2`; `session-isolation-proof.txt` shows the host session count remained `7426 -> 7426`.
- `doctor-model-cache-path.txt` records the exact isolated cache path and refresh guidance from the PR's doctor implementation.
- `current-head-doctor-tests.txt` has 9 passing doctor tests. `baseline-spawn-tests.txt` has 8 passing `spawnWithTimeout` tests at the merge base.
- `windows-unchanged-head-rerun.json` records CI attempt 3 on unchanged head, including successful Windows test, typecheck, Senpi, and Codex jobs.

## Inconclusive first plugin-loaded attempt

`plugin-loaded-inconclusive/` is retained rather than hidden. Its `session-isolation-proof.txt` changed from `7424` to `7426` while the host concurrently created two sessions under `/Users/sungsoopark/Documents/GitHub/profile`; neither sandbox session ID exists in the real database. That run proved source-plugin routing, but not the required count invariant. The final Case A run is source-independent, completed in the isolated sandbox, and is the count-valid proof.

## Why this is enough

The product source is unchanged. The router-approved OpenCode case proves the real installed harness operates in a disposable XDG environment; the doctor invocation proves the PR's shipped CLI behavior; the exact-head Windows rerun and unchanged merge-base test demonstrate `spawnWithTimeout` is outside the PR delta and green on the owner-required Windows gate.

## Omitted

No credentials were used. The fake provider only accepts the literal `qa-only` key. Sandbox directories are removed by the `opencode-qa` EXIT trap; no host configuration or session data is copied here.
