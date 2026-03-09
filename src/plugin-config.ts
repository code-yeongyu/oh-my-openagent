import * as fs from "fs";
import * as path from "path";
import { MatrixxConfigSchema, type MatrixxConfig } from "./config";
import { expandProfile, PROFILE_NAMES } from "./config/profiles";
import {
  log,
  deepMerge,
  getOpenCodeConfigDir,
  addConfigLoadError,
  parseJsonc,
  detectConfigFile,
  migrateConfigFile,
} from "./shared";

export function parseConfigPartially(
  rawConfig: Record<string, unknown>
): MatrixxConfig | null {
  const fullResult = MatrixxConfigSchema.safeParse(rawConfig);
  if (fullResult.success) {
    return fullResult.data;
  }

  const partialConfig: Record<string, unknown> = {};
  const invalidSections: string[] = [];

  for (const key of Object.keys(rawConfig)) {
    const sectionResult = MatrixxConfigSchema.safeParse({ [key]: rawConfig[key] });
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

  return partialConfig as MatrixxConfig;
}

export function loadConfigFromPath(
  configPath: string,
  _ctx: unknown
): MatrixxConfig | null {
  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, "utf-8");
      const rawConfig = parseJsonc<Record<string, unknown>>(content);

      migrateConfigFile(configPath, rawConfig);

      const result = MatrixxConfigSchema.safeParse(rawConfig);

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
  base: MatrixxConfig,
  override: MatrixxConfig
): MatrixxConfig {
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
    claude_code: deepMerge(base.claude_code, override.claude_code),
  };
}

function resolveConfigPath(baseDir: string, configName: string): string {
  const newBase = path.join(baseDir, "matrixx");
  const newDetected = detectConfigFile(newBase);
  if (newDetected.format !== "none") {
    return newDetected.path;
  }

  const legacyBase = path.join(baseDir, configName);
  const legacyDetected = detectConfigFile(legacyBase);
  if (legacyDetected.format !== "none") {
    log(
      `Deprecation: "${path.basename(legacyDetected.path)}" detected. ` +
        `Rename to "matrixx.json" or "matrixx.jsonc".`
    );
    return legacyDetected.path;
  }

  return newBase + ".json";
}

export function loadPluginConfig(
  directory: string,
  ctx: unknown
): MatrixxConfig {
  const configDir = getOpenCodeConfigDir({ binary: "opencode" });
  const userConfigPath = resolveConfigPath(configDir, "matrixx");

  const projectDir = path.join(directory, ".opencode");
  const projectConfigPath = resolveConfigPath(projectDir, "matrixx");

  let config: MatrixxConfig =
    loadConfigFromPath(userConfigPath, ctx) ?? {};

  const projectConfig = loadConfigFromPath(projectConfigPath, ctx);
  if (projectConfig) {
    config = mergeConfigs(config, projectConfig);
  }

  if (config.profile && PROFILE_NAMES.includes(config.profile)) {
    const profileDefaults = expandProfile(config.profile) as MatrixxConfig;
    config = mergeConfigs(profileDefaults, config);
  }

  log("Final merged config", {
    agents: config.agents,
    disabled_agents: config.disabled_agents,
    disabled_mcps: config.disabled_mcps,
    disabled_hooks: config.disabled_hooks,
    claude_code: config.claude_code,
  });
  return config;
}
