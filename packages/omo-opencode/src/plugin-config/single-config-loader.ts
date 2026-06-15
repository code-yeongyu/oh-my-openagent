import { isPlainRecord, parseConfigSections } from "@oh-my-opencode/utils"
import * as fs from "fs";
import { OhMyOpenCodeConfigSchema, type OhMyOpenCodeConfig } from "../config";
import {
  addConfigLoadError,
  log,
  migrateConfigFile,
  parseJsonc,
} from "../shared";
import { addAgentOrderWarnings } from "./agent-order-warnings";



export function loadExplicitGitMasterOverrides(configPath: string): Record<string, unknown> | undefined {
  try {
    if (!fs.existsSync(configPath)) {
      return undefined;
    }

    const content = fs.readFileSync(configPath, "utf-8");
    const rawConfig = parseJsonc<Record<string, unknown>>(content);
    const gitMaster = rawConfig.git_master;

    if (isPlainRecord(gitMaster)) {
      return gitMaster;
    }
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    return undefined;
  }

  return undefined;
}

export function parseConfigPartially(
  rawConfig: Record<string, unknown>
): Partial<OhMyOpenCodeConfig> | null {
  return parseConfigSections(OhMyOpenCodeConfigSchema, rawConfig, {
    onInvalidSections: (invalidSections) => {
      log("Partial config loaded - invalid sections skipped:", invalidSections);
    },
  });
}

export function loadConfigFromPath(
  configPath: string,
  _ctx: unknown
): Partial<OhMyOpenCodeConfig> | null {
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
