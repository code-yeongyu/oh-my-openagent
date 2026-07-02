import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "../../..");
const packageRoot = join(repositoryRoot, "packages/omo-ai");
const hooksPath = join(packageRoot, "senpi/hooks/omo-senpi-hooks.json");

type HookCommand = {
  readonly command: string;
  readonly component: string;
  readonly runnerPath: string;
  readonly targetPath: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readHookCommands(): readonly HookCommand[] {
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

describe("senpi component hook shims", () => {
  it("points every emitted command hook at a packaged senpi component CLI target", () => {
    // Given: Senpi loads commands relative to the installed omo-ai package root.
    const commands = readHookCommands();

    // When: every command target is resolved against the package root.
    const missingTargets = commands.filter((command) =>
      !existsSync(command.runnerPath) || !existsSync(command.targetPath)
    );

    // Then: commands use the package-owned senpi component tree and every target exists.
    expect(commands.length).toBe(11);
    expect(
      commands.every((command) =>
        command.command.includes("${SENPI_HOOK_SOURCE%/hooks/omo-senpi-hooks.json}/components/run-hook.mjs"),
      ),
    ).toBe(true);
    expect(missingTargets).toEqual([]);
  });

  it("runs a packaged senpi component hook command and records a safe marker", () => {
    // Given: the installed hook command receives Senpi's hook-source environment.
    const pluginData = mkdtempSync(join(tmpdir(), "omo-ai-component-marker-"));
    const command = readHookCommands().find((candidate) => candidate.component === "rules");

    try {
      if (command === undefined) {
        throw new TypeError("rules hook command must exist");
      }

      // When: the package hook runner is run with Senpi's hook-source environment.
      const result = spawnSync("node", [command.runnerPath, "rules", "hook", "session-start"], {
        cwd: packageRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          SENPI_HOOK_SOURCE: hooksPath,
          PLUGIN_DATA: pluginData,
        },
      });
      const markerPath = join(pluginData, "senpi-component-hooks.jsonl");

      // Then: the shim exits cleanly, prints nothing sensitive, and records the hook marker.
      expect(result.status).toBe(0);
      expect(result.stderr.trim()).toBe("");
      expect(result.stdout.trim()).toBe("");
      expect(readFileSync(markerPath, "utf8")).toContain(
        '"component":"rules","argv":["hook","session-start"]',
      );
    } finally {
      rmSync(pluginData, { recursive: true, force: true });
    }
  });
});
