import * as fs from "fs";
import { homedir } from "node:os";
import * as path from "path";
import { OhMyOpenCodeConfigSchema, type OhMyOpenCodeConfig } from "../config";
import { applyDisabledProviders } from "../shared/disabled-providers";
import { migrateLegacyConfigFile } from "../shared/migrate-legacy-config-file";
import { CONFIG_BASENAME, LEGACY_CONFIG_BASENAME } from "../shared/plugin-identity";
import {
  containsPath,
  detectPluginConfigFile,
  findProjectOpencodePluginConfigFiles,
  getOpenCodeConfigDirs,
  log,
  resolveAgentDefinitionPaths,
} from "../shared";
import { mergeConfigs } from "./config-merger";
import { loadConfigFromPath, loadExplicitGitMasterOverrides } from "./single-config-loader";

function resolveHomeDirectory(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? homedir();
}

function resolveConfigPathAfterLegacyMigration(detectedPath: string): string {
  if (!path.basename(detectedPath).startsWith(LEGACY_CONFIG_BASENAME)) {
    return detectedPath;
  }

  const migrated = migrateLegacyConfigFile(detectedPath);
  const canonicalPath = path.join(
    path.dirname(detectedPath),
    `${CONFIG_BASENAME}${path.extname(detectedPath)}`,
  );

  if (migrated || fs.existsSync(canonicalPath)) {
    return canonicalPath;
  }

  return detectedPath;
}

function getUserConfigLayers(): Array<{ readonly configDir: string; readonly configPath: string | null }> {
  const userConfigDirs = [...getOpenCodeConfigDirs({ binary: "opencode" })].reverse();
  return userConfigDirs.map((configDir) => {
    const detected = detectPluginConfigFile(configDir, {
      basenames: [CONFIG_BASENAME],
      legacyBasenames: [LEGACY_CONFIG_BASENAME],
    });

    if (detected.legacyPath) {
      log("Canonical plugin config detected alongside legacy config. Remove the legacy file to avoid confusion.", {
        canonicalPath: detected.path,
        legacyPath: detected.legacyPath,
      });
    }

    const configPath = detected.format !== "none"
      ? resolveConfigPathAfterLegacyMigration(detected.path)
      : null;

    return { configDir, configPath };
  });
}

function getCanonicalAncestorPathsNearestFirst(directory: string): string[] {
  const homeDirectory = resolveHomeDirectory();
  const stopDirectory = containsPath(homeDirectory, directory) ? homeDirectory : directory;
  const ancestorConfigPathsNearestFirst = findProjectOpencodePluginConfigFiles(
    directory,
    stopDirectory,
  );
  log("Walked ancestor plugin configs", {
    paths: ancestorConfigPathsNearestFirst,
    count: ancestorConfigPathsNearestFirst.length,
    stopDirectory,
  });

  return ancestorConfigPathsNearestFirst.map((ancestorPath) => {
    const opencodeDir = path.dirname(ancestorPath);
    const ancestorDetected = detectPluginConfigFile(opencodeDir, {
      basenames: [CONFIG_BASENAME],
      legacyBasenames: [LEGACY_CONFIG_BASENAME],
    });
    if (ancestorDetected.legacyPath) {
      log("Canonical plugin config detected alongside legacy config. Remove the legacy file to avoid confusion.", {
        canonicalPath: ancestorDetected.path,
        legacyPath: ancestorDetected.legacyPath,
      });
    }
    return resolveConfigPathAfterLegacyMigration(ancestorPath);
  });
}

function resolveUserAgentDefinitions(
  config: Partial<OhMyOpenCodeConfig>,
  configDir: string,
): void {
  if (!config.agent_definitions) return;

  config.agent_definitions = resolveAgentDefinitionPaths(
    config.agent_definitions,
    configDir,
    null,
  );
}

function resolveAncestorAgentDefinitions(
  config: Partial<OhMyOpenCodeConfig>,
  ancestorPath: string,
): void {
  if (!config.agent_definitions) return;

  const ancestorBasePath = path.dirname(ancestorPath);
  const ancestorDir = path.dirname(ancestorBasePath);
  config.agent_definitions = resolveAgentDefinitionPaths(
    config.agent_definitions,
    ancestorBasePath,
    ancestorDir,
  );
}

export function loadPluginConfig(
  directory: string,
  ctx: unknown
): OhMyOpenCodeConfig {
  const userConfigLayers = getUserConfigLayers();
  const canonicalAncestorPathsNearestFirst = getCanonicalAncestorPathsNearestFirst(directory);

  let config: OhMyOpenCodeConfig = OhMyOpenCodeConfigSchema.parse({});
  let mergedUserGitMasterOverrides: Record<string, unknown> | null = null;

  for (const userLayer of userConfigLayers) {
    if (!userLayer.configPath) continue;

    const userConfig = loadConfigFromPath(userLayer.configPath, ctx);
    const userGitMasterOverrides = loadExplicitGitMasterOverrides(userLayer.configPath);

    if (userConfig) {
      resolveUserAgentDefinitions(userConfig, userLayer.configDir);
      config = mergeConfigs(config, userConfig);
    }

    if (userGitMasterOverrides) {
      mergedUserGitMasterOverrides = {
        ...(mergedUserGitMasterOverrides ?? {}),
        ...userGitMasterOverrides,
      };
    }
  }

  const userMcpEnvAllowlist = config.mcp_env_allowlist ?? [];
  const canonicalAncestorPathsFarthestFirst = [...canonicalAncestorPathsNearestFirst].reverse();
  const defaultGitMaster = OhMyOpenCodeConfigSchema.parse({}).git_master;
  const ancestorGitMasterOverridesFarthestFirst: Array<Record<string, unknown>> = [];

  for (const ancestorPath of canonicalAncestorPathsFarthestFirst) {
    const ancestorConfig = loadConfigFromPath(ancestorPath, ctx);
    const ancestorOverrides = loadExplicitGitMasterOverrides(ancestorPath);

    if (ancestorConfig) {
      resolveAncestorAgentDefinitions(ancestorConfig, ancestorPath);
      config = mergeConfigs(config, ancestorConfig);
    }

    if (ancestorOverrides) {
      ancestorGitMasterOverridesFarthestFirst.push(ancestorOverrides);
    }
  }

  if (mergedUserGitMasterOverrides || ancestorGitMasterOverridesFarthestFirst.length > 0) {
    const mergedAncestorGitMaster: Record<string, unknown> = {};
    for (const override of ancestorGitMasterOverridesFarthestFirst) {
      Object.assign(mergedAncestorGitMaster, override);
    }
    config = {
      ...config,
      git_master: {
        ...defaultGitMaster,
        ...(mergedUserGitMasterOverrides ?? {}),
        ...mergedAncestorGitMaster,
      },
    };
  }

  config = {
    ...config,
    mcp_env_allowlist: userMcpEnvAllowlist,
  };

  applyDisabledProviders(config);

  log("Final merged config", {
    agents: config.agents,
    team_mode: config.team_mode,
    disabled_agents: config.disabled_agents,
    disabled_mcps: config.disabled_mcps,
    disabled_hooks: config.disabled_hooks,
    disabled_providers: config.disabled_providers,
    claude_code: config.claude_code,
  });
  return config;
}
