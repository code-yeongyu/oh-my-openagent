import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isRecord } from "./json-file.mjs";

export const OMO_AI_PACKAGE_VERSION = "4.15.0";
export const SENPI_CONFIG_DIR_NAME = ".senpi";

export const OMO_PACKAGE_FILTERS = {
  extensions: ["senpi/extensions/**/*"],
  skills: ["senpi/skills/**/*.md"],
  prompts: ["senpi/prompts/**/*.md"],
  hooks: ["senpi/hooks/omo-senpi-hooks.json"],
};

export function findPackageRoot(startUrl) {
  let current = dirname(fileURLToPath(startUrl));
  while (current !== dirname(current)) {
    const manifestPath = join(current, "package.json");
    if (existsSync(manifestPath)) {
      const parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (isRecord(parsed) && parsed.name === "omo-ai") {
        return current;
      }
    }
    current = dirname(current);
  }
  throw new Error("Could not locate omo-ai package root from runtime path.");
}

export function resolveAgentDir(env = process.env) {
  const configured =
    env.OMO_AI_SENPI_AGENT_DIR ??
    env.PI_CODING_AGENT_DIR ??
    env.SENPI_CODING_AGENT_DIR;
  if (configured && configured.trim() !== "") {
    return expandTilde(configured);
  }
  return join(homedir(), SENPI_CONFIG_DIR_NAME, "agent");
}

export function senpiPaths(packageRoot, agentDir) {
  return {
    packageRoot,
    payloadRoot: join(packageRoot, "senpi"),
    hooksManifestPath: join(packageRoot, "senpi/hooks/omo-senpi-hooks.json"),
    settingsPath: join(agentDir, "settings.json"),
    hooksStatePath: join(agentDir, "hooks-state.json"),
  };
}

function expandTilde(input) {
  if (input === "~") {
    return homedir();
  }
  if (input.startsWith("~/")) {
    return resolve(homedir(), input.slice(2));
  }
  return resolve(input);
}
