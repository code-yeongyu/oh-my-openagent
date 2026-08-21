# OpenCode v2 beta compatibility

Status: experimental, targeting `opencode2` (`@opencode-ai/cli` beta channel). v1 stable remains fully supported and unchanged.

## How it ships

The plugin builds two entry modules from one codebase:

| Entry | Host | Shape | Build |
|---|---|---|---|
| `dist/index.js` | OpenCode v1 stable (`opencode`) | function module `{ server(input, options): Promise<Hooks> }` | `bun run build` |
| `dist/v2/index.js` | OpenCode v2 beta (`opencode2`) | object module `{ id: "oh-my-openagent", setup(ctx) }` | `bun run build:v2` |

The v2 host requires a plain default-exported object with `id` and `setup`; function exports and hybrid exports are silently ignored (verified against `0.0.0-beta-17778`, see `.omo/evidence/20260821-opencode-v2-migration/spikes/SP1-loadability.md`). Both hosts can stay installed side by side.

## Registering on opencode2

Add the absolute path of the built v2 entry to the `plugins` array of your project or user `opencode.json`:

```jsonc
{
  "plugins": ["<absolute path to oh-my-openagent dist/v2/index.js>"]
}
```

Notes from live probing:

- The legacy `"plugin"` array and the v2 `"plugins"` array feed the same loader on v2.
- Package-name specifiers resolve only through the host's own install flow (`opencode2 plugin add`); project-local `node_modules` is not consulted. Absolute file paths are the reliable registration form today.
- Relative entries resolve against the project root, so `./.opencode/plugins/<file>` works for files placed there.

## What works on v2 today

- Plugin load + setup with host identity detection (`ctx.app.version`, `ctx.app.channel`).
- Tool lifecycle bridges: `execute.before` normalization (mcp_ prefix strip, bash null-byte strip) and `execute.after` error tolerance.
- Event bus subscription pump over `ctx.event.subscribe()`.

## Degradation ledger

Surfaces whose v1 hook has no v2 equivalent are tracked in machine-readable form in `packages/omo-opencode/src/plugin/v2/degradation.ts` (`V2_DEGRADATION_LEDGER`) and surfaced by doctor. Summary:

| Feature | v1 surface | v2 status |
|---|---|---|
| chat.message first-message variant gate | chat.message hook | degraded |
| IntentGate keyword detection | chat.message + messages.transform | degraded |
| command.execute.before slash interception | command.execute.before hook | unavailable |
| compaction context injection | experimental.session.compacting | unavailable |
| compaction autocontinue | experimental.compaction.autocontinue | unavailable |
| tool.definition dynamic override | tool.definition hook | ported (static fold-in) |
| chat.params model tuning | chat.params hook | degraded (aisdk.hook options) |

## Version detection

`detectOmoHosts()` in `packages/omo-opencode/src/shared/opencode2-host.ts` classifies installed hosts. v1 versions are plain semver; v2 beta versions look like `0.0.0-beta-17759`. When both binaries exist, v1 stays the primary target so existing behavior keeps precedence.

## Evidence

Live-host proof and spike data: `.omo/evidence/20260821-opencode-v2-migration/`.
