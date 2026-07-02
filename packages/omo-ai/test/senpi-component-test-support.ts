import { readFileSync } from "node:fs";
import { join } from "node:path";

export const repositoryRoot = join(import.meta.dir, "../../..");
export const packageRoot = join(repositoryRoot, "packages/omo-ai");
export const hooksPath = join(packageRoot, "senpi/hooks/omo-senpi-hooks.json");

export type HookCommand = {
  readonly command: string;
  readonly component: string;
  readonly runnerPath: string;
  readonly targetPath: string;
};

export function readHookCommands(): readonly HookCommand[] {
  const parsed: unknown = JSON.parse(readFileSync(hooksPath, "utf8"));
  if (!isRecord(parsed) || !isRecord(parsed["hooks"])) {
    throw new TypeError("senpi hook payload must contain hooks");
  }
  return Object.values(parsed["hooks"])
    .flatMap((groups) => {
      if (!Array.isArray(groups)) {
        throw new TypeError("senpi hook event groups must be arrays");
      }
      return groups;
    })
    .flatMap(readGroupCommands)
    .map(resolveHookCommand);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readGroupCommands(group: unknown): readonly string[] {
  if (!isRecord(group) || !Array.isArray(group["hooks"])) {
    throw new TypeError("senpi hook group must contain hooks");
  }
  return group["hooks"].flatMap((handler) => {
    if (!isRecord(handler) || handler["type"] !== "command") {
      return [];
    }
    const command = handler["command"];
    return typeof command === "string" ? [command] : [];
  });
}

function resolveHookCommand(command: string): HookCommand {
  const match = command.match(
    /^node "\$\{SENPI_HOOK_SOURCE%\/hooks\/omo-senpi-hooks\.json\}\/components\/run-hook\.mjs" ([a-z0-9-]+) hook [a-z-]+$/,
  );
  if (match === null || match[1] === undefined) {
    throw new TypeError(`unsupported hook command shape: ${command}`);
  }
  const component = match[1];
  return {
    command,
    component,
    runnerPath: join(packageRoot, "senpi/components/run-hook.mjs"),
    targetPath: join(packageRoot, "senpi/components", component, "dist/cli.js"),
  };
}
