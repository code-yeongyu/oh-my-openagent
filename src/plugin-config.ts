import * as fs from "fs";
import { homedir } from "node:os";
import * as path from "path";
import { OhMyOpenCodeConfigSchema, type OhMyOpenCodeConfig } from "./config";
import {
  log,
  containsPath,
  deepMerge,
  getOpenCodeConfigDir,
  addConfigLoadError,
  parseJsonc,
  detectPluginConfigFile,
  findProjectOpencodePluginConfigFiles,
  migrateConfigFile,
  resolveAgentDefinitionPaths,
} from "./shared";
import { migrateLegacyConfigFile } from "./shared/migrate-legacy-config-file";
import { CONFIG_BASENAME, LEGACY_CONFIG_BASENAME } from "./shared/plugin-identity";

function resolveHomeDirectory(): string {
  // Read env vars directly to bypass os.homedir() caching. Bun caches the
  // first os.homedir() result, which means tests that set process.env.HOME
  // after import never see the new value. Production behaviour is preserved
  // because HOME (or USERPROFILE on Windows) is set by the OS at startup.
  return process.env.HOME ?? process.env.USERPROFILE ?? homedir()
}

function resolveConfigPathAfterLegacyMigration(detectedPath: string): string {
  if (!path.basename(detectedPath).startsWith(LEGACY_CONFIG_BASENAME)) {
    return detectedPath
  }

  const migrated = migrateLegacyConfigFile(detectedPath)
  const canonicalPath = path.join(
    path.dirname(detectedPath),
    `${CONFIG_BASENAME}${path.extname(detectedPath)}`,
  )

  // Only switch to canonical path if migration succeeded OR canonical file already exists
  if (migrated || fs.existsSync(canonicalPath)) {
    return canonicalPath
  }

  // Otherwise keep loading from the legacy path that was detected
  return detectedPath
}

function loadExplicitGitMasterOverrides(configPath: string): Record<string, unknown> | undefined {
  try {
    if (!fs.existsSync(configPath)) {
      return undefined
    }

    const content = fs.readFileSync(configPath, "utf-8")
    const rawConfig = parseJsonc<Record<string, unknown>>(content)
    const gitMaster = rawConfig.git_master

    if (gitMaster && typeof gitMaster === "object" && !Array.isArray(gitMaster)) {
      return gitMaster as Record<string, unknown>
    }
  } catch {
    return undefined
  }

  return undefined
}

const PARTIAL_STRING_ARRAY_KEYS = new Set([
  "disabled_mcps",
  "disabled_agents",
  "disabled_skills",
  "disabled_hooks",
  "disabled_commands",
  "disabled_tools",
  "mcp_env_allowlist",
  "agent_definitions",
]);

export function parseConfigPartially(
  rawConfig: Record<string, unknown>
): OhMyOpenCodeConfig | null {
  const fullResult = OhMyOpenCodeConfigSchema.safeParse(rawConfig);
  if (fullResult.success) {
    return fullResult.data;
  }

  const partialConfig: Record<string, unknown> = {};
  const invalidSections: string[] = [];

  for (const key of Object.keys(rawConfig)) {
    if (PARTIAL_STRING_ARRAY_KEYS.has(key)) {
      const sectionValue = rawConfig[key];
      if (Array.isArray(sectionValue) && sectionValue.every((value) => typeof value === "string")) {
        partialConfig[key] = sectionValue;
      }
      continue;
    }

    const sectionResult = OhMyOpenCodeConfigSchema.safeParse({ [key]: rawConfig[key] });
    if (sectionResult.success) {
      const parsed = sectionResult.data as Record<string, unknown>;
      if (parsed[key] !== undefined) {
        partialConfig[key] = parsed[key];
      }
    } else {
      const sectionErrors = sectionResult.error.issues
        .filter((i) => i.path[0] === key)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join(", ");
      if (sectionErrors) {
        invalidSections.push(`${key}: ${sectionErrors}`);
      }
    }
  }

  if (invalidSections.length > 0) {
    log("Partial config loaded - invalid sections skipped:", invalidSections);
  }

  return partialConfig as OhMyOpenCodeConfig;
}

