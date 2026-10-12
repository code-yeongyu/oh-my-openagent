import { createHash } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { getClaudeConfigDir } from "./claude-config-dir";
import { getOpenCodeConfigDirs } from "./opencode-config-dir";

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
 * leaks across processes.
 *
 * Every entry is keyed by ALL the inputs that produced it (local fix 31): the
 * OpenCode config slice, the effective OMO config, the loaded plugin
 * components, and content fingerprints (path, mtime, size of every file, to a
 * bounded depth) of the global and project source directories the loaders
 * read. A source tree too large to fingerprint is not cached at all.
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

/** Snapshots are small in number in practice; the bound only stops a pathological key churn. */
const AGENT_SNAPSHOT_LIMIT = 64;

export function getProcessAgentSnapshotMap(): Map<string, unknown> {
  const existing = getProcessConfigCacheEntry("agentSnapshots");
  if (existing instanceof Map) return existing;
  const created = new Map<string, unknown>();
  setProcessConfigCacheEntry("agentSnapshots", created);
  return created;
}

/** Stores a snapshot, dropping the oldest entries beyond the bound. */
export function rememberAgentSnapshot(map: Map<string, unknown>, key: string, value: unknown): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > AGENT_SNAPSHOT_LIMIT) {
    map.delete(map.keys().next().value as string);
  }
}

/** Test-only: drop every process-level config cache entry. */
export function resetProcessConfigCacheForTests(): void {
  const holder = globalThis as Record<symbol, unknown>;
  delete holder[PROCESS_CONFIG_CACHE_SYMBOL];
}

/** Order-independent digest of a JSON-like value. */
export function stableDigest(value: unknown): string {
  const seen = new WeakSet<object>();
  const normalize = (input: unknown): unknown => {
    if (typeof input !== "object" || input === null) {
      return typeof input === "function" || typeof input === "symbol" ? String(input) : input;
    }
    if (seen.has(input)) return "[circular]";
    seen.add(input);
    if (Array.isArray(input)) return input.map(normalize);
    if (input instanceof Set) return [...input].map(normalize);
    if (input instanceof Map) return [...input.entries()].map(([key, entry]) => [normalize(key), normalize(entry)]);
    const record = input as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, normalize(record[key])]),
    );
  };
  return createHash("sha1").update(JSON.stringify(normalize(value)) ?? "undefined").digest("hex");
}

