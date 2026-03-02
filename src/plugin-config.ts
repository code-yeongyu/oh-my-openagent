import * as fs from "fs";
import * as path from "path";
import {
  OhMyOpenCodeConfigSchema,
  OverridableAgentNameSchema,
  type OhMyOpenCodeConfig,
} from "./config";
import {
  log,
  deepMerge,
  getOpenCodeConfigDir,
  addConfigLoadError,
  parseJsonc,
  detectConfigFile,
  migrateConfigFile,
} from "./shared";

const BUILTIN_AGENT_OVERRIDE_KEYS = OverridableAgentNameSchema.options;
const BUILTIN_AGENT_OVERRIDE_KEYS_BY_LOWER = new Map(
  BUILTIN_AGENT_OVERRIDE_KEYS.map((key) => [key.toLowerCase(), key]),
);

function levenshteinDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let i = 0; i < rows; i += 1) matrix[i][0] = i;
  for (let j = 0; j < cols; j += 1) matrix[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[rows - 1][cols - 1];
}

type AgentTypoWarning = {
  key: string;
  suggestion: string;
};

export function detectLikelyBuiltinAgentTypos(
  rawConfig: Record<string, unknown>,
): AgentTypoWarning[] {
  const agents = rawConfig.agents;
  if (!agents || typeof agents !== "object") return [];

  const warnings: AgentTypoWarning[] = [];
  for (const key of Object.keys(agents)) {
    const lowerKey = key.toLowerCase();
    if (BUILTIN_AGENT_OVERRIDE_KEYS_BY_LOWER.has(lowerKey)) {
      continue;
    }

    let bestMatchLower: string | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const builtinKey of BUILTIN_AGENT_OVERRIDE_KEYS) {
      const distance = levenshteinDistance(lowerKey, builtinKey.toLowerCase());
      if (distance < bestDistance) {
        bestDistance = distance;
        bestMatchLower = builtinKey.toLowerCase();
      }
    }

    if (bestMatchLower && bestDistance <= 2) {
      const suggestion = BUILTIN_AGENT_OVERRIDE_KEYS_BY_LOWER.get(bestMatchLower) ?? bestMatchLower;
      warnings.push({ key, suggestion });
    }
  }

  return warnings;
}

export function detectUnknownBuiltinAgentKeys(
  rawConfig: Record<string, unknown>,
  excludeKeys: string[] = [],
): string[] {
  const agents = rawConfig.agents;
  if (!agents || typeof agents !== "object") return [];

  const excluded = new Set(excludeKeys.map((key) => key.toLowerCase()));

  return Object.keys(agents).filter(
    (key) => {
      const lower = key.toLowerCase();
      return (
        !BUILTIN_AGENT_OVERRIDE_KEYS_BY_LOWER.has(lower)
        && !excluded.has(lower)
      );
    },
  );
}

export function parseConfigPartially(
  rawConfig: Record<string, unknown>
): OhMyOpenCodeConfig | null {
  const fullResult = OhMyOpenCodeConfigSchema.safeParse(rawConfig);
  if (fullResult.success) {
    return fullResult.data;
  }

  const partialConfig: Record<string, unknown> = {};
  const invalidSections: string[] = [];

  const parseAgentSectionEntries = (sectionKey: "agents" | "custom_agents"): void => {
    const rawSection = rawConfig[sectionKey];
    if (!rawSection || typeof rawSection !== "object") return;

    const parsedSection: Record<string, unknown> = {};
    const invalidEntries: string[] = [];

    for (const [entryKey, entryValue] of Object.entries(rawSection)) {
      const singleEntryResult = OhMyOpenCodeConfigSchema.safeParse({
        [sectionKey]: { [entryKey]: entryValue },
      });

      if (singleEntryResult.success) {
        const parsed = singleEntryResult.data as Record<string, unknown>;
        const parsedSectionValue = parsed[sectionKey];
        if (parsedSectionValue && typeof parsedSectionValue === "object") {
          const typedSection = parsedSectionValue as Record<string, unknown>;
          if (typedSection[entryKey] !== undefined) {
            parsedSection[entryKey] = typedSection[entryKey];
          }
        }
        continue;
      }

      const entryErrors = singleEntryResult.error.issues
        .map((issue) => `${entryKey}: ${issue.message}`)
        .join(", ");
      if (entryErrors) {
        invalidEntries.push(entryErrors);
      }
    }

    if (Object.keys(parsedSection).length > 0) {
      partialConfig[sectionKey] = parsedSection;
    }
    if (invalidEntries.length > 0) {
      invalidSections.push(`${sectionKey}: ${invalidEntries.join(", ")}`);
    }
  };

  for (const key of Object.keys(rawConfig)) {
    if (key === "agents" || key === "custom_agents") {
      parseAgentSectionEntries(key);
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

      const typoWarnings = detectLikelyBuiltinAgentTypos(rawConfig);
      if (typoWarnings.length > 0) {
        const warningMsg = typoWarnings
          .map((warning) => `agents.${warning.key} (did you mean agents.${warning.suggestion}?)`)
          .join(", ");
        log(`Potential agent override typos in ${configPath}: ${warningMsg}`);
        addConfigLoadError({
          path: configPath,
          error: `Potential agent override typos detected: ${warningMsg}`,
        });
      }

      const unknownAgentKeys = detectUnknownBuiltinAgentKeys(
        rawConfig,
        typoWarnings.map((warning) => warning.key),
      );
      if (unknownAgentKeys.length > 0) {
        const unknownKeysMsg = unknownAgentKeys.map((key) => `agents.${key}`).join(", ");
        const migrationHint = "Move custom entries from agents.* to custom_agents.*";
        log(`Unknown built-in agent override keys in ${configPath}: ${unknownKeysMsg}. ${migrationHint}`);
        addConfigLoadError({
          path: configPath,
          error: `Unknown built-in agent override keys: ${unknownKeysMsg}. ${migrationHint}`,
        });
      }

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
    custom_agents: deepMerge(base.custom_agents, override.custom_agents),
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

export function loadPluginConfig(
  directory: string,
  ctx: unknown
): OhMyOpenCodeConfig {
  // User-level config path - prefer .jsonc over .json
  const configDir = getOpenCodeConfigDir({ binary: "opencode" });
  const userBasePath = path.join(configDir, "oh-my-opencode");
  const userDetected = detectConfigFile(userBasePath);
  const userConfigPath =
    userDetected.format !== "none"
      ? userDetected.path
      : userBasePath + ".json";

  // Project-level config path - prefer .jsonc over .json
  const projectBasePath = path.join(directory, ".opencode", "oh-my-opencode");
  const projectDetected = detectConfigFile(projectBasePath);
  const projectConfigPath =
    projectDetected.format !== "none"
      ? projectDetected.path
      : projectBasePath + ".json";

  // Load user config first (base)
  let config: OhMyOpenCodeConfig =
    loadConfigFromPath(userConfigPath, ctx) ?? {};

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
    custom_agents: config.custom_agents,
    disabled_agents: config.disabled_agents,
    disabled_mcps: config.disabled_mcps,
    disabled_hooks: config.disabled_hooks,
    claude_code: config.claude_code,
  });
  return config;
}
