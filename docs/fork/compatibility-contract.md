# Fork compatibility contract

## Goal

Freeze the phase-1 compatibility surface for the local parity fork before any runtime migration work starts.

## Frozen identity rules

1. Preserve the npm package identity `oh-my-opencode`.
2. Preserve the CLI/bin identity `oh-my-opencode`.
3. Preserve the preferred plugin identity `oh-my-openagent`.
4. Treat the legacy `oh-my-opencode` basename and alias as supported compatibility behavior.
5. No phase-1 renaming is allowed unless a verified blocker requires it.

## Frozen config-domain rules

1. Keep OpenCode host config in `opencode.json` or `opencode.jsonc`.
2. Keep OhMyOpenCode plugin config separate from the host config.
3. Do not treat host-config keys and plugin-config keys as a single merged namespace.
4. Require explicit plugin registration through the OpenCode `plugin` array.

## Phase-1 scope guardrails

- This phase scaffolds the fork and documents the contract only.
- Runtime behavior, tests, config assets, and plugin logic are not renamed in this step.
- Later migration work must preserve the compatibility rules above unless a blocker is proven and documented.

## Upstream commands frozen from package.json

- `test`: `bun test`
- `build`: `bun run build`
- `typecheck`: `tsc --noEmit`
- `extended build`: `bun run build:all`

## Verification targets for later tasks

- `bun test`
- `tsc --noEmit`
- `bun run build`
- `bun run build:all`
