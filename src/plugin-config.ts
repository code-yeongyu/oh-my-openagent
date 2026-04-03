import * as fs from "fs";
import * as path from "path";
import { OhMyOpenCodeConfigSchema, type OhMyOpenCodeConfig } from "./config";
import {
  log,
  deepMerge,
  getOpenCodeConfigDir,
  addConfigLoadError,
  parseJsonc,
  detectPluginConfigFile,
  migrateConfigFile,
} from "./shared";
import { migrateLegacyConfigFile } from "./shared/migrate-legacy-config-file";
import { LEGACY_CONFIG_BASENAME } from "./shared/plugin-identity";

const PARTIAL_STRING_ARRAY_KEYS = new Set([
  "disabled_mcps",
  "disabled_agents",
  "disabled_skills",
  "disabled_hooks",
  "disabled_commands",
  "disabled_tools",
  "mcp_env_allowlist",
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
    log("Partial config loaded — invalid sections skipped:", invalidSections);
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
        error: `Partial config loaded — invalid sections skipped: ${errorMsg}`,
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
  const userConfigPath =
    userDetected.format !== "none"
      ? userDetected.path
      : path.join(configDir, "oh-my-opencode.json");

  if (userDetected.legacyPath) {
    log("Canonical plugin config detected alongside legacy config. Remove the legacy file to avoid confusion.", {
      canonicalPath: userDetected.path,
      legacyPath: userDetected.legacyPath,
    });
  }

  // Auto-copy legacy config file to canonical name if needed
  if (userDetected.format !== "none" && path.basename(userDetected.path).startsWith(LEGACY_CONFIG_BASENAME)) {
    migrateLegacyConfigFile(userDetected.path);
  }

  // Project-level config path - prefer .jsonc over .json
  const projectBasePath = path.join(directory, ".opencode");
  const projectDetected = detectPluginConfigFile(projectBasePath);
  const projectConfigPath =
    projectDetected.format !== "none"
      ? projectDetected.path
      : path.join(projectBasePath, "oh-my-opencode.json");

  if (projectDetected.legacyPath) {
    log("Canonical plugin config detected alongside legacy config. Remove the legacy file to avoid confusion.", {
      canonicalPath: projectDetected.path,
      legacyPath: projectDetected.legacyPath,
    });
  }

  // Auto-copy legacy project config file to canonical name if needed
  if (projectDetected.format !== "none" && path.basename(projectDetected.path).startsWith(LEGACY_CONFIG_BASENAME)) {
    migrateLegacyConfigFile(projectDetected.path);
  }

  // Load user config first (base). Parse empty config through Zod to apply field defaults.
  let config: OhMyOpenCodeConfig =
    loadConfigFromPath(userConfigPath, ctx) ?? OhMyOpenCodeConfigSchema.parse({});

  // Override with project config
  const projectConfig = loadConfigFromPath(projectConfigPath, ctx);
  if (projectConfig) {
    config = mergeConfigs(config, projectConfig);
  }

  config = {
    ...config,
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
