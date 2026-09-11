# PR 7500 round-2 hooks/OAuth reviewer evidence

## Sanctioned Senpi QA

Evidence directory was selected only through `.agents/skills/senpi-qa/scripts/resolve-evidence-dir.mjs` with slug `20260831-fomo-oauth-hooks-round2`.

Commands:

- `node packages/omo-senpi/scripts/qa/drive.mjs --self-test`
- `SENPI_BIN="$PWD/node_modules/.bin/senpi" SENPI_CODING_AGENT_DIR=/must-be-ignored node packages/omo-senpi/scripts/qa/drive.mjs`

`driver-live.jsonl` is the driver's final machine-readable result. It records PASS for ultrawork injection and comment-checker, the ignored caller agent dir, the isolated sandbox agent dir, both real homes checked, protected state files including `hooks-state.json`, and empty changed-path arrays for both `~/.senpi/agent` and `~/.omo/agent`. The sandbox was removed by the driver's `finally` block.

## Compiled binary behavior

The corrected Linux x64 binary was rebuilt from this head. `compiled-binary-sha256.txt` records its hash.

- Exact held writer lock: `<isolated-agent>/hooks-state.json.lock` was created before launching the binary through a real POSIX PTY. `held-lock-verdict.json` records the real `(😺 OmO Native)` marker, and `held-lock-isolation.txt` records that the exact lock remained held at the assertion boundary.
- OpenAI Codex credential: a random 64-hex OAuth access token was written only to isolated mode-0600 `auth.json`; `auth print-bearer-token --provider openai-codex` matched it byte-for-byte. Input and output were shredded. Only byte count and PASS remain in `openai-codex-credential-verdict.json`.

## Concurrency regressions

- Restrictive-umask mode test reproduced old behavior as `0640 -> 0600`, then passed with explicit `chmodSync(tempPath, capturedMode)` before rename.
- Legacy writer test synchronizes through filesystem events at the truncate/write boundary. There are no sleeps or polling delays. The reader sees the complete trusted snapshot after the exact writer lock releases.
- Healthy complete snapshots remain lock-free while a lock exists; malformed state without a lock remains fail-closed.
- Publication+cleanup and chmod+cleanup errors preserve ordered `AggregateError.errors`.

## Validation and cleanup

See `validation-summary.txt` and `cleanup-receipt.txt`. No real secrets were used or retained. Repetitive terminal redraw bytes were omitted after the marker assertion.
