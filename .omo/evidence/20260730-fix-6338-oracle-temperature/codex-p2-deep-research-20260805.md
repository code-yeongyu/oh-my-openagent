# Codex P2 follow-up - deep-research temperature exceptions

Captured 2026-08-05 on Windows 11 with Bun 1.3.14 and Node v24.18.0.

## What was tested

1. Red-green regression coverage for `openai/o3-deep-research` and
   `openai/o4-mini-deep-research` with no capability metadata.
2. The complete `packages/model-core/src` test suite.
3. Repository typecheck and production build.
4. A direct driver for `resolveCompatibleModelSettings`.
5. A direct driver for the real OpenCode `chat.params` handler with the two
   exceptions and `o3:high` as a control.

## What was observed

- Before the registry exception, the focused file reported 77 pass and 2 fail:
  both deep-research models lost `temperature`.
- After the registry exception, the focused file reported 79 pass and 0 fail.
- The complete model-core suite reported 344 pass and 0 fail.
- `bun run typecheck` exited 0.
- `bun run build` completed successfully.
- The model-core driver preserved `temperature: 0.1` with no compatibility
  changes for both exceptions, while the `o3:high` control still removed it.
- The OpenCode `chat.params` handler preserved temperature for both
  deep-research models and removed it for the control.

## Why it is enough

The red-green test toggles the reviewer's exact two counterexamples. The full
model-core suite covers aliases, metadata precedence, family detection, and
setting compatibility. The direct handler driver executes the OpenCode-facing
surface that mutates outgoing request parameters, while the existing
`qa-summary.md` records why a provider-capture run cannot observe an agent's
configured temperature on this OpenCode version.

## What was omitted

No credentials, auth headers, environment dumps, provider tokens, or raw
secret-bearing logs were recorded. Repetitive test and build output was
summarized with commands, exit states, and observed counts.