export function loadConfigFromPath(
  configPath: string,
  _ctx: unknown
): OhMyOpenCodeConfig | null {
  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, "utf-8");
      const rawConfig = parseJsonc<Record<string, unknown>>(content);

      migrateConfigFile(configPath, rawConfig);

      const result = OhMyOpenCodeConfigSchema.safeParse(rawConfig);

      if (result.success) {
        log(`Config loaded from ${configPath}`, { agents: result.data.agents });
        return result.data;
      }

      const errorMsg = result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join(", ");
      log(`Config validation error in ${configPath}:`, result.error.issues);
      addConfigLoadError({
        path: configPath,
        error: `Partial config loaded - invalid sections skipped: ${errorMsg}`,
      });

      const partialResult = parseConfigPartially(rawConfig);
      if (partialResult) {
        log(`Partial config loaded from ${configPath}`, { agents: partialResult.agents });
        return partialResult;
      }

      return null;
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log(`Error loading config from ${configPath}:`, err);
    addConfigLoadError({ path: configPath, error: errorMsg });
  }
  return null;
}

export function mergeConfigs(
  base: OhMyOpenCodeConfig,
  override: OhMyOpenCodeConfig
): OhMyOpenCodeConfig {
  return {
    ...base,
    ...override,
    agents: deepMerge(base.agents, override.agents),
    categories: deepMerge(base.categories, override.categories),
    team_mode: deepMerge(base.team_mode, override.team_mode),
    agent_definitions: [
      ...new Set([
        ...(base.agent_definitions ?? []),
        ...(override.agent_definitions ?? []),
      ]),
    ],
    disabled_agents: [
      ...new Set([
        ...(base.disabled_agents ?? []),
        ...(override.disabled_agents ?? []),
      ]),
    ],
    disabled_mcps: [
      ...new Set([
        ...(base.disabled_mcps ?? []),
        ...(override.disabled_mcps ?? []),
      ]),
    ],
    disabled_hooks: [
      ...new Set([
        ...(base.disabled_hooks ?? []),
        ...(override.disabled_hooks ?? []),
      ]),
    ],
    disabled_commands: [
      ...new Set([
        ...(base.disabled_commands ?? []),
        ...(override.disabled_commands ?? []),
      ]),
    ],
    disabled_skills: [
      ...new Set([
        ...(base.disabled_skills ?? []),
        ...(override.disabled_skills ?? []),
      ]),
    ],
    disabled_tools: [
      ...new Set([
        ...(base.disabled_tools ?? []),
        ...(override.disabled_tools ?? []),
      ]),
    ],
    mcp_env_allowlist: [
      ...new Set([
        ...(base.mcp_env_allowlist ?? []),
        ...(override.mcp_env_allowlist ?? []),
      ]),
    ],
    claude_code: deepMerge(base.claude_code, override.claude_code),
  };
}

