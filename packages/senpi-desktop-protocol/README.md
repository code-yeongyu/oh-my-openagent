# @oh-my-opencode/senpi-desktop-protocol

Defines the engine JSON-RPC types, the session snapshot, the error codes, and the computer-call approval tiers. `src/engine-schema.generated.ts` is generated from the engine method table with `bun run generate`. Never edit it by hand.

## Settings

None.

## Import direction

`scripts/desktop-package-boundaries.test.mjs` enforces these edges, in both `package.json` and `src/`:

- `@oh-my-opencode/senpi-desktop-protocol` and `@oh-my-opencode/senpi-desktop-prelude` import no workspace package.
- `@oh-my-opencode/senpi-desktop-engine` may import `-protocol`.
- `@oh-my-opencode/senpi-desktop-service` may import `-protocol`, `-engine`, and `-prelude`.
- `@oh-my-opencode/senpi-desktop-tool` may import `-protocol`, `-engine`, `-prelude`, and `-service`.
- Only omo-senpi's computer-use component imports these packages, and only `-tool` and `-service`. senpi itself imports none of them.
- No desktop package imports `pi-agent-core`, `pi-ai`, or `pi-tui`. There is no shared utils package: the five desktop packages are the whole set.

The Rust side runs the other way: `senpi-desktop-core` <- `-safety` <- `-session` <- backends <- `senpi-desktop-engine` (the binary). The TS packages reach it only through the engine's stdio JSON-RPC.
