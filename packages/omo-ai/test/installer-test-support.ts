import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export const repositoryRoot = resolve(import.meta.dir, "../../..");
export const packageRoot = join(repositoryRoot, "packages/omo-ai");
export const cliPath = join(packageRoot, "src/cli/index.mjs");
export const postinstallPath = join(packageRoot, "src/install/postinstall.mjs");

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readJsonObject(filePath: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
  if (!isRecord(parsed)) {
    throw new TypeError(`${filePath} must contain a JSON object`);
  }
  return parsed;
}

export function runCli(
  args: readonly string[],
  agentDir: string,
): { readonly status: number | null; readonly stdout: string; readonly stderr: string } {
  return runNode(cliPath, args, agentDir);
}

export function runNode(
  scriptPath: string,
  args: readonly string[],
  agentDir?: string,
  cwd = repositoryRoot,
): { readonly status: number | null; readonly stdout: string; readonly stderr: string } {
  const env = agentDir === undefined
    ? process.env
    : {
        ...process.env,
        OMO_AI_SENPI_AGENT_DIR: agentDir,
        PI_CODING_AGENT_DIR: agentDir,
        SENPI_CODING_AGENT_DIR: agentDir,
      };
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd,
    encoding: "utf8",
    env,
  });
  return {
    status: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

export function createDefaultHomeEnv(homeDir: string): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {
    ...process.env,
    HOME: homeDir,
    USERPROFILE: homeDir,
  };

  if (process.platform === "win32") {
    const drive = /^[A-Za-z]:/.exec(homeDir)?.[0] ?? "";
    env["HOMEDRIVE"] = drive;
    const homePath = drive === "" ? homeDir : homeDir.slice(drive.length);
    env["HOMEPATH"] = homePath.startsWith("\\") ? homePath : `\\${homePath}`;
  }

  delete env["OMO_AI_SENPI_AGENT_DIR"];
  delete env["PI_CODING_AGENT_DIR"];
  delete env["SENPI_CODING_AGENT_DIR"];
  return env;
}

export function parseStdoutJson(stdout: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(stdout);
  if (!isRecord(parsed)) {
    throw new TypeError("CLI stdout must be a JSON object");
  }
  return parsed;
}

export function createAgentFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "omo-ai-installer-test-"));
  const agentDir = join(root, "agent");
  mkdirSync(agentDir, { recursive: true });
  writeFixtureJson(join(agentDir, "settings.json"), {
    packages: [
      { source: "/tmp/senpi-other-package", hooks: ["hooks.json"] },
      packageRoot,
      { source: packageRoot, prompts: ["legacy.md"] },
    ],
    model: "keep-me",
  });
  writeFixtureJson(join(agentDir, "hooks-state.json"), {
    version: 1,
    hooks: {
      hk_unrelated: {
        enabled: true,
        trustedHash: "sha256:unrelated",
        scope: "global",
        sourcePath: "/tmp/other/hooks.json",
        commandPreview: "node other.js",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      hk_stale_omo: {
        enabled: true,
        trustedHash: "sha256:stale-omo",
        scope: "global",
        sourcePath: "/tmp/old/packages/omo-ai/senpi/hooks/omo-senpi-hooks.json",
        commandPreview: "node /tmp/old/packages/omo-ai/senpi/hooks/components/run-hook.mjs",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      hk_stale_omo_direct_component: {
        enabled: true,
        trustedHash: "sha256:stale-omo-direct-component",
        scope: "global",
        sourcePath: "/tmp/old/packages/omo-ai/senpi/hooks/omo-senpi-hooks.json",
        commandPreview: "node /old/packages/omo-ai/senpi/components/rules/dist/cli.js hook session-start",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    },
  });
  return agentDir;
}

export function createEmptyAgentFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "omo-ai-node-surface-"));
  const agentDir = join(root, "agent");
  mkdirSync(agentDir, { recursive: true });
  return agentDir;
}

export function cleanupAgentFixture(agentDir: string): void {
  rmSync(dirname(agentDir), { recursive: true, force: true });
}

export function agentFile(agentDir: string, fileName: string): string {
  return join(agentDir, fileName);
}

export function packageEntries(settings: Record<string, unknown>): readonly Record<string, unknown>[] {
  const packages = settings["packages"];
  if (!Array.isArray(packages)) {
    throw new TypeError("settings packages must be an array");
  }
  return packages.filter((entry): entry is Record<string, unknown> => {
    return isRecord(entry) && entry["source"] === packageRoot;
  });
}

function writeFixtureJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