export function loadPluginConfig(
  directory: string,
  ctx: unknown
): OhMyOpenCodeConfig {
  // User-level config path - prefer .jsonc over .json
  const configDir = getOpenCodeConfigDir({ binary: "opencode" });
  const userDetected = detectPluginConfigFile(configDir);
  let userConfigPath =
    userDetected.format !== "none"
      ? userDetected.path
      : path.join(configDir, `${CONFIG_BASENAME}.json`);

  if (userDetected.legacyPath) {
    log("Canonical plugin config detected alongside legacy config. Remove the legacy file to avoid confusion.", {
      canonicalPath: userDetected.path,
      legacyPath: userDetected.legacyPath,
    });
  }

  // Auto-copy legacy config file to canonical name if needed
  if (userDetected.format !== "none") {
    userConfigPath = resolveConfigPathAfterLegacyMigration(userConfigPath)
  }

  // Pin the walk to $HOME only when the start directory is inside it. Outside
  // $HOME the walker would otherwise reach FS root and surface unrelated configs
  // in /tmp, /opt, etc.
  const homeDirectory = resolveHomeDirectory()
  const stopDirectory = containsPath(homeDirectory, directory) ? homeDirectory : directory
  const ancestorConfigPathsNearestFirst = findProjectOpencodePluginConfigFiles(
    directory,
    stopDirectory,
  )
  log("Walked ancestor plugin configs", {
    paths: ancestorConfigPathsNearestFirst,
    count: ancestorConfigPathsNearestFirst.length,
    stopDirectory,
  })

  // Migrate any legacy basenames among ancestors and warn on dual-config presence
  const canonicalAncestorPathsNearestFirst = ancestorConfigPathsNearestFirst.map(
    (ancestorPath) => {
      const opencodeDir = path.dirname(ancestorPath)
      const ancestorDetected = detectPluginConfigFile(opencodeDir)
      if (ancestorDetected.legacyPath) {
        log("Canonical plugin config detected alongside legacy config. Remove the legacy file to avoid confusion.", {
          canonicalPath: ancestorDetected.path,
          legacyPath: ancestorDetected.legacyPath,
        })
      }
      return resolveConfigPathAfterLegacyMigration(ancestorPath)
    },
  )

  // Load user config first (base). Parse empty config through Zod to apply field defaults.
  const userConfig = loadConfigFromPath(userConfigPath, ctx)
  const userGitMasterOverrides = loadExplicitGitMasterOverrides(userConfigPath)

  if (userConfig?.agent_definitions) {
    userConfig.agent_definitions = resolveAgentDefinitionPaths(
      userConfig.agent_definitions,
      configDir,
      null
    )
  }

  let config: OhMyOpenCodeConfig =
    userConfig ?? OhMyOpenCodeConfigSchema.parse({});

  const canonicalAncestorPathsFarthestFirst = [...canonicalAncestorPathsNearestFirst].reverse()
  const defaultGitMaster = OhMyOpenCodeConfigSchema.parse({}).git_master
  const ancestorGitMasterOverridesFarthestFirst: Array<Record<string, unknown>> = []

  for (const ancestorPath of canonicalAncestorPathsFarthestFirst) {
    const ancestorConfig = loadConfigFromPath(ancestorPath, ctx)
    const ancestorOverrides = loadExplicitGitMasterOverrides(ancestorPath)

    if (ancestorConfig?.agent_definitions) {
      // Resolve relative paths against this ancestor's own .opencode/ base.
      const ancestorBasePath = path.dirname(ancestorPath)
      const ancestorDir = path.dirname(ancestorBasePath)
      ancestorConfig.agent_definitions = resolveAgentDefinitionPaths(
        ancestorConfig.agent_definitions,
        ancestorBasePath,
        ancestorDir,
      )
    }

    if (ancestorConfig) {
      config = mergeConfigs(config, ancestorConfig)
    }

    if (ancestorOverrides) {
      ancestorGitMasterOverridesFarthestFirst.push(ancestorOverrides)
    }
  }

  if (userGitMasterOverrides || ancestorGitMasterOverridesFarthestFirst.length > 0) {
    const mergedAncestorGitMaster: Record<string, unknown> = {}
    for (const override of ancestorGitMasterOverridesFarthestFirst) {
      Object.assign(mergedAncestorGitMaster, override)
    }
    config = {
      ...config,
      git_master: {
        ...defaultGitMaster,
        ...(userGitMasterOverrides ?? {}),
        ...mergedAncestorGitMaster,
      },
    }
  }

  // Security: mcp_env_allowlist remains user-only across the entire walk.
  // This prevents clone-and-load attacks where a malicious project (or any
  // walked ancestor) could extend the env var allowlist used during ${VAR}
  // expansion in .mcp.json files. See commit 316d2504 for context.
  config = {
    ...config,
    mcp_env_allowlist: userConfig?.mcp_env_allowlist ?? [],
  };

  log("Final merged config", {
    agents: config.agents,
    disabled_agents: config.disabled_agents,
    disabled_mcps: config.disabled_mcps,
    disabled_hooks: config.disabled_hooks,
    claude_code: config.claude_code,
  });
  return config;
}
