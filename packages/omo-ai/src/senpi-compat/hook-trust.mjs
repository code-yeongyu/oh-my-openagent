import { createHash } from "node:crypto";
import { readJsonObject, isRecord } from "./json-file.mjs";

const TRUST_STATE_VERSION = 1;
const DEFAULT_HOOK_TIMEOUT_SECONDS = 60;
const TRUSTED_HOOK_SCOPES = ["global", "plugin"];

export function emptyHookTrustState() {
  return { version: TRUST_STATE_VERSION, hooks: {} };
}

export function expectedOmoHookTrustRecords(paths, options = {}) {
  const updatedAt = options.updatedAt ?? new Date().toISOString();
  const platform = options.platform ?? process.platform;
  const payload = readJsonObject(paths.hooksManifestPath, { hooks: {} });
  const hooks = isRecord(payload.hooks) ? payload.hooks : {};
  const records = [];
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) {
      continue;
    }
    groups.forEach((group, groupIndex) => {
      if (!isRecord(group) || !Array.isArray(group.hooks)) {
        return;
      }
      const matcher = typeof group.matcher === "string" ? group.matcher : undefined;
      group.hooks.forEach((hook, handlerIndex) => {
        if (!isCommandHook(hook)) {
          return;
        }
        const platformCommand = selectedCommand(hook, platform);
        for (const scope of TRUSTED_HOOK_SCOPES) {
          const source = {
            scope,
            sourcePath: paths.hooksManifestPath,
            pluginRoot: "",
            manifestPath: "",
          };
          const sourceHash = sourceKeyHash(source);
          const id = `hk_${sourceHash}_${event}_${groupIndex}_${handlerIndex}`;
          const trustedHash = hashCommandHook({ event, hook, matcher, sourceHash, platformCommand });
          records.push({
            id,
            stableEntry: {
              enabled: true,
              trustedHash,
              scope,
              sourcePath: paths.hooksManifestPath,
              ...(matcher === undefined ? {} : { matcher }),
              commandPreview: platformCommand,
            },
            entry: {
              enabled: true,
              trustedHash,
              scope,
              sourcePath: paths.hooksManifestPath,
              ...(matcher === undefined ? {} : { matcher }),
              commandPreview: platformCommand,
              updatedAt,
            },
          });
        }
      });
    });
  }
  return records;
}

export function trustEntryMatchesExpected(entry, expected) {
  return (
    isRecord(entry) &&
    entry.enabled === expected.enabled &&
    entry.trustedHash === expected.trustedHash &&
    entry.scope === expected.scope &&
    entry.sourcePath === expected.sourcePath &&
    entry.matcher === expected.matcher &&
    entry.commandPreview === expected.commandPreview &&
    typeof entry.updatedAt === "string"
  );
}

export function countTrustedOmoEntries(hooks, records) {
  return records.filter((record) => trustEntryMatchesExpected(hooks[record.id], record.stableEntry)).length;
}

export function missingTrustEntryIds(hooks, records) {
  return records
    .filter((record) => !trustEntryMatchesExpected(hooks[record.id], record.stableEntry))
    .map((record) => record.id);
}

export function isOmoOwnedTrustEntry(id, entry, recordsById, hooksManifestPath) {
  return recordsById.has(id) || (isRecord(entry) && entry.sourcePath === hooksManifestPath);
}

function hashCommandHook(input) {
  return `sha256:${sha256Hex(JSON.stringify(canonicalJson({
    event: input.event,
    hook: {
      async: false,
      command: input.hook.command,
      commandWindows: input.hook.commandWindows,
      platformCommand: input.platformCommand,
      statusMessage: input.hook.statusMessage,
      timeout: input.hook.timeout ?? DEFAULT_HOOK_TIMEOUT_SECONDS,
      type: "command",
    },
    matcher: input.matcher,
    sourceKeyHash: input.sourceHash,
  })))}`;
}

function selectedCommand(hook, platform) {
  if (platform === "win32" && typeof hook.commandWindows === "string") {
    return hook.commandWindows;
  }
  return hook.command;
}

function sourceKeyHash(source) {
  return sha256Hex([source.scope, source.sourcePath, source.pluginRoot, source.manifestPath].join("\0")).slice(0, 12);
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalJson);
  }
  if (!isJsonRecord(value)) {
    return value;
  }
  const result = {};
  for (const key of Object.keys(value).sort()) {
    const child = value[key];
    if (child !== undefined) {
      result[key] = canonicalJson(child);
    }
  }
  return result;
}

function isJsonRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCommandHook(value) {
  return (
    isRecord(value) &&
    value.type === "command" &&
    typeof value.command === "string" &&
    (value.commandWindows === undefined || typeof value.commandWindows === "string") &&
    (value.timeout === undefined || typeof value.timeout === "number") &&
    (value.statusMessage === undefined || typeof value.statusMessage === "string")
  );
}
