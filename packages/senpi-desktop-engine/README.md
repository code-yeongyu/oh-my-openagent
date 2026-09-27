# @oh-my-opencode/senpi-desktop-engine

Finds the `senpi-desktop-engine` binary (`crates/senpi-desktop-engine`) for this host and checks it speaks the host's protocol. It does not implement any desktop behavior.

## Contract

- `locateDesktopEngine()` returns `{ path, diagnostic: null }` or `{ path: null, diagnostic }`. It checks these paths in order:
  1. compiled sidecar: `<dirname(process.execPath)>/native/prebuilds/<platform>-<arch>/senpi-desktop-engine[.exe]`
  2. vendored prebuild: `native/prebuilds/<platform>-<arch>/senpi-desktop-engine[.exe]` in this package
  3. dev build: `<repo>/target/release/senpi-desktop-engine[.exe]`

  A candidate that is missing, lacks the executable bit, or carries macOS `com.apple.quarantine` is skipped. The quarantine attribute is detected and never cleared. The diagnostic `code` is `quarantined` when a skipped candidate was quarantined, otherwise `native-unavailable`, and it lists every attempted path.
- `helloDesktopEngine(path)` spawns the binary with `--stdio`, sends `engine.hello`, and resolves only when `abi === ENGINE_ABI` and `protocolVersion === PROTOCOL_VERSION` from `@oh-my-opencode/senpi-desktop-protocol`. On any other ABI or protocol version it throws `DesktopEngineAbiMismatchError` (`code: "abi-mismatch"`, naming both versions). When no well-formed reply arrives it throws `DesktopEngineHandshakeError` (`code: "handshake-failed"`). This handshake is the ABI sentinel.
- `./native` resolves only the vendored host prebuild, without spawning it.

## Prebuilds

Only the host prebuild is committed, as `packages/pty` does. `bun run check:prebuild` rebuilds it with `cargo build --release -p senpi-desktop-engine --locked` and `--remap-path-prefix`, then byte-compares the rebuilt binary against the committed one. Pass `-- --update` to re-vendor it. `node scripts/build-desktop-engine-local.mjs` builds the dev candidate into `target/release/`.

## Import direction

`scripts/desktop-package-boundaries.test.mjs` enforces these edges, in both `package.json` and `src/`:

- `@oh-my-opencode/senpi-desktop-protocol` and `@oh-my-opencode/senpi-desktop-prelude` import no workspace package.
- `@oh-my-opencode/senpi-desktop-engine` may import `-protocol`.
- `@oh-my-opencode/senpi-desktop-service` may import `-protocol`, `-engine`, and `-prelude`.
- `@oh-my-opencode/senpi-desktop-tool` may import `-protocol`, `-engine`, `-prelude`, and `-service`.
- Only omo-senpi's computer-use component imports these packages, and only `-tool` and `-service`. senpi itself imports none of them.
- No desktop package imports `pi-agent-core`, `pi-ai`, or `pi-tui`. There is no shared utils package: the five desktop packages are the whole set.

## Crate layering

The engine binary is built from the `crates/senpi-desktop-*` crates. Each depends only on the layers below it:

```text
senpi-desktop-engine
  -> senpi-desktop-session
       -> senpi-desktop-backend-{macos,x11,wayland,win32,fake}
            -> senpi-desktop-backend-atspi   (x11 and wayland only)
            -> senpi-desktop-safety          (every real backend)
                 -> senpi-desktop-core
```

`senpi-desktop-core` depends on no other desktop crate, and no backend depends on `-session` or `-engine`. The engine also depends directly on the backends (for their stop-path listeners), `-safety`, and `-core`.

The Rust side runs the other way: `senpi-desktop-core` <- `-safety` <- `-session` <- backends <- `senpi-desktop-engine` (the binary). The TS packages reach it only through the engine's stdio JSON-RPC.
