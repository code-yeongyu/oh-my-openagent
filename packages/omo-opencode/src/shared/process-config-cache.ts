import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Process-level cache for configuration artifacts that are identical across
 * chat folders (local fix 28, first-message-drop F5c).
 *
 * OpenCode creates one plugin instance per folder and rebuilds instances on
 * release/eviction. Every rebuild used to re-pay the full cold config-handler
 * cost (measured 11.7s of a 17.7s cold plugin setup), even though plugin
 * components, agents, commands and MCP config are identical for every chat
 * folder.
 *
 * State lives on `globalThis` behind a registered symbol so it survives
 * per-location plugin module re-imports within one OpenCode process but never
 * leaks across processes. Each entry carries its own key derived from the
 * inputs that produced it (config slices + filesystem fingerprints), so a real
 * change misses the cache and recomputes.
 *
 * Escape hatch: set OMO_DISABLE_PROCESS_CONFIG_CACHE=1 to disable all reads
 * and writes (each call recomputes, exactly the pre-fix behavior).
 */

const PROCESS_CONFIG_CACHE_SYMBOL = Symbol.for("omo.processConfigCache.v1");

export type PluginComponentsCacheEntry = {
  key: string;
  value: unknown;
};

export type ProcessConfigCacheEntries = {
  pluginComponents?: PluginComponentsCacheEntry;
  agentSnapshots?: Map<string, unknown>;
  globalCommandSources?: PluginComponentsCacheEntry;
  claudeMcpServers?: PluginComponentsCacheEntry;
};

type ProcessConfigCacheState = {
  entries: ProcessConfigCacheEntries;
};

export function isProcessConfigCacheDisabled(): boolean {
  return process.env.OMO_DISABLE_PROCESS_CONFIG_CACHE === "1";
}

function getProcessState(): ProcessConfigCacheState {
  const holder = globalThis as Record<symbol, unknown>;
  let state = holder[PROCESS_CONFIG_CACHE_SYMBOL] as ProcessConfigCacheState | undefined;
  if (state === undefined) {
    state = { entries: {} };
    holder[PROCESS_CONFIG_CACHE_SYMBOL] = state;
  }
  return state;
}

export function getProcessConfigCacheEntry<K extends keyof ProcessConfigCacheEntries>(
  name: K,
): ProcessConfigCacheEntries[K] | undefined {
  if (isProcessConfigCacheDisabled()) return undefined;
  return getProcessState().entries[name];
}

export function setProcessConfigCacheEntry<K extends keyof ProcessConfigCacheEntries>(
  name: K,
  value: ProcessConfigCacheEntries[K],
): void {
  if (isProcessConfigCacheDisabled()) return;
  getProcessState().entries[name] = value;
}

export function getProcessAgentSnapshotMap(): Map<string, unknown> {
  const existing = getProcessConfigCacheEntry("agentSnapshots");
  if (existing instanceof Map) return existing;
  const created = new Map<string, unknown>();
  setProcessConfigCacheEntry("agentSnapshots", created);
  return created;
}

/** Test-only: drop every process-level config cache entry. */
export function resetProcessConfigCacheForTests(): void {
  const holder = globalThis as Record<symbol, unknown>;
  delete holder[PROCESS_CONFIG_CACHE_SYMBOL];
}

function describeStat(path: string): string {
  try {
    const stats = statSync(path);
    return `${stats.mtimeMs}:${stats.size}`;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code ?? "unknown";
    return code === "ENOENT" ? "absent" : `stat-error:${code}`;
  }
}

function describeDir(path: string): string {
  const statPart = describeStat(path);
  if (statPart === "absent" || statPart.startsWith("stat-error:")) {
    return statPart;
  }
  try {
    const entries = readdirSync(path).sort();
    return `${statPart}:[${entries.join("|")}]`;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code ?? "unknown";
    return `${statPart}:readdir-error:${code}`;
  }
}

/**
 * Fingerprint the project-level sources the config-handler loaders read from a
 * folder. Folders where none of these roots exist (every OpenChamber chat
 * folder is an empty directory) contribute nothing loader-visible, so they all
 * map to the constant "no-project-sources" signature and can share cached
 * config artifacts. Any folder with at least one root is keyed by directory +
 * full signature instead.
 */
const PROJECT_SOURCE_ROOTS = [
  ".claude",
  ".opencode",
  "opencode",
  "agents",
  "skills",
  "commands",
  ".mcp.json",
  "opencode.json",
  "opencode.jsonc",
  "AGENTS.md",
  "CLAUDE.md",
] as const;

export const NO_PROJECT_SOURCES_FINGERPRINT = "no-project-sources";

export function fingerprintProjectSources(directory: string): string {
  const present: Array<string> = [];
  for (const root of PROJECT_SOURCE_ROOTS) {
    try {
      statSync(join(directory, root));
      present.push(root);
    } catch {
      // not present in this folder
    }
  }
  if (present.length === 0) {
    return NO_PROJECT_SOURCES_FINGERPRINT;
  }
  const details = present.map((root) => `${root}=${describeDir(join(directory, root))}`);
  return `dir:${directory}:${details.join(";")}`;
}

/** Fingerprint the Claude Code plugin installation roots (~/.claude/plugins). */
export function fingerprintClaudePluginRoots(): string {
  const home = homedir();
  return [
    describeDir(join(home, ".claude", "plugins")),
    describeStat(join(home, ".claude", "plugins", "installed_plugins.json")),
    describeStat(join(home, ".claude", "settings.json")),
  ].join(";");
}

/** Fingerprint the global files the Claude Code MCP loader reads. */
export function fingerprintClaudeMcpSources(): string {
  const home = homedir();
  return [
    describeStat(join(home, ".claude.json")),
    describeStat(join(home, ".claude", "settings.json")),
  ].join(";");
}
