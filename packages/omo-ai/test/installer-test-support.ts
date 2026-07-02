import { createHash } from "node:crypto";
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

const hooksPath = join(packageRoot, "senpi/hooks/omo-senpi-hooks.json");

type JsonObject = { readonly [key: string]: JsonValue | undefined };
type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject;

type CommandHook = {
  readonly type: "command";
  readonly command: string;
  readonly commandWindows?: string;
  readonly timeout?: number;
  readonly statusMessage?: string;
};

type ExpectedHookRecord = {
  readonly id: string;
  readonly entry: {
    readonly enabled: true;
    readonly trustedHash: string;
    readonly scope: "global" | "plugin";
    readonly sourcePath: string;
    readonly matcher?: string;
    readonly commandPreview: string;
    readonly updatedAt: string;
  };
};

const trustedHookScopes = ["global", "plugin"] as const;

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

export function expectedHookRecords(updatedAt: string): readonly ExpectedHookRecord[] {
  const payload = readJsonObject(hooksPath);
  const hooks = payload["hooks"];
  if (!isRecord(hooks)) {
    throw new TypeError("hook payload must contain hooks");
  }
  const records: ExpectedHookRecord[] = [];
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) {
      throw new TypeError(`${event} groups must be an array`);
    }
    groups.forEach((group, groupIndex) => {
      if (!isRecord(group) || !Array.isArray(group["hooks"])) {
        throw new TypeError(`${event} group must contain hooks`);
      }
      const matcher = typeof group["matcher"] === "string" ? group["matcher"] : undefined;
      group["hooks"].forEach((hook, handlerIndex) => {
        for (const scope of trustedHookScopes) {
          records.push(readExpectedHookRecord(scope, event, groupIndex, hook, handlerIndex, matcher));
        }
      });
    });
  }
  return records.map((record) => ({ ...record, entry: { ...record.entry, updatedAt } }));
}

function readExpectedHookRecord(
  scope: "global" | "plugin",
  event: string,
  groupIndex: number,
  hook: unknown,
  handlerIndex: number,
  matcher: string | undefined,
): ExpectedHookRecord {
  if (!isCommandHook(hook)) {
    throw new TypeError(`${event} hook must be a command hook`);
  }
  const sourceKeyHash = sha256Hex([scope, hooksPath, "", ""].join("\0")).slice(0, 12);
  const id = `hk_${sourceKeyHash}_${event}_${groupIndex}_${handlerIndex}`;
  const platformCommand = process.platform === "win32" && hook.commandWindows
    ? hook.commandWindows
    : hook.command;
  const trustedHash = `sha256:${sha256Hex(JSON.stringify(canonicalJson({
    event,
    hook: {
      async: false,
      command: hook.command,
      commandWindows: hook.commandWindows,
      platformCommand,
      statusMessage: hook.statusMessage,
      timeout: hook.timeout ?? 60,
      type: "command",
    },
    matcher,
    sourceKeyHash,
  })))}`;
  return {
    id,
    entry: {
      enabled: true,
      trustedHash,
      scope,
      sourcePath: hooksPath,
      ...(matcher === undefined ? {} : { matcher }),
      commandPreview: platformCommand,
      updatedAt: "",
    },
  };
}

function writeFixtureJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isCommandHook(value: unknown): value is CommandHook {
  return (
    isRecord(value) &&
    value["type"] === "command" &&
    typeof value["command"] === "string" &&
    (value["commandWindows"] === undefined || typeof value["commandWindows"] === "string") &&
    (value["timeout"] === undefined || typeof value["timeout"] === "number") &&
    (value["statusMessage"] === undefined || typeof value["statusMessage"] === "string")
  );
}

function canonicalJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(canonicalJson);
  }
  if (!isJsonObject(value)) {
    return value;
  }
  const result: { [key: string]: JsonValue } = {};
  for (const key of Object.keys(value).sort()) {
    const child = value[key];
    if (child !== undefined) {
      result[key] = canonicalJson(child);
    }
  }
  return result;
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
