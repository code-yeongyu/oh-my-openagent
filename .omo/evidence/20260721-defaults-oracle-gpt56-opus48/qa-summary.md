# Real OpenCode QA: Oracle GPT-5.6 Sol and Opus 4.8 defaults

## What was tested

- Built the repository runtime bundle with `bun run build` and loaded that exact `dist/index.js` through a real `opencode` v1.18.3 process.
- In an isolated XDG and HOME sandbox, ran `opencode debug agent oracle` and asserted its resolved registry entry.
- Ran the `opencode-qa` TUI smoke under tmux to prove the installed OpenCode binary rendered, accepted input, and cleaned up.

## What was observed

- The live Oracle registry entry resolved to `openai/gpt-5.6-sol`, `xhigh`, temperature `0.1`, and subagent mode. The exact safe projection is in `oracle-agent.json`.
- The TUI smoke rendered, accepted its compositor sentinel, tore down the tmux session, and left its real-DB count unchanged. Its exact output is in `tui-smoke.txt`.
- The host OpenCode session count was unchanged at 21875 before and after the registry probe. The probe used a separate sandbox database with zero sessions, and the sandbox was removed. The cleanup receipt is in `isolation-and-cleanup.txt`.

## Why it is enough

The changed OpenCode-facing behavior is the default agent registration and GPT reasoning variant. The real harness loaded the built plugin and exposed the resolved Oracle configuration that OpenCode will use, proving the new `gpt-5.6-sol` `xhigh` head reaches the user-visible registry. The final `bun test` pass covered 11,868 tests across 1,527 files, and final `bun run typecheck` and `bun run build` also passed. Focused coverage additionally pins the mirrored Senpi chains, category defaults, Opus 4.8 fallbacks, migration target, think-mode mapping, and Oracle factory behavior.

## What was omitted

No model prompt was sent and no provider credentials, tokens, headers, environment dumps, or private logs were captured. The registry probe and TUI smoke require no remote model request.
