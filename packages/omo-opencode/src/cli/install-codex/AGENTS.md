# src/cli/install-codex/ — Codex Light Edition Installer (39 Files)

**Generated:** 2026-06-06

## OVERVIEW

Installs the `omo` plugin into `~/.codex/` for the Codex CLI Light edition. This directory is now an OpenCode CLI adapter shim over the canonical installer source in [`packages/omo-codex/src/install/`](../../../../../packages/omo-codex/src/install). Entry: `runCodexInstaller()` in `install-codex.ts`. Triggered by `bunx oh-my-openagent install --platform=codex` (alias `npx lazycodex-ai install`).

## KEY FILES

| File | Purpose |
|------|---------|
| `install-codex.ts` | Main orchestrator `runCodexInstaller()` — resolves paths, loops over marketplace plugins, drives cache/install/config phases |
| `types.ts` | `CodexInstallOptions`, `CodexInstallResult`, `MarketplaceManifest`, `PluginManifest`, `InstalledPlugin` |
| `codex-marketplace.ts` | Reads `packages/omo-codex/marketplace.json` and per-plugin `.codex-plugin/plugin.json`; validates path segments |
| `codex-cache-install.ts` | Builds source, copies to temp cache dir, runs `npm ci --omit=dev`, rewrites MCP manifest, atomically promotes to `~/.codex/plugins/cache/{marketplace}/{name}/{version}/` |
| `codex-cache-bins.ts` | Discovers `package.json` `bin` entries, links component CLIs into bin dir; writes `omo` runtime wrapper (POSIX shell / Windows `.cmd`) |
| `link-cached-plugin-agents.ts` | Discovers bundled agent TOMLs under `components/*/agents/`, copies to `~/.codex/agents/`, preserves existing `model_reasoning_effort` and `service_tier`, writes `.installed-agents.json` manifest |
| `codex-marketplace-snapshot.ts` | Writes local marketplace snapshot to `~/.codex/.tmp/marketplaces/{marketplace}/` |
| `codex-config-toml.ts` | Mutates `~/.codex/config.toml`: enables features, sets marketplace/plugin/agent/hook-trust blocks, optional autonomous permissions |
| `codex-cleanup.ts` | Uninstall orchestrator: removes cache, agents, config blocks, project-local artifacts |

## INSTALL FLOW

```
runCodexInstaller()
  1. resolve repoRoot / codexHome / binDir / projectDirectory
  2. git-bash.ts: Windows Git Bash preflight (auto-install via winget if missing)
  3. codex-marketplace.ts: read marketplace.json + plugin manifests
  4. lazycodex-version-stamp.ts: resolve plugin version from distribution manifest
  5. For each marketplace plugin:
     a. codex-cache-install.ts: build, copy, npm ci, rewrite MCP manifest, promote to cache
     b. codex-cache-bins.ts: link component CLIs + omo runtime wrapper
     c. link-cached-plugin-agents.ts: copy agent TOMLs to ~/.codex/agents/
  6. codex-cache-prune.ts: remove stale plugins + legacy marketplace caches
  7. codex-config-toml.ts: mutate ~/.codex/config.toml
  8. codex-project-local-cleanup-best-effort.ts: repair project-local .codex/config.toml conflicts
  9. Telemetry: track install_completed
```

## WHAT IT WRITES

| Path | What |
|------|------|
| `~/.codex/plugins/cache/{marketplace}/{plugin}/{version}/` | Built plugin cache (npm installed, MCP manifest rewritten) |
| `~/.codex/.tmp/marketplaces/{marketplace}/` | Local marketplace snapshot (copied plugin sources + `marketplace.json`) |
| `~/.codex/agents/*.toml` | Copied agent configurations from bundled components |
| `~/.codex/config.toml` | Mutated with marketplace block, plugin enablement, feature flags, agent configs, hook trust hashes, MCP policies |
| `~/.local/bin/` (or `~/.codex/bin` if custom home) | Symlinks or `.cmd` shims for component CLIs + `omo` wrapper |

## CONVENTIONS

- All TOML mutation is string-based via `toml-section-editor.ts` (no TOML parser dependency)
- Atomic directory promotion: copy to temp sibling, then `rename()`; backup restored on failure
- Windows uses `.cmd` shims; POSIX uses symlinks
- Current managed Codex agent roster: `explorer`, `librarian`, `metis`, `momus`, `plan`
- Legacy purge/back-compat code still tracks the retired reviewer agent so installs can remove stale config and agent files from older releases
- Legacy marketplace cleanup: `lazycodex` and `code-yeongyu-codex-plugins` are pruned on `sisyphuslabs` install

## ANTI-PATTERNS

- Never use a real TOML parser for config edits; the text-manipulation layer is intentional to avoid dependencies
- Never skip the temp-and-rename promotion in cache install; direct writes risk corrupting a live cache
- Never hardcode new agent names without updating `MANAGED_CODEX_AGENT_NAMES` in both `codex-config-agents.ts` and `codex-cleanup-config.ts`
