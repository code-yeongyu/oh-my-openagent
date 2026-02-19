# src/cli/config-manager/ — CLI Installation Utilities

**Generated:** 2026-02-19

## OVERVIEW

20 files. Stateless utility functions for the `install` command. Handles OpenCode config manipulation, provider configuration, JSONC operations, binary detection, and npm registry queries. No class — flat utility collection.

## FILE CATALOG

| File | Purpose |
|------|---------|
| `add-plugin-to-opencode-config.ts` | Register `oh-my-opencode` in `.opencode/opencode.json` plugin array |
| `add-provider-config.ts` | Add provider API key to OpenCode config (user-level) |
| `antigravity-provider-configuration.ts` | Handle Antigravity provider setup (special case) |
| `auth-plugins.ts` | Detect auth plugin requirements per provider (oauth vs key) |
| `bun-install.ts` | Run `bun install` / `npm install` for plugin setup |
| `config-context.ts` | `ConfigContext` — shared config state across install steps |
| `deep-merge-record.ts` | Deep merge utility for JSONC config objects |
| `detect-current-config.ts` | Read existing OpenCode config, detect installed plugins |
| `ensure-config-directory-exists.ts` | Create `.opencode/` dir if missing |
| `format-error-with-suggestion.ts` | Format errors with actionable suggestions |
| `generate-omo-config.ts` | Generate `oh-my-opencode.jsonc` from install selections |
| `jsonc-provider-editor.ts` | Read/write JSONC files with comment preservation |
| `npm-dist-tags.ts` | Fetch latest version from npm registry (dist-tags) |
| `opencode-binary.ts` | Detect OpenCode binary location, verify it's installed |
| `opencode-config-format.ts` | OpenCode config format constants and type guards |
| `parse-opencode-config-file.ts` | Parse opencode.json/opencode.jsonc with fallback |
| `plugin-name-with-version.ts` | Resolve `oh-my-opencode@X.Y.Z` for installation |
| `write-omo-config.ts` | Write generated config to `.opencode/oh-my-opencode.jsonc` |

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
- `jsonc-provider-editor.ts` uses comment-preserving JSONC library — NEVER use `JSON.parse` on JSONC files
- `opencode-binary.ts` searches PATH + common install locations (`.local/bin`, `~/.bun/bin`, etc.)
