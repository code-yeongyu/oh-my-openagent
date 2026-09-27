# @oh-my-opencode/senpi-desktop-tool

Defines the senpi `computer` tool: its permission tiers, settings, the `/computer` command, the supported-host policy, and the activation hook. The coding-agent `computer-use` builtin extension (todo 26) wires these into a session. This package imports neither coding-agent nor codemode. Its types are structural, and `test/coding-agent-contract.ts` pins them against coding-agent's real `ToolDefinition`, `ToolPermissionParser`, and `ExtensionContext`.

## Tool

- `createComputerTool({handle, executeTool})` returns the `computer` `ToolDefinition`. It has `exposure: "search"` and `searchGroup: "desktop"`. The `searchText` and `searchKeywords` include `cua`, `computer use`, `screenshot`, and `accessibility`. The `promptGuidelines` are the safety bullets from `@oh-my-opencode/senpi-desktop-prelude`. `executionMode` is `"sequential"`.
- `kernelPrelude` is `computerPreludeAssets`, whose `exports` is `["computer"]`. codemode installs the `computer` global for the next eval cell while the tool is active. Nothing is passed to codemode.
- The parameters are `ComputerParams`, a TypeBox union:
  - `{action: "call", chain}`: one desktop helper, optionally followed by one call on the window or element it returns.
  - `{action: "run", code, read_only?, timeout?}`: `timeout` is in seconds (1-600, default 60).
  - `{action: "capabilities"}`.
  - `{action: "close"}`: the prelude's `computer.close()`.
  - There is no `resume` action. Only the user resumes.
- `execute` classifies a `call` chain with the protocol tier tables before anything else runs. An unknown or unchainable method (for example `userReset`) throws `ComputerCallError` before an engine starts. A read-tier chain runs read-only. Both `call` and `run` go through `runComputerCode` from `-service`, so one facade serves both. `run` code reaches host tools through the injected `executeTool` (`pi.executeTool`). `details.value` is the value the eval facade returns.

## Permissions

- `computerPermissionParser(toolName, input, cwd)` returns `[{permission: "computer", patterns: [tier], always: [tier]}]`.
  - `read`: `capabilities`, inspection-only chains, and `run` with `read_only: true`.
  - `exec`: everything else, including malformed input and chains with unknown methods.
- With this parser, the rules `computer=…`, `computer:read=…`, and `computer:exec=…` evaluate against the tier.
- An "always" approval stores only its own tier: approving screenshots forever does not approve clicks.
- The permission-system's `tool_call` hook is the only place permissions are evaluated. `execute` calls no `evaluate()` and shows no prompt, and the tool takes no `permissions` dependency. A second evaluation would prompt twice under an `ask` rule.
- Preset behaviour is unchanged (AD-2). `full-access` (the default) allows both tiers. `workspace`, `read-only`, and `ask` prompt. Non-interactive modes (print, json, rpc without a UI) block an `ask` unless a rule allows the tier beforehand, for example `--permission computer:exec=allow`.

## Handle, activation, and `/computer`

- `new ComputerHandle({service, settings})` holds the per-session state shared by the tool, the command, and the host extension. `service` is a `DesktopService`; construct it with `engineChildFactory(settings.enginePath)` to honor the override.
- `activate(context)` opens the engine session and arms `stopHotkey` through `ensureStopPath`. The host calls it on tool_search promotion, on a by-name call, and on `/computer on`, and `execute` calls it before every action. It is idempotent: `session.open` is re-sent only when its params change, because re-opening resets captures and AX refs. `onActivationChange(cb)` reports `true` or `false`, and the host turns that into the active-tool set.
- `stop()` and `resume()` are the user-only stop surface. They work without a TUI, so the host can bind them to an rpc-reachable command. The resume token stays inside the service. Both return `undefined` when no engine runs.
- `runComputerCommand(args, handle, context)` implements `/computer on|off|status|stop|resume` and returns text.
  - `on` and `off` override `computer.enabled` for this session only. `off` closes the engine, and later activations fail with `ComputerDisabledError`.
  - `status` prints `enabled`, `active`, the engine state, the capabilities (`stopPath=`, `focusGuard=`, and the capture, input, and AX permissions), and the permission tiers. It never starts an engine.
- `isSupportedHost(platform)` is true on darwin, linux, and win32 (any arch). A missing prebuild, such as on Windows arm64, surfaces through the engine locator's `native-unavailable` diagnostic.

## Session snapshot

- `session.open` params come from the settings, the active model, and the session directory:
  - `auditPath` is `<sessionDir>/.computer-audit.jsonl` when `auditLog.enabled` is true, and `null` otherwise.
  - `artifactDir` is `os.tmpdir()`.
  - The GC knobs are passed through. With GC off, `staleMs` is `Number.MAX_SAFE_INTEGER`, so nothing is ever stale.
  - `captureCaps` carries `maxWidth`, `maxHeight`, `maxBytes`, and `coordinateSafe`.
- `coordinateSafe` ports oh-my-pi's `usesCoordinateSafeImageSizing`. It is true when `compat.supportsImageDetailOriginal === false` or the model is in the Claude family (anthropic API, anthropic provider, or `claude` in the id). The engine then clamps captures to its coordinate-safe size.

## Settings

`resolveComputerSettings(raw, platform)` parses coding-agent's `settings.json` `computer` block against `ComputerSettingsSchema` (AD-1: codemode declares none of it). Unknown keys and wrongly typed values throw `ComputerSettingsError`.

| Key | Default |
|---|---|
| `enabled` | `isSupportedHost()` |
| `display` | `"all"` |
| `maxWidth` / `maxHeight` | `3840` / `2400` |
| `screenshotMaxBytes` | `5000000` |
| `stopHotkey` | `ctrl+alt+cmd+escape` on macOS, else `ctrl+alt+shift+escape` |
| `allowHostRelayOnlyStop` | `false` |
| `macosCanary` | `"session"` (`"session"` or `"off"`; `session.open` has no field for it yet) |
| `auditLog.enabled` | `true` |
| `screenshotGc.enabled` / `.staleMs` / `.scanIntervalMs` | `true` / `43200000` / `1800000` |
| `enginePath` | unset (the located binary) |

## Import direction

`scripts/desktop-package-boundaries.test.mjs` enforces these edges, in both `package.json` and `src/`:

- `@oh-my-opencode/senpi-desktop-protocol` and `@oh-my-opencode/senpi-desktop-prelude` import no workspace package.
- `@oh-my-opencode/senpi-desktop-engine` may import `-protocol`.
- `@oh-my-opencode/senpi-desktop-service` may import `-protocol`, `-engine`, and `-prelude`.
- `@oh-my-opencode/senpi-desktop-tool` may import `-protocol`, `-engine`, `-prelude`, and `-service`.
- Only omo-senpi's computer-use component imports these packages, and only `-tool` and `-service`. senpi itself imports none of them.
- No desktop package imports `pi-agent-core`, `pi-ai`, or `pi-tui`. There is no shared utils package: the five desktop packages are the whole set.

The Rust side runs the other way: `senpi-desktop-core` <- `-safety` <- `-session` <- backends <- `senpi-desktop-engine` (the binary). The TS packages reach it only through the engine's stdio JSON-RPC.