/** Digest of the whole process environment (MCP config expands variables from it). */
export function digestEnvironment(env: NodeJS.ProcessEnv = process.env): string {
  const hash = createHash("sha1");
  for (const name of Object.keys(env).sort()) hash.update(`${name}=${env[name] ?? ""}\0`);
  return hash.digest("hex");
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

export type FingerprintMemo = Map<string, string | undefined>;

const TREE_MAX_DEPTH = 6;
const TREE_MAX_ENTRIES = 3000;
const TREE_SKIPPED_DIRECTORIES = new Set(["node_modules", ".git"]);

/**
 * Content fingerprint of a file or directory tree: the relative path, mtime
 * and size of every file down to six levels. An added, removed, renamed or
 * edited file there changes it. Returns undefined when the tree has too many
 * entries to walk cheaply (the caller must then skip its cache) and "absent"
 * when the path does not exist.
 */
export function fingerprintTree(path: string, memo?: FingerprintMemo): string | undefined {
  if (memo?.has(path)) return memo.get(path);
  const result = walkTree(path);
  memo?.set(path, result);
  return result;
}

function walkTree(root: string): string | undefined {
  let rootStats: ReturnType<typeof statSync>;
  try {
    rootStats = statSync(root);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code ?? "unknown";
    return code === "ENOENT" || code === "ENOTDIR" ? "absent" : `stat-error:${code}`;
  }
  if (!rootStats.isDirectory()) return `file:${rootStats.mtimeMs}:${rootStats.size}`;

  const hash = createHash("sha1");
  let count = 0;
  const pending: Array<{ directory: string; relative: string; depth: number }> = [
    { directory: root, relative: "", depth: 0 },
  ];
  while (pending.length > 0) {
    const current = pending.pop() as { directory: string; relative: string; depth: number };
    let entries: Array<{ name: string; isDirectory: () => boolean }>;
    try {
      entries = readdirSync(current.directory, { withFileTypes: true });
    } catch (error) {
      hash.update(`${current.relative}/!${(error as NodeJS.ErrnoException)?.code ?? "unknown"}\0`);
      continue;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      count += 1;
      if (count > TREE_MAX_ENTRIES) return undefined;
      const relative = `${current.relative}/${entry.name}`;
      const full = join(current.directory, entry.name);
      let stats: ReturnType<typeof statSync>;
      try {
        // statSync follows links, so a linked skill directory is walked like a real one.
        stats = statSync(full);
      } catch (error) {
        hash.update(`${relative}!${(error as NodeJS.ErrnoException)?.code ?? "unknown"}\0`);
        continue;
      }
      if (!stats.isDirectory()) {
        hash.update(`${relative}:${stats.mtimeMs}:${stats.size}\0`);
        continue;
      }
      // Deeper than any loader reads (and a self-referencing link must end somewhere):
      // below the cap only the directory's own stat is recorded.
      if (TREE_SKIPPED_DIRECTORIES.has(entry.name) || current.depth + 1 >= TREE_MAX_DEPTH) {
        hash.update(`${relative}/:${stats.mtimeMs}\0`);
        continue;
      }
      hash.update(`${relative}/\0`);
      pending.push({ directory: full, relative, depth: current.depth + 1 });
    }
  }
  return `tree:${count}:${hash.digest("hex")}`;
}

function fingerprintMany(paths: ReadonlyArray<string>, memo?: FingerprintMemo): string | undefined {
  const parts: Array<string> = [];
  for (const path of [...new Set(paths)]) {
    const signature = fingerprintTree(path, memo);
    if (signature === undefined) return undefined;
    if (signature !== "absent") parts.push(`${path}=${signature}`);
  }
  return parts.join(";");
}

/**
 * Fingerprint the project-level sources the config-handler loaders read from a
 * folder itself. Folders where none of these roots exist (every OpenChamber
 * chat folder is an empty directory) all map to the constant
 * "no-project-sources" signature. Any folder with at least one root is keyed
 * by directory plus the content fingerprint of every root. Returns undefined
 * when a root is too large to fingerprint.
 */
const PROJECT_SOURCE_ROOTS = [
  ".claude",
  ".opencode",
  ".agents",
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

export function fingerprintProjectSources(directory: string, memo?: FingerprintMemo): string | undefined {
  const details: Array<string> = [];
  for (const root of PROJECT_SOURCE_ROOTS) {
    const signature = fingerprintTree(join(directory, root), memo);
    if (signature === undefined) return undefined;
    if (signature !== "absent") details.push(`${root}=${signature}`);
  }
  if (details.length === 0) return NO_PROJECT_SOURCES_FINGERPRINT;
  return `dir:${directory}:${details.join(";")}`;
}

/**
 * The project loaders also search every ancestor of the folder for skill,
 * command and agent directories (up to the worktree root; this walks to the
 * filesystem root, a superset). Two folders share cached artifacts only when
 * their ancestors contribute the same content.
 */
const ANCESTOR_SOURCE_PATHS = [
  [".claude", "skills"],
  [".claude", "commands"],
  [".claude", "agents"],
  [".agents", "skills"],
  [".opencode", "skills"],
  [".opencode", "skill"],
  [".opencode", "commands"],
  [".opencode", "command"],
  [".opencode", "agents"],
  [".opencode", "agent"],
] as const;

export function fingerprintAncestorSources(directory: string, memo?: FingerprintMemo): string | undefined {
  const candidates: Array<string> = [];
  let current = resolve(directory);
  for (let depth = 0; depth < 64; depth++) {
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
    for (const segments of ANCESTOR_SOURCE_PATHS) candidates.push(join(current, ...segments));
  }
  return fingerprintMany(candidates, memo);
}

/**
 * Fingerprint the user-level directories the command, skill and agent loaders
 * read: the Claude config directory, ~/.agents and every OpenCode config
 * directory. Adding, removing or editing a user skill, command or agent
 * changes it.
 */
export function fingerprintGlobalSources(memo?: FingerprintMemo): string | undefined {
  const claudeConfigDir = getClaudeConfigDir();
  const home = process.env.HOME || process.env.USERPROFILE || homedir();
  const paths = [
    join(claudeConfigDir, "skills"),
    join(claudeConfigDir, "commands"),
    join(claudeConfigDir, "agents"),
    join(home, ".agents", "skills"),
  ];
  let configDirs: Array<string> = [];
  try {
    configDirs = getOpenCodeConfigDirs({ binary: "opencode" });
  } catch {
    configDirs = [];
  }
  for (const configDir of configDirs) {
    const roots = [configDir];
    // Profile directories inherit the parent's commands and skills.
    if (dirname(configDir).endsWith("profiles")) roots.push(dirname(dirname(configDir)));
    for (const root of roots) {
      for (const name of ["skills", "skill", "commands", "command", "agents", "agent"]) {
        paths.push(join(root, name));
      }
      paths.push(join(root, "opencode.json"), join(root, "opencode.jsonc"));
    }
  }
  return fingerprintMany(paths, memo);
}

/**
 * `file://` references inside the OMO config (agent prompts, prompt_append)
 * are read from disk while agents are built. Their targets are part of the
 * key; a relative or project-checked reference makes the result depend on the
 * folder, so such configs are never shared across folders.
 */
export function fingerprintFileReferences(
  value: unknown,
  directory: string,
): { readonly count: number; readonly signature: string } {
  const references = new Set<string>();
  const visit = (input: unknown, depth: number): void => {
    if (depth > 12) return;
    if (typeof input === "string") {
      if (input.startsWith("file://")) references.add(input);
      return;
    }
    if (Array.isArray(input)) {
      for (const entry of input) visit(entry, depth + 1);
      return;
    }
    if (typeof input === "object" && input !== null) {
      for (const entry of Object.values(input)) visit(entry, depth + 1);
    }
  };
  visit(value, 0);
  const parts = [...references].sort().map((reference) => {
    let target = reference.slice(7);
    try {
      target = decodeURIComponent(target);
    } catch {
      // keep the raw text; the reader reports the malformed URI itself
    }
    if (target.startsWith("~/")) target = join(homedir(), target.slice(2));
    const path = isAbsolute(target) ? target : resolve(directory, target);
    return `${reference}=${describeStat(path)}`;
  });
  return { count: parts.length, signature: parts.join(";") };
}

/** Fingerprint the Claude Code plugin installation roots (<claude config>/plugins). */
export function fingerprintClaudePluginRoots(): string {
  const claudeConfigDir = getClaudeConfigDir();
  const plugins = join(claudeConfigDir, "plugins");
  let listing = "";
  try {
    listing = readdirSync(plugins).sort().join("|");
  } catch (error) {
    listing = `readdir-error:${(error as NodeJS.ErrnoException)?.code ?? "unknown"}`;
  }
  return [
    `${describeStat(plugins)}:[${listing}]`,
    describeStat(join(plugins, "installed_plugins.json")),
    describeStat(join(plugins, "known_marketplaces.json")),
    describeStat(join(claudeConfigDir, "settings.json")),
  ].join(";");
}

export type ClaudeMcpLoaderContext = {
  readonly cwd: string;
  readonly homeDir: string;
  readonly claudeConfigDir: string;
};

/** The context the Claude Code MCP loader resolves when called without options. Keep in step with its resolveMcpLoaderContext(). */
export function resolveClaudeMcpLoaderContext(): ClaudeMcpLoaderContext {
  return {
    cwd: process.cwd(),
    homeDir: process.env.HOME || process.env.USERPROFILE || homedir(),
    claudeConfigDir: getClaudeConfigDir(),
  };
}

/** Fingerprint the four files the Claude Code MCP loader reads. Keep in step with its getMcpConfigPaths(). */
export function fingerprintClaudeMcpSources(
  context: ClaudeMcpLoaderContext = resolveClaudeMcpLoaderContext(),
): string {
  return [
    join(context.homeDir, ".claude.json"),
    join(context.claudeConfigDir, ".mcp.json"),
    join(context.cwd, ".mcp.json"),
    join(context.cwd, ".claude", ".mcp.json"),
  ]
    .map((path) => `${path}=${describeStat(path)}`)
    .join(";");
}
