# src/cli/config-manager/ — CLI Installation Utilities

**Generated:** 2026-05-15

## OVERVIEW

29 files (28 TypeScript plus this guidance file). Stateless utility functions for the install flow: OpenCode config manipulation, provider configuration, JSONC operations, binary detection, version lookup, and npm registry queries. No classes — flat utility collection.

## FILE CATALOG

| File | Purpose |
|------|---------|
| `add-plugin-to-opencode-config.ts` | Register `oh-my-opencode` in `.opencode/opencode.json` plugin array |
| `add-tui-plugin-to-tui-config.ts` | `ensureTuiPluginEntry()` — register the TUI sidebar plugin entry |
| `backup-config.ts` | `backupConfigFile()` — timestamped backup before mutation |
| `bun-install.ts` | Run `bun install` / `npm install` for plugin setup |
| `config-context.ts` | `ConfigContext` — shared config state across install steps |
| `deep-merge-record.ts` | Deep merge utility for JSONC config objects |
| `detect-current-config.ts` | Read existing OpenCode config, detect installed plugins |
| `ensure-config-directory-exists.ts` | Create `.opencode/` dir if missing |
| `format-error-with-suggestion.ts` | Format errors with actionable suggestions |
| `generate-omo-config.ts` | Generate the `[opencode]` OMO view from install selections |
| `npm-dist-tags.ts` | Fetch latest version from npm registry (dist-tags) |
| `opencode-binary.ts` | Detect OpenCode binary location, verify it's installed |
| `opencode-config-format.ts` | OpenCode config format constants and type guards |
| `parse-opencode-config-file.ts` | Parse opencode.json/opencode.jsonc with fallback |
| `plugin-name-with-version.ts` | Resolve `oh-my-opencode@X.Y.Z` for installation |
| `version-compatibility.ts` | `checkVersionCompatibility()` + `extractVersionFromPluginEntry()` |
| `write-omo-config.ts` | Write generated config to `~/.omo/omo.jsonc` |

Provider-specific helpers (`add-provider-config.ts`, `antigravity-provider-configuration.ts`, `auth-plugins.ts`, `jsonc-provider-editor.ts`) are no longer part of this directory. Keep the catalog synchronized with the flat directory when adding or removing utilities.

## USAGE PATTERN

Functions are called sequentially by `src/cli/install.ts` / `src/cli/tui-installer.ts`:

```
1. ensure-config-directory-exists
2. detect-current-config (check what's already set up)
3. opencode-binary (verify opencode installed)
4. npm-dist-tags (get latest version)
5. generate-omo-config (build config from user selections)
6. write-omo-config
7. add-plugin-to-opencode-config
8. add-provider-config (for each provider selected)
9. bun-install
```

## NOTES

- All functions are pure / stateless (except disk I/O) — no shared module state
- JSONC config reads go through `parse-opencode-config-file.ts`, which uses the shared comment-preserving `parseJsonc` helper — NEVER use `JSON.parse` on JSONC files
- `opencode-binary.ts` searches PATH + common install locations (`.local/bin`, `~/.bun/bin`, etc.)
