import * as fs from "fs";
import { OhMyOpenCodeConfigSchema, type OhMyOpenCodeConfig } from "../config";
import {
  addConfigLoadError,
  log,
  migrateConfigFile,
  parseJsonc,
} from "../shared";
import { addAgentOrderWarnings } from "./agent-order-warnings";

const PARTIAL_STRING_ARRAY_KEYS = new Set([
  "disabled_mcps",
  "disabled_agents",
  "disabled_skills",
  "disabled_hooks",
  "disabled_commands",
  "disabled_tools",
  "disabled_providers",
  "mcp_env_allowlist",
  "agent_definitions",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function loadExplicitGitMasterOverrides(configPath: string): Record<string, unknown> | undefined {
  try {
    if (!fs.existsSync(configPath)) {
      return undefined;
    }

    const content = fs.readFileSync(configPath, "utf-8");
    const rawConfig = parseJsonc<Record<string, unknown>>(content);
    const gitMaster = rawConfig.git_master;

    if (isRecord(gitMaster)) {
      return gitMaster;
    }
  } catch {
    return undefined;
  }

  return undefined;
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
      const parsedEntry = Object.entries(sectionResult.data).find(([entryKey]) => entryKey === key);
      if (parsedEntry?.[1] !== undefined) {
        partialConfig[key] = parsedEntry[1];
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

  return OhMyOpenCodeConfigSchema.parse(partialConfig);
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
        addAgentOrderWarnings(configPath, result.data.agent_order);
        log(`Config loaded from ${configPath}`, {
          agents: result.data.agents,
          team_mode: result.data.team_mode,
        });
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
        addAgentOrderWarnings(configPath, partialResult.agent_order);
        log(`Partial config loaded from ${configPath}`, {
          agents: partialResult.agents,
          team_mode: partialResult.team_mode,
        });
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
