# PR 7500 OAuth and hooks-state reviewer evidence

## What was tested

- Corrected compiled Linux x64 OMO binary:
  `bun run script/build-omo-binary.ts --target linux-x64 --omo-version 5.0.0-beta.30 --omo-ai-version 5.0.0-0.beta.30 --out-dir <isolated-output>`
- Exact held writer lock: created `<isolated-agent>/hooks-state.json.lock`, then drove the compiled binary in a real `node-pty`. PASS required the real TUI marker `(😺 OmO Native)` while the lock still existed. See `held-lock-verdict.json` and `held-lock-tui.raw.redacted`.
- OpenAI Codex OAuth credential derivation: wrote a random 64-hex credential to isolated `auth.json` mode 0600, ran `omo-linux-x64 auth print-bearer-token --provider openai-codex`, compared stdout byte-for-byte in memory, shredded stdout and auth input, and retained only `openai-codex-credential-verdict.json`.
- Real state isolation: hashed the real agent's `auth.json`, `settings.json`, and `models-store.json` before and after an isolated compiled invocation. See `real-state-and-binary-hashes.txt`.
- Clean Bun 1.4.0 graph: created a detached disposable worktree, ran `bun install --frozen-lockfile`, `bun install --lockfile-only`, `node packages/omo-senpi/plugin/scripts/build-extension.mjs`, then `node packages/omo-senpi/plugin/scripts/build-extension.mjs --check`. The check passed and tracked output was byte-identical. Hashes are in `clean-graph-hashes.txt`.

## Observed

- Held-lock TUI: PASS. The exact global hooks writer lock remained present when the TUI marker was observed.
- OpenAI Codex credential derivation: PASS. The command emitted 65 bytes (64 token bytes plus newline), emitted no stderr, and the secret output was discarded.
- Real Senpi agent state: untouched; before and after hashes match.
- Compiled binary SHA-256: `4cc2143805d67378d86e6d95a6d2434b580dafb70a18c691e4cae8fcfcf817e7`.
- `npm pack --dry-run --json --ignore-scripts`: PASS, 4,220 files, 7,767,706 bytes, no npm `EOVERRIDE`.
- `bun run test:senpi`: PASS, 2,423 pass, 7 platform skips, 0 fail; evidence resolver 10 pass.
- Focused hooks/OAuth and binary contracts: PASS. Script and changed-package typechecks/LSP: PASS.

## Omissions and unrelated baseline failures

- No real credential was read or emitted. The credential was random QA-only data and was shredded immediately.
- The repetitive terminal redraw was reduced to a redacted marker excerpt; its pre-reduction SHA-256 is retained in that file.
- `bun run test:codex` reached 414 pass and 1 platform skip but has three current-dev failures unrelated to this PR: one rules-core project-marker case and two project-local cleanup cases that resolve `/home/minpeter/.codex/config.toml`. They reproduce with an isolated `HOME` because the implementation uses the OS homedir. No Codex source was changed to mask them.
- A broad `bun test packages/omo-native` run has six setup-import and four doctor current-dev baseline failures when run alone. The changed package-shape, compile-entry OAuth, hooks-state, and binary contracts pass.

## Cleanup

All isolated agent directories, temporary credentials and stdout, compiled output, disposable worktree, and PTY children were removed. See `cleanup-receipt.txt`.
