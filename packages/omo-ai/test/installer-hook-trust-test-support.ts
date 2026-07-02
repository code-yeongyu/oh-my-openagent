import { createHash } from "node:crypto";
import { join } from "node:path";
import { isRecord, packageRoot, readJsonObject } from "./installer-test-support";

const hooksPath = join(packageRoot, "senpi/hooks/omo-senpi-hooks.json");
const trustedHookScopes = ["global", "plugin"] as const;

type JsonObject = { readonly [key: string]: JsonValue | undefined };
type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject;
type HookTrustScope = (typeof trustedHookScopes)[number];

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
    readonly scope: HookTrustScope;
    readonly sourcePath: string;
    readonly matcher?: string;
    readonly commandPreview: string;
    readonly updatedAt: string;
  };
};

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
  scope: HookTrustScope,
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
