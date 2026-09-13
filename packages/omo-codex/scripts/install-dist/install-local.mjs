#!/usr/bin/env node
// omo-codex-install:6df5dbbbb7ca9b9dce86fae98a525a9caa7de96caed85a4b77d4e8b4ab4d1501:b04c0968018f8483310fdd340863ab76921eb5111aef92bb250c9d2df33e018e
var __esm = (fn, res, err) => () => {
  if (fn)
    try {
      res = fn(fn = 0);
    } catch (e) {
      err = [e];
    }
  if (err)
    throw err[0];
  return res;
};

// packages/utils/src/xdg-data-dir.ts
import { accessSync, constants, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
function resolveXdgDataDir(appName, options = {}) {
  const osProvider = options.osProvider ?? os;
  const env = options.env ?? process.env;
  const preferredDir = env.XDG_DATA_HOME ?? path.join(osProvider.homedir(), ".local", "share");
  return resolveWritableDirectory(preferredDir, `${appName}-data`, osProvider);
}
function resolveWritableDirectory(preferredDir, fallbackSuffix, osProvider) {
  try {
    mkdirSync(preferredDir, { recursive: true });
    accessSync(preferredDir, constants.W_OK);
    return preferredDir;
  } catch (error) {
    if (!(error instanceof Error))
      throw error;
    const fallbackDir = path.join(osProvider.tmpdir(), fallbackSuffix);
    mkdirSync(fallbackDir, { recursive: true });
    return fallbackDir;
  }
}
var init_xdg_data_dir = () => {};

// packages/utils/src/atomic-write.ts
import {
  closeSync,
  fsyncSync,
  openSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname as dirname10 } from "node:path";
function isToleratedFsyncError(error) {
  if (!(error instanceof Error))
    return false;
  const code = error.code;
  return code !== undefined && TOLERATED_FSYNC_CODES.has(code);
}
function tolerantFsyncSync(fileDescriptor, fsyncImpl) {
  try {
    fsyncImpl(fileDescriptor);
  } catch (error) {
    if (!isToleratedFsyncError(error))
      throw error;
  }
}
function writeFileAtomically(filePath, content, options = {}) {
  const platform = options.platform ?? process.platform;
  const fsyncImpl = options.fsyncSync ?? fsyncSync;
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tempPath, content, "utf-8");
    const tempFileDescriptor = openSync(tempPath, "r+");
    try {
      tolerantFsyncSync(tempFileDescriptor, fsyncImpl);
    } finally {
      closeSync(tempFileDescriptor);
    }
    try {
      renameSync(tempPath, filePath);
    } catch (error) {
      const isPermissionError = error instanceof Error && (error.message.includes("EPERM") || error.message.includes("EACCES"));
      if (platform !== "win32" || !isPermissionError)
        throw error;
      unlinkSync(filePath);
      renameSync(tempPath, filePath);
    }
    if (platform === "win32")
      return;
    const directoryFileDescriptor = openSync(dirname10(filePath), "r");
    try {
      tolerantFsyncSync(directoryFileDescriptor, fsyncImpl);
    } finally {
      closeSync(directoryFileDescriptor);
    }
  } finally {
    rmSync(tempPath, { force: true });
  }
}
var TOLERATED_FSYNC_CODES;
var init_atomic_write = __esm(() => {
  TOLERATED_FSYNC_CODES = new Set([
    "EPERM",
    "EACCES",
    "ENOTSUP",
    "EINVAL"
  ]);
});

// packages/telemetry-core/src/activity-state.ts
import { existsSync as existsSync5, mkdirSync as mkdirSync2, readFileSync as readFileSync3 } from "node:fs";
import { basename as basename6, join as join33 } from "node:path";
function resolveTelemetryStateDir(product, options = {}) {
  const dataDir = resolveXdgDataDir(product.cacheDirName, {
    env: options.env,
    osProvider: options.osProvider
  });
  const xdgStateDir = options.env?.XDG_DATA_HOME === undefined ? undefined : join33(options.env.XDG_DATA_HOME, product.cacheDirName);
  if (dataDir === xdgStateDir || xdgStateDir === undefined && basename6(dataDir) === product.cacheDirName) {
    return dataDir;
  }
  return join33(dataDir, product.cacheDirName);
}
function getTelemetryActivityStateFilePath(stateDir) {
  return join33(stateDir, POSTHOG_ACTIVITY_STATE_FILE);
}
function getDailyActiveCaptureState(input) {
  const state = readPostHogActivityState(input.stateDir, input.diagnostics);
  const dayUTC = getUtcDayString(input.now ?? new Date);
  const captureDaily = state.lastActiveDayUTC !== dayUTC;
  if (captureDaily) {
    writePostHogActivityState(input.stateDir, {
      ...state,
      lastActiveDayUTC: dayUTC
    }, input.diagnostics);
  }
  return {
    dayUTC,
    captureDaily
  };
}
function getUtcDayString(date) {
  return date.toISOString().slice(0, 10);
}
function isPostHogActivityState(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function readPostHogActivityState(stateDir, diagnostics) {
  const stateFilePath = getTelemetryActivityStateFilePath(stateDir);
  if (!existsSync5(stateFilePath)) {
    return {};
  }
  try {
    const stateContent = readFileSync3(stateFilePath, "utf-8");
    const stateJson = JSON.parse(stateContent);
    if (!isPostHogActivityState(stateJson)) {
      return {};
    }
    return stateJson;
  } catch (error) {
    diagnostics?.({
      event: "telemetry_activity_state_read_failed",
      source: "shared",
      error,
      errorKind: error instanceof Error ? "error" : "non_error"
    });
    return {};
  }
}
function writePostHogActivityState(stateDir, nextState, diagnostics) {
  const stateFilePath = getTelemetryActivityStateFilePath(stateDir);
  try {
    mkdirSync2(stateDir, { recursive: true });
    writeFileAtomically(stateFilePath, `${JSON.stringify(nextState, null, 2)}
`);
  } catch (error) {
    diagnostics?.({
      event: "telemetry_activity_state_write_failed",
      source: "shared",
      error,
      errorKind: error instanceof Error ? "error" : "non_error"
    });
  }
}
var POSTHOG_ACTIVITY_STATE_FILE = "posthog-activity.json";
var init_activity_state = __esm(() => {
  init_atomic_write();
  init_xdg_data_dir();
});

// packages/telemetry-core/src/constants.ts
var DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com", DEFAULT_POSTHOG_API_KEY = "phc_CFJhj5HyvA62QPhvyaUCtaq23aUfznnijg5VaaGkNk74", UNCONFIGURED_POSTHOG_API_KEY = "phc_REPLACE_ME_OMO_NATIVE";

// packages/telemetry-core/src/diagnostics.ts
import { appendFileSync, existsSync as existsSync6, mkdirSync as mkdirSync3, readFileSync as readFileSync4 } from "node:fs";
import { join as join34 } from "node:path";
function getTelemetryDiagnosticsFilePath(diagnosticsDir) {
  return join34(diagnosticsDir, DIAGNOSTICS_FILE_NAME);
}
function writeTelemetryDiagnostic(input, options) {
  const now = options.now ?? new Date;
  try {
    cleanupTelemetryDiagnostics({ diagnosticsDir: options.diagnosticsDir, now });
    mkdirSync3(options.diagnosticsDir, { recursive: true });
    appendFileSync(getTelemetryDiagnosticsFilePath(options.diagnosticsDir), `${JSON.stringify(toDiagnosticRecord(input, now))}
`, "utf-8");
  } catch (error) {
    if (error instanceof Error) {
      return;
    }
    return;
  }
}
function cleanupTelemetryDiagnostics(options) {
  const diagnosticsFilePath = getTelemetryDiagnosticsFilePath(options.diagnosticsDir);
  if (!existsSync6(diagnosticsFilePath)) {
    return;
  }
  try {
    const cutoffMs = (options.now ?? new Date).getTime() - DIAGNOSTICS_RETENTION_MS;
    const retainedLines = trimToMaxBytes(readFileSync4(diagnosticsFilePath, "utf-8").split(`
`).filter((line) => shouldRetainLine(line, cutoffMs)));
    writeFileAtomically(diagnosticsFilePath, retainedLines.length === 0 ? "" : `${retainedLines.join(`
`)}
`);
  } catch (error) {
    if (error instanceof Error) {
      return;
    }
    return;
  }
}
function toDiagnosticRecord(input, now) {
  return {
    timestamp: now.toISOString(),
    event: input.event,
    source: input.source,
    ...serializeError(input.error, input.errorKind)
  };
}
function serializeError(error, errorKind) {
  if (error instanceof Error) {
    return {
      error_kind: errorKind ?? "error",
      error_name: error.name,
      error_message: error.message
    };
  }
  if (error === undefined) {
    return {};
  }
  return {
    error_kind: errorKind ?? "non_error",
    error_name: typeof error,
    error_message: String(error)
  };
}
function shouldRetainLine(line, cutoffMs) {
  if (line.length === 0) {
    return false;
  }
  const parsed = parseDiagnosticLine(line);
  const timestamp = parsed?.["timestamp"];
  if (typeof timestamp !== "string") {
    return false;
  }
  const timestampMs = Date.parse(timestamp);
  return Number.isFinite(timestampMs) && timestampMs >= cutoffMs;
}
function parseDiagnosticLine(line) {
  try {
    const parsed = JSON.parse(line);
    if (!isRecord8(parsed)) {
      return null;
    }
    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}
function isRecord8(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function trimToMaxBytes(lines) {
  const retained = [];
  let totalBytes = 0;
  for (let index = lines.length - 1;index >= 0; index -= 1) {
    const line = lines[index];
    if (line === undefined) {
      continue;
    }
    const lineBytes = Buffer.byteLength(`${line}
`, "utf-8");
    if (totalBytes + lineBytes > DIAGNOSTICS_MAX_BYTES) {
      break;
    }
    retained.unshift(line);
    totalBytes += lineBytes;
  }
  return retained;
}
var DIAGNOSTICS_FILE_NAME = "telemetry-diagnostics.jsonl", DIAGNOSTICS_RETENTION_MS, DIAGNOSTICS_MAX_BYTES;
var init_diagnostics = __esm(() => {
  init_atomic_write();
  DIAGNOSTICS_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
  DIAGNOSTICS_MAX_BYTES = 256 * 1024;
});

// packages/telemetry-core/src/env.ts
function normalizeEnvValue(value) {
  return value?.trim().toLowerCase();
}
function includesValue(values, value) {
  const normalized = normalizeEnvValue(value);
  return normalized !== undefined && values.includes(normalized);
}
function isDisableFlag(value) {
  return includesValue(TRUTHY_DISABLE_VALUES, value);
}
function isSendOptOutFlag(value) {
  return includesValue(SEND_OPT_OUT_VALUES, value);
}
function shouldDisableTelemetry(input) {
  const env = input.env ?? process.env;
  const globalPrefix = input.globalEnvPrefix ?? "OMO";
  const prefixes = Array.from(new Set([globalPrefix, input.productEnvPrefix]));
  if (isDisableFlag(env["DO_NOT_TRACK"])) {
    return true;
  }
  for (const prefix of prefixes) {
    if (isDisableFlag(env[`${prefix}_DISABLE_POSTHOG`])) {
      return true;
    }
    if (isSendOptOutFlag(env[`${prefix}_SEND_ANONYMOUS_TELEMETRY`])) {
      return true;
    }
  }
  return false;
}
function getTelemetryApiKey(env = process.env, defaultApiKey = DEFAULT_POSTHOG_API_KEY) {
  return env["POSTHOG_API_KEY"]?.trim() ?? defaultApiKey;
}
function isConfiguredTelemetryApiKey(apiKey) {
  const normalized = apiKey.trim();
  return normalized.length > 0 && normalized !== UNCONFIGURED_POSTHOG_API_KEY;
}
function hasTelemetryApiKey(env, defaultApiKey) {
  return isConfiguredTelemetryApiKey(getTelemetryApiKey(env, defaultApiKey));
}
function getTelemetryHost(env = process.env, defaultHost = DEFAULT_POSTHOG_HOST) {
  return env["POSTHOG_HOST"]?.trim() || defaultHost;
}
var TRUTHY_DISABLE_VALUES, SEND_OPT_OUT_VALUES;
var init_env = __esm(() => {
  TRUTHY_DISABLE_VALUES = ["1", "true", "yes"];
  SEND_OPT_OUT_VALUES = ["0", "false", "no", "yes"];
});

// node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/extensions/error-tracking/modifiers/module.node.mjs
import { dirname as dirname11, posix as posix3, sep as sep7 } from "node:path";
function createModulerModifier() {
  const getModuleFromFileName = createGetModuleFromFilename();
  return async (frames) => {
    for (const frame of frames)
      frame.module = getModuleFromFileName(frame.filename);
    return frames;
  };
}
function createGetModuleFromFilename(basePath = process.argv[1] ? dirname11(process.argv[1]) : process.cwd(), isWindows = sep7 === "\\") {
  const normalizedBase = isWindows ? normalizeWindowsPath(basePath) : basePath;
  return (filename) => {
    if (!filename)
      return;
    const normalizedFilename = isWindows ? normalizeWindowsPath(filename) : filename;
    let { dir, base: file, ext } = posix3.parse(normalizedFilename);
    if (ext === ".js" || ext === ".mjs" || ext === ".cjs")
      file = file.slice(0, -1 * ext.length);
    const decodedFile = decodeURIComponent(file);
    if (!dir)
      dir = ".";
    const n = dir.lastIndexOf("/node_modules");
    if (n > -1)
      return `${dir.slice(n + 14).replace(/\//g, ".")}:${decodedFile}`;
    if (dir.startsWith(normalizedBase)) {
      const moduleName = dir.slice(normalizedBase.length + 1).replace(/\//g, ".");
      return moduleName ? `${moduleName}:${decodedFile}` : decodedFile;
    }
    return decodedFile;
  };
}
function normalizeWindowsPath(path) {
  return path.replace(/^[A-Z]:/, "").replace(/\\/g, "/");
}
var init_module_node = () => {};

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/featureFlagUtils.mjs
function getFlagDetailFromFlagAndPayload(key, value, payload) {
  return {
    key,
    enabled: typeof value == "string" ? true : value,
    variant: typeof value == "string" ? value : undefined,
    reason: undefined,
    metadata: {
      id: undefined,
      version: undefined,
      payload: payload ? JSON.stringify(payload) : undefined,
      description: undefined
    }
  };
}
var normalizeFlagsResponse = (flagsResponse) => {
  if ("flags" in flagsResponse) {
    const featureFlags = getFlagValuesFromFlags(flagsResponse.flags);
    const featureFlagPayloads = getPayloadsFromFlags(flagsResponse.flags);
    return {
      ...flagsResponse,
      featureFlags,
      featureFlagPayloads
    };
  }
  {
    const featureFlags = flagsResponse.featureFlags ?? {};
    const featureFlagPayloads = Object.fromEntries(Object.entries(flagsResponse.featureFlagPayloads || {}).map(([k, v]) => [
      k,
      parsePayload(v)
    ]));
    const flags = Object.fromEntries(Object.entries(featureFlags).map(([key, value]) => [
      key,
      getFlagDetailFromFlagAndPayload(key, value, featureFlagPayloads[key])
    ]));
    return {
      ...flagsResponse,
      featureFlags,
      featureFlagPayloads,
      flags
    };
  }
}, getFlagValuesFromFlags = (flags) => Object.fromEntries(Object.entries(flags ?? {}).map(([key, detail]) => [
  key,
  getFeatureFlagValue(detail)
]).filter(([, value]) => value !== undefined)), getPayloadsFromFlags = (flags) => {
  const safeFlags = flags ?? {};
  return Object.fromEntries(Object.keys(safeFlags).filter((flag) => {
    const details = safeFlags[flag];
    return details.enabled && details.metadata && details.metadata.payload !== undefined;
  }).map((flag) => {
    const payload = safeFlags[flag].metadata?.payload;
    return [
      flag,
      payload ? parsePayload(payload) : undefined
    ];
  }));
}, getFeatureFlagValue = (detail) => detail === undefined ? undefined : detail.variant ?? detail.enabled, parsePayload = (response) => {
  if (typeof response != "string")
    return response;
  try {
    return JSON.parse(response);
  } catch {
    return response;
  }
}, MINIMAL_FLAG_CALLED_EVENT_CAMPAIGN_PROPERTIES, MINIMAL_FLAG_CALLED_EVENT_PROPERTIES, minimizeFlagCalledEventProperties = (properties, transportKeys = []) => {
  const minimal = {};
  const copyKey = (key) => {
    if (properties[key] !== undefined)
      minimal[key] = properties[key];
  };
  MINIMAL_FLAG_CALLED_EVENT_PROPERTIES.forEach(copyKey);
  transportKeys.forEach(copyKey);
  return minimal;
};
var init_featureFlagUtils = __esm(() => {
  MINIMAL_FLAG_CALLED_EVENT_CAMPAIGN_PROPERTIES = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
    "gad_source",
    "mc_cid",
    "gclid",
    "gclsrc",
    "dclid",
    "gbraid",
    "wbraid",
    "fbclid",
    "msclkid",
    "twclid",
    "li_fat_id",
    "igshid",
    "ttclid",
    "rdt_cid",
    "epik",
    "qclid",
    "sccid",
    "irclid",
    "_kx"
  ];
  MINIMAL_FLAG_CALLED_EVENT_PROPERTIES = [
    "$feature_flag",
    "$feature_flag_response",
    "$feature_flag_has_experiment",
    "$feature_flag_id",
    "$feature_flag_version",
    "$feature_flag_reason",
    "$feature_flag_request_id",
    "$feature_flag_evaluated_at",
    "$feature_flag_error",
    "locally_evaluated",
    "$groups",
    "$process_person_profile",
    "$geoip_disable",
    "$current_url",
    "$pathname",
    "$referring_domain",
    ...MINIMAL_FLAG_CALLED_EVENT_CAMPAIGN_PROPERTIES,
    "$session_id",
    "$window_id",
    "$lib",
    "$lib_version",
    "$device_id",
    "$is_server"
  ];
});

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/types.mjs
var types_PostHogPersistedProperty;
var init_types = __esm(() => {
  types_PostHogPersistedProperty = /* @__PURE__ */ function(PostHogPersistedProperty) {
    PostHogPersistedProperty["AnonymousId"] = "anonymous_id";
    PostHogPersistedProperty["DistinctId"] = "distinct_id";
    PostHogPersistedProperty["Props"] = "props";
    PostHogPersistedProperty["EnablePersonProcessing"] = "enable_person_processing";
    PostHogPersistedProperty["PersonMode"] = "person_mode";
    PostHogPersistedProperty["FeatureFlagDetails"] = "feature_flag_details";
    PostHogPersistedProperty["FeatureFlags"] = "feature_flags";
    PostHogPersistedProperty["FeatureFlagPayloads"] = "feature_flag_payloads";
    PostHogPersistedProperty["BootstrapFeatureFlagDetails"] = "bootstrap_feature_flag_details";
    PostHogPersistedProperty["BootstrapFeatureFlags"] = "bootstrap_feature_flags";
    PostHogPersistedProperty["BootstrapFeatureFlagPayloads"] = "bootstrap_feature_flag_payloads";
    PostHogPersistedProperty["OverrideFeatureFlags"] = "override_feature_flags";
    PostHogPersistedProperty["Queue"] = "queue";
    PostHogPersistedProperty["AiQueue"] = "ai_queue";
    PostHogPersistedProperty["AiCaptureQueue"] = "ai_capture_queue";
    PostHogPersistedProperty["LogsQueue"] = "logs_queue";
    PostHogPersistedProperty["OptedOut"] = "opted_out";
    PostHogPersistedProperty["SessionId"] = "session_id";
    PostHogPersistedProperty["SessionStartTimestamp"] = "session_start_timestamp";
    PostHogPersistedProperty["SessionLastTimestamp"] = "session_timestamp";
    PostHogPersistedProperty["PersonProperties"] = "person_properties";
    PostHogPersistedProperty["GroupProperties"] = "group_properties";
    PostHogPersistedProperty["InstalledAppBuild"] = "installed_app_build";
    PostHogPersistedProperty["InstalledAppVersion"] = "installed_app_version";
    PostHogPersistedProperty["SessionReplay"] = "session_replay";
    PostHogPersistedProperty["PushRegistered"] = "push_registered";
    PostHogPersistedProperty["SessionReplayEventTriggerActivatedSession"] = "session_replay_event_trigger_activated_session";
    PostHogPersistedProperty["SurveyLastSeenDate"] = "survey_last_seen_date";
    PostHogPersistedProperty["SurveysSeen"] = "surveys_seen";
    PostHogPersistedProperty["Surveys"] = "surveys";
    PostHogPersistedProperty["RemoteConfig"] = "remote_config";
    PostHogPersistedProperty["FlagsEndpointWasHit"] = "flags_endpoint_was_hit";
    PostHogPersistedProperty["DeviceId"] = "device_id";
    return PostHogPersistedProperty;
  }({});
});

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/gzip.mjs
function isGzipSupported() {
  return "CompressionStream" in globalThis && "TextEncoder" in globalThis && "Response" in globalThis && typeof Response.prototype.blob == "function";
}
async function gzipCompress(input, isDebug = true, options) {
  try {
    const inputBytes = new TextEncoder().encode(input);
    const compressedStream = new globalThis.CompressionStream("gzip");
    const writer = compressedStream.writable.getWriter();
    const writePromise = writer.write(inputBytes).then(() => writer.close()).catch(async (err) => {
      try {
        await writer.abort(err);
      } catch {}
      throw err;
    });
    const responsePromise = new Response(compressedStream.readable).blob();
    const [compressed] = await Promise.all([
      responsePromise,
      writePromise
    ]);
    await validateNativeGzip(compressed, inputBytes);
    return compressed;
  } catch (error) {
    if (options?.rethrow)
      throw error;
    if (isDebug)
      console.error("Failed to gzip compress data", error);
    return null;
  }
}
var NATIVE_GZIP_VALIDATION_ERROR = "NativeGzipValidationError", GZIP_MAGIC_FIRST_BYTE = 31, GZIP_MAGIC_SECOND_BYTE = 139, GZIP_DEFLATE_METHOD = 8, hasGzipMagic = (bytes) => bytes.length >= 2 && bytes[0] === GZIP_MAGIC_FIRST_BYTE && bytes[1] === GZIP_MAGIC_SECOND_BYTE, crc32Table, getCrc32Table = () => {
  if (crc32Table)
    return crc32Table;
  crc32Table = [];
  for (let i = 0;i < 256; i++) {
    let crc = i;
    for (let j = 0;j < 8; j++)
      crc = 1 & crc ? 3988292384 ^ crc >>> 1 : crc >>> 1;
    crc32Table[i] = crc >>> 0;
  }
  return crc32Table;
}, crc32 = (bytes) => {
  const table = getCrc32Table();
  let crc = 4294967295;
  for (let i = 0;i < bytes.length; i++)
    crc = table[(crc ^ bytes[i]) & 255] ^ crc >>> 8;
  return (4294967295 ^ crc) >>> 0;
}, throwNativeGzipValidationError = (reason) => {
  const error = new Error(`Native gzip produced invalid output: ${reason}`);
  error.name = NATIVE_GZIP_VALIDATION_ERROR;
  throw error;
}, validateNativeGzip = async (compressed, inputBytes) => {
  if (compressed.size < 18)
    throwNativeGzipValidationError("too-short");
  const header = new Uint8Array(await compressed.slice(0, 10).arrayBuffer());
  if (!hasGzipMagic(header) || header[2] !== GZIP_DEFLATE_METHOD)
    throwNativeGzipValidationError("invalid-header");
  const trailer = new DataView(await compressed.slice(compressed.size - 8).arrayBuffer());
  if (trailer.getUint32(0, true) !== crc32(inputBytes))
    throwNativeGzipValidationError("invalid-crc");
  const inputSize = inputBytes.length >>> 0;
  if (trailer.getUint32(4, true) !== inputSize)
    throwNativeGzipValidationError("invalid-size");
};
var init_gzip = __esm(() => {
  init_types();
});

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/utils/json-utils.mjs
function sanitizeString(value) {
  let output = "";
  for (let index = 0;index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 55296 && codeUnit <= 56319) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (nextCodeUnit >= 56320 && nextCodeUnit <= 57343) {
        output += value[index] + value[index + 1];
        index++;
      } else
        output += "�";
    } else
      output += codeUnit >= 56320 && codeUnit <= 57343 ? "�" : value[index];
  }
  return output;
}
var MAX_JSON_SAFE_VALUE_DEPTH = 20, MAX_JSON_SAFE_VALUE_ITEMS = 1000, MAX_JSON_SAFE_VALUE_NODES = 1e4, CIRCULAR_VALUE = "[Circular]", TRUNCATED_VALUE = "[Truncated]", UNSERIALIZABLE_VALUE = "[Unserializable]", FUNCTION_VALUE = "[Function]", dateGetTime, dateToISOString;
var init_json_utils = __esm(() => {
  dateGetTime = Date.prototype.getTime;
  dateToISOString = Date.prototype.toISOString;
});

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/utils/bot-detection.mjs
var DEFAULT_BLOCKED_UA_STRS, isBlockedUA = function(ua, customBlockedUserAgents = []) {
  if (!ua)
    return false;
  const uaLower = ua.toLowerCase();
  return DEFAULT_BLOCKED_UA_STRS.concat(customBlockedUserAgents).some((blockedUA) => {
    const blockedUaLower = blockedUA.toLowerCase();
    return uaLower.indexOf(blockedUaLower) !== -1;
  });
};
var init_bot_detection = __esm(() => {
  DEFAULT_BLOCKED_UA_STRS = [
    "amazonbot",
    "amazonproductbot",
    "app.hypefactors.com",
    "applebot",
    "archive.org_bot",
    "awariobot",
    "backlinksextendedbot",
    "baiduspider",
    "bingbot",
    "bingpreview",
    "chrome-lighthouse",
    "dataforseobot",
    "deepscan",
    "duckduckbot",
    "facebookexternal",
    "facebookcatalog",
    "http://yandex.com/bots",
    "hubspot",
    "ia_archiver",
    "leikibot",
    "linkedinbot",
    "meta-externalagent",
    "mj12bot",
    "msnbot",
    "nessus",
    "petalbot",
    "pinterest",
    "prerender",
    "rogerbot",
    "screaming frog",
    "sebot-wa",
    "sitebulb",
    "slackbot",
    "slurp",
    "trendictionbot",
    "turnitin",
    "twitterbot",
    "vercel-screenshot",
    "vercelbot",
    "yahoo! slurp",
    "yandexbot",
    "zoombot",
    "bot.htm",
    "bot.php",
    "(bot;",
    "bot/",
    "crawler",
    "ahrefsbot",
    "ahrefssiteaudit",
    "semrushbot",
    "siteauditbot",
    "splitsignalbot",
    "gptbot",
    "oai-searchbot",
    "chatgpt-user",
    "perplexitybot",
    "better uptime bot",
    "sentryuptimebot",
    "uptimerobot",
    "headlesschrome",
    "cypress",
    "google-hoteladsverifier",
    "adsbot-google",
    "apis-google",
    "duplexweb-google",
    "feedfetcher-google",
    "google favicon",
    "google web preview",
    "google-read-aloud",
    "googlebot",
    "googleother",
    "google-cloudvertexbot",
    "googleweblight",
    "mediapartners-google",
    "storebot-google",
    "google-inspectiontool",
    "bytespider"
  ];
});

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/utils/string-utils.mjs
function safeJsonStringify(value) {
  const ancestors = [];
  return JSON.stringify(value, function(_key, replacementValue) {
    if (typeof replacementValue == "bigint")
      return replacementValue.toString();
    if (typeof replacementValue == "function" || typeof replacementValue == "symbol")
      return;
    if (replacementValue instanceof Error)
      return {
        name: replacementValue.name,
        message: replacementValue.message,
        stack: replacementValue.stack
      };
    if (replacementValue && typeof replacementValue == "object") {
      while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this)
        ancestors.pop();
      if (ancestors.includes(replacementValue))
        return "[Circular]";
      ancestors.push(replacementValue);
    }
    return replacementValue;
  }) ?? "null";
}
var init_string_utils = () => {};

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/utils/browser-utils.mjs
var init_browser_utils = __esm(() => {
  init_string_utils();
});

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/utils/type-utils.mjs
function isPrimitive(value) {
  return value === null || typeof value != "object";
}
function isBuiltin(candidate, className) {
  return Object.prototype.toString.call(candidate) === `[object ${className}]`;
}
function isError(candidate) {
  switch (Object.prototype.toString.call(candidate)) {
    case "[object Error]":
    case "[object Exception]":
    case "[object DOMException]":
    case "[object DOMError]":
    case "[object WebAssembly.Exception]":
      return true;
    default:
      return isInstanceOf(candidate, Error);
  }
}
function isEvent(candidate) {
  return typeof Event != "undefined" && isInstanceOf(candidate, Event);
}
function isPlainObject3(candidate) {
  return isBuiltin(candidate, "Object");
}
function isInstanceOf(candidate, base) {
  try {
    return candidate instanceof base;
  } catch {
    return false;
  }
}
var nativeIsArray, ObjProto, type_utils_hasOwnProperty, type_utils_toString, isArray, isObject2 = (x) => x === Object(x) && !isArray(x), isUndefined = (x) => x === undefined, isString = (x) => type_utils_toString.call(x) == "[object String]", isEmptyString = (x) => isString(x) && x.trim().length === 0, isNull = (x) => x === null, isNullish = (x) => isUndefined(x) || isNull(x), isNumber = (x) => type_utils_toString.call(x) == "[object Number]" && x === x, isBoolean = (x) => type_utils_toString.call(x) === "[object Boolean]";
var init_type_utils = __esm(() => {
  init_types();
  init_string_utils();
  nativeIsArray = Array.isArray;
  ObjProto = Object.prototype;
  type_utils_hasOwnProperty = ObjProto.hasOwnProperty;
  type_utils_toString = ObjProto.toString;
  isArray = nativeIsArray || function(obj) {
    return type_utils_toString.call(obj) === "[object Array]";
  };
});

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/utils/number-utils.mjs
function clampToRange(value, min, max, logger, fallbackValue) {
  if (min > max) {
    logger.warn("min cannot be greater than max.");
    min = max;
  }
  if (isNumber(value))
    if (value > max) {
      logger.warn(" cannot be  greater than max: " + max + ". Using max value instead.");
      return max;
    } else {
      if (!(value < min))
        return value;
      logger.warn(" cannot be less than min: " + min + ". Using min value instead.");
      return min;
    }
  logger.warn(" must be a number. using max or fallback. max: " + max + ", fallback: " + fallbackValue);
  return clampToRange(fallbackValue || max, min, max, logger);
}
var init_number_utils = __esm(() => {
  init_type_utils();
});

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/utils/bucketed-rate-limiter.mjs
function resolveExceptionRateLimiterConfig(config = {}) {
  return {
    refillRate: config.exceptionRateLimiterRefillRate ?? config.__exceptionRateLimiterRefillRate ?? DEFAULT_EXCEPTION_RATE_LIMITER_REFILL_RATE,
    bucketSize: config.exceptionRateLimiterBucketSize ?? config.__exceptionRateLimiterBucketSize ?? DEFAULT_EXCEPTION_RATE_LIMITER_BUCKET_SIZE
  };
}

class BucketedRateLimiter {
  constructor(options) {
    this._buckets = {};
    this._onBucketRateLimited = options._onBucketRateLimited;
    this._bucketSize = clampToRange(options.bucketSize, 0, 100, options._logger);
    this._refillRate = clampToRange(options.refillRate, 0, this._bucketSize, options._logger);
    this._refillInterval = clampToRange(options.refillInterval, 0, ONE_DAY_IN_MS, options._logger);
  }
  _applyRefill(bucket, now) {
    const elapsedMs = now - bucket.lastAccess;
    const refillIntervals = Math.floor(elapsedMs / this._refillInterval);
    if (refillIntervals > 0) {
      const tokensToAdd = refillIntervals * this._refillRate;
      bucket.tokens = Math.min(bucket.tokens + tokensToAdd, this._bucketSize);
      bucket.lastAccess = bucket.lastAccess + refillIntervals * this._refillInterval;
    }
  }
  consumeRateLimit(key) {
    const now = Date.now();
    const keyStr = String(key);
    let bucket = this._buckets[keyStr];
    if (bucket)
      this._applyRefill(bucket, now);
    else {
      bucket = {
        tokens: this._bucketSize,
        lastAccess: now
      };
      this._buckets[keyStr] = bucket;
    }
    if (bucket.tokens === 0)
      return true;
    bucket.tokens--;
    if (bucket.tokens === 0)
      this._onBucketRateLimited?.(key);
    return bucket.tokens === 0;
  }
  stop() {
    this._buckets = {};
  }
}
var ONE_DAY_IN_MS = 86400000, DEFAULT_EXCEPTION_RATE_LIMITER_REFILL_RATE = 1, DEFAULT_EXCEPTION_RATE_LIMITER_BUCKET_SIZE = 10;
var init_bucketed_rate_limiter = __esm(() => {
  init_number_utils();
});

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/vendor/uuidv7.mjs
class UUID {
  constructor(bytes) {
    this.bytes = bytes;
  }
  static ofInner(bytes) {
    if (bytes.length === 16)
      return new UUID(bytes);
    throw new TypeError("not 128-bit length");
  }
  static fromFieldsV7(unixTsMs, randA, randBHi, randBLo) {
    if (!Number.isInteger(unixTsMs) || !Number.isInteger(randA) || !Number.isInteger(randBHi) || !Number.isInteger(randBLo) || unixTsMs < 0 || randA < 0 || randBHi < 0 || randBLo < 0 || unixTsMs > 281474976710655 || randA > 4095 || randBHi > 1073741823 || randBLo > 4294967295)
      throw new RangeError("invalid field value");
    const bytes = new Uint8Array(16);
    bytes[0] = unixTsMs / 2 ** 40;
    bytes[1] = unixTsMs / 2 ** 32;
    bytes[2] = unixTsMs / 2 ** 24;
    bytes[3] = unixTsMs / 2 ** 16;
    bytes[4] = unixTsMs / 256;
    bytes[5] = unixTsMs;
    bytes[6] = 112 | randA >>> 8;
    bytes[7] = randA;
    bytes[8] = 128 | randBHi >>> 24;
    bytes[9] = randBHi >>> 16;
    bytes[10] = randBHi >>> 8;
    bytes[11] = randBHi;
    bytes[12] = randBLo >>> 24;
    bytes[13] = randBLo >>> 16;
    bytes[14] = randBLo >>> 8;
    bytes[15] = randBLo;
    return new UUID(bytes);
  }
  static parse(uuid) {
    let hex;
    switch (uuid.length) {
      case 32:
        hex = /^[0-9a-f]{32}$/i.exec(uuid)?.[0];
        break;
      case 36:
        hex = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/i.exec(uuid)?.slice(1, 6).join("");
        break;
      case 38:
        hex = /^\{([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\}$/i.exec(uuid)?.slice(1, 6).join("");
        break;
      case 45:
        hex = /^urn:uuid:([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/i.exec(uuid)?.slice(1, 6).join("");
        break;
      default:
        break;
    }
    if (hex) {
      const inner = new Uint8Array(16);
      for (let i = 0;i < 16; i += 4) {
        const n = parseInt(hex.substring(2 * i, 2 * i + 8), 16);
        inner[i + 0] = n >>> 24;
        inner[i + 1] = n >>> 16;
        inner[i + 2] = n >>> 8;
        inner[i + 3] = n;
      }
      return new UUID(inner);
    }
    throw new SyntaxError("could not parse UUID string");
  }
  toString() {
    let text = "";
    for (let i = 0;i < this.bytes.length; i++) {
      text += DIGITS.charAt(this.bytes[i] >>> 4);
      text += DIGITS.charAt(15 & this.bytes[i]);
      if (i === 3 || i === 5 || i === 7 || i === 9)
        text += "-";
    }
    return text;
  }
  toHex() {
    let text = "";
    for (let i = 0;i < this.bytes.length; i++) {
      text += DIGITS.charAt(this.bytes[i] >>> 4);
      text += DIGITS.charAt(15 & this.bytes[i]);
    }
    return text;
  }
  toJSON() {
    return this.toString();
  }
  getVariant() {
    const n = this.bytes[8] >>> 4;
    if (n < 0)
      throw new Error("unreachable");
    if (n <= 7)
      return this.bytes.every((e) => e === 0) ? "NIL" : "VAR_0";
    if (n <= 11)
      return "VAR_10";
    if (n <= 13)
      return "VAR_110";
    if (n <= 15)
      return this.bytes.every((e) => e === 255) ? "MAX" : "VAR_RESERVED";
    else
      throw new Error("unreachable");
  }
  getVersion() {
    return this.getVariant() === "VAR_10" ? this.bytes[6] >>> 4 : undefined;
  }
  clone() {
    return new UUID(this.bytes.slice(0));
  }
  equals(other) {
    return this.compareTo(other) === 0;
  }
  compareTo(other) {
    for (let i = 0;i < 16; i++) {
      const diff = this.bytes[i] - other.bytes[i];
      if (diff !== 0)
        return Math.sign(diff);
    }
    return 0;
  }
}

class V7Generator {
  constructor(randomNumberGenerator) {
    this.timestamp = 0;
    this.counter = 0;
    this.random = randomNumberGenerator ?? getDefaultRandom();
  }
  generate() {
    return this.generateOrResetCore(Date.now(), 1e4);
  }
  generateOrAbort() {
    return this.generateOrAbortCore(Date.now(), 1e4);
  }
  generateOrResetCore(unixTsMs, rollbackAllowance) {
    let value = this.generateOrAbortCore(unixTsMs, rollbackAllowance);
    if (value === undefined) {
      this.timestamp = 0;
      value = this.generateOrAbortCore(unixTsMs, rollbackAllowance);
    }
    return value;
  }
  generateOrAbortCore(unixTsMs, rollbackAllowance) {
    const MAX_COUNTER = 4398046511103;
    if (!Number.isInteger(unixTsMs) || unixTsMs < 1 || unixTsMs > 281474976710655)
      throw new RangeError("`unixTsMs` must be a 48-bit positive integer");
    if (rollbackAllowance < 0 || rollbackAllowance > 281474976710655)
      throw new RangeError("`rollbackAllowance` out of reasonable range");
    if (unixTsMs > this.timestamp) {
      this.timestamp = unixTsMs;
      this.resetCounter();
    } else {
      if (!(unixTsMs + rollbackAllowance >= this.timestamp))
        return;
      this.counter++;
      if (this.counter > MAX_COUNTER) {
        this.timestamp++;
        this.resetCounter();
      }
    }
    return UUID.fromFieldsV7(this.timestamp, Math.trunc(this.counter / 2 ** 30), this.counter & 2 ** 30 - 1, this.random.nextUint32());
  }
  resetCounter() {
    this.counter = 1024 * this.random.nextUint32() + (1023 & this.random.nextUint32());
  }
  generateV4() {
    const bytes = new Uint8Array(Uint32Array.of(this.random.nextUint32(), this.random.nextUint32(), this.random.nextUint32(), this.random.nextUint32()).buffer);
    bytes[6] = 64 | bytes[6] >>> 4;
    bytes[8] = 128 | bytes[8] >>> 2;
    return UUID.ofInner(bytes);
  }
}
var DIGITS = "0123456789abcdef", getDefaultRandom = () => ({
  nextUint32: () => 65536 * Math.trunc(65536 * Math.random()) + Math.trunc(65536 * Math.random())
}), defaultGenerator, uuidv7 = () => uuidv7obj().toString(), uuidv7obj = () => (defaultGenerator || (defaultGenerator = new V7Generator)).generate();
var init_uuidv7 = __esm(() => {
  /*! For license information please see uuidv7.mjs.LICENSE.txt */
});

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/utils/promise-queue.mjs
class PromiseQueue {
  add(promise) {
    const promiseUUID = uuidv7();
    const id = ++this.nextId;
    this.promiseByIds[promiseUUID] = {
      id,
      promise
    };
    promise.catch(() => {}).finally(() => {
      delete this.promiseByIds[promiseUUID];
    });
    return promise;
  }
  async join() {
    let promises = Object.values(this.promiseByIds).map((item) => item.promise);
    let length = promises.length;
    while (length > 0) {
      await Promise.all(promises);
      promises = Object.values(this.promiseByIds).map((item) => item.promise);
      length = promises.length;
    }
  }
  getPromises(ignoredPromises = [], maxId = this.nextId) {
    const ignoredPromiseSet = new Set(ignoredPromises);
    return Object.values(this.promiseByIds).filter((item) => item.id <= maxId && !ignoredPromiseSet.has(item.promise)).map((item) => item.promise);
  }
  get maxId() {
    return this.nextId;
  }
  get length() {
    return Object.keys(this.promiseByIds).length;
  }
  constructor() {
    this.promiseByIds = {};
    this.nextId = 0;
  }
}
var init_promise_queue = __esm(() => {
  init_uuidv7();
});

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/utils/logger.mjs
function createConsole(consoleLike = console) {
  const lockedMethods = {
    log: consoleLike.log.bind(consoleLike),
    warn: consoleLike.warn.bind(consoleLike),
    error: consoleLike.error.bind(consoleLike),
    debug: consoleLike.debug.bind(consoleLike)
  };
  return lockedMethods;
}
function createLogger(prefix, maybeCall = passThrough) {
  return _createLogger(prefix, maybeCall, createConsole());
}
var _createLogger = (prefix, maybeCall, consoleLike) => {
  function _log(level, ...args) {
    maybeCall(() => {
      const consoleMethod = consoleLike[level];
      consoleMethod(prefix, ...args);
    });
  }
  const logger = {
    debug: (...args) => {
      _log("debug", ...args);
    },
    info: (...args) => {
      _log("log", ...args);
    },
    warn: (...args) => {
      _log("warn", ...args);
    },
    error: (...args) => {
      _log("error", ...args);
    },
    critical: (...args) => {
      consoleLike["error"](prefix, ...args);
    },
    createLogger: (additionalPrefix) => _createLogger(`${prefix} ${additionalPrefix}`, maybeCall, consoleLike)
  };
  return logger;
}, passThrough = (fn) => fn();
var init_logger = () => {};

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/utils/user-agent-utils.mjs
var MOBILE = "Mobile", IOS = "iOS", ANDROID = "Android", TABLET = "Tablet", ANDROID_TABLET, APPLE = "Apple", APPLE_WATCH, SAFARI = "Safari", BLACKBERRY = "BlackBerry", SAMSUNG = "Samsung", SAMSUNG_BROWSER, SAMSUNG_INTERNET, CHROME = "Chrome", CHROME_OS, CHROME_IOS, INTERNET_EXPLORER = "Internet Explorer", INTERNET_EXPLORER_MOBILE, OPERA = "Opera", OPERA_MINI, EDGE = "Edge", MICROSOFT_EDGE, FIREFOX = "Firefox", FIREFOX_IOS, NINTENDO = "Nintendo", PLAYSTATION = "PlayStation", XBOX = "Xbox", ANDROID_MOBILE, MOBILE_SAFARI, WINDOWS = "Windows", WINDOWS_PHONE, GENERIC = "Generic", GENERIC_MOBILE, GENERIC_TABLET, KONQUEROR = "Konqueror", OCULUS_BROWSER = "Oculus Browser", VIVALDI = "Vivaldi", YANDEX = "Yandex", WHALE = "Whale", DUCKDUCKGO = "DuckDuckGo", PALE_MOON = "Pale Moon", WATERFOX = "Waterfox", BRAVE = "Brave", GOOGLE_SEARCH_APP = "Google Search App", BROWSER_VERSION_REGEX_SUFFIX = "(\\d+(\\.\\d+)?)", DEFAULT_BROWSER_VERSION_REGEX, XBOX_REGEX, PLAYSTATION_REGEX, NINTENDO_REGEX, BLACKBERRY_REGEX, windowsVersionMap, versionRegexes, osMatchers;
var init_user_agent_utils = __esm(() => {
  init_string_utils();
  init_type_utils();
  ANDROID_TABLET = ANDROID + " " + TABLET;
  APPLE_WATCH = APPLE + " Watch";
  SAMSUNG_BROWSER = SAMSUNG + "Browser";
  SAMSUNG_INTERNET = SAMSUNG + " Internet";
  CHROME_OS = CHROME + " OS";
  CHROME_IOS = CHROME + " " + IOS;
  INTERNET_EXPLORER_MOBILE = INTERNET_EXPLORER + " " + MOBILE;
  OPERA_MINI = OPERA + " Mini";
  MICROSOFT_EDGE = "Microsoft " + EDGE;
  FIREFOX_IOS = FIREFOX + " " + IOS;
  ANDROID_MOBILE = ANDROID + " " + MOBILE;
  MOBILE_SAFARI = MOBILE + " " + SAFARI;
  WINDOWS_PHONE = WINDOWS + " Phone";
  GENERIC_MOBILE = GENERIC + " " + MOBILE.toLowerCase();
  GENERIC_TABLET = GENERIC + " " + TABLET.toLowerCase();
  DEFAULT_BROWSER_VERSION_REGEX = new RegExp("Version/" + BROWSER_VERSION_REGEX_SUFFIX);
  XBOX_REGEX = new RegExp(XBOX, "i");
  PLAYSTATION_REGEX = new RegExp(PLAYSTATION + " \\w+", "i");
  NINTENDO_REGEX = new RegExp(NINTENDO + " \\w+", "i");
  BLACKBERRY_REGEX = new RegExp(BLACKBERRY + "|PlayBook|BB10", "i");
  windowsVersionMap = {
    "NT3.51": "NT 3.11",
    "NT4.0": "NT 4.0",
    "5.0": "2000",
    "5.1": "XP",
    "5.2": "XP",
    "6.0": "Vista",
    "6.1": "7",
    "6.2": "8",
    "6.3": "8.1",
    "6.4": "10",
    "10.0": "10"
  };
  versionRegexes = {
    [INTERNET_EXPLORER_MOBILE]: [
      new RegExp("rv:" + BROWSER_VERSION_REGEX_SUFFIX)
    ],
    [MICROSOFT_EDGE]: [
      new RegExp(EDGE + "?\\/" + BROWSER_VERSION_REGEX_SUFFIX)
    ],
    [CHROME]: [
      new RegExp("(" + CHROME + "|CrMo)\\/" + BROWSER_VERSION_REGEX_SUFFIX)
    ],
    [CHROME_IOS]: [
      new RegExp("CriOS\\/" + BROWSER_VERSION_REGEX_SUFFIX)
    ],
    "UC Browser": [
      new RegExp("(UCBrowser|UCWEB)\\/" + BROWSER_VERSION_REGEX_SUFFIX)
    ],
    [SAFARI]: [
      DEFAULT_BROWSER_VERSION_REGEX
    ],
    [MOBILE_SAFARI]: [
      DEFAULT_BROWSER_VERSION_REGEX
    ],
    [OPERA]: [
      new RegExp("(" + OPERA + "|OPR)\\/" + BROWSER_VERSION_REGEX_SUFFIX)
    ],
    [FIREFOX]: [
      new RegExp(FIREFOX + "\\/" + BROWSER_VERSION_REGEX_SUFFIX)
    ],
    [FIREFOX_IOS]: [
      new RegExp("FxiOS\\/" + BROWSER_VERSION_REGEX_SUFFIX)
    ],
    [KONQUEROR]: [
      new RegExp("Konqueror[:/]?" + BROWSER_VERSION_REGEX_SUFFIX, "i")
    ],
    [BLACKBERRY]: [
      new RegExp(BLACKBERRY + " " + BROWSER_VERSION_REGEX_SUFFIX),
      DEFAULT_BROWSER_VERSION_REGEX
    ],
    [ANDROID_MOBILE]: [
      new RegExp("android\\s" + BROWSER_VERSION_REGEX_SUFFIX, "i")
    ],
    [SAMSUNG_INTERNET]: [
      new RegExp(SAMSUNG_BROWSER + "\\/" + BROWSER_VERSION_REGEX_SUFFIX)
    ],
    [OCULUS_BROWSER]: [
      new RegExp("OculusBrowser\\/" + BROWSER_VERSION_REGEX_SUFFIX)
    ],
    [VIVALDI]: [
      new RegExp(VIVALDI + "\\/" + BROWSER_VERSION_REGEX_SUFFIX)
    ],
    [YANDEX]: [
      new RegExp("YaBrowser\\/" + BROWSER_VERSION_REGEX_SUFFIX)
    ],
    [WHALE]: [
      new RegExp(WHALE + "\\/" + BROWSER_VERSION_REGEX_SUFFIX)
    ],
    [BRAVE]: [
      new RegExp(BRAVE + "\\/" + BROWSER_VERSION_REGEX_SUFFIX)
    ],
    [DUCKDUCKGO]: [
      new RegExp("(DuckDuckGo|Ddg)\\/" + BROWSER_VERSION_REGEX_SUFFIX)
    ],
    [PALE_MOON]: [
      new RegExp("PaleMoon\\/" + BROWSER_VERSION_REGEX_SUFFIX)
    ],
    [WATERFOX]: [
      new RegExp(WATERFOX + "\\/" + BROWSER_VERSION_REGEX_SUFFIX)
    ],
    [GOOGLE_SEARCH_APP]: [
      new RegExp("GSA\\/" + BROWSER_VERSION_REGEX_SUFFIX)
    ],
    [INTERNET_EXPLORER]: [
      new RegExp("(rv:|MSIE )" + BROWSER_VERSION_REGEX_SUFFIX)
    ],
    Mozilla: [
      new RegExp("rv:" + BROWSER_VERSION_REGEX_SUFFIX)
    ]
  };
  osMatchers = [
    [
      new RegExp(XBOX + "; " + XBOX + " (.*?)[);]", "i"),
      (match) => [
        XBOX,
        match && match[1] || ""
      ]
    ],
    [
      new RegExp(NINTENDO, "i"),
      [
        NINTENDO,
        ""
      ]
    ],
    [
      new RegExp(PLAYSTATION, "i"),
      [
        PLAYSTATION,
        ""
      ]
    ],
    [
      BLACKBERRY_REGEX,
      [
        BLACKBERRY,
        ""
      ]
    ],
    [
      new RegExp(WINDOWS, "i"),
      (_, user_agent) => {
        if (/Phone/.test(user_agent) || /WPDesktop/.test(user_agent))
          return [
            WINDOWS_PHONE,
            ""
          ];
        if (new RegExp(MOBILE).test(user_agent) && !/IEMobile\b/.test(user_agent))
          return [
            WINDOWS + " " + MOBILE,
            ""
          ];
        const match = /Windows NT ([0-9.]+)/i.exec(user_agent);
        if (match && match[1]) {
          const version = match[1];
          let osVersion = windowsVersionMap[version] || "";
          if (/arm/i.test(user_agent))
            osVersion = "RT";
          return [
            WINDOWS,
            osVersion
          ];
        }
        return [
          WINDOWS,
          ""
        ];
      }
    ],
    [
      /((iPhone|iPad|iPod).*?OS (\d+)_(\d+)_?(\d+)?|iPhone)/,
      (match) => {
        if (match && match[3]) {
          const versionParts = [
            match[3],
            match[4],
            match[5] || "0"
          ];
          return [
            IOS,
            versionParts.join(".")
          ];
        }
        return [
          IOS,
          ""
        ];
      }
    ],
    [
      /(watch.*\/(\d+\.\d+\.\d+)|watch os,(\d+\.\d+),)/i,
      (match) => {
        let version = "";
        if (match && match.length >= 3)
          version = isUndefined(match[2]) ? match[3] : match[2];
        return [
          "watchOS",
          version
        ];
      }
    ],
    [
      new RegExp("(" + ANDROID + " (\\d+)\\.(\\d+)\\.?(\\d+)?|" + ANDROID + ")", "i"),
      (match) => {
        if (match && match[2]) {
          const versionParts = [
            match[2],
            match[3],
            match[4] || "0"
          ];
          return [
            ANDROID,
            versionParts.join(".")
          ];
        }
        return [
          ANDROID,
          ""
        ];
      }
    ],
    [
      /Mac OS X (\d+)[_.](\d+)[_.]?(\d+)?/i,
      (match) => {
        const result = [
          "Mac OS X",
          ""
        ];
        if (match && match[1]) {
          const versionParts = [
            match[1],
            match[2],
            match[3] || "0"
          ];
          result[1] = versionParts.join(".");
        }
        return result;
      }
    ],
    [
      /Mac/i,
      [
        "Mac OS X",
        ""
      ]
    ],
    [
      /CrOS/,
      [
        CHROME_OS,
        ""
      ]
    ],
    [
      /Linux|debian/i,
      [
        "Linux",
        ""
      ]
    ]
  ];
});

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/utils/index.mjs
function isValidUUID(value) {
  return typeof value == "string" && UUID_REGEX.test(value);
}
function getEventUuid(uuid, generateUuid) {
  return isValidUUID(uuid) ? uuid : generateUuid();
}
function removeTrailingSlash(url) {
  return url?.replace(/\/+$/, "");
}
async function retriable(fn, props) {
  let lastError = null;
  for (let i = 0;i < props.retryCount + 1; i++) {
    if (i > 0)
      await new Promise((r) => setTimeout(r, props.retryDelay));
    try {
      const res = await fn();
      return res;
    } catch (e) {
      lastError = e;
      if (!props.retryCheck(e))
        throw e;
    }
  }
  throw lastError;
}
function currentISOTime() {
  return new Date().toISOString();
}
function safeSetTimeout(fn, timeout) {
  const t = setTimeout(fn, timeout);
  t?.unref && t?.unref();
  return t;
}
async function raceWithTimeout(promise, timeoutMs, onTimeout) {
  let timeoutHandle;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve, reject) => {
        timeoutHandle = safeSetTimeout(() => {
          try {
            onTimeout?.();
            resolve();
          } catch (error) {
            reject(error);
          }
        }, timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timeoutHandle);
  }
}
function allSettled(promises) {
  return Promise.all(promises.map((p) => (p ?? Promise.resolve()).then((value) => ({
    status: "fulfilled",
    value
  }), (reason) => ({
    status: "rejected",
    reason
  }))));
}
var STRING_FORMAT = "utf8", UUID_REGEX;
var init_utils = __esm(() => {
  init_json_utils();
  init_bot_detection();
  init_browser_utils();
  init_bucketed_rate_limiter();
  init_number_utils();
  init_string_utils();
  init_type_utils();
  init_promise_queue();
  init_logger();
  init_user_agent_utils();
  UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
});

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/logs/logs-utils.mjs
function newState() {
  return {
    ancestors: new WeakSet,
    remainingNodes: MAX_JSON_SAFE_VALUE_NODES
  };
}
function toOtlpKeyValueList(attrs, logger) {
  try {
    return encodeKeyValueList(attrs, logger, newState(), 0);
  } catch {
    return [];
  }
}
function encodeAnyValue(value, logger, state, depth) {
  if (state.remainingNodes <= 0)
    return {
      stringValue: TRUNCATED_VALUE
    };
  state.remainingNodes--;
  if (isBoolean(value))
    return {
      boolValue: value
    };
  if (typeof value == "number") {
    if (!Number.isFinite(value))
      return {
        stringValue: String(value)
      };
    if (Number.isInteger(value)) {
      if (Number.isSafeInteger(value))
        return {
          intValue: String(value)
        };
      if (typeof BigInt == "undefined")
        return {
          stringValue: String(value)
        };
      const decimal = BigInt(value).toString();
      if (value >= INT64_RANGE_LIMIT || value < -INT64_RANGE_LIMIT) {
        logger?.debug(`Attribute ${decimal} is outside the int64 range; encoding it as a string`);
        return {
          stringValue: decimal
        };
      }
      return {
        intValue: decimal
      };
    }
    return {
      doubleValue: value
    };
  }
  if (typeof value == "string")
    return {
      stringValue: sanitizeString(value)
    };
  if (typeof value == "function")
    return {
      stringValue: FUNCTION_VALUE
    };
  if (typeof value == "symbol")
    return {
      stringValue: String(value)
    };
  if (typeof value == "object" && value !== null) {
    if (state.ancestors.has(value))
      return {
        stringValue: CIRCULAR_VALUE
      };
    if (depth >= MAX_JSON_SAFE_VALUE_DEPTH)
      return {
        stringValue: TRUNCATED_VALUE
      };
    if (value instanceof Date) {
      const time = value.getTime();
      const iso = Number.isFinite(time) ? value.toISOString() : String(value);
      return {
        stringValue: typeof iso == "string" ? sanitizeString(iso) : String(iso)
      };
    }
    state.ancestors.add(value);
    try {
      try {
        const toJSON = value.toJSON;
        if (typeof toJSON == "function")
          return encodeAnyValue(toJSON.call(value), logger, state, depth + 1);
      } catch {}
      if (isArray(value))
        return {
          arrayValue: {
            values: encodeArrayValues(value, logger, state, depth + 1)
          }
        };
      return {
        kvlistValue: {
          values: encodeKeyValueList(value, logger, state, depth + 1)
        }
      };
    } finally {
      state.ancestors.delete(value);
    }
  }
  return {
    stringValue: sanitizeString(String(value))
  };
}
function encodeArrayValues(values, logger, state, depth) {
  const result = [];
  const itemCount = Math.min(values.length, MAX_JSON_SAFE_VALUE_ITEMS);
  let index = 0;
  for (;index < itemCount && state.remainingNodes > 0; index++)
    try {
      const element = index in values ? values[index] : undefined;
      if (isNullish(element))
        continue;
      result.push(encodeAnyValue(element, logger, state, depth));
    } catch {
      result.push({
        stringValue: UNSERIALIZABLE_VALUE
      });
    }
  if (values.length > index)
    result.push({
      stringValue: TRUNCATED_VALUE
    });
  return result;
}
function encodeKeyValueList(attrs, logger, state, depth) {
  const result = [];
  for (const key in attrs)
    if (propertyIsEnumerable.call(attrs, key)) {
      if (result.length >= MAX_JSON_SAFE_VALUE_ITEMS || state.remainingNodes <= 0) {
        logger?.debug("Attributes truncated: the value exceeds the OTLP encoder budget");
        break;
      }
      try {
        const value = attrs[key];
        if (isNull(value) || isUndefined(value))
          continue;
        result.push({
          key: sanitizeString(key),
          value: encodeAnyValue(value, logger, state, depth)
        });
      } catch {
        result.push({
          key: sanitizeString(key),
          value: {
            stringValue: UNSERIALIZABLE_VALUE
          }
        });
      }
    }
  return result;
}
var OTLP_SEVERITY_MAP, DEFAULT_OTLP_SEVERITY, INT64_RANGE_LIMIT = 9223372036854776000, propertyIsEnumerable;
var init_logs_utils = __esm(() => {
  init_utils();
  init_json_utils();
  OTLP_SEVERITY_MAP = {
    trace: {
      text: "TRACE",
      number: 1
    },
    debug: {
      text: "DEBUG",
      number: 5
    },
    info: {
      text: "INFO",
      number: 9
    },
    warn: {
      text: "WARN",
      number: 13
    },
    error: {
      text: "ERROR",
      number: 17
    },
    fatal: {
      text: "FATAL",
      number: 21
    }
  };
  DEFAULT_OTLP_SEVERITY = OTLP_SEVERITY_MAP.info;
  propertyIsEnumerable = Object.prototype.propertyIsEnumerable;
});

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/logs/index.mjs
var init_logs = __esm(() => {
  init_logs_utils();
  init_types();
  init_utils();
});

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/metrics/metrics-utils.mjs
function msToUnixNano(ms) {
  return String(ms) + "000000";
}
function seriesKey(type, name, unit, attributes) {
  let attrsKey = "";
  if (attributes) {
    const keys = Object.keys(attributes).sort();
    attrsKey = keys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(attributes[k])}`).join(",");
  }
  return `${type}\x00${name}\x00${unit ?? ""}\x00${attrsKey}`;
}
function bucketIndexFor(value, bounds) {
  for (let i = 0;i < bounds.length; i++)
    if (value <= bounds[i])
      return i;
  return bounds.length;
}
function buildMetricsResourceAttributes(config, scopeName, scopeVersion) {
  return {
    ...config.resourceAttributes,
    "service.name": config.serviceName || "unknown_service",
    ...config.environment && {
      "deployment.environment": config.environment
    },
    ...config.serviceVersion && {
      "service.version": config.serviceVersion
    },
    "telemetry.sdk.name": scopeName,
    "telemetry.sdk.version": scopeVersion
  };
}
function buildOtlpMetricsPayload(metrics, resourceAttributes, scopeName, scopeVersion) {
  return {
    resourceMetrics: [
      {
        resource: {
          attributes: toOtlpKeyValueList(resourceAttributes)
        },
        scopeMetrics: [
          {
            scope: {
              name: scopeName,
              version: scopeVersion
            },
            metrics
          }
        ]
      }
    ]
  };
}
var DEFAULT_HISTOGRAM_BOUNDS;
var init_metrics_utils = __esm(() => {
  init_logs_utils();
  DEFAULT_HISTOGRAM_BOUNDS = [
    0,
    5,
    10,
    25,
    50,
    75,
    100,
    250,
    500,
    750,
    1000,
    2500,
    5000,
    7500,
    1e4
  ];
});

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/metrics/config.mjs
function resolveMetricsConfig(config) {
  const resourceAttributes = config?.resourceAttributes;
  return {
    serviceName: resourceAttributes?.["service.name"] ?? config?.serviceName,
    serviceVersion: resourceAttributes?.["service.version"] ?? config?.serviceVersion,
    environment: resourceAttributes?.["deployment.environment"] ?? config?.environment,
    resourceAttributes,
    beforeSend: config?.beforeSend,
    flushIntervalMs: config?.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS,
    maxSeriesPerFlush: config?.maxSeriesPerFlush ?? DEFAULT_MAX_SERIES_PER_FLUSH
  };
}
var DEFAULT_FLUSH_INTERVAL_MS = 1e4, DEFAULT_MAX_SERIES_PER_FLUSH = 1000;
var init_config = () => {};

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/metrics/index.mjs
class PostHogMetrics {
  constructor(_instance, _config, _logger) {
    this._instance = _instance;
    this._config = _config;
    this._logger = _logger;
    this._series = new Map;
    this._flushPromise = null;
    this._seriesCapWarned = false;
    this._typeByName = new Map;
    this._typeCollisionWarned = new Set;
    this._generation = 0;
  }
  count(name, value = 1, options) {
    this._capture({
      name,
      type: "count",
      value,
      unit: options?.unit,
      attributes: options?.attributes
    });
  }
  gauge(name, value, options) {
    this._capture({
      name,
      type: "gauge",
      value,
      unit: options?.unit,
      attributes: options?.attributes
    });
  }
  histogram(name, value, options) {
    this._capture({
      name,
      type: "histogram",
      value,
      unit: options?.unit,
      attributes: options?.attributes
    });
  }
  flush() {
    const prev = this._flushPromise;
    const run = async () => {
      if (prev)
        await prev.catch(() => {});
      await this._doFlush();
    };
    const p = run().finally(() => {
      if (this._flushPromise === p)
        this._flushPromise = null;
    });
    this._flushPromise = p;
    return p;
  }
  drainWindow() {
    if (this._series.size === 0)
      return null;
    const window = this._series;
    this._series = new Map;
    this._seriesCapWarned = false;
    this._typeByName = new Map;
    this._typeCollisionWarned = new Set;
    return this._buildPayload(window);
  }
  reset() {
    this._generation++;
    this._clearFlushTimer();
    this._series = new Map;
    this._flushPromise = null;
    this._seriesCapWarned = false;
    this._typeByName = new Map;
    this._typeCollisionWarned = new Set;
  }
  _capture(sample) {
    if (this._instance.isDisabled || this._instance.optedOut)
      return;
    const filtered = this._runBeforeSend(sample);
    if (filtered === null)
      return;
    if (!filtered.name || typeof filtered.name != "string")
      return void this._logger.warn("Dropping metric with empty name");
    if (typeof filtered.value != "number" || !Number.isFinite(filtered.value))
      return void this._logger.warn(`Dropping metric '${filtered.name}': value must be a finite number`);
    if (filtered.type === "count" && filtered.value < 0)
      return void this._logger.warn(`Dropping count '${filtered.name}': counters are monotonic, value must be >= 0`);
    let attributes;
    let key;
    try {
      attributes = filtered.attributes ? {
        ...filtered.attributes
      } : undefined;
      key = seriesKey(filtered.type, filtered.name, filtered.unit, attributes);
    } catch (e) {
      this._logger.warn(`Dropping metric '${filtered.name}': attributes could not be serialized`, e);
      return;
    }
    let state = this._series.get(key);
    if (!state) {
      if (!this._admitNewSeries())
        return;
      state = {
        name: filtered.name,
        type: filtered.type,
        unit: filtered.unit,
        attributes,
        windowStartMs: Date.now()
      };
      this._series.set(key, state);
    }
    const seenType = this._typeByName.get(filtered.name);
    if (seenType === undefined)
      this._typeByName.set(filtered.name, filtered.type);
    else if (seenType !== filtered.type && !this._typeCollisionWarned.has(filtered.name)) {
      this._typeCollisionWarned.add(filtered.name);
      this._logger.warn(`Metric name '${filtered.name}' is already used as a ${seenType}; recording it as a ${filtered.type} too will blend both series in charts. Use a distinct name.`);
    }
    this._fold(state, filtered.value);
    this._armFlushTimer();
  }
  _admitNewSeries() {
    if (this._series.size < this._config.maxSeriesPerFlush)
      return true;
    if (!this._seriesCapWarned) {
      this._seriesCapWarned = true;
      this._logger.warn(`Metric series cap reached (${this._config.maxSeriesPerFlush} per flush window); dropping new series until the next flush. Reduce attribute cardinality.`);
    }
    return false;
  }
  _fold(state, value) {
    switch (state.type) {
      case "count":
        state.total = (state.total ?? 0) + value;
        break;
      case "gauge":
        state.last = value;
        break;
      case "histogram": {
        if (!state.hist)
          state.hist = {
            count: 0,
            sum: 0,
            min: value,
            max: value,
            bucketCounts: new Array(DEFAULT_HISTOGRAM_BOUNDS.length + 1).fill(0)
          };
        const hist = state.hist;
        hist.count += 1;
        hist.sum += value;
        hist.min = Math.min(hist.min, value);
        hist.max = Math.max(hist.max, value);
        hist.bucketCounts[bucketIndexFor(value, DEFAULT_HISTOGRAM_BOUNDS)] += 1;
        break;
      }
    }
  }
  _runBeforeSend(sample) {
    const beforeSend = this._config.beforeSend;
    if (!beforeSend)
      return sample;
    const fns = isArray(beforeSend) ? beforeSend : [
      beforeSend
    ];
    let result = sample;
    for (const fn of fns)
      try {
        const next = fn(result);
        if (!next) {
          this._logger.info("Metric was rejected in beforeSend function");
          return null;
        }
        result = next;
      } catch (e) {
        this._logger.error("Error in beforeSend function for metric:", e);
        return null;
      }
    return result;
  }
  _armFlushTimer() {
    if (this._flushTimer)
      return;
    this._flushTimer = safeSetTimeout(() => {
      this._flushTimer = undefined;
      this.flush().catch((e) => {
        this._logger.error("Metrics flush failed:", e);
      });
    }, this._config.flushIntervalMs);
  }
  _clearFlushTimer() {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = undefined;
    }
  }
  async _doFlush() {
    if (this._series.size === 0)
      return;
    const window = this._series;
    this._series = new Map;
    this._seriesCapWarned = false;
    this._typeByName = new Map;
    this._typeCollisionWarned = new Set;
    const generation = this._generation;
    const outcome = await this._instance._sendMetricsBatch(this._buildPayload(window));
    if (generation !== this._generation)
      return;
    switch (outcome.kind) {
      case "ok":
        return;
      case "retry-later":
        this._mergeWindowBack(window);
        this._armFlushTimer();
        return;
      case "too-large":
        this._logger.warn("Metrics batch exceeded the server size limit and was dropped");
        return;
      case "fatal":
        this._logger.error("Failed to send metrics batch:", outcome.error);
        return;
    }
  }
  _buildPayload(window) {
    return buildOtlpMetricsPayload(this._buildMetrics(window), buildMetricsResourceAttributes(this._config, this._instance.getLibraryId(), this._instance.getLibraryVersion()), this._instance.getLibraryId(), this._instance.getLibraryVersion());
  }
  _buildMetrics(window) {
    const nowNano = msToUnixNano(Date.now());
    const byMetric = new Map;
    for (const state of window.values()) {
      const metricKey = seriesKey(state.type, state.name, state.unit, undefined);
      let metric = byMetric.get(metricKey);
      if (!metric) {
        metric = {
          name: state.name,
          ...state.unit && {
            unit: state.unit
          }
        };
        if (state.type === "count")
          metric.sum = {
            aggregationTemporality: OTLP_TEMPORALITY_DELTA,
            isMonotonic: true,
            dataPoints: []
          };
        else if (state.type === "gauge")
          metric.gauge = {
            dataPoints: []
          };
        else
          metric.histogram = {
            aggregationTemporality: OTLP_TEMPORALITY_DELTA,
            dataPoints: []
          };
        byMetric.set(metricKey, metric);
      }
      const attributes = toOtlpKeyValueList(state.attributes ?? {}, this._logger);
      const startNano = msToUnixNano(state.windowStartMs);
      if (state.type === "count") {
        const dp = {
          attributes,
          startTimeUnixNano: startNano,
          timeUnixNano: nowNano,
          asDouble: state.total ?? 0
        };
        metric.sum.dataPoints.push(dp);
      } else if (state.type === "gauge") {
        const dp = {
          attributes,
          timeUnixNano: nowNano,
          asDouble: state.last ?? 0
        };
        metric.gauge.dataPoints.push(dp);
      } else if (state.hist) {
        const dp = {
          attributes,
          startTimeUnixNano: startNano,
          timeUnixNano: nowNano,
          count: state.hist.count,
          sum: state.hist.sum,
          min: state.hist.min,
          max: state.hist.max,
          bucketCounts: state.hist.bucketCounts,
          explicitBounds: DEFAULT_HISTOGRAM_BOUNDS
        };
        metric.histogram.dataPoints.push(dp);
      }
    }
    return Array.from(byMetric.values());
  }
  _mergeWindowBack(window) {
    for (const [key, old] of window) {
      const current = this._series.get(key);
      if (!current) {
        if (this._admitNewSeries())
          this._series.set(key, old);
        continue;
      }
      current.windowStartMs = Math.min(current.windowStartMs, old.windowStartMs);
      switch (current.type) {
        case "count":
          current.total = (current.total ?? 0) + (old.total ?? 0);
          break;
        case "gauge":
          break;
        case "histogram":
          if (old.hist)
            if (current.hist) {
              current.hist.count += old.hist.count;
              current.hist.sum += old.hist.sum;
              current.hist.min = Math.min(current.hist.min, old.hist.min);
              current.hist.max = Math.max(current.hist.max, old.hist.max);
              for (let i = 0;i < current.hist.bucketCounts.length; i++)
                current.hist.bucketCounts[i] += old.hist.bucketCounts[i];
            } else
              current.hist = old.hist;
          break;
      }
    }
  }
}
var OTLP_TEMPORALITY_DELTA = 1;
var init_metrics = __esm(() => {
  init_utils();
  init_logs_utils();
  init_metrics_utils();
  init_config();
});

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/surveys/validation.mjs
var init_validation = __esm(() => {
  init_types();
});

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/cookie.mjs
var init_cookie = __esm(() => {
  init_utils();
  init_uuidv7();
});

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/eventemitter.mjs
class SimpleEventEmitter {
  constructor() {
    this.events = {};
    this.events = {};
  }
  on(event, listener) {
    if (!this.events[event])
      this.events[event] = [];
    this.events[event].push(listener);
    return () => {
      this.events[event] = this.events[event].filter((x) => x !== listener);
    };
  }
  emit(event, payload) {
    for (const listener of this.events[event] || [])
      listener(payload);
    for (const listener of this.events["*"] || [])
      listener(event, payload);
  }
}
var init_eventemitter = () => {};

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/chunk-ids.mjs
function getFilenameToChunkIdMap(stackParser) {
  const chunkIdMap = globalThis._posthogChunkIds;
  if (!chunkIdMap)
    return;
  const chunkIdKeys = Object.keys(chunkIdMap);
  if (cachedFilenameChunkIds && chunkIdKeys.length === lastKeysCount)
    return cachedFilenameChunkIds;
  lastKeysCount = chunkIdKeys.length;
  cachedFilenameChunkIds = chunkIdKeys.reduce((acc, stackKey) => {
    if (!parsedStackResults)
      parsedStackResults = {};
    const result = parsedStackResults[stackKey];
    if (result)
      acc[result[0]] = result[1];
    else {
      const parsedStack = stackParser(stackKey);
      for (let i = parsedStack.length - 1;i >= 0; i--) {
        const stackFrame = parsedStack[i];
        const filename = stackFrame?.filename;
        const chunkId = chunkIdMap[stackKey];
        if (filename && chunkId) {
          acc[filename] = chunkId;
          parsedStackResults[stackKey] = [
            filename,
            chunkId
          ];
          break;
        }
      }
    }
    return acc;
  }, {});
  return cachedFilenameChunkIds;
}
var parsedStackResults, lastKeysCount, cachedFilenameChunkIds;
var init_chunk_ids = () => {};

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/error-properties-builder.mjs
class ErrorPropertiesBuilder {
  constructor(coercers, stackParser, modifiers = []) {
    this.coercers = coercers;
    this.stackParser = stackParser;
    this.modifiers = modifiers;
  }
  buildFromUnknown(input, hint = {}) {
    const providedMechanism = hint && hint.mechanism;
    const mechanism = providedMechanism || {
      handled: true,
      type: "generic"
    };
    const coercingContext = this.buildCoercingContext(mechanism, hint, 0);
    const exceptionWithCause = coercingContext.apply(input);
    const parsingContext = this.buildParsingContext(hint);
    const exceptionWithStack = this.parseStacktrace(exceptionWithCause, parsingContext);
    const exceptionList = this.convertToExceptionList(exceptionWithStack, mechanism);
    return {
      $exception_list: exceptionList,
      $exception_level: "error"
    };
  }
  async modifyFrames(exceptionList) {
    for (const exc of exceptionList)
      if (exc.stacktrace && exc.stacktrace.frames && isArray(exc.stacktrace.frames))
        exc.stacktrace.frames = await this.applyModifiers(exc.stacktrace.frames);
    return exceptionList;
  }
  coerceFallback(ctx) {
    return {
      type: "Error",
      value: "Unknown error",
      stack: ctx.syntheticException?.stack,
      synthetic: true
    };
  }
  parseStacktrace(err, ctx) {
    let cause;
    if (err.cause != null)
      cause = this.parseStacktrace(err.cause, ctx);
    let stack;
    if (err.stack != "" && err.stack != null)
      stack = this.applyChunkIds(this.stackParser(err.stack, err.synthetic ? ctx.skipFirstLines : 0), ctx.chunkIdMap);
    return {
      ...err,
      cause,
      stack
    };
  }
  applyChunkIds(frames, chunkIdMap) {
    return frames.map((frame) => {
      if (frame.filename && chunkIdMap)
        frame.chunk_id = chunkIdMap[frame.filename];
      return frame;
    });
  }
  applyCoercers(input, ctx) {
    for (const adapter of this.coercers)
      if (adapter.match(input))
        return adapter.coerce(input, ctx);
    return this.coerceFallback(ctx);
  }
  async applyModifiers(frames) {
    let newFrames = frames;
    for (const modifier of this.modifiers)
      newFrames = await modifier(newFrames);
    return newFrames;
  }
  convertToExceptionList(exceptionWithStack, mechanism) {
    const currentException = {
      type: exceptionWithStack.type,
      value: exceptionWithStack.value,
      mechanism: {
        type: mechanism.type ?? "generic",
        handled: mechanism.handled ?? true,
        synthetic: exceptionWithStack.synthetic ?? false
      }
    };
    if (exceptionWithStack.stack)
      currentException.stacktrace = {
        type: "raw",
        frames: exceptionWithStack.stack
      };
    const exceptionList = [
      currentException
    ];
    if (exceptionWithStack.cause != null)
      exceptionList.push(...this.convertToExceptionList(exceptionWithStack.cause, {
        ...mechanism,
        handled: true
      }));
    return exceptionList;
  }
  buildParsingContext(hint) {
    const context = {
      chunkIdMap: getFilenameToChunkIdMap(this.stackParser),
      skipFirstLines: hint.skipFirstLines ?? 1
    };
    return context;
  }
  buildCoercingContext(mechanism, hint, depth = 0) {
    const coerce = (input, depth) => {
      if (!(depth <= MAX_CAUSE_RECURSION))
        return;
      {
        const ctx = this.buildCoercingContext(mechanism, hint, depth);
        return this.applyCoercers(input, ctx);
      }
    };
    const context = {
      ...hint,
      syntheticException: depth == 0 ? hint.syntheticException : undefined,
      mechanism,
      apply: (input) => coerce(input, depth),
      next: (input) => coerce(input, depth + 1)
    };
    return context;
  }
}
var MAX_CAUSE_RECURSION = 4;
var init_error_properties_builder = __esm(() => {
  init_utils();
  init_chunk_ids();
});

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/parsers/base.mjs
function createFrame(platform, filename, func, lineno, colno) {
  const frame = {
    platform,
    filename,
    function: func === "<anonymous>" ? UNKNOWN_FUNCTION : func,
    in_app: !filename?.startsWith(MASKED_URL_PREFIX) && filename !== ANONYMOUS_FILENAME
  };
  if (!isUndefined(lineno))
    frame.lineno = lineno;
  if (!isUndefined(colno))
    frame.colno = colno;
  return frame;
}
var UNKNOWN_FUNCTION = "?", MASKED_URL_PREFIX = "webkit-masked-url://", ANONYMOUS_FILENAME = "<anonymous>";
var init_base = __esm(() => {
  init_utils();
});

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/parsers/safari.mjs
var extractSafariExtensionDetails = (func, filename) => {
  const isSafariExtension = func.indexOf("safari-extension") !== -1;
  const isSafariWebExtension = func.indexOf("safari-web-extension") !== -1;
  return isSafariExtension || isSafariWebExtension ? [
    func.indexOf("@") !== -1 ? func.split("@")[0] : UNKNOWN_FUNCTION,
    isSafariExtension ? `safari-extension:${filename}` : `safari-web-extension:${filename}`
  ] : [
    func,
    filename
  ];
};
var init_safari = __esm(() => {
  init_base();
});

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/parsers/chrome.mjs
var chromeRegexNoFnName, chromeRegex, chromeEvalRegex, chromeStackLineParser = (line, platform) => {
  const noFnParts = chromeRegexNoFnName.exec(line);
  if (noFnParts) {
    const [, filename, line, col] = noFnParts;
    return createFrame(platform, filename, UNKNOWN_FUNCTION, +line, +col);
  }
  const parts = chromeRegex.exec(line);
  if (parts) {
    const isEval = parts[2] && parts[2].indexOf("eval") === 0;
    if (isEval) {
      const subMatch = chromeEvalRegex.exec(parts[2]);
      if (subMatch) {
        parts[2] = subMatch[1];
        parts[3] = subMatch[2];
        parts[4] = subMatch[3];
      }
    }
    const [func, filename] = extractSafariExtensionDetails(parts[1] || UNKNOWN_FUNCTION, parts[2]);
    return createFrame(platform, filename, func, parts[3] ? +parts[3] : undefined, parts[4] ? +parts[4] : undefined);
  }
};
var init_chrome = __esm(() => {
  init_base();
  init_safari();
  chromeRegexNoFnName = /^\s*at (\S+?)(?::(\d+))(?::(\d+))\s*$/i;
  chromeRegex = /^\s*at (?:(.+?\)(?: \[.+\])?|.*?) ?\((?:address at )?)?(?:async )?((?:<anonymous>|[-a-z]+:|.*bundle|\/)?.*?)(?::(\d+))?(?::(\d+))?\)?\s*$/i;
  chromeEvalRegex = /\((\S*)(?::(\d+))(?::(\d+))\)/;
});

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/parsers/gecko.mjs
var geckoREgex, geckoEvalRegex, geckoStackLineParser = (line, platform) => {
  const parts = geckoREgex.exec(line);
  if (parts) {
    const isEval = parts[3] && parts[3].indexOf(" > eval") > -1;
    if (isEval) {
      const subMatch = geckoEvalRegex.exec(parts[3]);
      if (subMatch) {
        parts[1] = parts[1] || "eval";
        parts[3] = subMatch[1];
        parts[4] = subMatch[2];
        parts[5] = "";
      }
    }
    let filename = parts[3];
    let func = parts[1] || UNKNOWN_FUNCTION;
    [func, filename] = extractSafariExtensionDetails(func, filename);
    return createFrame(platform, filename, func, parts[4] ? +parts[4] : undefined, parts[5] ? +parts[5] : undefined);
  }
};
var init_gecko = __esm(() => {
  init_base();
  init_safari();
  geckoREgex = /^\s*(.*?)(?:\((.*?)\))?(?:^|@)?((?:[-a-z]+)?:\/.*?|\[native code\]|[^@]*(?:bundle|\d+\.js)|\/[\w\-. /=]+)(?::(\d+))?(?::(\d+))?\s*$/i;
  geckoEvalRegex = /(\S+) line (\d+)(?: > eval line \d+)* > eval/i;
});

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/parsers/winjs.mjs
var init_winjs = __esm(() => {
  init_base();
});

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/parsers/opera.mjs
var init_opera = __esm(() => {
  init_base();
});

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/parsers/node.mjs
function filenameIsInApp(filename, isNative = false) {
  const isInternal = isNative || filename && !filename.startsWith("/") && !filename.match(/^[A-Z]:/) && !filename.startsWith(".") && !filename.match(/^[a-zA-Z]([a-zA-Z0-9.\-+])*:\/\//);
  return !isInternal && filename !== undefined && !filename.includes("node_modules/");
}
function _parseIntOrUndefined(input) {
  return parseInt(input || "", 10) || undefined;
}
var FILENAME_MATCH, FULL_MATCH, PROMISE_COMBINATOR, PROMISE_INDEX, PROMISE_FRAME_FILENAME = "node:internal/promise", nodeStackLineParser = (line, platform) => {
  const lineMatch = line.match(FULL_MATCH);
  if (lineMatch) {
    let object;
    let method;
    let functionName;
    let typeName;
    let methodName;
    if (lineMatch[1]) {
      functionName = lineMatch[1];
      let methodStart = functionName.lastIndexOf(".");
      if (functionName[methodStart - 1] === ".")
        methodStart--;
      if (methodStart > 0) {
        object = functionName.slice(0, methodStart);
        method = functionName.slice(methodStart + 1);
        const objectEnd = object.indexOf(".Module");
        if (objectEnd > 0) {
          functionName = functionName.slice(objectEnd + 1);
          object = object.slice(0, objectEnd);
        }
      }
      typeName = undefined;
    }
    if (method) {
      typeName = object;
      methodName = method;
    }
    if (method === "<anonymous>") {
      methodName = undefined;
      functionName = undefined;
    }
    if (functionName === undefined) {
      methodName = methodName || UNKNOWN_FUNCTION;
      functionName = typeName ? `${typeName}.${methodName}` : methodName;
    }
    let filename = lineMatch[2]?.startsWith("file://") ? lineMatch[2].slice(7) : lineMatch[2];
    const isNative = lineMatch[5] === "native";
    if (filename?.match(/\/[A-Z]:/))
      filename = filename.slice(1);
    if (!filename && lineMatch[5] && !isNative)
      filename = lineMatch[5];
    if (PROMISE_COMBINATOR.test(functionName) && PROMISE_INDEX.test(filename || ""))
      filename = PROMISE_FRAME_FILENAME;
    return {
      filename: filename ? decodeURI(filename) : undefined,
      module: undefined,
      function: functionName,
      lineno: _parseIntOrUndefined(lineMatch[3]),
      colno: _parseIntOrUndefined(lineMatch[4]),
      in_app: filenameIsInApp(filename || "", isNative),
      platform
    };
  }
  if (line.match(FILENAME_MATCH))
    return {
      filename: line,
      platform
    };
};
var init_node = __esm(() => {
  init_base();
  FILENAME_MATCH = /^\s*[-]{4,}$/;
  FULL_MATCH = /at (?:async )?(?:(.+?)\s+\()?(?:(.+):(\d+):(\d+)?|([^)]+))\)?/;
  PROMISE_COMBINATOR = /^Promise\.(?:all|any)$/;
  PROMISE_INDEX = /^index \d+$/;
});

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/parsers/index.mjs
function reverseAndStripFrames(stack) {
  if (!stack.length)
    return [];
  const localStack = Array.from(stack);
  localStack.reverse();
  return localStack.slice(0, STACKTRACE_FRAME_LIMIT).map((frame) => ({
    ...frame,
    filename: frame.filename || getLastStackFrame(localStack).filename,
    function: frame.function || UNKNOWN_FUNCTION
  }));
}
function getLastStackFrame(arr) {
  return arr[arr.length - 1] || {};
}
function createDefaultStackParser() {
  return createStackParser("web:javascript", chromeStackLineParser, geckoStackLineParser);
}
function createStackParser(platform, ...parsers) {
  return (stack, skipFirstLines = 0) => {
    const frames = [];
    const lines = stack.split(`
`);
    for (let i = skipFirstLines;i < lines.length; i++) {
      const line = lines[i];
      if (line.length > 1024)
        continue;
      const cleanedLine = WEBPACK_ERROR_REGEXP.test(line) ? line.replace(WEBPACK_ERROR_REGEXP, "$1") : line;
      if (!cleanedLine.match(/\S*Error: /)) {
        for (const parser of parsers) {
          const frame = parser(cleanedLine, platform);
          if (frame) {
            frames.push(frame);
            break;
          }
        }
        if (frames.length >= STACKTRACE_FRAME_LIMIT)
          break;
      }
    }
    return reverseAndStripFrames(frames);
  };
}
var WEBPACK_ERROR_REGEXP, STACKTRACE_FRAME_LIMIT = 50;
var init_parsers = __esm(() => {
  init_base();
  init_chrome();
  init_gecko();
  init_winjs();
  init_opera();
  init_node();
  WEBPACK_ERROR_REGEXP = /\(error: (.*)\)/;
});

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/coercers/dom-exception-coercer.mjs
var init_dom_exception_coercer = __esm(() => {
  init_utils();
});

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/coercers/error-coercer.mjs
class ErrorCoercer {
  match(err) {
    return isError(err);
  }
  coerce(err, ctx) {
    const stack = this.getStack(err);
    const synthetic = stack === undefined;
    return {
      type: this.getType(err),
      value: this.getMessage(err, ctx),
      stack: stack ?? ctx.syntheticException?.stack,
      cause: err.cause ? ctx.next(err.cause) : undefined,
      synthetic
    };
  }
  getType(err) {
    return err.name || err.constructor.name;
  }
  getMessage(err, _ctx) {
    const message = err.message;
    if (message.error && typeof message.error.message == "string")
      return String(message.error.message);
    return String(message);
  }
  getStack(err) {
    return err.stacktrace || err.stack || undefined;
  }
}
var init_error_coercer = __esm(() => {
  init_type_utils();
});

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/coercers/error-event-coercer.mjs
var init_error_event_coercer = __esm(() => {
  init_utils();
});

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/coercers/string-coercer.mjs
class StringCoercer {
  match(input) {
    return typeof input == "string";
  }
  coerce(input, ctx) {
    const [type, value] = this.getInfos(input);
    return {
      type: type ?? "Error",
      value: value ?? input,
      stack: ctx.syntheticException?.stack,
      synthetic: true
    };
  }
  getInfos(candidate) {
    let type = "Error";
    let value = candidate;
    const groups = candidate.match(ERROR_TYPES_PATTERN);
    if (groups) {
      type = groups[1];
      value = groups[2];
    }
    return [
      type,
      value
    ];
  }
}
var ERROR_TYPES_PATTERN;
var init_string_coercer = __esm(() => {
  ERROR_TYPES_PATTERN = /^(?:[Uu]ncaught (?:exception: )?)?(?:((?:Eval|Internal|Range|Reference|Syntax|Type|URI|)Error): )?(.*)$/i;
});

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/types.mjs
var severityLevels;
var init_types2 = __esm(() => {
  severityLevels = [
    "fatal",
    "error",
    "warning",
    "log",
    "info",
    "debug"
  ];
});

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/coercers/utils.mjs
function extractExceptionKeysForMessage(err, maxLength = 40) {
  const keys = Object.keys(err);
  keys.sort();
  if (!keys.length)
    return "[object has no keys]";
  for (let i = keys.length;i > 0; i--) {
    const serialized = keys.slice(0, i).join(", ");
    if (!(serialized.length > maxLength)) {
      if (i === keys.length)
        return serialized;
      return serialized.length <= maxLength ? serialized : `${serialized.slice(0, maxLength)}...`;
    }
  }
  return "";
}
var init_utils2 = () => {};

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/coercers/object-coercer.mjs
class ObjectCoercer {
  match(candidate) {
    return typeof candidate == "object" && candidate !== null;
  }
  coerce(candidate, ctx) {
    const errorProperty = this.getErrorPropertyFromObject(candidate);
    if (errorProperty)
      return ctx.apply(errorProperty);
    return {
      type: this.getType(candidate),
      value: this.getValue(candidate),
      stack: this.getStack(candidate) ?? ctx.syntheticException?.stack,
      level: this.isSeverityLevel(candidate.level) ? candidate.level : "error",
      synthetic: true
    };
  }
  getType(err) {
    if (isEvent(err))
      return err.constructor.name;
    const name = "name" in err ? err.name : undefined;
    return isString(name) && !isEmptyString(name) ? name : "Error";
  }
  getValue(err) {
    if ("name" in err && typeof err.name == "string") {
      let message = `'${err.name}' captured as exception`;
      if ("message" in err && typeof err.message == "string")
        message += ` with message: '${err.message}'`;
      return message;
    }
    if ("message" in err && typeof err.message == "string")
      return err.message;
    const className = this.getObjectClassName(err);
    const keys = extractExceptionKeysForMessage(err);
    return `${className && className !== "Object" ? `'${className}'` : "Object"} captured as exception with keys: ${keys}`;
  }
  isSeverityLevel(x) {
    return isString(x) && !isEmptyString(x) && severityLevels.indexOf(x) >= 0;
  }
  getStack(candidate) {
    try {
      if (isString(candidate.stacktrace) && candidate.stacktrace.length > 0)
        return candidate.stacktrace;
      return isString(candidate.stack) && candidate.stack.length > 0 ? candidate.stack : undefined;
    } catch {
      return;
    }
  }
  getErrorPropertyFromObject(obj) {
    for (const prop in obj)
      if (Object.prototype.hasOwnProperty.call(obj, prop)) {
        const value = obj[prop];
        if (isError(value))
          return value;
      }
  }
  getObjectClassName(obj) {
    try {
      const prototype = Object.getPrototypeOf(obj);
      return prototype ? prototype.constructor.name : undefined;
    } catch (e) {
      return;
    }
  }
}
var init_object_coercer = __esm(() => {
  init_utils();
  init_types2();
  init_utils2();
});

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/coercers/event-coercer.mjs
class EventCoercer {
  match(err) {
    return isEvent(err);
  }
  coerce(evt, ctx) {
    const constructorName = evt.constructor.name;
    return {
      type: constructorName,
      value: `${constructorName} captured as exception with keys: ${extractExceptionKeysForMessage(evt)}`,
      stack: ctx.syntheticException?.stack,
      synthetic: true
    };
  }
}
var init_event_coercer = __esm(() => {
  init_utils();
  init_utils2();
});

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/coercers/primitive-coercer.mjs
class PrimitiveCoercer {
  match(candidate) {
    return isPrimitive(candidate);
  }
  coerce(value, ctx) {
    return {
      type: "Error",
      value: `Primitive value captured as exception: ${String(value)}`,
      stack: ctx.syntheticException?.stack,
      synthetic: true
    };
  }
}
var init_primitive_coercer = __esm(() => {
  init_utils();
});

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/coercers/promise-rejection-event.mjs
var init_promise_rejection_event = __esm(() => {
  init_utils();
});

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/coercers/index.mjs
var init_coercers = __esm(() => {
  init_dom_exception_coercer();
  init_error_coercer();
  init_error_event_coercer();
  init_string_coercer();
  init_object_coercer();
  init_event_coercer();
  init_primitive_coercer();
  init_promise_rejection_event();
});

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/utils.mjs
class ReduceableCache {
  constructor(_maxSize) {
    this._maxSize = _maxSize;
    this._cache = new Map;
  }
  get(key) {
    const value = this._cache.get(key);
    if (value === undefined)
      return;
    this._cache.delete(key);
    this._cache.set(key, value);
    return value;
  }
  set(key, value) {
    this._cache.set(key, value);
  }
  reduce() {
    while (this._cache.size >= this._maxSize) {
      const value = this._cache.keys().next().value;
      if (value)
        this._cache.delete(value);
    }
  }
}
var init_utils3 = () => {};

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/exception-steps.mjs
var EXCEPTION_STEP_INTERNAL_FIELDS, RESERVED_EXCEPTION_STEP_KEYS;
var init_exception_steps = __esm(() => {
  init_utils();
  EXCEPTION_STEP_INTERNAL_FIELDS = {
    MESSAGE: "$message",
    TIMESTAMP: "$timestamp"
  };
  RESERVED_EXCEPTION_STEP_KEYS = new Set([
    EXCEPTION_STEP_INTERNAL_FIELDS.MESSAGE,
    EXCEPTION_STEP_INTERNAL_FIELDS.TIMESTAMP
  ]);
});

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/release.mjs
function getInjectedReleaseId() {
  const injected = globalThis._posthogReleaseId;
  return typeof injected == "string" && injected.length > 0 ? injected : undefined;
}
var init_release = () => {};

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/index.mjs
var init_error_tracking = __esm(() => {
  init_error_properties_builder();
  init_parsers();
  init_coercers();
  init_utils3();
  init_exception_steps();
  init_release();
});

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/posthog-core-stateless.mjs
async function logFlushError(err) {
  if (err instanceof PostHogFetchHttpError) {
    let text = "";
    try {
      text = await err.text;
    } catch {
      if (err.bodyReadTimedOut)
        text = "<response body read timed out>";
    }
    console.error(`Error while flushing PostHog: message=${err.message}, response body=${text}`, err);
  } else
    console.error("Error while flushing PostHog", err);
  return Promise.resolve();
}
function isPostHogFetchError(err) {
  return typeof err == "object" && (err instanceof PostHogFetchHttpError || isPostHogFetchNetworkError(err));
}
function isPostHogFetchNetworkError(err) {
  return err instanceof PostHogFetchNetworkError;
}
function isRetryableFlagsFetchError(err) {
  if (err instanceof PostHogFetchHttpError)
    return err.status === 502 || err.status === 504;
  if (!(err instanceof PostHogFetchNetworkError))
    return false;
  const cause = err.error;
  const code = cause?.code ?? cause?.cause?.code;
  return code !== "ECONNREFUSED";
}
function isPostHogFetchContentTooLargeError(err) {
  return typeof err == "object" && err instanceof PostHogFetchHttpError && err.status === 413;
}
function isPostHogFetchRetryableError(err) {
  if (err instanceof PostHogFetchHttpError)
    return err.status === 408 || err.status === 429 || err.status >= 500;
  return isPostHogFetchNetworkError(err);
}
function isPostHogEventProperties(value) {
  return value !== null && typeof value == "object" && !Array.isArray(value);
}

class PostHogCoreStateless {
  getErrorPropertiesBuilder() {
    if (!this._errorPropertiesBuilder)
      this._errorPropertiesBuilder = this.createErrorPropertiesBuilder();
    return this._errorPropertiesBuilder;
  }
  createErrorPropertiesBuilder() {
    return new ErrorPropertiesBuilder([
      new ErrorCoercer,
      new ObjectCoercer,
      new StringCoercer,
      new PrimitiveCoercer
    ], createDefaultStackParser());
  }
  constructor(apiKey, options = {}) {
    this.flushPromise = null;
    this.pendingFlushPromise = null;
    this.flushPromises = new Set;
    this._dequeuedMessagesCount = 0;
    this.shutdownPromise = null;
    this.promiseQueue = new PromiseQueue;
    this._events = new SimpleEventEmitter;
    this._isInitialized = false;
    const normalizedApiKey = typeof apiKey == "string" ? apiKey.trim() : "";
    const normalizedHost = typeof options.host == "string" ? options.host.trim() : "";
    const missingApiKey = !normalizedApiKey;
    this._logger = createLogger("[PostHog]", this.logMsgIfDebug.bind(this));
    if (missingApiKey)
      this._logger.error("You must pass your PostHog project's api key. The client will be disabled.");
    this.apiKey = normalizedApiKey;
    this.host = removeTrailingSlash(normalizedHost || "https://us.i.posthog.com");
    this.flushAt = options.flushAt ? Math.max(options.flushAt, 1) : 20;
    this.maxBatchSize = Math.max(this.flushAt, options.maxBatchSize ?? 100);
    this.maxQueueSize = Math.max(this.flushAt, options.maxQueueSize ?? 1000);
    this.flushInterval = options.flushInterval ?? 1e4;
    this.preloadFeatureFlags = options.preloadFeatureFlags ?? true;
    this.defaultOptIn = options.defaultOptIn ?? true;
    this.disableSurveys = options.disableSurveys ?? false;
    this._retryOptions = {
      retryCount: options.fetchRetryCount ?? 3,
      retryDelay: options.fetchRetryDelay ?? 3000,
      retryCheck: isPostHogFetchRetryableError
    };
    this.requestTimeout = options.requestTimeout ?? 1e4;
    this.featureFlagsRequestTimeoutMs = options.featureFlagsRequestTimeoutMs ?? 3000;
    this.featureFlagsRequestMaxRetries = options.featureFlagsRequestMaxRetries ?? 1;
    this.remoteConfigRequestTimeoutMs = options.remoteConfigRequestTimeoutMs ?? 3000;
    this.disableGeoip = options.disableGeoip ?? true;
    this.disabled = (options.disabled ?? false) || missingApiKey;
    this.historicalMigration = options?.historicalMigration ?? false;
    this._initPromise = Promise.resolve();
    this._isInitialized = true;
    this.evaluationContexts = options?.evaluationContexts ?? options?.evaluationEnvironments;
    if (options?.evaluationEnvironments && !options?.evaluationContexts)
      this._logger.warn("evaluationEnvironments is deprecated. Use evaluationContexts instead. This property will be removed in a future version.");
    this.disableCompression = !isGzipSupported() || (options?.disableCompression ?? false);
  }
  logMsgIfDebug(fn) {
    if (this.isDebug)
      fn();
  }
  wrap(fn) {
    if (this.disabled)
      return void this._logger.warn("The client is disabled");
    if (this._isInitialized)
      return fn();
    this._initPromise.then(() => fn());
  }
  getCommonEventProperties() {
    return {
      $lib: this.getLibraryId(),
      $lib_version: this.getLibraryVersion()
    };
  }
  get optedOut() {
    return this.getPersistedProperty(types_PostHogPersistedProperty.OptedOut) ?? !this.defaultOptIn;
  }
  async optIn() {
    this.wrap(() => {
      this.setPersistedProperty(types_PostHogPersistedProperty.OptedOut, false);
    });
  }
  async optOut() {
    this.wrap(() => {
      this.setPersistedProperty(types_PostHogPersistedProperty.OptedOut, true);
    });
  }
  on(event, cb) {
    return this._events.on(event, cb);
  }
  debug(enabled = true) {
    this.removeDebugCallback?.();
    if (enabled) {
      const removeDebugCallback = this.on("*", (event, payload) => this._logger.info(event, payload));
      this.removeDebugCallback = () => {
        removeDebugCallback();
        this.removeDebugCallback = undefined;
      };
    }
  }
  get isDebug() {
    return !!this.removeDebugCallback;
  }
  get isDisabled() {
    return this.disabled;
  }
  buildPayload(payload) {
    const userProperties = payload.properties || {};
    let properties = {
      ...userProperties,
      ...this.getCommonEventProperties()
    };
    applyCallerFeatureFlagOverrides(properties, userProperties);
    if (payload.event === "$feature_flag_called" && properties.$feature_flag_has_experiment === false && this.isMinimalFlagCalledEventsEnabled())
      properties = minimizeFlagCalledEventProperties(properties);
    return {
      distinct_id: payload.distinct_id,
      event: payload.event,
      properties
    };
  }
  isMinimalFlagCalledEventsEnabled() {
    return false;
  }
  addPendingPromise(promise) {
    return this.promiseQueue.add(promise);
  }
  identifyStateless(distinctId, properties, options) {
    this.wrap(() => {
      const payload = {
        ...this.buildPayload({
          distinct_id: distinctId,
          event: "$identify",
          properties
        })
      };
      this.enqueue("identify", payload, options);
    });
  }
  async identifyStatelessImmediate(distinctId, properties, options) {
    const payload = {
      ...this.buildPayload({
        distinct_id: distinctId,
        event: "$identify",
        properties
      })
    };
    await this.sendImmediate("identify", payload, options);
  }
  captureStateless(distinctId, event, properties, options) {
    this.wrap(() => {
      const payload = this.buildPayload({
        distinct_id: distinctId,
        event,
        properties
      });
      this.enqueue("capture", payload, options);
    });
  }
  async captureStatelessImmediate(distinctId, event, properties, options) {
    const payload = this.buildPayload({
      distinct_id: distinctId,
      event,
      properties
    });
    await this.sendImmediate("capture", payload, options);
  }
  aliasStateless(alias, distinctId, properties, options) {
    this.wrap(() => {
      const payload = this.buildPayload({
        event: "$create_alias",
        distinct_id: distinctId,
        properties: {
          ...properties || {},
          distinct_id: distinctId,
          alias
        }
      });
      this.enqueue("alias", payload, options);
    });
  }
  async aliasStatelessImmediate(alias, distinctId, properties, options) {
    const payload = this.buildPayload({
      event: "$create_alias",
      distinct_id: distinctId,
      properties: {
        ...properties || {},
        distinct_id: distinctId,
        alias
      }
    });
    await this.sendImmediate("alias", payload, options);
  }
  groupIdentifyStateless(groupType, groupKey, groupProperties, options, distinctId, eventProperties) {
    this.wrap(() => {
      const payload = this.buildPayload({
        distinct_id: distinctId || `$${groupType}_${groupKey}`,
        event: "$groupidentify",
        properties: {
          $group_type: groupType,
          $group_key: groupKey,
          $group_set: groupProperties || {},
          ...eventProperties || {}
        }
      });
      this.enqueue("capture", payload, options);
    });
  }
  async groupIdentifyStatelessImmediate(groupType, groupKey, groupProperties, options, distinctId, eventProperties) {
    const payload = this.buildPayload({
      distinct_id: distinctId || `$${groupType}_${groupKey}`,
      event: "$groupidentify",
      properties: {
        $group_type: groupType,
        $group_key: groupKey,
        $group_set: groupProperties || {},
        ...eventProperties || {}
      }
    });
    await this.sendImmediate("capture", payload, options);
  }
  async getRemoteConfig() {
    await this._initPromise;
    let host = this.host;
    if (host === "https://us.i.posthog.com")
      host = "https://us-assets.i.posthog.com";
    else if (host === "https://eu.i.posthog.com")
      host = "https://eu-assets.i.posthog.com";
    const url = `${host}/array/${this.apiKey}/config`;
    const fetchOptions = {
      method: "GET",
      headers: {
        ...this.getCustomHeaders(),
        "Content-Type": "application/json"
      }
    };
    return this.fetchWithRetry(url, fetchOptions, {
      type: "required",
      consume: (response) => response.json()
    }, {
      retryCount: 0
    }, this.remoteConfigRequestTimeoutMs).catch((error) => {
      this._logger.error("Remote config could not be loaded", error);
      this._events.emit("error", error);
    });
  }
  async getFlags(distinctId, groups = {}, personProperties = {}, groupProperties = {}, extraPayload = {}, fetchConfig = false) {
    await this._initPromise;
    const configParam = fetchConfig ? "&config=true" : "";
    const url = `${this.host}/flags/?v=2${configParam}`;
    const requestData = {
      token: this.apiKey,
      distinct_id: distinctId,
      groups,
      person_properties: personProperties,
      group_properties: groupProperties,
      ...extraPayload
    };
    if (personProperties.$device_id)
      requestData.$device_id = personProperties.$device_id;
    if (this.evaluationContexts && this.evaluationContexts.length > 0)
      requestData.evaluation_contexts = this.evaluationContexts;
    const fetchOptions = {
      method: "POST",
      headers: {
        ...this.getCustomHeaders(),
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestData)
    };
    this._logger.info("Flags URL", url);
    return this.fetchWithRetry(url, fetchOptions, {
      type: "required",
      consume: (response) => response.json()
    }, {
      retryCount: this.featureFlagsRequestMaxRetries,
      retryCheck: isRetryableFlagsFetchError
    }, this.featureFlagsRequestTimeoutMs).then((response) => ({
      success: true,
      response: normalizeFlagsResponse(response)
    })).catch((error) => {
      this._events.emit("error", error);
      return {
        success: false,
        error: this.categorizeRequestError(error)
      };
    });
  }
  categorizeRequestError(error) {
    if (error instanceof PostHogFetchHttpError)
      return {
        type: "api_error",
        statusCode: error.status
      };
    if (error instanceof PostHogFetchNetworkError) {
      const cause = error.error;
      if (cause instanceof Error && (cause.name === "AbortError" || cause.name === "TimeoutError"))
        return {
          type: "timeout"
        };
      return {
        type: "connection_error"
      };
    }
    return {
      type: "unknown_error"
    };
  }
  async getFeatureFlagStateless(key, distinctId, groups = {}, personProperties = {}, groupProperties = {}, disableGeoip) {
    await this._initPromise;
    const flagDetailResponse = await this.getFeatureFlagDetailStateless(key, distinctId, groups, personProperties, groupProperties, disableGeoip);
    if (flagDetailResponse === undefined)
      return {
        response: undefined,
        requestId: undefined
      };
    let response = getFeatureFlagValue(flagDetailResponse.response);
    if (response === undefined)
      response = false;
    return {
      response,
      requestId: flagDetailResponse.requestId
    };
  }
  async getFeatureFlagDetailStateless(key, distinctId, groups = {}, personProperties = {}, groupProperties = {}, disableGeoip) {
    await this._initPromise;
    const flagsResponse = await this.getFeatureFlagDetailsStateless(distinctId, groups, personProperties, groupProperties, disableGeoip, [
      key
    ]);
    if (flagsResponse === undefined)
      return;
    const featureFlags = flagsResponse.flags;
    const flagDetail = featureFlags[key];
    return {
      response: flagDetail,
      requestId: flagsResponse.requestId,
      evaluatedAt: flagsResponse.evaluatedAt
    };
  }
  async getFeatureFlagPayloadStateless(key, distinctId, groups = {}, personProperties = {}, groupProperties = {}, disableGeoip) {
    await this._initPromise;
    const payloads = await this.getFeatureFlagPayloadsStateless(distinctId, groups, personProperties, groupProperties, disableGeoip, [
      key
    ]);
    if (!payloads)
      return;
    const response = payloads[key];
    if (response === undefined)
      return null;
    return response;
  }
  async getFeatureFlagPayloadsStateless(distinctId, groups = {}, personProperties = {}, groupProperties = {}, disableGeoip, flagKeysToEvaluate) {
    await this._initPromise;
    const payloads = (await this.getFeatureFlagsAndPayloadsStateless(distinctId, groups, personProperties, groupProperties, disableGeoip, flagKeysToEvaluate)).payloads;
    return payloads;
  }
  async getFeatureFlagsStateless(distinctId, groups = {}, personProperties = {}, groupProperties = {}, disableGeoip, flagKeysToEvaluate) {
    await this._initPromise;
    return await this.getFeatureFlagsAndPayloadsStateless(distinctId, groups, personProperties, groupProperties, disableGeoip, flagKeysToEvaluate);
  }
  async getFeatureFlagsAndPayloadsStateless(distinctId, groups = {}, personProperties = {}, groupProperties = {}, disableGeoip, flagKeysToEvaluate) {
    await this._initPromise;
    const featureFlagDetails = await this.getFeatureFlagDetailsStateless(distinctId, groups, personProperties, groupProperties, disableGeoip, flagKeysToEvaluate);
    if (!featureFlagDetails)
      return {
        flags: undefined,
        payloads: undefined,
        requestId: undefined
      };
    return {
      flags: featureFlagDetails.featureFlags,
      payloads: featureFlagDetails.featureFlagPayloads,
      requestId: featureFlagDetails.requestId
    };
  }
  async getFeatureFlagDetailsStateless(distinctId, groups = {}, personProperties = {}, groupProperties = {}, disableGeoip, flagKeysToEvaluate) {
    await this._initPromise;
    const extraPayload = {
      geoip_disable: disableGeoip ?? this.disableGeoip
    };
    if (flagKeysToEvaluate)
      extraPayload["flag_keys_to_evaluate"] = flagKeysToEvaluate;
    const result = await this.getFlags(distinctId, groups, personProperties, groupProperties, extraPayload);
    if (!result.success)
      return;
    const flagsResponse = result.response;
    if (flagsResponse.errorsWhileComputingFlags)
      console.error("[FEATURE FLAGS] Error while computing feature flags, some flags may be missing or incorrect. Learn more at https://posthog.com/docs/feature-flags/best-practices");
    if (flagsResponse.quotaLimited?.includes("feature_flags")) {
      console.warn("[FEATURE FLAGS] Feature flags quota limit exceeded - feature flags unavailable. Learn more about billing limits at https://posthog.com/docs/billing/limits-alerts");
      return {
        flags: {},
        featureFlags: {},
        featureFlagPayloads: {},
        requestId: flagsResponse?.requestId,
        quotaLimited: flagsResponse.quotaLimited
      };
    }
    return flagsResponse;
  }
  async getSurveysStateless() {
    await this._initPromise;
    if (this.disabled)
      return [];
    if (this.disableSurveys === true) {
      this._logger.info("Loading surveys is disabled.");
      return [];
    }
    const url = `${this.host}/api/surveys/?token=${this.apiKey}`;
    const fetchOptions = {
      method: "GET",
      headers: {
        ...this.getCustomHeaders(),
        "Content-Type": "application/json"
      }
    };
    const response = await this.fetchWithRetry(url, fetchOptions, {
      type: "required",
      consume: (response) => {
        if (response.status !== 200 || !response.json) {
          const msg = `Surveys API could not be loaded: ${response.status}`;
          const error = new Error(msg);
          this._logger.error(error);
          this._events.emit("error", new Error(msg));
          return Promise.resolve(undefined);
        }
        return response.json();
      }
    }).catch((error) => {
      this._logger.error("Surveys API could not be loaded", error);
      this._events.emit("error", error);
    });
    const newSurveys = response?.surveys;
    if (newSurveys)
      this._logger.info("Surveys fetched from API: ", JSON.stringify(newSurveys));
    return newSurveys ?? [];
  }
  get props() {
    if (!this._props)
      this._props = this.getPersistedProperty(types_PostHogPersistedProperty.Props);
    return this._props || {};
  }
  set props(val) {
    this._props = val;
  }
  async register(properties) {
    this.wrap(() => {
      this.props = {
        ...this.props,
        ...properties
      };
      this.setPersistedProperty(types_PostHogPersistedProperty.Props, this.props);
    });
  }
  async unregister(property) {
    this.wrap(() => {
      delete this.props[property];
      this.setPersistedProperty(types_PostHogPersistedProperty.Props, this.props);
    });
  }
  processBeforeEnqueue(message) {
    return message;
  }
  async flushStorage() {}
  getQueueRouteKey(_message) {
    return DEFAULT_QUEUE_ROUTE;
  }
  persistedQueueKeyForRoute(_route) {
    return types_PostHogPersistedProperty.Queue;
  }
  getActiveQueueRoutes() {
    return [
      DEFAULT_QUEUE_ROUTE
    ];
  }
  getRouteQueue(route) {
    return this.getPersistedProperty(this.persistedQueueKeyForRoute(route)) || [];
  }
  enqueue(type, _message, options, explicitRoute) {
    this.wrap(() => {
      if (this.optedOut)
        return void this._events.emit(type, "Library is disabled. Not sending event. To re-enable, call posthog.optIn()");
      let message = this.prepareMessage(_message, options);
      message = this.processBeforeEnqueue(message);
      if (message === null)
        return;
      message = this.normalizeMessage(message);
      const queueKey = this.persistedQueueKeyForRoute(explicitRoute ?? this.getQueueRouteKey(message));
      const queue = this.getPersistedProperty(queueKey) || [];
      if (queue.length >= this.maxQueueSize) {
        queue.shift();
        this._logger.warn("Queue is full, the oldest event is dropped.");
      }
      queue.push({
        message
      });
      this.setPersistedProperty(queueKey, queue);
      this._events.emit(type, message);
      if (queue.length >= this.flushAt)
        this.flushBackground();
      if (this.flushInterval && !this._flushTimer)
        this._flushTimer = safeSetTimeout(() => this.flushBackground(), this.flushInterval);
    });
  }
  async sendImmediate(type, _message, options, explicitRoute) {
    if (this.disabled)
      return void this._logger.warn("The client is disabled");
    if (!this._isInitialized)
      await this._initPromise;
    if (this.optedOut)
      return void this._events.emit(type, "Library is disabled. Not sending event. To re-enable, call posthog.optIn()");
    let message = this.prepareMessage(_message, options);
    message = this.processBeforeEnqueue(message);
    if (message === null)
      return;
    message = this.normalizeMessage(message);
    try {
      await this.sendBatch([
        message
      ], undefined, explicitRoute ?? this.getQueueRouteKey(message));
    } catch (err) {
      this._events.emit("error", err);
    }
  }
  normalizeMessage(message) {
    const { type: _type, library, library_version, ...sanitizedMessage } = message;
    let properties = isPostHogEventProperties(sanitizedMessage.properties) ? sanitizedMessage.properties : undefined;
    if (library !== undefined && properties?.$lib === undefined)
      properties = {
        ...properties || {},
        $lib: library
      };
    if (library_version !== undefined && properties?.$lib_version === undefined)
      properties = {
        ...properties || {},
        $lib_version: library_version
      };
    if (properties)
      sanitizedMessage.properties = properties;
    sanitizedMessage.uuid = getEventUuid(sanitizedMessage.uuid, uuidv7);
    return sanitizedMessage;
  }
  normalizeTimestampForWire(timestamp) {
    const parsedTimestamp = timestamp instanceof Date ? timestamp : typeof timestamp == "string" ? new Date(timestamp) : null;
    if (!parsedTimestamp || Number.isNaN(parsedTimestamp.getTime()))
      return timestamp;
    const normalized = parsedTimestamp.toISOString();
    const fractionalSeconds = typeof timestamp == "string" ? timestamp.match(/\.(\d+)(?:Z|[+-]\d{2}:?\d{2})?$/i)?.[1] : undefined;
    return fractionalSeconds && fractionalSeconds.length > 3 ? normalized.replace(/\.\d{3}Z$/, `.${fractionalSeconds}Z`) : normalized;
  }
  prepareMessage(_message, options) {
    const message = {
      ..._message,
      timestamp: options?.timestamp ? options?.timestamp : currentISOTime(),
      uuid: getEventUuid(options?.uuid, uuidv7)
    };
    const addGeoipDisableProperty = options?.disableGeoip ?? this.disableGeoip;
    if (addGeoipDisableProperty) {
      if (!isPostHogEventProperties(message.properties))
        message.properties = {};
      message.properties["$geoip_disable"] = true;
    }
    if (message.distinctId) {
      message.distinct_id = message.distinctId;
      delete message.distinctId;
    }
    return message;
  }
  clearFlushTimer() {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = undefined;
    }
  }
  flushBackground() {
    if (this.pendingFlushPromise)
      return;
    this.flush().catch(async (err) => {
      await logFlushError(err);
    });
  }
  async waitForPendingPromises(maxPromiseId, ignoredPromises = []) {
    const ignoredPendingPromises = ignoredPromises.filter((promise) => !!promise);
    let iteration = 0;
    while (true) {
      const promises = this.promiseQueue.getPromises([
        ...ignoredPendingPromises,
        ...this.flushPromises
      ], maxPromiseId);
      if (promises.length === 0)
        return;
      if (iteration > 0)
        this._logger.debug(`flush() re-checking ${promises.length} pending promise(s) before flushing`);
      await Promise.all(promises.map((promise) => promise.catch(() => {})));
      iteration++;
    }
  }
  flushWithPendingPromises() {
    return this.flushInternal(true);
  }
  flush() {
    return this.flushInternal(false);
  }
  flushInternal(waitForPendingPromises) {
    if (this.disabled)
      return Promise.resolve();
    if (!waitForPendingPromises && this.pendingFlushPromise)
      return this.pendingFlushPromise;
    const previousFlushPromise = this.flushPromise;
    const maxPromiseId = this.promiseQueue.maxId;
    const nextFlushPromise = Promise.resolve().then(() => {
      if (waitForPendingPromises)
        return this.waitForPendingPromises(maxPromiseId, [
          previousFlushPromise,
          nextFlushPromise
        ]);
    }).then(() => allSettled([
      previousFlushPromise
    ])).then(() => {
      if (this.pendingFlushPromise === nextFlushPromise)
        this.pendingFlushPromise = null;
      return this._flush();
    });
    this.pendingFlushPromise = nextFlushPromise;
    this.flushPromise = nextFlushPromise;
    this.flushPromises.add(nextFlushPromise);
    this.addPendingPromise(nextFlushPromise);
    allSettled([
      nextFlushPromise
    ]).then(() => {
      this.flushPromises.delete(nextFlushPromise);
      if (this.pendingFlushPromise === nextFlushPromise)
        this.pendingFlushPromise = null;
      if (this.flushPromise === nextFlushPromise)
        this.flushPromise = null;
    });
    return nextFlushPromise;
  }
  getCustomHeaders() {
    const customUserAgent = this.getCustomUserAgent();
    const headers = {};
    if (customUserAgent && customUserAgent !== "")
      headers["User-Agent"] = customUserAgent;
    return headers;
  }
  compressPayload(payload) {
    return gzipCompress(payload, this.isDebug);
  }
  getBatchEndpointPath(_route) {
    return "/batch/";
  }
  async sendBatch(batchMessages, retryOptions, route = DEFAULT_QUEUE_ROUTE) {
    const data = {
      api_key: this.apiKey,
      batch: batchMessages.map((message) => {
        if (!message)
          return message;
        const timestamp = this.normalizeTimestampForWire(message.timestamp);
        return timestamp === message.timestamp ? message : {
          ...message,
          timestamp
        };
      }),
      sent_at: currentISOTime()
    };
    if (this.historicalMigration)
      data.historical_migration = true;
    const payload = safeJsonStringify(data);
    const url = `${this.host}${this.getBatchEndpointPath(route)}`;
    const gzippedPayload = this.disableCompression ? null : await this.compressPayload(payload);
    const fetchOptions = {
      method: "POST",
      headers: {
        ...this.getCustomHeaders(),
        "Content-Type": "application/json",
        ...gzippedPayload !== null && {
          "Content-Encoding": "gzip"
        }
      },
      body: gzippedPayload || payload
    };
    await this.fetchWithRetry(url, fetchOptions, {
      type: "successful-write"
    }, retryOptions);
  }
  async _flush() {
    this.clearFlushTimer();
    await this._initPromise;
    const routes = this.getActiveQueueRoutes();
    if (!routes.some((route) => this.getRouteQueue(route).length > 0))
      return;
    const sentMessages = [];
    let firstError;
    for (const route of routes)
      try {
        await this._flushRoute(route, sentMessages);
      } catch (err) {
        if (firstError === undefined)
          firstError = err;
      }
    if (firstError !== undefined)
      throw firstError;
    this._events.emit("flush", sentMessages);
  }
  async _flushRoute(route, sentMessages) {
    const queueKey = this.persistedQueueKeyForRoute(route);
    let queue = this.getPersistedProperty(queueKey) || [];
    if (!queue.length)
      return;
    const originalQueueLength = queue.length;
    let sentFromRoute = 0;
    while (queue.length > 0 && sentFromRoute < originalQueueLength) {
      const batchItems = queue.slice(0, this.maxBatchSize);
      const batchMessages = batchItems.map((item) => item.message === undefined ? item.message : this.normalizeMessage(item.message));
      const persistQueueChange = async () => {
        const refreshedQueue = this.getPersistedProperty(queueKey) || [];
        const remainingBatchItems = [
          ...batchItems
        ];
        const newQueue = refreshedQueue.filter((item) => {
          const itemUuid = item.message?.uuid;
          const batchItemIndex = remainingBatchItems.findIndex((batchItem) => batchItem === item || typeof itemUuid == "string" && itemUuid.length > 0 && batchItem.message?.uuid === itemUuid);
          if (batchItemIndex === -1)
            return true;
          remainingBatchItems.splice(batchItemIndex, 1);
          return false;
        });
        this.setPersistedProperty(queueKey, newQueue);
        queue = newQueue;
        this._dequeuedMessagesCount += batchItems.length;
        await this.flushStorage();
      };
      const retryOptions = {
        retryCheck: (err) => {
          if (isPostHogFetchContentTooLargeError(err))
            return false;
          return isPostHogFetchRetryableError(err);
        }
      };
      try {
        await this.sendBatch(batchMessages, retryOptions, route);
      } catch (err) {
        if (isPostHogFetchContentTooLargeError(err) && batchMessages.length > 1) {
          this.maxBatchSize = Math.max(1, Math.floor(batchMessages.length / 2));
          this._logger.warn(`Received 413 when sending batch of size ${batchMessages.length}, reducing batch size to ${this.maxBatchSize}`);
          continue;
        }
        if (!(err instanceof PostHogFetchNetworkError))
          await persistQueueChange();
        this._events.emit("error", err);
        throw err;
      }
      await persistQueueChange();
      sentMessages.push(...batchMessages);
      sentFromRoute += batchMessages.length;
    }
  }
  async _sendLogsBatch(payload) {
    if (this.disabled)
      return {
        kind: "fatal",
        error: new Error("The client is disabled")
      };
    const serialized = JSON.stringify(payload);
    const url = `${this.host}/i/v1/logs?token=${encodeURIComponent(this.apiKey)}`;
    const gzippedPayload = this.disableCompression ? null : await this.compressPayload(serialized);
    const fetchOptions = {
      method: "POST",
      headers: {
        ...this.getCustomHeaders(),
        "Content-Type": "application/json",
        ...gzippedPayload !== null && {
          "Content-Encoding": "gzip"
        }
      },
      body: gzippedPayload || serialized
    };
    try {
      await this.fetchWithRetry(url, fetchOptions, {
        type: "successful-write"
      }, {
        retryCheck: (err) => {
          if (isPostHogFetchContentTooLargeError(err))
            return false;
          return isPostHogFetchRetryableError(err);
        }
      });
      return {
        kind: "ok"
      };
    } catch (err) {
      if (isPostHogFetchContentTooLargeError(err))
        return {
          kind: "too-large"
        };
      if (err instanceof PostHogFetchNetworkError)
        return {
          kind: "retry-later",
          error: err
        };
      return {
        kind: "fatal",
        error: err
      };
    }
  }
  async _sendMetricsBatch(payload) {
    if (this.disabled)
      return {
        kind: "fatal",
        error: new Error("The client is disabled")
      };
    const serialized = JSON.stringify(payload);
    const url = `${this.host}/i/v1/metrics?token=${encodeURIComponent(this.apiKey)}`;
    const gzippedPayload = this.disableCompression ? null : await this.compressPayload(serialized);
    const fetchOptions = {
      method: "POST",
      headers: {
        ...this.getCustomHeaders(),
        "Content-Type": "application/json",
        ...gzippedPayload !== null && {
          "Content-Encoding": "gzip"
        }
      },
      body: gzippedPayload || serialized
    };
    try {
      await this.fetchWithRetry(url, fetchOptions, {
        type: "successful-write"
      }, {
        retryCheck: (err) => {
          if (isPostHogFetchContentTooLargeError(err))
            return false;
          return isPostHogFetchRetryableError(err);
        }
      });
      return {
        kind: "ok"
      };
    } catch (err) {
      if (isPostHogFetchContentTooLargeError(err))
        return {
          kind: "too-large"
        };
      if (isPostHogFetchRetryableError(err))
        return {
          kind: "retry-later",
          error: err
        };
      return {
        kind: "fatal",
        error: err
      };
    }
  }
  async fetchWithRetry(url, options, responseHandling, retryOptions, requestTimeout) {
    const body = options.body ? options.body : "";
    let reqByteLength = -1;
    try {
      reqByteLength = body instanceof Blob ? body.size : body instanceof Uint8Array ? body.byteLength : Buffer.byteLength(body, STRING_FORMAT);
    } catch {
      if (body instanceof Blob)
        reqByteLength = body.size;
      else if (body instanceof Uint8Array)
        reqByteLength = body.byteLength;
      else {
        const encoded = new TextEncoder().encode(body);
        reqByteLength = encoded.length;
      }
    }
    const retriableOptions = {
      ...this._retryOptions,
      ...retryOptions
    };
    let attempt = 0;
    return await retriable(async () => {
      attempt++;
      const ctrl = new AbortController;
      const timeoutMs = requestTimeout ?? this.requestTimeout;
      const requestDeadline = Date.now() + timeoutMs;
      let timer;
      const deadline = new Promise((_resolve, reject) => {
        timer = safeSetTimeout(() => {
          const timeoutError = new Error(`Request timed out after ${timeoutMs}ms`);
          timeoutError.name = "AbortError";
          reject(timeoutError);
          ctrl.abort(timeoutError);
        }, timeoutMs);
      });
      let res;
      let responseAccepted = false;
      let cancellation;
      const cancelBody = () => cancellation ??= (async () => {
        try {
          await res?.body?.cancel();
        } catch {}
      })();
      try {
        let fetchPromise;
        try {
          fetchPromise = this.fetch(url, {
            signal: ctrl.signal,
            ...options
          });
        } catch (e) {
          throw new PostHogFetchNetworkError(e);
        }
        fetchPromise.then((lateResponse) => {
          if (ctrl.signal.aborted && !responseAccepted)
            Promise.resolve(lateResponse.body?.cancel()).catch(() => {});
        }).catch(() => {});
        try {
          res = await Promise.race([
            fetchPromise,
            deadline
          ]);
          responseAccepted = true;
        } catch (e) {
          throw new PostHogFetchNetworkError(e);
        }
        const isNoCors = options.mode === "no-cors";
        if (!isNoCors && (res.status < 200 || res.status >= 400))
          throw new PostHogFetchHttpError(res, reqByteLength, requestDeadline, ctrl);
        if (responseHandling.type === "successful-write") {
          try {
            await Promise.race([
              cancelBody(),
              deadline
            ]);
          } catch {}
          return;
        }
        try {
          return await Promise.race([
            responseHandling.consume(res),
            deadline
          ]);
        } catch (e) {
          if (ctrl.signal.aborted)
            throw new PostHogFetchNetworkError(e);
          throw e;
        }
      } finally {
        clearTimeout(timer);
        if (ctrl.signal.aborted && res)
          cancelBody();
      }
    }, {
      ...retriableOptions,
      retryCheck: (error) => {
        const shouldRetry = retriableOptions.retryCheck(error);
        if (shouldRetry && attempt <= retriableOptions.retryCount && error instanceof PostHogFetchHttpError)
          error.cancelResponseBody();
        return shouldRetry;
      }
    });
  }
  async _shutdown(shutdownTimeoutMs = 30000) {
    await this._initPromise;
    let hasTimedOut = false;
    this.clearFlushTimer();
    if (this.disabled)
      return;
    const doShutdown = async () => {
      try {
        await this.promiseQueue.join();
        while (true) {
          const hasQueuedEvents = this.getActiveQueueRoutes().some((route) => this.getRouteQueue(route).length > 0);
          if (!hasQueuedEvents)
            break;
          const dequeuedBeforeFlush = this._dequeuedMessagesCount;
          await this.flush();
          if (hasTimedOut)
            break;
          if (this._dequeuedMessagesCount === dequeuedBeforeFlush) {
            this._logger.warn("Shutdown flush completed but did not send any queued events. Stopping drain to avoid a loop.");
            break;
          }
        }
      } catch (e) {
        if (!isPostHogFetchError(e))
          throw e;
        await logFlushError(e);
      }
    };
    return raceWithTimeout(doShutdown(), shutdownTimeoutMs, () => {
      this._logger.critical("Timeout while shutting down PostHog. Some events may not have been sent.", {
        shutdownTimeoutMs
      });
      hasTimedOut = true;
    });
  }
  async shutdown(shutdownTimeoutMs = 30000) {
    if (this.shutdownPromise)
      this._logger.warn("shutdown() called while already shutting down. shutdown() is meant to be called once before process exit - use flush() for per-request cleanup");
    else
      this.shutdownPromise = this._shutdown(shutdownTimeoutMs).finally(() => {
        this.shutdownPromise = null;
      });
    return this.shutdownPromise;
  }
}
var PostHogFetchHttpError, PostHogFetchNetworkError, applyCallerFeatureFlagOverrides = (target, callerProperties) => {
  for (const key of Object.keys(callerProperties))
    if (key.startsWith("$feature/") || key === "$active_feature_flags")
      target[key] = callerProperties[key];
}, DEFAULT_QUEUE_ROUTE = "default";
var init_posthog_core_stateless = __esm(() => {
  init_eventemitter();
  init_featureFlagUtils();
  init_gzip();
  init_types();
  init_utils();
  init_uuidv7();
  init_error_tracking();
  PostHogFetchHttpError = class PostHogFetchHttpError extends Error {
    constructor(response, reqByteLength, responseBodyDeadline, abortController) {
      super("HTTP error while fetching PostHog: status=" + response.status + ", reqByteLength=" + reqByteLength), this.response = response, this.reqByteLength = reqByteLength, this.responseBodyDeadline = responseBodyDeadline, this.abortController = abortController, this.name = "PostHogFetchHttpError", this._bodyReadTimedOut = false;
    }
    get status() {
      return this.response.status;
    }
    get bodyReadTimedOut() {
      return this._bodyReadTimedOut;
    }
    get text() {
      if (!this.responseBodyTextPromise)
        if (Date.now() >= this.responseBodyDeadline) {
          this._bodyReadTimedOut = true;
          const timeoutError = new Error("Response body read timed out");
          timeoutError.name = "AbortError";
          this.cancelResponseBody(timeoutError);
          this.responseBodyTextPromise = Promise.reject(timeoutError);
        } else {
          const responseBodyTimeout = new Promise((_resolve, reject) => {
            this.responseBodyTimer = safeSetTimeout(() => {
              this._bodyReadTimedOut = true;
              const timeoutError = new Error("Response body read timed out");
              timeoutError.name = "AbortError";
              reject(timeoutError);
              this.cancelResponseBody(timeoutError);
            }, this.responseBodyDeadline - Date.now());
          });
          let responseBodyText;
          try {
            responseBodyText = Promise.resolve(this.response.text());
          } catch (error) {
            responseBodyText = Promise.reject(error);
          }
          this.responseBodyTextPromise = Promise.race([
            responseBodyText,
            responseBodyTimeout
          ]).finally(() => clearTimeout(this.responseBodyTimer));
        }
      return this.responseBodyTextPromise;
    }
    get json() {
      return this.text.then((text) => JSON.parse(text));
    }
    cancelResponseBody(reason) {
      clearTimeout(this.responseBodyTimer);
      if (!this.abortController.signal.aborted)
        this.abortController.abort(reason);
      (async () => {
        try {
          await this.response.body?.cancel();
        } catch {}
      })();
    }
  };
  PostHogFetchNetworkError = class PostHogFetchNetworkError extends Error {
    constructor(error) {
      super("Network error while fetching PostHog", error instanceof Error ? {
        cause: error
      } : {}), this.error = error, this.name = "PostHogFetchNetworkError";
    }
  };
});

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/posthog-core.mjs
var init_posthog_core = __esm(() => {
  init_featureFlagUtils();
  init_types();
  init_posthog_core_stateless();
  init_uuidv7();
  init_utils();
});

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/tracing-headers.mjs
var init_tracing_headers = __esm(() => {
  init_type_utils();
});

// node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/index.mjs
var init_dist = __esm(() => {
  init_featureFlagUtils();
  init_gzip();
  init_logs_utils();
  init_logs();
  init_metrics();
  init_uuidv7();
  init_validation();
  init_error_tracking();
  init_utils();
  init_cookie();
  init_posthog_core();
  init_posthog_core_stateless();
  init_tracing_headers();
  init_types();
});

// node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/extensions/error-tracking/modifiers/context-lines.node.mjs
import { constants as constants2 } from "node:fs";
import { open as promises_open } from "node:fs/promises";
import { isAbsolute as isAbsolute7 } from "node:path";
import { createInterface } from "node:readline";
async function addSourceContext(frames, openSourceFile = promises_open, logger) {
  const filesToLines = {};
  let basePath;
  try {
    basePath = process.cwd();
  } catch {}
  for (let i = frames.length - 1;i >= 0; i--) {
    const frame = frames[i];
    const filename = frame?.filename;
    if (!frame || typeof filename != "string" || typeof frame.lineno != "number" || shouldSkipContextLinesForFile(filename) || shouldSkipContextLinesForFrame(frame))
      continue;
    if (!isAbsolute7(filename) && basePath === undefined)
      continue;
    const filesToLinesOutput = filesToLines[filename];
    if (!filesToLinesOutput)
      filesToLines[filename] = [];
    filesToLines[filename].push(frame.lineno);
  }
  const files = Object.keys(filesToLines);
  if (files.length == 0)
    return frames;
  const readlinePromises = [];
  for (const file of files) {
    const cacheKey = makeSourceCacheKey(file, basePath);
    if (cacheKey === undefined)
      continue;
    if (LRU_FILE_CONTENTS_FS_READ_FAILED.get(cacheKey))
      continue;
    const filesToLineRanges = filesToLines[file];
    if (!filesToLineRanges)
      continue;
    filesToLineRanges.sort((a, b) => a - b);
    const ranges = makeLineReaderRanges(filesToLineRanges);
    if (ranges.every((r) => rangeExistsInContentCache(cacheKey, r)))
      continue;
    const cache = emplace(LRU_FILE_CONTENTS_CACHE, cacheKey, {});
    readlinePromises.push(getContextLinesFromFile(file, ranges, cache, cacheKey, openSourceFile, logger));
  }
  await Promise.all(readlinePromises).catch(() => {});
  if (frames && frames.length > 0)
    addSourceContextToFrames(frames, LRU_FILE_CONTENTS_CACHE, basePath);
  LRU_FILE_CONTENTS_CACHE.reduce();
  return frames;
}
async function openRegularSourceFile(path, openSourceFile, logger) {
  let fileHandle;
  let isValid = false;
  try {
    fileHandle = await openSourceFile(path, constants2.O_RDONLY | constants2.O_NONBLOCK);
    const fileStat = await fileHandle.stat();
    if (!fileStat.isFile())
      return;
    if (fileStat.size > MAX_CONTEXTLINES_FILE_SIZE)
      return void logger?.debug(`Skipping source context for oversized file ${path}: ${fileStat.size} bytes exceeds ${MAX_CONTEXTLINES_FILE_SIZE}`);
    isValid = true;
    return fileHandle;
  } catch {
    return;
  } finally {
    if (fileHandle && !isValid)
      await fileHandle.close().catch(() => {});
  }
}
async function getContextLinesFromFile(path, ranges, output, cacheKey, openSourceFile, logger) {
  const fileHandle = await openRegularSourceFile(path, openSourceFile, logger);
  if (fileHandle === undefined)
    return void LRU_FILE_CONTENTS_FS_READ_FAILED.set(cacheKey, 1);
  const openedFileHandle = fileHandle;
  return new Promise((resolve) => {
    let finished = false;
    function destroyStreamAndResolve(stream) {
      if (finished)
        return;
      finished = true;
      stream?.destroy();
      openedFileHandle.close().then(resolve, resolve);
    }
    let stream;
    try {
      stream = openedFileHandle.createReadStream({
        autoClose: false,
        start: 0,
        end: MAX_CONTEXTLINES_FILE_SIZE - 1
      });
    } catch {
      LRU_FILE_CONTENTS_FS_READ_FAILED.set(cacheKey, 1);
      destroyStreamAndResolve();
      return;
    }
    let lineReaded;
    try {
      lineReaded = createInterface({
        input: stream
      });
    } catch {
      LRU_FILE_CONTENTS_FS_READ_FAILED.set(cacheKey, 1);
      destroyStreamAndResolve(stream);
      return;
    }
    let lineNumber = 0;
    let currentRangeIndex = 0;
    const range = ranges[currentRangeIndex];
    if (range === undefined)
      return void destroyStreamAndResolve(stream);
    let rangeStart = range[0];
    let rangeEnd = range[1];
    function onStreamError() {
      LRU_FILE_CONTENTS_FS_READ_FAILED.set(cacheKey, 1);
      lineReaded.close();
      lineReaded.removeAllListeners();
      destroyStreamAndResolve(stream);
    }
    stream.on("error", onStreamError);
    lineReaded.on("error", onStreamError);
    lineReaded.on("close", () => destroyStreamAndResolve(stream));
    lineReaded.on("line", (line) => {
      lineNumber++;
      if (lineNumber < rangeStart)
        return;
      output[lineNumber] = snipLine(line, 0);
      if (lineNumber >= rangeEnd) {
        if (currentRangeIndex === ranges.length - 1) {
          lineReaded.close();
          lineReaded.removeAllListeners();
          return;
        }
        currentRangeIndex++;
        const range = ranges[currentRangeIndex];
        if (range === undefined) {
          lineReaded.close();
          lineReaded.removeAllListeners();
          return;
        }
        rangeStart = range[0];
        rangeEnd = range[1];
      }
    });
  });
}
function addSourceContextToFrames(frames, cache, basePath) {
  for (const frame of frames)
    if (frame.filename && frame.context_line === undefined && typeof frame.lineno == "number") {
      const cacheKey = makeSourceCacheKey(frame.filename, basePath);
      const contents = cacheKey === undefined ? undefined : cache.get(cacheKey);
      if (contents === undefined)
        continue;
      addContextToFrame(frame.lineno, frame, contents);
    }
}
function addContextToFrame(lineno, frame, contents) {
  if (frame.lineno === undefined || contents === undefined)
    return;
  frame.pre_context = [];
  for (let i = makeRangeStart(lineno);i < lineno; i++) {
    const line = contents[i];
    if (line === undefined)
      return void clearLineContext(frame);
    frame.pre_context.push(line);
  }
  if (contents[lineno] === undefined)
    return void clearLineContext(frame);
  frame.context_line = contents[lineno];
  const end = makeRangeEnd(lineno);
  frame.post_context = [];
  for (let i = lineno + 1;i <= end; i++) {
    const line = contents[i];
    if (line === undefined)
      break;
    frame.post_context.push(line);
  }
}
function clearLineContext(frame) {
  delete frame.pre_context;
  delete frame.context_line;
  delete frame.post_context;
}
function shouldSkipContextLinesForFile(path) {
  return path.startsWith("node:") || path.endsWith(".min.js") || path.endsWith(".min.cjs") || path.endsWith(".min.mjs") || path.startsWith("data:");
}
function shouldSkipContextLinesForFrame(frame) {
  if (frame.lineno !== undefined && frame.lineno > MAX_CONTEXTLINES_LINENO)
    return true;
  if (frame.colno !== undefined && frame.colno > MAX_CONTEXTLINES_COLNO)
    return true;
  return false;
}
function makeSourceCacheKey(path, basePath) {
  if (isAbsolute7(path))
    return JSON.stringify([
      null,
      path
    ]);
  return basePath === undefined ? undefined : JSON.stringify([
    basePath,
    path
  ]);
}
function rangeExistsInContentCache(cacheKey, range) {
  const contents = LRU_FILE_CONTENTS_CACHE.get(cacheKey);
  if (contents === undefined)
    return false;
  for (let i = range[0];i <= range[1]; i++)
    if (contents[i] === undefined)
      return false;
  return true;
}
function makeLineReaderRanges(lines) {
  if (!lines.length)
    return [];
  let i = 0;
  const line = lines[0];
  if (typeof line != "number")
    return [];
  let current = makeContextRange(line);
  const out = [];
  while (true) {
    if (i === lines.length - 1) {
      out.push(current);
      break;
    }
    const next = lines[i + 1];
    if (typeof next != "number")
      break;
    if (next <= current[1])
      current[1] = next + DEFAULT_LINES_OF_CONTEXT;
    else {
      out.push(current);
      current = makeContextRange(next);
    }
    i++;
  }
  return out;
}
function makeContextRange(line) {
  return [
    makeRangeStart(line),
    makeRangeEnd(line)
  ];
}
function makeRangeStart(line) {
  return Math.max(1, line - DEFAULT_LINES_OF_CONTEXT);
}
function makeRangeEnd(line) {
  return line + DEFAULT_LINES_OF_CONTEXT;
}
function emplace(map, key, contents) {
  const value = map.get(key);
  if (value === undefined) {
    map.set(key, contents);
    return contents;
  }
  return value;
}
function snipLine(line, colno) {
  let newLine = line;
  const lineLength = newLine.length;
  if (lineLength <= 150)
    return newLine;
  if (colno > lineLength)
    colno = lineLength;
  let start = Math.max(colno - 60, 0);
  if (start < 5)
    start = 0;
  let end = Math.min(start + 140, lineLength);
  if (end > lineLength - 5)
    end = lineLength;
  if (end === lineLength)
    start = Math.max(end - 140, 0);
  newLine = newLine.slice(start, end);
  if (start > 0)
    newLine = `...${newLine}`;
  if (end < lineLength)
    newLine += "...";
  return newLine;
}
var LRU_FILE_CONTENTS_CACHE, LRU_FILE_CONTENTS_FS_READ_FAILED, DEFAULT_LINES_OF_CONTEXT = 7, MAX_CONTEXTLINES_COLNO = 1000, MAX_CONTEXTLINES_LINENO = 1e4, MAX_CONTEXTLINES_FILE_SIZE = 10485760;
var init_context_lines_node = __esm(() => {
  init_dist();
  LRU_FILE_CONTENTS_CACHE = new ReduceableCache(25);
  LRU_FILE_CONTENTS_FS_READ_FAILED = new ReduceableCache(20);
});

// node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/extensions/error-tracking/modifiers/relative-path.node.mjs
import { isAbsolute as isAbsolute8, relative as relative4, sep as sep8 } from "node:path";
function createRelativePathModifier(basePath = process.cwd()) {
  const isWindows = sep8 === "\\";
  const toUnix = (p) => isWindows ? p.replace(/\\/g, "/") : p;
  const normalizedBase = toUnix(basePath);
  return async (frames) => {
    for (const frame of frames)
      if (!(!frame.filename || frame.filename.startsWith("node:") || frame.filename.startsWith("data:"))) {
        if (isAbsolute8(frame.filename))
          frame.filename = toUnix(relative4(normalizedBase, toUnix(frame.filename)));
      }
    return frames;
  };
}
var init_relative_path_node = () => {};

// node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/version.mjs
var version2 = "5.51.1";
var init_version = () => {};

// node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/types.mjs
var FeatureFlagError2;
var init_types3 = __esm(() => {
  FeatureFlagError2 = {
    ERRORS_WHILE_COMPUTING: "errors_while_computing_flags",
    FLAG_MISSING: "flag_missing",
    QUOTA_LIMITED: "quota_limited",
    UNKNOWN_ERROR: "unknown_error"
  };
});

// node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/feature-flag-evaluations.mjs
class FeatureFlagEvaluations {
  constructor(init) {
    this._host = init.host;
    this._distinctId = init.distinctId;
    this._groups = init.groups;
    this._disableGeoip = init.disableGeoip;
    this._flags = init.flags;
    this._requestId = init.requestId;
    this._evaluatedAt = init.evaluatedAt;
    this._flagDefinitionsLoadedAt = init.flagDefinitionsLoadedAt;
    this._errorsWhileComputing = init.errorsWhileComputing ?? false;
    this._quotaLimited = init.quotaLimited ?? false;
    this._accessed = init.accessed ?? new Set;
    this._isSlice = init.isSlice ?? false;
  }
  isEnabled(key, options = {}) {
    const flag = this._flags[key];
    this._recordAccess(key);
    return flag?.enabled ?? options.defaultValue ?? false;
  }
  getFlag(key) {
    const flag = this._flags[key];
    this._recordAccess(key);
    if (!flag)
      return;
    if (!flag.enabled)
      return false;
    return flag.variant ?? true;
  }
  getFlagPayload(key) {
    return this._flags[key]?.payload;
  }
  onlyAccessed() {
    const filtered = {};
    for (const key of this._accessed) {
      const flag = this._flags[key];
      if (flag)
        filtered[key] = flag;
    }
    return this._cloneWith(filtered);
  }
  only(keys) {
    const filtered = {};
    const missing = [];
    for (const key of keys) {
      const flag = this._flags[key];
      if (flag)
        filtered[key] = flag;
      else
        missing.push(key);
    }
    if (missing.length > 0)
      this._host.logWarning(`FeatureFlagEvaluations.only() was called with flag keys that are not in the evaluation set and will be dropped: ${missing.join(", ")}`);
    return this._cloneWith(filtered);
  }
  get keys() {
    return Object.keys(this._flags);
  }
  _getEventProperties() {
    const properties = {};
    const activeFlags = [];
    for (const [key, flag] of Object.entries(this._flags)) {
      const value = flag.enabled === false ? false : flag.variant ?? true;
      properties[`$feature/${key}`] = value;
      if (flag.enabled)
        activeFlags.push(key);
    }
    if (activeFlags.length > 0) {
      activeFlags.sort();
      properties["$active_feature_flags"] = activeFlags;
    }
    return properties;
  }
  _cloneWith(flags) {
    return new FeatureFlagEvaluations({
      host: this._host,
      distinctId: this._distinctId,
      groups: this._groups,
      disableGeoip: this._disableGeoip,
      flags,
      requestId: this._requestId,
      evaluatedAt: this._evaluatedAt,
      flagDefinitionsLoadedAt: this._flagDefinitionsLoadedAt,
      errorsWhileComputing: this._errorsWhileComputing,
      quotaLimited: this._quotaLimited,
      accessed: new Set(this._accessed),
      isSlice: true
    });
  }
  _recordAccess(key) {
    this._accessed.add(key);
    if (this._distinctId === "")
      return;
    if (this._isSlice && !(key in this._flags))
      return;
    const flag = this._flags[key];
    const response = flag === undefined ? undefined : flag.enabled === false ? false : flag.variant ?? true;
    const properties = {
      $feature_flag: key,
      $feature_flag_response: response,
      $feature_flag_id: flag?.id,
      $feature_flag_version: flag?.version,
      $feature_flag_reason: flag?.reason,
      locally_evaluated: flag?.locallyEvaluated ?? false,
      [`$feature/${key}`]: response,
      $feature_flag_request_id: this._requestId,
      $feature_flag_evaluated_at: flag?.locallyEvaluated ? Date.now() : this._evaluatedAt
    };
    if (flag?.hasExperiment !== undefined)
      properties.$feature_flag_has_experiment = flag.hasExperiment;
    if (flag?.locallyEvaluated && this._flagDefinitionsLoadedAt !== undefined)
      properties.$feature_flag_definitions_loaded_at = this._flagDefinitionsLoadedAt;
    const errors = [];
    if (this._errorsWhileComputing)
      errors.push(FeatureFlagError2.ERRORS_WHILE_COMPUTING);
    if (this._quotaLimited)
      errors.push(FeatureFlagError2.QUOTA_LIMITED);
    if (flag === undefined)
      errors.push(FeatureFlagError2.FLAG_MISSING);
    if (errors.length > 0)
      properties.$feature_flag_error = errors.join(",");
    this._host.captureFlagCalledEventIfNeeded({
      distinctId: this._distinctId,
      key,
      response,
      groups: this._groups,
      disableGeoip: this._disableGeoip,
      properties
    });
  }
}
var init_feature_flag_evaluations = __esm(() => {
  init_types3();
});

// node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/extensions/feature-flags/crypto.mjs
async function hashSHA1(text) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle)
    throw new Error("SubtleCrypto API not available");
  const hashBuffer = await subtle.digest("SHA-1", new TextEncoder().encode(text));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
var init_crypto = () => {};

// node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/extensions/feature-flags/feature-flags.mjs
function setCustomErrorPrototype(error, constructor) {
  error.name = constructor.name;
  Error.captureStackTrace(error, constructor);
  Object.setPrototypeOf(error, constructor.prototype);
}

class FeatureFlagsPoller {
  constructor({ pollingInterval, personalApiKey, projectApiKey, timeout, host, customHeaders, ...options }) {
    this.debugMode = false;
    this.shouldBeginExponentialBackoff = false;
    this.backOffCount = 0;
    this.pollerStopped = false;
    this.pollingInterval = pollingInterval;
    this.personalApiKey = personalApiKey;
    this.featureFlags = [];
    this.featureFlagsByKey = {};
    this.groupTypeMapping = {};
    this.cohorts = {};
    this.loadedSuccessfullyOnce = false;
    this.timeout = timeout;
    this.projectApiKey = projectApiKey;
    this.host = host;
    this.poller = undefined;
    this.fetch = options.fetch || fetch;
    this.onError = options.onError;
    this.customHeaders = customHeaders;
    this.onLoad = options.onLoad;
    this.onMinimalFlagCalledEvents = options.onMinimalFlagCalledEvents;
    this.cacheProvider = options.cacheProvider;
    this.strictLocalEvaluation = options.strictLocalEvaluation ?? false;
    this.loadFeatureFlags();
  }
  debug(enabled = true) {
    this.debugMode = enabled;
  }
  logMsgIfDebug(fn) {
    if (this.debugMode)
      fn();
  }
  createEvaluationContext(distinctId, groups = {}, personProperties = {}, groupProperties = {}, evaluationCache = {}) {
    return {
      distinctId,
      groups,
      personProperties,
      groupProperties,
      evaluationCache
    };
  }
  async getFeatureFlag(key, distinctId, groups = {}, personProperties = {}, groupProperties = {}) {
    await this.loadFeatureFlags();
    let response;
    let featureFlag;
    if (!this.loadedSuccessfullyOnce)
      return response;
    featureFlag = this.featureFlagsByKey[key];
    if (featureFlag !== undefined) {
      const evaluationContext = this.createEvaluationContext(distinctId, groups, personProperties, groupProperties);
      try {
        const result = await this.computeFlagAndPayloadLocally(featureFlag, evaluationContext);
        response = result.value;
        this.logMsgIfDebug(() => console.debug(`Successfully computed flag locally: ${key} -> ${response}`));
      } catch (e) {
        if (e instanceof RequiresServerEvaluation || e instanceof InconclusiveMatchError)
          this.logMsgIfDebug(() => console.debug(`${e.name} when computing flag locally: ${key}: ${e.message}`));
        else if (e instanceof Error)
          this.onError?.(new Error(`Error computing flag locally: ${key}: ${e}`));
      }
    }
    return response;
  }
  async getAllFlagsAndPayloads(evaluationContext, flagKeysToExplicitlyEvaluate) {
    await this.loadFeatureFlags();
    const response = {};
    const payloads = {};
    let fallbackToFlags = this.featureFlags.length == 0;
    const flagsToEvaluate = flagKeysToExplicitlyEvaluate ? flagKeysToExplicitlyEvaluate.map((key) => this.featureFlagsByKey[key]).filter(Boolean) : this.featureFlags;
    const sharedEvaluationContext = {
      ...evaluationContext,
      evaluationCache: evaluationContext.evaluationCache ?? {}
    };
    await Promise.all(flagsToEvaluate.map(async (flag) => {
      try {
        const { value: matchValue, payload: matchPayload } = await this.computeFlagAndPayloadLocally(flag, sharedEvaluationContext);
        response[flag.key] = matchValue;
        if (matchPayload)
          payloads[flag.key] = matchPayload;
      } catch (e) {
        if (e instanceof RequiresServerEvaluation || e instanceof InconclusiveMatchError)
          this.logMsgIfDebug(() => console.debug(`${e.name} when computing flag locally: ${flag.key}: ${e.message}`));
        else if (e instanceof Error)
          this.onError?.(new Error(`Error computing flag locally: ${flag.key}: ${e}`));
        fallbackToFlags = true;
      }
    }));
    return {
      response,
      payloads,
      fallbackToFlags
    };
  }
  async computeFlagAndPayloadLocally(flag, evaluationContext, options = {}) {
    const { matchValue, skipLoadCheck = false } = options;
    if (!skipLoadCheck)
      await this.loadFeatureFlags();
    if (!this.loadedSuccessfullyOnce)
      return {
        value: false,
        payload: null
      };
    let flagValue;
    flagValue = matchValue !== undefined ? matchValue : await this.computeFlagValueLocally(flag, evaluationContext);
    const payload = this.getFeatureFlagPayload(flag.key, flagValue);
    return {
      value: flagValue,
      payload
    };
  }
  async computeFlagValueLocally(flag, evaluationContext) {
    const { distinctId, groups, personProperties, groupProperties } = evaluationContext;
    if (!flag.active)
      return false;
    if (flag.ensure_experience_continuity)
      throw new InconclusiveMatchError("Flag has experience continuity enabled");
    const flagFilters = flag.filters || {};
    const aggregation_group_type_index = flagFilters.aggregation_group_type_index;
    if (aggregation_group_type_index != null) {
      const groupName = this.groupTypeMapping[String(aggregation_group_type_index)];
      if (!groupName) {
        this.logMsgIfDebug(() => console.warn(`[FEATURE FLAGS] Unknown group type index ${aggregation_group_type_index} for feature flag ${flag.key}`));
        throw new InconclusiveMatchError("Flag has unknown group type index");
      }
      if (!(groupName in groups)) {
        this.logMsgIfDebug(() => console.warn(`[FEATURE FLAGS] Can't compute group feature flag: ${flag.key} without group names passed in`));
        return false;
      }
      if (flag.bucketing_identifier === "device_id" && (personProperties?.$device_id === undefined || personProperties?.$device_id === null || personProperties?.$device_id === ""))
        this.logMsgIfDebug(() => console.warn(`[FEATURE FLAGS] Ignoring bucketing_identifier for group flag: ${flag.key}`));
      const focusedGroupProperties = groupProperties[groupName];
      return await this.matchFeatureFlagProperties(flag, groups[groupName], focusedGroupProperties, evaluationContext);
    }
    {
      const bucketingValue = this.getBucketingValueForFlag(flag, distinctId, personProperties);
      if (bucketingValue === undefined) {
        this.logMsgIfDebug(() => console.warn(`[FEATURE FLAGS] Can't compute feature flag: ${flag.key} without $device_id, falling back to server evaluation`));
        throw new InconclusiveMatchError(`Can't compute feature flag: ${flag.key} without $device_id`);
      }
      return await this.matchFeatureFlagProperties(flag, bucketingValue, personProperties, evaluationContext);
    }
  }
  getBucketingValueForFlag(flag, distinctId, properties) {
    if (flag.filters?.aggregation_group_type_index != null)
      return distinctId;
    if (flag.bucketing_identifier === "device_id") {
      const deviceId = properties?.$device_id;
      if (deviceId == null || deviceId === "")
        return;
      return deviceId;
    }
    return distinctId;
  }
  getFeatureFlagPayload(key, flagValue) {
    let payload = null;
    if (flagValue !== false && flagValue != null) {
      if (typeof flagValue == "boolean")
        payload = this.featureFlagsByKey?.[key]?.filters?.payloads?.[flagValue.toString()] || null;
      else if (typeof flagValue == "string")
        payload = this.featureFlagsByKey?.[key]?.filters?.payloads?.[flagValue] || null;
      if (payload != null) {
        if (typeof payload == "object")
          return payload;
        if (typeof payload == "string")
          try {
            return JSON.parse(payload);
          } catch {}
        return payload;
      }
    }
    return null;
  }
  async evaluateFlagDependency(property, properties, evaluationContext) {
    const { evaluationCache } = evaluationContext;
    const targetFlagKey = property.key;
    if (!this.featureFlagsByKey)
      throw new InconclusiveMatchError("Feature flags not available for dependency evaluation");
    if (!("dependency_chain" in property))
      throw new InconclusiveMatchError(`Flag dependency property for '${targetFlagKey}' is missing required 'dependency_chain' field`);
    const dependencyChain = property.dependency_chain;
    if (!Array.isArray(dependencyChain))
      throw new InconclusiveMatchError(`Flag dependency property for '${targetFlagKey}' has an invalid 'dependency_chain' (expected array, got ${typeof dependencyChain})`);
    if (dependencyChain.length === 0)
      throw new InconclusiveMatchError(`Circular dependency detected for flag '${targetFlagKey}' (empty dependency chain)`);
    for (const depFlagKey of dependencyChain) {
      if (!(depFlagKey in evaluationCache)) {
        const depFlag = this.featureFlagsByKey[depFlagKey];
        if (depFlag)
          if (depFlag.active)
            try {
              const depResult = await this.computeFlagValueLocally(depFlag, evaluationContext);
              evaluationCache[depFlagKey] = depResult;
            } catch (error) {
              throw new InconclusiveMatchError(`Error evaluating flag dependency '${depFlagKey}' for flag '${targetFlagKey}': ${error}`);
            }
          else
            evaluationCache[depFlagKey] = false;
        else
          throw new InconclusiveMatchError(`Missing flag dependency '${depFlagKey}' for flag '${targetFlagKey}'`);
      }
      const cachedResult = evaluationCache[depFlagKey];
      if (cachedResult == null)
        throw new InconclusiveMatchError(`Dependency '${depFlagKey}' could not be evaluated`);
    }
    const targetFlagValue = evaluationCache[targetFlagKey];
    return this.flagEvaluatesToExpectedValue(property.value, targetFlagValue);
  }
  flagEvaluatesToExpectedValue(expectedValue, flagValue) {
    if (typeof expectedValue == "boolean")
      return expectedValue === flagValue || typeof flagValue == "string" && flagValue !== "" && expectedValue === true;
    if (typeof expectedValue == "string")
      return flagValue === expectedValue;
    return false;
  }
  async matchFeatureFlagProperties(flag, bucketingValue, properties, evaluationContext) {
    const flagFilters = flag.filters || {};
    const flagConditions = flagFilters.groups || [];
    const flagAggregation = flagFilters.aggregation_group_type_index;
    const earlyExitEnabled = flagFilters.early_exit ?? false;
    const { groups, groupProperties } = evaluationContext;
    let isInconclusive = false;
    let result;
    for (const condition of flagConditions)
      try {
        const conditionAggregation = condition.aggregation_group_type_index !== undefined ? condition.aggregation_group_type_index : flagAggregation;
        let effectiveProperties = properties;
        let effectiveBucketingValue = bucketingValue;
        if (conditionAggregation !== flagAggregation) {
          if (conditionAggregation != null) {
            const groupName = this.groupTypeMapping[String(conditionAggregation)];
            if (!groupName || !(groupName in groups)) {
              this.logMsgIfDebug(() => console.debug(`[FEATURE FLAGS] Skipping group condition for flag '${flag.key}': group type index ${conditionAggregation} not available`));
              continue;
            }
            if (!(groupName in groupProperties)) {
              isInconclusive = true;
              continue;
            }
            effectiveProperties = groupProperties[groupName];
            effectiveBucketingValue = groups[groupName];
          }
        }
        const matchResult = await this.isConditionMatch(flag, effectiveBucketingValue, condition, effectiveProperties, evaluationContext);
        if (matchResult === "match") {
          const variantOverride = condition.variant;
          const flagVariants = flagFilters.multivariate?.variants || [];
          result = variantOverride && flagVariants.some((variant) => variant.key === variantOverride) ? variantOverride : await this.getMatchingVariant(flag, effectiveBucketingValue) || true;
          break;
        }
        if (earlyExitEnabled && matchResult === "out_of_rollout_bound")
          return false;
      } catch (e) {
        if (e instanceof RequiresServerEvaluation)
          throw e;
        if (e instanceof InconclusiveMatchError)
          isInconclusive = true;
        else
          throw e;
      }
    if (result !== undefined)
      return result;
    if (isInconclusive)
      throw new InconclusiveMatchError("Can't determine if feature flag is enabled or not with given properties");
    return false;
  }
  async isConditionMatch(flag, bucketingValue, condition, properties, evaluationContext) {
    const rolloutPercentage = condition.rollout_percentage;
    const warnFunction = (msg) => {
      this.logMsgIfDebug(() => console.warn(msg));
    };
    if ((condition.properties || []).length > 0) {
      for (const prop of condition.properties) {
        const propertyType = prop.type;
        let matches = false;
        if (propertyType === "cohort") {
          const inCohort = await matchCohort(prop, properties, this.cohorts, this.debugMode, (depProp) => this.evaluateFlagDependency(depProp, properties, evaluationContext));
          matches = prop.operator === "not_in" ? !inCohort : inCohort;
        } else
          matches = propertyType === "flag" ? await this.evaluateFlagDependency(prop, properties, evaluationContext) : matchProperty(prop, properties, warnFunction);
        if (!matches)
          return "no_match";
      }
      if (rolloutPercentage == undefined)
        return "match";
    }
    if (rolloutPercentage != null && await _hash(flag.key, bucketingValue) > rolloutPercentage / 100)
      return "out_of_rollout_bound";
    return "match";
  }
  async getMatchingVariant(flag, bucketingValue) {
    const hashValue = await _hash(flag.key, bucketingValue, "variant");
    const matchingVariant = this.variantLookupTable(flag).find((variant) => hashValue >= variant.valueMin && hashValue < variant.valueMax);
    if (matchingVariant)
      return matchingVariant.key;
  }
  variantLookupTable(flag) {
    const lookupTable = [];
    let valueMin = 0;
    let valueMax = 0;
    const flagFilters = flag.filters || {};
    const multivariates = flagFilters.multivariate?.variants || [];
    multivariates.forEach((variant) => {
      valueMax = valueMin + variant.rollout_percentage / 100;
      lookupTable.push({
        valueMin,
        valueMax,
        key: variant.key
      });
      valueMin = valueMax;
    });
    return lookupTable;
  }
  updateFlagState(flagData) {
    this.featureFlags = flagData.flags;
    this.featureFlagsByKey = flagData.flags.reduce((acc, curr) => (acc[curr.key] = curr, acc), {});
    this.groupTypeMapping = flagData.groupTypeMapping;
    this.cohorts = flagData.cohorts;
    this.loadedSuccessfullyOnce = true;
    this.onMinimalFlagCalledEvents?.(flagData.minimalFlagCalledEvents === true);
  }
  warnAboutExperienceContinuityFlags(flags) {
    if (this.strictLocalEvaluation)
      return;
    const experienceContinuityFlags = flags.filter((f) => f.ensure_experience_continuity);
    if (experienceContinuityFlags.length > 0)
      console.warn(`[PostHog] You are using local evaluation but ${experienceContinuityFlags.length} flag(s) have experience continuity enabled: ${experienceContinuityFlags.map((f) => f.key).join(", ")}. Experience continuity is incompatible with local evaluation and will cause a server request on every flag evaluation, negating local evaluation cost savings. To avoid server requests and unexpected costs, either disable experience continuity on these flags in PostHog, use strictLocalEvaluation: true in client init, or pass onlyEvaluateLocally: true per flag call (flags that cannot be evaluated locally will return undefined).`);
  }
  async loadFromCache(debugMessage) {
    if (!this.cacheProvider)
      return false;
    try {
      const cached = await this.cacheProvider.getFlagDefinitions();
      if (cached) {
        this.updateFlagState(cached);
        this.logMsgIfDebug(() => console.debug(`[FEATURE FLAGS] ${debugMessage} (${cached.flags.length} flags)`));
        this.onLoad?.(this.featureFlags.length);
        this.warnAboutExperienceContinuityFlags(cached.flags);
        return true;
      }
      return false;
    } catch (err) {
      this.onError?.(new Error(`Failed to load from cache: ${err}`));
      return false;
    }
  }
  async loadFeatureFlags(forceReload = false) {
    if (this.loadedSuccessfullyOnce && !forceReload)
      return;
    if (!forceReload && this.nextFetchAllowedAt && Date.now() < this.nextFetchAllowedAt)
      return void this.logMsgIfDebug(() => console.debug("[FEATURE FLAGS] Skipping fetch, in backoff period"));
    if (!this.loadingPromise)
      this.loadingPromise = this._loadFeatureFlags().catch((err) => this.logMsgIfDebug(() => console.debug(`[FEATURE FLAGS] Failed to load feature flags: ${err}`))).finally(() => {
        this.loadingPromise = undefined;
      });
    return this.loadingPromise;
  }
  isLocalEvaluationReady() {
    return (this.loadedSuccessfullyOnce ?? false) && (this.featureFlags?.length ?? 0) > 0;
  }
  getFlagDefinitionsLoadedAt() {
    return this.flagDefinitionsLoadedAt;
  }
  getPollingInterval() {
    if (!this.shouldBeginExponentialBackoff)
      return this.pollingInterval;
    return Math.min(SIXTY_SECONDS, this.pollingInterval * 2 ** this.backOffCount);
  }
  beginBackoff() {
    this.shouldBeginExponentialBackoff = true;
    this.backOffCount += 1;
    this.nextFetchAllowedAt = Date.now() + this.getPollingInterval();
  }
  clearBackoff() {
    this.shouldBeginExponentialBackoff = false;
    this.backOffCount = 0;
    this.nextFetchAllowedAt = undefined;
  }
  async _loadFeatureFlags() {
    if (this.poller) {
      clearTimeout(this.poller);
      this.poller = undefined;
    }
    try {
      let shouldFetch = true;
      if (this.cacheProvider)
        try {
          shouldFetch = await this.cacheProvider.shouldFetchFlagDefinitions();
        } catch (err) {
          this.onError?.(new Error(`Error in shouldFetchFlagDefinitions: ${err}`));
        }
      if (!shouldFetch) {
        const loaded = await this.loadFromCache("Loaded flags from cache (skipped fetch)");
        if (loaded)
          return;
        if (this.loadedSuccessfullyOnce)
          return;
      }
      const res = await this._requestFeatureFlagDefinitions();
      if (!res)
        return;
      switch (res.status) {
        case 304:
          this.logMsgIfDebug(() => console.debug("[FEATURE FLAGS] Flags not modified (304), using cached data"));
          this.flagsEtag = res.headers?.get("ETag") ?? this.flagsEtag;
          this.loadedSuccessfullyOnce = true;
          this.clearBackoff();
          return;
        case 401:
          this.beginBackoff();
          throw new ClientError(`Your project key or secret key is invalid. Setting next polling interval to ${this.getPollingInterval()}ms. More information: https://posthog.com/docs/api#rate-limiting`);
        case 402:
          console.warn("[FEATURE FLAGS] Feature flags quota limit exceeded - unsetting all local flags. Learn more about billing limits at https://posthog.com/docs/billing/limits-alerts");
          this.featureFlags = [];
          this.featureFlagsByKey = {};
          this.groupTypeMapping = {};
          this.cohorts = {};
          this.onMinimalFlagCalledEvents?.(false);
          return;
        case 403:
          this.beginBackoff();
          throw new ClientError(`Your secret key does not have permission to fetch feature flag definitions for local evaluation. Setting next polling interval to ${this.getPollingInterval()}ms. Are you sure you're using the correct secret and Project API key pair? More information: https://posthog.com/docs/api/overview`);
        case 429:
          this.beginBackoff();
          throw new ClientError(`You are being rate limited. Setting next polling interval to ${this.getPollingInterval()}ms. More information: https://posthog.com/docs/api#rate-limiting`);
        case 200: {
          const responseJson = await res.json() ?? {};
          if (!("flags" in responseJson))
            return void this.onError?.(new Error(`Invalid response when getting feature flags: ${JSON.stringify(responseJson)}`));
          this.flagsEtag = res.headers?.get("ETag") ?? undefined;
          const flagData = {
            flags: responseJson.flags ?? [],
            groupTypeMapping: responseJson.group_type_mapping || {},
            cohorts: responseJson.cohorts || {},
            minimalFlagCalledEvents: responseJson.minimal_flag_called_events === true
          };
          this.updateFlagState(flagData);
          this.flagDefinitionsLoadedAt = Date.now();
          this.clearBackoff();
          if (this.cacheProvider && shouldFetch)
            try {
              await this.cacheProvider.onFlagDefinitionsReceived(flagData);
            } catch (err) {
              this.onError?.(new Error(`Failed to store in cache: ${err}`));
            }
          this.onLoad?.(this.featureFlags.length);
          this.warnAboutExperienceContinuityFlags(flagData.flags);
          break;
        }
        default:
          return;
      }
    } catch (err) {
      if (err instanceof ClientError)
        this.onError?.(err);
    } finally {
      if (!this.pollerStopped)
        this.poller = setTimeout(() => this.loadFeatureFlags(true), this.getPollingInterval());
    }
  }
  getPersonalApiKeyRequestOptions(method = "GET", etag) {
    const headers = {
      ...this.customHeaders,
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.personalApiKey}`
    };
    if (etag)
      headers["If-None-Match"] = etag;
    return {
      method,
      headers
    };
  }
  async _requestFeatureFlagDefinitions() {
    const url = `${this.host}/flags/definitions?token=${this.projectApiKey}&send_cohorts`;
    const options = this.getPersonalApiKeyRequestOptions("GET", this.flagsEtag);
    let abortTimeout = null;
    if (this.timeout && typeof this.timeout == "number") {
      const controller = new AbortController;
      abortTimeout = safeSetTimeout(() => {
        controller.abort();
      }, this.timeout);
      options.signal = controller.signal;
    }
    const clearAbortTimeout = () => clearTimeout(abortTimeout);
    try {
      const fetch1 = this.fetch;
      const res = await fetch1(url, options);
      if (res.status !== 200) {
        clearAbortTimeout();
        return res;
      }
      return {
        status: res.status,
        headers: res.headers,
        body: res.body,
        text: async () => {
          try {
            return await res.text();
          } finally {
            clearAbortTimeout();
          }
        },
        json: async () => {
          try {
            return await res.json();
          } finally {
            clearAbortTimeout();
          }
        }
      };
    } catch (err) {
      clearAbortTimeout();
      throw err;
    }
  }
  async stopPoller(timeoutMs = 30000) {
    this.pollerStopped = true;
    clearTimeout(this.poller);
    this.poller = undefined;
    if (this.cacheProvider)
      try {
        const shutdownResult = this.cacheProvider.shutdown();
        if (shutdownResult instanceof Promise)
          await raceWithTimeout(shutdownResult, timeoutMs, () => {
            throw new Error(`Cache shutdown timeout after ${timeoutMs}ms`);
          });
      } catch (err) {
        this.onError?.(new Error(`Error during cache shutdown: ${err}`));
      }
  }
}
async function _hash(key, bucketingValue, salt = "") {
  const hashString = await hashSHA1(`${key}.${bucketingValue}${salt}`);
  return parseInt(hashString.slice(0, 15), 16) / LONG_SCALE;
}
function matchProperty(property, propertyValues, warnFunction) {
  const key = property.key;
  const value = property.value;
  const operator = property.operator || "exact";
  if (key in propertyValues) {
    if (operator === "is_not_set")
      return false;
  } else {
    if (operator === "is_not_set")
      return true;
    throw new InconclusiveMatchError(`Property ${key} not found in propertyValues`);
  }
  const overrideValue = propertyValues[key];
  if (overrideValue == null && !NULL_VALUES_ALLOWED_OPERATORS.includes(operator)) {
    if (warnFunction)
      warnFunction(`Property ${key} cannot have a value of null/undefined with the ${operator} operator`);
    return false;
  }
  function computeExactMatch(value, overrideValue) {
    if (Array.isArray(value))
      return value.map((val) => String(val).toLowerCase()).includes(String(overrideValue).toLowerCase());
    return String(value).toLowerCase() === String(overrideValue).toLowerCase();
  }
  function compare(lhs, rhs, operator) {
    if (operator === "gt")
      return lhs > rhs;
    if (operator === "gte")
      return lhs >= rhs;
    if (operator === "lt")
      return lhs < rhs;
    if (operator === "lte")
      return lhs <= rhs;
    throw new Error(`Invalid operator: ${operator}`);
  }
  switch (operator) {
    case "exact":
      return computeExactMatch(value, overrideValue);
    case "is_not":
      return !computeExactMatch(value, overrideValue);
    case "is_set":
      return key in propertyValues;
    case "icontains":
      return String(overrideValue).toLowerCase().includes(String(value).toLowerCase());
    case "not_icontains":
      return !String(overrideValue).toLowerCase().includes(String(value).toLowerCase());
    case "starts_with":
      return String(overrideValue).toLowerCase().startsWith(String(value).toLowerCase());
    case "not_starts_with":
      return !String(overrideValue).toLowerCase().startsWith(String(value).toLowerCase());
    case "ends_with":
      return String(overrideValue).toLowerCase().endsWith(String(value).toLowerCase());
    case "not_ends_with":
      return !String(overrideValue).toLowerCase().endsWith(String(value).toLowerCase());
    case "regex":
      return isValidRegex(String(value)) && String(overrideValue).match(String(value)) !== null;
    case "not_regex":
      return isValidRegex(String(value)) && String(overrideValue).match(String(value)) === null;
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const parsedValue = typeof value == "number" ? value : parseFloat(String(value));
      let parsedOverride;
      parsedOverride = typeof overrideValue == "number" ? overrideValue : overrideValue != null ? parseFloat(String(overrideValue)) : NaN;
      if (Number.isFinite(parsedValue) && Number.isFinite(parsedOverride))
        return compare(parsedOverride, parsedValue, operator);
      return compare(String(overrideValue), String(value), operator);
    }
    case "is_date_after":
    case "is_date_before": {
      if (typeof value == "boolean")
        throw new InconclusiveMatchError("Date operations cannot be performed on boolean values");
      let parsedDate = relativeDateParseForFeatureFlagMatching(String(value));
      if (parsedDate == null)
        parsedDate = convertToDateTime(value);
      if (parsedDate == null)
        throw new InconclusiveMatchError(`Invalid date: ${value}`);
      const overrideDate = convertToDateTime(overrideValue);
      if ([
        "is_date_before"
      ].includes(operator))
        return overrideDate < parsedDate;
      return overrideDate > parsedDate;
    }
    case "semver_eq": {
      const cmp = compareSemverTuples(parseSemver(String(overrideValue)), parseSemver(String(value)));
      return cmp === 0;
    }
    case "semver_neq": {
      const cmp = compareSemverTuples(parseSemver(String(overrideValue)), parseSemver(String(value)));
      return cmp !== 0;
    }
    case "semver_gt": {
      const cmp = compareSemverTuples(parseSemver(String(overrideValue)), parseSemver(String(value)));
      return cmp > 0;
    }
    case "semver_gte": {
      const cmp = compareSemverTuples(parseSemver(String(overrideValue)), parseSemver(String(value)));
      return cmp >= 0;
    }
    case "semver_lt": {
      const cmp = compareSemverTuples(parseSemver(String(overrideValue)), parseSemver(String(value)));
      return cmp < 0;
    }
    case "semver_lte": {
      const cmp = compareSemverTuples(parseSemver(String(overrideValue)), parseSemver(String(value)));
      return cmp <= 0;
    }
    case "semver_tilde": {
      const overrideParsed = parseSemver(String(overrideValue));
      const { lower, upper } = computeTildeBounds(String(value));
      return compareSemverTuples(overrideParsed, lower) >= 0 && compareSemverTuples(overrideParsed, upper) < 0;
    }
    case "semver_caret": {
      const overrideParsed = parseSemver(String(overrideValue));
      const { lower, upper } = computeCaretBounds(String(value));
      return compareSemverTuples(overrideParsed, lower) >= 0 && compareSemverTuples(overrideParsed, upper) < 0;
    }
    case "semver_wildcard": {
      const overrideParsed = parseSemver(String(overrideValue));
      const { lower, upper } = computeWildcardBounds(String(value));
      return compareSemverTuples(overrideParsed, lower) >= 0 && compareSemverTuples(overrideParsed, upper) < 0;
    }
    default:
      throw new InconclusiveMatchError(`Unknown operator: ${operator}`);
  }
}
function checkCohortExists(cohortId, cohortProperties) {
  if (!(cohortId in cohortProperties))
    throw new RequiresServerEvaluation(`cohort ${cohortId} not found in local cohorts - likely a static cohort that requires server evaluation`);
}
async function matchCohort(property, propertyValues, cohortProperties, debugMode = false, flagDependencyEvaluator) {
  const cohortId = String(property.value);
  checkCohortExists(cohortId, cohortProperties);
  const propertyGroup = cohortProperties[cohortId];
  return matchPropertyGroup(propertyGroup, propertyValues, cohortProperties, debugMode, flagDependencyEvaluator);
}
async function matchPropertyGroup(propertyGroup, propertyValues, cohortProperties, debugMode = false, flagDependencyEvaluator) {
  if (!propertyGroup)
    return true;
  const propertyGroupType = propertyGroup.type;
  const properties = propertyGroup.values;
  if (!properties || properties.length === 0)
    return true;
  let errorMatchingLocally = false;
  if ("values" in properties[0]) {
    for (const prop of properties)
      try {
        const matches = await matchPropertyGroup(prop, propertyValues, cohortProperties, debugMode, flagDependencyEvaluator);
        if (propertyGroupType === "AND") {
          if (!matches)
            return false;
        } else if (matches)
          return true;
      } catch (err) {
        if (err instanceof RequiresServerEvaluation)
          throw err;
        if (err instanceof InconclusiveMatchError) {
          if (debugMode)
            console.debug(`Failed to compute property ${prop} locally: ${err}`);
          errorMatchingLocally = true;
        } else
          throw err;
      }
    if (errorMatchingLocally)
      throw new InconclusiveMatchError("Can't match cohort without a given cohort property value");
    return propertyGroupType === "AND";
  }
  for (const prop of properties)
    try {
      let matches;
      if (prop.type === "cohort")
        matches = await matchCohort(prop, propertyValues, cohortProperties, debugMode, flagDependencyEvaluator);
      else if (prop.type === "flag") {
        if (!flagDependencyEvaluator)
          throw new InconclusiveMatchError(`Flag dependency '${prop.key || "unknown"}' cannot be evaluated without a flag dependency evaluator`);
        matches = await flagDependencyEvaluator(prop);
      } else
        matches = matchProperty(prop, propertyValues);
      const negation = prop.negation || false;
      if (propertyGroupType === "AND") {
        if (!matches && !negation)
          return false;
        if (matches && negation)
          return false;
      } else {
        if (matches && !negation)
          return true;
        if (!matches && negation)
          return true;
      }
    } catch (err) {
      if (err instanceof RequiresServerEvaluation)
        throw err;
      if (err instanceof InconclusiveMatchError) {
        if (debugMode)
          console.debug(`Failed to compute property ${prop} locally: ${err}`);
        errorMatchingLocally = true;
      } else
        throw err;
    }
  if (errorMatchingLocally)
    throw new InconclusiveMatchError("can't match cohort without a given cohort property value");
  return propertyGroupType === "AND";
}
function isValidRegex(regex) {
  try {
    new RegExp(regex);
    return true;
  } catch (err) {
    return false;
  }
}
function parseSemverNumericIdentifier(part, raw) {
  if (!/^\d+$/.test(part))
    throw new InconclusiveMatchError(`Invalid semver: ${raw}`);
  if (part.length > 1 && part[0] === "0")
    throw new InconclusiveMatchError(`Invalid semver: ${raw}`);
  return parseInt(part, 10);
}
function parseSemver(value) {
  const text = String(value).trim().replace(/^[vV]/, "");
  const baseVersion = text.split("-")[0].split("+")[0];
  if (!baseVersion || baseVersion.startsWith("."))
    throw new InconclusiveMatchError(`Invalid semver: ${value}`);
  const parts = baseVersion.split(".");
  const parsePart = (part) => {
    if (part === undefined || part === "")
      return 0;
    return parseSemverNumericIdentifier(part, value);
  };
  const major = parsePart(parts[0]);
  const minor = parsePart(parts[1]);
  const patch = parsePart(parts[2]);
  return [
    major,
    minor,
    patch
  ];
}
function compareSemverTuples(a, b) {
  for (let i = 0;i < 3; i++) {
    if (a[i] < b[i])
      return -1;
    if (a[i] > b[i])
      return 1;
  }
  return 0;
}
function computeTildeBounds(value) {
  const parsed = parseSemver(value);
  const lower = [
    parsed[0],
    parsed[1],
    parsed[2]
  ];
  const upper = [
    parsed[0],
    parsed[1] + 1,
    0
  ];
  return {
    lower,
    upper
  };
}
function computeCaretBounds(value) {
  const parsed = parseSemver(value);
  const [major, minor, patch] = parsed;
  const lower = [
    major,
    minor,
    patch
  ];
  let upper;
  upper = major > 0 ? [
    major + 1,
    0,
    0
  ] : minor > 0 ? [
    0,
    minor + 1,
    0
  ] : [
    0,
    0,
    patch + 1
  ];
  return {
    lower,
    upper
  };
}
function computeWildcardBounds(value) {
  const text = String(value).trim().replace(/^[vV]/, "");
  const cleanedText = text.replace(/\.\*$/, "").replace(/\*$/, "");
  if (!cleanedText)
    throw new InconclusiveMatchError(`Invalid wildcard semver: ${value}`);
  const parts = cleanedText.split(".");
  const parseWildcardPart = (part) => {
    try {
      return parseSemverNumericIdentifier(part, value);
    } catch {
      throw new InconclusiveMatchError(`Invalid wildcard semver: ${value}`);
    }
  };
  const major = parseWildcardPart(parts[0]);
  let lower;
  let upper;
  if (parts.length === 1) {
    lower = [
      major,
      0,
      0
    ];
    upper = [
      major + 1,
      0,
      0
    ];
  } else {
    const minor = parseWildcardPart(parts[1]);
    lower = [
      major,
      minor,
      0
    ];
    upper = [
      major,
      minor + 1,
      0
    ];
  }
  return {
    lower,
    upper
  };
}
function convertToDateTime(value) {
  if (value instanceof Date)
    return value;
  if (typeof value == "string" || typeof value == "number") {
    const date = new Date(value);
    if (!isNaN(date.valueOf()))
      return date;
    throw new InconclusiveMatchError(`${value} is in an invalid date format`);
  }
  throw new InconclusiveMatchError(`The date provided ${value} must be a string, number, or date object`);
}
function relativeDateParseForFeatureFlagMatching(value) {
  const regex = /^-?(?<number>[0-9]+)(?<interval>[a-z])$/;
  const match = value.match(regex);
  const parsedDt = new Date(new Date().toISOString());
  if (!match)
    return null;
  {
    if (!match.groups)
      return null;
    const number = parseInt(match.groups["number"]);
    if (number >= 1e4)
      return null;
    const interval = match.groups["interval"];
    if (interval == "h")
      parsedDt.setUTCHours(parsedDt.getUTCHours() - number);
    else if (interval == "d")
      parsedDt.setUTCDate(parsedDt.getUTCDate() - number);
    else if (interval == "w")
      parsedDt.setUTCDate(parsedDt.getUTCDate() - 7 * number);
    else if (interval == "m")
      parsedDt.setUTCMonth(parsedDt.getUTCMonth() - number);
    else {
      if (interval != "y")
        return null;
      parsedDt.setUTCFullYear(parsedDt.getUTCFullYear() - number);
    }
    return parsedDt;
  }
}
var SIXTY_SECONDS = 60000, LONG_SCALE = 1152921504606847000, NULL_VALUES_ALLOWED_OPERATORS, ClientError, InconclusiveMatchError, RequiresServerEvaluation;
var init_feature_flags = __esm(() => {
  init_dist();
  init_crypto();
  NULL_VALUES_ALLOWED_OPERATORS = [
    "is_not",
    "is_set"
  ];
  ClientError = class ClientError extends Error {
    constructor(message) {
      super();
      Error.captureStackTrace(this, this.constructor);
      this.name = "ClientError";
      this.message = message;
      Object.setPrototypeOf(this, ClientError.prototype);
    }
  };
  InconclusiveMatchError = class InconclusiveMatchError extends Error {
    constructor(message) {
      super(message);
      setCustomErrorPrototype(this, InconclusiveMatchError);
    }
  };
  RequiresServerEvaluation = class RequiresServerEvaluation extends Error {
    constructor(message) {
      super(message);
      setCustomErrorPrototype(this, RequiresServerEvaluation);
    }
  };
});

// node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/extensions/error-tracking/autocapture.mjs
function splitNodeOptions(nodeOptions) {
  const args = [];
  let current = "";
  let isInString = false;
  for (let index = 0;index < nodeOptions.length; index++) {
    const character = nodeOptions[index];
    if (character === "\\" && isInString && index + 1 < nodeOptions.length)
      current += nodeOptions[++index];
    else if (character !== " " || isInString)
      if (character === '"')
        isInString = !isInString;
      else
        current += character;
    else if (current) {
      args.push(current);
      current = "";
    }
  }
  if (current)
    args.push(current);
  return args;
}
function findUnhandledRejectionMode(args) {
  let mode;
  for (let index = 0;index < args.length; index++) {
    const argument = args[index];
    const optionName = UNHANDLED_REJECTION_OPTION_NAMES.find((name) => argument === name || argument.startsWith(`${name}=`));
    if (!optionName)
      continue;
    const value = argument === optionName ? args[++index] : argument.slice(optionName.length + 1);
    if (UNHANDLED_REJECTION_MODES.has(value))
      mode = value;
  }
  return mode;
}
function getUnhandledRejectionMode(execArgv = STARTUP_EXEC_ARGV, nodeOptions = STARTUP_NODE_OPTIONS) {
  return findUnhandledRejectionMode(execArgv) ?? findUnhandledRejectionMode(splitNodeOptions(nodeOptions ?? "")) ?? "throw";
}
function captureUncaughtException(captureFn, error, origin) {
  captureFn(error, {
    mechanism: {
      type: origin === "unhandledRejection" ? "onunhandledrejection" : "onuncaughtexception",
      handled: false
    }
  });
}
function makeUncaughtExceptionHandler(captureFn, onFatalFn) {
  let calledFatalError = false;
  return Object.assign((error, origin) => {
    const userProvidedListenersCount = global.process.listeners("uncaughtException").filter((listener) => listener.name !== "domainUncaughtExceptionClear" && listener._posthogErrorHandler !== true).length;
    captureUncaughtException(captureFn, error, origin);
    if (!calledFatalError && userProvidedListenersCount === 0) {
      calledFatalError = true;
      onFatalFn(error);
    }
  }, {
    _posthogErrorHandler: true
  });
}
function addUncaughtExceptionListener(captureFn, onFatalFn, mode = STARTUP_UNHANDLED_REJECTION_MODE) {
  const process2 = globalThis.process;
  if (!process2)
    return;
  if (mode === "strict")
    return void process2.on("uncaughtExceptionMonitor", (error, origin) => captureUncaughtException(captureFn, error, origin));
  process2.on("uncaughtException", makeUncaughtExceptionHandler(captureFn, onFatalFn));
}
function addUnhandledRejectionListener(captureFn, mode = STARTUP_UNHANDLED_REJECTION_MODE) {
  const process2 = globalThis.process;
  if (!process2 || mode === "throw" || mode === "strict" || mode === "warn-with-error-code")
    return;
  process2.on("unhandledRejection", (reason) => {
    captureFn(reason, {
      mechanism: {
        type: "onunhandledrejection",
        handled: false
      }
    });
  });
}
var UNHANDLED_REJECTION_OPTION_NAMES, UNHANDLED_REJECTION_MODES, STARTUP_EXEC_ARGV, STARTUP_NODE_OPTIONS, STARTUP_UNHANDLED_REJECTION_MODE;
var init_autocapture = __esm(() => {
  UNHANDLED_REJECTION_OPTION_NAMES = [
    "--unhandled-rejections",
    "--unhandled_rejections"
  ];
  UNHANDLED_REJECTION_MODES = new Set([
    "throw",
    "strict",
    "warn",
    "warn-with-error-code",
    "none"
  ]);
  STARTUP_EXEC_ARGV = [
    ...globalThis.process?.execArgv ?? []
  ];
  STARTUP_NODE_OPTIONS = globalThis.process?.env?.NODE_OPTIONS;
  STARTUP_UNHANDLED_REJECTION_MODE = getUnhandledRejectionMode();
});

// node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/extensions/error-tracking/index.mjs
class error_tracking_ErrorTracking {
  constructor(client, options, _logger) {
    this.client = client;
    this._exceptionAutocaptureEnabled = options.enableExceptionAutocapture || false;
    this._logger = _logger;
    this._rateLimiter = new BucketedRateLimiter({
      ...resolveExceptionRateLimiterConfig(options),
      refillInterval: 1e4,
      _logger: this._logger
    });
    this.startAutocaptureIfEnabled();
  }
  static isPreviouslyCapturedError(x) {
    return isObject2(x) && "__posthog_previously_captured_error" in x && x.__posthog_previously_captured_error === true;
  }
  static async buildEventMessage(builder, error, hint, distinctId, additionalProperties) {
    const properties = {
      ...additionalProperties
    };
    const exceptionProperties = builder.buildFromUnknown(error, hint);
    exceptionProperties.$exception_list = await builder.modifyFrames(exceptionProperties.$exception_list);
    const injectedReleaseId = getInjectedReleaseId();
    if (injectedReleaseId)
      properties.$release_id = injectedReleaseId;
    return {
      event: "$exception",
      distinctId,
      properties: {
        ...exceptionProperties,
        ...properties
      },
      _originatedFromCaptureException: true
    };
  }
  startAutocaptureIfEnabled() {
    if (this.isEnabled()) {
      addUncaughtExceptionListener(this.onException.bind(this), this.onFatalError.bind(this));
      addUnhandledRejectionListener(this.onException.bind(this));
    }
  }
  onException(exception, hint) {
    this.client.addPendingPromise((async () => {
      if (!error_tracking_ErrorTracking.isPreviouslyCapturedError(exception)) {
        const eventMessage = await error_tracking_ErrorTracking.buildEventMessage(this.client.getErrorPropertiesBuilder(), exception, hint);
        const exceptionProperties = eventMessage.properties;
        const exceptionType = exceptionProperties?.$exception_list[0]?.type ?? "Exception";
        const isRateLimited = this._rateLimiter.consumeRateLimit(exceptionType);
        if (isRateLimited)
          return void this._logger.info("Skipping exception capture because of client rate limiting.", {
            exception: exceptionType
          });
        return this.client._capturePreparedEvent(eventMessage, false);
      }
    })());
  }
  async onFatalError(exception) {
    console.error(exception);
    await this.client.shutdown(SHUTDOWN_TIMEOUT);
    globalThis.process.exit(1);
  }
  isEnabled() {
    return !this.client.isDisabled && this._exceptionAutocaptureEnabled;
  }
  shutdown() {
    this._rateLimiter.stop();
  }
}
var SHUTDOWN_TIMEOUT = 2000;
var init_error_tracking2 = __esm(() => {
  init_autocapture();
  init_dist();
});

// node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/storage-memory.mjs
class PostHogMemoryStorage {
  getProperty(key) {
    return this._memoryStorage[key];
  }
  setProperty(key, value) {
    this._memoryStorage[key] = value !== null ? value : undefined;
  }
  constructor() {
    this._memoryStorage = {};
  }
}
var init_storage_memory = () => {};

// node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/capture-v1/config.mjs
function isCaptureMode(value) {
  return value === "v0" || value === "v1";
}
function resolveCaptureMode() {
  const envMode = typeof process != "undefined" ? process.env?.POSTHOG_CAPTURE_MODE : undefined;
  return isCaptureMode(envMode) ? envMode : "v0";
}
var init_config2 = () => {};

// node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/capture-v1/routing.mjs
function isLegacyOnlyEvent(message) {
  return typeof message.event == "string" && message.event.startsWith(AI_EVENT_PREFIX);
}
var AI_EVENT_PREFIX = "$ai_", ANALYTICS_ROUTE = "analytics", AI_ROUTE = "ai";
var init_routing = () => {};

// node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/capture-v1/errors.mjs
var CaptureV1Error;
var init_errors = __esm(() => {
  CaptureV1Error = class CaptureV1Error extends Error {
    constructor({ requestId, drops, retryExhausted, cause }) {
      super(CaptureV1Error.buildMessage(requestId, drops, retryExhausted, cause)), this.name = "CaptureV1Error";
      this.requestId = requestId;
      this.drops = drops;
      this.retryExhausted = retryExhausted;
      this.cause = cause;
    }
    static buildMessage(requestId, drops, retryExhausted, cause) {
      let message = `Capture V1 batch ${requestId} did not fully deliver: ${drops.length} dropped, ${retryExhausted.length} undelivered`;
      if (cause instanceof Error)
        message += ` (${cause.message})`;
      return message;
    }
  };
});

// node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/capture-v1/transform.mjs
function coerceBool(value) {
  if (typeof value == "boolean")
    return value;
  if (typeof value == "number")
    return value !== 0;
  if (typeof value == "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1")
      return true;
    if (normalized === "false" || normalized === "0")
      return false;
  }
}
function coerceString(value) {
  return typeof value == "string" ? value : undefined;
}
function isRecord9(value) {
  return typeof value == "object" && value !== null && !Array.isArray(value);
}
function toRfc3339(timestamp) {
  if (typeof timestamp == "string") {
    const asDate = new Date(timestamp);
    if (Number.isNaN(asDate.getTime()))
      return new Date().toISOString();
    const normalized = asDate.toISOString();
    const fractionalSeconds = timestamp.match(/\.(\d+)(?:Z|[+-]\d{2}:?\d{2})?$/i)?.[1];
    return fractionalSeconds && fractionalSeconds.length > 3 ? normalized.replace(/\.\d{3}Z$/, `.${fractionalSeconds}Z`) : normalized;
  }
  if (timestamp instanceof Date)
    return Number.isNaN(timestamp.getTime()) ? new Date().toISOString() : timestamp.toISOString();
  const asDate = timestamp == null ? new Date : new Date(timestamp);
  return Number.isNaN(asDate.getTime()) ? new Date().toISOString() : asDate.toISOString();
}
function relocateInto(properties, key, value) {
  if (value !== undefined && !(key in properties))
    properties[key] = value;
}
function buildV1Event(message) {
  const sourceProperties = isRecord9(message.properties) ? message.properties : {};
  const properties = {
    ...sourceProperties
  };
  const options = {};
  for (const { property, optionKey, coerce } of OPTION_SENTINELS)
    if (property in properties) {
      const coerced = coerce(properties[property]);
      if (coerced !== undefined)
        options[optionKey] = coerced;
      delete properties[property];
    }
  const topLevel = {};
  for (const { property, field } of TOPLEVEL_SENTINELS)
    if (property in properties) {
      const value = properties[property];
      if (typeof value == "string")
        topLevel[field] = value;
      delete properties[property];
    }
  delete properties.$lib;
  delete properties.$lib_version;
  relocateInto(properties, "$set", message.$set);
  relocateInto(properties, "$set_once", message.$set_once);
  return {
    event: String(message.event ?? ""),
    uuid: String(message.uuid ?? ""),
    distinct_id: String(message.distinct_id ?? ""),
    timestamp: toRfc3339(message.timestamp),
    ...topLevel,
    options,
    properties
  };
}
function buildV1Batch(messages, { createdAt, historicalMigration }) {
  const batch = {
    created_at: createdAt,
    batch: messages.map(buildV1Event)
  };
  if (historicalMigration)
    batch.historical_migration = true;
  return batch;
}
var OPTION_SENTINELS, TOPLEVEL_SENTINELS;
var init_transform = __esm(() => {
  OPTION_SENTINELS = [
    {
      property: "$cookieless_mode",
      optionKey: "cookieless_mode",
      coerce: coerceBool
    },
    {
      property: "$ignore_sent_at",
      optionKey: "disable_skew_correction",
      coerce: coerceBool
    },
    {
      property: "$process_person_profile",
      optionKey: "process_person_profile",
      coerce: coerceBool
    },
    {
      property: "$product_tour_id",
      optionKey: "product_tour_id",
      coerce: coerceString
    }
  ];
  TOPLEVEL_SENTINELS = [
    {
      property: "$session_id",
      field: "session_id"
    },
    {
      property: "$window_id",
      field: "window_id"
    }
  ];
});

// node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/capture-v1/sender.mjs
class V1CaptureSender {
  constructor(config, hooks) {
    this.config = config;
    this.maxBackoffMs = config.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
    this.fetchFn = hooks.fetch;
    this.onError = hooks.onError;
    this.now = hooks.now ?? Date.now;
    this.sleep = hooks.sleep ?? ((ms) => new Promise((resolve) => safeSetTimeout(resolve, ms)));
    this.generateRequestId = hooks.generateRequestId ?? uuidv7;
    this.compress = hooks.compress ?? gzipCompress;
  }
  async sendV1Batch(messages) {
    if (messages.length === 0)
      return;
    const requestId = this.generateRequestId();
    const createdAt = new Date(this.now()).toISOString();
    const { batch } = buildV1Batch(messages, {
      createdAt,
      historicalMigration: this.config.historicalMigration
    });
    const url = `${this.config.host}${V1_ANALYTICS_PATH}`;
    const drops = [];
    let pending = batch;
    const maxAttempts = Math.max(1, this.config.maxAttempts);
    for (let attempt = 1;attempt <= maxAttempts; attempt++) {
      const isLastAttempt = attempt === maxAttempts;
      const payload = safeJsonStringify({
        created_at: createdAt,
        ...this.config.historicalMigration ? {
          historical_migration: true
        } : {},
        batch: pending
      });
      let captureAttempt;
      let retryDelayMs;
      try {
        captureAttempt = await this.sendOnce(url, payload, attempt, requestId);
        const { response, signal } = captureAttempt;
        const { status } = response;
        if (status < 200 || status >= 300)
          if (!isLastAttempt && RETRYABLE_STATUSES.has(status)) {
            const retryAfterMs = this.parseRetryAfter(response);
            await captureAttempt.waitFor(captureAttempt.cancelBody()).catch(() => {});
            retryDelayMs = this.backoffDelay(attempt, retryAfterMs);
          } else {
            const httpError = await this.buildHttpError(response, status, captureAttempt.waitFor);
            return this.surfaceBatchFailure(requestId, drops, pending, httpError);
          }
        else {
          let parsed;
          try {
            parsed = await captureAttempt.waitFor(this.parseResponse(response));
          } catch (error) {
            if (signal.aborted)
              throw error;
            return this.surfaceBatchFailure(requestId, drops, pending, new Error(`Capture V1 returned an unparseable ${status} response body`));
          }
          const retryable = this.classify(pending, parsed, drops);
          if (retryable.length === 0)
            return this.surfacePartialDrops(requestId, drops);
          if (isLastAttempt)
            return void this.onError(new CaptureV1Error({
              requestId,
              drops,
              retryExhausted: retryable.map((event) => event.uuid)
            }));
          pending = retryable;
          const retryAfterMs = this.parseRetryAfter(response);
          retryDelayMs = this.backoffDelay(attempt, retryAfterMs);
        }
      } catch (transportError) {
        if (captureAttempt && !captureAttempt.signal.aborted)
          throw transportError;
        if (isLastAttempt)
          return this.surfaceBatchFailure(requestId, drops, pending, transportError);
        retryDelayMs = this.backoffDelay(attempt);
      } finally {
        captureAttempt?.cleanup();
      }
      if (retryDelayMs !== undefined)
        await this.sleep(retryDelayMs);
    }
  }
  async sendOnce(url, payload, attempt, requestId) {
    const headers = this.buildHeaders(attempt, requestId);
    let body = payload;
    if (this.config.compressionEnabled) {
      const compressed = await this.compress(payload, this.config.isDebug);
      if (compressed !== null) {
        body = compressed;
        headers["Content-Encoding"] = "gzip";
      }
    }
    const controller = new AbortController;
    let timeoutPhase = "waiting for response headers";
    let timer;
    const deadline = new Promise((_resolve, reject) => {
      timer = safeSetTimeout(() => {
        const timeoutError = new Error(`Capture V1 request timed out ${timeoutPhase} after ${this.config.requestTimeoutMs}ms`);
        timeoutError.name = "AbortError";
        reject(timeoutError);
        controller.abort(timeoutError);
      }, this.config.requestTimeoutMs);
    });
    try {
      const fetchPromise = this.fetchFn(url, {
        method: "POST",
        headers,
        body,
        signal: controller.signal
      });
      let responseAccepted = false;
      fetchPromise.then((lateResponse) => {
        if (controller.signal.aborted && !responseAccepted)
          this.cancelBody(lateResponse);
      }).catch(() => {});
      const response = await Promise.race([
        fetchPromise,
        deadline
      ]);
      responseAccepted = true;
      timeoutPhase = "while reading the response body";
      let cleanedUp = false;
      let cancellation;
      const cancelBody = () => cancellation ??= this.cancelBody(response);
      return {
        response,
        signal: controller.signal,
        waitFor: (operation) => Promise.race([
          operation,
          deadline
        ]),
        cancelBody,
        cleanup: () => {
          if (cleanedUp)
            return;
          cleanedUp = true;
          clearTimeout(timer);
          if (controller.signal.aborted)
            cancelBody();
        }
      };
    } catch (error) {
      clearTimeout(timer);
      throw error;
    }
  }
  buildHeaders(attempt, requestId) {
    const sdkInfo = `${this.config.libraryId}/${this.config.libraryVersion}`;
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.apiKey}`,
      "PostHog-Sdk-Info": sdkInfo,
      "PostHog-Attempt": String(attempt),
      "PostHog-Request-Id": requestId,
      "PostHog-Request-Timestamp": new Date(this.now()).toISOString()
    };
    if (this.config.userAgent)
      headers["User-Agent"] = this.config.userAgent;
    return headers;
  }
  classify(pending, parsed, drops) {
    const results = parsed.results ?? {};
    const retryable = [];
    for (const event of pending) {
      const result = results[event.uuid];
      if (result) {
        if (result.result === "drop")
          drops.push({
            uuid: event.uuid,
            details: result.details ?? undefined
          });
        else if (result.result === "retry")
          retryable.push(event);
      }
    }
    return retryable;
  }
  backoffDelay(attempt, retryAfterMs) {
    const exponential = Math.min(this.config.initialRetryDelayMs * 2 ** (attempt - 1), this.maxBackoffMs);
    if (retryAfterMs === undefined)
      return exponential;
    return Math.max(exponential, Math.min(retryAfterMs, this.maxBackoffMs));
  }
  parseRetryAfter(response) {
    const raw = response.headers?.get("Retry-After");
    if (!raw)
      return;
    const trimmed = raw.trim();
    if (/^\d+$/.test(trimmed)) {
      const seconds = parseInt(trimmed, 10);
      return Number.isFinite(seconds) && seconds > 0 ? 1000 * seconds : undefined;
    }
    const dateMs = Date.parse(trimmed);
    if (Number.isNaN(dateMs))
      return;
    const delta = dateMs - this.now();
    return delta > 0 ? delta : undefined;
  }
  async parseResponse(response) {
    const text = await response.text();
    const parsed = JSON.parse(text);
    if (typeof parsed != "object" || parsed === null || Array.isArray(parsed))
      throw new Error("unexpected response shape");
    const results = parsed.results;
    if (results !== undefined && (typeof results != "object" || results === null || Array.isArray(results)))
      throw new Error("unexpected results shape");
    return {
      results: results ?? {}
    };
  }
  async buildHttpError(response, status, waitFor) {
    let bodyText = "";
    try {
      bodyText = (await waitFor(response.text())).slice(0, 512);
    } catch {}
    const suffix = bodyText ? `: ${bodyText}` : "";
    return new Error(`Capture V1 request failed with HTTP ${status}${suffix}`);
  }
  surfaceBatchFailure(requestId, drops, pending, cause) {
    this.onError(new CaptureV1Error({
      requestId,
      drops,
      retryExhausted: pending.map((event) => event.uuid),
      cause
    }));
  }
  surfacePartialDrops(requestId, drops) {
    if (drops.length > 0)
      this.onError(new CaptureV1Error({
        requestId,
        drops,
        retryExhausted: []
      }));
  }
  async cancelBody(response) {
    try {
      await response.body?.cancel();
    } catch {}
  }
}
var V1_ANALYTICS_PATH = "/i/v1/analytics/events", DEFAULT_MAX_BACKOFF_MS = 30000, RETRYABLE_STATUSES;
var init_sender = __esm(() => {
  init_dist();
  init_errors();
  init_transform();
  RETRYABLE_STATUSES = new Set([
    408,
    500,
    502,
    503,
    504
  ]);
});

// node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/ai-capture/routing.mjs
var AI_CAPTURE_ROUTE = "ai-capture", AI_CAPTURE_ENDPOINT_PATH = "/i/v0/ai/batch/", AI_MAX_EVENT_BYTES = 8388608, AI_BATCH_TARGET_BYTES = 5242880;
var init_routing2 = () => {};

// node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/ai-capture/batching.mjs
function eventByteSize(message) {
  return encoder.encode(safeJsonStringify(message)).length;
}
function partitionAiBatch(messages, maxEventBytes = AI_MAX_EVENT_BYTES, targetBatchBytes = AI_BATCH_TARGET_BYTES) {
  const batches = [];
  const dropped = [];
  let current = [];
  let currentBytes = 0;
  for (const message of messages) {
    if (message === undefined)
      continue;
    const bytes = eventByteSize(message);
    if (bytes > maxEventBytes) {
      dropped.push({
        event: typeof message.event == "string" ? message.event : "unknown",
        bytes
      });
      continue;
    }
    if (current.length > 0 && currentBytes + bytes > targetBatchBytes) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(message);
    currentBytes += bytes;
  }
  if (current.length > 0)
    batches.push(current);
  return {
    batches,
    dropped
  };
}
var encoder;
var init_batching = __esm(() => {
  init_dist();
  init_routing2();
  encoder = new TextEncoder;
});

// node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/client.mjs
function emitDeprecationWarningOnce(id, message) {
  if (_emittedDeprecations.has(id))
    return;
  _emittedDeprecations.add(id);
  console.warn(`[PostHog] ${message}`);
}
function normalizeApiKey(value) {
  return typeof value == "string" ? value.trim() : "";
}
function normalizePersonalApiKey(value) {
  const normalizedValue = typeof value == "string" ? value.trim() : "";
  return normalizedValue || undefined;
}
function normalizeHost(value) {
  const normalizedValue = typeof value == "string" ? value.trim() : "";
  return normalizedValue || DEFAULT_NODE_HOST;
}
function normalizeUnsetPersonProperties(value) {
  const propertyNames = Array.isArray(value) ? value : [
    value
  ];
  return propertyNames.filter((propertyName) => typeof propertyName == "string" && propertyName.trim().length > 0);
}
function buildFlagEventProperties(flagValues) {
  if (!flagValues)
    return {};
  const additionalProperties = {};
  for (const [feature, variant] of Object.entries(flagValues))
    additionalProperties[`$feature/${feature}`] = variant;
  const activeFlags = Object.keys(flagValues).filter((flag) => flagValues[flag] !== false).sort();
  if (activeFlags.length > 0)
    additionalProperties["$active_feature_flags"] = activeFlags;
  return additionalProperties;
}
var MINIMUM_POLLING_INTERVAL = 100, THIRTY_SECONDS = 30000, MAX_CACHE_SIZE = 50000, WAITUNTIL_DEBOUNCE_MS = 50, WAITUNTIL_MAX_WAIT_MS = 500, DEFAULT_NODE_HOST = "https://us.i.posthog.com", _emittedDeprecations, PostHogBackendClient;
var init_client = __esm(() => {
  init_version();
  init_dist();
  init_types3();
  init_feature_flag_evaluations();
  init_feature_flags();
  init_error_tracking2();
  init_storage_memory();
  init_config2();
  init_routing();
  init_sender();
  init_batching();
  init_routing2();
  _emittedDeprecations = new Set;
  PostHogBackendClient = class PostHogBackendClient extends PostHogCoreStateless {
    constructor(apiKey, options = {}) {
      const normalizedApiKey = normalizeApiKey(apiKey);
      const normalizedOptions = {
        ...options,
        maxQueueSize: options.maxQueueSize ?? 1e4,
        flushInterval: options.flushInterval ?? 5000,
        host: normalizeHost(options.host),
        personalApiKey: normalizePersonalApiKey(options.secretKey ?? options.personalApiKey)
      };
      super(normalizedApiKey, normalizedOptions), this._memoryStorage = new PostHogMemoryStorage, this._aiCaptureRouteActive = false, this._minimalFlagCalledEvents = false;
      this.options = normalizedOptions;
      this.captureMode = resolveCaptureMode();
      this.enableFullAiCapture = normalizedOptions.enableFullAiCapture === true;
      this.context = this.initializeContext();
      this.options.featureFlagsPollingInterval = typeof normalizedOptions.featureFlagsPollingInterval == "number" ? Math.max(normalizedOptions.featureFlagsPollingInterval, MINIMUM_POLLING_INTERVAL) : THIRTY_SECONDS;
      if (typeof normalizedOptions.waitUntilDebounceMs == "number")
        this.options.waitUntilDebounceMs = Math.max(normalizedOptions.waitUntilDebounceMs, 0);
      if (typeof normalizedOptions.waitUntilMaxWaitMs == "number")
        this.options.waitUntilMaxWaitMs = Math.max(normalizedOptions.waitUntilMaxWaitMs, 0);
      if (!this.disabled && normalizedOptions.personalApiKey) {
        if (normalizedOptions.personalApiKey.includes("phc_"))
          throw new Error('Your Personal API key is invalid. These keys are prefixed with "phx_" and can be created in PostHog project settings.');
        const shouldEnableLocalEvaluation = normalizedOptions.enableLocalEvaluation !== false;
        if (shouldEnableLocalEvaluation)
          this.featureFlagsPoller = new FeatureFlagsPoller({
            pollingInterval: this.options.featureFlagsPollingInterval,
            personalApiKey: normalizedOptions.personalApiKey,
            projectApiKey: normalizedApiKey,
            timeout: normalizedOptions.requestTimeout ?? 1e4,
            host: this.host,
            fetch: normalizedOptions.fetch,
            onError: (err) => {
              this._events.emit("error", err);
            },
            onLoad: (count) => {
              this._events.emit("localEvaluationFlagsLoaded", count);
            },
            onMinimalFlagCalledEvents: (enabled) => {
              this._minimalFlagCalledEvents = enabled;
            },
            customHeaders: this.getCustomHeaders(),
            cacheProvider: normalizedOptions.flagDefinitionCacheProvider,
            strictLocalEvaluation: normalizedOptions.strictLocalEvaluation
          });
      }
      this.errorTracking = new error_tracking_ErrorTracking(this, normalizedOptions, this._logger);
      this.distinctIdHasSentFlagCalls = {};
      this.maxCacheSize = normalizedOptions.maxCacheSize || MAX_CACHE_SIZE;
    }
    enqueue(type, message, options, explicitRoute) {
      super.enqueue(type, message, options, explicitRoute);
      this.scheduleDebouncedFlush();
    }
    async flush() {
      const flushPromise = this.flushWithPendingPromises();
      const waitUntil = this.options.waitUntil;
      if (waitUntil && !this._waitUntilCycle)
        try {
          waitUntil(flushPromise.catch(() => {}));
        } catch {}
      return flushPromise;
    }
    scheduleDebouncedFlush() {
      const waitUntil = this.options.waitUntil;
      if (!waitUntil)
        return;
      if (this.disabled || this.optedOut)
        return;
      if (!this._waitUntilCycle) {
        let resolve;
        const promise = new Promise((r) => {
          resolve = r;
        });
        try {
          waitUntil(promise);
        } catch {
          return;
        }
        this._waitUntilCycle = {
          resolve,
          startedAt: Date.now(),
          timer: undefined
        };
      }
      const elapsed = Date.now() - this._waitUntilCycle.startedAt;
      const maxWaitMs = this.options.waitUntilMaxWaitMs ?? WAITUNTIL_MAX_WAIT_MS;
      const flushNow = elapsed >= maxWaitMs;
      if (this._waitUntilCycle.timer !== undefined)
        clearTimeout(this._waitUntilCycle.timer);
      if (flushNow)
        return void this.resolveWaitUntilFlush();
      const debounceMs = this.options.waitUntilDebounceMs ?? WAITUNTIL_DEBOUNCE_MS;
      this._waitUntilCycle.timer = safeSetTimeout(() => {
        this.resolveWaitUntilFlush();
      }, debounceMs);
    }
    _consumeWaitUntilCycle() {
      const cycle = this._waitUntilCycle;
      if (cycle) {
        clearTimeout(cycle.timer);
        this._waitUntilCycle = undefined;
      }
      return cycle?.resolve;
    }
    async resolveWaitUntilFlush() {
      const resolve = this._consumeWaitUntilCycle();
      try {
        await this.flushWithPendingPromises();
      } catch {} finally {
        resolve?.();
      }
    }
    getPersistedProperty(key) {
      return this._memoryStorage.getProperty(key);
    }
    setPersistedProperty(key, value) {
      return this._memoryStorage.setProperty(key, value);
    }
    fetch(url, options) {
      return this.options.fetch ? this.options.fetch(url, options) : fetch(url, options);
    }
    getQueueRouteKey(message) {
      return this.captureMode === "v1" && isLegacyOnlyEvent(message) ? AI_ROUTE : ANALYTICS_ROUTE;
    }
    persistedQueueKeyForRoute(route) {
      if (route === AI_CAPTURE_ROUTE)
        return types_PostHogPersistedProperty.AiCaptureQueue;
      return route === AI_ROUTE ? types_PostHogPersistedProperty.AiQueue : types_PostHogPersistedProperty.Queue;
    }
    getActiveQueueRoutes() {
      const routes = this.captureMode === "v1" ? [
        ANALYTICS_ROUTE,
        AI_ROUTE
      ] : [
        ANALYTICS_ROUTE
      ];
      if (this._aiCaptureRouteActive)
        routes.push(AI_CAPTURE_ROUTE);
      return routes;
    }
    getBatchEndpointPath(route) {
      return route === AI_CAPTURE_ROUTE ? AI_CAPTURE_ENDPOINT_PATH : super.getBatchEndpointPath(route);
    }
    async sendBatch(batchMessages, retryOptions, route = ANALYTICS_ROUTE) {
      if (route === AI_CAPTURE_ROUTE)
        return this.sendAiCaptureBatch(batchMessages, retryOptions);
      if (this.captureMode !== "v1" || route === AI_ROUTE)
        return super.sendBatch(batchMessages, retryOptions, route);
      const v1Events = batchMessages.filter((message) => message !== undefined);
      await this.getV1Sender().sendV1Batch(v1Events);
    }
    async sendAiCaptureBatch(batchMessages, retryOptions) {
      const { batches, dropped } = partitionAiBatch(batchMessages);
      for (const { event, bytes } of dropped) {
        const message = `Event ${event} (${bytes} bytes) exceeds the ${AI_MAX_EVENT_BYTES / 1048576}MiB limit for ${AI_CAPTURE_ENDPOINT_PATH}, dropping.`;
        this._logger.error(message);
        this._events.emit("error", new Error(message));
      }
      for (const batch of batches)
        await this.sendAiSubBatch(batch, retryOptions);
    }
    async sendAiSubBatch(batch, retryOptions) {
      try {
        await super.sendBatch(batch, retryOptions, AI_CAPTURE_ROUTE);
      } catch (err) {
        if (!isPostHogFetchContentTooLargeError(err))
          throw err;
        if (batch.length === 1) {
          const [event] = batch;
          const eventName = typeof event.event == "string" ? event.event : "unknown";
          const message = `Event ${eventName} (${eventByteSize(event)} bytes) was rejected with 413 by ${AI_CAPTURE_ENDPOINT_PATH} on its own, dropping.`;
          this._logger.error(message);
          this._events.emit("error", new Error(message));
          return;
        }
        const mid = Math.ceil(batch.length / 2);
        await this.sendAiSubBatch(batch.slice(0, mid), retryOptions);
        await this.sendAiSubBatch(batch.slice(mid), retryOptions);
      }
    }
    getV1Sender() {
      if (!this._v1Sender)
        this._v1Sender = new V1CaptureSender({
          host: this.host,
          apiKey: this.apiKey,
          libraryId: this.getLibraryId(),
          libraryVersion: this.getLibraryVersion(),
          userAgent: this.getCustomUserAgent() || undefined,
          historicalMigration: this.historicalMigration,
          compressionEnabled: !this.disableCompression,
          requestTimeoutMs: this.requestTimeout,
          maxAttempts: (this.options.fetchRetryCount ?? 3) + 1,
          initialRetryDelayMs: this.options.fetchRetryDelay ?? 3000,
          isDebug: this.isDebug
        }, {
          fetch: (url, fetchOptions) => this.fetch(url, fetchOptions),
          onError: (error) => this._events.emit("error", error),
          compress: (payload) => this.compressPayload(payload)
        });
      return this._v1Sender;
    }
    getLibraryVersion() {
      return version2;
    }
    get metrics() {
      if (!this._metrics)
        this._metrics = new PostHogMetrics(this, resolveMetricsConfig(this.options.metrics), this._logger);
      return this._metrics;
    }
    getCustomUserAgent() {
      return `${this.getLibraryId()}/${this.getLibraryVersion()}`;
    }
    getCommonEventProperties() {
      const commonProperties = super.getCommonEventProperties();
      if (this.options.isServer ?? true)
        commonProperties.$is_server = true;
      return commonProperties;
    }
    enable() {
      return super.optIn();
    }
    disable() {
      return super.optOut();
    }
    debug(enabled = true) {
      super.debug(enabled);
      this.featureFlagsPoller?.debug(enabled);
    }
    _warnIfInvalidCapture(props, stringArgumentWarning, exceptionCaptureWarning) {
      if (typeof props == "string")
        this._logger.warn(stringArgumentWarning);
      if (props.event === "$exception" && !props._originatedFromCaptureException)
        this._logger.warn(exceptionCaptureWarning);
    }
    _sendPreparedEvent(type, props, immediate, prepareOptions, explicitRoute) {
      return this.addPendingPromise(this._prepareEventMessage(props, prepareOptions).then(({ distinctId, event, properties, options }) => {
        const captureOptions = {
          timestamp: options.timestamp,
          disableGeoip: options.disableGeoip,
          uuid: options.uuid
        };
        const message = {
          distinctId,
          event,
          properties: {
            ...properties,
            ...this.getCommonEventProperties()
          }
        };
        return immediate ? this.sendImmediate(type, message, captureOptions, explicitRoute) : this.enqueue(type, message, captureOptions, explicitRoute);
      }).catch((err) => {
        if (err)
          console.error(err);
      }));
    }
    _capturePreparedEvent(props, immediate) {
      return this._sendPreparedEvent("capture", props, immediate);
    }
    capture(props) {
      this._warnIfInvalidCapture(props, "Called capture() with a string as the first argument when an object was expected.", "Using `posthog.capture('$exception')` is unreliable because it does not attach required metadata. Use `posthog.captureException(error)` instead, which attaches required metadata automatically.");
      this._capturePreparedEvent(props, false);
    }
    async captureImmediate(props) {
      this._warnIfInvalidCapture(props, "Called captureImmediate() with a string as the first argument when an object was expected.", "Capturing a `$exception` event via `posthog.captureImmediate('$exception')` is unreliable because it does not attach required metadata. Use `posthog.captureExceptionImmediate(error)` instead, which attaches this metadata by default.");
      return this._capturePreparedEvent(props, true);
    }
    captureAi(props) {
      if (this.disabled)
        return;
      const uuid = getEventUuid(props.uuid, uuidv7);
      this._sendPreparedAiEvent({
        ...props,
        uuid
      }, false);
      return uuid;
    }
    async captureAiImmediate(props) {
      if (this.disabled)
        return;
      const uuid = getEventUuid(props.uuid, uuidv7);
      await this._sendPreparedAiEvent({
        ...props,
        uuid
      }, true);
      return uuid;
    }
    _sendPreparedAiEvent(props, immediate) {
      if (typeof props?.event == "string" && !props.event.startsWith("$ai_"))
        this._logger.debug(`captureAi called with non-AI event ${props.event}; routing it to the AI endpoint anyway.`);
      this._aiCaptureRouteActive = true;
      return this._sendPreparedEvent("capture", props, immediate, undefined, AI_CAPTURE_ROUTE);
    }
    identify({ distinctId, properties = {}, disableGeoip }) {
      const { $set, $set_once, $anon_distinct_id, ...rest } = properties;
      const setProps = $set || rest;
      const setOnceProps = $set_once || {};
      const eventProperties = {
        $set: setProps,
        $set_once: setOnceProps,
        $anon_distinct_id: $anon_distinct_id ?? undefined
      };
      this._sendPreparedEvent("identify", {
        distinctId,
        event: "$identify",
        properties: eventProperties,
        disableGeoip
      }, false, {
        includeContextProperties: false
      });
    }
    async identifyImmediate({ distinctId, properties = {}, disableGeoip }) {
      const { $set, $set_once, $anon_distinct_id, ...rest } = properties;
      const setProps = $set || rest;
      const setOnceProps = $set_once || {};
      const eventProperties = {
        $set: setProps,
        $set_once: setOnceProps,
        $anon_distinct_id: $anon_distinct_id ?? undefined
      };
      await this._sendPreparedEvent("identify", {
        distinctId,
        event: "$identify",
        properties: eventProperties,
        disableGeoip
      }, true, {
        includeContextProperties: false
      });
    }
    setPersonProperties({ distinctId, properties = {}, propertiesOnce = {} }) {
      if (Object.keys(properties).length === 0 && Object.keys(propertiesOnce).length === 0)
        return;
      const eventProperties = {};
      if (Object.keys(properties).length > 0)
        eventProperties.$set = properties;
      if (Object.keys(propertiesOnce).length > 0)
        eventProperties.$set_once = propertiesOnce;
      this.capture({
        distinctId,
        event: "$set",
        properties: eventProperties
      });
    }
    unsetPersonProperties({ distinctId, properties }) {
      const propertyNames = normalizeUnsetPersonProperties(properties);
      if (propertyNames.length === 0)
        return;
      this.capture({
        distinctId,
        event: "$set",
        properties: {
          $unset: propertyNames
        }
      });
    }
    alias(data) {
      this._sendPreparedEvent("alias", {
        distinctId: data.distinctId,
        event: "$create_alias",
        properties: {
          distinct_id: data.distinctId,
          alias: data.alias
        },
        disableGeoip: data.disableGeoip
      }, false, {
        includeContextProperties: false
      });
    }
    async aliasImmediate(data) {
      await this._sendPreparedEvent("alias", {
        distinctId: data.distinctId,
        event: "$create_alias",
        properties: {
          distinct_id: data.distinctId,
          alias: data.alias
        },
        disableGeoip: data.disableGeoip
      }, true, {
        includeContextProperties: false
      });
    }
    isLocalEvaluationReady() {
      return this.featureFlagsPoller?.isLocalEvaluationReady() ?? false;
    }
    async waitForLocalEvaluationReady(timeoutMs = THIRTY_SECONDS) {
      if (this.isLocalEvaluationReady())
        return true;
      if (this.featureFlagsPoller === undefined)
        return false;
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          cleanup();
          resolve(false);
        }, timeoutMs);
        const cleanup = this._events.on("localEvaluationFlagsLoaded", (count) => {
          clearTimeout(timeout);
          cleanup();
          resolve(count > 0);
        });
      });
    }
    _resolveDistinctId(distinctIdOrOptions, options) {
      if (typeof distinctIdOrOptions == "string")
        return {
          distinctId: distinctIdOrOptions,
          options
        };
      return {
        distinctId: this.context?.get()?.distinctId,
        options: distinctIdOrOptions
      };
    }
    async _getFeatureFlagResult(key, distinctId, options = {}, matchValue) {
      if (this.disabled)
        return void this._logger.warn("The client is disabled");
      const sendFeatureFlagEvents = options.sendFeatureFlagEvents ?? true;
      if (this._flagOverrides !== undefined && key in this._flagOverrides) {
        const overrideValue = this._flagOverrides[key];
        if (overrideValue === undefined)
          return;
        const overridePayload = this._payloadOverrides?.[key];
        return {
          key,
          enabled: overrideValue !== false,
          variant: typeof overrideValue == "string" ? overrideValue : undefined,
          payload: overridePayload
        };
      }
      const { groups, disableGeoip } = options;
      let { onlyEvaluateLocally, personProperties, groupProperties } = options;
      const adjustedProperties = this.addLocalPersonAndGroupProperties(distinctId, groups, personProperties, groupProperties);
      personProperties = adjustedProperties.allPersonProperties;
      groupProperties = adjustedProperties.allGroupProperties;
      const evaluationContext = this.createFeatureFlagEvaluationContext(distinctId, groups, this.personPropertiesForLocalEvaluation(distinctId, personProperties), groupProperties);
      if (onlyEvaluateLocally == undefined)
        onlyEvaluateLocally = this.options.strictLocalEvaluation ?? false;
      let result;
      let flagWasLocallyEvaluated = false;
      let requestId;
      let evaluatedAt;
      let featureFlagError;
      let flagId;
      let flagVersion;
      let flagReason;
      let flagHasExperiment;
      const localEvaluationEnabled = this.featureFlagsPoller !== undefined;
      if (localEvaluationEnabled) {
        await this.featureFlagsPoller?.loadFeatureFlags();
        const flag = this.featureFlagsPoller?.featureFlagsByKey[key];
        if (flag)
          try {
            const localResult = await this.featureFlagsPoller?.computeFlagAndPayloadLocally(flag, evaluationContext, {
              matchValue
            });
            if (localResult) {
              flagWasLocallyEvaluated = true;
              const value = localResult.value;
              flagId = flag.id;
              flagReason = "Evaluated locally";
              flagHasExperiment = flag.has_experiment;
              result = {
                key,
                enabled: value !== false,
                variant: typeof value == "string" ? value : undefined,
                payload: localResult.payload ?? undefined
              };
            }
          } catch (e) {
            if (e instanceof RequiresServerEvaluation || e instanceof InconclusiveMatchError)
              this._logger?.info(`${e.name} when computing flag locally: ${key}: ${e.message}`);
            else
              throw e;
          }
      }
      if (!flagWasLocallyEvaluated && !onlyEvaluateLocally) {
        const flagsResponse = await super.getFeatureFlagDetailsStateless(evaluationContext.distinctId, evaluationContext.groups, personProperties, groupProperties, disableGeoip, [
          key
        ]);
        if (flagsResponse === undefined)
          featureFlagError = FeatureFlagError2.UNKNOWN_ERROR;
        else {
          this._minimalFlagCalledEvents = flagsResponse.minimalFlagCalledEvents === true;
          requestId = flagsResponse.requestId;
          evaluatedAt = flagsResponse.evaluatedAt;
          const errors = [];
          if (flagsResponse.errorsWhileComputingFlags)
            errors.push(FeatureFlagError2.ERRORS_WHILE_COMPUTING);
          if (flagsResponse.quotaLimited?.includes("feature_flags"))
            errors.push(FeatureFlagError2.QUOTA_LIMITED);
          const flagDetail = flagsResponse.flags[key];
          if (flagDetail === undefined)
            errors.push(FeatureFlagError2.FLAG_MISSING);
          else {
            flagId = flagDetail.metadata?.id;
            flagVersion = flagDetail.metadata?.version;
            flagReason = flagDetail.reason?.description ?? flagDetail.reason?.code;
            flagHasExperiment = flagDetail.metadata?.has_experiment;
            let parsedPayload;
            if (flagDetail.metadata?.payload !== undefined)
              try {
                parsedPayload = JSON.parse(flagDetail.metadata.payload);
              } catch {
                parsedPayload = flagDetail.metadata.payload;
              }
            result = {
              key,
              enabled: flagDetail.enabled,
              variant: flagDetail.variant ?? undefined,
              payload: parsedPayload
            };
          }
          if (errors.length > 0)
            featureFlagError = errors.join(",");
        }
      }
      if (sendFeatureFlagEvents) {
        const response = result === undefined ? undefined : result.enabled === false ? false : result.variant ?? true;
        const properties = {
          $feature_flag: key,
          $feature_flag_response: response,
          $feature_flag_id: flagId,
          $feature_flag_version: flagVersion,
          $feature_flag_reason: flagReason,
          locally_evaluated: flagWasLocallyEvaluated,
          [`$feature/${key}`]: response,
          $feature_flag_request_id: requestId,
          $feature_flag_evaluated_at: flagWasLocallyEvaluated ? Date.now() : evaluatedAt
        };
        if (flagHasExperiment !== undefined)
          properties.$feature_flag_has_experiment = flagHasExperiment;
        if (flagWasLocallyEvaluated && this.featureFlagsPoller) {
          const flagDefinitionsLoadedAt = this.featureFlagsPoller.getFlagDefinitionsLoadedAt();
          if (flagDefinitionsLoadedAt !== undefined)
            properties.$feature_flag_definitions_loaded_at = flagDefinitionsLoadedAt;
        }
        if (featureFlagError)
          properties.$feature_flag_error = featureFlagError;
        this._captureFlagCalledEventIfNeeded({
          distinctId,
          key,
          response,
          groups,
          disableGeoip,
          properties
        });
      }
      if (result !== undefined && this._payloadOverrides !== undefined && key in this._payloadOverrides)
        result = {
          ...result,
          payload: this._payloadOverrides[key]
        };
      return result;
    }
    async getFeatureFlag(key, distinctId, options) {
      emitDeprecationWarningOnce("getFeatureFlag", "`getFeatureFlag` is deprecated and will be removed in a future major version. Use `posthog.evaluateFlags(distinctId, ...)` and call `flags.getFlag(key)` instead — this consolidates flag evaluation into a single `/flags` request per incoming request.");
      const result = await this._getFeatureFlagResult(key, distinctId, {
        ...options,
        sendFeatureFlagEvents: options?.sendFeatureFlagEvents ?? this.options.sendFeatureFlagEvent ?? true
      });
      if (result === undefined)
        return;
      if (result.enabled === false)
        return false;
      return result.variant ?? true;
    }
    async getFeatureFlagPayload(key, distinctId, matchValue, options) {
      emitDeprecationWarningOnce("getFeatureFlagPayload", "`getFeatureFlagPayload` is deprecated and will be removed in a future major version. Use `posthog.evaluateFlags(distinctId, ...)` and call `flags.getFlagPayload(key)` instead — this consolidates flag evaluation into a single `/flags` request per incoming request.");
      if (this._payloadOverrides !== undefined && key in this._payloadOverrides)
        return this._payloadOverrides[key];
      const result = await this._getFeatureFlagResult(key, distinctId, {
        ...options,
        sendFeatureFlagEvents: false
      }, matchValue);
      if (result === undefined)
        return;
      return result.payload ?? null;
    }
    async getFeatureFlagResult(key, distinctIdOrOptions, options) {
      const { distinctId: resolvedDistinctId, options: resolvedOptions } = this._resolveDistinctId(distinctIdOrOptions, options);
      if (!resolvedDistinctId)
        return void this._logger.warn("[PostHog] distinctId is required — pass it explicitly or use withContext()");
      return this._getFeatureFlagResult(key, resolvedDistinctId, {
        ...resolvedOptions,
        sendFeatureFlagEvents: resolvedOptions?.sendFeatureFlagEvents ?? this.options.sendFeatureFlagEvent ?? true
      });
    }
    async getRemoteConfigPayload(flagKey) {
      if (this.disabled)
        return void this._logger.warn("The client is disabled");
      if (!this.options.personalApiKey)
        throw new Error("Personal API key is required for remote config payload decryption");
      const response = await this._requestRemoteConfigPayload(flagKey);
      if (!response)
        return;
      const parsed = await response.json();
      if (typeof parsed == "string")
        try {
          return JSON.parse(parsed);
        } catch (e) {}
      return parsed;
    }
    async isFeatureEnabled(key, distinctId, options) {
      emitDeprecationWarningOnce("isFeatureEnabled", "`isFeatureEnabled` is deprecated and will be removed in a future major version. Use `posthog.evaluateFlags(distinctId, ...)` and call `flags.isEnabled(key)` instead — this consolidates flag evaluation into a single `/flags` request per incoming request.");
      const result = await this._getFeatureFlagResult(key, distinctId, {
        ...options,
        sendFeatureFlagEvents: options?.sendFeatureFlagEvents ?? this.options.sendFeatureFlagEvent ?? true
      });
      if (result === undefined)
        return;
      if (result.enabled === false)
        return false;
      const feat = result.variant ?? true;
      return !!feat || false;
    }
    async getAllFlags(distinctIdOrOptions, options) {
      const { distinctId: resolvedDistinctId, options: resolvedOptions } = this._resolveDistinctId(distinctIdOrOptions, options);
      if (!resolvedDistinctId) {
        this._logger.warn("[PostHog] distinctId is required to get feature flags — pass it explicitly or use withContext()");
        return {};
      }
      const response = await this.getAllFlagsAndPayloads(resolvedDistinctId, resolvedOptions);
      return response.featureFlags || {};
    }
    async getAllFlagsAndPayloads(distinctIdOrOptions, options) {
      const { distinctId: resolvedDistinctId, options: resolvedOptions } = this._resolveDistinctId(distinctIdOrOptions, options);
      if (!resolvedDistinctId) {
        this._logger.warn("[PostHog] distinctId is required to get feature flags and payloads — pass it explicitly or use withContext()");
        return {
          featureFlags: {},
          featureFlagPayloads: {}
        };
      }
      if (this.disabled) {
        this._logger.warn("The client is disabled");
        return {
          featureFlags: {},
          featureFlagPayloads: {}
        };
      }
      const { groups, disableGeoip, flagKeys } = resolvedOptions || {};
      let { onlyEvaluateLocally, personProperties, groupProperties } = resolvedOptions || {};
      const adjustedProperties = this.addLocalPersonAndGroupProperties(resolvedDistinctId, groups, personProperties, groupProperties);
      personProperties = adjustedProperties.allPersonProperties;
      groupProperties = adjustedProperties.allGroupProperties;
      const evaluationContext = this.createFeatureFlagEvaluationContext(resolvedDistinctId, groups, this.personPropertiesForLocalEvaluation(resolvedDistinctId, personProperties), groupProperties);
      if (onlyEvaluateLocally == undefined)
        onlyEvaluateLocally = this.options.strictLocalEvaluation ?? false;
      const localEvaluationResult = await this.featureFlagsPoller?.getAllFlagsAndPayloads(evaluationContext, flagKeys);
      let featureFlags = {};
      let featureFlagPayloads = {};
      let fallbackToFlags = true;
      if (localEvaluationResult) {
        featureFlags = localEvaluationResult.response;
        featureFlagPayloads = localEvaluationResult.payloads;
        fallbackToFlags = localEvaluationResult.fallbackToFlags;
      }
      if (fallbackToFlags && !onlyEvaluateLocally) {
        const remoteEvaluationResult = await super.getFeatureFlagsAndPayloadsStateless(evaluationContext.distinctId, evaluationContext.groups, personProperties, groupProperties, disableGeoip, flagKeys);
        featureFlags = {
          ...featureFlags,
          ...remoteEvaluationResult.flags || {}
        };
        featureFlagPayloads = {
          ...featureFlagPayloads,
          ...remoteEvaluationResult.payloads || {}
        };
      }
      if (this._flagOverrides !== undefined)
        featureFlags = {
          ...featureFlags,
          ...this._flagOverrides
        };
      if (this._payloadOverrides !== undefined)
        featureFlagPayloads = {
          ...featureFlagPayloads,
          ...this._payloadOverrides
        };
      return {
        featureFlags,
        featureFlagPayloads
      };
    }
    async evaluateFlags(distinctIdOrOptions, options) {
      const { distinctId: resolvedDistinctId, options: resolvedOptions } = this._resolveDistinctId(distinctIdOrOptions, options);
      if (!resolvedDistinctId) {
        this._logger.warn("[PostHog] distinctId is required to evaluate feature flags — pass it explicitly or use withContext()");
        return new FeatureFlagEvaluations({
          host: this._getFeatureFlagEvaluationsHost(),
          distinctId: "",
          flags: {}
        });
      }
      if (this.disabled) {
        this._logger.warn("The client is disabled");
        return new FeatureFlagEvaluations({
          host: this._getFeatureFlagEvaluationsHost(),
          distinctId: resolvedDistinctId,
          flags: {}
        });
      }
      const { groups, disableGeoip, flagKeys } = resolvedOptions || {};
      let { onlyEvaluateLocally, personProperties, groupProperties } = resolvedOptions || {};
      const adjustedProperties = this.addLocalPersonAndGroupProperties(resolvedDistinctId, groups, personProperties, groupProperties);
      personProperties = adjustedProperties.allPersonProperties;
      groupProperties = adjustedProperties.allGroupProperties;
      const evaluationContext = this.createFeatureFlagEvaluationContext(resolvedDistinctId, groups, this.personPropertiesForLocalEvaluation(resolvedDistinctId, personProperties), groupProperties);
      if (onlyEvaluateLocally == undefined)
        onlyEvaluateLocally = this.options.strictLocalEvaluation ?? false;
      const requestedFlagKeys = flagKeys ? new Set(flagKeys) : undefined;
      const records = {};
      let requestId;
      let evaluatedAt;
      let errorsWhileComputing = false;
      let quotaLimited = false;
      const localResult = await this.featureFlagsPoller?.getAllFlagsAndPayloads(evaluationContext, flagKeys);
      const locallyEvaluatedKeys = new Set;
      if (localResult)
        for (const [key, value] of Object.entries(localResult.response)) {
          const flagDef = this.featureFlagsPoller?.featureFlagsByKey[key];
          records[key] = {
            key,
            enabled: value !== false,
            variant: typeof value == "string" ? value : undefined,
            payload: localResult.payloads[key],
            id: flagDef?.id,
            version: undefined,
            reason: "Evaluated locally",
            locallyEvaluated: true,
            hasExperiment: flagDef?.has_experiment
          };
          locallyEvaluatedKeys.add(key);
        }
      const requestedFlagMissingLocally = requestedFlagKeys !== undefined && Array.from(requestedFlagKeys).some((key) => this.featureFlagsPoller?.featureFlagsByKey[key] === undefined);
      const fallbackToFlags = localResult ? localResult.fallbackToFlags || requestedFlagMissingLocally : true;
      if (fallbackToFlags && !onlyEvaluateLocally) {
        const details = await super.getFeatureFlagDetailsStateless(evaluationContext.distinctId, evaluationContext.groups, personProperties, groupProperties, disableGeoip, flagKeys);
        if (details) {
          this._minimalFlagCalledEvents = details.minimalFlagCalledEvents === true;
          requestId = details.requestId;
          evaluatedAt = details.evaluatedAt;
          errorsWhileComputing = Boolean(details.errorsWhileComputingFlags);
          quotaLimited = Array.isArray(details.quotaLimited) && details.quotaLimited.includes("feature_flags");
          for (const [key, detail] of Object.entries(details.flags)) {
            if (locallyEvaluatedKeys.has(key))
              continue;
            let parsedPayload;
            if (detail.metadata?.payload !== undefined)
              try {
                parsedPayload = JSON.parse(detail.metadata.payload);
              } catch {
                parsedPayload = detail.metadata.payload;
              }
            records[key] = {
              key,
              enabled: detail.enabled,
              variant: detail.variant,
              payload: parsedPayload,
              id: detail.metadata?.id,
              version: detail.metadata?.version,
              reason: detail.reason?.description ?? detail.reason?.code,
              locallyEvaluated: false,
              hasExperiment: detail.metadata?.has_experiment
            };
          }
        }
      }
      if (this._flagOverrides !== undefined)
        for (const [key, value] of Object.entries(this._flagOverrides)) {
          if (value === undefined) {
            delete records[key];
            continue;
          }
          const existing = records[key];
          records[key] = {
            key,
            enabled: value !== false,
            variant: typeof value == "string" ? value : undefined,
            payload: existing?.payload,
            id: existing?.id,
            version: existing?.version,
            reason: existing?.reason,
            locallyEvaluated: existing?.locallyEvaluated ?? false,
            hasExperiment: existing?.hasExperiment
          };
        }
      if (this._payloadOverrides !== undefined)
        for (const [key, payload] of Object.entries(this._payloadOverrides)) {
          const existing = records[key];
          if (existing)
            records[key] = {
              ...existing,
              payload
            };
        }
      if (requestedFlagKeys !== undefined) {
        for (const key of Object.keys(records))
          if (!requestedFlagKeys.has(key))
            delete records[key];
      }
      return new FeatureFlagEvaluations({
        host: this._getFeatureFlagEvaluationsHost(),
        distinctId: resolvedDistinctId,
        groups,
        disableGeoip,
        flags: records,
        requestId,
        evaluatedAt,
        flagDefinitionsLoadedAt: this.featureFlagsPoller?.getFlagDefinitionsLoadedAt(),
        errorsWhileComputing,
        quotaLimited
      });
    }
    _shouldSendMinimalFlagCalledEvent(event, properties) {
      return event === "$feature_flag_called" && this._minimalFlagCalledEvents && properties.$feature_flag_has_experiment === false;
    }
    _captureFlagCalledEventIfNeeded(params) {
      const { distinctId, key, response, groups, disableGeoip, properties } = params;
      const groupSuffix = groups && Object.keys(groups).length > 0 ? `_${JSON.stringify(Object.entries(groups).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))}` : "";
      const featureFlagReportedKey = `${key}_${response}${groupSuffix}`;
      if (distinctId in this.distinctIdHasSentFlagCalls && this.distinctIdHasSentFlagCalls[distinctId].has(featureFlagReportedKey))
        return;
      if (Object.keys(this.distinctIdHasSentFlagCalls).length >= this.maxCacheSize)
        this.distinctIdHasSentFlagCalls = {};
      if (this.distinctIdHasSentFlagCalls[distinctId] instanceof Set)
        this.distinctIdHasSentFlagCalls[distinctId].add(featureFlagReportedKey);
      else
        this.distinctIdHasSentFlagCalls[distinctId] = new Set([
          featureFlagReportedKey
        ]);
      this.capture({
        distinctId,
        event: "$feature_flag_called",
        properties,
        groups,
        disableGeoip
      });
    }
    _getFeatureFlagEvaluationsHost() {
      if (!this._featureFlagEvaluationsHost)
        this._featureFlagEvaluationsHost = {
          captureFlagCalledEventIfNeeded: (params) => this._captureFlagCalledEventIfNeeded(params),
          logWarning: (message) => {
            if (this.options.featureFlagsLogWarnings !== false)
              console.warn(`[PostHog] ${message}`);
          }
        };
      return this._featureFlagEvaluationsHost;
    }
    groupIdentify({ groupType, groupKey, properties, distinctId, disableGeoip }) {
      this._sendPreparedEvent("capture", {
        distinctId: distinctId || `$${groupType}_${groupKey}`,
        event: "$groupidentify",
        properties: {
          $group_type: groupType,
          $group_key: groupKey,
          $group_set: properties || {}
        },
        disableGeoip
      }, false, {
        includeContextProperties: false
      });
    }
    async groupIdentifyImmediate({ groupType, groupKey, properties, distinctId, disableGeoip }) {
      await this._sendPreparedEvent("capture", {
        distinctId: distinctId || `$${groupType}_${groupKey}`,
        event: "$groupidentify",
        properties: {
          $group_type: groupType,
          $group_key: groupKey,
          $group_set: properties || {}
        },
        disableGeoip
      }, true, {
        includeContextProperties: false
      });
    }
    async reloadFeatureFlags() {
      await this.featureFlagsPoller?.loadFeatureFlags(true);
    }
    overrideFeatureFlags(overrides) {
      const flagArrayToRecord = (flags) => Object.fromEntries(flags.map((f) => [
        f,
        true
      ]));
      if (overrides === false) {
        this._flagOverrides = undefined;
        this._payloadOverrides = undefined;
        return;
      }
      if (Array.isArray(overrides)) {
        this._flagOverrides = flagArrayToRecord(overrides);
        return;
      }
      if (this._isFeatureFlagOverrideOptions(overrides)) {
        if ("flags" in overrides) {
          if (overrides.flags === false)
            this._flagOverrides = undefined;
          else if (Array.isArray(overrides.flags))
            this._flagOverrides = flagArrayToRecord(overrides.flags);
          else if (overrides.flags !== undefined)
            this._flagOverrides = {
              ...overrides.flags
            };
        }
        if ("payloads" in overrides) {
          if (overrides.payloads === false)
            this._payloadOverrides = undefined;
          else if (overrides.payloads !== undefined)
            this._payloadOverrides = {
              ...overrides.payloads
            };
        }
        return;
      }
      this._flagOverrides = {
        ...overrides
      };
    }
    _isFeatureFlagOverrideOptions(overrides) {
      if (typeof overrides != "object" || overrides === null || Array.isArray(overrides))
        return false;
      const obj = overrides;
      if ("flags" in obj) {
        const flagsValue = obj["flags"];
        if (flagsValue === false || Array.isArray(flagsValue) || typeof flagsValue == "object" && flagsValue !== null)
          return true;
      }
      if ("payloads" in obj) {
        const payloadsValue = obj["payloads"];
        if (payloadsValue === false || typeof payloadsValue == "object" && payloadsValue !== null)
          return true;
      }
      return false;
    }
    withContext(data, fn, options) {
      if (!this.context)
        return fn();
      return this.context.run(data, fn, options);
    }
    getContext() {
      return this.context?.get();
    }
    enterContext(data, options) {
      this.context?.enter(data, options);
    }
    async _shutdown(shutdownTimeoutMs) {
      const shutdownDeadlineMs = Date.now() + (shutdownTimeoutMs ?? 30000);
      const resolve = this._consumeWaitUntilCycle();
      await this.featureFlagsPoller?.stopPoller(shutdownTimeoutMs);
      this.errorTracking.shutdown();
      if (this._metrics) {
        await raceWithTimeout(this._metrics.flush().catch(() => {}), Math.max(0, shutdownDeadlineMs - Date.now()));
        this._metrics.reset();
      }
      try {
        return await super._shutdown(Math.max(0, shutdownDeadlineMs - Date.now()));
      } finally {
        this.distinctIdHasSentFlagCalls = {};
        resolve?.();
      }
    }
    async _requestRemoteConfigPayload(flagKey) {
      if (this.disabled || !this.apiKey || !this.options.personalApiKey)
        return;
      const url = `${this.host}/api/projects/@current/feature_flags/${flagKey}/remote_config?token=${encodeURIComponent(this.apiKey)}`;
      const options = {
        method: "GET",
        headers: {
          ...this.getCustomHeaders(),
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.options.personalApiKey}`
        }
      };
      let abortTimeout = null;
      if (this.options.requestTimeout && typeof this.options.requestTimeout == "number") {
        const controller = new AbortController;
        abortTimeout = safeSetTimeout(() => {
          controller.abort();
        }, this.options.requestTimeout);
        options.signal = controller.signal;
      }
      try {
        return await this.fetch(url, options);
      } catch (error) {
        this._events.emit("error", error);
        return;
      } finally {
        if (abortTimeout)
          clearTimeout(abortTimeout);
      }
    }
    extractPropertiesFromEvent(eventProperties, groups) {
      if (!eventProperties)
        return {
          personProperties: {},
          groupProperties: {}
        };
      const personProperties = {};
      const groupProperties = {};
      for (const [key, value] of Object.entries(eventProperties))
        if (isPlainObject3(value) && groups && key in groups) {
          const groupProps = {};
          for (const [groupKey, groupValue] of Object.entries(value))
            groupProps[String(groupKey)] = String(groupValue);
          groupProperties[String(key)] = groupProps;
        } else
          personProperties[String(key)] = String(value);
      return {
        personProperties,
        groupProperties
      };
    }
    async getFeatureFlagsForEvent(distinctId, groups, disableGeoip, sendFeatureFlagsOptions) {
      if (this.disabled || !this.apiKey)
        return void this._logger.warn("The client is disabled");
      const finalPersonProperties = sendFeatureFlagsOptions?.personProperties || {};
      const finalGroupProperties = sendFeatureFlagsOptions?.groupProperties || {};
      const flagKeys = sendFeatureFlagsOptions?.flagKeys;
      const onlyEvaluateLocally = sendFeatureFlagsOptions?.onlyEvaluateLocally ?? this.options.strictLocalEvaluation ?? false;
      if (onlyEvaluateLocally)
        if (!((this.featureFlagsPoller?.featureFlags?.length || 0) > 0))
          return {};
        else {
          const groupsWithStringValues = {};
          for (const [key, value] of Object.entries(groups || {}))
            groupsWithStringValues[key] = String(value);
          return await this.getAllFlags(distinctId, {
            groups: groupsWithStringValues,
            personProperties: finalPersonProperties,
            groupProperties: finalGroupProperties,
            disableGeoip,
            onlyEvaluateLocally: true,
            flagKeys
          });
        }
      if ((this.featureFlagsPoller?.featureFlags?.length || 0) > 0) {
        const groupsWithStringValues = {};
        for (const [key, value] of Object.entries(groups || {}))
          groupsWithStringValues[key] = String(value);
        return await this.getAllFlags(distinctId, {
          groups: groupsWithStringValues,
          personProperties: finalPersonProperties,
          groupProperties: finalGroupProperties,
          disableGeoip,
          onlyEvaluateLocally: true,
          flagKeys
        });
      }
      return (await super.getFeatureFlagsStateless(distinctId, groups, finalPersonProperties, finalGroupProperties, disableGeoip)).flags;
    }
    addLocalPersonAndGroupProperties(distinctId, groups, personProperties, groupProperties) {
      const allPersonProperties = {
        ...personProperties || {}
      };
      const allGroupProperties = {};
      if (groups)
        for (const groupName of Object.keys(groups))
          allGroupProperties[groupName] = {
            $group_key: groups[groupName],
            ...groupProperties?.[groupName] || {}
          };
      return {
        allPersonProperties,
        allGroupProperties
      };
    }
    personPropertiesForLocalEvaluation(distinctId, personProperties) {
      return {
        distinct_id: distinctId,
        ...personProperties || {}
      };
    }
    createFeatureFlagEvaluationContext(distinctId, groups, personProperties, groupProperties) {
      return {
        distinctId,
        groups: groups || {},
        personProperties: personProperties || {},
        groupProperties: groupProperties || {},
        evaluationCache: {}
      };
    }
    captureException(error, distinctId, additionalProperties, uuid, flags) {
      if (!error_tracking_ErrorTracking.isPreviouslyCapturedError(error)) {
        const syntheticException = new Error("PostHog syntheticException");
        this.addPendingPromise(error_tracking_ErrorTracking.buildEventMessage(this.getErrorPropertiesBuilder(), error, {
          syntheticException
        }, distinctId, additionalProperties).then((msg) => this._capturePreparedEvent({
          ...msg,
          uuid,
          flags
        }, false)));
      }
    }
    async captureExceptionImmediate(error, distinctId, additionalProperties, flags) {
      if (!error_tracking_ErrorTracking.isPreviouslyCapturedError(error)) {
        const syntheticException = new Error("PostHog syntheticException");
        return this.addPendingPromise(error_tracking_ErrorTracking.buildEventMessage(this.getErrorPropertiesBuilder(), error, {
          syntheticException
        }, distinctId, additionalProperties).then((msg) => this.captureImmediate({
          ...msg,
          flags
        })));
      }
    }
    async prepareEventMessage(props) {
      return this._prepareEventMessage(props);
    }
    async _prepareEventMessage(props, options = {}) {
      const { distinctId, event, properties, groups, flags, sendFeatureFlags, timestamp, disableGeoip, uuid } = props;
      const contextData = this.context?.get();
      const includeContextProperties = options.includeContextProperties ?? true;
      let mergedDistinctId = distinctId || contextData?.distinctId;
      const mergedProperties = includeContextProperties ? {
        ...this.props,
        ...contextData?.properties || {},
        ...properties || {}
      } : {
        ...properties || {}
      };
      if (!mergedDistinctId) {
        mergedDistinctId = uuidv7();
        mergedProperties.$process_person_profile = false;
      }
      if (includeContextProperties && contextData?.sessionId && !mergedProperties.$session_id)
        mergedProperties.$session_id = contextData.sessionId;
      const finalProperties = this._shouldSendMinimalFlagCalledEvent(event, mergedProperties) ? minimizeFlagCalledEventProperties(mergedProperties) : mergedProperties;
      const eventMessage = this._runBeforeSend({
        distinctId: mergedDistinctId,
        event,
        properties: finalProperties,
        groups,
        flags,
        sendFeatureFlags,
        timestamp,
        disableGeoip,
        uuid
      });
      if (!eventMessage)
        return Promise.reject(null);
      const eventProperties = await Promise.resolve().then(async () => {
        if (flags) {
          if (sendFeatureFlags)
            console.warn("[PostHog] Both `flags` and `sendFeatureFlags` were passed to capture(); using `flags` and ignoring `sendFeatureFlags`.");
          return flags._getEventProperties();
        }
        if (sendFeatureFlags) {
          emitDeprecationWarningOnce("sendFeatureFlags", "`sendFeatureFlags` is deprecated and will be removed in a future major version. Pass a `flags` snapshot from `posthog.evaluateFlags(...)` instead — it avoids a second `/flags` request per capture and guarantees the event carries the exact flag values your code branched on.");
          const sendFeatureFlagsOptions = typeof sendFeatureFlags == "object" ? sendFeatureFlags : undefined;
          const flagValues = await this.getFeatureFlagsForEvent(eventMessage.distinctId, groups, disableGeoip, sendFeatureFlagsOptions);
          return buildFlagEventProperties(flagValues);
        }
        return {};
      }).catch(() => ({})).then((additionalProperties) => {
        const resolvedGroups = eventMessage.groups || groups;
        return {
          ...additionalProperties,
          ...eventMessage.properties || {},
          ...resolvedGroups !== undefined && Object.keys(resolvedGroups).length > 0 ? {
            $groups: resolvedGroups
          } : {}
        };
      });
      if (eventMessage.event === "$pageview" && this.options.__preview_capture_bot_pageviews && typeof eventProperties.$raw_user_agent == "string") {
        if (isBlockedUA(eventProperties.$raw_user_agent, this.options.custom_blocked_useragents || [])) {
          eventMessage.event = "$bot_pageview";
          eventProperties.$browser_type = "bot";
        }
      }
      return {
        distinctId: eventMessage.distinctId,
        event: eventMessage.event,
        properties: eventProperties,
        options: {
          timestamp: eventMessage.timestamp,
          disableGeoip: eventMessage.disableGeoip,
          uuid: eventMessage.uuid
        }
      };
    }
    _runBeforeSend(eventMessage) {
      const beforeSend = this.options.before_send;
      if (!beforeSend)
        return eventMessage;
      const fns = Array.isArray(beforeSend) ? beforeSend : [
        beforeSend
      ];
      let result = eventMessage;
      for (const fn of fns)
        try {
          result = fn(result);
          if (!result) {
            this._logger.info(`Event '${eventMessage.event}' was rejected in beforeSend function`);
            return null;
          }
          if (!result.properties || Object.keys(result.properties).length === 0) {
            const message = `Event '${result.event}' has no properties after beforeSend function, this is likely an error.`;
            this._logger.warn(message);
          }
        } catch (error) {
          this._logger.error(`Error in before_send function for event '${eventMessage.event}':`, error);
          return null;
        }
      return result;
    }
  };
});

// node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/extensions/context/context.mjs
import { AsyncLocalStorage } from "node:async_hooks";

class PostHogContext {
  constructor() {
    this.storage = new AsyncLocalStorage;
  }
  get() {
    return this.storage.getStore();
  }
  run(context, fn, options) {
    return this.storage.run(this.resolve(context, options), fn);
  }
  enter(context, options) {
    this.storage.enterWith(this.resolve(context, options));
  }
  resolve(context, options) {
    if (options?.fresh === true)
      return context;
    const current = this.get() || {};
    return {
      distinctId: context.distinctId ?? current.distinctId,
      sessionId: context.sessionId ?? current.sessionId,
      properties: {
        ...current.properties || {},
        ...context.properties || {}
      }
    };
  }
}
var init_context = () => {};

// node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/gzip.node.mjs
import { gzip } from "node:zlib";
import { promisify } from "node:util";
async function gzipCompress2(input, isDebug = true) {
  try {
    const compressed = await gzipAsync(input);
    return new Uint8Array(compressed);
  } catch (error) {
    if (isDebug)
      console.error("Failed to gzip compress data", error);
    return null;
  }
}
var gzipAsync;
var init_gzip_node = __esm(() => {
  gzipAsync = promisify(gzip);
});

// node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/extensions/sentry-integration.mjs
function createEventProcessor(_posthog, { organization, projectId, prefix, severityAllowList = [
  "error"
], sendExceptionsToPostHog = true } = {}) {
  return (event) => {
    const shouldProcessLevel = severityAllowList === "*" || severityAllowList.includes(event.level);
    if (!shouldProcessLevel)
      return event;
    if (!event.tags)
      event.tags = {};
    const userId = event.tags[PostHogSentryIntegration.POSTHOG_ID_TAG];
    if (userId === undefined)
      return event;
    const uiHost = _posthog.options.host ?? "https://us.i.posthog.com";
    const personUrl = new URL(`/project/${_posthog.apiKey}/person/${userId}`, uiHost).toString();
    event.tags["PostHog Person URL"] = personUrl;
    const exceptions = event.exception?.values || [];
    const exceptionList = exceptions.map((exception) => ({
      ...exception,
      stacktrace: exception.stacktrace ? {
        ...exception.stacktrace,
        type: "raw",
        frames: (exception.stacktrace.frames || []).map((frame) => ({
          ...frame,
          platform: "node:javascript"
        }))
      } : undefined
    }));
    const properties = {
      $exception_message: exceptions[0]?.value || event.message,
      $exception_type: exceptions[0]?.type,
      $exception_level: event.level,
      $exception_list: exceptionList,
      $sentry_event_id: event.event_id,
      $sentry_exception: event.exception,
      $sentry_exception_message: exceptions[0]?.value || event.message,
      $sentry_exception_type: exceptions[0]?.type,
      $sentry_tags: event.tags
    };
    const injectedReleaseId = getInjectedReleaseId();
    if (injectedReleaseId)
      properties.$release_id = injectedReleaseId;
    if (organization && projectId)
      properties["$sentry_url"] = (prefix || "https://sentry.io/organizations/") + organization + "/issues/?project=" + projectId + "&query=" + event.event_id;
    if (sendExceptionsToPostHog)
      _posthog.capture({
        event: "$exception",
        distinctId: userId,
        properties
      });
    return event;
  };
}
var NAME = "posthog-node", PostHogSentryIntegration;
var init_sentry_integration = __esm(() => {
  init_dist();
  PostHogSentryIntegration = class PostHogSentryIntegration {
    static #_ = this.POSTHOG_ID_TAG = "posthog_distinct_id";
    constructor(_posthog, organization, prefix, severityAllowList, sendExceptionsToPostHog) {
      this.name = NAME;
      this.name = NAME;
      this.setupOnce = function(addGlobalEventProcessor, getCurrentHub) {
        const projectId = getCurrentHub()?.getClient()?.getDsn()?.projectId;
        addGlobalEventProcessor(createEventProcessor(_posthog, {
          organization,
          projectId,
          prefix,
          severityAllowList,
          sendExceptionsToPostHog: sendExceptionsToPostHog ?? true
        }));
      };
    }
  };
});

// node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/extensions/tracing-headers.mjs
var init_tracing_headers2 = () => {};

// node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/extensions/url-utils.mjs
var init_url_utils = __esm(() => {
  init_dist();
});

// node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/extensions/express.mjs
var init_express = __esm(() => {
  init_error_tracking2();
  init_tracing_headers2();
  init_url_utils();
});

// node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/exports.mjs
var init_exports = __esm(() => {
  init_feature_flag_evaluations();
  init_dist();
  init_sentry_integration();
  init_express();
  init_types3();
});

// node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/entrypoints/index.node.mjs
var PostHog;
var init_index_node = __esm(() => {
  init_module_node();
  init_context_lines_node();
  init_relative_path_node();
  init_client();
  init_dist();
  init_context();
  init_gzip_node();
  init_exports();
  PostHog = class PostHog extends PostHogBackendClient {
    getLibraryId() {
      return "posthog-node";
    }
    compressPayload(payload) {
      return gzipCompress2(payload, this.isDebug);
    }
    initializeContext() {
      return new PostHogContext;
    }
    createErrorPropertiesBuilder() {
      return new ErrorPropertiesBuilder([
        new EventCoercer,
        new ErrorCoercer,
        new ObjectCoercer,
        new StringCoercer,
        new PrimitiveCoercer
      ], createStackParser("node:javascript", nodeStackLineParser), [
        createModulerModifier(),
        (frames) => addSourceContext(frames, undefined, this._logger),
        createRelativePathModifier()
      ]);
    }
  };
});

// packages/telemetry-core/src/machine-id.ts
import { createHash as createHash4 } from "node:crypto";
import os2 from "node:os";
function getDefaultTelemetryOsProvider() {
  return os2;
}
function getTelemetryDistinctId(machineIdPrefix, osProvider = getDefaultTelemetryOsProvider()) {
  return createHash4("sha256").update(`${machineIdPrefix}${osProvider.hostname()}`).digest("hex");
}
var init_machine_id = () => {};

// packages/telemetry-core/src/posthog-client.ts
class PostHogTelemetryTransport {
  #client;
  constructor(apiKey, options) {
    this.#client = new PostHog(apiKey, options);
  }
  capture(message) {
    this.#client.capture(message);
  }
  async flush() {
    await this.#client.flush();
  }
  async shutdown() {
    await this.#client.shutdown();
  }
}
function createDefaultPostHogTransport(apiKey, options) {
  return new PostHogTelemetryTransport(apiKey, options);
}
function isTelemetryClientEnabled(input) {
  const env = input.env ?? process.env;
  return !shouldDisableTelemetry({ env, productEnvPrefix: input.product.productEnvPrefix }) && hasTelemetryApiKey(env, input.product.defaultApiKey);
}
function createTelemetryClient(input) {
  if (!isTelemetryClientEnabled(input)) {
    return NO_OP_CLIENT;
  }
  const transport = createTransport(input);
  if (transport === null) {
    return NO_OP_CLIENT;
  }
  const sharedProperties = getSharedProperties(input);
  return {
    enabled: true,
    trackActive: ({ dayUTC, distinctId, reason }) => {
      try {
        transport.capture({
          distinctId,
          event: input.product.eventName,
          properties: {
            ...sharedProperties,
            $process_person_profile: false,
            day_utc: dayUTC,
            reason
          }
        });
      } catch (error) {
        input.diagnostics?.({
          event: "telemetry_capture_failed",
          source: input.source,
          error,
          errorKind: error instanceof Error ? "error" : "non_error"
        });
      }
    },
    flush: async () => {
      if (transport.flush === undefined) {
        return;
      }
      await transport.flush();
    },
    shutdown: async () => {
      try {
        await transport.shutdown();
      } catch (error) {
        input.diagnostics?.({
          event: "telemetry_shutdown_failed",
          source: input.source,
          error,
          errorKind: error instanceof Error ? "error" : "non_error"
        });
      }
    }
  };
}
function createTransport(input) {
  const env = input.env ?? process.env;
  const factory = input.transportFactory ?? createDefaultPostHogTransport;
  try {
    return factory(getTelemetryApiKey(env, input.product.defaultApiKey), {
      enableExceptionAutocapture: false,
      enableLocalEvaluation: false,
      strictLocalEvaluation: true,
      disableRemoteConfig: true,
      flushAt: 1,
      flushInterval: 0,
      host: getTelemetryHost(env, input.product.defaultHost),
      disableGeoip: input.product.disableGeoip ?? false,
      ...input.product.transportOptions
    });
  } catch (error) {
    input.diagnostics?.({
      event: "telemetry_posthog_init_failed",
      source: input.source,
      error,
      errorKind: error instanceof Error ? "error" : "non_error"
    });
    return null;
  }
}
function getSharedProperties(input) {
  const osProvider = input.osProvider ?? getDefaultTelemetryOsProvider();
  const cpuInfo = getSafeCpuInfo(osProvider, input);
  return {
    platform: input.product.platform,
    product_name: input.product.productName,
    package_name: input.product.packageName,
    package_version: input.product.packageVersion,
    runtime: "bun",
    runtime_version: process.versions.bun ?? process.version,
    source: input.source,
    $os: osProvider.platform(),
    $os_version: osProvider.release(),
    os_arch: osProvider.arch(),
    os_type: osProvider.type(),
    cpu_count: cpuInfo.count,
    cpu_model: cpuInfo.model,
    total_memory_gb: Math.round(osProvider.totalmem() / 1024 / 1024 / 1024),
    locale: Intl.DateTimeFormat().resolvedOptions().locale,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    shell: process.env.SHELL,
    ci: Boolean(process.env.CI),
    terminal: process.env.TERM_PROGRAM,
    ...input.product.additionalProperties
  };
}
function getSafeCpuInfo(osProvider, input) {
  try {
    const cpuInfo = osProvider.cpus();
    return {
      count: cpuInfo.length,
      model: cpuInfo[0]?.model
    };
  } catch (error) {
    input.diagnostics?.({
      event: "telemetry_cpu_info_unavailable",
      source: "shared",
      error,
      errorKind: error instanceof Error ? "error" : "non_error"
    });
    return {
      count: 0,
      model: undefined
    };
  }
}
var NO_OP_CLIENT;
var init_posthog_client = __esm(() => {
  init_index_node();
  init_env();
  init_machine_id();
  NO_OP_CLIENT = {
    enabled: false,
    trackActive: () => {
      return;
    },
    flush: async () => {
      return;
    },
    shutdown: async () => {
      return;
    }
  };
});

// packages/telemetry-core/src/events.ts
var ALLOWED_DOLLAR_KEYS;
var init_events = __esm(() => {
  ALLOWED_DOLLAR_KEYS = new Set([
    "$os",
    "$os_version",
    "$process_person_profile",
    "$session_id"
  ]);
});

// packages/telemetry-core/src/record-daily-active.ts
var init_record_daily_active = () => {};

// packages/telemetry-core/src/index.ts
var init_src = __esm(() => {
  init_activity_state();
  init_diagnostics();
  init_env();
  init_events();
  init_machine_id();
  init_posthog_client();
  init_record_daily_active();
});

// packages/omo-codex/package.json
var package_default;
var init_package = __esm(() => {
  package_default = {
    name: "@oh-my-opencode/omo-codex",
    version: "5.0.0-beta.62",
    type: "module",
    private: true,
    description: "Codex harness adapter for oh-my-openagent. Vendored Codex plugin namespace (omo) + TypeScript installer + telemetry.",
    exports: {
      ".": {
        types: "./index.d.ts",
        import: "./src/index.ts"
      },
      "./telemetry": {
        types: "./src/telemetry/index.ts",
        import: "./src/telemetry/index.ts"
      },
      "./install": {
        types: "./src/install/index.ts",
        import: "./src/install/index.ts"
      },
      "./install/*": {
        types: "./src/install/*.ts",
        import: "./src/install/*.ts"
      },
      "./marketplace.json": "./marketplace.json"
    },
    types: "./index.d.ts",
    scripts: {
      typecheck: "tsgo --noEmit -p tsconfig.json",
      test: "bun test src/**/*.test.ts",
      "build:plugin": "bun run --cwd plugin build",
      "sync:skills": "node plugin/scripts/sync-skills.mjs"
    },
    dependencies: {
      "@oh-my-opencode/shared-skills": "workspace:*",
      "@oh-my-opencode/utils": "workspace:*"
    },
    devDependencies: {
      "bun-types": "1.4.2"
    }
  };
});

// packages/omo-codex/src/telemetry/product-identity.ts
function getProductVersion() {
  return package_default.version;
}
function createCodexTelemetryProductConfig(packageVersion = getProductVersion(), additionalProperties) {
  const product = {
    cacheDirName: CACHE_DIR_NAME,
    defaultApiKey: DEFAULT_POSTHOG_API_KEY,
    defaultHost: DEFAULT_POSTHOG_HOST,
    eventName: EVENT_NAME,
    machineIdPrefix: MACHINE_ID_PREFIX,
    packageName: PACKAGE_NAME,
    packageVersion,
    platform: "omo-codex",
    productEnvPrefix: PRODUCT_ENV_PREFIX,
    productName: PRODUCT_NAME
  };
  if (additionalProperties === undefined) {
    return product;
  }
  return {
    ...product,
    additionalProperties
  };
}
var PRODUCT_NAME = "omo-codex", PACKAGE_NAME = "@oh-my-opencode/omo-codex", CACHE_DIR_NAME = "omo-codex", EVENT_NAME = "omo_codex_daily_active", PRODUCT_ENV_PREFIX = "OMO_CODEX", MACHINE_ID_PREFIX = "omo-codex:";
var init_product_identity = __esm(() => {
  init_src();
  init_package();
});

// packages/omo-codex/src/telemetry/data-path.ts
function getOsProvider() {
  return osProviderOverride ?? undefined;
}
function getActivityStateDir() {
  return resolveTelemetryStateDir(createCodexTelemetryProductConfig(), {
    env: process.env,
    osProvider: getOsProvider()
  });
}
var osProviderOverride = null;
var init_data_path = __esm(() => {
  init_src();
  init_product_identity();
});

// packages/omo-codex/src/telemetry/diagnostics.ts
function writeTelemetryDiagnostic2(input, now = new Date) {
  writeTelemetryDiagnostic(input, {
    diagnosticsDir: getActivityStateDir(),
    now
  });
}
var init_diagnostics2 = __esm(() => {
  init_src();
  init_data_path();
});

// packages/omo-codex/src/telemetry/posthog-activity-state.ts
function getPostHogActivityCaptureState(now = new Date) {
  return getDailyActiveCaptureState({
    diagnostics: writeTelemetryDiagnostic2,
    now,
    stateDir: getActivityStateDir()
  });
}
var init_posthog_activity_state = __esm(() => {
  init_src();
  init_data_path();
  init_diagnostics2();
});

// packages/omo-codex/src/telemetry/posthog.ts
function resolveOsProvider() {
  return osProviderOverride2 ?? getDefaultTelemetryOsProvider();
}
function resolveActivityStateProvider(options) {
  if (options.activityStateProvider !== undefined) {
    return options.activityStateProvider;
  }
  if (activityStateProviderOverride !== null) {
    return activityStateProviderOverride;
  }
  if (options.now === undefined && options.stateDir === undefined) {
    return getPostHogActivityCaptureState;
  }
  return () => getPostHogActivityCaptureState(options.now ?? new Date);
}
function createPostHogClient(source, options = {}) {
  const client = createTelemetryClient({
    diagnostics: writeTelemetryDiagnostic2,
    env: options.env ?? process.env,
    osProvider: options.osProvider ?? resolveOsProvider(),
    product: createCodexTelemetryProductConfig(),
    source,
    transportFactory: options.transportFactory ?? transportFactoryOverride ?? undefined
  });
  if (!client.enabled) {
    return NO_OP_POSTHOG;
  }
  const activityStateProvider = resolveActivityStateProvider(options);
  return {
    trackActive: (distinctId, reason) => {
      const activityState = options.stateDir === undefined ? activityStateProvider() : getDailyActiveCaptureState({
        diagnostics: writeTelemetryDiagnostic2,
        now: options.now,
        stateDir: options.stateDir
      });
      if (!activityState.captureDaily) {
        return;
      }
      client.trackActive({
        dayUTC: activityState.dayUTC,
        distinctId,
        reason
      });
    },
    shutdown: async () => {
      await client.shutdown();
    }
  };
}
function getPostHogDistinctId() {
  return getTelemetryDistinctId(MACHINE_ID_PREFIX, resolveOsProvider());
}
function createInstallPostHog() {
  return createPostHogClient("install");
}
var osProviderOverride2 = null, activityStateProviderOverride = null, transportFactoryOverride = null, NO_OP_POSTHOG;
var init_posthog = __esm(() => {
  init_src();
  init_diagnostics2();
  init_posthog_activity_state();
  init_product_identity();
  NO_OP_POSTHOG = {
    trackActive: () => {
      return;
    },
    shutdown: async () => {
      return;
    }
  };
});

// packages/omo-codex/src/telemetry/index.ts
var init_telemetry = __esm(() => {
  init_posthog();
});

// packages/omo-codex/src/install/install-local-cli.ts
import { readFile as readFile24 } from "node:fs/promises";
import { dirname as dirname13, join as join39, resolve as resolve11 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// packages/utils/src/runtime/spawn.ts
import {
  spawn as nodeSpawn,
  spawnSync as nodeSpawnSync
} from "node:child_process";
import { Writable } from "node:stream";
var runtime = globalThis;
function getBunRuntime() {
  return runtime.Bun;
}
function emptyReadableStream() {
  return new ReadableStream({
    start(controller) {
      controller.close();
    }
  });
}
function toUint8Array(chunk) {
  if (chunk instanceof Uint8Array)
    return new Uint8Array(chunk);
  return new TextEncoder().encode(String(chunk));
}
function toReadableStream(stream) {
  if (!stream)
    return emptyReadableStream();
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          controller.enqueue(toUint8Array(chunk));
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    }
  });
}
function emptyWritableStream() {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    }
  });
}
function isOptionsWithCommand(value) {
  return typeof value === "object" && value !== null && "cmd" in value && Array.isArray(value.cmd);
}
function resolveCommand(cmdOrOpts, optsArg) {
  if (isOptionsWithCommand(cmdOrOpts))
    return { cmd: cmdOrOpts.cmd, opts: cmdOrOpts };
  return { cmd: cmdOrOpts, opts: optsArg ?? {} };
}
function resolveStdio(options) {
  if (options.stdio) {
    const [stdin, stdout, stderr] = options.stdio;
    return [stdin, stdout, stderr];
  }
  return [options.stdin ?? "ignore", options.stdout ?? "pipe", options.stderr ?? "inherit"];
}
function createNodeSpawnOptions(options, platform = process.platform) {
  const nodeOptions = {
    stdio: resolveStdio(options),
    shell: false
  };
  if (options.cwd !== undefined)
    nodeOptions.cwd = options.cwd;
  if (options.env !== undefined)
    nodeOptions.env = options.env;
  if (options.detached !== undefined)
    nodeOptions.detached = options.detached;
  if (options.signal !== undefined)
    nodeOptions.signal = options.signal;
  if (platform === "win32")
    nodeOptions.windowsHide = true;
  return nodeOptions;
}
function wrapNodeProcess(proc) {
  let exitCode = null;
  const exited = new Promise((resolve, reject) => {
    proc.on("exit", (code) => {
      exitCode = code ?? 1;
      resolve(exitCode);
    });
    proc.on("error", (error) => {
      if (exitCode === null) {
        exitCode = 1;
        reject(error);
      }
    });
  });
  return {
    get exitCode() {
      return exitCode;
    },
    exited,
    stdout: toReadableStream(proc.stdout),
    stderr: toReadableStream(proc.stderr),
    stdin: proc.stdin ?? emptyWritableStream(),
    pid: proc.pid,
    kill(signal) {
      if (proc.killed || exitCode !== null)
        return;
      proc.kill(signal);
    },
    ref() {
      proc.ref();
    },
    unref() {
      proc.unref();
    }
  };
}
function wrapBunProcess(proc) {
  let exitCode = proc.exitCode;
  const exited = proc.exited.then((code) => {
    if (typeof code === "number") {
      exitCode = code;
      return code;
    }
    exitCode = proc.exitCode ?? 0;
    return exitCode;
  });
  return {
    ...proc,
    get exitCode() {
      return exitCode ?? proc.exitCode;
    },
    exited,
    stdout: proc.stdout ?? emptyReadableStream(),
    stderr: proc.stderr ?? emptyReadableStream(),
    stdin: proc.stdin ?? emptyWritableStream(),
    pid: proc.pid,
    kill(signal) {
      proc.kill?.(signal);
    },
    ref() {
      proc.ref?.();
    },
    unref() {
      proc.unref?.();
    }
  };
}
function spawn(cmdOrOpts, opts) {
  const { cmd, opts: options } = resolveCommand(cmdOrOpts, opts);
  const bun = getBunRuntime();
  if (bun)
    return wrapBunProcess(bun.spawn(cmd, options));
  const [bin, ...args] = cmd;
  if (!bin)
    throw new Error("spawn requires a command");
  return wrapNodeProcess(nodeSpawn(bin, args, createNodeSpawnOptions(options)));
}

// packages/utils/src/runtime/git-bash.ts
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
var GIT_BASH_ENV_KEY = "OMO_CODEX_GIT_BASH_PATH";
var PROGRAM_FILES_GIT_BASH = "C:\\Program Files\\Git\\bin\\bash.exe";
var PROGRAM_FILES_X86_GIT_BASH = "C:\\Program Files (x86)\\Git\\bin\\bash.exe";
var NON_GIT_BASH_LAUNCHER_DIR_SEGMENTS = ["\\windows\\system32\\", "\\microsoft\\windowsapps\\"];
function resolveGitBash(input) {
  if (input.platform !== "win32")
    return { found: true, path: null, source: "not-required", checkedPaths: [] };
  const checkedPaths = [];
  const envPath = nonEmptyEnvValue(input.env, GIT_BASH_ENV_KEY);
  if (envPath !== undefined) {
    checkedPaths.push(envPath);
    if (isBashExePath(envPath) && input.exists(envPath)) {
      return { found: true, path: envPath, source: "env", checkedPaths };
    }
    return missingGitBash(checkedPaths);
  }
  for (const candidate of [
    { path: PROGRAM_FILES_GIT_BASH, source: "program-files" },
    { path: PROGRAM_FILES_X86_GIT_BASH, source: "program-files-x86" }
  ]) {
    checkedPaths.push(candidate.path);
    if (input.exists(candidate.path))
      return { found: true, path: candidate.path, source: candidate.source, checkedPaths };
  }
  for (const pathCandidate of input.where("bash")) {
    const candidate = pathCandidate.trim();
    if (candidate.length === 0)
      continue;
    checkedPaths.push(candidate);
    if (isKnownNonGitBashLauncher(candidate))
      continue;
    if (isBashExePath(candidate) && input.exists(candidate))
      return { found: true, path: candidate, source: "path", checkedPaths };
  }
  return missingGitBash(checkedPaths);
}
var resolveGitBashForCurrentProcess = (input = {}) => {
  return resolveGitBash({
    platform: input.platform ?? process.platform,
    env: input.env ?? process.env,
    exists: existsSync,
    where: whereCommand
  });
};
function missingGitBash(checkedPaths) {
  return {
    found: false,
    checkedPaths,
    installHint: [
      "Git Bash is required on native Windows.",
      "Install it with: winget install --id Git.Git -e --source winget",
      `For a custom install, set ${GIT_BASH_ENV_KEY}=C:\\path\\to\\bash.exe`
    ].join(`
`)
  };
}
function nonEmptyEnvValue(env, key) {
  const value = env[key];
  if (value === undefined)
    return;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}
function isBashExePath(path) {
  return path.toLowerCase().endsWith("bash.exe");
}
function isKnownNonGitBashLauncher(path) {
  const normalized = path.replaceAll("/", "\\").toLowerCase();
  return NON_GIT_BASH_LAUNCHER_DIR_SEGMENTS.some((segment) => normalized.includes(segment));
}
function whereCommand(command) {
  try {
    return execFileSync("where", [command], { encoding: "utf8" }).split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  } catch (error) {
    if (error instanceof Error)
      return [];
    throw error;
  }
}
// packages/omo-codex/src/install/codex-process.ts
var WINDOWS_CMD_SHIM_COMMANDS = new Set(["codex", "npm", "npx"]);
function resolveRunCommandInvocation(command, args, platform = process.platform) {
  if (platform !== "win32" || !WINDOWS_CMD_SHIM_COMMANDS.has(command.toLowerCase())) {
    return { command, args: [...args] };
  }
  return {
    command: "cmd.exe",
    args: ["/d", "/s", "/c", `${command}.cmd`, ...args]
  };
}
var defaultRunCommand = async (command, args, options) => {
  const invocation = resolveRunCommandInvocation(command, args);
  const proc = spawn({
    cmd: [invocation.command, ...invocation.args],
    cwd: options.cwd,
    env: options.env,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit"
  });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed in ${options.cwd} with exit code ${code}`);
  }
};

// packages/omo-codex/src/install/install-codex.ts
import { join as join35, resolve as resolve10 } from "node:path";

// node_modules/.bun/zod@4.4.3/node_modules/zod/v4/core/core.js
var _a;
function $constructor(name, initializer, params) {
  function init(inst, def) {
    if (!inst._zod) {
      Object.defineProperty(inst, "_zod", {
        value: {
          def,
          constr: _,
          traits: new Set
        },
        enumerable: false
      });
    }
    if (inst._zod.traits.has(name)) {
      return;
    }
    inst._zod.traits.add(name);
    initializer(inst, def);
    const proto = _.prototype;
    const keys = Object.keys(proto);
    for (let i = 0;i < keys.length; i++) {
      const k = keys[i];
      if (!(k in inst)) {
        inst[k] = proto[k].bind(inst);
      }
    }
  }
  const Parent = params?.Parent ?? Object;

  class Definition extends Parent {
  }
  Object.defineProperty(Definition, "name", { value: name });
  function _(def) {
    var _a;
    const inst = params?.Parent ? new Definition : this;
    init(inst, def);
    (_a = inst._zod).deferred ?? (_a.deferred = []);
    for (const fn of inst._zod.deferred) {
      fn();
    }
    return inst;
  }
  Object.defineProperty(_, "init", { value: init });
  Object.defineProperty(_, Symbol.hasInstance, {
    value: (inst) => {
      if (params?.Parent && inst instanceof params.Parent)
        return true;
      return inst?._zod?.traits?.has(name);
    }
  });
  Object.defineProperty(_, "name", { value: name });
  return _;
}
var $brand = Symbol("zod_brand");

class $ZodAsyncError extends Error {
  constructor() {
    super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
  }
}

class $ZodEncodeError extends Error {
  constructor(name) {
    super(`Encountered unidirectional transform during encode: ${name}`);
    this.name = "ZodEncodeError";
  }
}
(_a = globalThis).__zod_globalConfig ?? (_a.__zod_globalConfig = {});
var globalConfig = globalThis.__zod_globalConfig;
function config(newConfig) {
  if (newConfig)
    Object.assign(globalConfig, newConfig);
  return globalConfig;
}
// node_modules/.bun/zod@4.4.3/node_modules/zod/v4/core/util.js
function getEnumValues(entries) {
  const numericValues = Object.values(entries).filter((v) => typeof v === "number");
  const values = Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
  return values;
}
function jsonStringifyReplacer(_, value) {
  if (typeof value === "bigint")
    return value.toString();
  return value;
}
function cached(getter) {
  const set = false;
  return {
    get value() {
      if (!set) {
        const value = getter();
        Object.defineProperty(this, "value", { value });
        return value;
      }
      throw new Error("cached value already set");
    }
  };
}
function nullish(input) {
  return input === null || input === undefined;
}
function cleanRegex(source) {
  const start = source.startsWith("^") ? 1 : 0;
  const end = source.endsWith("$") ? source.length - 1 : source.length;
  return source.slice(start, end);
}
function floatSafeRemainder(val, step) {
  const ratio = val / step;
  const roundedRatio = Math.round(ratio);
  const tolerance = Number.EPSILON * Math.max(Math.abs(ratio), 1);
  if (Math.abs(ratio - roundedRatio) < tolerance)
    return 0;
  return ratio - roundedRatio;
}
var EVALUATING = /* @__PURE__ */ Symbol("evaluating");
function defineLazy(object, key, getter) {
  let value = undefined;
  Object.defineProperty(object, key, {
    get() {
      if (value === EVALUATING) {
        return;
      }
      if (value === undefined) {
        value = EVALUATING;
        value = getter();
      }
      return value;
    },
    set(v) {
      Object.defineProperty(object, key, {
        value: v
      });
    },
    configurable: true
  });
}
function assignProp(target, prop, value) {
  Object.defineProperty(target, prop, {
    value,
    writable: true,
    enumerable: true,
    configurable: true
  });
}
function mergeDefs(...defs) {
  const mergedDescriptors = {};
  for (const def of defs) {
    const descriptors = Object.getOwnPropertyDescriptors(def);
    Object.assign(mergedDescriptors, descriptors);
  }
  return Object.defineProperties({}, mergedDescriptors);
}
function esc(str) {
  return JSON.stringify(str);
}
function slugify(input) {
  return input.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
var captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {};
function isObject(data) {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}
var allowsEval = /* @__PURE__ */ cached(() => {
  if (globalConfig.jitless) {
    return false;
  }
  if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) {
    return false;
  }
  try {
    const F = Function;
    new F("");
    return true;
  } catch (_) {
    return false;
  }
});
function isPlainObject(o) {
  if (isObject(o) === false)
    return false;
  const ctor = o.constructor;
  if (ctor === undefined)
    return true;
  if (typeof ctor !== "function")
    return true;
  const prot = ctor.prototype;
  if (isObject(prot) === false)
    return false;
  if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) {
    return false;
  }
  return true;
}
function shallowClone(o) {
  if (isPlainObject(o))
    return { ...o };
  if (Array.isArray(o))
    return [...o];
  if (o instanceof Map)
    return new Map(o);
  if (o instanceof Set)
    return new Set(o);
  return o;
}
var propertyKeyTypes = /* @__PURE__ */ new Set(["string", "number", "symbol"]);
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function clone(inst, def, params) {
  const cl = new inst._zod.constr(def ?? inst._zod.def);
  if (!def || params?.parent)
    cl._zod.parent = inst;
  return cl;
}
function normalizeParams(_params) {
  const params = _params;
  if (!params)
    return {};
  if (typeof params === "string")
    return { error: () => params };
  if (params?.message !== undefined) {
    if (params?.error !== undefined)
      throw new Error("Cannot specify both `message` and `error` params");
    params.error = params.message;
  }
  delete params.message;
  if (typeof params.error === "string")
    return { ...params, error: () => params.error };
  return params;
}
function optionalKeys(shape) {
  return Object.keys(shape).filter((k) => {
    return shape[k]._zod.optin === "optional" && shape[k]._zod.optout === "optional";
  });
}
var NUMBER_FORMAT_RANGES = {
  safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  int32: [-2147483648, 2147483647],
  uint32: [0, 4294967295],
  float32: [-340282346638528860000000000000000000000, 340282346638528860000000000000000000000],
  float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
};
function pick(schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".pick() cannot be used on object schemas containing refinements");
  }
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const newShape = {};
      for (const key in mask) {
        if (!(key in currDef.shape)) {
          throw new Error(`Unrecognized key: "${key}"`);
        }
        if (!mask[key])
          continue;
        newShape[key] = currDef.shape[key];
      }
      assignProp(this, "shape", newShape);
      return newShape;
    },
    checks: []
  });
  return clone(schema, def);
}
function omit(schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".omit() cannot be used on object schemas containing refinements");
  }
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const newShape = { ...schema._zod.def.shape };
      for (const key in mask) {
        if (!(key in currDef.shape)) {
          throw new Error(`Unrecognized key: "${key}"`);
        }
        if (!mask[key])
          continue;
        delete newShape[key];
      }
      assignProp(this, "shape", newShape);
      return newShape;
    },
    checks: []
  });
  return clone(schema, def);
}
function extend(schema, shape) {
  if (!isPlainObject(shape)) {
    throw new Error("Invalid input to extend: expected a plain object");
  }
  const checks = schema._zod.def.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    const existingShape = schema._zod.def.shape;
    for (const key in shape) {
      if (Object.getOwnPropertyDescriptor(existingShape, key) !== undefined) {
        throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
      }
    }
  }
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const _shape = { ...schema._zod.def.shape, ...shape };
      assignProp(this, "shape", _shape);
      return _shape;
    }
  });
  return clone(schema, def);
}
function safeExtend(schema, shape) {
  if (!isPlainObject(shape)) {
    throw new Error("Invalid input to safeExtend: expected a plain object");
  }
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const _shape = { ...schema._zod.def.shape, ...shape };
      assignProp(this, "shape", _shape);
      return _shape;
    }
  });
  return clone(schema, def);
}
function merge(a, b) {
  if (a._zod.def.checks?.length) {
    throw new Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
  }
  const def = mergeDefs(a._zod.def, {
    get shape() {
      const _shape = { ...a._zod.def.shape, ...b._zod.def.shape };
      assignProp(this, "shape", _shape);
      return _shape;
    },
    get catchall() {
      return b._zod.def.catchall;
    },
    checks: b._zod.def.checks ?? []
  });
  return clone(a, def);
}
function partial(Class, schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".partial() cannot be used on object schemas containing refinements");
  }
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const oldShape = schema._zod.def.shape;
      const shape = { ...oldShape };
      if (mask) {
        for (const key in mask) {
          if (!(key in oldShape)) {
            throw new Error(`Unrecognized key: "${key}"`);
          }
          if (!mask[key])
            continue;
          shape[key] = Class ? new Class({
            type: "optional",
            innerType: oldShape[key]
          }) : oldShape[key];
        }
      } else {
        for (const key in oldShape) {
          shape[key] = Class ? new Class({
            type: "optional",
            innerType: oldShape[key]
          }) : oldShape[key];
        }
      }
      assignProp(this, "shape", shape);
      return shape;
    },
    checks: []
  });
  return clone(schema, def);
}
function required(Class, schema, mask) {
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const oldShape = schema._zod.def.shape;
      const shape = { ...oldShape };
      if (mask) {
        for (const key in mask) {
          if (!(key in shape)) {
            throw new Error(`Unrecognized key: "${key}"`);
          }
          if (!mask[key])
            continue;
          shape[key] = new Class({
            type: "nonoptional",
            innerType: oldShape[key]
          });
        }
      } else {
        for (const key in oldShape) {
          shape[key] = new Class({
            type: "nonoptional",
            innerType: oldShape[key]
          });
        }
      }
      assignProp(this, "shape", shape);
      return shape;
    }
  });
  return clone(schema, def);
}
function aborted(x, startIndex = 0) {
  if (x.aborted === true)
    return true;
  for (let i = startIndex;i < x.issues.length; i++) {
    if (x.issues[i]?.continue !== true) {
      return true;
    }
  }
  return false;
}
function explicitlyAborted(x, startIndex = 0) {
  if (x.aborted === true)
    return true;
  for (let i = startIndex;i < x.issues.length; i++) {
    if (x.issues[i]?.continue === false) {
      return true;
    }
  }
  return false;
}
function prefixIssues(path, issues) {
  return issues.map((iss) => {
    var _a;
    (_a = iss).path ?? (_a.path = []);
    iss.path.unshift(path);
    return iss;
  });
}
function unwrapMessage(message) {
  return typeof message === "string" ? message : message?.message;
}
function finalizeIssue(iss, ctx, config) {
  const message = iss.message ? iss.message : unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config.customError?.(iss)) ?? unwrapMessage(config.localeError?.(iss)) ?? "Invalid input";
  const { inst: _inst, continue: _continue, input: _input, ...rest } = iss;
  rest.path ?? (rest.path = []);
  rest.message = message;
  if (ctx?.reportInput) {
    rest.input = _input;
  }
  return rest;
}
function getLengthableOrigin(input) {
  if (Array.isArray(input))
    return "array";
  if (typeof input === "string")
    return "string";
  return "unknown";
}
function issue(...args) {
  const [iss, input, inst] = args;
  if (typeof iss === "string") {
    return {
      message: iss,
      code: "custom",
      input,
      inst
    };
  }
  return { ...iss };
}

// node_modules/.bun/zod@4.4.3/node_modules/zod/v4/core/errors.js
var initializer = (inst, def) => {
  inst.name = "$ZodError";
  Object.defineProperty(inst, "_zod", {
    value: inst._zod,
    enumerable: false
  });
  Object.defineProperty(inst, "issues", {
    value: def,
    enumerable: false
  });
  inst.message = JSON.stringify(def, jsonStringifyReplacer, 2);
  Object.defineProperty(inst, "toString", {
    value: () => inst.message,
    enumerable: false
  });
};
var $ZodError = $constructor("$ZodError", initializer);
var $ZodRealError = $constructor("$ZodError", initializer, { Parent: Error });
function flattenError(error, mapper = (issue) => issue.message) {
  const fieldErrors = {};
  const formErrors = [];
  for (const sub of error.issues) {
    if (sub.path.length > 0) {
      fieldErrors[sub.path[0]] = fieldErrors[sub.path[0]] || [];
      fieldErrors[sub.path[0]].push(mapper(sub));
    } else {
      formErrors.push(mapper(sub));
    }
  }
  return { formErrors, fieldErrors };
}
function formatError(error, mapper = (issue) => issue.message) {
  const fieldErrors = { _errors: [] };
  const processError = (error, path = []) => {
    for (const issue of error.issues) {
      if (issue.code === "invalid_union" && issue.errors.length) {
        issue.errors.map((issues) => processError({ issues }, [...path, ...issue.path]));
      } else if (issue.code === "invalid_key") {
        processError({ issues: issue.issues }, [...path, ...issue.path]);
      } else if (issue.code === "invalid_element") {
        processError({ issues: issue.issues }, [...path, ...issue.path]);
      } else {
        const fullpath = [...path, ...issue.path];
        if (fullpath.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < fullpath.length) {
            const el = fullpath[i];
            const terminal = i === fullpath.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    }
  };
  processError(error);
  return fieldErrors;
}

// node_modules/.bun/zod@4.4.3/node_modules/zod/v4/core/parse.js
var _parse = (_Err) => (schema, value, _ctx, _params) => {
  const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
  const result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new $ZodAsyncError;
  }
  if (result.issues.length) {
    const e = new (_params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
    captureStackTrace(e, _params?.callee);
    throw e;
  }
  return result.value;
};
var _parseAsync = (_Err) => async (schema, value, _ctx, params) => {
  const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  if (result.issues.length) {
    const e = new (params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
    captureStackTrace(e, params?.callee);
    throw e;
  }
  return result.value;
};
var _safeParse = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
  const result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new $ZodAsyncError;
  }
  return result.issues.length ? {
    success: false,
    error: new (_Err ?? $ZodError)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  } : { success: true, data: result.value };
};
var safeParse = /* @__PURE__ */ _safeParse($ZodRealError);
var _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  return result.issues.length ? {
    success: false,
    error: new _Err(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  } : { success: true, data: result.value };
};
var safeParseAsync = /* @__PURE__ */ _safeParseAsync($ZodRealError);
var _encode = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _parse(_Err)(schema, value, ctx);
};
var _decode = (_Err) => (schema, value, _ctx) => {
  return _parse(_Err)(schema, value, _ctx);
};
var _encodeAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _parseAsync(_Err)(schema, value, ctx);
};
var _decodeAsync = (_Err) => async (schema, value, _ctx) => {
  return _parseAsync(_Err)(schema, value, _ctx);
};
var _safeEncode = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _safeParse(_Err)(schema, value, ctx);
};
var _safeDecode = (_Err) => (schema, value, _ctx) => {
  return _safeParse(_Err)(schema, value, _ctx);
};
var _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _safeParseAsync(_Err)(schema, value, ctx);
};
var _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
  return _safeParseAsync(_Err)(schema, value, _ctx);
};
// node_modules/.bun/zod@4.4.3/node_modules/zod/v4/core/regexes.js
var cuid = /^[cC][0-9a-z]{6,}$/;
var cuid2 = /^[0-9a-z]+$/;
var ulid = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;
var xid = /^[0-9a-vA-V]{20}$/;
var ksuid = /^[A-Za-z0-9]{27}$/;
var nanoid = /^[a-zA-Z0-9_-]{21}$/;
var duration = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
var guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
var uuid = (version) => {
  if (!version)
    return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
  return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
};
var email = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
var _emoji = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
function emoji() {
  return new RegExp(_emoji, "u");
}
var ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
var cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
var cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
var base64url = /^[A-Za-z0-9_-]*$/;
var httpProtocol = /^https?$/;
var e164 = /^\+[1-9]\d{6,14}$/;
var dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
var date = /* @__PURE__ */ new RegExp(`^${dateSource}$`);
function timeSource(args) {
  const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
  const regex = typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
  return regex;
}
function time(args) {
  return new RegExp(`^${timeSource(args)}$`);
}
function datetime(args) {
  const time = timeSource({ precision: args.precision });
  const opts = ["Z"];
  if (args.local)
    opts.push("");
  if (args.offset)
    opts.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
  const timeRegex = `${time}(?:${opts.join("|")})`;
  return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
}
var string = (params) => {
  const regex = params ? `[\\s\\S]{${params?.minimum ?? 0},${params?.maximum ?? ""}}` : `[\\s\\S]*`;
  return new RegExp(`^${regex}$`);
};
var integer = /^-?\d+$/;
var number = /^-?\d+(?:\.\d+)?$/;
var boolean = /^(?:true|false)$/i;
var lowercase = /^[^A-Z]*$/;
var uppercase = /^[^a-z]*$/;

// node_modules/.bun/zod@4.4.3/node_modules/zod/v4/core/checks.js
var $ZodCheck = /* @__PURE__ */ $constructor("$ZodCheck", (inst, def) => {
  var _a;
  inst._zod ?? (inst._zod = {});
  inst._zod.def = def;
  (_a = inst._zod).onattach ?? (_a.onattach = []);
});
var numericOriginMap = {
  number: "number",
  bigint: "bigint",
  object: "date"
};
var $ZodCheckLessThan = /* @__PURE__ */ $constructor("$ZodCheckLessThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.onattach.push((inst) => {
    const bag = inst._zod.bag;
    const curr = (def.inclusive ? bag.maximum : bag.exclusiveMaximum) ?? Number.POSITIVE_INFINITY;
    if (def.value < curr) {
      if (def.inclusive)
        bag.maximum = def.value;
      else
        bag.exclusiveMaximum = def.value;
    }
  });
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value <= def.value : payload.value < def.value) {
      return;
    }
    payload.issues.push({
      origin,
      code: "too_big",
      maximum: typeof def.value === "object" ? def.value.getTime() : def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckGreaterThan = /* @__PURE__ */ $constructor("$ZodCheckGreaterThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.onattach.push((inst) => {
    const bag = inst._zod.bag;
    const curr = (def.inclusive ? bag.minimum : bag.exclusiveMinimum) ?? Number.NEGATIVE_INFINITY;
    if (def.value > curr) {
      if (def.inclusive)
        bag.minimum = def.value;
      else
        bag.exclusiveMinimum = def.value;
    }
  });
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value >= def.value : payload.value > def.value) {
      return;
    }
    payload.issues.push({
      origin,
      code: "too_small",
      minimum: typeof def.value === "object" ? def.value.getTime() : def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMultipleOf = /* @__PURE__ */ $constructor("$ZodCheckMultipleOf", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.onattach.push((inst) => {
    var _a;
    (_a = inst._zod.bag).multipleOf ?? (_a.multipleOf = def.value);
  });
  inst._zod.check = (payload) => {
    if (typeof payload.value !== typeof def.value)
      throw new Error("Cannot mix number and bigint in multiple_of check.");
    const isMultiple = typeof payload.value === "bigint" ? payload.value % def.value === BigInt(0) : floatSafeRemainder(payload.value, def.value) === 0;
    if (isMultiple)
      return;
    payload.issues.push({
      origin: typeof payload.value,
      code: "not_multiple_of",
      divisor: def.value,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckNumberFormat = /* @__PURE__ */ $constructor("$ZodCheckNumberFormat", (inst, def) => {
  $ZodCheck.init(inst, def);
  def.format = def.format || "float64";
  const isInt = def.format?.includes("int");
  const origin = isInt ? "int" : "number";
  const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
  inst._zod.onattach.push((inst) => {
    const bag = inst._zod.bag;
    bag.format = def.format;
    bag.minimum = minimum;
    bag.maximum = maximum;
    if (isInt)
      bag.pattern = integer;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    if (isInt) {
      if (!Number.isInteger(input)) {
        payload.issues.push({
          expected: origin,
          format: def.format,
          code: "invalid_type",
          continue: false,
          input,
          inst
        });
        return;
      }
      if (!Number.isSafeInteger(input)) {
        if (input > 0) {
          payload.issues.push({
            input,
            code: "too_big",
            maximum: Number.MAX_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            inclusive: true,
            continue: !def.abort
          });
        } else {
          payload.issues.push({
            input,
            code: "too_small",
            minimum: Number.MIN_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            inclusive: true,
            continue: !def.abort
          });
        }
        return;
      }
    }
    if (input < minimum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_small",
        minimum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
    if (input > maximum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_big",
        maximum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodCheckMaxLength = /* @__PURE__ */ $constructor("$ZodCheckMaxLength", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def);
  (_a = inst._zod.def).when ?? (_a.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== undefined;
  });
  inst._zod.onattach.push((inst) => {
    const curr = inst._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
    if (def.maximum < curr)
      inst._zod.bag.maximum = def.maximum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length <= def.maximum)
      return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_big",
      maximum: def.maximum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMinLength = /* @__PURE__ */ $constructor("$ZodCheckMinLength", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def);
  (_a = inst._zod.def).when ?? (_a.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== undefined;
  });
  inst._zod.onattach.push((inst) => {
    const curr = inst._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
    if (def.minimum > curr)
      inst._zod.bag.minimum = def.minimum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length >= def.minimum)
      return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_small",
      minimum: def.minimum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckLengthEquals = /* @__PURE__ */ $constructor("$ZodCheckLengthEquals", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def);
  (_a = inst._zod.def).when ?? (_a.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== undefined;
  });
  inst._zod.onattach.push((inst) => {
    const bag = inst._zod.bag;
    bag.minimum = def.length;
    bag.maximum = def.length;
    bag.length = def.length;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length === def.length)
      return;
    const origin = getLengthableOrigin(input);
    const tooBig = length > def.length;
    payload.issues.push({
      origin,
      ...tooBig ? { code: "too_big", maximum: def.length } : { code: "too_small", minimum: def.length },
      inclusive: true,
      exact: true,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckStringFormat = /* @__PURE__ */ $constructor("$ZodCheckStringFormat", (inst, def) => {
  var _a, _b;
  $ZodCheck.init(inst, def);
  inst._zod.onattach.push((inst) => {
    const bag = inst._zod.bag;
    bag.format = def.format;
    if (def.pattern) {
      bag.patterns ?? (bag.patterns = new Set);
      bag.patterns.add(def.pattern);
    }
  });
  if (def.pattern)
    (_a = inst._zod).check ?? (_a.check = (payload) => {
      def.pattern.lastIndex = 0;
      if (def.pattern.test(payload.value))
        return;
      payload.issues.push({
        origin: "string",
        code: "invalid_format",
        format: def.format,
        input: payload.value,
        ...def.pattern ? { pattern: def.pattern.toString() } : {},
        inst,
        continue: !def.abort
      });
    });
  else
    (_b = inst._zod).check ?? (_b.check = () => {});
});
var $ZodCheckRegex = /* @__PURE__ */ $constructor("$ZodCheckRegex", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    def.pattern.lastIndex = 0;
    if (def.pattern.test(payload.value))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "regex",
      input: payload.value,
      pattern: def.pattern.toString(),
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckLowerCase = /* @__PURE__ */ $constructor("$ZodCheckLowerCase", (inst, def) => {
  def.pattern ?? (def.pattern = lowercase);
  $ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckUpperCase = /* @__PURE__ */ $constructor("$ZodCheckUpperCase", (inst, def) => {
  def.pattern ?? (def.pattern = uppercase);
  $ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckIncludes = /* @__PURE__ */ $constructor("$ZodCheckIncludes", (inst, def) => {
  $ZodCheck.init(inst, def);
  const escapedRegex = escapeRegex(def.includes);
  const pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position}}${escapedRegex}` : escapedRegex);
  def.pattern = pattern;
  inst._zod.onattach.push((inst) => {
    const bag = inst._zod.bag;
    bag.patterns ?? (bag.patterns = new Set);
    bag.patterns.add(pattern);
  });
  inst._zod.check = (payload) => {
    if (payload.value.includes(def.includes, def.position))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "includes",
      includes: def.includes,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckStartsWith = /* @__PURE__ */ $constructor("$ZodCheckStartsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.onattach.push((inst) => {
    const bag = inst._zod.bag;
    bag.patterns ?? (bag.patterns = new Set);
    bag.patterns.add(pattern);
  });
  inst._zod.check = (payload) => {
    if (payload.value.startsWith(def.prefix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "starts_with",
      prefix: def.prefix,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckEndsWith = /* @__PURE__ */ $constructor("$ZodCheckEndsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.onattach.push((inst) => {
    const bag = inst._zod.bag;
    bag.patterns ?? (bag.patterns = new Set);
    bag.patterns.add(pattern);
  });
  inst._zod.check = (payload) => {
    if (payload.value.endsWith(def.suffix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "ends_with",
      suffix: def.suffix,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckOverwrite = /* @__PURE__ */ $constructor("$ZodCheckOverwrite", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.check = (payload) => {
    payload.value = def.tx(payload.value);
  };
});

// node_modules/.bun/zod@4.4.3/node_modules/zod/v4/core/doc.js
class Doc {
  constructor(args = []) {
    this.content = [];
    this.indent = 0;
    if (this)
      this.args = args;
  }
  indented(fn) {
    this.indent += 1;
    fn(this);
    this.indent -= 1;
  }
  write(arg) {
    if (typeof arg === "function") {
      arg(this, { execution: "sync" });
      arg(this, { execution: "async" });
      return;
    }
    const content = arg;
    const lines = content.split(`
`).filter((x) => x);
    const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
    const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
    for (const line of dedented) {
      this.content.push(line);
    }
  }
  compile() {
    const F = Function;
    const args = this?.args;
    const content = this?.content ?? [``];
    const lines = [...content.map((x) => `  ${x}`)];
    return new F(...args, lines.join(`
`));
  }
}

// node_modules/.bun/zod@4.4.3/node_modules/zod/v4/core/versions.js
var version = {
  major: 4,
  minor: 4,
  patch: 3
};

// node_modules/.bun/zod@4.4.3/node_modules/zod/v4/core/schemas.js
var $ZodType = /* @__PURE__ */ $constructor("$ZodType", (inst, def) => {
  var _a;
  inst ?? (inst = {});
  inst._zod.def = def;
  inst._zod.bag = inst._zod.bag || {};
  inst._zod.version = version;
  const checks = [...inst._zod.def.checks ?? []];
  if (inst._zod.traits.has("$ZodCheck")) {
    checks.unshift(inst);
  }
  for (const ch of checks) {
    for (const fn of ch._zod.onattach) {
      fn(inst);
    }
  }
  if (checks.length === 0) {
    (_a = inst._zod).deferred ?? (_a.deferred = []);
    inst._zod.deferred?.push(() => {
      inst._zod.run = inst._zod.parse;
    });
  } else {
    const runChecks = (payload, checks, ctx) => {
      let isAborted = aborted(payload);
      let asyncResult;
      for (const ch of checks) {
        if (ch._zod.def.when) {
          if (explicitlyAborted(payload))
            continue;
          const shouldRun = ch._zod.def.when(payload);
          if (!shouldRun)
            continue;
        } else if (isAborted) {
          continue;
        }
        const currLen = payload.issues.length;
        const _ = ch._zod.check(payload);
        if (_ instanceof Promise && ctx?.async === false) {
          throw new $ZodAsyncError;
        }
        if (asyncResult || _ instanceof Promise) {
          asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
            await _;
            const nextLen = payload.issues.length;
            if (nextLen === currLen)
              return;
            if (!isAborted)
              isAborted = aborted(payload, currLen);
          });
        } else {
          const nextLen = payload.issues.length;
          if (nextLen === currLen)
            continue;
          if (!isAborted)
            isAborted = aborted(payload, currLen);
        }
      }
      if (asyncResult) {
        return asyncResult.then(() => {
          return payload;
        });
      }
      return payload;
    };
    const handleCanaryResult = (canary, payload, ctx) => {
      if (aborted(canary)) {
        canary.aborted = true;
        return canary;
      }
      const checkResult = runChecks(payload, checks, ctx);
      if (checkResult instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError;
        return checkResult.then((checkResult) => inst._zod.parse(checkResult, ctx));
      }
      return inst._zod.parse(checkResult, ctx);
    };
    inst._zod.run = (payload, ctx) => {
      if (ctx.skipChecks) {
        return inst._zod.parse(payload, ctx);
      }
      if (ctx.direction === "backward") {
        const canary = inst._zod.parse({ value: payload.value, issues: [] }, { ...ctx, skipChecks: true });
        if (canary instanceof Promise) {
          return canary.then((canary) => {
            return handleCanaryResult(canary, payload, ctx);
          });
        }
        return handleCanaryResult(canary, payload, ctx);
      }
      const result = inst._zod.parse(payload, ctx);
      if (result instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError;
        return result.then((result) => runChecks(result, checks, ctx));
      }
      return runChecks(result, checks, ctx);
    };
  }
  defineLazy(inst, "~standard", () => ({
    validate: (value) => {
      try {
        const r = safeParse(inst, value);
        return r.success ? { value: r.data } : { issues: r.error?.issues };
      } catch (_) {
        return safeParseAsync(inst, value).then((r) => r.success ? { value: r.data } : { issues: r.error?.issues });
      }
    },
    vendor: "zod",
    version: 1
  }));
});
var $ZodString = /* @__PURE__ */ $constructor("$ZodString", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = [...inst?._zod.bag?.patterns ?? []].pop() ?? string(inst._zod.bag);
  inst._zod.parse = (payload, _) => {
    if (def.coerce)
      try {
        payload.value = String(payload.value);
      } catch (_) {}
    if (typeof payload.value === "string")
      return payload;
    payload.issues.push({
      expected: "string",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
var $ZodStringFormat = /* @__PURE__ */ $constructor("$ZodStringFormat", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  $ZodString.init(inst, def);
});
var $ZodGUID = /* @__PURE__ */ $constructor("$ZodGUID", (inst, def) => {
  def.pattern ?? (def.pattern = guid);
  $ZodStringFormat.init(inst, def);
});
var $ZodUUID = /* @__PURE__ */ $constructor("$ZodUUID", (inst, def) => {
  if (def.version) {
    const versionMap = {
      v1: 1,
      v2: 2,
      v3: 3,
      v4: 4,
      v5: 5,
      v6: 6,
      v7: 7,
      v8: 8
    };
    const v = versionMap[def.version];
    if (v === undefined)
      throw new Error(`Invalid UUID version: "${def.version}"`);
    def.pattern ?? (def.pattern = uuid(v));
  } else
    def.pattern ?? (def.pattern = uuid());
  $ZodStringFormat.init(inst, def);
});
var $ZodEmail = /* @__PURE__ */ $constructor("$ZodEmail", (inst, def) => {
  def.pattern ?? (def.pattern = email);
  $ZodStringFormat.init(inst, def);
});
var $ZodURL = /* @__PURE__ */ $constructor("$ZodURL", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    try {
      const trimmed = payload.value.trim();
      if (!def.normalize && def.protocol?.source === httpProtocol.source) {
        if (!/^https?:\/\//i.test(trimmed)) {
          payload.issues.push({
            code: "invalid_format",
            format: "url",
            note: "Invalid URL format",
            input: payload.value,
            inst,
            continue: !def.abort
          });
          return;
        }
      }
      const url = new URL(trimmed);
      if (def.hostname) {
        def.hostname.lastIndex = 0;
        if (!def.hostname.test(url.hostname)) {
          payload.issues.push({
            code: "invalid_format",
            format: "url",
            note: "Invalid hostname",
            pattern: def.hostname.source,
            input: payload.value,
            inst,
            continue: !def.abort
          });
        }
      }
      if (def.protocol) {
        def.protocol.lastIndex = 0;
        if (!def.protocol.test(url.protocol.endsWith(":") ? url.protocol.slice(0, -1) : url.protocol)) {
          payload.issues.push({
            code: "invalid_format",
            format: "url",
            note: "Invalid protocol",
            pattern: def.protocol.source,
            input: payload.value,
            inst,
            continue: !def.abort
          });
        }
      }
      if (def.normalize) {
        payload.value = url.href;
      } else {
        payload.value = trimmed;
      }
      return;
    } catch (_) {
      payload.issues.push({
        code: "invalid_format",
        format: "url",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodEmoji = /* @__PURE__ */ $constructor("$ZodEmoji", (inst, def) => {
  def.pattern ?? (def.pattern = emoji());
  $ZodStringFormat.init(inst, def);
});
var $ZodNanoID = /* @__PURE__ */ $constructor("$ZodNanoID", (inst, def) => {
  def.pattern ?? (def.pattern = nanoid);
  $ZodStringFormat.init(inst, def);
});
var $ZodCUID = /* @__PURE__ */ $constructor("$ZodCUID", (inst, def) => {
  def.pattern ?? (def.pattern = cuid);
  $ZodStringFormat.init(inst, def);
});
var $ZodCUID2 = /* @__PURE__ */ $constructor("$ZodCUID2", (inst, def) => {
  def.pattern ?? (def.pattern = cuid2);
  $ZodStringFormat.init(inst, def);
});
var $ZodULID = /* @__PURE__ */ $constructor("$ZodULID", (inst, def) => {
  def.pattern ?? (def.pattern = ulid);
  $ZodStringFormat.init(inst, def);
});
var $ZodXID = /* @__PURE__ */ $constructor("$ZodXID", (inst, def) => {
  def.pattern ?? (def.pattern = xid);
  $ZodStringFormat.init(inst, def);
});
var $ZodKSUID = /* @__PURE__ */ $constructor("$ZodKSUID", (inst, def) => {
  def.pattern ?? (def.pattern = ksuid);
  $ZodStringFormat.init(inst, def);
});
var $ZodISODateTime = /* @__PURE__ */ $constructor("$ZodISODateTime", (inst, def) => {
  def.pattern ?? (def.pattern = datetime(def));
  $ZodStringFormat.init(inst, def);
});
var $ZodISODate = /* @__PURE__ */ $constructor("$ZodISODate", (inst, def) => {
  def.pattern ?? (def.pattern = date);
  $ZodStringFormat.init(inst, def);
});
var $ZodISOTime = /* @__PURE__ */ $constructor("$ZodISOTime", (inst, def) => {
  def.pattern ?? (def.pattern = time(def));
  $ZodStringFormat.init(inst, def);
});
var $ZodISODuration = /* @__PURE__ */ $constructor("$ZodISODuration", (inst, def) => {
  def.pattern ?? (def.pattern = duration);
  $ZodStringFormat.init(inst, def);
});
var $ZodIPv4 = /* @__PURE__ */ $constructor("$ZodIPv4", (inst, def) => {
  def.pattern ?? (def.pattern = ipv4);
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.format = `ipv4`;
});
var $ZodIPv6 = /* @__PURE__ */ $constructor("$ZodIPv6", (inst, def) => {
  def.pattern ?? (def.pattern = ipv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.format = `ipv6`;
  inst._zod.check = (payload) => {
    try {
      new URL(`http://[${payload.value}]`);
    } catch {
      payload.issues.push({
        code: "invalid_format",
        format: "ipv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodCIDRv4 = /* @__PURE__ */ $constructor("$ZodCIDRv4", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv4);
  $ZodStringFormat.init(inst, def);
});
var $ZodCIDRv6 = /* @__PURE__ */ $constructor("$ZodCIDRv6", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    const parts = payload.value.split("/");
    try {
      if (parts.length !== 2)
        throw new Error;
      const [address, prefix] = parts;
      if (!prefix)
        throw new Error;
      const prefixNum = Number(prefix);
      if (`${prefixNum}` !== prefix)
        throw new Error;
      if (prefixNum < 0 || prefixNum > 128)
        throw new Error;
      new URL(`http://[${address}]`);
    } catch {
      payload.issues.push({
        code: "invalid_format",
        format: "cidrv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
function isValidBase64(data) {
  if (data === "")
    return true;
  if (/\s/.test(data))
    return false;
  if (data.length % 4 !== 0)
    return false;
  try {
    atob(data);
    return true;
  } catch {
    return false;
  }
}
var $ZodBase64 = /* @__PURE__ */ $constructor("$ZodBase64", (inst, def) => {
  def.pattern ?? (def.pattern = base64);
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.contentEncoding = "base64";
  inst._zod.check = (payload) => {
    if (isValidBase64(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
function isValidBase64URL(data) {
  if (!base64url.test(data))
    return false;
  const base64 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return isValidBase64(padded);
}
var $ZodBase64URL = /* @__PURE__ */ $constructor("$ZodBase64URL", (inst, def) => {
  def.pattern ?? (def.pattern = base64url);
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.contentEncoding = "base64url";
  inst._zod.check = (payload) => {
    if (isValidBase64URL(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64url",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodE164 = /* @__PURE__ */ $constructor("$ZodE164", (inst, def) => {
  def.pattern ?? (def.pattern = e164);
  $ZodStringFormat.init(inst, def);
});
function isValidJWT(token, algorithm = null) {
  try {
    const tokensParts = token.split(".");
    if (tokensParts.length !== 3)
      return false;
    const [header] = tokensParts;
    if (!header)
      return false;
    const parsedHeader = JSON.parse(atob(header));
    if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT")
      return false;
    if (!parsedHeader.alg)
      return false;
    if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm))
      return false;
    return true;
  } catch {
    return false;
  }
}
var $ZodJWT = /* @__PURE__ */ $constructor("$ZodJWT", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (isValidJWT(payload.value, def.alg))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "jwt",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodNumber = /* @__PURE__ */ $constructor("$ZodNumber", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = inst._zod.bag.pattern ?? number;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Number(payload.value);
      } catch (_) {}
    const input = payload.value;
    if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) {
      return payload;
    }
    const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? "Infinity" : undefined : undefined;
    payload.issues.push({
      expected: "number",
      code: "invalid_type",
      input,
      inst,
      ...received ? { received } : {}
    });
    return payload;
  };
});
var $ZodNumberFormat = /* @__PURE__ */ $constructor("$ZodNumberFormat", (inst, def) => {
  $ZodCheckNumberFormat.init(inst, def);
  $ZodNumber.init(inst, def);
});
var $ZodBoolean = /* @__PURE__ */ $constructor("$ZodBoolean", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = boolean;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Boolean(payload.value);
      } catch (_) {}
    const input = payload.value;
    if (typeof input === "boolean")
      return payload;
    payload.issues.push({
      expected: "boolean",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodUnknown = /* @__PURE__ */ $constructor("$ZodUnknown", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload) => payload;
});
var $ZodNever = /* @__PURE__ */ $constructor("$ZodNever", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    payload.issues.push({
      expected: "never",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
function handleArrayResult(result, final, index) {
  if (result.issues.length) {
    final.issues.push(...prefixIssues(index, result.issues));
  }
  final.value[index] = result.value;
}
var $ZodArray = /* @__PURE__ */ $constructor("$ZodArray", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!Array.isArray(input)) {
      payload.issues.push({
        expected: "array",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = Array(input.length);
    const proms = [];
    for (let i = 0;i < input.length; i++) {
      const item = input[i];
      const result = def.element._zod.run({
        value: item,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        proms.push(result.then((result) => handleArrayResult(result, payload, i)));
      } else {
        handleArrayResult(result, payload, i);
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => payload);
    }
    return payload;
  };
});
function handlePropertyResult(result, final, key, input, isOptionalIn, isOptionalOut) {
  const isPresent = key in input;
  if (result.issues.length) {
    if (isOptionalIn && isOptionalOut && !isPresent) {
      return;
    }
    final.issues.push(...prefixIssues(key, result.issues));
  }
  if (!isPresent && !isOptionalIn) {
    if (!result.issues.length) {
      final.issues.push({
        code: "invalid_type",
        expected: "nonoptional",
        input: undefined,
        path: [key]
      });
    }
    return;
  }
  if (result.value === undefined) {
    if (isPresent) {
      final.value[key] = undefined;
    }
  } else {
    final.value[key] = result.value;
  }
}
function normalizeDef(def) {
  const keys = Object.keys(def.shape);
  for (const k of keys) {
    if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) {
      throw new Error(`Invalid element at key "${k}": expected a Zod schema`);
    }
  }
  const okeys = optionalKeys(def.shape);
  return {
    ...def,
    keys,
    keySet: new Set(keys),
    numKeys: keys.length,
    optionalKeys: new Set(okeys)
  };
}
function handleCatchall(proms, input, payload, ctx, def, inst) {
  const unrecognized = [];
  const keySet = def.keySet;
  const _catchall = def.catchall._zod;
  const t = _catchall.def.type;
  const isOptionalIn = _catchall.optin === "optional";
  const isOptionalOut = _catchall.optout === "optional";
  for (const key in input) {
    if (key === "__proto__")
      continue;
    if (keySet.has(key))
      continue;
    if (t === "never") {
      unrecognized.push(key);
      continue;
    }
    const r = _catchall.run({ value: input[key], issues: [] }, ctx);
    if (r instanceof Promise) {
      proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut)));
    } else {
      handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
    }
  }
  if (unrecognized.length) {
    payload.issues.push({
      code: "unrecognized_keys",
      keys: unrecognized,
      input,
      inst
    });
  }
  if (!proms.length)
    return payload;
  return Promise.all(proms).then(() => {
    return payload;
  });
}
var $ZodObject = /* @__PURE__ */ $constructor("$ZodObject", (inst, def) => {
  $ZodType.init(inst, def);
  const desc = Object.getOwnPropertyDescriptor(def, "shape");
  if (!desc?.get) {
    const sh = def.shape;
    Object.defineProperty(def, "shape", {
      get: () => {
        const newSh = { ...sh };
        Object.defineProperty(def, "shape", {
          value: newSh
        });
        return newSh;
      }
    });
  }
  const _normalized = cached(() => normalizeDef(def));
  defineLazy(inst._zod, "propValues", () => {
    const shape = def.shape;
    const propValues = {};
    for (const key in shape) {
      const field = shape[key]._zod;
      if (field.values) {
        propValues[key] ?? (propValues[key] = new Set);
        for (const v of field.values)
          propValues[key].add(v);
      }
    }
    return propValues;
  });
  const isObject2 = isObject;
  const catchall = def.catchall;
  let value;
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject2(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = {};
    const proms = [];
    const shape = value.shape;
    for (const key of value.keys) {
      const el = shape[key];
      const isOptionalIn = el._zod.optin === "optional";
      const isOptionalOut = el._zod.optout === "optional";
      const r = el._zod.run({ value: input[key], issues: [] }, ctx);
      if (r instanceof Promise) {
        proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut)));
      } else {
        handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
      }
    }
    if (!catchall) {
      return proms.length ? Promise.all(proms).then(() => payload) : payload;
    }
    return handleCatchall(proms, input, payload, ctx, _normalized.value, inst);
  };
});
var $ZodObjectJIT = /* @__PURE__ */ $constructor("$ZodObjectJIT", (inst, def) => {
  $ZodObject.init(inst, def);
  const superParse = inst._zod.parse;
  const _normalized = cached(() => normalizeDef(def));
  const generateFastpass = (shape) => {
    const doc = new Doc(["shape", "payload", "ctx"]);
    const normalized = _normalized.value;
    const parseStr = (key) => {
      const k = esc(key);
      return `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
    };
    doc.write(`const input = payload.value;`);
    const ids = Object.create(null);
    let counter = 0;
    for (const key of normalized.keys) {
      ids[key] = `key_${counter++}`;
    }
    doc.write(`const newResult = {};`);
    for (const key of normalized.keys) {
      const id = ids[key];
      const k = esc(key);
      const schema = shape[key];
      const isOptionalIn = schema?._zod?.optin === "optional";
      const isOptionalOut = schema?._zod?.optout === "optional";
      doc.write(`const ${id} = ${parseStr(key)};`);
      if (isOptionalIn && isOptionalOut) {
        doc.write(`
        if (${id}.issues.length) {
          if (${k} in input) {
            payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
              ...iss,
              path: iss.path ? [${k}, ...iss.path] : [${k}]
            })));
          }
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
      } else if (!isOptionalIn) {
        doc.write(`
        const ${id}_present = ${k} in input;
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        if (!${id}_present && !${id}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${k}]
          });
        }

        if (${id}_present) {
          if (${id}.value === undefined) {
            newResult[${k}] = undefined;
          } else {
            newResult[${k}] = ${id}.value;
          }
        }

      `);
      } else {
        doc.write(`
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
      }
    }
    doc.write(`payload.value = newResult;`);
    doc.write(`return payload;`);
    const fn = doc.compile();
    return (payload, ctx) => fn(shape, payload, ctx);
  };
  let fastpass;
  const isObject2 = isObject;
  const jit = !globalConfig.jitless;
  const allowsEval2 = allowsEval;
  const fastEnabled = jit && allowsEval2.value;
  const catchall = def.catchall;
  let value;
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject2(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
      if (!fastpass)
        fastpass = generateFastpass(def.shape);
      payload = fastpass(payload, ctx);
      if (!catchall)
        return payload;
      return handleCatchall([], input, payload, ctx, value, inst);
    }
    return superParse(payload, ctx);
  };
});
function handleUnionResults(results, final, inst, ctx) {
  for (const result of results) {
    if (result.issues.length === 0) {
      final.value = result.value;
      return final;
    }
  }
  const nonaborted = results.filter((r) => !aborted(r));
  if (nonaborted.length === 1) {
    final.value = nonaborted[0].value;
    return nonaborted[0];
  }
  final.issues.push({
    code: "invalid_union",
    input: final.value,
    inst,
    errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  });
  return final;
}
var $ZodUnion = /* @__PURE__ */ $constructor("$ZodUnion", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "optin", () => def.options.some((o) => o._zod.optin === "optional") ? "optional" : undefined);
  defineLazy(inst._zod, "optout", () => def.options.some((o) => o._zod.optout === "optional") ? "optional" : undefined);
  defineLazy(inst._zod, "values", () => {
    if (def.options.every((o) => o._zod.values)) {
      return new Set(def.options.flatMap((option) => Array.from(option._zod.values)));
    }
    return;
  });
  defineLazy(inst._zod, "pattern", () => {
    if (def.options.every((o) => o._zod.pattern)) {
      const patterns = def.options.map((o) => o._zod.pattern);
      return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
    }
    return;
  });
  const first = def.options.length === 1 ? def.options[0]._zod.run : null;
  inst._zod.parse = (payload, ctx) => {
    if (first) {
      return first(payload, ctx);
    }
    let async = false;
    const results = [];
    for (const option of def.options) {
      const result = option._zod.run({
        value: payload.value,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        results.push(result);
        async = true;
      } else {
        if (result.issues.length === 0)
          return result;
        results.push(result);
      }
    }
    if (!async)
      return handleUnionResults(results, payload, inst, ctx);
    return Promise.all(results).then((results) => {
      return handleUnionResults(results, payload, inst, ctx);
    });
  };
});
var $ZodDiscriminatedUnion = /* @__PURE__ */ $constructor("$ZodDiscriminatedUnion", (inst, def) => {
  def.inclusive = false;
  $ZodUnion.init(inst, def);
  const _super = inst._zod.parse;
  defineLazy(inst._zod, "propValues", () => {
    const propValues = {};
    for (const option of def.options) {
      const pv = option._zod.propValues;
      if (!pv || Object.keys(pv).length === 0)
        throw new Error(`Invalid discriminated union option at index "${def.options.indexOf(option)}"`);
      for (const [k, v] of Object.entries(pv)) {
        if (!propValues[k])
          propValues[k] = new Set;
        for (const val of v) {
          propValues[k].add(val);
        }
      }
    }
    return propValues;
  });
  const disc = cached(() => {
    const opts = def.options;
    const map = new Map;
    for (const o of opts) {
      const values = o._zod.propValues?.[def.discriminator];
      if (!values || values.size === 0)
        throw new Error(`Invalid discriminated union option at index "${def.options.indexOf(o)}"`);
      for (const v of values) {
        if (map.has(v)) {
          throw new Error(`Duplicate discriminator value "${String(v)}"`);
        }
        map.set(v, o);
      }
    }
    return map;
  });
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!isObject(input)) {
      payload.issues.push({
        code: "invalid_type",
        expected: "object",
        input,
        inst
      });
      return payload;
    }
    const opt = disc.value.get(input?.[def.discriminator]);
    if (opt) {
      return opt._zod.run(payload, ctx);
    }
    if (def.unionFallback || ctx.direction === "backward") {
      return _super(payload, ctx);
    }
    payload.issues.push({
      code: "invalid_union",
      errors: [],
      note: "No matching discriminator",
      discriminator: def.discriminator,
      options: Array.from(disc.value.keys()),
      input,
      path: [def.discriminator],
      inst
    });
    return payload;
  };
});
var $ZodIntersection = /* @__PURE__ */ $constructor("$ZodIntersection", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    const left = def.left._zod.run({ value: input, issues: [] }, ctx);
    const right = def.right._zod.run({ value: input, issues: [] }, ctx);
    const async = left instanceof Promise || right instanceof Promise;
    if (async) {
      return Promise.all([left, right]).then(([left, right]) => {
        return handleIntersectionResults(payload, left, right);
      });
    }
    return handleIntersectionResults(payload, left, right);
  };
});
function mergeValues(a, b) {
  if (a === b) {
    return { valid: true, data: a };
  }
  if (a instanceof Date && b instanceof Date && +a === +b) {
    return { valid: true, data: a };
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const bKeys = Object.keys(b);
    const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
        };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return { valid: false, mergeErrorPath: [] };
    }
    const newArray = [];
    for (let index = 0;index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
        };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  }
  return { valid: false, mergeErrorPath: [] };
}
function handleIntersectionResults(result, left, right) {
  const unrecKeys = new Map;
  let unrecIssue;
  for (const iss of left.issues) {
    if (iss.code === "unrecognized_keys") {
      unrecIssue ?? (unrecIssue = iss);
      for (const k of iss.keys) {
        if (!unrecKeys.has(k))
          unrecKeys.set(k, {});
        unrecKeys.get(k).l = true;
      }
    } else {
      result.issues.push(iss);
    }
  }
  for (const iss of right.issues) {
    if (iss.code === "unrecognized_keys") {
      for (const k of iss.keys) {
        if (!unrecKeys.has(k))
          unrecKeys.set(k, {});
        unrecKeys.get(k).r = true;
      }
    } else {
      result.issues.push(iss);
    }
  }
  const bothKeys = [...unrecKeys].filter(([, f]) => f.l && f.r).map(([k]) => k);
  if (bothKeys.length && unrecIssue) {
    result.issues.push({ ...unrecIssue, keys: bothKeys });
  }
  if (aborted(result))
    return result;
  const merged = mergeValues(left.value, right.value);
  if (!merged.valid) {
    throw new Error(`Unmergable intersection. Error path: ` + `${JSON.stringify(merged.mergeErrorPath)}`);
  }
  result.value = merged.data;
  return result;
}
var $ZodRecord = /* @__PURE__ */ $constructor("$ZodRecord", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!isPlainObject(input)) {
      payload.issues.push({
        expected: "record",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    const proms = [];
    const values = def.keyType._zod.values;
    if (values) {
      payload.value = {};
      const recordKeys = new Set;
      for (const key of values) {
        if (typeof key === "string" || typeof key === "number" || typeof key === "symbol") {
          recordKeys.add(typeof key === "number" ? key.toString() : key);
          const keyResult = def.keyType._zod.run({ value: key, issues: [] }, ctx);
          if (keyResult instanceof Promise) {
            throw new Error("Async schemas not supported in object keys currently");
          }
          if (keyResult.issues.length) {
            payload.issues.push({
              code: "invalid_key",
              origin: "record",
              issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
              input: key,
              path: [key],
              inst
            });
            continue;
          }
          const outKey = keyResult.value;
          const result = def.valueType._zod.run({ value: input[key], issues: [] }, ctx);
          if (result instanceof Promise) {
            proms.push(result.then((result) => {
              if (result.issues.length) {
                payload.issues.push(...prefixIssues(key, result.issues));
              }
              payload.value[outKey] = result.value;
            }));
          } else {
            if (result.issues.length) {
              payload.issues.push(...prefixIssues(key, result.issues));
            }
            payload.value[outKey] = result.value;
          }
        }
      }
      let unrecognized;
      for (const key in input) {
        if (!recordKeys.has(key)) {
          unrecognized = unrecognized ?? [];
          unrecognized.push(key);
        }
      }
      if (unrecognized && unrecognized.length > 0) {
        payload.issues.push({
          code: "unrecognized_keys",
          input,
          inst,
          keys: unrecognized
        });
      }
    } else {
      payload.value = {};
      for (const key of Reflect.ownKeys(input)) {
        if (key === "__proto__")
          continue;
        if (!Object.prototype.propertyIsEnumerable.call(input, key))
          continue;
        let keyResult = def.keyType._zod.run({ value: key, issues: [] }, ctx);
        if (keyResult instanceof Promise) {
          throw new Error("Async schemas not supported in object keys currently");
        }
        const checkNumericKey = typeof key === "string" && number.test(key) && keyResult.issues.length;
        if (checkNumericKey) {
          const retryResult = def.keyType._zod.run({ value: Number(key), issues: [] }, ctx);
          if (retryResult instanceof Promise) {
            throw new Error("Async schemas not supported in object keys currently");
          }
          if (retryResult.issues.length === 0) {
            keyResult = retryResult;
          }
        }
        if (keyResult.issues.length) {
          if (def.mode === "loose") {
            payload.value[key] = input[key];
          } else {
            payload.issues.push({
              code: "invalid_key",
              origin: "record",
              issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
              input: key,
              path: [key],
              inst
            });
          }
          continue;
        }
        const result = def.valueType._zod.run({ value: input[key], issues: [] }, ctx);
        if (result instanceof Promise) {
          proms.push(result.then((result) => {
            if (result.issues.length) {
              payload.issues.push(...prefixIssues(key, result.issues));
            }
            payload.value[keyResult.value] = result.value;
          }));
        } else {
          if (result.issues.length) {
            payload.issues.push(...prefixIssues(key, result.issues));
          }
          payload.value[keyResult.value] = result.value;
        }
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => payload);
    }
    return payload;
  };
});
var $ZodEnum = /* @__PURE__ */ $constructor("$ZodEnum", (inst, def) => {
  $ZodType.init(inst, def);
  const values = getEnumValues(def.entries);
  const valuesSet = new Set(values);
  inst._zod.values = valuesSet;
  inst._zod.pattern = new RegExp(`^(${values.filter((k) => propertyKeyTypes.has(typeof k)).map((o) => typeof o === "string" ? escapeRegex(o) : o.toString()).join("|")})$`);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (valuesSet.has(input)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values,
      input,
      inst
    });
    return payload;
  };
});
var $ZodLiteral = /* @__PURE__ */ $constructor("$ZodLiteral", (inst, def) => {
  $ZodType.init(inst, def);
  if (def.values.length === 0) {
    throw new Error("Cannot create literal schema with no valid values");
  }
  const values = new Set(def.values);
  inst._zod.values = values;
  inst._zod.pattern = new RegExp(`^(${def.values.map((o) => typeof o === "string" ? escapeRegex(o) : o ? escapeRegex(o.toString()) : String(o)).join("|")})$`);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (values.has(input)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values: def.values,
      input,
      inst
    });
    return payload;
  };
});
var $ZodTransform = /* @__PURE__ */ $constructor("$ZodTransform", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      throw new $ZodEncodeError(inst.constructor.name);
    }
    const _out = def.transform(payload.value, payload);
    if (ctx.async) {
      const output = _out instanceof Promise ? _out : Promise.resolve(_out);
      return output.then((output) => {
        payload.value = output;
        payload.fallback = true;
        return payload;
      });
    }
    if (_out instanceof Promise) {
      throw new $ZodAsyncError;
    }
    payload.value = _out;
    payload.fallback = true;
    return payload;
  };
});
function handleOptionalResult(result, input) {
  if (input === undefined && (result.issues.length || result.fallback)) {
    return { issues: [], value: undefined };
  }
  return result;
}
var $ZodOptional = /* @__PURE__ */ $constructor("$ZodOptional", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  inst._zod.optout = "optional";
  defineLazy(inst._zod, "values", () => {
    return def.innerType._zod.values ? new Set([...def.innerType._zod.values, undefined]) : undefined;
  });
  defineLazy(inst._zod, "pattern", () => {
    const pattern = def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : undefined;
  });
  inst._zod.parse = (payload, ctx) => {
    if (def.innerType._zod.optin === "optional") {
      const input = payload.value;
      const result = def.innerType._zod.run(payload, ctx);
      if (result instanceof Promise)
        return result.then((r) => handleOptionalResult(r, input));
      return handleOptionalResult(result, input);
    }
    if (payload.value === undefined) {
      return payload;
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodExactOptional = /* @__PURE__ */ $constructor("$ZodExactOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  defineLazy(inst._zod, "pattern", () => def.innerType._zod.pattern);
  inst._zod.parse = (payload, ctx) => {
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodNullable = /* @__PURE__ */ $constructor("$ZodNullable", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "optin", () => def.innerType._zod.optin);
  defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
  defineLazy(inst._zod, "pattern", () => {
    const pattern = def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : undefined;
  });
  defineLazy(inst._zod, "values", () => {
    return def.innerType._zod.values ? new Set([...def.innerType._zod.values, null]) : undefined;
  });
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === null)
      return payload;
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodDefault = /* @__PURE__ */ $constructor("$ZodDefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    if (payload.value === undefined) {
      payload.value = def.defaultValue;
      return payload;
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result) => handleDefaultResult(result, def));
    }
    return handleDefaultResult(result, def);
  };
});
function handleDefaultResult(payload, def) {
  if (payload.value === undefined) {
    payload.value = def.defaultValue;
  }
  return payload;
}
var $ZodPrefault = /* @__PURE__ */ $constructor("$ZodPrefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    if (payload.value === undefined) {
      payload.value = def.defaultValue;
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodNonOptional = /* @__PURE__ */ $constructor("$ZodNonOptional", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "values", () => {
    const v = def.innerType._zod.values;
    return v ? new Set([...v].filter((x) => x !== undefined)) : undefined;
  });
  inst._zod.parse = (payload, ctx) => {
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result) => handleNonOptionalResult(result, inst));
    }
    return handleNonOptionalResult(result, inst);
  };
});
function handleNonOptionalResult(payload, inst) {
  if (!payload.issues.length && payload.value === undefined) {
    payload.issues.push({
      code: "invalid_type",
      expected: "nonoptional",
      input: payload.value,
      inst
    });
  }
  return payload;
}
var $ZodCatch = /* @__PURE__ */ $constructor("$ZodCatch", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result) => {
        payload.value = result.value;
        if (result.issues.length) {
          payload.value = def.catchValue({
            ...payload,
            error: {
              issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config()))
            },
            input: payload.value
          });
          payload.issues = [];
          payload.fallback = true;
        }
        return payload;
      });
    }
    payload.value = result.value;
    if (result.issues.length) {
      payload.value = def.catchValue({
        ...payload,
        error: {
          issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config()))
        },
        input: payload.value
      });
      payload.issues = [];
      payload.fallback = true;
    }
    return payload;
  };
});
var $ZodPipe = /* @__PURE__ */ $constructor("$ZodPipe", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "values", () => def.in._zod.values);
  defineLazy(inst._zod, "optin", () => def.in._zod.optin);
  defineLazy(inst._zod, "optout", () => def.out._zod.optout);
  defineLazy(inst._zod, "propValues", () => def.in._zod.propValues);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      const right = def.out._zod.run(payload, ctx);
      if (right instanceof Promise) {
        return right.then((right) => handlePipeResult(right, def.in, ctx));
      }
      return handlePipeResult(right, def.in, ctx);
    }
    const left = def.in._zod.run(payload, ctx);
    if (left instanceof Promise) {
      return left.then((left) => handlePipeResult(left, def.out, ctx));
    }
    return handlePipeResult(left, def.out, ctx);
  };
});
function handlePipeResult(left, next, ctx) {
  if (left.issues.length) {
    left.aborted = true;
    return left;
  }
  return next._zod.run({ value: left.value, issues: left.issues, fallback: left.fallback }, ctx);
}
var $ZodPreprocess = /* @__PURE__ */ $constructor("$ZodPreprocess", (inst, def) => {
  $ZodPipe.init(inst, def);
});
var $ZodReadonly = /* @__PURE__ */ $constructor("$ZodReadonly", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "propValues", () => def.innerType._zod.propValues);
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  defineLazy(inst._zod, "optin", () => def.innerType?._zod?.optin);
  defineLazy(inst._zod, "optout", () => def.innerType?._zod?.optout);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then(handleReadonlyResult);
    }
    return handleReadonlyResult(result);
  };
});
function handleReadonlyResult(payload) {
  payload.value = Object.freeze(payload.value);
  return payload;
}
var $ZodCustom = /* @__PURE__ */ $constructor("$ZodCustom", (inst, def) => {
  $ZodCheck.init(inst, def);
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _) => {
    return payload;
  };
  inst._zod.check = (payload) => {
    const input = payload.value;
    const r = def.fn(input);
    if (r instanceof Promise) {
      return r.then((r) => handleRefineResult(r, payload, input, inst));
    }
    handleRefineResult(r, payload, input, inst);
    return;
  };
});
function handleRefineResult(result, payload, input, inst) {
  if (!result) {
    const _iss = {
      code: "custom",
      input,
      inst,
      path: [...inst._zod.def.path ?? []],
      continue: !inst._zod.def.abort
    };
    if (inst._zod.def.params)
      _iss.params = inst._zod.def.params;
    payload.issues.push(issue(_iss));
  }
}
// node_modules/.bun/zod@4.4.3/node_modules/zod/v4/core/registries.js
var _a2;
var $output = Symbol("ZodOutput");
var $input = Symbol("ZodInput");

class $ZodRegistry {
  constructor() {
    this._map = new WeakMap;
    this._idmap = new Map;
  }
  add(schema, ..._meta) {
    const meta = _meta[0];
    this._map.set(schema, meta);
    if (meta && typeof meta === "object" && "id" in meta) {
      this._idmap.set(meta.id, schema);
    }
    return this;
  }
  clear() {
    this._map = new WeakMap;
    this._idmap = new Map;
    return this;
  }
  remove(schema) {
    const meta = this._map.get(schema);
    if (meta && typeof meta === "object" && "id" in meta) {
      this._idmap.delete(meta.id);
    }
    this._map.delete(schema);
    return this;
  }
  get(schema) {
    const p = schema._zod.parent;
    if (p) {
      const pm = { ...this.get(p) ?? {} };
      delete pm.id;
      const f = { ...pm, ...this._map.get(schema) };
      return Object.keys(f).length ? f : undefined;
    }
    return this._map.get(schema);
  }
  has(schema) {
    return this._map.has(schema);
  }
}
function registry() {
  return new $ZodRegistry;
}
(_a2 = globalThis).__zod_globalRegistry ?? (_a2.__zod_globalRegistry = registry());
var globalRegistry = globalThis.__zod_globalRegistry;
// node_modules/.bun/zod@4.4.3/node_modules/zod/v4/core/api.js
function _string(Class, params) {
  return new Class({
    type: "string",
    ...normalizeParams(params)
  });
}
function _email(Class, params) {
  return new Class({
    type: "string",
    format: "email",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _guid(Class, params) {
  return new Class({
    type: "string",
    format: "guid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _uuid(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _uuidv4(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v4",
    ...normalizeParams(params)
  });
}
function _uuidv6(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v6",
    ...normalizeParams(params)
  });
}
function _uuidv7(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v7",
    ...normalizeParams(params)
  });
}
function _url(Class, params) {
  return new Class({
    type: "string",
    format: "url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _emoji2(Class, params) {
  return new Class({
    type: "string",
    format: "emoji",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _nanoid(Class, params) {
  return new Class({
    type: "string",
    format: "nanoid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cuid(Class, params) {
  return new Class({
    type: "string",
    format: "cuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cuid2(Class, params) {
  return new Class({
    type: "string",
    format: "cuid2",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ulid(Class, params) {
  return new Class({
    type: "string",
    format: "ulid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _xid(Class, params) {
  return new Class({
    type: "string",
    format: "xid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ksuid(Class, params) {
  return new Class({
    type: "string",
    format: "ksuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ipv4(Class, params) {
  return new Class({
    type: "string",
    format: "ipv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ipv6(Class, params) {
  return new Class({
    type: "string",
    format: "ipv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cidrv4(Class, params) {
  return new Class({
    type: "string",
    format: "cidrv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cidrv6(Class, params) {
  return new Class({
    type: "string",
    format: "cidrv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _base64(Class, params) {
  return new Class({
    type: "string",
    format: "base64",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _base64url(Class, params) {
  return new Class({
    type: "string",
    format: "base64url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _e164(Class, params) {
  return new Class({
    type: "string",
    format: "e164",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _jwt(Class, params) {
  return new Class({
    type: "string",
    format: "jwt",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _isoDateTime(Class, params) {
  return new Class({
    type: "string",
    format: "datetime",
    check: "string_format",
    offset: false,
    local: false,
    precision: null,
    ...normalizeParams(params)
  });
}
function _isoDate(Class, params) {
  return new Class({
    type: "string",
    format: "date",
    check: "string_format",
    ...normalizeParams(params)
  });
}
function _isoTime(Class, params) {
  return new Class({
    type: "string",
    format: "time",
    check: "string_format",
    precision: null,
    ...normalizeParams(params)
  });
}
function _isoDuration(Class, params) {
  return new Class({
    type: "string",
    format: "duration",
    check: "string_format",
    ...normalizeParams(params)
  });
}
function _number(Class, params) {
  return new Class({
    type: "number",
    checks: [],
    ...normalizeParams(params)
  });
}
function _int(Class, params) {
  return new Class({
    type: "number",
    check: "number_format",
    abort: false,
    format: "safeint",
    ...normalizeParams(params)
  });
}
function _boolean(Class, params) {
  return new Class({
    type: "boolean",
    ...normalizeParams(params)
  });
}
function _unknown(Class) {
  return new Class({
    type: "unknown"
  });
}
function _never(Class, params) {
  return new Class({
    type: "never",
    ...normalizeParams(params)
  });
}
function _lt(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
function _lte(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
function _gt(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
function _gte(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
function _multipleOf(value, params) {
  return new $ZodCheckMultipleOf({
    check: "multiple_of",
    ...normalizeParams(params),
    value
  });
}
function _maxLength(maximum, params) {
  const ch = new $ZodCheckMaxLength({
    check: "max_length",
    ...normalizeParams(params),
    maximum
  });
  return ch;
}
function _minLength(minimum, params) {
  return new $ZodCheckMinLength({
    check: "min_length",
    ...normalizeParams(params),
    minimum
  });
}
function _length(length, params) {
  return new $ZodCheckLengthEquals({
    check: "length_equals",
    ...normalizeParams(params),
    length
  });
}
function _regex(pattern, params) {
  return new $ZodCheckRegex({
    check: "string_format",
    format: "regex",
    ...normalizeParams(params),
    pattern
  });
}
function _lowercase(params) {
  return new $ZodCheckLowerCase({
    check: "string_format",
    format: "lowercase",
    ...normalizeParams(params)
  });
}
function _uppercase(params) {
  return new $ZodCheckUpperCase({
    check: "string_format",
    format: "uppercase",
    ...normalizeParams(params)
  });
}
function _includes(includes, params) {
  return new $ZodCheckIncludes({
    check: "string_format",
    format: "includes",
    ...normalizeParams(params),
    includes
  });
}
function _startsWith(prefix, params) {
  return new $ZodCheckStartsWith({
    check: "string_format",
    format: "starts_with",
    ...normalizeParams(params),
    prefix
  });
}
function _endsWith(suffix, params) {
  return new $ZodCheckEndsWith({
    check: "string_format",
    format: "ends_with",
    ...normalizeParams(params),
    suffix
  });
}
function _overwrite(tx) {
  return new $ZodCheckOverwrite({
    check: "overwrite",
    tx
  });
}
function _normalize(form) {
  return _overwrite((input) => input.normalize(form));
}
function _trim() {
  return _overwrite((input) => input.trim());
}
function _toLowerCase() {
  return _overwrite((input) => input.toLowerCase());
}
function _toUpperCase() {
  return _overwrite((input) => input.toUpperCase());
}
function _slugify() {
  return _overwrite((input) => slugify(input));
}
function _array(Class, element, params) {
  return new Class({
    type: "array",
    element,
    ...normalizeParams(params)
  });
}
function _refine(Class, fn, _params) {
  const schema = new Class({
    type: "custom",
    check: "custom",
    fn,
    ...normalizeParams(_params)
  });
  return schema;
}
function _superRefine(fn, params) {
  const ch = _check((payload) => {
    payload.addIssue = (issue2) => {
      if (typeof issue2 === "string") {
        payload.issues.push(issue(issue2, payload.value, ch._zod.def));
      } else {
        const _issue = issue2;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        _issue.input ?? (_issue.input = payload.value);
        _issue.inst ?? (_issue.inst = ch);
        _issue.continue ?? (_issue.continue = !ch._zod.def.abort);
        payload.issues.push(issue(_issue));
      }
    };
    return fn(payload.value, payload);
  }, params);
  return ch;
}
function _check(fn, params) {
  const ch = new $ZodCheck({
    check: "custom",
    ...normalizeParams(params)
  });
  ch._zod.check = fn;
  return ch;
}
// node_modules/.bun/zod@4.4.3/node_modules/zod/v4/core/to-json-schema.js
function initializeContext(params) {
  let target = params?.target ?? "draft-2020-12";
  if (target === "draft-4")
    target = "draft-04";
  if (target === "draft-7")
    target = "draft-07";
  return {
    processors: params.processors ?? {},
    metadataRegistry: params?.metadata ?? globalRegistry,
    target,
    unrepresentable: params?.unrepresentable ?? "throw",
    override: params?.override ?? (() => {}),
    io: params?.io ?? "output",
    counter: 0,
    seen: new Map,
    cycles: params?.cycles ?? "ref",
    reused: params?.reused ?? "inline",
    external: params?.external ?? undefined
  };
}
function process2(schema, ctx, _params = { path: [], schemaPath: [] }) {
  var _a;
  const def = schema._zod.def;
  const seen = ctx.seen.get(schema);
  if (seen) {
    seen.count++;
    const isCycle = _params.schemaPath.includes(schema);
    if (isCycle) {
      seen.cycle = _params.path;
    }
    return seen.schema;
  }
  const result = { schema: {}, count: 1, cycle: undefined, path: _params.path };
  ctx.seen.set(schema, result);
  const overrideSchema = schema._zod.toJSONSchema?.();
  if (overrideSchema) {
    result.schema = overrideSchema;
  } else {
    const params = {
      ..._params,
      schemaPath: [..._params.schemaPath, schema],
      path: _params.path
    };
    if (schema._zod.processJSONSchema) {
      schema._zod.processJSONSchema(ctx, result.schema, params);
    } else {
      const _json = result.schema;
      const processor = ctx.processors[def.type];
      if (!processor) {
        throw new Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
      }
      processor(schema, ctx, _json, params);
    }
    const parent = schema._zod.parent;
    if (parent) {
      if (!result.ref)
        result.ref = parent;
      process2(parent, ctx, params);
      ctx.seen.get(parent).isParent = true;
    }
  }
  const meta = ctx.metadataRegistry.get(schema);
  if (meta)
    Object.assign(result.schema, meta);
  if (ctx.io === "input" && isTransforming(schema)) {
    delete result.schema.examples;
    delete result.schema.default;
  }
  if (ctx.io === "input" && "_prefault" in result.schema)
    (_a = result.schema).default ?? (_a.default = result.schema._prefault);
  delete result.schema._prefault;
  const _result = ctx.seen.get(schema);
  return _result.schema;
}
function extractDefs(ctx, schema) {
  const root = ctx.seen.get(schema);
  if (!root)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  const idToSchema = new Map;
  for (const entry of ctx.seen.entries()) {
    const id = ctx.metadataRegistry.get(entry[0])?.id;
    if (id) {
      const existing = idToSchema.get(id);
      if (existing && existing !== entry[0]) {
        throw new Error(`Duplicate schema id "${id}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
      }
      idToSchema.set(id, entry[0]);
    }
  }
  const makeURI = (entry) => {
    const defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
    if (ctx.external) {
      const externalId = ctx.external.registry.get(entry[0])?.id;
      const uriGenerator = ctx.external.uri ?? ((id) => id);
      if (externalId) {
        return { ref: uriGenerator(externalId) };
      }
      const id = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
      entry[1].defId = id;
      return { defId: id, ref: `${uriGenerator("__shared")}#/${defsSegment}/${id}` };
    }
    if (entry[1] === root) {
      return { ref: "#" };
    }
    const uriPrefix = `#`;
    const defUriPrefix = `${uriPrefix}/${defsSegment}/`;
    const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
    return { defId, ref: defUriPrefix + defId };
  };
  const extractToDef = (entry) => {
    if (entry[1].schema.$ref) {
      return;
    }
    const seen = entry[1];
    const { ref, defId } = makeURI(entry);
    seen.def = { ...seen.schema };
    if (defId)
      seen.defId = defId;
    const schema = seen.schema;
    for (const key in schema) {
      delete schema[key];
    }
    schema.$ref = ref;
  };
  if (ctx.cycles === "throw") {
    for (const entry of ctx.seen.entries()) {
      const seen = entry[1];
      if (seen.cycle) {
        throw new Error("Cycle detected: " + `#/${seen.cycle?.join("/")}/<root>` + '\n\nSet the `cycles` parameter to `"ref"` to resolve cyclical schemas with defs.');
      }
    }
  }
  for (const entry of ctx.seen.entries()) {
    const seen = entry[1];
    if (schema === entry[0]) {
      extractToDef(entry);
      continue;
    }
    if (ctx.external) {
      const ext = ctx.external.registry.get(entry[0])?.id;
      if (schema !== entry[0] && ext) {
        extractToDef(entry);
        continue;
      }
    }
    const id = ctx.metadataRegistry.get(entry[0])?.id;
    if (id) {
      extractToDef(entry);
      continue;
    }
    if (seen.cycle) {
      extractToDef(entry);
      continue;
    }
    if (seen.count > 1) {
      if (ctx.reused === "ref") {
        extractToDef(entry);
        continue;
      }
    }
  }
}
function finalize(ctx, schema) {
  const root = ctx.seen.get(schema);
  if (!root)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  const flattenRef = (zodSchema) => {
    const seen = ctx.seen.get(zodSchema);
    if (seen.ref === null)
      return;
    const schema = seen.def ?? seen.schema;
    const _cached = { ...schema };
    const ref = seen.ref;
    seen.ref = null;
    if (ref) {
      flattenRef(ref);
      const refSeen = ctx.seen.get(ref);
      const refSchema = refSeen.schema;
      if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
        schema.allOf = schema.allOf ?? [];
        schema.allOf.push(refSchema);
      } else {
        Object.assign(schema, refSchema);
      }
      Object.assign(schema, _cached);
      const isParentRef = zodSchema._zod.parent === ref;
      if (isParentRef) {
        for (const key in schema) {
          if (key === "$ref" || key === "allOf")
            continue;
          if (!(key in _cached)) {
            delete schema[key];
          }
        }
      }
      if (refSchema.$ref && refSeen.def) {
        for (const key in schema) {
          if (key === "$ref" || key === "allOf")
            continue;
          if (key in refSeen.def && JSON.stringify(schema[key]) === JSON.stringify(refSeen.def[key])) {
            delete schema[key];
          }
        }
      }
    }
    const parent = zodSchema._zod.parent;
    if (parent && parent !== ref) {
      flattenRef(parent);
      const parentSeen = ctx.seen.get(parent);
      if (parentSeen?.schema.$ref) {
        schema.$ref = parentSeen.schema.$ref;
        if (parentSeen.def) {
          for (const key in schema) {
            if (key === "$ref" || key === "allOf")
              continue;
            if (key in parentSeen.def && JSON.stringify(schema[key]) === JSON.stringify(parentSeen.def[key])) {
              delete schema[key];
            }
          }
        }
      }
    }
    ctx.override({
      zodSchema,
      jsonSchema: schema,
      path: seen.path ?? []
    });
  };
  for (const entry of [...ctx.seen.entries()].reverse()) {
    flattenRef(entry[0]);
  }
  const result = {};
  if (ctx.target === "draft-2020-12") {
    result.$schema = "https://json-schema.org/draft/2020-12/schema";
  } else if (ctx.target === "draft-07") {
    result.$schema = "http://json-schema.org/draft-07/schema#";
  } else if (ctx.target === "draft-04") {
    result.$schema = "http://json-schema.org/draft-04/schema#";
  } else if (ctx.target === "openapi-3.0") {}
  if (ctx.external?.uri) {
    const id = ctx.external.registry.get(schema)?.id;
    if (!id)
      throw new Error("Schema is missing an `id` property");
    result.$id = ctx.external.uri(id);
  }
  Object.assign(result, root.def ?? root.schema);
  const rootMetaId = ctx.metadataRegistry.get(schema)?.id;
  if (rootMetaId !== undefined && result.id === rootMetaId)
    delete result.id;
  const defs = ctx.external?.defs ?? {};
  for (const entry of ctx.seen.entries()) {
    const seen = entry[1];
    if (seen.def && seen.defId) {
      if (seen.def.id === seen.defId)
        delete seen.def.id;
      defs[seen.defId] = seen.def;
    }
  }
  if (ctx.external) {} else {
    if (Object.keys(defs).length > 0) {
      if (ctx.target === "draft-2020-12") {
        result.$defs = defs;
      } else {
        result.definitions = defs;
      }
    }
  }
  try {
    const finalized = JSON.parse(JSON.stringify(result));
    Object.defineProperty(finalized, "~standard", {
      value: {
        ...schema["~standard"],
        jsonSchema: {
          input: createStandardJSONSchemaMethod(schema, "input", ctx.processors),
          output: createStandardJSONSchemaMethod(schema, "output", ctx.processors)
        }
      },
      enumerable: false,
      writable: false
    });
    return finalized;
  } catch (_err) {
    throw new Error("Error converting schema to JSON.");
  }
}
function isTransforming(_schema, _ctx) {
  const ctx = _ctx ?? { seen: new Set };
  if (ctx.seen.has(_schema))
    return false;
  ctx.seen.add(_schema);
  const def = _schema._zod.def;
  if (def.type === "transform")
    return true;
  if (def.type === "array")
    return isTransforming(def.element, ctx);
  if (def.type === "set")
    return isTransforming(def.valueType, ctx);
  if (def.type === "lazy")
    return isTransforming(def.getter(), ctx);
  if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault") {
    return isTransforming(def.innerType, ctx);
  }
  if (def.type === "intersection") {
    return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
  }
  if (def.type === "record" || def.type === "map") {
    return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
  }
  if (def.type === "pipe") {
    if (_schema._zod.traits.has("$ZodCodec"))
      return true;
    return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
  }
  if (def.type === "object") {
    for (const key in def.shape) {
      if (isTransforming(def.shape[key], ctx))
        return true;
    }
    return false;
  }
  if (def.type === "union") {
    for (const option of def.options) {
      if (isTransforming(option, ctx))
        return true;
    }
    return false;
  }
  if (def.type === "tuple") {
    for (const item of def.items) {
      if (isTransforming(item, ctx))
        return true;
    }
    if (def.rest && isTransforming(def.rest, ctx))
      return true;
    return false;
  }
  return false;
}
var createToJSONSchemaMethod = (schema, processors = {}) => (params) => {
  const ctx = initializeContext({ ...params, processors });
  process2(schema, ctx);
  extractDefs(ctx, schema);
  return finalize(ctx, schema);
};
var createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
  const { libraryOptions, target } = params ?? {};
  const ctx = initializeContext({ ...libraryOptions ?? {}, target, io, processors });
  process2(schema, ctx);
  extractDefs(ctx, schema);
  return finalize(ctx, schema);
};
// node_modules/.bun/zod@4.4.3/node_modules/zod/v4/core/json-schema-processors.js
var formatMap = {
  guid: "uuid",
  url: "uri",
  datetime: "date-time",
  json_string: "json-string",
  regex: ""
};
var stringProcessor = (schema, ctx, _json, _params) => {
  const json = _json;
  json.type = "string";
  const { minimum, maximum, format, patterns, contentEncoding } = schema._zod.bag;
  if (typeof minimum === "number")
    json.minLength = minimum;
  if (typeof maximum === "number")
    json.maxLength = maximum;
  if (format) {
    json.format = formatMap[format] ?? format;
    if (json.format === "")
      delete json.format;
    if (format === "time") {
      delete json.format;
    }
  }
  if (contentEncoding)
    json.contentEncoding = contentEncoding;
  if (patterns && patterns.size > 0) {
    const regexes = [...patterns];
    if (regexes.length === 1)
      json.pattern = regexes[0].source;
    else if (regexes.length > 1) {
      json.allOf = [
        ...regexes.map((regex) => ({
          ...ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0" ? { type: "string" } : {},
          pattern: regex.source
        }))
      ];
    }
  }
};
var numberProcessor = (schema, ctx, _json, _params) => {
  const json = _json;
  const { minimum, maximum, format, multipleOf, exclusiveMaximum, exclusiveMinimum } = schema._zod.bag;
  if (typeof format === "string" && format.includes("int"))
    json.type = "integer";
  else
    json.type = "number";
  const exMin = typeof exclusiveMinimum === "number" && exclusiveMinimum >= (minimum ?? Number.NEGATIVE_INFINITY);
  const exMax = typeof exclusiveMaximum === "number" && exclusiveMaximum <= (maximum ?? Number.POSITIVE_INFINITY);
  const legacy = ctx.target === "draft-04" || ctx.target === "openapi-3.0";
  if (exMin) {
    if (legacy) {
      json.minimum = exclusiveMinimum;
      json.exclusiveMinimum = true;
    } else {
      json.exclusiveMinimum = exclusiveMinimum;
    }
  } else if (typeof minimum === "number") {
    json.minimum = minimum;
  }
  if (exMax) {
    if (legacy) {
      json.maximum = exclusiveMaximum;
      json.exclusiveMaximum = true;
    } else {
      json.exclusiveMaximum = exclusiveMaximum;
    }
  } else if (typeof maximum === "number") {
    json.maximum = maximum;
  }
  if (typeof multipleOf === "number")
    json.multipleOf = multipleOf;
};
var booleanProcessor = (_schema, _ctx, json, _params) => {
  json.type = "boolean";
};
var neverProcessor = (_schema, _ctx, json, _params) => {
  json.not = {};
};
var unknownProcessor = (_schema, _ctx, _json, _params) => {};
var enumProcessor = (schema, _ctx, json, _params) => {
  const def = schema._zod.def;
  const values = getEnumValues(def.entries);
  if (values.every((v) => typeof v === "number"))
    json.type = "number";
  if (values.every((v) => typeof v === "string"))
    json.type = "string";
  json.enum = values;
};
var literalProcessor = (schema, ctx, json, _params) => {
  const def = schema._zod.def;
  const vals = [];
  for (const val of def.values) {
    if (val === undefined) {
      if (ctx.unrepresentable === "throw") {
        throw new Error("Literal `undefined` cannot be represented in JSON Schema");
      }
    } else if (typeof val === "bigint") {
      if (ctx.unrepresentable === "throw") {
        throw new Error("BigInt literals cannot be represented in JSON Schema");
      } else {
        vals.push(Number(val));
      }
    } else {
      vals.push(val);
    }
  }
  if (vals.length === 0) {} else if (vals.length === 1) {
    const val = vals[0];
    json.type = val === null ? "null" : typeof val;
    if (ctx.target === "draft-04" || ctx.target === "openapi-3.0") {
      json.enum = [val];
    } else {
      json.const = val;
    }
  } else {
    if (vals.every((v) => typeof v === "number"))
      json.type = "number";
    if (vals.every((v) => typeof v === "string"))
      json.type = "string";
    if (vals.every((v) => typeof v === "boolean"))
      json.type = "boolean";
    if (vals.every((v) => v === null))
      json.type = "null";
    json.enum = vals;
  }
};
var customProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Custom types cannot be represented in JSON Schema");
  }
};
var transformProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Transforms cannot be represented in JSON Schema");
  }
};
var arrayProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const def = schema._zod.def;
  const { minimum, maximum } = schema._zod.bag;
  if (typeof minimum === "number")
    json.minItems = minimum;
  if (typeof maximum === "number")
    json.maxItems = maximum;
  json.type = "array";
  json.items = process2(def.element, ctx, {
    ...params,
    path: [...params.path, "items"]
  });
};
var objectProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const def = schema._zod.def;
  json.type = "object";
  json.properties = {};
  const shape = def.shape;
  for (const key in shape) {
    json.properties[key] = process2(shape[key], ctx, {
      ...params,
      path: [...params.path, "properties", key]
    });
  }
  const allKeys = new Set(Object.keys(shape));
  const requiredKeys = new Set([...allKeys].filter((key) => {
    const v = def.shape[key]._zod;
    if (ctx.io === "input") {
      return v.optin === undefined;
    } else {
      return v.optout === undefined;
    }
  }));
  if (requiredKeys.size > 0) {
    json.required = Array.from(requiredKeys);
  }
  if (def.catchall?._zod.def.type === "never") {
    json.additionalProperties = false;
  } else if (!def.catchall) {
    if (ctx.io === "output")
      json.additionalProperties = false;
  } else if (def.catchall) {
    json.additionalProperties = process2(def.catchall, ctx, {
      ...params,
      path: [...params.path, "additionalProperties"]
    });
  }
};
var unionProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const isExclusive = def.inclusive === false;
  const options = def.options.map((x, i) => process2(x, ctx, {
    ...params,
    path: [...params.path, isExclusive ? "oneOf" : "anyOf", i]
  }));
  if (isExclusive) {
    json.oneOf = options;
  } else {
    json.anyOf = options;
  }
};
var intersectionProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const a = process2(def.left, ctx, {
    ...params,
    path: [...params.path, "allOf", 0]
  });
  const b = process2(def.right, ctx, {
    ...params,
    path: [...params.path, "allOf", 1]
  });
  const isSimpleIntersection = (val) => ("allOf" in val) && Object.keys(val).length === 1;
  const allOf = [
    ...isSimpleIntersection(a) ? a.allOf : [a],
    ...isSimpleIntersection(b) ? b.allOf : [b]
  ];
  json.allOf = allOf;
};
var recordProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const def = schema._zod.def;
  json.type = "object";
  const keyType = def.keyType;
  const keyBag = keyType._zod.bag;
  const patterns = keyBag?.patterns;
  if (def.mode === "loose" && patterns && patterns.size > 0) {
    const valueSchema = process2(def.valueType, ctx, {
      ...params,
      path: [...params.path, "patternProperties", "*"]
    });
    json.patternProperties = {};
    for (const pattern of patterns) {
      json.patternProperties[pattern.source] = valueSchema;
    }
  } else {
    if (ctx.target === "draft-07" || ctx.target === "draft-2020-12") {
      json.propertyNames = process2(def.keyType, ctx, {
        ...params,
        path: [...params.path, "propertyNames"]
      });
    }
    json.additionalProperties = process2(def.valueType, ctx, {
      ...params,
      path: [...params.path, "additionalProperties"]
    });
  }
  const keyValues = keyType._zod.values;
  if (keyValues) {
    const validKeyValues = [...keyValues].filter((v) => typeof v === "string" || typeof v === "number");
    if (validKeyValues.length > 0) {
      json.required = validKeyValues;
    }
  }
};
var nullableProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const inner = process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  if (ctx.target === "openapi-3.0") {
    seen.ref = def.innerType;
    json.nullable = true;
  } else {
    json.anyOf = [inner, { type: "null" }];
  }
};
var nonoptionalProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
};
var defaultProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  json.default = JSON.parse(JSON.stringify(def.defaultValue));
};
var prefaultProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  if (ctx.io === "input")
    json._prefault = JSON.parse(JSON.stringify(def.defaultValue));
};
var catchProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  let catchValue;
  try {
    catchValue = def.catchValue(undefined);
  } catch {
    throw new Error("Dynamic catch values are not supported in JSON Schema");
  }
  json.default = catchValue;
};
var pipeProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  const inIsTransform = def.in._zod.traits.has("$ZodTransform");
  const innerType = ctx.io === "input" ? inIsTransform ? def.out : def.in : def.out;
  process2(innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = innerType;
};
var readonlyProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  json.readOnly = true;
};
var optionalProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
};
// node_modules/.bun/zod@4.4.3/node_modules/zod/v4/classic/iso.js
var ZodISODateTime = /* @__PURE__ */ $constructor("ZodISODateTime", (inst, def) => {
  $ZodISODateTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function datetime2(params) {
  return _isoDateTime(ZodISODateTime, params);
}
var ZodISODate = /* @__PURE__ */ $constructor("ZodISODate", (inst, def) => {
  $ZodISODate.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function date2(params) {
  return _isoDate(ZodISODate, params);
}
var ZodISOTime = /* @__PURE__ */ $constructor("ZodISOTime", (inst, def) => {
  $ZodISOTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function time2(params) {
  return _isoTime(ZodISOTime, params);
}
var ZodISODuration = /* @__PURE__ */ $constructor("ZodISODuration", (inst, def) => {
  $ZodISODuration.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function duration2(params) {
  return _isoDuration(ZodISODuration, params);
}

// node_modules/.bun/zod@4.4.3/node_modules/zod/v4/classic/errors.js
var initializer2 = (inst, issues) => {
  $ZodError.init(inst, issues);
  inst.name = "ZodError";
  Object.defineProperties(inst, {
    format: {
      value: (mapper) => formatError(inst, mapper)
    },
    flatten: {
      value: (mapper) => flattenError(inst, mapper)
    },
    addIssue: {
      value: (issue) => {
        inst.issues.push(issue);
        inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
      }
    },
    addIssues: {
      value: (issues) => {
        inst.issues.push(...issues);
        inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
      }
    },
    isEmpty: {
      get() {
        return inst.issues.length === 0;
      }
    }
  });
};
var ZodRealError = /* @__PURE__ */ $constructor("ZodError", initializer2, {
  Parent: Error
});

// node_modules/.bun/zod@4.4.3/node_modules/zod/v4/classic/parse.js
var parse3 = /* @__PURE__ */ _parse(ZodRealError);
var parseAsync2 = /* @__PURE__ */ _parseAsync(ZodRealError);
var safeParse2 = /* @__PURE__ */ _safeParse(ZodRealError);
var safeParseAsync2 = /* @__PURE__ */ _safeParseAsync(ZodRealError);
var encode = /* @__PURE__ */ _encode(ZodRealError);
var decode = /* @__PURE__ */ _decode(ZodRealError);
var encodeAsync = /* @__PURE__ */ _encodeAsync(ZodRealError);
var decodeAsync = /* @__PURE__ */ _decodeAsync(ZodRealError);
var safeEncode = /* @__PURE__ */ _safeEncode(ZodRealError);
var safeDecode = /* @__PURE__ */ _safeDecode(ZodRealError);
var safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
var safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);

// node_modules/.bun/zod@4.4.3/node_modules/zod/v4/classic/schemas.js
var _installedGroups = /* @__PURE__ */ new WeakMap;
function _installLazyMethods(inst, group, methods) {
  const proto = Object.getPrototypeOf(inst);
  let installed = _installedGroups.get(proto);
  if (!installed) {
    installed = new Set;
    _installedGroups.set(proto, installed);
  }
  if (installed.has(group))
    return;
  installed.add(group);
  for (const key in methods) {
    const fn = methods[key];
    Object.defineProperty(proto, key, {
      configurable: true,
      enumerable: false,
      get() {
        const bound = fn.bind(this);
        Object.defineProperty(this, key, {
          configurable: true,
          writable: true,
          enumerable: true,
          value: bound
        });
        return bound;
      },
      set(v) {
        Object.defineProperty(this, key, {
          configurable: true,
          writable: true,
          enumerable: true,
          value: v
        });
      }
    });
  }
}
var ZodType = /* @__PURE__ */ $constructor("ZodType", (inst, def) => {
  $ZodType.init(inst, def);
  Object.assign(inst["~standard"], {
    jsonSchema: {
      input: createStandardJSONSchemaMethod(inst, "input"),
      output: createStandardJSONSchemaMethod(inst, "output")
    }
  });
  inst.toJSONSchema = createToJSONSchemaMethod(inst, {});
  inst.def = def;
  inst.type = def.type;
  Object.defineProperty(inst, "_def", { value: def });
  inst.parse = (data, params) => parse3(inst, data, params, { callee: inst.parse });
  inst.safeParse = (data, params) => safeParse2(inst, data, params);
  inst.parseAsync = async (data, params) => parseAsync2(inst, data, params, { callee: inst.parseAsync });
  inst.safeParseAsync = async (data, params) => safeParseAsync2(inst, data, params);
  inst.spa = inst.safeParseAsync;
  inst.encode = (data, params) => encode(inst, data, params);
  inst.decode = (data, params) => decode(inst, data, params);
  inst.encodeAsync = async (data, params) => encodeAsync(inst, data, params);
  inst.decodeAsync = async (data, params) => decodeAsync(inst, data, params);
  inst.safeEncode = (data, params) => safeEncode(inst, data, params);
  inst.safeDecode = (data, params) => safeDecode(inst, data, params);
  inst.safeEncodeAsync = async (data, params) => safeEncodeAsync(inst, data, params);
  inst.safeDecodeAsync = async (data, params) => safeDecodeAsync(inst, data, params);
  _installLazyMethods(inst, "ZodType", {
    check(...chks) {
      const def = this.def;
      return this.clone(mergeDefs(def, {
        checks: [
          ...def.checks ?? [],
          ...chks.map((ch) => typeof ch === "function" ? { _zod: { check: ch, def: { check: "custom" }, onattach: [] } } : ch)
        ]
      }), { parent: true });
    },
    with(...chks) {
      return this.check(...chks);
    },
    clone(def, params) {
      return clone(this, def, params);
    },
    brand() {
      return this;
    },
    register(reg, meta) {
      reg.add(this, meta);
      return this;
    },
    refine(check, params) {
      return this.check(refine(check, params));
    },
    superRefine(refinement, params) {
      return this.check(superRefine(refinement, params));
    },
    overwrite(fn) {
      return this.check(_overwrite(fn));
    },
    optional() {
      return optional(this);
    },
    exactOptional() {
      return exactOptional(this);
    },
    nullable() {
      return nullable(this);
    },
    nullish() {
      return optional(nullable(this));
    },
    nonoptional(params) {
      return nonoptional(this, params);
    },
    array() {
      return array(this);
    },
    or(arg) {
      return union([this, arg]);
    },
    and(arg) {
      return intersection(this, arg);
    },
    transform(tx) {
      return pipe(this, transform(tx));
    },
    default(d) {
      return _default(this, d);
    },
    prefault(d) {
      return prefault(this, d);
    },
    catch(params) {
      return _catch(this, params);
    },
    pipe(target) {
      return pipe(this, target);
    },
    readonly() {
      return readonly(this);
    },
    describe(description) {
      const cl = this.clone();
      globalRegistry.add(cl, { description });
      return cl;
    },
    meta(...args) {
      if (args.length === 0)
        return globalRegistry.get(this);
      const cl = this.clone();
      globalRegistry.add(cl, args[0]);
      return cl;
    },
    isOptional() {
      return this.safeParse(undefined).success;
    },
    isNullable() {
      return this.safeParse(null).success;
    },
    apply(fn) {
      return fn(this);
    }
  });
  Object.defineProperty(inst, "description", {
    get() {
      return globalRegistry.get(inst)?.description;
    },
    configurable: true
  });
  return inst;
});
var _ZodString = /* @__PURE__ */ $constructor("_ZodString", (inst, def) => {
  $ZodString.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => stringProcessor(inst, ctx, json, params);
  const bag = inst._zod.bag;
  inst.format = bag.format ?? null;
  inst.minLength = bag.minimum ?? null;
  inst.maxLength = bag.maximum ?? null;
  _installLazyMethods(inst, "_ZodString", {
    regex(...args) {
      return this.check(_regex(...args));
    },
    includes(...args) {
      return this.check(_includes(...args));
    },
    startsWith(...args) {
      return this.check(_startsWith(...args));
    },
    endsWith(...args) {
      return this.check(_endsWith(...args));
    },
    min(...args) {
      return this.check(_minLength(...args));
    },
    max(...args) {
      return this.check(_maxLength(...args));
    },
    length(...args) {
      return this.check(_length(...args));
    },
    nonempty(...args) {
      return this.check(_minLength(1, ...args));
    },
    lowercase(params) {
      return this.check(_lowercase(params));
    },
    uppercase(params) {
      return this.check(_uppercase(params));
    },
    trim() {
      return this.check(_trim());
    },
    normalize(...args) {
      return this.check(_normalize(...args));
    },
    toLowerCase() {
      return this.check(_toLowerCase());
    },
    toUpperCase() {
      return this.check(_toUpperCase());
    },
    slugify() {
      return this.check(_slugify());
    }
  });
});
var ZodString = /* @__PURE__ */ $constructor("ZodString", (inst, def) => {
  $ZodString.init(inst, def);
  _ZodString.init(inst, def);
  inst.email = (params) => inst.check(_email(ZodEmail, params));
  inst.url = (params) => inst.check(_url(ZodURL, params));
  inst.jwt = (params) => inst.check(_jwt(ZodJWT, params));
  inst.emoji = (params) => inst.check(_emoji2(ZodEmoji, params));
  inst.guid = (params) => inst.check(_guid(ZodGUID, params));
  inst.uuid = (params) => inst.check(_uuid(ZodUUID, params));
  inst.uuidv4 = (params) => inst.check(_uuidv4(ZodUUID, params));
  inst.uuidv6 = (params) => inst.check(_uuidv6(ZodUUID, params));
  inst.uuidv7 = (params) => inst.check(_uuidv7(ZodUUID, params));
  inst.nanoid = (params) => inst.check(_nanoid(ZodNanoID, params));
  inst.guid = (params) => inst.check(_guid(ZodGUID, params));
  inst.cuid = (params) => inst.check(_cuid(ZodCUID, params));
  inst.cuid2 = (params) => inst.check(_cuid2(ZodCUID2, params));
  inst.ulid = (params) => inst.check(_ulid(ZodULID, params));
  inst.base64 = (params) => inst.check(_base64(ZodBase64, params));
  inst.base64url = (params) => inst.check(_base64url(ZodBase64URL, params));
  inst.xid = (params) => inst.check(_xid(ZodXID, params));
  inst.ksuid = (params) => inst.check(_ksuid(ZodKSUID, params));
  inst.ipv4 = (params) => inst.check(_ipv4(ZodIPv4, params));
  inst.ipv6 = (params) => inst.check(_ipv6(ZodIPv6, params));
  inst.cidrv4 = (params) => inst.check(_cidrv4(ZodCIDRv4, params));
  inst.cidrv6 = (params) => inst.check(_cidrv6(ZodCIDRv6, params));
  inst.e164 = (params) => inst.check(_e164(ZodE164, params));
  inst.datetime = (params) => inst.check(datetime2(params));
  inst.date = (params) => inst.check(date2(params));
  inst.time = (params) => inst.check(time2(params));
  inst.duration = (params) => inst.check(duration2(params));
});
function string2(params) {
  return _string(ZodString, params);
}
var ZodStringFormat = /* @__PURE__ */ $constructor("ZodStringFormat", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  _ZodString.init(inst, def);
});
var ZodEmail = /* @__PURE__ */ $constructor("ZodEmail", (inst, def) => {
  $ZodEmail.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodGUID = /* @__PURE__ */ $constructor("ZodGUID", (inst, def) => {
  $ZodGUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodUUID = /* @__PURE__ */ $constructor("ZodUUID", (inst, def) => {
  $ZodUUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodURL = /* @__PURE__ */ $constructor("ZodURL", (inst, def) => {
  $ZodURL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodEmoji = /* @__PURE__ */ $constructor("ZodEmoji", (inst, def) => {
  $ZodEmoji.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodNanoID = /* @__PURE__ */ $constructor("ZodNanoID", (inst, def) => {
  $ZodNanoID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCUID = /* @__PURE__ */ $constructor("ZodCUID", (inst, def) => {
  $ZodCUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCUID2 = /* @__PURE__ */ $constructor("ZodCUID2", (inst, def) => {
  $ZodCUID2.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodULID = /* @__PURE__ */ $constructor("ZodULID", (inst, def) => {
  $ZodULID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodXID = /* @__PURE__ */ $constructor("ZodXID", (inst, def) => {
  $ZodXID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodKSUID = /* @__PURE__ */ $constructor("ZodKSUID", (inst, def) => {
  $ZodKSUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodIPv4 = /* @__PURE__ */ $constructor("ZodIPv4", (inst, def) => {
  $ZodIPv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodIPv6 = /* @__PURE__ */ $constructor("ZodIPv6", (inst, def) => {
  $ZodIPv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCIDRv4 = /* @__PURE__ */ $constructor("ZodCIDRv4", (inst, def) => {
  $ZodCIDRv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCIDRv6 = /* @__PURE__ */ $constructor("ZodCIDRv6", (inst, def) => {
  $ZodCIDRv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodBase64 = /* @__PURE__ */ $constructor("ZodBase64", (inst, def) => {
  $ZodBase64.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodBase64URL = /* @__PURE__ */ $constructor("ZodBase64URL", (inst, def) => {
  $ZodBase64URL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodE164 = /* @__PURE__ */ $constructor("ZodE164", (inst, def) => {
  $ZodE164.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodJWT = /* @__PURE__ */ $constructor("ZodJWT", (inst, def) => {
  $ZodJWT.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodNumber = /* @__PURE__ */ $constructor("ZodNumber", (inst, def) => {
  $ZodNumber.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => numberProcessor(inst, ctx, json, params);
  _installLazyMethods(inst, "ZodNumber", {
    gt(value, params) {
      return this.check(_gt(value, params));
    },
    gte(value, params) {
      return this.check(_gte(value, params));
    },
    min(value, params) {
      return this.check(_gte(value, params));
    },
    lt(value, params) {
      return this.check(_lt(value, params));
    },
    lte(value, params) {
      return this.check(_lte(value, params));
    },
    max(value, params) {
      return this.check(_lte(value, params));
    },
    int(params) {
      return this.check(int(params));
    },
    safe(params) {
      return this.check(int(params));
    },
    positive(params) {
      return this.check(_gt(0, params));
    },
    nonnegative(params) {
      return this.check(_gte(0, params));
    },
    negative(params) {
      return this.check(_lt(0, params));
    },
    nonpositive(params) {
      return this.check(_lte(0, params));
    },
    multipleOf(value, params) {
      return this.check(_multipleOf(value, params));
    },
    step(value, params) {
      return this.check(_multipleOf(value, params));
    },
    finite() {
      return this;
    }
  });
  const bag = inst._zod.bag;
  inst.minValue = Math.max(bag.minimum ?? Number.NEGATIVE_INFINITY, bag.exclusiveMinimum ?? Number.NEGATIVE_INFINITY) ?? null;
  inst.maxValue = Math.min(bag.maximum ?? Number.POSITIVE_INFINITY, bag.exclusiveMaximum ?? Number.POSITIVE_INFINITY) ?? null;
  inst.isInt = (bag.format ?? "").includes("int") || Number.isSafeInteger(bag.multipleOf ?? 0.5);
  inst.isFinite = true;
  inst.format = bag.format ?? null;
});
function number2(params) {
  return _number(ZodNumber, params);
}
var ZodNumberFormat = /* @__PURE__ */ $constructor("ZodNumberFormat", (inst, def) => {
  $ZodNumberFormat.init(inst, def);
  ZodNumber.init(inst, def);
});
function int(params) {
  return _int(ZodNumberFormat, params);
}
var ZodBoolean = /* @__PURE__ */ $constructor("ZodBoolean", (inst, def) => {
  $ZodBoolean.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => booleanProcessor(inst, ctx, json, params);
});
function boolean2(params) {
  return _boolean(ZodBoolean, params);
}
var ZodUnknown = /* @__PURE__ */ $constructor("ZodUnknown", (inst, def) => {
  $ZodUnknown.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => unknownProcessor(inst, ctx, json, params);
});
function unknown() {
  return _unknown(ZodUnknown);
}
var ZodNever = /* @__PURE__ */ $constructor("ZodNever", (inst, def) => {
  $ZodNever.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => neverProcessor(inst, ctx, json, params);
});
function never(params) {
  return _never(ZodNever, params);
}
var ZodArray = /* @__PURE__ */ $constructor("ZodArray", (inst, def) => {
  $ZodArray.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => arrayProcessor(inst, ctx, json, params);
  inst.element = def.element;
  _installLazyMethods(inst, "ZodArray", {
    min(n, params) {
      return this.check(_minLength(n, params));
    },
    nonempty(params) {
      return this.check(_minLength(1, params));
    },
    max(n, params) {
      return this.check(_maxLength(n, params));
    },
    length(n, params) {
      return this.check(_length(n, params));
    },
    unwrap() {
      return this.element;
    }
  });
});
function array(element, params) {
  return _array(ZodArray, element, params);
}
var ZodObject = /* @__PURE__ */ $constructor("ZodObject", (inst, def) => {
  $ZodObjectJIT.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => objectProcessor(inst, ctx, json, params);
  defineLazy(inst, "shape", () => {
    return def.shape;
  });
  _installLazyMethods(inst, "ZodObject", {
    keyof() {
      return _enum(Object.keys(this._zod.def.shape));
    },
    catchall(catchall) {
      return this.clone({ ...this._zod.def, catchall });
    },
    passthrough() {
      return this.clone({ ...this._zod.def, catchall: unknown() });
    },
    loose() {
      return this.clone({ ...this._zod.def, catchall: unknown() });
    },
    strict() {
      return this.clone({ ...this._zod.def, catchall: never() });
    },
    strip() {
      return this.clone({ ...this._zod.def, catchall: undefined });
    },
    extend(incoming) {
      return extend(this, incoming);
    },
    safeExtend(incoming) {
      return safeExtend(this, incoming);
    },
    merge(other) {
      return merge(this, other);
    },
    pick(mask) {
      return pick(this, mask);
    },
    omit(mask) {
      return omit(this, mask);
    },
    partial(...args) {
      return partial(ZodOptional, this, args[0]);
    },
    required(...args) {
      return required(ZodNonOptional, this, args[0]);
    }
  });
});
function object(shape, params) {
  const def = {
    type: "object",
    shape: shape ?? {},
    ...normalizeParams(params)
  };
  return new ZodObject(def);
}
var ZodUnion = /* @__PURE__ */ $constructor("ZodUnion", (inst, def) => {
  $ZodUnion.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => unionProcessor(inst, ctx, json, params);
  inst.options = def.options;
});
function union(options, params) {
  return new ZodUnion({
    type: "union",
    options,
    ...normalizeParams(params)
  });
}
var ZodDiscriminatedUnion = /* @__PURE__ */ $constructor("ZodDiscriminatedUnion", (inst, def) => {
  ZodUnion.init(inst, def);
  $ZodDiscriminatedUnion.init(inst, def);
});
function discriminatedUnion(discriminator, options, params) {
  return new ZodDiscriminatedUnion({
    type: "union",
    options,
    discriminator,
    ...normalizeParams(params)
  });
}
var ZodIntersection = /* @__PURE__ */ $constructor("ZodIntersection", (inst, def) => {
  $ZodIntersection.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => intersectionProcessor(inst, ctx, json, params);
});
function intersection(left, right) {
  return new ZodIntersection({
    type: "intersection",
    left,
    right
  });
}
var ZodRecord = /* @__PURE__ */ $constructor("ZodRecord", (inst, def) => {
  $ZodRecord.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => recordProcessor(inst, ctx, json, params);
  inst.keyType = def.keyType;
  inst.valueType = def.valueType;
});
function record(keyType, valueType, params) {
  if (!valueType || !valueType._zod) {
    return new ZodRecord({
      type: "record",
      keyType: string2(),
      valueType: keyType,
      ...normalizeParams(valueType)
    });
  }
  return new ZodRecord({
    type: "record",
    keyType,
    valueType,
    ...normalizeParams(params)
  });
}
var ZodEnum = /* @__PURE__ */ $constructor("ZodEnum", (inst, def) => {
  $ZodEnum.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => enumProcessor(inst, ctx, json, params);
  inst.enum = def.entries;
  inst.options = Object.values(def.entries);
  const keys = new Set(Object.keys(def.entries));
  inst.extract = (values, params) => {
    const newEntries = {};
    for (const value of values) {
      if (keys.has(value)) {
        newEntries[value] = def.entries[value];
      } else
        throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodEnum({
      ...def,
      checks: [],
      ...normalizeParams(params),
      entries: newEntries
    });
  };
  inst.exclude = (values, params) => {
    const newEntries = { ...def.entries };
    for (const value of values) {
      if (keys.has(value)) {
        delete newEntries[value];
      } else
        throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodEnum({
      ...def,
      checks: [],
      ...normalizeParams(params),
      entries: newEntries
    });
  };
});
function _enum(values, params) {
  const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
  return new ZodEnum({
    type: "enum",
    entries,
    ...normalizeParams(params)
  });
}
var ZodLiteral = /* @__PURE__ */ $constructor("ZodLiteral", (inst, def) => {
  $ZodLiteral.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => literalProcessor(inst, ctx, json, params);
  inst.values = new Set(def.values);
  Object.defineProperty(inst, "value", {
    get() {
      if (def.values.length > 1) {
        throw new Error("This schema contains multiple valid literal values. Use `.values` instead.");
      }
      return def.values[0];
    }
  });
});
function literal(value, params) {
  return new ZodLiteral({
    type: "literal",
    values: Array.isArray(value) ? value : [value],
    ...normalizeParams(params)
  });
}
var ZodTransform = /* @__PURE__ */ $constructor("ZodTransform", (inst, def) => {
  $ZodTransform.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => transformProcessor(inst, ctx, json, params);
  inst._zod.parse = (payload, _ctx) => {
    if (_ctx.direction === "backward") {
      throw new $ZodEncodeError(inst.constructor.name);
    }
    payload.addIssue = (issue2) => {
      if (typeof issue2 === "string") {
        payload.issues.push(issue(issue2, payload.value, def));
      } else {
        const _issue = issue2;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        _issue.input ?? (_issue.input = payload.value);
        _issue.inst ?? (_issue.inst = inst);
        payload.issues.push(issue(_issue));
      }
    };
    const output = def.transform(payload.value, payload);
    if (output instanceof Promise) {
      return output.then((output) => {
        payload.value = output;
        payload.fallback = true;
        return payload;
      });
    }
    payload.value = output;
    payload.fallback = true;
    return payload;
  };
});
function transform(fn) {
  return new ZodTransform({
    type: "transform",
    transform: fn
  });
}
var ZodOptional = /* @__PURE__ */ $constructor("ZodOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function optional(innerType) {
  return new ZodOptional({
    type: "optional",
    innerType
  });
}
var ZodExactOptional = /* @__PURE__ */ $constructor("ZodExactOptional", (inst, def) => {
  $ZodExactOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function exactOptional(innerType) {
  return new ZodExactOptional({
    type: "optional",
    innerType
  });
}
var ZodNullable = /* @__PURE__ */ $constructor("ZodNullable", (inst, def) => {
  $ZodNullable.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => nullableProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nullable(innerType) {
  return new ZodNullable({
    type: "nullable",
    innerType
  });
}
var ZodDefault = /* @__PURE__ */ $constructor("ZodDefault", (inst, def) => {
  $ZodDefault.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => defaultProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeDefault = inst.unwrap;
});
function _default(innerType, defaultValue) {
  return new ZodDefault({
    type: "default",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
    }
  });
}
var ZodPrefault = /* @__PURE__ */ $constructor("ZodPrefault", (inst, def) => {
  $ZodPrefault.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => prefaultProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function prefault(innerType, defaultValue) {
  return new ZodPrefault({
    type: "prefault",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
    }
  });
}
var ZodNonOptional = /* @__PURE__ */ $constructor("ZodNonOptional", (inst, def) => {
  $ZodNonOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => nonoptionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nonoptional(innerType, params) {
  return new ZodNonOptional({
    type: "nonoptional",
    innerType,
    ...normalizeParams(params)
  });
}
var ZodCatch = /* @__PURE__ */ $constructor("ZodCatch", (inst, def) => {
  $ZodCatch.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => catchProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeCatch = inst.unwrap;
});
function _catch(innerType, catchValue) {
  return new ZodCatch({
    type: "catch",
    innerType,
    catchValue: typeof catchValue === "function" ? catchValue : () => catchValue
  });
}
var ZodPipe = /* @__PURE__ */ $constructor("ZodPipe", (inst, def) => {
  $ZodPipe.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => pipeProcessor(inst, ctx, json, params);
  inst.in = def.in;
  inst.out = def.out;
});
function pipe(in_, out) {
  return new ZodPipe({
    type: "pipe",
    in: in_,
    out
  });
}
var ZodPreprocess = /* @__PURE__ */ $constructor("ZodPreprocess", (inst, def) => {
  ZodPipe.init(inst, def);
  $ZodPreprocess.init(inst, def);
});
var ZodReadonly = /* @__PURE__ */ $constructor("ZodReadonly", (inst, def) => {
  $ZodReadonly.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => readonlyProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function readonly(innerType) {
  return new ZodReadonly({
    type: "readonly",
    innerType
  });
}
var ZodCustom = /* @__PURE__ */ $constructor("ZodCustom", (inst, def) => {
  $ZodCustom.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => customProcessor(inst, ctx, json, params);
});
function refine(fn, _params = {}) {
  return _refine(ZodCustom, fn, _params);
}
function superRefine(fn, params) {
  return _superRefine(fn, params);
}
function preprocess(fn, schema) {
  return new ZodPreprocess({
    type: "pipe",
    in: transform(fn),
    out: schema
  });
}

// packages/omo-config-core/src/schema/reasoning-vocabulary.ts
var REASONING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
var REASONING_AUTO = "auto";
var REASONING_LEVEL_SET = new Set(REASONING_LEVELS);
var REASONING_LEVEL_OR_AUTO_SET = new Set([...REASONING_LEVELS, REASONING_AUTO]);
function isReasoningLevel(value) {
  return REASONING_LEVEL_SET.has(value);
}
function normalizeReasoning(input) {
  const normalized = input.trim().toLowerCase();
  if (!normalized)
    return {};
  if (normalized === "none")
    return { level: "off" };
  if (normalized === REASONING_AUTO)
    return { level: REASONING_AUTO };
  if (isReasoningLevel(normalized))
    return { level: normalized };
  return { passthrough: normalized };
}
function splitReasoningSuffix(model, options) {
  if (typeof model !== "string")
    return { base: "" };
  const trimmed = model.trim();
  if (!trimmed)
    return { base: "" };
  const separatorIndex = trimmed.lastIndexOf(":");
  if (separatorIndex === -1)
    return { base: trimmed };
  const base = trimmed.slice(0, separatorIndex).trim();
  const token = trimmed.slice(separatorIndex + 1).trim().toLowerCase();
  if (!base || !REASONING_LEVEL_OR_AUTO_SET.has(token))
    return { base: trimmed };
  if (token === "max" && !(options?.allowMaxSuffix ?? base.includes("/")))
    return { base: trimmed };
  return { base, level: token };
}

// packages/omo-config-core/src/schema/model-ref.ts
var REASONING_LEVELS_OR_AUTO = [...REASONING_LEVELS, "auto"];
var OmoReasoningSchema = union([
  _enum(REASONING_LEVELS_OR_AUTO),
  string2()
]);
var OmoModelRefObjectSchema = object({
  model: string2(),
  reasoning: OmoReasoningSchema.optional(),
  temperature: number2().min(0).max(2).optional(),
  top_p: number2().min(0).max(1).optional(),
  max_tokens: number2().int().positive().optional(),
  provider_options: record(string2(), unknown()).optional()
}).strict();
var OmoModelRefSchema = union([string2(), OmoModelRefObjectSchema]);

// packages/omo-config-core/src/schema/fallback-models.ts
var OmoThinkingConfigSchema = object({
  type: _enum(["enabled", "disabled"]),
  budgetTokens: number2().optional()
}).strict();
var OmoReasoningEffortSchema = OmoReasoningSchema;
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function canonicalReasoning(value) {
  if (typeof value !== "string")
    return;
  const normalized = normalizeReasoning(value);
  return normalized.level ?? normalized.passthrough;
}
function canonicalModelString(model) {
  const colon = splitReasoningSuffix(model, { allowMaxSuffix: true });
  if (colon.level !== undefined)
    return `${colon.base}:${colon.level}`;
  const trimmed = model.trim();
  const parenthesized = trimmed.match(/^(.*)\(([^()]+)\)\s*$/);
  const spaced = parenthesized === null ? trimmed.match(/^(.*\S)\s+([a-z][a-z0-9_-]*)$/i) : null;
  const base = (parenthesized?.[1] ?? spaced?.[1])?.trim();
  const token = (parenthesized?.[2] ?? spaced?.[2])?.trim();
  if (base === undefined || token === undefined)
    return trimmed;
  const normalized = normalizeReasoning(token);
  return normalized.level === undefined ? trimmed : `${base}:${normalized.level}`;
}
function normalizeLegacyModelFields(entry) {
  const normalized = { ...entry };
  delete normalized["variant"];
  delete normalized["reasoningEffort"];
  delete normalized["thinking"];
  delete normalized["textVerbosity"];
  delete normalized["maxTokens"];
  delete normalized["providerOptions"];
  if (typeof entry["model"] === "string")
    normalized["model"] = canonicalModelString(entry["model"]);
  const explicitReasoning = canonicalReasoning(entry["reasoning"]);
  const variant = canonicalReasoning(entry["variant"]);
  const reasoningEffort = canonicalReasoning(entry["reasoningEffort"]);
  const thinking = isRecord(entry["thinking"]) ? entry["thinking"] : undefined;
  const reasoning = explicitReasoning ?? reasoningEffort ?? variant ?? (thinking?.["type"] === "disabled" ? "off" : undefined);
  if (reasoning !== undefined)
    normalized["reasoning"] = reasoning;
  const providerOptions = isRecord(entry["provider_options"]) ? { ...entry["provider_options"] } : isRecord(entry["providerOptions"]) ? { ...entry["providerOptions"] } : {};
  if (thinking?.["type"] === "enabled")
    providerOptions["thinking"] = { ...thinking };
  if (entry["textVerbosity"] !== undefined)
    providerOptions["textVerbosity"] = entry["textVerbosity"];
  if (Object.keys(providerOptions).length > 0)
    normalized["provider_options"] = providerOptions;
  if (entry["max_tokens"] !== undefined)
    normalized["max_tokens"] = entry["max_tokens"];
  else if (entry["maxTokens"] !== undefined)
    normalized["max_tokens"] = entry["maxTokens"];
  return normalized;
}
var OmoLegacyFallbackModelObjectInputSchema = object({
  model: string2(),
  reasoning: OmoReasoningSchema.optional(),
  temperature: number2().min(0).max(2).optional(),
  top_p: number2().min(0).max(1).optional(),
  max_tokens: number2().int().positive().optional(),
  provider_options: record(string2(), unknown()).optional(),
  variant: string2().optional(),
  reasoningEffort: OmoReasoningEffortSchema.optional(),
  thinking: OmoThinkingConfigSchema.optional(),
  textVerbosity: _enum(["low", "medium", "high"]).optional(),
  maxTokens: number2().optional(),
  providerOptions: record(string2(), unknown()).optional()
}).strict();
var OmoFallbackModelObjectSchema = preprocess((value) => isRecord(value) ? normalizeLegacyModelFields(value) : value, OmoLegacyFallbackModelObjectInputSchema);
var OmoFallbackModelsSchema = union([
  string2(),
  array(string2()),
  array(OmoFallbackModelObjectSchema),
  array(union([string2(), OmoFallbackModelObjectSchema]))
]);

// packages/omo-config-core/src/schema/agent.ts
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var OmoAgentModelEntrySchema = union([string2(), OmoFallbackModelObjectSchema]);
var OmoAgentDefInputSchema = object({
  description: string2().optional(),
  prompt: string2().optional(),
  model: string2().optional(),
  models: array(OmoAgentModelEntrySchema).optional(),
  reasoning: OmoReasoningSchema.optional(),
  variant: string2().optional(),
  reasoningEffort: OmoReasoningEffortSchema.optional(),
  tools: record(string2(), boolean2()).optional(),
  execution_mode: _enum(["in-process", "process"]).optional(),
  background: boolean2().optional(),
  max_depth: number2().int().nonnegative().optional(),
  allowed_subagents: array(string2()).optional(),
  disallowed_tools: array(string2()).optional(),
  max_turns: number2().int().nonnegative().optional(),
  temperature: number2().min(0).max(2).optional(),
  disable: boolean2().optional()
}).strict();
var OmoAgentDefSchema = preprocess((value) => isRecord2(value) ? normalizeLegacyModelFields(value) : value, OmoAgentDefInputSchema);
var OmoAgentsConfigSchema = record(string2(), OmoAgentDefSchema);

// packages/omo-config-core/src/schema/category.ts
function isRecord3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var OmoCategoryConfigObjectSchema = object({
  description: string2().optional(),
  model: string2().optional(),
  models: array(union([string2(), OmoFallbackModelObjectSchema])).optional(),
  reasoning: OmoReasoningSchema.optional(),
  temperature: number2().min(0).max(2).optional(),
  top_p: number2().min(0).max(1).optional(),
  max_tokens: number2().int().positive().optional(),
  provider_options: record(string2(), unknown()).optional(),
  fallback_models: OmoFallbackModelsSchema.optional(),
  variant: string2().optional(),
  maxTokens: number2().optional(),
  thinking: OmoThinkingConfigSchema.optional(),
  reasoningEffort: OmoReasoningEffortSchema.optional(),
  textVerbosity: _enum(["low", "medium", "high"]).optional(),
  tools: record(string2(), boolean2()).optional(),
  prompt_append: string2().optional(),
  max_prompt_tokens: number2().int().positive().optional(),
  is_unstable_agent: boolean2().optional(),
  disable: boolean2().optional(),
  warn_unavailable: boolean2().optional()
}).strict();
var OmoCategoryConfigSchema = preprocess((value) => isRecord3(value) ? normalizeLegacyModelFields(value) : value, OmoCategoryConfigObjectSchema);
var OmoCategoriesConfigSchema = record(string2(), OmoCategoryConfigSchema);

// packages/omo-config-core/src/schema/git-master.ts
var OmoGitMasterSettingsShape = {
  commit_footer: union([boolean2(), string2()]),
  include_co_authored_by: boolean2()
};
var OmoGitMasterSettingsLayerSchema = object(OmoGitMasterSettingsShape).partial().strict();
var OmoGitMasterSettingsSchema = OmoGitMasterSettingsLayerSchema.extend({
  commit_footer: union([boolean2(), string2()]).default(true),
  include_co_authored_by: boolean2().default(true)
}).strict();

// packages/omo-config-core/src/schema/harness.ts
var HARNESS_IDS = ["codex", "opencode", "omo"];
var OMO_CONFIG_HARNESS_IDS = ["opencode", "senpi", "codex"];
var OmoHarnessIdSchema = _enum(OMO_CONFIG_HARNESS_IDS);

// packages/omo-config-core/src/schema/memory.ts
var OmoMemoryReflectionTriggerSchema = object({
  step_count: number2().int().nonnegative().default(25),
  on_compaction: boolean2().default(true)
}).strict();
var OmoMemoryReflectionSchema = object({
  enabled: boolean2().default(true),
  trigger: OmoMemoryReflectionTriggerSchema.default({ step_count: 25, on_compaction: true }),
  merge: _enum(["auto", "integration"]).default("auto"),
  category: string2().min(1).default("quick"),
  timeout_minutes: number2().int().positive().default(15),
  sandbox: _enum(["auto", "required", "off"]).default("auto")
}).strict();
var OmoMemorySyncSchema = object({
  remote: string2().min(1).optional(),
  enabled: boolean2().default(true)
}).strict();
var OmoMemorySearchSchema = object({
  enabled: boolean2().default(true)
}).strict();
var OmoMemoryRecallEventCapsSchema = object({
  tool_args: number2().int().nonnegative().default(400),
  result_head: number2().int().nonnegative().default(600),
  assistant: number2().int().nonnegative().default(1500),
  prompt: number2().int().nonnegative().default(4000)
}).strict();
var OmoMemoryRecallSchema = object({
  enabled: boolean2().default(true),
  max_items: number2().int().min(1).max(5).default(2),
  category: string2().min(1).default("quick"),
  event_caps: OmoMemoryRecallEventCapsSchema.default({ tool_args: 400, result_head: 600, assistant: 1500, prompt: 4000 }),
  sidecar_max_tokens: number2().int().positive().default(48000),
  max_concurrent_wakes: number2().int().positive().default(2),
  tool_budget: number2().int().positive().default(8)
}).strict();
var OmoMemoryNudgeSchema = object({
  enabled: boolean2().default(true),
  every_user_turns: number2().int().min(1).default(10)
}).strict();
var OmoMemoryFactsSchema = object({
  enabled: boolean2().default(true),
  debounce_settles: number2().int().min(1).default(4)
}).strict();
var OmoMemoryDreamSchema = object({
  enabled: boolean2().default(true),
  idle_minutes: number2().int().min(0).default(30),
  min_hours_between: number2().int().min(1).default(24),
  shutdown_launch: boolean2().default(true),
  auto_select_max: number2().int().min(1).max(10).default(5),
  auto_select_max_chars: number2().int().min(1e4).default(150000)
}).strict();
var OmoMemoryPeopleSchema = object({
  enabled: boolean2().default(true),
  max_entries: number2().int().min(1).max(100).default(40),
  max_entry_chars: number2().int().min(50).max(500).default(200)
}).strict();
var OmoMemorySoulSchema = object({
  edit_notice: boolean2().default(true)
}).strict();
var OmoMemoryWriteNoticeSchema = object({
  enabled: boolean2().default(true)
}).strict();
var OmoMemoryReflectionTriggerLayerSchema = object({
  step_count: number2().int().nonnegative().optional(),
  on_compaction: boolean2().optional()
}).strict();
var OmoMemoryReflectionLayerSchema = object({
  enabled: boolean2().optional(),
  trigger: OmoMemoryReflectionTriggerLayerSchema.optional(),
  merge: _enum(["auto", "integration"]).optional(),
  category: string2().min(1).optional(),
  timeout_minutes: number2().int().positive().optional(),
  sandbox: _enum(["auto", "required", "off"]).optional()
}).strict();
var OmoMemorySyncLayerSchema = object({
  remote: string2().min(1).optional(),
  enabled: boolean2().optional()
}).strict();
var OmoMemorySearchLayerSchema = object({
  enabled: boolean2().optional()
}).strict();
var OmoMemoryRecallEventCapsLayerSchema = object({
  tool_args: number2().int().nonnegative().optional(),
  result_head: number2().int().nonnegative().optional(),
  assistant: number2().int().nonnegative().optional(),
  prompt: number2().int().nonnegative().optional()
}).strict();
var OmoMemoryRecallLayerSchema = object({
  enabled: boolean2().optional(),
  max_items: number2().int().min(1).max(5).optional(),
  category: string2().min(1).optional(),
  event_caps: OmoMemoryRecallEventCapsLayerSchema.optional(),
  sidecar_max_tokens: number2().int().positive().optional(),
  max_concurrent_wakes: number2().int().positive().optional(),
  tool_budget: number2().int().positive().optional()
}).strict();
var OmoMemoryNudgeLayerSchema = object({
  enabled: boolean2().optional(),
  every_user_turns: number2().int().min(1).optional()
}).strict();
var OmoMemoryFactsLayerSchema = object({
  enabled: boolean2().optional(),
  debounce_settles: number2().int().min(1).optional()
}).strict();
var OmoMemoryDreamLayerSchema = object({
  enabled: boolean2().optional(),
  idle_minutes: number2().int().min(0).optional(),
  min_hours_between: number2().int().min(1).optional(),
  shutdown_launch: boolean2().optional(),
  auto_select_max: number2().int().min(1).max(10).optional(),
  auto_select_max_chars: number2().int().min(1e4).optional()
}).strict();
var OmoMemoryPeopleLayerSchema = object({
  enabled: boolean2().optional(),
  max_entries: number2().int().min(1).max(100).optional(),
  max_entry_chars: number2().int().min(50).max(500).optional()
}).strict();
var OmoMemorySoulLayerSchema = object({
  edit_notice: boolean2().optional()
}).strict();
var OmoMemoryWriteNoticeLayerSchema = object({
  enabled: boolean2().optional()
}).strict();
var OmoMemoryAgentOverridesSchema = object({
  enabled: boolean2().optional(),
  agent: string2().min(1).optional(),
  reflection: OmoMemoryReflectionLayerSchema.optional(),
  nudge: OmoMemoryNudgeLayerSchema.optional(),
  facts: OmoMemoryFactsLayerSchema.optional(),
  dream: OmoMemoryDreamLayerSchema.optional(),
  people: OmoMemoryPeopleLayerSchema.optional(),
  soul: OmoMemorySoulLayerSchema.optional(),
  write_notice: OmoMemoryWriteNoticeLayerSchema.optional(),
  sync: OmoMemorySyncLayerSchema.optional(),
  search: OmoMemorySearchLayerSchema.optional(),
  recall: OmoMemoryRecallLayerSchema.optional(),
  compile_warn_tokens: number2().int().positive().optional()
}).strict();
var OmoMemorySettingsSchema = object({
  enabled: boolean2().default(true),
  agent: string2().min(1).default("auto"),
  reflection: OmoMemoryReflectionSchema.default({
    enabled: true,
    trigger: { step_count: 25, on_compaction: true },
    merge: "auto",
    category: "quick",
    timeout_minutes: 15,
    sandbox: "auto"
  }),
  nudge: OmoMemoryNudgeSchema.default({ enabled: true, every_user_turns: 10 }),
  facts: OmoMemoryFactsSchema.default({ enabled: true, debounce_settles: 4 }),
  dream: OmoMemoryDreamSchema.default({
    enabled: true,
    idle_minutes: 30,
    min_hours_between: 24,
    shutdown_launch: true,
    auto_select_max: 5,
    auto_select_max_chars: 150000
  }),
  people: OmoMemoryPeopleSchema.default({ enabled: true, max_entries: 40, max_entry_chars: 200 }),
  soul: OmoMemorySoulSchema.default({ edit_notice: true }),
  write_notice: OmoMemoryWriteNoticeSchema.default({ enabled: true }),
  sync: OmoMemorySyncSchema.default({ enabled: true }),
  search: OmoMemorySearchSchema.default({ enabled: true }),
  recall: OmoMemoryRecallSchema.default({
    enabled: true,
    max_items: 2,
    category: "quick",
    event_caps: { tool_args: 400, result_head: 600, assistant: 1500, prompt: 4000 },
    sidecar_max_tokens: 48000,
    max_concurrent_wakes: 2,
    tool_budget: 8
  }),
  compile_warn_tokens: number2().int().positive().default(30000),
  agents: record(string2(), OmoMemoryAgentOverridesSchema).default({})
}).strict();
var OmoMemorySettingsLayerSchema = object({
  enabled: boolean2().optional(),
  agent: string2().min(1).optional(),
  reflection: OmoMemoryReflectionLayerSchema.optional(),
  nudge: OmoMemoryNudgeLayerSchema.optional(),
  facts: OmoMemoryFactsLayerSchema.optional(),
  dream: OmoMemoryDreamLayerSchema.optional(),
  people: OmoMemoryPeopleLayerSchema.optional(),
  soul: OmoMemorySoulLayerSchema.optional(),
  write_notice: OmoMemoryWriteNoticeLayerSchema.optional(),
  sync: OmoMemorySyncLayerSchema.optional(),
  search: OmoMemorySearchLayerSchema.optional(),
  recall: OmoMemoryRecallLayerSchema.optional(),
  compile_warn_tokens: number2().int().positive().optional(),
  agents: record(string2(), OmoMemoryAgentOverridesSchema).optional()
}).strict();

// packages/omo-config-core/src/schema/model-catalog.ts
function isRecord4(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var OmoModelCatalogEntryInputSchema = object({
  model: string2(),
  reasoning: OmoReasoningSchema.optional(),
  variant: string2().optional(),
  reasoningEffort: OmoReasoningEffortSchema.optional()
}).strict();
var OmoModelCatalogEntrySchema = preprocess((value) => isRecord4(value) ? normalizeLegacyModelFields(value) : value, OmoModelCatalogEntryInputSchema);
var OmoModelCatalogSchema = record(string2(), OmoModelCatalogEntrySchema);
var OmoModelCatalogEntryLayerInputSchema = OmoModelCatalogEntryInputSchema.partial();
var OmoModelCatalogEntryLayerSchema = preprocess((value) => isRecord4(value) ? normalizeLegacyModelFields(value) : value, OmoModelCatalogEntryLayerInputSchema);
var OmoModelCatalogLayerSchema = record(string2(), OmoModelCatalogEntryLayerSchema);

// packages/omo-config-core/src/schema/model-profile.ts
function isRecord5(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var OmoModelProfileInputSchema = object({
  display_name: string2().optional(),
  models: array(union([string2(), OmoFallbackModelObjectSchema])).optional()
}).strict();
var OmoModelProfileSchema = preprocess((value) => isRecord5(value) ? normalizeLegacyModelFields(value) : value, OmoModelProfileInputSchema);
var OmoModelProfilesSchema = record(string2(), OmoModelProfileSchema);
var OmoModelProfileLayerInputSchema = OmoModelProfileInputSchema.partial();
var OmoModelProfileLayerSchema = preprocess((value) => isRecord5(value) ? normalizeLegacyModelFields(value) : value, OmoModelProfileLayerInputSchema);
var OmoModelProfilesLayerSchema = record(string2(), OmoModelProfileLayerSchema);

// packages/omo-config-core/src/schema/task.ts
import { availableParallelism } from "node:os";
var DEFAULT_RESIDENCY_MAX_CHILDREN = 16;
var ResidencyMaxChildrenInputSchema = union([number2().int().nonnegative(), literal("unlimited")]);
var OmoTaskWaitSchema = object({
  min_ms: number2().int().positive().default(5000),
  default_ms: number2().int().positive().default(60000),
  max_ms: number2().int().positive().default(600000)
}).strict();
var OmoTaskTeamSettingsSchema = object({
  max_members: number2().int().min(1).max(8).default(8),
  max_parallel_members: number2().int().min(1).max(8).default(4),
  max_wall_clock_minutes: number2().int().positive().default(120)
}).strict();
var OmoTaskWarningsSchema = object({
  unavailable_categories: boolean2().default(true)
}).strict();
var OmoTaskDagSettingsSchema = object({
  max_nodes_per_run: number2().int().positive().default(64),
  max_runs_per_session: number2().int().positive().default(16),
  subscriber_ring: number2().int().positive().default(1000),
  heartbeat_ms: number2().int().positive().default(15000),
  history_default_limit: number2().int().positive().default(256),
  history_max_limit: number2().int().positive().default(1000),
  retention_days: number2().int().positive().default(7),
  max_prompt_bytes: number2().int().positive().default(262144)
}).strict();
var OmoTaskSettingsSchema = object({
  default_execution_mode: _enum(["in-process", "process"]).default("in-process"),
  default_concurrency: number2().int().nonnegative().default(5),
  global_concurrency: number2().int().nonnegative().default(8),
  provider_concurrency: record(string2(), number2().int().nonnegative()).optional(),
  model_concurrency: record(string2(), number2().int().nonnegative()).optional(),
  max_depth: number2().int().nonnegative().default(1),
  residency_max_children: ResidencyMaxChildrenInputSchema.default(8),
  resident_idle_timeout_ms: number2().int().positive().max(Number.MAX_SAFE_INTEGER).default(900000),
  ttl_ms: number2().int().positive().default(86400000),
  state_dir: string2().optional(),
  reattach_on_reconcile: boolean2().optional(),
  resume_children: boolean2().default(true),
  warnings: OmoTaskWarningsSchema.default({ unavailable_categories: true }),
  wait: OmoTaskWaitSchema.default({ min_ms: 5000, default_ms: 60000, max_ms: 600000 }),
  team: OmoTaskTeamSettingsSchema.default({
    max_members: 8,
    max_parallel_members: 4,
    max_wall_clock_minutes: 120
  }),
  dag: OmoTaskDagSettingsSchema.optional()
}).strict();
var OmoTaskDagSettingsLayerSchema = object({
  max_nodes_per_run: number2().int().positive().optional(),
  max_runs_per_session: number2().int().positive().optional(),
  subscriber_ring: number2().int().positive().optional(),
  heartbeat_ms: number2().int().positive().optional(),
  history_default_limit: number2().int().positive().optional(),
  history_max_limit: number2().int().positive().optional(),
  retention_days: number2().int().positive().optional(),
  max_prompt_bytes: number2().int().positive().optional()
}).strict();
var OmoTaskWaitLayerSchema = object({
  min_ms: number2().int().positive().optional(),
  default_ms: number2().int().positive().optional(),
  max_ms: number2().int().positive().optional()
}).strict();
var OmoTaskTeamSettingsLayerSchema = object({
  max_members: number2().int().min(1).max(8).optional(),
  max_parallel_members: number2().int().min(1).max(8).optional(),
  max_wall_clock_minutes: number2().int().positive().optional()
}).strict();
var OmoTaskWarningsLayerSchema = object({
  unavailable_categories: boolean2().optional()
}).strict();
var OmoTaskSettingsLayerSchema = object({
  default_execution_mode: _enum(["in-process", "process"]).optional(),
  default_concurrency: number2().int().nonnegative().optional(),
  global_concurrency: number2().int().nonnegative().optional(),
  provider_concurrency: record(string2(), number2().int().nonnegative()).optional(),
  model_concurrency: record(string2(), number2().int().nonnegative()).optional(),
  max_depth: number2().int().nonnegative().optional(),
  residency_max_children: ResidencyMaxChildrenInputSchema.optional(),
  resident_idle_timeout_ms: number2().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  ttl_ms: number2().int().positive().optional(),
  state_dir: string2().optional(),
  reattach_on_reconcile: boolean2().optional(),
  resume_children: boolean2().optional(),
  warnings: OmoTaskWarningsLayerSchema.optional(),
  wait: OmoTaskWaitLayerSchema.optional(),
  team: OmoTaskTeamSettingsLayerSchema.optional(),
  dag: OmoTaskDagSettingsLayerSchema.optional()
}).strict();
function resolveOmoTaskSettings(input, resolveParallelism = availableParallelism) {
  const record2 = record(string2(), unknown()).parse(input);
  return OmoTaskSettingsSchema.parse({
    ...record2,
    residency_max_children: record2["residency_max_children"] ?? Math.min(DEFAULT_RESIDENCY_MAX_CHILDREN, Math.max(8, resolveParallelism() * 2)),
    global_concurrency: record2["global_concurrency"] ?? Math.max(8, resolveParallelism() * 2)
  });
}

// packages/omo-config-core/src/schema/team.ts
var OmoTeamMemberBaseSchema = object({
  name: string2().min(1).regex(/^[a-z0-9-]+$/),
  cwd: string2().optional(),
  worktreePath: string2().optional(),
  subscriptions: array(string2()).optional(),
  backendType: _enum(["in-process", "tmux"]).default("in-process"),
  color: string2().optional(),
  isActive: boolean2().default(true)
}).strict();
var OmoTeamCategoryMemberSchema = OmoTeamMemberBaseSchema.extend({
  kind: literal("category"),
  category: string2().min(1),
  prompt: string2().min(1)
});
var OmoTeamSubagentMemberSchema = OmoTeamMemberBaseSchema.extend({
  kind: literal("subagent_type"),
  subagent_type: string2().min(1),
  prompt: string2().optional()
});
var OmoTeamMemberSchema = discriminatedUnion("kind", [
  OmoTeamCategoryMemberSchema,
  OmoTeamSubagentMemberSchema
]);
var OmoTeamSpecBaseSchema = object({
  version: literal(1).default(1),
  name: string2().min(1).regex(/^[a-z0-9-]+$/).optional(),
  description: string2().optional(),
  createdAt: number2().int().positive().optional(),
  leadAgentId: string2().optional(),
  teamAllowedPaths: array(string2()).optional(),
  sessionPermission: string2().optional(),
  members: array(OmoTeamMemberSchema).min(1).max(8)
}).strict();
var OmoTeamSpecSchema = OmoTeamSpecBaseSchema.superRefine((teamSpec, ctx) => {
  if (teamSpec.leadAgentId === undefined && teamSpec.members.length > 1) {
    ctx.addIssue({
      code: "custom",
      message: "leadAgentId required when a team has multiple members",
      path: ["leadAgentId"]
    });
  }
});
var OmoTeamSpecLayerSchema = OmoTeamSpecBaseSchema.partial();
var OmoTeamsConfigSchema = record(string2(), OmoTeamSpecSchema);
var OmoTeamsConfigLayerSchema = record(string2(), OmoTeamSpecLayerSchema);

// packages/omo-config-core/src/schema/telemetry.ts
var OmoTelemetrySettingsShape = {
  enabled: boolean2()
};
var OmoTelemetrySettingsLayerSchema = object(OmoTelemetrySettingsShape).partial().strict();
var OmoTelemetrySettingsSchema = OmoTelemetrySettingsLayerSchema.extend({
  enabled: boolean2().default(true)
}).strict();

// packages/omo-config-core/src/schema/format-on-mutation.ts
var mode = _enum(["off", "best-effort", "required"]);
var languages = record(string2(), boolean2()).optional();
var OmoFormatOnMutationLayerSchema = object({
  mode: mode.optional(),
  languages,
  maxFileBytes: number2().int().positive().optional(),
  timeoutMs: number2().int().positive().optional()
}).strict();
var OmoFormatOnMutationSchema = OmoFormatOnMutationLayerSchema.extend({
  mode: mode.default("best-effort"),
  maxFileBytes: number2().int().positive().default(1048576),
  timeoutMs: number2().int().positive().default(3000)
}).strict();

// packages/omo-config-core/src/schema/config.ts
var OmoOpenCodeHarnessConfigSchema = record(string2(), unknown());
var OmoTypedHarnessConfigSchema = object({
  formatOnMutation: OmoFormatOnMutationLayerSchema.optional(),
  categories: OmoCategoriesConfigSchema.optional(),
  agents: OmoAgentsConfigSchema.optional(),
  git_master: OmoGitMasterSettingsLayerSchema.optional(),
  task: OmoTaskSettingsLayerSchema.optional(),
  teams: OmoTeamsConfigLayerSchema.optional(),
  models: OmoModelCatalogLayerSchema.optional(),
  model_profiles: OmoModelProfilesLayerSchema.optional(),
  model_profile: string2().optional(),
  memory: OmoMemorySettingsLayerSchema.optional(),
  telemetry: OmoTelemetrySettingsLayerSchema.optional()
}).strict();
var OmoConfigProfileSchema = object({
  formatOnMutation: OmoFormatOnMutationLayerSchema.optional(),
  categories: OmoCategoriesConfigSchema.optional(),
  agents: OmoAgentsConfigSchema.optional(),
  git_master: OmoGitMasterSettingsLayerSchema.optional(),
  task: OmoTaskSettingsLayerSchema.optional(),
  teams: OmoTeamsConfigLayerSchema.optional(),
  models: OmoModelCatalogLayerSchema.optional(),
  model_profiles: OmoModelProfilesLayerSchema.optional(),
  model_profile: string2().optional(),
  memory: OmoMemorySettingsLayerSchema.optional(),
  telemetry: OmoTelemetrySettingsLayerSchema.optional(),
  "[opencode]": OmoOpenCodeHarnessConfigSchema.optional(),
  "[senpi]": OmoTypedHarnessConfigSchema.optional(),
  "[codex]": OmoTypedHarnessConfigSchema.optional()
}).strict();
var OmoConfigSchema = object({
  formatOnMutation: OmoFormatOnMutationSchema.optional(),
  $schema: string2().optional(),
  categories: OmoCategoriesConfigSchema.optional(),
  agents: OmoAgentsConfigSchema.optional(),
  git_master: OmoGitMasterSettingsSchema.optional(),
  task: OmoTaskSettingsSchema.optional(),
  teams: OmoTeamsConfigSchema.optional(),
  models: OmoModelCatalogSchema.optional(),
  model_profiles: OmoModelProfilesSchema.optional(),
  model_profile: string2().optional(),
  memory: OmoMemorySettingsSchema.optional(),
  telemetry: OmoTelemetrySettingsSchema.optional(),
  "[opencode]": OmoOpenCodeHarnessConfigSchema.optional(),
  "[senpi]": OmoTypedHarnessConfigSchema.optional(),
  "[codex]": OmoTypedHarnessConfigSchema.optional(),
  profiles: record(string2(), OmoConfigProfileSchema).default({}),
  _migrations: array(string2()).optional(),
  legacy_migrations: record(string2(), unknown()).optional()
}).strict();
var OmoConfigLayerSchema = object({
  formatOnMutation: OmoFormatOnMutationLayerSchema.optional(),
  $schema: string2().optional(),
  categories: OmoCategoriesConfigSchema.optional(),
  agents: OmoAgentsConfigSchema.optional(),
  git_master: OmoGitMasterSettingsLayerSchema.optional(),
  task: OmoTaskSettingsLayerSchema.optional(),
  teams: OmoTeamsConfigLayerSchema.optional(),
  models: OmoModelCatalogLayerSchema.optional(),
  model_profiles: OmoModelProfilesLayerSchema.optional(),
  model_profile: string2().optional(),
  memory: OmoMemorySettingsLayerSchema.optional(),
  telemetry: OmoTelemetrySettingsLayerSchema.optional(),
  "[opencode]": OmoOpenCodeHarnessConfigSchema.optional(),
  "[senpi]": OmoTypedHarnessConfigSchema.optional(),
  "[codex]": OmoTypedHarnessConfigSchema.optional(),
  profiles: record(string2(), OmoConfigProfileSchema).optional(),
  _migrations: array(string2()).optional(),
  legacy_migrations: record(string2(), unknown()).optional()
}).strict();

// node_modules/.bun/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/impl/scanner.js
function createScanner(text, ignoreTrivia = false) {
  const len = text.length;
  let pos = 0, value = "", tokenOffset = 0, token = 16, lineNumber = 0, lineStartOffset = 0, tokenLineStartOffset = 0, prevTokenLineStartOffset = 0, scanError = 0;
  function scanHexDigits(count, exact) {
    let digits = 0;
    let value = 0;
    while (digits < count || !exact) {
      let ch = text.charCodeAt(pos);
      if (ch >= 48 && ch <= 57) {
        value = value * 16 + ch - 48;
      } else if (ch >= 65 && ch <= 70) {
        value = value * 16 + ch - 65 + 10;
      } else if (ch >= 97 && ch <= 102) {
        value = value * 16 + ch - 97 + 10;
      } else {
        break;
      }
      pos++;
      digits++;
    }
    if (digits < count) {
      value = -1;
    }
    return value;
  }
  function setPosition(newPosition) {
    pos = newPosition;
    value = "";
    tokenOffset = 0;
    token = 16;
    scanError = 0;
  }
  function scanNumber() {
    let start = pos;
    if (text.charCodeAt(pos) === 48) {
      pos++;
    } else {
      pos++;
      while (pos < text.length && isDigit(text.charCodeAt(pos))) {
        pos++;
      }
    }
    if (pos < text.length && text.charCodeAt(pos) === 46) {
      pos++;
      if (pos < text.length && isDigit(text.charCodeAt(pos))) {
        pos++;
        while (pos < text.length && isDigit(text.charCodeAt(pos))) {
          pos++;
        }
      } else {
        scanError = 3;
        return text.substring(start, pos);
      }
    }
    let end = pos;
    if (pos < text.length && (text.charCodeAt(pos) === 69 || text.charCodeAt(pos) === 101)) {
      pos++;
      if (pos < text.length && text.charCodeAt(pos) === 43 || text.charCodeAt(pos) === 45) {
        pos++;
      }
      if (pos < text.length && isDigit(text.charCodeAt(pos))) {
        pos++;
        while (pos < text.length && isDigit(text.charCodeAt(pos))) {
          pos++;
        }
        end = pos;
      } else {
        scanError = 3;
      }
    }
    return text.substring(start, end);
  }
  function scanString() {
    let result = "", start = pos;
    while (true) {
      if (pos >= len) {
        result += text.substring(start, pos);
        scanError = 2;
        break;
      }
      const ch = text.charCodeAt(pos);
      if (ch === 34) {
        result += text.substring(start, pos);
        pos++;
        break;
      }
      if (ch === 92) {
        result += text.substring(start, pos);
        pos++;
        if (pos >= len) {
          scanError = 2;
          break;
        }
        const ch2 = text.charCodeAt(pos++);
        switch (ch2) {
          case 34:
            result += '"';
            break;
          case 92:
            result += "\\";
            break;
          case 47:
            result += "/";
            break;
          case 98:
            result += "\b";
            break;
          case 102:
            result += "\f";
            break;
          case 110:
            result += `
`;
            break;
          case 114:
            result += "\r";
            break;
          case 116:
            result += "\t";
            break;
          case 117:
            const ch3 = scanHexDigits(4, true);
            if (ch3 >= 0) {
              result += String.fromCharCode(ch3);
            } else {
              scanError = 4;
            }
            break;
          default:
            scanError = 5;
        }
        start = pos;
        continue;
      }
      if (ch >= 0 && ch <= 31) {
        if (isLineBreak(ch)) {
          result += text.substring(start, pos);
          scanError = 2;
          break;
        } else {
          scanError = 6;
        }
      }
      pos++;
    }
    return result;
  }
  function scanNext() {
    value = "";
    scanError = 0;
    tokenOffset = pos;
    lineStartOffset = lineNumber;
    prevTokenLineStartOffset = tokenLineStartOffset;
    if (pos >= len) {
      tokenOffset = len;
      return token = 17;
    }
    let code = text.charCodeAt(pos);
    if (isWhiteSpace(code)) {
      do {
        pos++;
        value += String.fromCharCode(code);
        code = text.charCodeAt(pos);
      } while (isWhiteSpace(code));
      return token = 15;
    }
    if (isLineBreak(code)) {
      pos++;
      value += String.fromCharCode(code);
      if (code === 13 && text.charCodeAt(pos) === 10) {
        pos++;
        value += `
`;
      }
      lineNumber++;
      tokenLineStartOffset = pos;
      return token = 14;
    }
    switch (code) {
      case 123:
        pos++;
        return token = 1;
      case 125:
        pos++;
        return token = 2;
      case 91:
        pos++;
        return token = 3;
      case 93:
        pos++;
        return token = 4;
      case 58:
        pos++;
        return token = 6;
      case 44:
        pos++;
        return token = 5;
      case 34:
        pos++;
        value = scanString();
        return token = 10;
      case 47:
        const start = pos - 1;
        if (text.charCodeAt(pos + 1) === 47) {
          pos += 2;
          while (pos < len) {
            if (isLineBreak(text.charCodeAt(pos))) {
              break;
            }
            pos++;
          }
          value = text.substring(start, pos);
          return token = 12;
        }
        if (text.charCodeAt(pos + 1) === 42) {
          pos += 2;
          const safeLength = len - 1;
          let commentClosed = false;
          while (pos < safeLength) {
            const ch = text.charCodeAt(pos);
            if (ch === 42 && text.charCodeAt(pos + 1) === 47) {
              pos += 2;
              commentClosed = true;
              break;
            }
            pos++;
            if (isLineBreak(ch)) {
              if (ch === 13 && text.charCodeAt(pos) === 10) {
                pos++;
              }
              lineNumber++;
              tokenLineStartOffset = pos;
            }
          }
          if (!commentClosed) {
            pos++;
            scanError = 1;
          }
          value = text.substring(start, pos);
          return token = 13;
        }
        value += String.fromCharCode(code);
        pos++;
        return token = 16;
      case 45:
        value += String.fromCharCode(code);
        pos++;
        if (pos === len || !isDigit(text.charCodeAt(pos))) {
          return token = 16;
        }
      case 48:
      case 49:
      case 50:
      case 51:
      case 52:
      case 53:
      case 54:
      case 55:
      case 56:
      case 57:
        value += scanNumber();
        return token = 11;
      default:
        while (pos < len && isUnknownContentCharacter(code)) {
          pos++;
          code = text.charCodeAt(pos);
        }
        if (tokenOffset !== pos) {
          value = text.substring(tokenOffset, pos);
          switch (value) {
            case "true":
              return token = 8;
            case "false":
              return token = 9;
            case "null":
              return token = 7;
          }
          return token = 16;
        }
        value += String.fromCharCode(code);
        pos++;
        return token = 16;
    }
  }
  function isUnknownContentCharacter(code) {
    if (isWhiteSpace(code) || isLineBreak(code)) {
      return false;
    }
    switch (code) {
      case 125:
      case 93:
      case 123:
      case 91:
      case 34:
      case 58:
      case 44:
      case 47:
        return false;
    }
    return true;
  }
  function scanNextNonTrivia() {
    let result;
    do {
      result = scanNext();
    } while (result >= 12 && result <= 15);
    return result;
  }
  return {
    setPosition,
    getPosition: () => pos,
    scan: ignoreTrivia ? scanNextNonTrivia : scanNext,
    getToken: () => token,
    getTokenValue: () => value,
    getTokenOffset: () => tokenOffset,
    getTokenLength: () => pos - tokenOffset,
    getTokenStartLine: () => lineStartOffset,
    getTokenStartCharacter: () => tokenOffset - prevTokenLineStartOffset,
    getTokenError: () => scanError
  };
}
function isWhiteSpace(ch) {
  return ch === 32 || ch === 9;
}
function isLineBreak(ch) {
  return ch === 10 || ch === 13;
}
function isDigit(ch) {
  return ch >= 48 && ch <= 57;
}
var CharacterCodes;
(function(CharacterCodes) {
  CharacterCodes[CharacterCodes["lineFeed"] = 10] = "lineFeed";
  CharacterCodes[CharacterCodes["carriageReturn"] = 13] = "carriageReturn";
  CharacterCodes[CharacterCodes["space"] = 32] = "space";
  CharacterCodes[CharacterCodes["_0"] = 48] = "_0";
  CharacterCodes[CharacterCodes["_1"] = 49] = "_1";
  CharacterCodes[CharacterCodes["_2"] = 50] = "_2";
  CharacterCodes[CharacterCodes["_3"] = 51] = "_3";
  CharacterCodes[CharacterCodes["_4"] = 52] = "_4";
  CharacterCodes[CharacterCodes["_5"] = 53] = "_5";
  CharacterCodes[CharacterCodes["_6"] = 54] = "_6";
  CharacterCodes[CharacterCodes["_7"] = 55] = "_7";
  CharacterCodes[CharacterCodes["_8"] = 56] = "_8";
  CharacterCodes[CharacterCodes["_9"] = 57] = "_9";
  CharacterCodes[CharacterCodes["a"] = 97] = "a";
  CharacterCodes[CharacterCodes["b"] = 98] = "b";
  CharacterCodes[CharacterCodes["c"] = 99] = "c";
  CharacterCodes[CharacterCodes["d"] = 100] = "d";
  CharacterCodes[CharacterCodes["e"] = 101] = "e";
  CharacterCodes[CharacterCodes["f"] = 102] = "f";
  CharacterCodes[CharacterCodes["g"] = 103] = "g";
  CharacterCodes[CharacterCodes["h"] = 104] = "h";
  CharacterCodes[CharacterCodes["i"] = 105] = "i";
  CharacterCodes[CharacterCodes["j"] = 106] = "j";
  CharacterCodes[CharacterCodes["k"] = 107] = "k";
  CharacterCodes[CharacterCodes["l"] = 108] = "l";
  CharacterCodes[CharacterCodes["m"] = 109] = "m";
  CharacterCodes[CharacterCodes["n"] = 110] = "n";
  CharacterCodes[CharacterCodes["o"] = 111] = "o";
  CharacterCodes[CharacterCodes["p"] = 112] = "p";
  CharacterCodes[CharacterCodes["q"] = 113] = "q";
  CharacterCodes[CharacterCodes["r"] = 114] = "r";
  CharacterCodes[CharacterCodes["s"] = 115] = "s";
  CharacterCodes[CharacterCodes["t"] = 116] = "t";
  CharacterCodes[CharacterCodes["u"] = 117] = "u";
  CharacterCodes[CharacterCodes["v"] = 118] = "v";
  CharacterCodes[CharacterCodes["w"] = 119] = "w";
  CharacterCodes[CharacterCodes["x"] = 120] = "x";
  CharacterCodes[CharacterCodes["y"] = 121] = "y";
  CharacterCodes[CharacterCodes["z"] = 122] = "z";
  CharacterCodes[CharacterCodes["A"] = 65] = "A";
  CharacterCodes[CharacterCodes["B"] = 66] = "B";
  CharacterCodes[CharacterCodes["C"] = 67] = "C";
  CharacterCodes[CharacterCodes["D"] = 68] = "D";
  CharacterCodes[CharacterCodes["E"] = 69] = "E";
  CharacterCodes[CharacterCodes["F"] = 70] = "F";
  CharacterCodes[CharacterCodes["G"] = 71] = "G";
  CharacterCodes[CharacterCodes["H"] = 72] = "H";
  CharacterCodes[CharacterCodes["I"] = 73] = "I";
  CharacterCodes[CharacterCodes["J"] = 74] = "J";
  CharacterCodes[CharacterCodes["K"] = 75] = "K";
  CharacterCodes[CharacterCodes["L"] = 76] = "L";
  CharacterCodes[CharacterCodes["M"] = 77] = "M";
  CharacterCodes[CharacterCodes["N"] = 78] = "N";
  CharacterCodes[CharacterCodes["O"] = 79] = "O";
  CharacterCodes[CharacterCodes["P"] = 80] = "P";
  CharacterCodes[CharacterCodes["Q"] = 81] = "Q";
  CharacterCodes[CharacterCodes["R"] = 82] = "R";
  CharacterCodes[CharacterCodes["S"] = 83] = "S";
  CharacterCodes[CharacterCodes["T"] = 84] = "T";
  CharacterCodes[CharacterCodes["U"] = 85] = "U";
  CharacterCodes[CharacterCodes["V"] = 86] = "V";
  CharacterCodes[CharacterCodes["W"] = 87] = "W";
  CharacterCodes[CharacterCodes["X"] = 88] = "X";
  CharacterCodes[CharacterCodes["Y"] = 89] = "Y";
  CharacterCodes[CharacterCodes["Z"] = 90] = "Z";
  CharacterCodes[CharacterCodes["asterisk"] = 42] = "asterisk";
  CharacterCodes[CharacterCodes["backslash"] = 92] = "backslash";
  CharacterCodes[CharacterCodes["closeBrace"] = 125] = "closeBrace";
  CharacterCodes[CharacterCodes["closeBracket"] = 93] = "closeBracket";
  CharacterCodes[CharacterCodes["colon"] = 58] = "colon";
  CharacterCodes[CharacterCodes["comma"] = 44] = "comma";
  CharacterCodes[CharacterCodes["dot"] = 46] = "dot";
  CharacterCodes[CharacterCodes["doubleQuote"] = 34] = "doubleQuote";
  CharacterCodes[CharacterCodes["minus"] = 45] = "minus";
  CharacterCodes[CharacterCodes["openBrace"] = 123] = "openBrace";
  CharacterCodes[CharacterCodes["openBracket"] = 91] = "openBracket";
  CharacterCodes[CharacterCodes["plus"] = 43] = "plus";
  CharacterCodes[CharacterCodes["slash"] = 47] = "slash";
  CharacterCodes[CharacterCodes["formFeed"] = 12] = "formFeed";
  CharacterCodes[CharacterCodes["tab"] = 9] = "tab";
})(CharacterCodes || (CharacterCodes = {}));

// node_modules/.bun/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/impl/string-intern.js
var cachedSpaces = new Array(20).fill(0).map((_, index) => {
  return " ".repeat(index);
});
var maxCachedValues = 200;
var cachedBreakLinesWithSpaces = {
  " ": {
    "\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return `
` + " ".repeat(index);
    }),
    "\r": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\r" + " ".repeat(index);
    }),
    "\r\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return `\r
` + " ".repeat(index);
    })
  },
  "\t": {
    "\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return `
` + "\t".repeat(index);
    }),
    "\r": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\r" + "\t".repeat(index);
    }),
    "\r\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return `\r
` + "\t".repeat(index);
    })
  }
};

// node_modules/.bun/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/impl/parser.js
var ParseOptions;
(function(ParseOptions) {
  ParseOptions.DEFAULT = {
    allowTrailingComma: false
  };
})(ParseOptions || (ParseOptions = {}));
function parse4(text, errors = [], options = ParseOptions.DEFAULT) {
  let currentProperty = null;
  let currentParent = [];
  const previousParents = [];
  function onValue(value) {
    if (Array.isArray(currentParent)) {
      currentParent.push(value);
    } else if (currentProperty !== null) {
      currentParent[currentProperty] = value;
    }
  }
  const visitor = {
    onObjectBegin: () => {
      const object = {};
      onValue(object);
      previousParents.push(currentParent);
      currentParent = object;
      currentProperty = null;
    },
    onObjectProperty: (name) => {
      currentProperty = name;
    },
    onObjectEnd: () => {
      currentParent = previousParents.pop();
    },
    onArrayBegin: () => {
      const array = [];
      onValue(array);
      previousParents.push(currentParent);
      currentParent = array;
      currentProperty = null;
    },
    onArrayEnd: () => {
      currentParent = previousParents.pop();
    },
    onLiteralValue: onValue,
    onError: (error, offset, length) => {
      errors.push({ error, offset, length });
    }
  };
  visit(text, visitor, options);
  return currentParent[0];
}
function visit(text, visitor, options = ParseOptions.DEFAULT) {
  const _scanner = createScanner(text, false);
  const _jsonPath = [];
  let suppressedCallbacks = 0;
  function toNoArgVisit(visitFunction) {
    return visitFunction ? () => suppressedCallbacks === 0 && visitFunction(_scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter()) : () => true;
  }
  function toOneArgVisit(visitFunction) {
    return visitFunction ? (arg) => suppressedCallbacks === 0 && visitFunction(arg, _scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter()) : () => true;
  }
  function toOneArgVisitWithPath(visitFunction) {
    return visitFunction ? (arg) => suppressedCallbacks === 0 && visitFunction(arg, _scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter(), () => _jsonPath.slice()) : () => true;
  }
  function toBeginVisit(visitFunction) {
    return visitFunction ? () => {
      if (suppressedCallbacks > 0) {
        suppressedCallbacks++;
      } else {
        let cbReturn = visitFunction(_scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter(), () => _jsonPath.slice());
        if (cbReturn === false) {
          suppressedCallbacks = 1;
        }
      }
    } : () => true;
  }
  function toEndVisit(visitFunction) {
    return visitFunction ? () => {
      if (suppressedCallbacks > 0) {
        suppressedCallbacks--;
      }
      if (suppressedCallbacks === 0) {
        visitFunction(_scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter());
      }
    } : () => true;
  }
  const onObjectBegin = toBeginVisit(visitor.onObjectBegin), onObjectProperty = toOneArgVisitWithPath(visitor.onObjectProperty), onObjectEnd = toEndVisit(visitor.onObjectEnd), onArrayBegin = toBeginVisit(visitor.onArrayBegin), onArrayEnd = toEndVisit(visitor.onArrayEnd), onLiteralValue = toOneArgVisitWithPath(visitor.onLiteralValue), onSeparator = toOneArgVisit(visitor.onSeparator), onComment = toNoArgVisit(visitor.onComment), onError = toOneArgVisit(visitor.onError);
  const disallowComments = options && options.disallowComments;
  const allowTrailingComma = options && options.allowTrailingComma;
  function scanNext() {
    while (true) {
      const token = _scanner.scan();
      switch (_scanner.getTokenError()) {
        case 4:
          handleError(14);
          break;
        case 5:
          handleError(15);
          break;
        case 3:
          handleError(13);
          break;
        case 1:
          if (!disallowComments) {
            handleError(11);
          }
          break;
        case 2:
          handleError(12);
          break;
        case 6:
          handleError(16);
          break;
      }
      switch (token) {
        case 12:
        case 13:
          if (disallowComments) {
            handleError(10);
          } else {
            onComment();
          }
          break;
        case 16:
          handleError(1);
          break;
        case 15:
        case 14:
          break;
        default:
          return token;
      }
    }
  }
  function handleError(error, skipUntilAfter = [], skipUntil = []) {
    onError(error);
    if (skipUntilAfter.length + skipUntil.length > 0) {
      let token = _scanner.getToken();
      while (token !== 17) {
        if (skipUntilAfter.indexOf(token) !== -1) {
          scanNext();
          break;
        } else if (skipUntil.indexOf(token) !== -1) {
          break;
        }
        token = scanNext();
      }
    }
  }
  function parseString(isValue) {
    const value = _scanner.getTokenValue();
    if (isValue) {
      onLiteralValue(value);
    } else {
      onObjectProperty(value);
      _jsonPath.push(value);
    }
    scanNext();
    return true;
  }
  function parseLiteral() {
    switch (_scanner.getToken()) {
      case 11:
        const tokenValue = _scanner.getTokenValue();
        let value = Number(tokenValue);
        if (isNaN(value)) {
          handleError(2);
          value = 0;
        }
        onLiteralValue(value);
        break;
      case 7:
        onLiteralValue(null);
        break;
      case 8:
        onLiteralValue(true);
        break;
      case 9:
        onLiteralValue(false);
        break;
      default:
        return false;
    }
    scanNext();
    return true;
  }
  function parseProperty() {
    if (_scanner.getToken() !== 10) {
      handleError(3, [], [2, 5]);
      return false;
    }
    parseString(false);
    if (_scanner.getToken() === 6) {
      onSeparator(":");
      scanNext();
      if (!parseValue()) {
        handleError(4, [], [2, 5]);
      }
    } else {
      handleError(5, [], [2, 5]);
    }
    _jsonPath.pop();
    return true;
  }
  function parseObject() {
    onObjectBegin();
    scanNext();
    let needsComma = false;
    while (_scanner.getToken() !== 2 && _scanner.getToken() !== 17) {
      if (_scanner.getToken() === 5) {
        if (!needsComma) {
          handleError(4, [], []);
        }
        onSeparator(",");
        scanNext();
        if (_scanner.getToken() === 2 && allowTrailingComma) {
          break;
        }
      } else if (needsComma) {
        handleError(6, [], []);
      }
      if (!parseProperty()) {
        handleError(4, [], [2, 5]);
      }
      needsComma = true;
    }
    onObjectEnd();
    if (_scanner.getToken() !== 2) {
      handleError(7, [2], []);
    } else {
      scanNext();
    }
    return true;
  }
  function parseArray() {
    onArrayBegin();
    scanNext();
    let isFirstElement = true;
    let needsComma = false;
    while (_scanner.getToken() !== 4 && _scanner.getToken() !== 17) {
      if (_scanner.getToken() === 5) {
        if (!needsComma) {
          handleError(4, [], []);
        }
        onSeparator(",");
        scanNext();
        if (_scanner.getToken() === 4 && allowTrailingComma) {
          break;
        }
      } else if (needsComma) {
        handleError(6, [], []);
      }
      if (isFirstElement) {
        _jsonPath.push(0);
        isFirstElement = false;
      } else {
        _jsonPath[_jsonPath.length - 1]++;
      }
      if (!parseValue()) {
        handleError(4, [], [4, 5]);
      }
      needsComma = true;
    }
    onArrayEnd();
    if (!isFirstElement) {
      _jsonPath.pop();
    }
    if (_scanner.getToken() !== 4) {
      handleError(8, [4], []);
    } else {
      scanNext();
    }
    return true;
  }
  function parseValue() {
    switch (_scanner.getToken()) {
      case 3:
        return parseArray();
      case 1:
        return parseObject();
      case 10:
        return parseString(true);
      default:
        return parseLiteral();
    }
  }
  scanNext();
  if (_scanner.getToken() === 17) {
    if (options.allowEmptyContent) {
      return true;
    }
    handleError(4, [], []);
    return false;
  }
  if (!parseValue()) {
    handleError(4, [], []);
    return false;
  }
  if (_scanner.getToken() !== 17) {
    handleError(9, [], []);
  }
  return true;
}

// node_modules/.bun/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/main.js
var ScanError;
(function(ScanError) {
  ScanError[ScanError["None"] = 0] = "None";
  ScanError[ScanError["UnexpectedEndOfComment"] = 1] = "UnexpectedEndOfComment";
  ScanError[ScanError["UnexpectedEndOfString"] = 2] = "UnexpectedEndOfString";
  ScanError[ScanError["UnexpectedEndOfNumber"] = 3] = "UnexpectedEndOfNumber";
  ScanError[ScanError["InvalidUnicode"] = 4] = "InvalidUnicode";
  ScanError[ScanError["InvalidEscapeCharacter"] = 5] = "InvalidEscapeCharacter";
  ScanError[ScanError["InvalidCharacter"] = 6] = "InvalidCharacter";
})(ScanError || (ScanError = {}));
var SyntaxKind;
(function(SyntaxKind) {
  SyntaxKind[SyntaxKind["OpenBraceToken"] = 1] = "OpenBraceToken";
  SyntaxKind[SyntaxKind["CloseBraceToken"] = 2] = "CloseBraceToken";
  SyntaxKind[SyntaxKind["OpenBracketToken"] = 3] = "OpenBracketToken";
  SyntaxKind[SyntaxKind["CloseBracketToken"] = 4] = "CloseBracketToken";
  SyntaxKind[SyntaxKind["CommaToken"] = 5] = "CommaToken";
  SyntaxKind[SyntaxKind["ColonToken"] = 6] = "ColonToken";
  SyntaxKind[SyntaxKind["NullKeyword"] = 7] = "NullKeyword";
  SyntaxKind[SyntaxKind["TrueKeyword"] = 8] = "TrueKeyword";
  SyntaxKind[SyntaxKind["FalseKeyword"] = 9] = "FalseKeyword";
  SyntaxKind[SyntaxKind["StringLiteral"] = 10] = "StringLiteral";
  SyntaxKind[SyntaxKind["NumericLiteral"] = 11] = "NumericLiteral";
  SyntaxKind[SyntaxKind["LineCommentTrivia"] = 12] = "LineCommentTrivia";
  SyntaxKind[SyntaxKind["BlockCommentTrivia"] = 13] = "BlockCommentTrivia";
  SyntaxKind[SyntaxKind["LineBreakTrivia"] = 14] = "LineBreakTrivia";
  SyntaxKind[SyntaxKind["Trivia"] = 15] = "Trivia";
  SyntaxKind[SyntaxKind["Unknown"] = 16] = "Unknown";
  SyntaxKind[SyntaxKind["EOF"] = 17] = "EOF";
})(SyntaxKind || (SyntaxKind = {}));
var parse5 = parse4;
var ParseErrorCode;
(function(ParseErrorCode) {
  ParseErrorCode[ParseErrorCode["InvalidSymbol"] = 1] = "InvalidSymbol";
  ParseErrorCode[ParseErrorCode["InvalidNumberFormat"] = 2] = "InvalidNumberFormat";
  ParseErrorCode[ParseErrorCode["PropertyNameExpected"] = 3] = "PropertyNameExpected";
  ParseErrorCode[ParseErrorCode["ValueExpected"] = 4] = "ValueExpected";
  ParseErrorCode[ParseErrorCode["ColonExpected"] = 5] = "ColonExpected";
  ParseErrorCode[ParseErrorCode["CommaExpected"] = 6] = "CommaExpected";
  ParseErrorCode[ParseErrorCode["CloseBraceExpected"] = 7] = "CloseBraceExpected";
  ParseErrorCode[ParseErrorCode["CloseBracketExpected"] = 8] = "CloseBracketExpected";
  ParseErrorCode[ParseErrorCode["EndOfFileExpected"] = 9] = "EndOfFileExpected";
  ParseErrorCode[ParseErrorCode["InvalidCommentToken"] = 10] = "InvalidCommentToken";
  ParseErrorCode[ParseErrorCode["UnexpectedEndOfComment"] = 11] = "UnexpectedEndOfComment";
  ParseErrorCode[ParseErrorCode["UnexpectedEndOfString"] = 12] = "UnexpectedEndOfString";
  ParseErrorCode[ParseErrorCode["UnexpectedEndOfNumber"] = 13] = "UnexpectedEndOfNumber";
  ParseErrorCode[ParseErrorCode["InvalidUnicode"] = 14] = "InvalidUnicode";
  ParseErrorCode[ParseErrorCode["InvalidEscapeCharacter"] = 15] = "InvalidEscapeCharacter";
  ParseErrorCode[ParseErrorCode["InvalidCharacter"] = 16] = "InvalidCharacter";
})(ParseErrorCode || (ParseErrorCode = {}));
function printParseErrorCode(code) {
  switch (code) {
    case 1:
      return "InvalidSymbol";
    case 2:
      return "InvalidNumberFormat";
    case 3:
      return "PropertyNameExpected";
    case 4:
      return "ValueExpected";
    case 5:
      return "ColonExpected";
    case 6:
      return "CommaExpected";
    case 7:
      return "CloseBraceExpected";
    case 8:
      return "CloseBracketExpected";
    case 9:
      return "EndOfFileExpected";
    case 10:
      return "InvalidCommentToken";
    case 11:
      return "UnexpectedEndOfComment";
    case 12:
      return "UnexpectedEndOfString";
    case 13:
      return "UnexpectedEndOfNumber";
    case 14:
      return "InvalidUnicode";
    case 15:
      return "InvalidEscapeCharacter";
    case 16:
      return "InvalidCharacter";
  }
  return "<unknown ParseErrorCode>";
}

// packages/omo-config-core/src/loader/merge.ts
var DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
function isUnsafeObjectKey(key) {
  return DANGEROUS_KEYS.has(key);
}
function isPlainObject2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.prototype.toString.call(value) === "[object Object]";
}
function sanitizeOmoConfigValue(value) {
  if (Array.isArray(value))
    return value.map((entry) => sanitizeOmoConfigValue(entry));
  if (!isPlainObject2(value))
    return value;
  const sanitized = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isUnsafeObjectKey(key))
      continue;
    sanitized[key] = sanitizeOmoConfigValue(entry);
  }
  return sanitized;
}
function mergeOmoConfigRecords(base, override) {
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (isUnsafeObjectKey(key))
      continue;
    const safeValue = sanitizeOmoConfigValue(value);
    const baseValue = result[key];
    result[key] = isPlainObject2(baseValue) && isPlainObject2(safeValue) ? mergeOmoConfigRecords(baseValue, safeValue) : safeValue;
  }
  return result;
}

// packages/omo-config-core/src/loader/paths.ts
import { userInfo } from "node:os";
import { dirname, join, posix, resolve } from "node:path";

// packages/omo-config-core/src/internal/posix-path.ts
function toPosixPath(path) {
  return path.split("\\").join("/");
}

// packages/omo-config-core/src/loader/types.ts
import { existsSync as existsSync2, lstatSync, readFileSync, realpathSync } from "node:fs";
var DEFAULT_READ_FILE_SYSTEM = {
  existsSync: existsSync2,
  lstatSync,
  readFileSync,
  realpathSync
};

// packages/omo-config-core/src/loader/paths.ts
var MAX_PROJECT_CONFIG_DIRECTORY_DEPTH = 256;
var ACCOUNT_HOME_DIR = userInfo().homedir;
function resolveHomeDir(env = process.env) {
  const homeDir = env.HOME ?? env.USERPROFILE ?? process.cwd();
  return homeDir.startsWith("/") ? posix.resolve(homeDir) : toPosixPath(resolve(homeDir));
}
function resolveUserOmoConfigDirectory(env = process.env) {
  return join(resolveHomeDir(env), ".omo");
}
function detectUserOmoJsonPath(env, fileSystem) {
  const configDir = resolveUserOmoConfigDirectory(env);
  const jsoncPath = join(configDir, "omo.jsonc");
  if (fileSystem.existsSync(jsoncPath))
    return jsoncPath;
  const jsonPath = join(configDir, "omo.json");
  return fileSystem.existsSync(jsonPath) ? jsonPath : jsoncPath;
}
function isSymlinkedProjectPath(path, fileSystem) {
  if (fileSystem.lstatSync === undefined || !fileSystem.existsSync(path))
    return false;
  try {
    return fileSystem.lstatSync(path).isSymbolicLink();
  } catch (error) {
    if (error instanceof Error)
      return true;
    throw error;
  }
}
function isLoadableProjectConfigFile(path, fileSystem) {
  return fileSystem.existsSync(path) && !isSymlinkedProjectPath(path, fileSystem);
}
function detectOmoJsonPath(dir, fileSystem) {
  const omoDir = join(dir, ".omo");
  if (isSymlinkedProjectPath(omoDir, fileSystem))
    return null;
  const jsoncPath = join(omoDir, "omo.jsonc");
  if (isLoadableProjectConfigFile(jsoncPath, fileSystem))
    return jsoncPath;
  const jsonPath = join(omoDir, "omo.json");
  return isLoadableProjectConfigFile(jsonPath, fileSystem) ? jsonPath : null;
}
function realpathOrSelf(path, fileSystem) {
  if (fileSystem.realpathSync === undefined)
    return path;
  try {
    return fileSystem.realpathSync(path);
  } catch {
    return path;
  }
}
function findProjectConfigPathsFarthestFirst(cwd, homeDir, fileSystem, accountHomeDir = homeDir) {
  const startDir = resolve(cwd);
  const boundaryDirs = [...new Set([resolve(homeDir), resolve(accountHomeDir)])];
  const realBoundaryDirs = new Set(boundaryDirs.map((path) => realpathOrSelf(path, fileSystem)));
  const nearestFirst = [];
  let currentDir = startDir;
  for (let depth = 0;depth < MAX_PROJECT_CONFIG_DIRECTORY_DEPTH; depth += 1) {
    const isHomeDir = boundaryDirs.includes(currentDir) || realBoundaryDirs.has(realpathOrSelf(currentDir, fileSystem));
    const configPath = isHomeDir ? null : detectOmoJsonPath(currentDir, fileSystem);
    if (configPath !== null)
      nearestFirst.push(configPath);
    if (isHomeDir)
      break;
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir)
      break;
    currentDir = parentDir;
  }
  return nearestFirst.reverse();
}
function resolveOmoConfigPaths(options) {
  const fileSystem = options.fileSystem ?? DEFAULT_READ_FILE_SYSTEM;
  const env = options.env ?? process.env;
  const userPath = detectUserOmoJsonPath(env, fileSystem);
  const projectPaths = findProjectConfigPathsFarthestFirst(options.cwd, resolveHomeDir(env), fileSystem, ACCOUNT_HOME_DIR);
  return [
    { path: userPath, scope: "user" },
    ...projectPaths.map((path) => ({ path, scope: "project" }))
  ];
}

// packages/omo-config-core/src/loader/resolution.ts
var HARNESS_KEYS = [...new Set([...HARNESS_IDS, ...OMO_CONFIG_HARNESS_IDS])].map((harness) => `[${harness}]`);
function profileName(value) {
  return value === "" ? undefined : value;
}
function profileNameFromOpenCodeConfigDir(path) {
  const match = path?.match(/(?:^|[\\/])profiles[\\/]([^\\/]+)[\\/]*$/);
  return profileName(match?.[1]);
}
function resolveOmoProfileName(options = {}) {
  const env = options.env ?? process.env;
  return profileName(options.profile) ?? profileName(env["OMO_PROFILE"]) ?? profileName(env["OCX_PROFILE"]) ?? profileNameFromOpenCodeConfigDir(env["OPENCODE_CONFIG_DIR"]);
}
function toRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return;
  return Object.fromEntries(Object.entries(value));
}
function withoutControlKeys(config) {
  const result = {};
  for (const [key, value] of Object.entries(config)) {
    if (key === "profiles" || HARNESS_KEYS.includes(key))
      continue;
    result[key] = value;
  }
  return result;
}
function harnessLayer(config, harness) {
  if (harness === undefined)
    return {};
  return toRecord(config[`[${harness}]`]) ?? {};
}
function resolveOmoConfigView(options) {
  const profiles = toRecord(options.config["profiles"]);
  const profile = options.profile === undefined ? undefined : toRecord(profiles?.[options.profile]);
  const diagnostics = profile === undefined && options.profile !== undefined ? [{
    kind: "profile",
    message: `Activated omo profile "${options.profile}" does not exist; using the base configuration`,
    path: `profiles.${options.profile}`
  }] : [];
  const layers = [
    withoutControlKeys(options.config),
    harnessLayer(options.config, options.harness),
    profile === undefined ? {} : withoutControlKeys(profile),
    profile === undefined ? {} : harnessLayer(profile, options.harness)
  ];
  let config = {};
  for (const layer of layers)
    config = mergeOmoConfigRecords(config, layer);
  const resolvedProfile = options.profile !== undefined && profile !== undefined ? options.profile : undefined;
  return {
    config: withoutControlKeys(config),
    diagnostics,
    ...resolvedProfile === undefined ? {} : { profile: resolvedProfile }
  };
}

// packages/omo-config-core/src/loader/loader.ts
function parseJsoncSafe(content) {
  const errors = [];
  const data = parse5(content.charCodeAt(0) === 65279 ? content.slice(1) : content, errors, {
    allowTrailingComma: true,
    disallowComments: false
  });
  return {
    data: errors.length === 0 ? data : null,
    errors: errors.map((error) => ({
      message: printParseErrorCode(error.error),
      offset: error.offset
    }))
  };
}
var DEFAULT_RAW_CONFIG = {
  agents: {},
  categories: {},
  task: resolveOmoTaskSettings({}),
  teams: {}
};
function stripResolutionControlKeys(config) {
  const {
    "[codex]": _codex,
    "[opencode]": _opencode,
    "[senpi]": _senpi,
    profiles: _profiles,
    ...resolved
  } = config;
  return resolved;
}
function validationDiagnostic(path, issues) {
  const issuePaths = issues.map((issue) => issue.path.map((segment) => String(segment)).join("."));
  return {
    kind: "validation",
    message: `Invalid omo config at ${path}: ${issuePaths.join(", ")}`,
    path,
    issuePaths
  };
}
function unrecognizedKeyIssues(issues) {
  return issues.flatMap((issue) => issue.code === "unrecognized_keys" ? [{ keys: issue.keys, path: issue.path.map((segment) => String(segment)) }] : []);
}
function hasUnsafeUnrecognizedKey(issues) {
  return issues.some((issue) => issue.keys.some((key) => isUnsafeObjectKey(key)));
}
function hasTamperedPrototype(value) {
  if (Array.isArray(value))
    return value.some((entry) => hasTamperedPrototype(entry));
  if (!isRecord6(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    return true;
  return Object.values(value).some((entry) => hasTamperedPrototype(entry));
}
function isRecord6(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function containerAt(record, path) {
  let container = record;
  for (const segment of path) {
    const next = container[segment];
    if (!isRecord6(next))
      return null;
    container = next;
  }
  return container;
}
function stripUnrecognizedKeys(record, issues) {
  const stripped = structuredClone(record);
  const issuePaths = [];
  for (const issue of issues) {
    const container = containerAt(stripped, issue.path);
    if (container === null)
      continue;
    for (const key of issue.keys) {
      delete container[key];
      issuePaths.push([...issue.path, key].join("."));
    }
  }
  return { issuePaths, stripped };
}
function toRecord2(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return null;
  const record = {};
  for (const [key, entry] of Object.entries(value)) {
    record[key] = entry;
  }
  return record;
}
function readConfigSource(path, scope, fileSystem) {
  if (!fileSystem.existsSync(path)) {
    return { source: { exists: false, loaded: false, path, scope } };
  }
  let content;
  try {
    content = fileSystem.readFileSync(path, "utf-8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      diagnostic: { kind: "read", message: `Failed to read ${path}: ${message}`, path },
      source: { exists: true, loaded: false, path, scope }
    };
  }
  const parsed = parseJsoncSafe(content);
  if (parsed.errors.length > 0) {
    return {
      diagnostic: {
        kind: "parse",
        message: `JSONC parse error in ${path}: ${parsed.errors.map((error) => error.message).join(", ")}`,
        path
      },
      source: { exists: true, loaded: false, path, scope }
    };
  }
  if (hasTamperedPrototype(parsed.data)) {
    return {
      diagnostic: { kind: "validation", message: `Invalid omo config at ${path}: "__proto__" member is not allowed`, path },
      source: { exists: true, loaded: false, path, scope }
    };
  }
  const parsedRecord = toRecord2(parsed.data);
  const validation = OmoConfigLayerSchema.safeParse(parsed.data);
  if (!validation.success) {
    const unrecognized = unrecognizedKeyIssues(validation.error.issues);
    if (hasUnsafeUnrecognizedKey(unrecognized)) {
      return {
        diagnostic: validationDiagnostic(path, validation.error.issues),
        source: { exists: true, loaded: false, path, scope }
      };
    }
    const rejected = {
      diagnostic: validationDiagnostic(path, validation.error.issues),
      source: { exists: true, loaded: false, path, scope }
    };
    const unknownIssues = unrecognizedKeyIssues(validation.error.issues);
    if (parsedRecord === null || unknownIssues.length === 0)
      return rejected;
    const { issuePaths, stripped } = stripUnrecognizedKeys(parsedRecord, unknownIssues);
    if (!OmoConfigLayerSchema.safeParse(stripped).success)
      return rejected;
    return {
      diagnostic: {
        kind: "unknown-keys",
        message: `Ignored unknown keys in ${path}: ${issuePaths.join(", ")}`,
        path,
        issuePaths
      },
      source: { exists: true, loaded: true, path, scope },
      value: stripped
    };
  }
  if (parsedRecord === null) {
    return {
      diagnostic: { kind: "validation", message: `Invalid omo config at ${path}: root must be an object`, path },
      source: { exists: true, loaded: false, path, scope }
    };
  }
  return {
    source: { exists: true, loaded: true, path, scope },
    value: parsedRecord
  };
}
function loadOmoConfig(options = {}) {
  const fileSystem = options.fileSystem ?? DEFAULT_READ_FILE_SYSTEM;
  const cwd = options.cwd ?? process.cwd();
  let merged = {};
  const diagnostics = [];
  const layers = [];
  const sources = [];
  for (const candidate of resolveOmoConfigPaths({
    cwd,
    ...options.env === undefined ? {} : { env: options.env },
    fileSystem,
    ...options.platform === undefined ? {} : { platform: options.platform }
  })) {
    const loaded = readConfigSource(candidate.path, candidate.scope, fileSystem);
    sources.push(loaded.source);
    if (loaded.diagnostic !== undefined)
      diagnostics.push(loaded.diagnostic);
    if (loaded.value !== undefined) {
      layers.push({ config: loaded.value, source: loaded.source });
      merged = mergeOmoConfigRecords(merged, loaded.value);
    }
  }
  const requestedProfile = resolveOmoProfileName({
    ...options.env === undefined ? {} : { env: options.env },
    ...options.profile === undefined ? {} : { profile: options.profile }
  });
  const resolved = resolveOmoConfigView({
    config: merged,
    ...options.harness === undefined ? {} : { harness: options.harness },
    ...requestedProfile === undefined ? {} : { profile: requestedProfile }
  });
  const finalConfig = OmoConfigSchema.safeParse(mergeOmoConfigRecords(DEFAULT_RAW_CONFIG, resolved.config));
  if (finalConfig.success) {
    return {
      config: stripResolutionControlKeys(finalConfig.data),
      diagnostics: [...diagnostics, ...resolved.diagnostics],
      layers,
      ...resolved.profile === undefined ? {} : { profile: resolved.profile },
      sources
    };
  }
  return {
    config: stripResolutionControlKeys(OmoConfigSchema.parse(DEFAULT_RAW_CONFIG)),
    diagnostics: [...diagnostics, ...resolved.diagnostics, validationDiagnostic("(merged omo config)", finalConfig.error.issues)],
    layers,
    ...resolved.profile === undefined ? {} : { profile: resolved.profile },
    sources
  };
}

// packages/omo-codex/src/install/codex-default-role-config.ts
function readDefaultRoleConfig(options = {}) {
  const result = loadOmoConfig({ ...options, harness: "codex" });
  return {
    enabled: result.config.agents?.default?.disable !== true,
    warnings: result.diagnostics.map((diagnostic) => diagnostic.message)
  };
}

// packages/omo-codex/src/install/install-codex.ts
import { existsSync as existsSync7 } from "node:fs";
import { homedir as homedir2 } from "node:os";

// packages/omo-codex/src/install/codex-cache-bins.ts
import { chmod, lstat as lstat4, mkdir, readFile as readFile3, readdir as readdir2, readlink as readlink3, rm as rm3, stat as stat2, symlink, writeFile } from "node:fs/promises";
import { basename, isAbsolute as isAbsolute2, join as join5, relative, resolve as resolve3, sep } from "node:path";

// packages/omo-codex/src/install/codex-cache-command-shim.ts
var COMMAND_SHIM_MARKER = ":: generated by oh-my-openagent Codex installer";
function windowsNodeDiscoveryLines() {
  return [
    "setlocal EnableExtensions EnableDelayedExpansion",
    'set "OMO_NODE_BINARY="',
    'set "OMO_NODE_REPL_NODE_PATH=%NODE_REPL_NODE_PATH%"',
    'if exist "%CODEX_HOME%\\config.toml" (',
    `  for /f "tokens=1,* delims==" %%A in ('findstr /R /C:"NODE_REPL_NODE_PATH[ ]*=" "%CODEX_HOME%\\config.toml" 2^>nul') do (`,
    '    set "OMO_NODE_REPL_NODE_PATH=%%B"',
    "  )",
    ")",
    "if defined OMO_NODE_REPL_NODE_PATH (",
    '  set "OMO_NODE_BINARY=!OMO_NODE_REPL_NODE_PATH!"',
    '  for /f "tokens=* delims= " %%N in ("!OMO_NODE_BINARY!") do set "OMO_NODE_BINARY=%%N"',
    `  if "!OMO_NODE_BINARY:~0,1!"=="'" set "OMO_NODE_BINARY=!OMO_NODE_BINARY:~1!"`,
    `  if "!OMO_NODE_BINARY:~-1!"=="'" set "OMO_NODE_BINARY=!OMO_NODE_BINARY:~0,-1!"`,
    '  if "!OMO_NODE_BINARY:~0,1!"=="^"" set "OMO_NODE_BINARY=!OMO_NODE_BINARY:~1!"',
    '  if "!OMO_NODE_BINARY:~-1!"=="^"" set "OMO_NODE_BINARY=!OMO_NODE_BINARY:~0,-1!"',
    '  if defined OMO_NODE_BINARY if not exist "!OMO_NODE_BINARY!" set "OMO_NODE_BINARY="',
    ")",
    'if not defined OMO_NODE_BINARY where node >nul 2>nul && set "OMO_NODE_BINARY=node"'
  ];
}
function windowsCommandShim(targetPath) {
  return [
    "@echo off",
    COMMAND_SHIM_MARKER,
    'if not defined CODEX_HOME set "CODEX_HOME=%USERPROFILE%\\.codex"',
    ...windowsNodeDiscoveryLines(),
    "if not defined OMO_NODE_BINARY (",
    "  echo omo: no Node runtime was discovered from NODE_REPL_NODE_PATH or PATH; rerun LazyCodex install from Codex Desktop 1>&2",
    "  exit /b 127",
    ")",
    `"%OMO_NODE_BINARY%" "${targetPath}" %*`,
    "exit /b %ERRORLEVEL%",
    ""
  ].join(`\r
`);
}

// packages/omo-codex/src/install/codex-cache-dangling-bins.ts
import { lstat as lstat2, readFile, readdir, readlink, rm, stat } from "node:fs/promises";
import { dirname as dirname2, isAbsolute, join as join2, resolve as resolve2 } from "node:path";

// packages/omo-codex/src/install/codex-cache-fs.ts
import { lstat } from "node:fs/promises";
async function fileExistsStrict(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT")
      return false;
    throw error;
  }
}
function isPlainRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isNodeErrorWithCode(error) {
  return typeof error === "object" && error !== null && "code" in error;
}

// packages/omo-codex/src/install/codex-cache-dangling-bins.ts
async function removeDanglingManagedComponentBins(binDir, platform, managedBinNames) {
  const entries = await readdir(binDir, { withFileTypes: true });
  for (const entry of entries) {
    const binName = managedBinNameForEntry(entry.name, platform);
    if (binName === null || !managedBinNames.has(binName))
      continue;
    const linkPath = join2(binDir, entry.name);
    if (platform === "win32") {
      await removeDanglingGeneratedCommandShim(linkPath);
      continue;
    }
    await removeDanglingManagedSymlink(linkPath);
  }
}
function managedBinNameForEntry(name, platform) {
  if (platform === "win32")
    return name.endsWith(".cmd") ? name.slice(0, -4) : null;
  return name;
}
async function removeDanglingManagedSymlink(linkPath) {
  try {
    const linkStat = await lstat2(linkPath);
    if (!linkStat.isSymbolicLink())
      return;
    const linkTarget = await readlink(linkPath);
    const target = isAbsolute(linkTarget) ? linkTarget : resolve2(dirname2(linkPath), linkTarget);
    if (!await isFileSystemEntry(target) && isManagedComponentBinTarget(target))
      await rm(linkPath, { force: true });
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT")
      return;
    throw error;
  }
}
async function removeDanglingGeneratedCommandShim(linkPath) {
  try {
    const linkStat = await lstat2(linkPath);
    if (!linkStat.isFile())
      return;
    const content = await readFile(linkPath, "utf8");
    if (!content.includes(COMMAND_SHIM_MARKER))
      return;
    const target = extractCommandShimTarget(content);
    if (target !== null && !await isFileSystemEntry(target) && isManagedComponentBinTarget(target))
      await rm(linkPath, { force: true });
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT")
      return;
    throw error;
  }
}
async function isFileSystemEntry(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT")
      return false;
    throw error;
  }
}
function extractCommandShimTarget(content) {
  const match = /"([^"\r\n]+components[\\/][^"\r\n]+[\\/]dist[\\/]cli\.js)" %\*/.exec(content);
  return match?.[1] ?? null;
}
function isManagedComponentBinTarget(target) {
  const parts = target.split(/[\\/]+/);
  const suffix = parts.slice(-4);
  return suffix[0] === "components" && suffix[2] === "dist" && suffix[3] === "cli.js" && (hasOmoPluginCachePrefix(parts, parts.length - 4) || hasOmoCodexPluginPrefix(parts, parts.length - 4));
}
function hasOmoPluginCachePrefix(parts, endExclusive) {
  for (let index = 0;index < endExclusive - 4; index += 1) {
    if (parts[index] === "plugins" && parts[index + 1] === "cache" && parts[index + 2] === "sisyphuslabs" && parts[index + 3] === "omo") {
      return index + 4 < endExclusive;
    }
  }
  return false;
}
function hasOmoCodexPluginPrefix(parts, endExclusive) {
  for (let index = 0;index <= endExclusive - 3; index += 1) {
    if (parts[index] === "packages" && parts[index + 1] === "omo-codex" && parts[index + 2] === "plugin")
      return true;
  }
  return false;
}

// packages/omo-codex/src/install/codex-cache-legacy-bins.ts
import { lstat as lstat3, readFile as readFile2, readlink as readlink2, rm as rm2 } from "node:fs/promises";
import { join as join3 } from "node:path";
var LEGACY_CODEX_COMPONENT_BINS = [
  { name: "omo", component: "ulw-loop" },
  { name: "codex-comment-checker", component: "comment-checker" },
  { name: "codex-lsp", component: "lsp" },
  { name: "codex-rules", component: "rules" },
  { name: "codex-telemetry", component: "telemetry" },
  { name: "codex-ultrawork", component: "ultrawork" },
  { name: "codex-ulw-execute-continuation", component: "ulw-execute-continuation" }
];
var LEGACY_CODEX_COMPONENT_BIN_NAMES = LEGACY_CODEX_COMPONENT_BINS.map((entry) => entry.name);
async function removeLegacyCodexComponentBins(binDir, platform) {
  for (const entry of LEGACY_CODEX_COMPONENT_BINS) {
    const linkPath = join3(binDir, platform === "win32" ? `${entry.name}.cmd` : entry.name);
    await removeLegacyCodexComponentBin(linkPath, entry.component, platform);
  }
}
async function removeLegacyCodexComponentBin(linkPath, component, platform) {
  try {
    const stat = await lstat3(linkPath);
    if (platform !== "win32") {
      if (!stat.isSymbolicLink())
        return;
      const target = await readlink2(linkPath);
      if (isManagedLegacyComponentTarget(target, component))
        await rm2(linkPath, { force: true });
      return;
    }
    if (!stat.isFile())
      return;
    const content = await readFile2(linkPath, "utf8");
    if (content.includes(COMMAND_SHIM_MARKER))
      await rm2(linkPath, { force: true });
  } catch (error) {
    if (isNodeErrorWithCode2(error) && error.code === "ENOENT")
      return;
    throw error;
  }
}
function isManagedLegacyComponentTarget(target, component) {
  const parts = target.split(/[\\/]+/);
  const suffixStart = parts.length - 4;
  const suffix = parts.slice(-4);
  return suffix[0] === "components" && suffix[1] === component && suffix[2] === "dist" && suffix[3] === "cli.js" && (hasPluginCachePrefix(parts, suffixStart) || hasOmoCodexPluginPrefix2(parts, suffixStart));
}
function hasPluginCachePrefix(parts, endExclusive) {
  for (let index = 0;index < endExclusive - 1; index += 1) {
    if (parts[index] === "plugins" && parts[index + 1] === "cache")
      return true;
  }
  return false;
}
function hasOmoCodexPluginPrefix2(parts, endExclusive) {
  for (let index = 0;index <= endExclusive - 3; index += 1) {
    if (parts[index] === "packages" && parts[index + 1] === "omo-codex" && parts[index + 2] === "plugin")
      return true;
  }
  return false;
}
function isNodeErrorWithCode2(error) {
  return typeof error === "object" && error !== null && "code" in error;
}

// packages/omo-codex/src/install/codex-cache-runtime-wrapper.ts
import { join as join4 } from "node:path";
var RUNTIME_WRAPPER_MARKER = "OMO_GENERATED_RUNTIME_WRAPPER";
function posixRuntimeWrapper(binName, cliPath, codexHome, binDir, nodeCliPath) {
  const ulwLoopBin = toPosixPath2(join4(binDir, "omo-ulw-loop"));
  const nodeCli = escapePosixDoubleQuoted(toPosixPath2(nodeCliPath));
  const escapedCliPath = escapePosixDoubleQuoted(toPosixPath2(cliPath));
  const escapedCodexHome = escapePosixDoubleQuoted(toPosixPath2(codexHome));
  const escapedUlwLoopBin = escapePosixDoubleQuoted(ulwLoopBin);
  return [
    "#!/bin/sh",
    `# ${RUNTIME_WRAPPER_MARKER}`,
    `export CODEX_HOME="\${CODEX_HOME:-${escapedCodexHome}}"`,
    `export OMO_INVOCATION_NAME=${binName}`,
    "export OMO_EDITION=codex",
    'if [ "$1" = "ulw-loop" ] && [ -x "' + escapedUlwLoopBin + '" ]; then',
    "  shift",
    '  exec "' + escapedUlwLoopBin + '" ulw-loop "$@"',
    "fi",
    `if [ "\${OMO_RUNTIME:-}" = "node" ] && [ -f "${nodeCli}" ]; then`,
    `  exec node "${nodeCli}" "$@"`,
    "fi",
    'BUN_BINARY="${BUN_BINARY:-}"',
    'if [ -z "$BUN_BINARY" ] && command -v bun >/dev/null 2>&1; then',
    "  BUN_BINARY=bun",
    "fi",
    'if [ -z "$BUN_BINARY" ]; then',
    '  for omo_bun_candidate in "$HOME/.bun/bin/bun" /opt/homebrew/bin/bun /usr/local/bin/bun; do',
    '    if [ -x "$omo_bun_candidate" ]; then',
    '      BUN_BINARY="$omo_bun_candidate"',
    "      break",
    "    fi",
    "  done",
    "fi",
    'if [ -z "$BUN_BINARY" ]; then',
    `  if [ -f "${nodeCli}" ] && command -v node >/dev/null 2>&1; then`,
    `    exec node "${nodeCli}" "$@"`,
    "  fi",
    `  echo "${binName}: bun runtime not found (checked PATH, ~/.bun/bin, /opt/homebrew/bin, /usr/local/bin) and the node fallback CLI is missing at ${nodeCli}; install bun from https://bun.sh, or reinstall ${binName} and force the fallback with OMO_RUNTIME=node" >&2`,
    "  exit 127",
    "fi",
    `if [ ! -f "${escapedCliPath}" ]; then`,
    `  echo "${binName}: runtime target missing at ${escapedCliPath}; reinstall with: npx --yes lazycodex-ai@latest install --no-tui" >&2`,
    "  exit 1",
    "fi",
    `exec "$BUN_BINARY" "${escapedCliPath}" "$@"`,
    ""
  ].join(`
`);
}
function windowsRuntimeWrapper(binName, cliPath, codexHome, binDir, nodeCliPath) {
  const ulwLoopBin = join4(binDir, "omo-ulw-loop.cmd");
  return [
    "@echo off",
    `rem ${RUNTIME_WRAPPER_MARKER}`,
    `if not defined CODEX_HOME set "CODEX_HOME=${codexHome}"`,
    `set "OMO_INVOCATION_NAME=${binName}"`,
    'set "OMO_EDITION=codex"',
    ...windowsNodeDiscoveryLines(),
    `if "%~1"=="ulw-loop" if exist "${ulwLoopBin}" (`,
    "  shift /1",
    `  "${ulwLoopBin}" ulw-loop %*`,
    "  exit /b %ERRORLEVEL%",
    ")",
    `if "%OMO_RUNTIME%"=="node" if defined OMO_NODE_BINARY if exist "${nodeCliPath}" (`,
    `  "%OMO_NODE_BINARY%" "${nodeCliPath}" %*`,
    "  exit /b %ERRORLEVEL%",
    ")",
    'if not defined BUN_BINARY where bun >nul 2>nul && set "BUN_BINARY=bun"',
    'if not defined BUN_BINARY if exist "%USERPROFILE%\\.bun\\bin\\bun.exe" set "BUN_BINARY=%USERPROFILE%\\.bun\\bin\\bun.exe"',
    "if not defined BUN_BINARY (",
    `  if defined OMO_NODE_BINARY if exist "${nodeCliPath}" (`,
    `    "%OMO_NODE_BINARY%" "${nodeCliPath}" %*`,
    "    exit /b %ERRORLEVEL%",
    "  )",
    `  echo ${binName}: bun runtime not found, no Node runtime was discovered from NODE_REPL_NODE_PATH or PATH, or the node fallback CLI is missing at ${nodeCliPath}; install bun from https://bun.sh or rerun LazyCodex install from Codex Desktop 1>&2`,
    "  exit /b 127",
    ")",
    `if not exist "${cliPath}" (`,
    `  echo ${binName}: runtime target missing at ${cliPath}; reinstall with: npx --yes lazycodex-ai@latest install --no-tui 1>&2`,
    "  exit /b 1",
    ")",
    `"%BUN_BINARY%" "${cliPath}" %*`,
    ""
  ].join(`\r
`);
}
function toPosixPath2(path) {
  return path.replaceAll("\\", "/");
}
function escapePosixDoubleQuoted(value) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', "\\\"").replaceAll("$", "\\$").replaceAll("`", "\\`");
}

// packages/omo-codex/src/install/codex-cache-bins.ts
var RESERVED_NESTED_BIN_NAMES = new Set([
  "omo",
  "omo-agent-toolkit",
  "lazycodex",
  "lazycodex-ai",
  "oh-my-opencode",
  "oh-my-openagent"
]);
async function linkCachedPluginBins(input) {
  const binLinks = await discoverPackageBins(input.pluginRoot);
  const platform = input.platform ?? process.platform;
  await mkdir(input.binDir, { recursive: true });
  await removeLegacyCodexComponentBins(input.binDir, platform);
  await removeDanglingManagedComponentBins(input.binDir, platform, new Set(binLinks.map((link) => link.name)));
  const linked = [];
  for (const link of binLinks) {
    const linkPath = await linkCachedPluginBin(input.binDir, link, platform);
    linked.push({ name: link.name, path: linkPath, target: link.target });
  }
  return linked;
}
async function removeCachedManagedNpmBinShims(pluginRoot) {
  const binLinks = await discoverPackageBins(pluginRoot);
  if (binLinks.length === 0)
    return;
  const npmBinDir = join5(pluginRoot, "node_modules", ".bin");
  if (!await isFileSystemEntry2(npmBinDir))
    return;
  const managedBinNames = new Set(binLinks.map((link) => link.name));
  for (const name of managedBinNames) {
    for (const suffix of ["", ".cmd", ".ps1"]) {
      await rm3(join5(npmBinDir, `${name}${suffix}`), { force: true });
    }
  }
}
async function linkRootRuntimeBin(input) {
  const cliPath = join5(input.repoRoot, "dist", "cli", "index.js");
  const platform = input.platform ?? process.platform;
  const legacyPath = join5(input.binDir, platform === "win32" ? "omo.cmd" : "omo");
  if (!await isFile(cliPath)) {
    await removeGeneratedRuntimeWrapper(legacyPath);
    return null;
  }
  const binName = "omo-agent-toolkit";
  const nodeCliPath = join5(input.repoRoot, "dist", "cli-node", "index.js");
  await mkdir(input.binDir, { recursive: true });
  if (platform === "win32") {
    const linkPath = join5(input.binDir, `${binName}.cmd`);
    await replaceRuntimeWrapper(linkPath, windowsRuntimeWrapper(binName, cliPath, input.codexHome, input.binDir, nodeCliPath));
    await removeGeneratedRuntimeWrapper(legacyPath);
    return { name: binName, path: linkPath, target: cliPath };
  }
  const linkPath = join5(input.binDir, binName);
  await replaceRuntimeWrapper(linkPath, posixRuntimeWrapper(binName, cliPath, input.codexHome, input.binDir, nodeCliPath));
  await chmod(linkPath, 493);
  await removeGeneratedRuntimeWrapper(legacyPath);
  return { name: binName, path: linkPath, target: cliPath };
}
async function linkCachedPluginBin(binDir, link, platform) {
  if (platform === "win32") {
    const linkPath = join5(binDir, `${link.name}.cmd`);
    await replaceCommandShim(linkPath, link.target);
    return linkPath;
  }
  const linkPath = join5(binDir, link.name);
  await replaceSymlink(linkPath, link.target);
  return linkPath;
}
async function isFile(path) {
  try {
    return (await stat2(path)).isFile();
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT")
      return false;
    throw error;
  }
}
async function isFileSystemEntry2(path) {
  try {
    await stat2(path);
    return true;
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT")
      return false;
    throw error;
  }
}
async function discoverPackageBins(root) {
  const links = [];
  await collectPackageBins(root, root, links);
  return links;
}
async function collectPackageBins(directory, root, links) {
  const entries = await readdir2(directory, { withFileTypes: true });
  if (entries.some((entry) => entry.isFile() && entry.name === "package.json")) {
    await appendPackageBinLinks(join5(directory, "package.json"), directory, root, links);
  }
  for (const entry of entries) {
    if (!entry.isDirectory())
      continue;
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist")
      continue;
    const childPath = join5(directory, entry.name);
    if (!childPath.startsWith(root))
      continue;
    await collectPackageBins(childPath, root, links);
  }
}
async function appendPackageBinLinks(packageJsonPath, packageRoot, root, links) {
  const packageJson = JSON.parse(await readFile3(packageJsonPath, "utf8"));
  if (!isPlainRecord(packageJson))
    return;
  const packageName = packageJson.name;
  const packageBin = packageJson.bin;
  if (typeof packageBin === "string" && typeof packageName === "string") {
    const name = assertSafeCommandName(basename(packageName));
    if (!isReservedNestedBinName(name, packageRoot, root)) {
      links.push({ name, target: resolvePackageBinTarget(packageRoot, packageBin) });
    }
    return;
  }
  if (!isPlainRecord(packageBin))
    return;
  for (const [name, target] of Object.entries(packageBin)) {
    if (typeof target !== "string")
      continue;
    const commandName = assertSafeCommandName(name);
    if (isReservedNestedBinName(commandName, packageRoot, root))
      continue;
    links.push({ name: commandName, target: resolvePackageBinTarget(packageRoot, target) });
  }
}
function assertSafeCommandName(name) {
  if (name.length === 0 || name === "." || name === ".." || name.includes("/") || name.includes("\\") || name.includes("\x00")) {
    throw new Error(`Invalid package bin command name: ${name}`);
  }
  return name;
}
function isReservedNestedBinName(name, packageRoot, root) {
  return packageRoot !== root && RESERVED_NESTED_BIN_NAMES.has(name);
}
function resolvePackageBinTarget(packageRoot, target) {
  if (target.includes("\x00"))
    throw new Error("Package bin target must stay inside package root");
  const root = resolve3(packageRoot);
  const resolvedTarget = resolve3(root, target);
  const relativeTarget = relative(root, resolvedTarget);
  if (relativeTarget === "" || relativeTarget !== ".." && !relativeTarget.startsWith(`..${sep}`) && !isAbsolute2(relativeTarget)) {
    return resolvedTarget;
  }
  throw new Error("Package bin target must stay inside package root");
}
async function replaceSymlink(linkPath, targetPath) {
  if (await existingNonSymlink(linkPath))
    throw new Error(`${linkPath} already exists and is not a symlink`);
  await rm3(linkPath, { force: true });
  await symlink(targetPath, linkPath);
}
async function replaceCommandShim(linkPath, targetPath) {
  if (await existingNonShim(linkPath))
    throw new Error(`${linkPath} already exists and is not a command shim`);
  await writeFile(linkPath, windowsCommandShim(targetPath));
}
async function replaceRuntimeWrapper(linkPath, content) {
  if (await existingNonRuntimeWrapper(linkPath))
    throw new Error(`${linkPath} already exists and is not a generated OMO runtime wrapper`);
  await rm3(linkPath, { force: true });
  await writeFile(linkPath, content);
}
async function removeGeneratedRuntimeWrapper(path) {
  try {
    const entry = await lstat4(path);
    if (!entry.isFile() && !entry.isSymbolicLink())
      return;
    const content = await readGeneratedWrapperContent(path);
    if (content.includes(RUNTIME_WRAPPER_MARKER))
      await rm3(path, { force: true });
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT")
      return;
    throw error;
  }
}
async function readGeneratedWrapperContent(path) {
  try {
    return await readFile3(path, "utf8");
  } catch (error) {
    if (isNodeErrorWithCode(error) && (error.code === "ENOENT" || error.code === "EISDIR"))
      return "";
    throw error;
  }
}
async function existingNonRuntimeWrapper(path) {
  try {
    const stat = await lstat4(path);
    if (stat.isSymbolicLink())
      return false;
    if (!stat.isFile())
      return true;
    const content = await readFile3(path, "utf8");
    return !content.includes(RUNTIME_WRAPPER_MARKER);
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT")
      return false;
    throw error;
  }
}
async function existingNonShim(path) {
  try {
    const stat = await lstat4(path);
    if (!stat.isFile())
      return true;
    const content = await readFile3(path, "utf8");
    if (content.includes(COMMAND_SHIM_MARKER))
      return false;
    throw new Error(`${path} already exists and is not a generated command shim`);
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT")
      return false;
    throw error;
  }
}
async function existingNonSymlink(path) {
  try {
    const stat = await lstat4(path);
    if (!stat.isSymbolicLink())
      return true;
    await readlink3(path);
    return false;
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT")
      return false;
    throw error;
  }
}
// packages/omo-codex/src/install/codex-cache-install.ts
import { cp as cp2, mkdir as mkdir3, readFile as readFile8, readdir as readdir4, rename, rm as rm4 } from "node:fs/promises";
import { basename as basename2, dirname as dirname5, join as join11, sep as sep5 } from "node:path";

// packages/omo-codex/src/install/codex-cache-bundled-mcps.ts
import { cp, mkdir as mkdir2, readFile as readFile4, stat as stat3 } from "node:fs/promises";
import { dirname as dirname3, join as join6, resolve as resolve4 } from "node:path";
var BUNDLED_MCP_RUNTIMES = [
  {
    label: "Git Bash MCP",
    sourceArg: "../../git-bash-mcp/dist/cli.js",
    sourceDistFromPlugin: "../../git-bash-mcp/dist",
    destinationArg: "./components/git-bash-mcp/dist/cli.js",
    destinationDistFromPlugin: "components/git-bash-mcp/dist"
  },
  {
    label: "LSP daemon",
    sourceArg: "../../lsp-daemon/dist/cli.js",
    sourceDistFromPlugin: "../../lsp-daemon/dist",
    destinationArg: "./components/lsp-daemon/dist/cli.js",
    destinationDistFromPlugin: "components/lsp-daemon/dist"
  }
];
async function copyBundledMcpRuntimeDists(input) {
  const sourceArgs = await readSourceMcpArgs(join6(input.sourceRoot, ".mcp.json"));
  for (const runtime of BUNDLED_MCP_RUNTIMES) {
    if (!sourceArgs.has(runtime.sourceArg))
      continue;
    await copyBundledMcpRuntimeDist(input.pluginRoot, input.sourceRoot, runtime);
  }
}
function resolveBundledMcpRuntimeArg(pluginRoot, arg) {
  const runtime = BUNDLED_MCP_RUNTIMES.find((candidate) => candidate.sourceArg === arg);
  return runtime ? join6(pluginRoot, runtime.destinationArg) : null;
}
async function copyBundledMcpRuntimeDist(pluginRoot, sourceRoot, runtime) {
  const sourcePath = resolve4(sourceRoot, runtime.sourceDistFromPlugin);
  if (!await isDirectory(sourcePath)) {
    throw new Error(`missing built ${runtime.label} dist at ${sourcePath}`);
  }
  const destinationPath = join6(pluginRoot, runtime.destinationDistFromPlugin);
  await mkdir2(dirname3(destinationPath), { recursive: true });
  await cp(sourcePath, destinationPath, { recursive: true });
}
async function readSourceMcpArgs(path) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile4(path, "utf8"));
  } catch (error) {
    if (error instanceof Error)
      return new Set;
    return new Set;
  }
  const args = new Set;
  if (!isPlainRecord(parsed) || !isPlainRecord(parsed.mcpServers))
    return args;
  for (const server of Object.values(parsed.mcpServers)) {
    if (!isPlainRecord(server) || !Array.isArray(server.args))
      continue;
    for (const arg of server.args) {
      if (typeof arg === "string")
        args.add(arg);
    }
  }
  return args;
}
async function isDirectory(path) {
  try {
    return (await stat3(path)).isDirectory();
  } catch (error) {
    if (error instanceof Error)
      return false;
    return false;
  }
}

// packages/omo-codex/src/install/codex-cache-local-dependencies.ts
import { realpathSync as realpathSync2 } from "node:fs";
import { readFile as readFile5, readdir as readdir3, writeFile as writeFile2 } from "node:fs/promises";
import { dirname as dirname4, isAbsolute as isAbsolute4, join as join8, relative as relative3, resolve as resolve6, sep as sep2 } from "node:path";

// packages/omo-codex/src/install/codex-cache-paths.ts
import { isAbsolute as isAbsolute3, join as join7, relative as relative2, resolve as resolve5 } from "node:path";
function resolveCachedRuntimePath(pluginRoot, sourceRoot, runtimePath) {
  const targetPath = resolve5(pluginRoot, runtimePath);
  if (isPathInside(targetPath, pluginRoot))
    return targetPath;
  return resolve5(sourceRoot, runtimePath);
}
function isPathInside(candidatePath, rootPath) {
  const pathFromRoot = relative2(rootPath, candidatePath);
  return pathFromRoot === "" || !pathFromRoot.startsWith("..") && !isAbsolute3(pathFromRoot);
}

// packages/omo-codex/src/install/codex-cache-local-dependencies.ts
async function rewriteCachedPackageLocalFileDependencies(pluginRoot, sourceRoot) {
  const packageJsonPaths = [];
  await collectPackageJsonPaths(pluginRoot, pluginRoot, packageJsonPaths);
  const packageLock = await readPackageLock(pluginRoot);
  let rewroteAnyPackageJson = false;
  for (const packageJsonPath of packageJsonPaths) {
    const raw = await readFile5(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!isPlainRecord(parsed))
      continue;
    const packageDir = dirname4(packageJsonPath);
    const sourcePackageDir = join8(sourceRoot, relative3(pluginRoot, packageDir));
    let changed = false;
    for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      const dependencies = parsed[field];
      if (!isPlainRecord(dependencies))
        continue;
      for (const [name, specifier] of Object.entries(dependencies)) {
        if (typeof specifier !== "string" || !specifier.startsWith("file:"))
          continue;
        const filePath = specifier.slice("file:".length);
        if (filePath.length === 0 || isAbsolute4(filePath))
          continue;
        const targetPath = resolve6(packageDir, filePath);
        if (isPathInside(targetPath, pluginRoot))
          continue;
        const sourceTargetPath = resolve6(sourcePackageDir, filePath);
        dependencies[name] = `file:${sourceTargetPath}`;
        rewritePackageLockFileDependency({
          dependencyName: name,
          field,
          packageDir,
          packageLock,
          pluginRoot,
          sourceTargetPath,
          targetPath
        });
        changed = true;
      }
    }
    if (changed) {
      await writeFile2(packageJsonPath, `${JSON.stringify(parsed, null, "\t")}
`);
      rewroteAnyPackageJson = true;
    }
  }
  if (packageLock.changed)
    await writeFile2(packageLock.path, `${JSON.stringify(packageLock.value, null, "\t")}
`);
  return rewroteAnyPackageJson;
}
async function readPackageLock(pluginRoot) {
  const path = join8(pluginRoot, "package-lock.json");
  try {
    const parsed = JSON.parse(await readFile5(path, "utf8"));
    return { path, value: isPlainRecord(parsed) ? parsed : null, changed: false };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { path, value: null, changed: false };
    }
    throw error;
  }
}
function rewritePackageLockFileDependency(input) {
  const packages = getPackageLockPackages(input.packageLock.value);
  if (!packages)
    return;
  const lockRoot = canonicalizeExistingPath(input.pluginRoot);
  const packageKey = toPackageLockPath(relative3(input.pluginRoot, input.packageDir));
  const oldTargetKey = toPackageLockPath(relative3(input.pluginRoot, input.targetPath));
  const newTargetKey = toPackageLockPath(relative3(lockRoot, input.sourceTargetPath));
  const newSpecifier = `file:${input.sourceTargetPath}`;
  const packageEntry = packages[packageKey];
  if (isPlainRecord(packageEntry)) {
    const dependencyRecord = packageEntry[input.field];
    if (isPlainRecord(dependencyRecord) && dependencyRecord[input.dependencyName] !== newSpecifier) {
      dependencyRecord[input.dependencyName] = newSpecifier;
      input.packageLock.changed = true;
    }
  }
  if (oldTargetKey !== newTargetKey && isPlainRecord(packages[oldTargetKey])) {
    packages[newTargetKey] = packages[oldTargetKey];
    delete packages[oldTargetKey];
    input.packageLock.changed = true;
  }
  const nodeModulesKey = `node_modules/${input.dependencyName}`;
  const nodeModulesEntry = packages[nodeModulesKey];
  if (isPlainRecord(nodeModulesEntry) && nodeModulesEntry.resolved !== newTargetKey) {
    nodeModulesEntry.resolved = newTargetKey;
    input.packageLock.changed = true;
  }
}
function getPackageLockPackages(packageLock) {
  if (!packageLock)
    return null;
  const packages = packageLock.packages;
  return isPlainRecord(packages) ? packages : null;
}
function toPackageLockPath(path) {
  return path.split(sep2).join("/");
}
function canonicalizeExistingPath(path) {
  try {
    return realpathSync2(path);
  } catch (error) {
    if (error instanceof Error)
      return path;
    throw error;
  }
}
async function collectPackageJsonPaths(directory, root, paths) {
  const entries = await readdir3(directory, { withFileTypes: true });
  if (entries.some((entry) => entry.isFile() && entry.name === "package.json")) {
    paths.push(join8(directory, "package.json"));
  }
  for (const entry of entries) {
    if (!entry.isDirectory())
      continue;
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist")
      continue;
    const childPath = join8(directory, entry.name);
    if (!isPathInside(childPath, root))
      continue;
    await collectPackageJsonPaths(childPath, root, paths);
  }
}

// packages/omo-codex/src/install/codex-cache-mcp-manifest.ts
import { readFile as readFile6, writeFile as writeFile3 } from "node:fs/promises";
import { join as join9, sep as sep3 } from "node:path";
var CONTEXT7_API_KEY_ENV = "CONTEXT7_API_KEY";
async function rewriteCachedMcpManifest(pluginRoot, sourceRoot = pluginRoot) {
  const manifestPath = join9(pluginRoot, ".mcp.json");
  if (!await fileExistsStrict(manifestPath))
    return;
  const raw = await readFile6(manifestPath, "utf8");
  const parsed = JSON.parse(raw);
  if (!isPlainRecord(parsed) || !isPlainRecord(parsed.mcpServers))
    return;
  let changed = false;
  for (const [serverName, server] of Object.entries(parsed.mcpServers)) {
    if (!isPlainRecord(server))
      continue;
    if (server.cwd === "." || server.cwd === "./") {
      delete server.cwd;
      changed = true;
    }
    const currentArgs = server.args;
    if (Array.isArray(currentArgs)) {
      const nextArgs = currentArgs.map((arg) => {
        if (typeof arg !== "string")
          return arg;
        const bundledMcpRuntimeArg = resolveBundledMcpRuntimeArg(pluginRoot, arg);
        if (bundledMcpRuntimeArg !== null)
          return bundledMcpRuntimeArg;
        if (arg.startsWith("./") || arg.startsWith("../"))
          return resolveCachedRuntimePath(pluginRoot, sourceRoot, arg);
        return arg;
      });
      if (nextArgs.some((value, index) => value !== currentArgs[index])) {
        server.args = nextArgs;
        changed = true;
      }
    }
    if (serverName === "context7" && sanitizeContext7Auth(server)) {
      changed = true;
    }
  }
  if (changed)
    await writeFile3(manifestPath, `${JSON.stringify(parsed, null, "\t")}
`);
}
function sanitizeContext7Auth(server) {
  let changed = false;
  const currentArgs = server.args;
  if (Array.isArray(currentArgs)) {
    const nextArgs = removeContext7ApiKeyArgs(currentArgs);
    if (nextArgs.some((value, index) => value !== currentArgs[index]) || nextArgs.length !== currentArgs.length) {
      server.args = nextArgs;
      changed = true;
    }
  }
  const beforeEnv = JSON.stringify(server.env);
  const nextEnv = sanitizeContext7Env(server.env);
  if (Object.keys(nextEnv).length > 0) {
    server.env = nextEnv;
  } else {
    delete server.env;
  }
  return changed || JSON.stringify(server.env) !== beforeEnv;
}
function removeContext7ApiKeyArgs(args) {
  const nextArgs = [];
  for (let index = 0;index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];
    if (typeof arg === "string" && isContext7ApiKeyFlag(arg) && (isPlaceholderContext7ApiKey(value) || value === undefined)) {
      index += 1;
      continue;
    }
    nextArgs.push(arg);
  }
  return nextArgs;
}
function sanitizeContext7Env(value) {
  const nextEnv = {};
  if (isPlainRecord(value)) {
    for (const [key, envValue] of Object.entries(value)) {
      if (key === CONTEXT7_API_KEY_ENV && isPlaceholderContext7ApiKey(envValue))
        continue;
      nextEnv[key] = envValue;
    }
  }
  return nextEnv;
}
function isContext7ApiKeyFlag(value) {
  return value === "--api-key" || value === "--apiKey";
}
function isPlaceholderContext7ApiKey(value) {
  if (typeof value !== "string")
    return false;
  const normalized = value.trim().toLowerCase().replace(/[<>"'`]/g, "").replace(/[\s_-]+/g, " ");
  return normalized.length === 0 || normalized === "your api key";
}
async function rewriteCachedManifestRoot(pluginRoot, fromRoot, toRoot) {
  const manifestPath = join9(pluginRoot, ".mcp.json");
  if (!await fileExistsStrict(manifestPath))
    return;
  const raw = await readFile6(manifestPath, "utf8");
  const parsed = JSON.parse(raw);
  if (!isPlainRecord(parsed) || !isPlainRecord(parsed.mcpServers))
    return;
  let changed = false;
  for (const server of Object.values(parsed.mcpServers)) {
    if (!isPlainRecord(server))
      continue;
    const currentArgs = server.args;
    if (!Array.isArray(currentArgs))
      continue;
    const nextArgs = currentArgs.map((arg) => {
      if (typeof arg !== "string")
        return arg;
      if (arg === fromRoot)
        return toRoot;
      const prefix = `${fromRoot}${sep3}`;
      if (!arg.startsWith(prefix))
        return arg;
      return `${toRoot}${arg.slice(fromRoot.length)}`;
    });
    if (nextArgs.some((value, index) => value !== currentArgs[index])) {
      server.args = nextArgs;
      changed = true;
    }
  }
  if (changed)
    await writeFile3(manifestPath, `${JSON.stringify(parsed, null, "\t")}
`);
}

// packages/omo-codex/src/install/codex-hook-targets.ts
import { readFile as readFile7 } from "node:fs/promises";
import { join as join10, sep as sep4 } from "node:path";
var PLUGIN_ROOT_TARGET_PATTERN = /\$\{PLUGIN_ROOT\}[\\/]+([^"']+)/g;
async function findMissingHookCommandTargets(pluginRoot) {
  const commands = [];
  for (const manifestPath of await hookManifestPaths(pluginRoot)) {
    if (!await fileExistsStrict(manifestPath))
      continue;
    const parsed = JSON.parse(await readFile7(manifestPath, "utf8"));
    collectCommands(parsed, commands);
  }
  const missing = [];
  const seen = new Set;
  for (const command of commands) {
    for (const match of command.matchAll(PLUGIN_ROOT_TARGET_PATTERN)) {
      const targetSuffix = match[1];
      if (targetSuffix === undefined)
        continue;
      const target = join10(pluginRoot, ...targetSuffix.split(/[\\/]+/));
      if (seen.has(target))
        continue;
      seen.add(target);
      if (!await fileExistsStrict(target))
        missing.push(target);
    }
  }
  return missing;
}
async function hookManifestPaths(pluginRoot) {
  const pluginManifestPath = join10(pluginRoot, ".codex-plugin", "plugin.json");
  if (!await fileExistsStrict(pluginManifestPath))
    return [join10(pluginRoot, "hooks", "hooks.json")];
  const parsed = JSON.parse(await readFile7(pluginManifestPath, "utf8"));
  if (!isPlainRecord(parsed))
    return [];
  if (typeof parsed.hooks === "string" && parsed.hooks.trim() !== "") {
    return [join10(pluginRoot, stripDotSlash(parsed.hooks))];
  }
  if (Array.isArray(parsed.hooks)) {
    return parsed.hooks.filter((hookPath) => typeof hookPath === "string" && hookPath.trim() !== "").map((hookPath) => join10(pluginRoot, stripDotSlash(hookPath)));
  }
  return [];
}
function stripDotSlash(path) {
  return path.startsWith("./") ? path.slice(2) : path;
}
async function assertHookCommandTargets(pluginRoot) {
  const missing = await findMissingHookCommandTargets(pluginRoot);
  if (missing.length === 0)
    return;
  const relativeMissing = missing.map((path) => path.split(`${pluginRoot}${sep4}`).join("").split(sep4).join("/"));
  throw new Error(`Plugin payload is missing ${missing.length} hook command target(s) referenced by hooks.json: ${relativeMissing.join(", ")}. ` + "The previous plugin cache was left untouched; this payload was not activated.");
}
function collectCommands(value, commands) {
  if (Array.isArray(value)) {
    for (const entry of value)
      collectCommands(entry, commands);
    return;
  }
  if (!isPlainRecord(value))
    return;
  if (value["type"] === "command" && typeof value["command"] === "string")
    commands.push(value["command"]);
  if (value["type"] === "command" && typeof value["commandWindows"] === "string")
    commands.push(value["commandWindows"]);
  for (const entry of Object.values(value))
    collectCommands(entry, commands);
}

// packages/omo-codex/src/install/codex-cache-install.ts
async function installCachedPlugin(input) {
  const env = input.env ?? process.env;
  const npmInstallEnv = sanitizeNpmInstallEnv(env);
  if (input.buildSource !== false) {
    await maybeRunNpmInstall(input.sourcePath, input.runCommand, npmInstallEnv);
    await maybeRunNpmBuild(input.sourcePath, input.runCommand, env);
  }
  const targetPath = join11(input.codexHome, "plugins", "cache", input.marketplaceName, input.name, input.version);
  const tempPath = createTempSiblingPath(targetPath);
  await rm4(tempPath, { recursive: true, force: true });
  try {
    await copyDirectory(input.sourcePath, tempPath);
    const rewroteLocalFileDependencies = await rewriteCachedPackageLocalFileDependencies(tempPath, input.sourcePath);
    await copyBundledMcpRuntimeDists({ pluginRoot: tempPath, sourceRoot: input.sourcePath });
    await copyRootRuntimeDists({ pluginRoot: tempPath, sourcePath: input.sourcePath });
    await copyCanonicalPromptSources({ pluginRoot: tempPath, sourcePath: input.sourcePath });
    const installArgs = rewroteLocalFileDependencies ? ["install", "--omit=dev", "--no-audit", "--no-fund"] : ["ci", "--omit=dev"];
    await maybeRunNpmInstall(tempPath, input.runCommand, npmInstallEnv, installArgs);
    await removeCachedManagedNpmBinShims(tempPath);
    if (input.buildSource === false)
      await maybeRunNpmSyncSkills(tempPath, input.runCommand, env);
    await assertNoRemovedSparkshellPromptReferences(tempPath);
    await rewriteCachedMcpManifest(tempPath, input.sourcePath);
    await rewriteCachedManifestRoot(tempPath, tempPath, targetPath);
    await assertHookCommandTargets(tempPath);
    await promoteDirectory(tempPath, targetPath, input.renameDirectory ?? rename);
  } catch (error) {
    await rm4(tempPath, { recursive: true, force: true });
    throw error;
  }
  return { name: input.name, version: input.version, path: targetPath };
}
async function maybeRunNpmInstall(cwd, runCommand, env, args = ["install"]) {
  if (!await fileExistsStrict(join11(cwd, "package.json")))
    return;
  await runCommand("npm", args, { cwd, env });
}
async function maybeRunNpmBuild(cwd, runCommand, env) {
  if (!await fileExistsStrict(join11(cwd, "package.json")))
    return;
  const packageJson = JSON.parse(await readFile8(join11(cwd, "package.json"), "utf8"));
  if (!isPlainRecord(packageJson))
    return;
  const scripts = packageJson.scripts;
  if (!isPlainRecord(scripts) || typeof scripts.build !== "string")
    return;
  await runCommand("npm", ["run", "build"], { cwd, env });
}
async function maybeRunNpmSyncSkills(cwd, runCommand, env) {
  if (!await fileExistsStrict(join11(cwd, "package.json")))
    return;
  const packageJson = JSON.parse(await readFile8(join11(cwd, "package.json"), "utf8"));
  if (!isPlainRecord(packageJson))
    return;
  const scripts = packageJson.scripts;
  if (!isPlainRecord(scripts) || typeof scripts["sync:skills"] !== "string")
    return;
  await runCommand("npm", ["run", "sync:skills"], { cwd, env });
}
function sanitizeNpmInstallEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => key.toLowerCase() !== "npm_config_allow_scripts"));
}
function createTempSiblingPath(targetPath) {
  return join11(dirname5(targetPath), `.tmp-${basename2(targetPath)}-${process.pid}-${Date.now()}`);
}
function createBackupSiblingPath(targetPath) {
  return join11(dirname5(targetPath), `.backup-${basename2(targetPath)}-${process.pid}-${Date.now()}`);
}
async function copyDirectory(sourcePath, targetPath) {
  await mkdir3(dirname5(targetPath), { recursive: true });
  await cp2(sourcePath, targetPath, { recursive: true, filter: (source) => shouldCopyPluginPath(source, sourcePath) });
}
async function promoteDirectory(tempPath, targetPath, renameDirectory) {
  const backupPath = createBackupSiblingPath(targetPath);
  await rm4(backupPath, { recursive: true, force: true });
  let backupMoved = false;
  try {
    if (await fileExistsStrict(targetPath)) {
      await renameDirectory(targetPath, backupPath);
      backupMoved = true;
    }
    await renameDirectory(tempPath, targetPath);
  } catch (error) {
    if (backupMoved)
      await restoreBackupDirectory(backupPath, targetPath, renameDirectory);
    throw error;
  }
  if (backupMoved)
    await rm4(backupPath, { recursive: true, force: true });
}
async function restoreBackupDirectory(backupPath, targetPath, renameDirectory) {
  if (!await fileExistsStrict(backupPath))
    return;
  await rm4(targetPath, { recursive: true, force: true });
  await renameDirectory(backupPath, targetPath);
}
function shouldCopyPluginPath(path, root) {
  const relative = path === root ? "" : path.slice(root.length + sep5.length);
  if (relative === "")
    return true;
  const parts = relative.split(sep5);
  if (parts.some((part) => part === ".git" || part === "node_modules"))
    return false;
  return !isNestedComponentMcpManifest(parts);
}
function isNestedComponentMcpManifest(parts) {
  return parts.length > 1 && parts.at(-1) === ".mcp.json";
}
var removedSparkshellReferencePattern = /\b(?:sparkshell|spark[-_\s]+shell)\b/i;
var removedSparkshellPromptSurfaceDirs = new Set([".codex-plugin", "agents", "bundled-rules", "hooks", "skills"]);
var removedSparkshellPromptSurfaceFiles = new Set(["directive.md", "plugin.json"]);
var removedSparkshellTextFilePattern = /\.(?:json|md|toml|ya?ml)$/i;
async function assertNoRemovedSparkshellPromptReferences(pluginRoot) {
  for (const filePath of await listRemovedSparkshellPromptSurfaceFiles(pluginRoot, "")) {
    const content = await readFile8(join11(pluginRoot, filePath), "utf8");
    if (!removedSparkshellReferencePattern.test(content))
      continue;
    throw new Error(`removed sparkshell reference found in Codex plugin prompt surface: ${filePath}`);
  }
}
async function listRemovedSparkshellPromptSurfaceFiles(pluginRoot, relativeDirectory) {
  const directory = relativeDirectory === "" ? pluginRoot : join11(pluginRoot, relativeDirectory);
  const entries = await readdir4(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = relativeDirectory === "" ? entry.name : join11(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      if (shouldDescendIntoRemovedSparkshellPromptSurface(relativePath)) {
        files.push(...await listRemovedSparkshellPromptSurfaceFiles(pluginRoot, relativePath));
      }
      continue;
    }
    if (shouldCheckRemovedSparkshellPromptFile(relativePath))
      files.push(relativePath);
  }
  return files.sort();
}
function shouldDescendIntoRemovedSparkshellPromptSurface(relativePath) {
  const parts = relativePath.split(sep5);
  if (parts.some((part) => part === ".git" || part === "dist" || part === "node_modules"))
    return false;
  if (parts[0] === "components") {
    if (parts.length <= 2)
      return true;
    return removedSparkshellPromptSurfaceDirs.has(parts[2]);
  }
  return removedSparkshellPromptSurfaceDirs.has(parts[0]);
}
function shouldCheckRemovedSparkshellPromptFile(relativePath) {
  if (!removedSparkshellTextFilePattern.test(relativePath))
    return false;
  const parts = relativePath.split(sep5);
  const fileName = parts.at(-1) ?? "";
  if (parts[0] === "components") {
    if (parts.length === 3)
      return removedSparkshellPromptSurfaceFiles.has(fileName);
    return parts.length > 3 && removedSparkshellPromptSurfaceDirs.has(parts[2]);
  }
  return removedSparkshellPromptSurfaceDirs.has(parts[0]);
}
async function copyRootRuntimeDists(input) {
  const repoRoot = repoRootForCodexPluginSource(input.sourcePath);
  if (repoRoot === null)
    return;
  for (const runtimePath of ["dist/cli", "dist/cli-node"]) {
    const sourcePath = join11(repoRoot, runtimePath);
    if (!await fileExistsStrict(join11(sourcePath, "index.js")))
      continue;
    await mkdir3(dirname5(join11(input.pluginRoot, runtimePath)), { recursive: true });
    await cp2(sourcePath, join11(input.pluginRoot, runtimePath), { recursive: true });
  }
}
var canonicalPromptRelativePaths = [join11("packages", "prompts-core", "prompts", "ultrawork", "codex.md")];
async function copyCanonicalPromptSources(input) {
  const repoRoot = repoRootForCodexPluginSource(input.sourcePath);
  if (repoRoot === null)
    return;
  for (const relativePath of canonicalPromptRelativePaths) {
    const sourceFile = join11(repoRoot, relativePath);
    if (!await fileExistsStrict(sourceFile))
      continue;
    const targetFile = join11(input.pluginRoot, relativePath);
    await mkdir3(dirname5(targetFile), { recursive: true });
    await cp2(sourceFile, targetFile);
  }
}
function repoRootForCodexPluginSource(sourcePath) {
  const codexPackageRoot = dirname5(sourcePath);
  const packagesRoot = dirname5(codexPackageRoot);
  if (basename2(sourcePath) !== "plugin")
    return null;
  if (basename2(codexPackageRoot) !== "omo-codex")
    return null;
  if (basename2(packagesRoot) !== "packages")
    return null;
  return dirname5(packagesRoot);
}
// packages/omo-codex/src/install/codex-cache-prune.ts
import { lstat as lstat5, readdir as readdir5, rm as rm5, stat as stat4 } from "node:fs/promises";
import { join as join12 } from "node:path";
async function pruneMarketplaceCache(input) {
  const cacheRoot = join12(input.codexHome, "plugins", "cache", input.marketplaceName);
  if (!await fileExistsStrict(cacheRoot))
    return;
  const keep = new Set(input.keepPluginNames);
  const entries = await readCacheEntries(cacheRoot);
  for (const entry of entries) {
    if (!entry.isDirectory() || keep.has(entry.name))
      continue;
    await rm5(join12(cacheRoot, entry.name), { recursive: true, force: true });
  }
}
async function pruneMarketplacePluginCaches(input) {
  const cacheRoot = join12(input.codexHome, "plugins", "cache", input.marketplaceName);
  if (!await fileExistsStrict(cacheRoot))
    return;
  for (const pluginName of input.pluginNames) {
    await rm5(join12(cacheRoot, pluginName), { recursive: true, force: true });
  }
  const remainingEntries = await readCacheEntryNames(cacheRoot);
  if (remainingEntries.length === 0) {
    await rm5(cacheRoot, { recursive: true, force: true });
  }
}
async function readCacheEntries(path) {
  const emptyEntries = [];
  return readCacheRoot(path, () => readdir5(path, { withFileTypes: true }), emptyEntries);
}
async function readCacheEntryNames(path) {
  const emptyNames = [];
  return readCacheRoot(path, () => readdir5(path), emptyNames);
}
async function readCacheRoot(path, readEntries, fallback) {
  try {
    return await readEntries();
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT")
      return fallback;
    if (await isBrokenCacheSymlink(path))
      return fallback;
    throw error;
  }
}
async function isBrokenCacheSymlink(path) {
  try {
    const entry = await lstat5(path);
    if (!entry.isSymbolicLink())
      return false;
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT")
      return true;
    throw error;
  }
  try {
    await stat4(path);
    return false;
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT")
      return true;
    throw error;
  }
}
// packages/omo-codex/src/install/codex-cached-marketplace-manifest.ts
import { mkdir as mkdir4, rename as rename2, rm as rm6, stat as stat5, writeFile as writeFile4 } from "node:fs/promises";
import { join as join13 } from "node:path";
async function writeCachedMarketplaceManifest(input) {
  const marketplaceDir = join13(input.marketplaceRoot, ".agents", "plugins");
  await mkdir4(marketplaceDir, { recursive: true });
  for (const plugin of input.plugins) {
    const pluginPath = join13(input.marketplaceRoot, plugin.name, plugin.version);
    if (!await isDirectory2(pluginPath))
      throw new Error(`Cannot write cached marketplace manifest: ${pluginPath} does not exist`);
  }
  const manifestPath = join13(marketplaceDir, "marketplace.json");
  const tempPath = join13(marketplaceDir, `.marketplace.json.tmp-${process.pid}-${Date.now()}`);
  try {
    await writeFile4(tempPath, `${JSON.stringify({
      name: input.marketplaceName,
      plugins: input.plugins.map((plugin) => ({
        name: plugin.name,
        source: { source: "local", path: `./${plugin.name}/${plugin.version}` }
      }))
    }, null, "\t")}
`);
    await rename2(tempPath, manifestPath);
  } catch (error) {
    await rm6(tempPath, { force: true });
    throw error;
  }
}
async function isDirectory2(path) {
  try {
    return (await stat5(path)).isDirectory();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
}

// packages/omo-codex/src/install/codex-package-layout.ts
import { existsSync as existsSync3 } from "node:fs";
import { readFile as readFile9 } from "node:fs/promises";
import { join as join14 } from "node:path";
var PACKAGED_CODEX_INSTALLER_NAMES = new Set([
  "@code-yeongyu/lazycodex",
  "@code-yeongyu/lazycodex-ai",
  "lazycodex",
  "lazycodex-ai",
  "oh-my-opencode",
  "oh-my-openagent"
]);
async function shouldBuildSourcePackages(repoRoot) {
  if (existsSync3(join14(repoRoot, "packages", "omo-opencode", "src", "index.ts")))
    return true;
  const packageJsonPath = join14(repoRoot, "package.json");
  if (!existsSync3(packageJsonPath))
    return true;
  const packageJson = JSON.parse(await readFile9(packageJsonPath, "utf8"));
  if (!isPlainRecord(packageJson) || typeof packageJson.name !== "string")
    return true;
  return !PACKAGED_CODEX_INSTALLER_NAMES.has(packageJson.name);
}

// packages/omo-codex/src/install/codex-config-toml.ts
import { mkdir as mkdir5, readFile as readFile11 } from "node:fs/promises";
import { dirname as dirname8 } from "node:path";

// packages/omo-codex/src/install/toml-section-editor.ts
function findTomlSection(config, header) {
  const headerLine = `[${header}]`;
  const targetHeaderPath = parseTomlDottedKey(header);
  const lines = config.match(/[^\n]*\n?|$/g) ?? [];
  let offset = 0;
  let start = -1;
  let multilineQuote = null;
  for (const line of lines) {
    if (line.length === 0)
      break;
    const multilineScan = scanTomlMultilineLine(line, multilineQuote);
    multilineQuote = multilineScan.nextQuote;
    if (multilineScan.wasInside) {
      offset += line.length;
      continue;
    }
    const trimmed = line.trim();
    if (start === -1) {
      if (tomlTableHeaderMatches(trimmed, headerLine, targetHeaderPath))
        start = offset;
    } else if (isTomlTableHeaderLine(line)) {
      return { start, end: offset, text: config.slice(start, offset) };
    }
    offset += line.length;
  }
  if (start === -1)
    return null;
  return { start, end: config.length, text: config.slice(start) };
}
function replaceOrInsertSetting(config, section, key, value) {
  const targetPath = parseTomlDottedKey(key);
  if (!targetPath)
    return config;
  const lines = section.text.match(/[^\n]*\n?|$/g) ?? [];
  let offset = 0;
  let multilineQuote = null;
  for (const line of lines) {
    if (line.length === 0)
      break;
    const multilineScan = scanTomlMultilineLine(line, multilineQuote);
    multilineQuote = multilineScan.nextQuote;
    if (multilineScan.wasInside) {
      offset += line.length;
      continue;
    }
    const assignmentIndex = findUnquotedAssignment(line);
    if (assignmentIndex < 0) {
      offset += line.length;
      continue;
    }
    const settingPath = parseTomlDottedKey(line.slice(0, assignmentIndex).trim());
    if (!settingPath || !tomlPathMatches(settingPath, targetPath)) {
      offset += line.length;
      continue;
    }
    const replacement = replaceTomlAssignmentValue(line, assignmentIndex, value);
    const assignmentEnd = multilineScan.nextQuote ? findTomlMultilineValueEnd(section.text, offset + line.length, multilineScan.nextQuote) : offset + line.length;
    const sectionReplacement = section.text.slice(0, offset) + replacement + section.text.slice(assignmentEnd);
    return config.slice(0, section.start) + sectionReplacement + config.slice(section.end);
  }
  const replacement = insertSetting(section.text, key, value);
  return config.slice(0, section.start) + replacement + config.slice(section.end);
}
function removeSetting(config, section, key) {
  const linePattern = new RegExp(`^[ \\t]*${escapeRegExp(key)}[ \\t]*=.*(?:\\n|$)`, "m");
  const replacement = section.text.replace(linePattern, "");
  return config.slice(0, section.start) + replacement + config.slice(section.end);
}
function replaceOrInsertRootSetting(config, key, value) {
  const sectionStart = findFirstTableStart(config);
  const root = config.slice(0, sectionStart);
  const suffix = config.slice(sectionStart);
  const linePattern = new RegExp(`^[ \\t]*${escapeRegExp(key)}[ \\t]*=.*$`, "m");
  const replacement = linePattern.test(root) ? root.replace(linePattern, `${key} = ${value}`) : `${root.trimEnd()}${root.trimEnd().length > 0 ? `
` : ""}${key} = ${value}
`;
  if (suffix.length === 0)
    return replacement;
  return `${replacement.trimEnd()}

${suffix.trimStart()}`;
}
function removeRootSetting(config, key) {
  const sectionStart = findFirstTableStart(config);
  const root = config.slice(0, sectionStart);
  const suffix = config.slice(sectionStart);
  const linePattern = new RegExp(`^[ \\t]*${escapeRegExp(key)}[ \\t]*=.*(?:\\n|$)`, "m");
  if (!linePattern.test(root))
    return config;
  return root.replace(linePattern, "") + suffix;
}
function replaceOrInsertRootDottedSetting(config, keyPath, value) {
  const targetPath = parseTomlDottedKey(keyPath);
  if (!targetPath)
    return config;
  const lines = config.match(/[^\n]*\n?|$/g) ?? [];
  let offset = 0;
  let multilineQuote = null;
  for (const line of lines) {
    if (line.length === 0)
      break;
    const multilineScan = scanTomlMultilineLine(line, multilineQuote);
    multilineQuote = multilineScan.nextQuote;
    if (multilineScan.wasInside) {
      offset += line.length;
      continue;
    }
    if (isTomlTableHeaderLine(line))
      break;
    const assignmentIndex = findUnquotedAssignment(line);
    if (assignmentIndex < 0) {
      offset += line.length;
      continue;
    }
    const settingPath = parseTomlDottedKey(line.slice(0, assignmentIndex).trim());
    if (!settingPath || !tomlPathMatches(settingPath, targetPath)) {
      offset += line.length;
      continue;
    }
    const replacement = replaceTomlAssignmentValue(line, assignmentIndex, value);
    const assignmentEnd = multilineScan.nextQuote ? findTomlMultilineValueEnd(config, offset + line.length, multilineScan.nextQuote) : offset + line.length;
    return config.slice(0, offset) + replacement + config.slice(assignmentEnd);
  }
  const sectionStart = findFirstTableStart(config);
  const root = config.slice(0, sectionStart).trimEnd();
  const suffix = config.slice(sectionStart);
  const replacement = `${root}${root.length > 0 ? `
` : ""}${keyPath} = ${value}
`;
  if (suffix.length === 0)
    return replacement;
  return `${replacement.trimEnd()}

${suffix.trimStart()}`;
}
function appendBlock(config, block) {
  const prefix = config.trimEnd();
  return `${prefix}${prefix.length > 0 ? `

` : ""}${block.trimEnd()}
`;
}
function findFirstTableStart(config) {
  const lines = config.match(/[^\n]*\n?|$/g) ?? [];
  let offset = 0;
  let multilineQuote = null;
  for (const line of lines) {
    if (line.length === 0)
      break;
    const multilineScan = scanTomlMultilineLine(line, multilineQuote);
    multilineQuote = multilineScan.nextQuote;
    if (multilineScan.wasInside) {
      offset += line.length;
      continue;
    }
    if (isTomlTableHeaderLine(line))
      return offset;
    offset += line.length;
  }
  return config.length;
}
function insertSetting(sectionText, key, value) {
  const lines = sectionText.split(`
`);
  lines.splice(1, 0, `${key} = ${value}`);
  return lines.join(`
`);
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function tomlTableHeaderMatches(line, headerLine, targetHeaderPath) {
  const normalizedLine = stripUnquotedInlineComment(line).trim();
  if (normalizedLine === headerLine)
    return true;
  if (!targetHeaderPath)
    return false;
  const candidateHeaderPath = parseTomlTableHeader(normalizedLine);
  if (!candidateHeaderPath || candidateHeaderPath.length !== targetHeaderPath.length)
    return false;
  return candidateHeaderPath.every((part, index) => part === targetHeaderPath[index]);
}
function parseTomlTableHeader(line) {
  const normalizedLine = stripUnquotedInlineComment(line).trim();
  if (!normalizedLine.startsWith("[") || !normalizedLine.endsWith("]") || normalizedLine.startsWith("[["))
    return null;
  return parseTomlDottedKey(normalizedLine.slice(1, -1).trim());
}
function isTomlTableHeaderLine(line) {
  const normalizedLine = stripUnquotedInlineComment(line).trim();
  return normalizedLine.startsWith("[") && normalizedLine.endsWith("]");
}
function scanTomlMultilineLine(line, currentQuote) {
  if (currentQuote) {
    return {
      wasInside: true,
      nextQuote: findTomlMultilineDelimiter(line, currentQuote, 0) === -1 ? currentQuote : null
    };
  }
  let quote = null;
  let index = 0;
  while (index < line.length) {
    const char = line[index];
    if (quote === '"') {
      if (char === "\\") {
        index += 2;
        continue;
      }
      if (char === '"')
        quote = null;
      index += 1;
      continue;
    }
    if (quote === "'") {
      if (char === "'")
        quote = null;
      index += 1;
      continue;
    }
    if (char === "#")
      break;
    const delimiter = line.startsWith('"""', index) ? '"""' : line.startsWith("'''", index) ? "'''" : null;
    if (delimiter) {
      const closingIndex = findTomlMultilineDelimiter(line, delimiter, index + delimiter.length);
      return { wasInside: false, nextQuote: closingIndex === -1 ? delimiter : null };
    }
    if (char === '"' || char === "'")
      quote = char;
    index += 1;
  }
  return { wasInside: false, nextQuote: null };
}
function findTomlMultilineDelimiter(line, delimiter, startIndex) {
  let index = line.indexOf(delimiter, startIndex);
  while (index !== -1) {
    if (delimiter === "'''" || countPrecedingBackslashes(line, index) % 2 === 0)
      return index;
    index = line.indexOf(delimiter, index + 1);
  }
  return -1;
}
function countPrecedingBackslashes(line, index) {
  let count = 0;
  let cursor = index - 1;
  while (cursor >= 0 && line[cursor] === "\\") {
    count += 1;
    cursor -= 1;
  }
  return count;
}
function findUnquotedAssignment(line) {
  return findUnquotedCharacter(line, "=", 0);
}
function findUnquotedComment(line, startIndex) {
  return findUnquotedCharacter(line, "#", startIndex);
}
function findUnquotedCharacter(line, target, startIndex) {
  let quote = null;
  let index = startIndex;
  while (index < line.length) {
    const char = line[index];
    if (quote === '"') {
      if (char === "\\") {
        index += 2;
        continue;
      }
      if (char === '"')
        quote = null;
      index += 1;
      continue;
    }
    if (quote === "'") {
      if (char === "'")
        quote = null;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      index += 1;
      continue;
    }
    if (char === target)
      return index;
    if (char === "#")
      return -1;
    index += 1;
  }
  return -1;
}
function tomlPathMatches(candidate, target) {
  return candidate.length === target.length && candidate.every((part, index) => part === target[index]);
}
function replaceTomlAssignmentValue(line, assignmentIndex, value) {
  const newline = line.endsWith(`
`) ? `
` : "";
  const lineBody = newline ? line.slice(0, -1) : line;
  const commentIndex = findUnquotedComment(lineBody, assignmentIndex + 1);
  const comment = commentIndex === -1 ? "" : ` ${lineBody.slice(commentIndex).trimStart()}`;
  return `${lineBody.slice(0, assignmentIndex + 1)} ${value}${comment}${newline}`;
}
function findTomlMultilineValueEnd(text, startOffset, quote) {
  const lines = text.slice(startOffset).match(/[^\n]*\n?|$/g) ?? [];
  let offset = startOffset;
  let currentQuote = quote;
  for (const line of lines) {
    if (line.length === 0)
      break;
    const scan = scanTomlMultilineLine(line, currentQuote);
    currentQuote = scan.nextQuote;
    offset += line.length;
    if (currentQuote === null)
      return offset;
  }
  return text.length;
}
function stripUnquotedInlineComment(line) {
  let quote = null;
  let index = 0;
  while (index < line.length) {
    const char = line[index];
    if (quote === '"') {
      if (char === "\\") {
        index += 2;
        continue;
      }
      if (char === '"')
        quote = null;
      index += 1;
      continue;
    }
    if (quote === "'") {
      if (char === "'")
        quote = null;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      index += 1;
      continue;
    }
    if (char === "#")
      return line.slice(0, index);
    index += 1;
  }
  return line;
}
function parseTomlDottedKey(input) {
  const parts = [];
  let index = 0;
  while (index < input.length) {
    index = skipWhitespace(input, index);
    const parsedKey = parseTomlKeyPart(input, index);
    if (!parsedKey)
      return null;
    parts.push(parsedKey.value);
    index = skipWhitespace(input, parsedKey.nextIndex);
    if (index === input.length)
      return parts;
    if (input[index] !== ".")
      return null;
    index += 1;
  }
  return parts.length > 0 ? parts : null;
}
function parseTomlKeyPart(input, startIndex) {
  const quote = input[startIndex];
  if (quote === "'")
    return parseLiteralTomlString(input, startIndex);
  if (quote === '"')
    return parseBasicTomlString(input, startIndex);
  return parseBareTomlKey(input, startIndex);
}
function parseLiteralTomlString(input, startIndex) {
  let index = startIndex + 1;
  let value = "";
  while (index < input.length) {
    const char = input[index];
    if (char === "'")
      return { value, nextIndex: index + 1 };
    value += char;
    index += 1;
  }
  return null;
}
function parseBasicTomlString(input, startIndex) {
  let index = startIndex + 1;
  let value = "";
  while (index < input.length) {
    const char = input[index];
    if (char === '"')
      return { value, nextIndex: index + 1 };
    if (char !== "\\") {
      value += char;
      index += 1;
      continue;
    }
    const escaped = parseBasicTomlEscape(input, index);
    if (!escaped)
      return null;
    value += escaped.value;
    index = escaped.nextIndex;
  }
  return null;
}
function parseBasicTomlEscape(input, backslashIndex) {
  const escape = input[backslashIndex + 1];
  if (escape === undefined)
    return null;
  if (escape === "b")
    return { value: "\b", nextIndex: backslashIndex + 2 };
  if (escape === "t")
    return { value: "\t", nextIndex: backslashIndex + 2 };
  if (escape === "n")
    return { value: `
`, nextIndex: backslashIndex + 2 };
  if (escape === "f")
    return { value: "\f", nextIndex: backslashIndex + 2 };
  if (escape === "r")
    return { value: "\r", nextIndex: backslashIndex + 2 };
  if (escape === '"')
    return { value: '"', nextIndex: backslashIndex + 2 };
  if (escape === "\\")
    return { value: "\\", nextIndex: backslashIndex + 2 };
  if (escape === "u")
    return parseUnicodeEscape(input, backslashIndex + 2, 4);
  if (escape === "U")
    return parseUnicodeEscape(input, backslashIndex + 2, 8);
  return null;
}
function parseUnicodeEscape(input, digitsStart, digitCount) {
  const digits = input.slice(digitsStart, digitsStart + digitCount);
  if (digits.length !== digitCount || !/^[0-9A-Fa-f]+$/.test(digits))
    return null;
  const codePoint = Number.parseInt(digits, 16);
  if (codePoint > 1114111)
    return null;
  return { value: String.fromCodePoint(codePoint), nextIndex: digitsStart + digitCount };
}
function parseBareTomlKey(input, startIndex) {
  let index = startIndex;
  while (index < input.length && /[A-Za-z0-9_-]/.test(input[index]))
    index += 1;
  if (index === startIndex)
    return null;
  return { value: input.slice(startIndex, index), nextIndex: index };
}
function skipWhitespace(input, startIndex) {
  let index = startIndex;
  while (index < input.length && /\s/.test(input[index]))
    index += 1;
  return index;
}

// packages/omo-codex/src/install/codex-config-toml-sections.ts
function removeTomlSections(config, shouldRemove) {
  return splitTomlSections(config).filter((section) => section.header === null || !shouldRemove(section.header, section)).map((section) => section.text).join("").replace(/\n{3,}/g, `

`);
}
function splitTomlSections(config) {
  const lines = config.match(/[^\n]*\n?|$/g) ?? [];
  const sections = [];
  let current = { header: null, text: "" };
  for (const line of lines) {
    if (line.length === 0)
      break;
    const header = parseTomlHeader(line);
    if (header !== null) {
      if (current.text.length > 0)
        sections.push(current);
      current = { header, text: line };
    } else {
      current = { ...current, text: current.text + line };
    }
  }
  if (current.text.length > 0)
    sections.push(current);
  return sections;
}
function parsePluginHeaderKey(header) {
  const path = parseTomlDottedKey(header);
  return path?.[0] === "plugins" ? path[1] ?? null : null;
}
function parseAgentHeaderName(header) {
  const path = parseTomlDottedKey(header);
  return path?.[0] === "agents" ? path[1] ?? null : null;
}
function parseJsonString(value) {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "string" ? parsed : null;
  } catch {
    return null;
  }
}
function parseHookStateHeaderKey(header) {
  const path = parseTomlDottedKey(header);
  if (path?.[0] !== "hooks" || path[1] !== "state")
    return null;
  return path[2] ?? null;
}
function parseTomlHeader(line) {
  const trimmed = stripTomlLineComment(line).trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]") || trimmed.startsWith("[["))
    return null;
  return trimmed.slice(1, -1);
}
function stripTomlLineComment(line) {
  let quote = null;
  let index = 0;
  while (index < line.length) {
    const char = line[index];
    if (quote === '"') {
      if (char === "\\") {
        index += 2;
        continue;
      }
      if (char === '"')
        quote = null;
      index += 1;
      continue;
    }
    if (quote === "'") {
      if (char === "'")
        quote = null;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      index += 1;
      continue;
    }
    if (char === "#")
      return line.slice(0, index);
    index += 1;
  }
  return line;
}

// packages/omo-codex/src/install/codex-config-agents.ts
var LEGACY_MANAGED_CODEX_AGENT_NAMES_TO_PURGE = ["codex-ultrawork-reviewer"];
var CURRENT_MANAGED_CODEX_AGENT_NAMES = [
  "explorer",
  "lazycodex-worker-high",
  "lazycodex-worker-low",
  "lazycodex-worker-medium",
  "librarian",
  "metis",
  "momus",
  "plan"
];
var MANAGED_CODEX_AGENT_NAMES = [
  ...LEGACY_MANAGED_CODEX_AGENT_NAMES_TO_PURGE,
  ...CURRENT_MANAGED_CODEX_AGENT_NAMES
];
function removeStaleManagedAgentBlocks(config, keepAgentNames) {
  const managedAgentNames = new Set(MANAGED_CODEX_AGENT_NAMES);
  return splitTomlSections(config).filter((section) => {
    if (section.header === null)
      return true;
    const agentName = parseAgentHeaderName(section.header);
    if (agentName === null || !managedAgentNames.has(agentName) || keepAgentNames.has(agentName))
      return true;
    return !section.text.includes(`config_file = ${JSON.stringify(`./agents/${agentName}.toml`)}`);
  }).map((section) => section.text).join("").replace(/\n{3,}/g, `

`);
}
function hasForeignAgentRegistration(config, agentConfig) {
  const section = findTomlSection(config, `agents.${tomlKeySegment(agentConfig.name)}`);
  if (!section)
    return false;
  return !section.text.includes(`config_file = ${JSON.stringify(agentConfig.configFile)}`);
}
function ensureAgentConfig(config, agentConfig) {
  const header = `agents.${tomlKeySegment(agentConfig.name)}`;
  const section = findTomlSection(config, header);
  const configFile = JSON.stringify(agentConfig.configFile);
  if (!section)
    return appendBlock(config, `[${header}]
config_file = ${configFile}
`);
  return replaceOrInsertSetting(config, section, "config_file", configFile);
}
function tomlKeySegment(value) {
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : JSON.stringify(value);
}

// packages/omo-codex/src/install/codex-config-atomic-write.ts
import { lstat as lstat6, readlink as readlink4, realpath, rename as rename3, unlink, writeFile as writeFile5 } from "node:fs/promises";
import { basename as basename3, dirname as dirname6, isAbsolute as isAbsolute5, join as join15, resolve as resolve7 } from "node:path";
var RENAME_RETRY_DELAYS_MS = [10, 25, 50];
var RETRIABLE_RENAME_CODES = new Set(["EPERM", "EBUSY"]);
async function writeFileAtomic(targetPath, data) {
  const writeTarget = await resolveSymlinkTarget(targetPath);
  const temporaryPath = join15(dirname6(writeTarget), `.tmp-${basename3(writeTarget)}-${process.pid}-${Date.now()}`);
  await writeFile5(temporaryPath, data);
  try {
    await renameWithRetry(temporaryPath, writeTarget);
  } catch (error) {
    await unlink(temporaryPath).catch((unlinkError) => {
      if (unlinkError instanceof Error)
        return;
      return;
    });
    throw error;
  }
}
async function resolveSymlinkTarget(targetPath) {
  try {
    const linkStats = await lstat6(targetPath);
    if (!linkStats.isSymbolicLink())
      return targetPath;
  } catch (error) {
    if (error instanceof Error)
      return targetPath;
    return targetPath;
  }
  try {
    return await realpath(targetPath);
  } catch (error) {
    if (!(error instanceof Error))
      throw error;
    const linkValue = await readlink4(targetPath);
    return isAbsolute5(linkValue) ? linkValue : resolve7(dirname6(targetPath), linkValue);
  }
}
async function renameWithRetry(fromPath, toPath) {
  for (let attempt = 0;; attempt += 1) {
    try {
      await rename3(fromPath, toPath);
      return;
    } catch (error) {
      if (!isRetriableRenameError(error) || attempt >= RENAME_RETRY_DELAYS_MS.length) {
        throw error;
      }
      await delay(RENAME_RETRY_DELAYS_MS[attempt] ?? 0);
    }
  }
}
function isRetriableRenameError(error) {
  if (!(error instanceof Error) || !("code" in error))
    return false;
  return typeof error.code === "string" && RETRIABLE_RENAME_CODES.has(error.code);
}
function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

// packages/omo-codex/src/install/toml-setting-reader.ts
function hasTomlRootDottedKeyPrefix(config, rootKey) {
  return hasTomlAssignment(config, (tablePath, settingPath) => tablePath.length === 0 && settingPath.length > 1 && settingPath[0] === rootKey);
}
function hasTomlAssignment(config, predicate) {
  let tablePath = [];
  let multilineQuote = null;
  for (const line of config.split(`
`)) {
    const multilineScan = scanTomlMultilineLine(line, multilineQuote);
    multilineQuote = multilineScan.nextQuote;
    if (multilineScan.wasInside)
      continue;
    const normalizedLine = stripUnquotedInlineComment2(line).trim();
    if (normalizedLine.length === 0)
      continue;
    const headerPath = parseTomlTableHeader2(normalizedLine);
    if (headerPath) {
      tablePath = headerPath;
      continue;
    }
    if (isTomlTableHeaderLine2(normalizedLine)) {
      tablePath = null;
      continue;
    }
    if (!tablePath)
      continue;
    const assignmentIndex = findUnquotedAssignment2(normalizedLine);
    if (assignmentIndex < 0)
      continue;
    const settingPath = parseTomlDottedKey(normalizedLine.slice(0, assignmentIndex).trim());
    if (!settingPath)
      continue;
    if (predicate(tablePath, settingPath))
      return true;
  }
  return false;
}
function parseTomlTableHeader2(line) {
  if (!line.startsWith("[") || !line.endsWith("]") || line.startsWith("[["))
    return null;
  return parseTomlDottedKey(line.slice(1, -1).trim());
}
function isTomlTableHeaderLine2(line) {
  return line.startsWith("[") && line.endsWith("]");
}
function stripUnquotedInlineComment2(line) {
  let quote = null;
  let index = 0;
  while (index < line.length) {
    const char = line[index];
    if (quote === '"') {
      if (char === "\\") {
        index += 2;
        continue;
      }
      if (char === '"')
        quote = null;
      index += 1;
      continue;
    }
    if (quote === "'") {
      if (char === "'")
        quote = null;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      index += 1;
      continue;
    }
    if (char === "#")
      return line.slice(0, index);
    index += 1;
  }
  return line;
}
function findUnquotedAssignment2(line) {
  let quote = null;
  let index = 0;
  while (index < line.length) {
    const char = line[index];
    if (quote === '"') {
      if (char === "\\") {
        index += 2;
        continue;
      }
      if (char === '"')
        quote = null;
      index += 1;
      continue;
    }
    if (quote === "'") {
      if (char === "'")
        quote = null;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      index += 1;
      continue;
    }
    if (char === "=")
      return index;
    index += 1;
  }
  return -1;
}

// packages/omo-codex/src/install/codex-config-features.ts
function ensureFeatureEnabled(config, featureName) {
  const section = findTomlSection(config, "features");
  if (!section) {
    if (hasTomlRootDottedKeyPrefix(config, "features")) {
      return replaceOrInsertRootDottedSetting(config, `features.${featureName}`, "true");
    }
    return appendBlock(config, `[features]
${featureName} = true
`);
  }
  return replaceOrInsertSetting(config, section, featureName, "true");
}

// packages/omo-codex/src/install/codex-config-marketplaces.ts
var SISYPHUS_LEGACY_MARKETPLACES = ["lazycodex", "code-yeongyu-codex-plugins"];
function legacyMarketplaceNames(marketplaceName) {
  return marketplaceName === "sisyphuslabs" ? SISYPHUS_LEGACY_MARKETPLACES : [];
}
function removeMarketplaceBlock(config, marketplaceName) {
  return removeTomlSections(config, (header) => header === `marketplaces.${marketplaceName}`);
}
function hasMarketplaceBlock(config, marketplaceName) {
  return findTomlSection(config, `marketplaces.${marketplaceName}`) !== null;
}
function removeStaleMarketplacePluginBlocks(config, marketplaceName, keepPluginNames) {
  return removeTomlSections(config, (header) => {
    const pluginKey = parsePluginHeaderKey(header);
    if (pluginKey === null)
      return false;
    const suffix = `@${marketplaceName}`;
    if (!pluginKey.endsWith(suffix))
      return false;
    return !keepPluginNames.has(pluginKey.slice(0, -suffix.length));
  });
}
function removeStaleMarketplaceHookStateBlocks(config, marketplaceName, keepPluginNames) {
  return removeTomlSections(config, (header) => {
    const hookKey = parseHookStateHeaderKey(header);
    if (hookKey === null)
      return false;
    const separator = hookKey.indexOf(":");
    if (separator === -1)
      return false;
    const pluginKey = hookKey.slice(0, separator);
    const suffix = `@${marketplaceName}`;
    if (!pluginKey.endsWith(suffix))
      return false;
    return !keepPluginNames.has(pluginKey.slice(0, -suffix.length));
  });
}
function ensureMarketplaceBlock(config, marketplaceName, source) {
  const header = `marketplaces.${marketplaceName}`;
  const lines = [
    `[${header}]`,
    `last_updated = "${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}"`,
    `source_type = ${JSON.stringify(source.sourceType)}`,
    `source = ${JSON.stringify(source.source)}`
  ];
  if (source.sourceType === "git") {
    lines.push(`ref = ${JSON.stringify(source.ref)}`);
  }
  lines.push("");
  const block = lines.join(`
`);
  const section = findTomlSection(config, header);
  if (section)
    return config.slice(0, section.start) + block + config.slice(section.end);
  return appendBlock(config, block);
}

// packages/omo-codex/src/install/codex-config-permissions.ts
var AUTONOMOUS_FEATURES = ["multi_agent", "unified_exec", "goals"];
function ensureAutonomousPermissions(config) {
  let next = replaceOrInsertRootSetting(config, "approval_policy", JSON.stringify("never"));
  next = replaceOrInsertRootSetting(next, "sandbox_mode", JSON.stringify("danger-full-access"));
  next = removeRootSetting(next, "network_access");
  for (const featureName of AUTONOMOUS_FEATURES) {
    next = ensureFeatureEnabled(next, featureName);
  }
  next = removeWindowsSandboxSetting(next);
  next = ensureNoticeEnabled(next, "hide_full_access_warning");
  return ensureNoticeEnabled(next, "hide_world_writable_warning");
}
function removeWindowsSandboxSetting(config) {
  const section = findTomlSection(config, "windows");
  if (section === null)
    return config;
  return removeSetting(config, section, "sandbox");
}
function ensureNoticeEnabled(config, key) {
  const section = findTomlSection(config, "notice");
  if (section === null)
    return appendNoticeBlock(config, key);
  return replaceOrInsertSetting(config, section, key, "true");
}
function appendNoticeBlock(config, key) {
  return appendBlock(config, `[notice]
${key} = true
`);
}

// packages/omo-codex/src/install/codex-config-plugins.ts
function ensurePluginEnabled(config, pluginKey) {
  const header = `plugins.${JSON.stringify(pluginKey)}`;
  const section = findTomlSection(config, header);
  if (!section)
    return appendBlock(config, `[${header}]
enabled = true
`);
  return replaceOrInsertSetting(config, section, "enabled", "true");
}
function ensureOmoBuiltinMcpPolicies(config, input) {
  if (input.marketplaceName !== "sisyphuslabs" || !input.pluginNames.includes("omo"))
    return config;
  const gitBashEnabled = (input.platform ?? process.platform) === "win32" && input.gitBashEnabled === true;
  let nextConfig = removeStaleContext7PlaceholderMcp(config);
  nextConfig = ensurePluginMcpEnabled(nextConfig, "omo@sisyphuslabs", "context7", true);
  nextConfig = ensurePluginMcpEnabled(nextConfig, "omo@sisyphuslabs", "git_bash", gitBashEnabled);
  return nextConfig;
}
function ensureHookTrusted(config, state) {
  const header = `hooks.state.${JSON.stringify(state.key)}`;
  const section = findTomlSection(config, header);
  if (!section)
    return appendBlock(config, `[${header}]
trusted_hash = ${JSON.stringify(state.trustedHash)}
`);
  return replaceOrInsertSetting(config, section, "trusted_hash", JSON.stringify(state.trustedHash));
}
function ensurePluginMcpEnabled(config, pluginKey, serverName, enabled) {
  const header = `plugins.${JSON.stringify(pluginKey)}.mcp_servers.${serverName}`;
  const section = findTomlSection(config, header);
  const enabledValue = enabled ? "true" : "false";
  if (!section)
    return appendBlock(config, `[${header}]
enabled = ${enabledValue}
`);
  return replaceOrInsertSetting(config, section, "enabled", enabledValue);
}
function removeStaleContext7PlaceholderMcp(config) {
  return removeTomlSections(config, (header, section) => header === "mcp_servers.context7" && isContext7PlaceholderSection(section.text));
}
function isContext7PlaceholderSection(sectionText) {
  const args = readStringArraySetting(sectionText, "args");
  if (args === null || !args.includes("@upstash/context7-mcp"))
    return false;
  const apiKey = valueAfter(args, "--api-key");
  return apiKey !== null && isPlaceholderApiKey(apiKey);
}
function valueAfter(values, key) {
  const index = values.indexOf(key);
  return index >= 0 ? values[index + 1] ?? null : null;
}
function isPlaceholderApiKey(value) {
  return /^your[-_ ]?api[-_ ]?key$/i.test(value);
}
function readStringArraySetting(sectionText, key) {
  for (const line of sectionText.split(`
`)) {
    if (!new RegExp(`^\\s*${key}\\s*=`).test(line))
      continue;
    const assignmentIndex = line.indexOf("=");
    if (assignmentIndex === -1)
      return null;
    return parseTomlStringArray(stripUnquotedInlineComment3(line.slice(assignmentIndex + 1)).trim());
  }
  return null;
}
function parseTomlStringArray(value) {
  if (!value.startsWith("[") || !value.endsWith("]"))
    return null;
  const items = [];
  let index = 1;
  while (index < value.length - 1) {
    const char = value[index];
    if (char === '"' || char === "'") {
      const parsed = parseTomlString(value, index);
      if (parsed === null)
        return null;
      items.push(parsed.value);
      index = parsed.nextIndex;
      continue;
    }
    index += 1;
  }
  return items;
}
function parseTomlString(input, startIndex) {
  const quote = input[startIndex];
  let value = "";
  let index = startIndex + 1;
  while (index < input.length) {
    const char = input[index];
    if (quote === '"' && char === "\\") {
      const next = input[index + 1];
      if (next === undefined)
        return null;
      value += next;
      index += 2;
      continue;
    }
    if (char === quote)
      return { value, nextIndex: index + 1 };
    value += char;
    index += 1;
  }
  return null;
}
function stripUnquotedInlineComment3(line) {
  let quote = null;
  let index = 0;
  while (index < line.length) {
    const char = line[index];
    if (quote === '"') {
      if (char === "\\") {
        index += 2;
        continue;
      }
      if (char === '"')
        quote = null;
      index += 1;
      continue;
    }
    if (quote === "'") {
      if (char === "'")
        quote = null;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      index += 1;
      continue;
    }
    if (char === "#")
      return line.slice(0, index);
    index += 1;
  }
  return line;
}

// packages/omo-codex/src/install/codex-config-reasoning.ts
var MANAGED_KEYS = ["model", "model_context_window", "model_reasoning_effort", "plan_mode_reasoning_effort"];
var CODEX_REASONING_BY_UNIFIED_LEVEL = {
  off: "none",
  none: "none",
  minimal: "minimal",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max"
};
function applyReasoningOverride(catalog, reasoning) {
  if (reasoning === undefined)
    return catalog;
  const wireEffort = CODEX_REASONING_BY_UNIFIED_LEVEL[reasoning.trim().toLowerCase()];
  if (wireEffort === undefined)
    return catalog;
  return { ...catalog, current: { ...catalog.current, modelReasoningEffort: wireEffort } };
}
function ensureCodexReasoningConfig(config, catalog) {
  const current = readRootReasoningSettings(config);
  if (Object.keys(current).length > 0 && !matchesProfile(current, catalog.current) && !catalog.managedProfiles.some((profile) => matchesProfile(current, profile))) {
    return config;
  }
  let next = replaceOrInsertRootSetting(config, "model", JSON.stringify(catalog.current.model));
  next = replaceOrInsertRootSetting(next, "model_context_window", catalog.current.modelContextWindow.toString());
  next = replaceOrInsertRootSetting(next, "model_reasoning_effort", JSON.stringify(catalog.current.modelReasoningEffort));
  next = replaceOrInsertRootSetting(next, "plan_mode_reasoning_effort", JSON.stringify(catalog.current.planModeReasoningEffort));
  return next;
}
function readRootReasoningSettings(config) {
  const settings = {};
  for (const line of config.split(/\n/)) {
    if (isSectionHeader(line))
      break;
    for (const key of MANAGED_KEYS) {
      if (!isRootSetting(line, key))
        continue;
      const value = parseTomlScalar(line.slice(line.indexOf("=") + 1));
      if (key === "model" && typeof value === "string")
        settings.model = value;
      if (key === "model_context_window" && typeof value === "number")
        settings.modelContextWindow = value;
      if (key === "model_reasoning_effort" && typeof value === "string")
        settings.modelReasoningEffort = value;
      if (key === "plan_mode_reasoning_effort" && typeof value === "string")
        settings.planModeReasoningEffort = value;
    }
  }
  return settings;
}
function matchesProfile(current, profile) {
  for (const [key, value] of Object.entries(profile)) {
    if (current[key] !== value)
      return false;
  }
  return true;
}
function parseTomlScalar(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      if (error instanceof SyntaxError)
        return;
      throw error;
    }
  }
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : undefined;
}
function isSectionHeader(line) {
  const trimmed = line.trim();
  return trimmed.startsWith("[") && trimmed.endsWith("]");
}
function isRootSetting(line, key) {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("#") || trimmed.startsWith("["))
    return false;
  const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/);
  return match?.[1] === key;
}

// packages/omo-codex/src/install/codex-model-catalog.ts
import { readFile as readFile10 } from "node:fs/promises";
import { join as join16 } from "node:path";
var FALLBACK_CODEX_MODEL_CATALOG = {
  current: {
    model: "gpt-6-astra",
    modelContextWindow: 600000,
    modelReasoningEffort: "high",
    planModeReasoningEffort: "xhigh"
  },
  managedProfiles: [
    {
      model: "gpt-5.5",
      modelContextWindow: 400000,
      modelReasoningEffort: "high",
      planModeReasoningEffort: "xhigh"
    },
    {
      model: "gpt-5.5",
      modelContextWindow: 1e6,
      modelReasoningEffort: "high",
      planModeReasoningEffort: "xhigh"
    },
    { model: "gpt-5.5", modelContextWindow: 272000 },
    {
      model: "gpt-5.6-sol",
      modelContextWindow: 650000,
      modelReasoningEffort: "high",
      planModeReasoningEffort: "xhigh"
    }
  ]
};
async function readCodexModelCatalog(codexPackageRoot) {
  const catalogPath = join16(codexPackageRoot, "plugin", "model-catalog.json");
  try {
    const parsed = JSON.parse(await readFile10(catalogPath, "utf8"));
    return parseCodexModelCatalog(parsed) ?? FALLBACK_CODEX_MODEL_CATALOG;
  } catch (error) {
    if (error instanceof Error)
      return FALLBACK_CODEX_MODEL_CATALOG;
    throw error;
  }
}
function parseCodexModelCatalog(value) {
  if (!isPlainRecord(value))
    return null;
  const current = value["current"];
  const managedProfiles = value["managedProfiles"];
  if (!isPlainRecord(current) || !Array.isArray(managedProfiles))
    return null;
  const model = current["model"];
  const modelContextWindow = current["model_context_window"];
  const modelReasoningEffort = current["model_reasoning_effort"];
  const planModeReasoningEffort = current["plan_mode_reasoning_effort"];
  if (typeof model !== "string" || typeof modelContextWindow !== "number" || typeof modelReasoningEffort !== "string" || typeof planModeReasoningEffort !== "string") {
    return null;
  }
  const parsedManagedProfiles = [];
  for (const profile of managedProfiles) {
    if (!isPlainRecord(profile))
      return null;
    const match = profile["match"];
    if (!isPlainRecord(match))
      return null;
    parsedManagedProfiles.push(parseProfileMatch(match));
  }
  return {
    current: { model, modelContextWindow, modelReasoningEffort, planModeReasoningEffort },
    managedProfiles: parsedManagedProfiles
  };
}
function parseProfileMatch(match) {
  const profile = {};
  if (typeof match["model"] === "string")
    profile.model = match["model"];
  if (typeof match["model_context_window"] === "number")
    profile.modelContextWindow = match["model_context_window"];
  if (typeof match["model_reasoning_effort"] === "string")
    profile.modelReasoningEffort = match["model_reasoning_effort"];
  if (typeof match["plan_mode_reasoning_effort"] === "string")
    profile.planModeReasoningEffort = match["plan_mode_reasoning_effort"];
  return profile;
}

// packages/omo-codex/src/install/codex-multi-agent-mode-config.ts
var CODEX_MULTI_AGENT_MODE_KEY = "multi_agent_mode";
function removeUnsupportedCodexMultiAgentModeConfig(config) {
  const lines = config.split(/\n/);
  const output = [];
  let inRoot = true;
  let changed = false;
  for (const line of lines) {
    const sectionHeader = isSectionHeader2(line);
    if (inRoot && isRootSetting2(line, CODEX_MULTI_AGENT_MODE_KEY)) {
      changed = true;
      continue;
    }
    output.push(line);
    if (sectionHeader)
      inRoot = false;
  }
  return changed ? output.join(`
`) : config;
}
function isSectionHeader2(line) {
  return isTomlTableHeaderLine(line);
}
function isRootSetting2(line, key) {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("#") || trimmed.startsWith("["))
    return false;
  const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/);
  return match?.[1] === key;
}

// packages/omo-codex/src/install/codex-multi-agent-v2-config.ts
import { readFileSync as readFileSync2 } from "node:fs";
import { dirname as dirname7, isAbsolute as isAbsolute6, join as join17 } from "node:path";
var CODEX_AGENTS_HEADER = "agents";
var CODEX_MULTI_AGENT_V2_HEADER = "features.multi_agent_v2";
function ensureCodexMultiAgentV2Config(config, options = {}) {
  const featureFlag = removeFeatureFlagSetting(config, "multi_agent_v2");
  const v2Preferred = options.multiAgentVersion === "v2" || isMultiAgentV2Enabled(featureFlag.config);
  const agentsConfig = removeAgentsMaxThreads(featureFlag.config, v2Preferred);
  const preserveDisable = featureFlag.value === false && !v2Preferred;
  const featureConfig = preserveDisable ? setMultiAgentV2Disable(agentsConfig) : v2Preferred ? removeMultiAgentV2Disable(agentsConfig) : agentsConfig;
  const withoutManagedLimit = removeManagedMultiAgentV2ThreadLimit(featureConfig);
  if (preserveDisable && !findTomlSection(withoutManagedLimit, CODEX_MULTI_AGENT_V2_HEADER)) {
    return appendBlock(withoutManagedLimit, `[${CODEX_MULTI_AGENT_V2_HEADER}]
enabled = false`);
  }
  return withoutManagedLimit;
}
function resolveCodexMultiAgentVersion(config, configPath) {
  const model = readRootModel(config);
  if (model === null)
    return null;
  const catalogPath = resolveCatalogPath(readRootModelCatalogPath(config), configPath);
  const catalogVersion = readCatalogMultiAgentVersion(model, catalogPath);
  if (catalogVersion !== null)
    return catalogVersion;
  return /^(?:gpt-5\.6|gpt-6)\b/i.test(model) ? "v2" : null;
}
function resolveCatalogPath(configuredPath, configPath) {
  if (configuredPath === null)
    return join17(dirname7(configPath), "models_cache.json");
  return isAbsolute6(configuredPath) ? configuredPath : join17(dirname7(configPath), configuredPath);
}
function readCatalogMultiAgentVersion(model, cachePath) {
  let raw;
  try {
    raw = readFileSync2(cachePath, "utf8");
  } catch {
    return null;
  }
  let cache;
  try {
    cache = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord7(cache) || !Array.isArray(cache.models))
    return null;
  for (const entry of cache.models) {
    if (!isRecord7(entry))
      continue;
    if (entry.slug !== model && entry.id !== model)
      continue;
    const version = entry.multi_agent_version;
    if (version === "v1" || version === "v2")
      return version;
    return null;
  }
  return null;
}
function readRootModel(config) {
  const double = config.match(/^\s*model\s*=\s*"([^"]+)"/m);
  if (double !== null)
    return double[1] ?? null;
  const single = config.match(/^\s*model\s*=\s*'([^']+)'/m);
  return single?.[1] ?? null;
}
function readRootModelCatalogPath(config) {
  const double = config.match(/^\s*model_catalog_json\s*=\s*"([^"]+)"/m);
  if (double !== null)
    return double[1] ?? null;
  const single = config.match(/^\s*model_catalog_json\s*=\s*'([^']+)'/m);
  return single?.[1] ?? null;
}
function isRecord7(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function removeFeatureFlagSetting(config, featureName) {
  const section = findTomlSection(config, "features");
  if (!section)
    return { config, value: null };
  return {
    config: removeSetting(config, section, featureName),
    value: readBooleanSetting(section.text, featureName)
  };
}
function isMultiAgentV2Enabled(config) {
  const section = findTomlSection(config, CODEX_MULTI_AGENT_V2_HEADER);
  return section !== null && /^\s*enabled\s*=\s*true[ \t]*(?:#.*)?$/m.test(section.text);
}
function removeAgentsMaxThreads(config, v2Preferred) {
  const section = findTomlSection(config, CODEX_AGENTS_HEADER);
  if (!section)
    return config;
  return removeMatchingCap(config, section, "max_threads", v2Preferred ? undefined : /^1000\s*(?:#.*)?$/);
}
function removeManagedMultiAgentV2ThreadLimit(config) {
  const section = findTomlSection(config, CODEX_MULTI_AGENT_V2_HEADER);
  if (!section)
    return config;
  return removeMatchingCap(config, section, "max_concurrent_threads_per_session", /^(?:1000|16)\s*(?:#.*)?$/);
}
function removeMatchingCap(config, section, keyName, expectedValue) {
  let quote = null;
  let offset = section.start;
  for (const line of section.text.match(/[^\n]*\n?/g) ?? []) {
    const scan = scanTomlMultilineLine(line, quote);
    quote = scan.nextQuote;
    if (!scan.wasInside) {
      const assignment = line.indexOf("=");
      const key = assignment < 0 ? null : parseTomlDottedKey(line.slice(0, assignment).trim());
      if (key?.length === 1 && key[0] === keyName && (expectedValue === undefined || expectedValue.test(line.slice(assignment + 1).trim()))) {
        return config.slice(0, offset) + config.slice(offset + line.length);
      }
    }
    offset += line.length;
  }
  return config;
}
function removeMultiAgentV2Disable(config) {
  const section = findTomlSection(config, CODEX_MULTI_AGENT_V2_HEADER);
  if (!section)
    return config;
  if (!/^\s*enabled\s*=\s*false(?:\s*#.*)?$/m.test(section.text))
    return config;
  return removeSetting(config, section, "enabled");
}
function setMultiAgentV2Disable(config) {
  const section = findTomlSection(config, CODEX_MULTI_AGENT_V2_HEADER);
  if (!section)
    return config;
  return replaceOrInsertSetting(config, section, "enabled", "false");
}
function readBooleanSetting(sectionText, key) {
  const match = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*(true|false)\\s*(?:#.*)?$`, "m").exec(sectionText);
  if (!match)
    return null;
  return match[1] === "true";
}

// packages/omo-codex/src/install/codex-config-toml.ts
async function updateCodexConfig(input) {
  await mkdir5(dirname8(input.configPath), { recursive: true });
  let config;
  try {
    config = await readFile11(input.configPath, "utf8");
  } catch (error) {
    if (!isMissingFileError(error))
      throw error;
    config = "";
  }
  const pluginSet = new Set(input.pluginNames);
  for (const legacyMarketplaceName of legacyMarketplaceNames(input.marketplaceName)) {
    config = removeMarketplaceBlock(config, legacyMarketplaceName);
    config = removeStaleMarketplacePluginBlocks(config, legacyMarketplaceName, new Set);
    config = removeStaleMarketplaceHookStateBlocks(config, legacyMarketplaceName, new Set);
  }
  config = removeStaleMarketplacePluginBlocks(config, input.marketplaceName, pluginSet);
  config = removeStaleMarketplaceHookStateBlocks(config, input.marketplaceName, pluginSet);
  config = removeStaleManagedAgentBlocks(config, new Set((input.agentConfigs ?? []).map((agentConfig) => agentConfig.name)));
  config = ensureFeatureEnabled(config, "plugins");
  config = ensureFeatureEnabled(config, "plugin_hooks");
  config = ensureFeatureEnabled(config, "multi_agent");
  config = removeUnsupportedCodexMultiAgentModeConfig(config);
  config = ensureCodexReasoningConfig(config, applyReasoningOverride(await readCodexModelCatalog(input.repoRoot), input.reasoning));
  config = ensureCodexMultiAgentV2Config(config, {
    multiAgentVersion: resolveCodexMultiAgentVersion(config, input.configPath)
  });
  if (input.autonomousPermissions === true)
    config = ensureAutonomousPermissions(config);
  if (!(input.preserveMarketplaceSource === true && hasMarketplaceBlock(config, input.marketplaceName))) {
    config = ensureMarketplaceBlock(config, input.marketplaceName, input.marketplaceSource);
  }
  for (const pluginName of input.pluginNames) {
    config = ensurePluginEnabled(config, `${pluginName}@${input.marketplaceName}`);
  }
  config = ensureOmoBuiltinMcpPolicies(config, input);
  for (const state of input.trustedHookStates ?? []) {
    config = ensureHookTrusted(config, state);
  }
  for (const agentConfig of input.agentConfigs ?? []) {
    config = ensureAgentConfig(config, agentConfig);
  }
  await writeFileAtomic(input.configPath, `${config.trimEnd()}
`);
}
function isMissingFileError(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

// packages/omo-codex/src/install/codex-hook-trust.ts
import { createHash } from "node:crypto";
import { readFile as readFile12 } from "node:fs/promises";
import { join as join18 } from "node:path";
var EVENT_LABELS = new Map([
  ["PreToolUse", "pre_tool_use"],
  ["PermissionRequest", "permission_request"],
  ["PostToolUse", "post_tool_use"],
  ["PreCompact", "pre_compact"],
  ["PostCompact", "post_compact"],
  ["SessionStart", "session_start"],
  ["UserPromptSubmit", "user_prompt_submit"],
  ["SubagentStart", "subagent_start"],
  ["SubagentStop", "subagent_stop"],
  ["Stop", "stop"]
]);
async function trustedHookStatesForPlugin(input) {
  const manifestPath = join18(input.pluginRoot, ".codex-plugin", "plugin.json");
  if (!await exists(manifestPath))
    return [];
  const manifest = JSON.parse(await readFile12(manifestPath, "utf8"));
  if (!isPlainRecord(manifest))
    return [];
  const states = [];
  for (const hookPath of hookManifestPaths2(manifest.hooks)) {
    const hooksPath = join18(input.pluginRoot, hookPath);
    if (!await exists(hooksPath))
      continue;
    const parsed = JSON.parse(await readFile12(hooksPath, "utf8"));
    if (!isPlainRecord(parsed) || !isPlainRecord(parsed.hooks))
      continue;
    states.push(...trustedHookStatesForHooksFile({
      keySource: `${input.pluginName}@${input.marketplaceName}:${hookPath}`,
      hooks: parsed.hooks,
      platform: input.platform ?? process.platform
    }));
  }
  return states;
}
function hookManifestPaths2(value) {
  if (typeof value === "string" && value.trim() !== "")
    return [stripDotSlash2(value)];
  if (!Array.isArray(value))
    return [];
  return value.filter((item) => typeof item === "string" && item.trim() !== "").map(stripDotSlash2);
}
function trustedHookStatesForHooksFile(input) {
  const states = [];
  for (const [eventName, groups] of Object.entries(input.hooks)) {
    if (!Array.isArray(groups))
      continue;
    const eventLabel = EVENT_LABELS.get(eventName);
    if (eventLabel === undefined)
      continue;
    for (const [groupIndex, group] of groups.entries()) {
      if (!isPlainRecord(group) || !Array.isArray(group.hooks))
        continue;
      for (const [handlerIndex, handler] of group.hooks.entries()) {
        if (!isPlainRecord(handler) || handler.type !== "command")
          continue;
        if (handler.async === true)
          continue;
        const command = commandForPlatform(handler, input.platform);
        if (command === undefined || command.trim() === "")
          continue;
        const key = `${input.keySource}:${eventLabel}:${groupIndex}:${handlerIndex}`;
        states.push({ key, trustedHash: commandHookHash(eventLabel, group.matcher, handler, command) });
      }
    }
  }
  return states;
}
function commandForPlatform(handler, platform) {
  if (typeof handler.command !== "string")
    return;
  if (platform === "win32" && typeof handler.commandWindows === "string")
    return handler.commandWindows;
  return handler.command;
}
function commandHookHash(eventName, matcher, handler, command) {
  const timeout = Math.max(Number(handler.timeout ?? 600), 1);
  const normalizedHandler = {
    type: "command",
    command,
    timeout,
    async: false
  };
  if (typeof handler.statusMessage === "string")
    normalizedHandler.statusMessage = handler.statusMessage;
  const identity = { event_name: eventName, hooks: [normalizedHandler] };
  if (typeof matcher === "string")
    identity.matcher = matcher;
  const canonical = JSON.stringify(canonicalJson(identity));
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}
function canonicalJson(value) {
  if (Array.isArray(value))
    return value.map(canonicalJson);
  if (!isPlainRecord(value))
    return value;
  const result = {};
  for (const key of Object.keys(value).sort()) {
    result[key] = canonicalJson(value[key]);
  }
  return result;
}
function stripDotSlash2(value) {
  return value.startsWith("./") ? value.slice(2) : value;
}
async function exists(path) {
  try {
    await readFile12(path, "utf8");
    return true;
  } catch (error) {
    if (error instanceof Error)
      return false;
    return false;
  }
}

// packages/omo-codex/src/install/git-bash.ts
var resolveGitBashForCurrentProcess2 = (input = {}) => {
  return toCodexResolution(resolveGitBashForCurrentProcess(input));
};
async function prepareGitBashForInstall(input) {
  const resolve = input.resolveGitBash ?? (() => resolveGitBashForCurrentProcess2({ platform: input.platform, env: input.env }));
  const initialResolution = resolve();
  return initialResolution;
}
function toCodexResolution(resolution) {
  if (resolution.found) {
    return {
      found: true,
      path: resolution.path,
      source: resolution.source
    };
  }
  return {
    ...resolution,
    installHint: [
      "Git Bash is required for native Windows Codex profile installs.",
      "Install it with: winget install --id Git.Git -e --source winget",
      `For a custom install, set ${GIT_BASH_ENV_KEY}=C:\\path\\to\\bash.exe`,
      "Then rerun `npx lazycodex-ai install`."
    ].join(`
`)
  };
}

// packages/omo-codex/src/install/link-cached-plugin-agents.ts
import { copyFile, lstat as lstat10, mkdir as mkdir6, readdir as readdir7, rm as rm9, writeFile as writeFile7 } from "node:fs/promises";
import { basename as basename4, join as join22 } from "node:path";

// packages/omo-codex/src/install/preserved-agent-settings.ts
import { lstat as lstat7, readFile as readFile13, readdir as readdir6, writeFile as writeFile6 } from "node:fs/promises";
import { join as join19 } from "node:path";

// packages/omo-codex/src/install/managed-agent-reasoning-defaults.ts
var MANAGED_REASONING_DEFAULT_UPGRADES = new Map([
  [
    "explorer",
    [
      {
        previous: { model: "gpt-5.6-luna-fast", effort: "low" },
        current: { model: "gpt-5.6-terra", effort: "medium" }
      },
      {
        previous: { model: "gpt-5.6-terra", effort: "medium" },
        current: { model: "gpt-5.6-luna", effort: "low" }
      },
      {
        previous: { model: "gpt-5.6-luna", effort: "low" },
        current: { model: "gpt-6-astra", effort: "low" }
      }
    ]
  ],
  [
    "librarian",
    [
      {
        previous: { model: "gpt-5.6-luna-fast", effort: "low" },
        current: { model: "gpt-5.6-terra", effort: "medium" }
      },
      {
        previous: { model: "gpt-5.6-terra", effort: "medium" },
        current: { model: "gpt-5.6-luna", effort: "low" }
      },
      {
        previous: { model: "gpt-5.6-luna", effort: "low" },
        current: { model: "gpt-6-astra", effort: "low" }
      }
    ]
  ],
  [
    "metis",
    [
      {
        previous: { model: "gpt-5.6-sol", effort: "high" },
        current: { model: "gpt-6-astra", effort: "high" }
      }
    ]
  ],
  [
    "lazycodex-worker-low",
    [
      {
        previous: { model: "gpt-5.6-luna", effort: "high" },
        current: { model: "gpt-6-astra", effort: "high" }
      }
    ]
  ],
  [
    "momus",
    [
      {
        previous: { model: "gpt-5.5", effort: "xhigh" },
        current: { model: "gpt-5.6-sol", effort: "ultra" }
      },
      {
        previous: { model: "gpt-5.6-sol", effort: "ultra" },
        current: { model: "gpt-5.6-terra", effort: "high" }
      },
      {
        previous: { model: "gpt-5.6-terra", effort: "high" },
        current: { model: "gpt-6-astra", effort: "high" }
      }
    ]
  ],
  [
    "plan",
    [
      {
        previous: { model: "gpt-5.6-sol", effort: "xhigh" },
        current: { model: "gpt-5.6-sol", effort: "max" }
      },
      {
        previous: { model: "gpt-5.6-sol", effort: "max" },
        current: { model: "gpt-5.6-sol", effort: "high" }
      },
      {
        previous: { model: "gpt-5.6-sol", effort: "high" },
        current: { model: "gpt-6-astra", effort: "high" }
      }
    ]
  ],
  [
    "lazycodex-worker-medium",
    [
      {
        previous: { model: "gpt-5.6-sol", effort: "high" },
        current: { model: "gpt-5.6-luna", effort: "max" }
      },
      {
        previous: { model: "gpt-5.6-luna", effort: "max" },
        current: { model: "gpt-5.6-terra", effort: "high" }
      },
      {
        previous: { model: "gpt-5.6-terra", effort: "high" },
        current: { model: "gpt-6-astra", effort: "high" }
      }
    ]
  ],
  [
    "lazycodex-worker-high",
    [
      {
        previous: { model: "gpt-5.6-sol", effort: "max" },
        current: { model: "gpt-5.6-sol", effort: "medium" }
      },
      {
        previous: { model: "gpt-5.6-sol", effort: "medium" },
        current: { model: "gpt-6-astra", effort: "medium" }
      }
    ]
  ],
  [
    "lazycodex-code-reviewer",
    [
      {
        previous: { model: "gpt-5.6-sol", effort: "xhigh" },
        current: { model: "gpt-5.6-terra", effort: "medium" }
      },
      {
        previous: { model: "gpt-5.6-terra", effort: "medium" },
        current: { model: "gpt-6-astra", effort: "medium" }
      }
    ]
  ],
  [
    "lazycodex-clone-fidelity-reviewer",
    [
      {
        previous: { model: "gpt-5.6-sol", effort: "xhigh" },
        current: { model: "gpt-5.6-terra", effort: "high" }
      },
      {
        previous: { model: "gpt-5.6-terra", effort: "high" },
        current: { model: "gpt-6-astra", effort: "high" }
      }
    ]
  ],
  [
    "lazycodex-qa-executor",
    [
      {
        previous: { model: "gpt-5.6-terra", effort: "medium" },
        current: { model: "gpt-5.6-luna", effort: "high" }
      },
      {
        previous: { model: "gpt-5.6-luna", effort: "high" },
        current: { model: "gpt-6-astra", effort: "high" }
      }
    ]
  ],
  [
    "lazycodex-gate-reviewer",
    [
      {
        previous: { model: "gpt-5.6-sol", effort: "xhigh" },
        current: { model: "gpt-5.6-sol", effort: "high" }
      },
      {
        previous: { model: "gpt-5.6-sol", effort: "high" },
        current: { model: "gpt-5.6-sol", effort: "low" }
      },
      {
        previous: { model: "gpt-5.6-sol", effort: "low" },
        current: { model: "gpt-6-astra", effort: "low" }
      }
    ]
  ]
]);
function resolveManagedAgentReasoning(input) {
  const steps = MANAGED_REASONING_DEFAULT_UPGRADES.get(input.agentName);
  if (steps === undefined)
    return input.preserved.effort;
  const latest = steps[steps.length - 1];
  if (latest === undefined)
    return input.preserved.effort;
  const bundledMatchesCurrentEffort = input.bundledEffort === latest.current.effort && steps.some((step) => input.bundledModel === step.current.model && input.bundledEffort === step.current.effort);
  if (!bundledMatchesCurrentEffort)
    return input.preserved.effort;
  const preservedMatchesAnyStep = steps.some((step) => input.preserved.model === step.previous.model && input.preserved.effort === step.previous.effort);
  return preservedMatchesAnyStep ? latest.current.effort : input.preserved.effort;
}

// packages/omo-codex/src/install/preserved-agent-settings.ts
async function capturePreservedAgentReasoning(input) {
  const agentsDir = join19(input.codexHome, "agents");
  if (!await exists2(agentsDir))
    return new Map;
  const preserved = new Map;
  const agentEntries = await readdir6(agentsDir, { withFileTypes: true });
  for (const entry of agentEntries) {
    if (!entry.name.endsWith(".toml"))
      continue;
    const content = await readTextIfExists(join19(agentsDir, entry.name));
    if (content === null)
      continue;
    const effort = extractReasoningEffort(content);
    if (effort !== null) {
      preserved.set(agentNameFromToml(entry.name), {
        model: extractModel(content),
        effort
      });
    }
  }
  return preserved;
}
async function capturePreservedAgentServiceTier(input) {
  const agentsDir = join19(input.codexHome, "agents");
  if (!await exists2(agentsDir))
    return new Map;
  const preserved = new Map;
  const agentEntries = await readdir6(agentsDir, { withFileTypes: true });
  for (const entry of agentEntries) {
    if (!entry.name.endsWith(".toml"))
      continue;
    const content = await readTextIfExists(join19(agentsDir, entry.name));
    if (content === null)
      continue;
    preserved.set(agentNameFromToml(entry.name), extractServiceTier(content));
  }
  return preserved;
}
async function restorePreservedReasoning(input) {
  if (input.value === undefined)
    return;
  const content = await readFile13(input.target, "utf8");
  const bundledEffort = extractReasoningEffort(content);
  const effort = resolveManagedAgentReasoning({
    agentName: input.agentName,
    bundledModel: extractModel(content),
    bundledEffort,
    preserved: input.value
  });
  if (bundledEffort === effort)
    return;
  const replacement = replaceTopLevelStringSetting(content, "model_reasoning_effort", effort, { insertIfMissing: false });
  if (!replacement.replaced)
    return;
  await writeFile6(input.linkPath, replacement.content);
}
async function restorePreservedServiceTier(input) {
  if (!input.preserved)
    return;
  const content = await readFile13(input.linkPath, "utf8");
  if (extractServiceTier(content) === input.value)
    return;
  const replacement = replaceTopLevelStringSetting(content, "service_tier", input.value, { insertIfMissing: true });
  if (!replacement.replaced)
    return;
  await writeFile6(input.linkPath, replacement.content);
}
async function readTextIfExists(path) {
  try {
    return await readFile13(path, "utf8");
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT")
      return null;
    throw error;
  }
}
function extractModel(content) {
  return extractTopLevelStringSetting(content, "model");
}
function extractReasoningEffort(content) {
  return extractTopLevelStringSetting(content, "model_reasoning_effort");
}
function extractServiceTier(content) {
  return extractTopLevelStringSetting(content, "service_tier");
}
function extractTopLevelStringSetting(content, key) {
  for (const line of content.split(/\n/)) {
    if (isSectionHeader3(line))
      return null;
    const rawValue = topLevelStringSettingRawValue(line, key);
    if (rawValue === undefined)
      continue;
    const parsed = parseJsonString(rawValue);
    if (parsed !== null)
      return parsed;
  }
  return null;
}
function replaceTopLevelStringSetting(content, key, value, options) {
  const lines = content.split(/\n/);
  for (let index = 0;index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined || isSectionHeader3(line))
      break;
    if (topLevelStringSettingRawValue(line, key) === undefined)
      continue;
    if (value === null) {
      lines.splice(index, 1);
      return { content: lines.join(`
`), replaced: true };
    }
    lines[index] = line.replace(/=\s*"(?:[^"\\]|\\.)*"/, `= ${JSON.stringify(value)}`);
    return { content: lines.join(`
`), replaced: true };
  }
  if (value === null || !options.insertIfMissing)
    return { content, replaced: false };
  lines.splice(topLevelInsertionIndex(lines), 0, `${key} = ${JSON.stringify(value)}`);
  return { content: lines.join(`
`), replaced: true };
}
function topLevelStringSettingRawValue(line, key) {
  const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*("(?:[^"\\]|\\.)*")/);
  if (match === null)
    return;
  const settingKey = match[1];
  const rawValue = match[2];
  if (settingKey !== key || rawValue === undefined)
    return;
  return rawValue;
}
function topLevelInsertionIndex(lines) {
  const sectionIndex = lines.findIndex((line) => isSectionHeader3(line));
  const topLevelEnd = sectionIndex === -1 ? lines.length : sectionIndex;
  let insertionIndex = topLevelEnd;
  while (insertionIndex > 0 && lines[insertionIndex - 1] === "") {
    insertionIndex -= 1;
  }
  return insertionIndex;
}
function isSectionHeader3(line) {
  const trimmed = line.trim();
  return trimmed.startsWith("[") && trimmed.endsWith("]");
}
function agentNameFromToml(fileName) {
  return fileName.endsWith(".toml") ? fileName.slice(0, -".toml".length) : fileName;
}
async function exists2(path) {
  try {
    await lstat7(path);
    return true;
  } catch (error) {
    if (nodeErrorCode(error) !== "ENOENT")
      throw error;
    return false;
  }
}
function nodeErrorCode(error) {
  if (!(error instanceof Error) || !("code" in error))
    return null;
  return typeof error.code === "string" ? error.code : null;
}

// packages/omo-codex/src/install/retired-managed-agent-purge.ts
import { lstat as lstat8, readFile as readFile14, rm as rm7 } from "node:fs/promises";
import { join as join20 } from "node:path";
var RETIRED_MANAGED_AGENT_FILES = [
  {
    fileName: "codex-ultrawork-reviewer.toml",
    requiredMarkers: [
      'name = "codex-ultrawork-reviewer"',
      'description = "Strict ultrawork verification reviewer.',
      'developer_instructions = """You are the ultrawork verification reviewer.'
    ]
  }
];
async function purgeRetiredManagedAgentFiles(input) {
  const agentsDir = join20(input.codexHome, "agents");
  if (!await exists3(agentsDir))
    return;
  for (const retiredAgent of RETIRED_MANAGED_AGENT_FILES) {
    const agentPath = join20(agentsDir, retiredAgent.fileName);
    if (!await exists3(agentPath))
      continue;
    const agentStat = await lstat8(agentPath);
    if (agentStat.isDirectory() && !agentStat.isSymbolicLink())
      continue;
    const content = await readTextIfExists2(agentPath);
    if (content === null || !hasRequiredMarkers(content, retiredAgent.requiredMarkers))
      continue;
    await rm7(agentPath, { force: true });
  }
}
function hasRequiredMarkers(content, markers) {
  return markers.every((marker) => content.includes(marker));
}
async function readTextIfExists2(path) {
  try {
    return await readFile14(path, "utf8");
  } catch (error) {
    if (nodeErrorCode2(error) === "ENOENT")
      return null;
    throw error;
  }
}
async function exists3(path) {
  try {
    await lstat8(path);
    return true;
  } catch (error) {
    if (nodeErrorCode2(error) !== "ENOENT")
      throw error;
    return false;
  }
}
function nodeErrorCode2(error) {
  if (!(error instanceof Error) || !("code" in error))
    return null;
  return typeof error.code === "string" ? error.code : null;
}

// packages/omo-codex/src/install/default-agent-role.ts
import { createHash as createHash2 } from "node:crypto";
import { lstat as lstat9, readFile as readFile15, rm as rm8 } from "node:fs/promises";
import { join as join21 } from "node:path";
var REGISTRATION = { name: "default", configFile: "./agents/default.toml" };
async function installDefaultAgentRole(input) {
  const target = join21(input.codexHome, "agents", "default.toml");
  const receipt = join21(input.codexHome, "agents", ".lazycodex-default.sha256");
  const configPath = join21(input.codexHome, "config.toml");
  const config = await readIfPresent(configPath);
  const entry = await lstat9(target).catch((error) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return null;
    throw error;
  });
  if (entry !== null && !entry.isFile()) {
    if (!input.enabled)
      return null;
    throw new Error("Preserved user-owned agents/default.toml: refusing to replace a symlink or directory");
  }
  const existing = await readIfPresent(target);
  const digest = await readIfPresent(receipt);
  const owned = existing !== null && digest === hash(existing);
  const foreign = hasForeignAgentRegistration(config ?? "", REGISTRATION);
  if (!input.enabled) {
    if (owned) {
      if (!foreign && config !== null) {
        const next = splitTomlSections(config).filter((section) => section.header === null || parseAgentHeaderName(section.header) !== "default").map((section) => section.text).join("");
        if (next !== config)
          await writeFileAtomic(configPath, next);
      }
      await rm8(target);
      await rm8(receipt);
    }
    return null;
  }
  if (foreign || existing !== null && !owned) {
    throw new Error("Preserved user-owned agents.default / agents/default.toml. Move it aside to install the LazyCodex fallback, or set [codex].agents.default.disable = true in omo.jsonc. Explicit LazyCodex roles remain required.");
  }
  const worker = await readFile15(input.worker.path, "utf8");
  const content = worker.replace(/^name\s*=\s*["']lazycodex-worker-medium["']\s*$/m, 'name = "default"');
  if (content === worker)
    throw new Error("Cannot derive default: medium worker has no matching internal name");
  await writeFileAtomic(target, content);
  await writeFileAtomic(receipt, hash(content));
  return { name: "default.toml", path: target, target: input.worker.target };
}
async function readIfPresent(path) {
  try {
    return await readFile15(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return null;
    throw error;
  }
}
function hash(content) {
  return createHash2("sha256").update(content).digest("hex");
}

// packages/omo-codex/src/install/link-cached-plugin-agents.ts
var MANIFEST_FILE = ".installed-agents.json";
async function linkCachedPluginAgents(input) {
  const bundledAgents = await discoverBundledAgents(input.pluginRoot);
  await purgeRetiredManagedAgentFiles({ codexHome: input.codexHome });
  if (bundledAgents.length === 0) {
    await writeManifest(input.pluginRoot, []);
    return [];
  }
  const agentsDir = join22(input.codexHome, "agents");
  await mkdir6(agentsDir, { recursive: true });
  const linked = [];
  for (const agentPath of bundledAgents) {
    const agentFileName = basename4(agentPath);
    const agentName = agentNameFromToml2(agentFileName);
    const linkPath = join22(agentsDir, agentFileName);
    await replaceWithCopy(linkPath, agentPath);
    await restorePreservedReasoning({
      agentName,
      linkPath,
      target: agentPath,
      value: input.preservedReasoning?.get(agentName)
    });
    await restorePreservedServiceTier({
      linkPath,
      preserved: input.preservedServiceTier?.has(agentName) ?? false,
      value: input.preservedServiceTier?.get(agentName) ?? null
    });
    linked.push({ name: agentFileName, path: linkPath, target: agentPath });
  }
  const worker = linked.find((entry) => entry.name === "lazycodex-worker-medium.toml");
  if (worker !== undefined) {
    const fallback = await installDefaultAgentRole({ codexHome: input.codexHome, worker, enabled: input.defaultRoleEnabled !== false });
    if (fallback !== null)
      linked.push(fallback);
  }
  await writeManifest(input.pluginRoot, linked.map((entry) => entry.path));
  return linked;
}
async function discoverBundledAgents(pluginRoot) {
  const componentsRoot = join22(pluginRoot, "components");
  if (!await exists4(componentsRoot))
    return [];
  const componentEntries = await readdir7(componentsRoot, { withFileTypes: true });
  const agents = [];
  for (const entry of componentEntries) {
    if (!entry.isDirectory())
      continue;
    const agentsRoot = join22(componentsRoot, entry.name, "agents");
    if (!await exists4(agentsRoot))
      continue;
    const agentEntries = await readdir7(agentsRoot, { withFileTypes: true });
    for (const file of agentEntries) {
      if (!file.isFile() || !file.name.endsWith(".toml"))
        continue;
      agents.push(join22(agentsRoot, file.name));
    }
  }
  agents.sort();
  return agents;
}
async function replaceWithCopy(linkPath, target) {
  await prepareReplacement(linkPath);
  await copyFile(target, linkPath);
}
async function prepareReplacement(linkPath) {
  if (!await exists4(linkPath))
    return;
  const entryStat = await lstat10(linkPath);
  if (entryStat.isDirectory() && !entryStat.isSymbolicLink()) {
    throw new Error(`${linkPath} already exists and is a directory; refusing to replace`);
  }
  await rm9(linkPath, { force: true });
}
async function writeManifest(pluginRoot, agentPaths) {
  const manifestPath = join22(pluginRoot, MANIFEST_FILE);
  const payload = { agents: [...agentPaths].sort() };
  await writeFile7(manifestPath, `${JSON.stringify(payload, null, "\t")}
`);
}
function agentNameFromToml2(fileName) {
  return fileName.endsWith(".toml") ? fileName.slice(0, -".toml".length) : fileName;
}
async function exists4(path) {
  try {
    await lstat10(path);
    return true;
  } catch (error) {
    if (nodeErrorCode3(error) !== "ENOENT")
      throw error;
    return false;
  }
}
function nodeErrorCode3(error) {
  if (!(error instanceof Error) || !("code" in error))
    return null;
  return typeof error.code === "string" ? error.code : null;
}

// packages/omo-codex/src/install/codex-marketplace.ts
import { readFile as readFile16 } from "node:fs/promises";
import { join as join23 } from "node:path";
var DEFAULT_MARKETPLACE_PATH = "packages/omo-codex/marketplace.json";
async function readMarketplace(repoRoot, options) {
  const marketplacePath = options?.marketplacePath ?? join23(repoRoot, DEFAULT_MARKETPLACE_PATH);
  const raw = await readFile16(marketplacePath, "utf8");
  const parsed = JSON.parse(raw);
  if (!isPlainRecord(parsed))
    throw new Error("marketplace.json must be an object");
  if (typeof parsed.name !== "string" || parsed.name.trim() === "") {
    throw new Error("marketplace.json name must be a non-empty string");
  }
  validatePathSegment(parsed.name, "marketplace name");
  if (!Array.isArray(parsed.plugins))
    throw new Error("marketplace.json plugins must be an array");
  return {
    name: parsed.name,
    plugins: parsed.plugins.map((plugin, index) => normalizeMarketplacePlugin(plugin, index))
  };
}
function resolvePluginSource(repoRoot, plugin, options) {
  const sourcePath = localSourcePath(options?.pathOverride ?? plugin.source);
  const relativePath = sourcePath.slice(2);
  return join23(repoRoot, ...relativePath.split(/[\\/]/));
}
async function readPluginManifest(pluginRoot) {
  const raw = await readFile16(join23(pluginRoot, ".codex-plugin", "plugin.json"), "utf8");
  const parsed = JSON.parse(raw);
  if (!isPlainRecord(parsed))
    throw new Error(`${pluginRoot} plugin.json must be an object`);
  if (typeof parsed.name !== "string" || parsed.name.trim() === "") {
    throw new Error(`${pluginRoot} plugin.json name must be a non-empty string`);
  }
  if (parsed.version !== undefined && (typeof parsed.version !== "string" || parsed.version.trim() === "")) {
    throw new Error(`${pluginRoot} plugin.json version must be a non-empty string`);
  }
  if (parsed.hooks !== undefined && !isPluginHooksManifestValue(parsed.hooks)) {
    throw new Error(`${pluginRoot} plugin.json hooks must be a non-empty string or string array`);
  }
  return {
    name: parsed.name,
    version: typeof parsed.version === "string" ? parsed.version.trim() : undefined,
    hooks: normalizePluginHooksManifestValue(parsed.hooks)
  };
}
function isPluginHooksManifestValue(value) {
  if (typeof value === "string")
    return value.trim() !== "";
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim() !== "");
}
function normalizePluginHooksManifestValue(value) {
  if (typeof value === "string")
    return value.trim();
  if (Array.isArray(value))
    return value.map((item) => item.trim());
  return;
}
function validatePathSegment(value, label) {
  if (!/^[A-Za-z0-9._+-]+$/.test(value)) {
    throw new Error(`${label} contains unsupported characters: ${value}`);
  }
  if (value === "." || value === "..") {
    throw new Error(`${label} must not be a path traversal segment`);
  }
}
function normalizeMarketplacePlugin(plugin, index) {
  if (!isPlainRecord(plugin))
    throw new Error(`marketplace plugin ${index} must be an object`);
  if (typeof plugin.name !== "string" || plugin.name.trim() === "") {
    throw new Error(`marketplace plugin ${index} name must be a non-empty string`);
  }
  validatePathSegment(plugin.name, "plugin name");
  if (plugin.source === undefined || typeof plugin.source === "string") {
    if (typeof plugin.source === "string") {
      validateLocalSourcePath(plugin.source);
    }
    return { name: plugin.name, source: plugin.source };
  }
  if (isPlainRecord(plugin.source) && plugin.source.source === "local" && typeof plugin.source.path === "string") {
    validateLocalSourcePath(plugin.source.path);
    const local = { source: "local", path: plugin.source.path };
    return { name: plugin.name, source: local };
  }
  throw new Error('local plugin source must be a string path or { source: "local", path } object');
}
function localSourcePath(source) {
  if (typeof source === "string")
    return validateLocalSourcePath(source);
  if (source?.source === "local")
    return validateLocalSourcePath(source.path);
  throw new Error("local plugin source path is required");
}
function validateLocalSourcePath(path) {
  if (!path.startsWith("./"))
    throw new Error("local plugin source path must start with ./");
  const relative = path.slice(2);
  if (relative.length === 0)
    throw new Error("local plugin source path must not be empty");
  for (const part of relative.split(/[\\/]/)) {
    if (part === "" || part === "." || part === "..") {
      throw new Error("local plugin source path must stay within the marketplace root");
    }
  }
  return path;
}

// packages/omo-codex/src/install/codex-marketplace-snapshot.ts
import { cp as cp3, mkdir as mkdir7, rename as rename4, rm as rm10, writeFile as writeFile8 } from "node:fs/promises";
import { join as join24, sep as sep6 } from "node:path";
var INSTALLED_MARKETPLACES_DIR = ".tmp/marketplaces";
async function writeInstalledMarketplaceSnapshot(input) {
  const marketplaceRoot = installedMarketplaceRoot(input.codexHome, input.marketplace.name);
  await mkdir7(marketplaceRoot, { recursive: true });
  await writeMarketplaceManifest(marketplaceRoot, input.marketplace);
  const snapshotPlugins = [];
  for (const plugin of input.plugins) {
    snapshotPlugins.push(await writeSnapshotPlugin(marketplaceRoot, plugin));
  }
  return snapshotPlugins;
}
function installedMarketplaceRoot(codexHome, marketplaceName) {
  return join24(codexHome, INSTALLED_MARKETPLACES_DIR, marketplaceName);
}
async function writeMarketplaceManifest(marketplaceRoot, marketplace) {
  const manifestDir = join24(marketplaceRoot, ".agents", "plugins");
  await mkdir7(manifestDir, { recursive: true });
  const tempPath = join24(manifestDir, `.marketplace-${process.pid}-${Date.now()}.json.tmp`);
  await writeFile8(tempPath, `${JSON.stringify(marketplace, null, "\t")}
`);
  await rename4(tempPath, join24(manifestDir, "marketplace.json"));
}
async function writeSnapshotPlugin(marketplaceRoot, plugin) {
  const pluginsDir = join24(marketplaceRoot, "plugins");
  await mkdir7(pluginsDir, { recursive: true });
  const targetPath = join24(pluginsDir, plugin.name);
  const tempPath = join24(pluginsDir, `.tmp-${plugin.name}-${process.pid}-${Date.now()}`);
  await rm10(tempPath, { recursive: true, force: true });
  await cp3(plugin.sourcePath, tempPath, {
    recursive: true,
    filter: (source) => shouldCopyMarketplaceSourcePath(source, plugin.sourcePath)
  });
  await copyBundledMcpRuntimeDists({ pluginRoot: tempPath, sourceRoot: plugin.sourcePath });
  await rm10(targetPath, { recursive: true, force: true });
  await rename4(tempPath, targetPath);
  await rewriteCachedMcpManifest(targetPath, plugin.sourcePath);
  return { name: plugin.name, path: targetPath };
}
function shouldCopyMarketplaceSourcePath(path, root) {
  const relative = path === root ? "" : path.slice(root.length + sep6.length);
  if (relative === "")
    return true;
  const parts = relative.split(sep6);
  return !parts.some((part) => part === ".git" || part === "node_modules");
}

// packages/omo-codex/src/install/lazycodex-version-stamp.ts
import { readdir as readdir8, readFile as readFile17, writeFile as writeFile9 } from "node:fs/promises";
import { join as join25 } from "node:path";
async function readDistributionManifest(repoRoot) {
  try {
    const parsed = JSON.parse(await readFile17(join25(repoRoot, "package.json"), "utf8"));
    if (!isPlainRecord(parsed) || typeof parsed.version !== "string" || parsed.version.trim().length === 0)
      return;
    return {
      name: typeof parsed.name === "string" && parsed.name.trim().length > 0 ? parsed.name.trim() : "lazycodex-ai",
      version: parsed.version.trim()
    };
  } catch (error) {
    if (error instanceof Error)
      return;
    throw error;
  }
}
function resolveLazyCodexPluginVersion(input) {
  const override = input.versionOverride?.trim();
  if (override !== undefined && override.length > 0) {
    return override;
  }
  if (input.marketplaceName === "sisyphuslabs" && input.pluginName === "omo" && input.distributionManifest !== undefined) {
    return input.distributionManifest.version;
  }
  return input.manifestVersion ?? "local";
}
async function stampLazyCodexPluginVersion(input) {
  const manifestPath = join25(input.pluginRoot, ".codex-plugin", "plugin.json");
  const hookPaths = await readPluginHookPaths(manifestPath);
  await stampJsonVersion(manifestPath, input.version);
  await stampJsonVersion(join25(input.pluginRoot, "package.json"), input.version);
  for (const hookPath of hookPaths) {
    await stampHookStatusMessages(join25(input.pluginRoot, hookPath), input.version);
  }
  await stampComponentVersions(input);
}
async function writeLazyCodexInstallSnapshot(input) {
  if (input.distributionManifest === undefined)
    return;
  await writeFile9(join25(input.pluginRoot, "lazycodex-install.json"), `${JSON.stringify({
    packageName: input.distributionManifest.name,
    version: input.distributionManifest.version
  }, null, "\t")}
`);
}
async function stampJsonVersion(path, version) {
  try {
    const parsed = JSON.parse(await readFile17(path, "utf8"));
    if (!isPlainRecord(parsed))
      return;
    parsed.version = version;
    await writeFile9(path, `${JSON.stringify(parsed, null, "\t")}
`);
  } catch (error) {
    if (error instanceof Error)
      return;
    throw error;
  }
}
async function readPluginHookPaths(manifestPath) {
  try {
    const parsed = JSON.parse(await readFile17(manifestPath, "utf8"));
    if (!isPlainRecord(parsed))
      return [];
    if (typeof parsed.hooks === "string" && parsed.hooks.trim().length > 0)
      return [stripDotSlash3(parsed.hooks)];
    if (Array.isArray(parsed.hooks)) {
      return parsed.hooks.filter((hookPath) => typeof hookPath === "string" && hookPath.trim().length > 0).map(stripDotSlash3);
    }
    return [];
  } catch (error) {
    if (error instanceof Error)
      return [];
    throw error;
  }
}
function stripDotSlash3(path) {
  return path.startsWith("./") ? path.slice(2) : path;
}
async function stampHookStatusMessages(path, version) {
  try {
    const parsed = JSON.parse(await readFile17(path, "utf8"));
    if (!isPlainRecord(parsed))
      return;
    stampHookGroups(parsed.hooks, version);
    await writeFile9(path, `${JSON.stringify(parsed, null, "\t")}
`);
  } catch (error) {
    if (error instanceof Error)
      return;
    throw error;
  }
}
async function stampComponentVersions(input) {
  let entries;
  try {
    entries = await readdir8(join25(input.pluginRoot, "components"));
  } catch (error) {
    if (error instanceof Error)
      return;
    throw error;
  }
  for (const entry of entries) {
    const componentRoot = join25(input.pluginRoot, "components", entry);
    await stampJsonVersion(join25(componentRoot, "package.json"), input.version);
    await stampHookStatusMessages(join25(componentRoot, "hooks", "hooks.json"), input.version);
  }
}
function stampHookGroups(hooks, version) {
  if (!isPlainRecord(hooks))
    return;
  for (const groups of Object.values(hooks)) {
    if (!Array.isArray(groups))
      continue;
    for (const group of groups) {
      if (!isPlainRecord(group) || !Array.isArray(group.hooks))
        continue;
      for (const hook of group.hooks) {
        stampHookStatusMessage(hook, version);
      }
    }
  }
}
function stampHookStatusMessage(hook, version) {
  if (!isPlainRecord(hook) || typeof hook.statusMessage !== "string")
    return;
  hook.statusMessage = hook.statusMessage.replace(/^(?:LazyCodex\([^)]+\):|\(OmO(?:\s+[^)]+)?\))\s*/, `(OmO ${normalizeHookStatusVersion(version)}) `);
}
function normalizeHookStatusVersion(version) {
  const normalized = version.trim();
  return normalized.length === 0 ? "local" : normalized;
}

// packages/omo-codex/src/install/codex-project-local-cleanup.ts
import { copyFile as copyFile2, lstat as lstat11, readFile as readFile18, writeFile as writeFile10 } from "node:fs/promises";
import { dirname as dirname9, join as join26, resolve as resolve8 } from "node:path";
var LEGACY_AGENT_CONFLICT_KEYS = ["max_threads"];
var PROJECT_LOCAL_ARTIFACT_PATHS = [
  ".codex/hooks.json",
  ".codex/agents",
  ".codex/prompts",
  ".codex/skills"
];
async function repairNearestProjectLocalCodexArtifacts(input) {
  if (input.startDirectory === undefined) {
    return emptyProjectLocalCodexCleanupResult();
  }
  const project = await findProjectLocalCodexConfigs(input.startDirectory, input.codexHome);
  if (project === null) {
    return emptyProjectLocalCodexCleanupResult();
  }
  const artifacts = await collectProjectLocalArtifacts(project.artifactRoots);
  const configs = [];
  for (const configPath of project.configPaths) {
    const original = await readFile18(configPath, "utf8");
    const repair = repairProjectLocalCodexConfigText(original);
    if (!repair.changed) {
      configs.push({
        projectRoot: project.projectRoot,
        configPath,
        changed: false,
        removedKeys: repair.removedKeys
      });
      continue;
    }
    const backupPath = `${configPath}.backup-${formatBackupTimestamp(input.now?.() ?? new Date)}`;
    await copyFile2(configPath, backupPath);
    await writeFile10(configPath, `${repair.config.trimEnd()}
`);
    configs.push({
      projectRoot: project.projectRoot,
      configPath,
      changed: true,
      removedKeys: repair.removedKeys,
      backupPath
    });
  }
  const changedConfigs = configs.filter((config) => config.changed);
  const nearestChangedConfig = lastValue(changedConfigs);
  const nearestConfig = lastValue(configs);
  return {
    projectRoot: project.projectRoot,
    configPath: nearestChangedConfig?.configPath ?? nearestConfig?.configPath ?? null,
    changed: changedConfigs.length > 0,
    removedKeys: uniqueRemovedKeys(changedConfigs),
    backupPath: nearestChangedConfig?.backupPath,
    configs,
    artifacts
  };
}
function emptyProjectLocalCodexCleanupResult() {
  return {
    projectRoot: null,
    configPath: null,
    changed: false,
    removedKeys: [],
    configs: [],
    artifacts: []
  };
}
function uniqueRemovedKeys(configs) {
  const keys = [];
  for (const config of configs) {
    for (const key of config.removedKeys) {
      if (!keys.includes(key))
        keys.push(key);
    }
  }
  return keys;
}
function lastValue(values) {
  return values.length > 0 ? values[values.length - 1] ?? null : null;
}
function repairProjectLocalCodexConfigText(config) {
  if (!isMultiAgentV2Enabled2(config))
    return { config, changed: false, removedKeys: [] };
  let nextConfig = config;
  const removedKeys = [];
  for (const key of LEGACY_AGENT_CONFLICT_KEYS) {
    const section = findTomlSection(nextConfig, "agents");
    if (section === null || !hasSetting(section.text, key))
      continue;
    nextConfig = removeSetting(nextConfig, section, key);
    removedKeys.push(key);
  }
  return {
    config: nextConfig,
    changed: removedKeys.length > 0,
    removedKeys
  };
}
async function findProjectLocalCodexConfigs(startDirectory, codexHome) {
  if (startDirectory.includes("\x00"))
    return null;
  const startDirectoryStat = await maybeLstat(startDirectory);
  if (startDirectoryStat !== null && !startDirectoryStat.isDirectory()) {
    throw new ProjectLocalCleanupStartDirectoryError(startDirectory);
  }
  const codexHomeConfigPath = codexHome === undefined ? null : join26(resolve8(codexHome), "config.toml");
  let current = resolve8(startDirectory);
  const configPathsFromCwd = [];
  while (true) {
    const configPath = join26(current, ".codex", "config.toml");
    if (await isRegularProjectLocalConfig(current, configPath)) {
      if (codexHomeConfigPath === null || resolve8(configPath) !== codexHomeConfigPath) {
        configPathsFromCwd.push(configPath);
      }
    }
    if (await exists5(join26(current, ".git"))) {
      return configPathsFromCwd.length === 0 ? null : {
        projectRoot: current,
        configPaths: [...configPathsFromCwd].reverse(),
        artifactRoots: artifactRootsForConfigPaths(configPathsFromCwd)
      };
    }
    const parent = dirname9(current);
    if (parent === current) {
      const nearestConfigPath = configPathsFromCwd[0];
      return nearestConfigPath === undefined ? null : {
        projectRoot: dirname9(dirname9(nearestConfigPath)),
        configPaths: [nearestConfigPath],
        artifactRoots: [dirname9(dirname9(nearestConfigPath))]
      };
    }
    current = parent;
  }
}
async function isRegularProjectLocalConfig(directory, configPath) {
  const codexDirStat = await maybeLstat(join26(directory, ".codex"));
  if (codexDirStat === null || !codexDirStat.isDirectory() || codexDirStat.isSymbolicLink())
    return false;
  const configStat = await maybeLstat(configPath);
  return configStat !== null && configStat.isFile() && !configStat.isSymbolicLink();
}
function artifactRootsForConfigPaths(configPaths) {
  const roots = [];
  for (const configPath of configPaths) {
    const root = dirname9(dirname9(configPath));
    if (!roots.includes(root))
      roots.push(root);
  }
  return roots.reverse();
}
async function collectProjectLocalArtifacts(projectRoots) {
  const artifacts = [];
  const seenPaths = new Set;
  for (const projectRoot of projectRoots) {
    for (const relativePath of PROJECT_LOCAL_ARTIFACT_PATHS) {
      const artifactPath = join26(projectRoot, relativePath);
      if (seenPaths.has(artifactPath))
        continue;
      const entryStat = await maybeLstat(artifactPath);
      if (entryStat === null)
        continue;
      seenPaths.add(artifactPath);
      artifacts.push({
        relativePath,
        path: artifactPath,
        kind: entryStat.isDirectory() ? "directory" : entryStat.isFile() ? "file" : "other"
      });
    }
  }
  return artifacts;
}
function isMultiAgentV2Enabled2(config) {
  const featuresSection = findTomlSection(config, "features");
  if (featuresSection !== null && settingIsBooleanTrue(featuresSection.text, "multi_agent_v2"))
    return true;
  const multiAgentSection = findTomlSection(config, "features.multi_agent_v2");
  return multiAgentSection !== null && settingIsBooleanTrue(multiAgentSection.text, "enabled");
}
function settingIsBooleanTrue(sectionText, key) {
  return new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*true\\s*(?:#.*)?$`, "m").test(sectionText);
}
function hasSetting(sectionText, key) {
  return new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`, "m").test(sectionText);
}
function formatBackupTimestamp(date) {
  return date.toISOString().replace(/[:.]/g, "-");
}
async function maybeLstat(path) {
  try {
    return await lstat11(path);
  } catch (error) {
    if (nodeErrorCode4(error) === "ENOENT")
      return null;
    throw error;
  }
}
async function exists5(path) {
  return await maybeLstat(path) !== null;
}
function nodeErrorCode4(error) {
  if (!(error instanceof Error) || !("code" in error))
    return null;
  return typeof error.code === "string" ? error.code : null;
}

class ProjectLocalCleanupStartDirectoryError extends Error {
  constructor(startDirectory) {
    super(`Project-local Codex cleanup start path is not a directory: ${startDirectory}`);
    this.name = "ProjectLocalCleanupStartDirectoryError";
  }
}

// packages/omo-codex/src/install/codex-project-local-cleanup-best-effort.ts
async function repairProjectLocalCodexArtifactsBestEffort(input) {
  try {
    return await repairNearestProjectLocalCodexArtifacts({
      startDirectory: input.startDirectory,
      codexHome: input.codexHome,
      now: input.now
    });
  } catch (error) {
    input.log(`Skipped project-local Codex cleanup: ${formatUnknownError(error)}`);
    return emptyProjectLocalCodexCleanupResult();
  }
}
function formatUnknownError(error) {
  return error instanceof Error ? error.message : String(error);
}

// packages/omo-codex/src/install/lsp-daemon-reaper.ts
import { createHash as createHash3 } from "node:crypto";
import { lstat as lstat12, readFile as readFile20, readdir as readdir10, rm as rm11 } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as join27, posix as posix2 } from "node:path";

// packages/omo-codex/src/install/lsp-daemon-reaper-attestation.ts
import { execFile } from "node:child_process";
import { readFile as readFile19, readdir as readdir9, readlink as readlink5 } from "node:fs/promises";
import { connect } from "node:net";
import { basename as basename5 } from "node:path";
var PROBE_TIMEOUT_MS = 500;
async function probeLegacyJsonRpcEndpoint(endpoint, timeoutMs = PROBE_TIMEOUT_MS) {
  return await new Promise((resolve) => {
    const socket = connect(endpoint);
    let settled = false;
    let buffer = "";
    const finish = (value) => {
      if (settled)
        return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref?.();
    socket.once("connect", () => {
      socket.write(`${JSON.stringify(legacyStatusRequest())}
`);
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const newlineIndex = buffer.indexOf(`
`);
      if (newlineIndex < 0)
        return;
      finish(isJsonRpcResponse(buffer.slice(0, newlineIndex).trim()));
    });
    socket.once("error", () => finish(false));
  });
}
async function attestLegacyDaemonOwnership(input, deps = {}) {
  if (input.platform === "linux")
    return await attestLinuxOwnership(input, deps);
  if (input.platform === "darwin")
    return await attestMacOwnership(input, deps);
  return false;
}
async function attestLinuxOwnership(input, deps) {
  const readFileImpl = deps.readFile ?? readFile19;
  const readDirImpl = deps.readDir ?? readdir9;
  const readLinkImpl = deps.readLink ?? readlink5;
  const procNetUnix = await readText(readFileImpl, "/proc/net/unix");
  if (procNetUnix === null)
    return false;
  const inode = inodeForEndpoint(procNetUnix, input.endpoint);
  if (inode === null)
    return false;
  const fdEntries = await readDirImpl(`/proc/${input.pid}/fd`).catch(() => null);
  if (fdEntries === null)
    return false;
  let ownsEndpoint = false;
  for (const fdEntry of fdEntries) {
    const target = await readLinkImpl(`/proc/${input.pid}/fd/${fdEntry}`).catch(() => null);
    if (target !== `socket:[${inode}]`)
      continue;
    ownsEndpoint = true;
    break;
  }
  if (!ownsEndpoint)
    return false;
  const cmdline = await readBinary(readFileImpl, `/proc/${input.pid}/cmdline`);
  if (cmdline === null)
    return false;
  return isNodeCliDaemonArgv(splitCmdline(cmdline));
}
async function attestMacOwnership(input, deps) {
  const executeFileImpl = deps.executeFile ?? execFile;
  const filteredLsofOutput = await executeForStdout(executeFileImpl, "/usr/sbin/lsof", [
    "-a",
    "-n",
    "-P",
    "-p",
    String(input.pid),
    "-U",
    "-Fn",
    "--",
    input.endpoint
  ]);
  const lsofOutput = filteredLsofOutput ?? await executeForStdout(executeFileImpl, "/usr/sbin/lsof", [
    "-a",
    "-n",
    "-P",
    "-p",
    String(input.pid),
    "-U",
    "-Fn"
  ]);
  if (lsofOutput === null || !lsofShowsUnixEndpoint(lsofOutput, input.pid, input.endpoint))
    return false;
  const commandOutput = await executeForStdout(executeFileImpl, "/bin/ps", ["-p", String(input.pid), "-o", "command="]);
  if (commandOutput === null)
    return false;
  return isNodeCliDaemonCommand(commandOutput.trim());
}
function legacyStatusRequest() {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "status", arguments: {} }
  };
}
function isJsonRpcResponse(line) {
  if (line.length === 0)
    return false;
  try {
    const parsed = JSON.parse(line);
    return parsed.jsonrpc === "2.0" && parsed.id === 1 && (Object.hasOwn(parsed, "result") || Object.hasOwn(parsed, "error"));
  } catch {
    return false;
  }
}
function inodeForEndpoint(procNetUnix, endpoint) {
  for (const line of procNetUnix.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("Num"))
      continue;
    const fields = trimmed.split(/\s+/);
    if (fields.length < 8 || fields[7] !== endpoint)
      continue;
    return fields[6] ?? null;
  }
  return null;
}
function splitCmdline(buffer) {
  return buffer.toString("utf8").split("\x00").filter((value) => value.length > 0);
}
function isNodeCliDaemonArgv(argv) {
  if (argv.length < 2 || !argv.includes("daemon"))
    return false;
  const executable = basename5(argv[0] ?? "");
  if (!/^node(?:\.exe)?$/i.test(executable))
    return false;
  return argv.some((value) => value === "cli.js" || value.endsWith("/cli.js") || value.endsWith("\\cli.js"));
}
function lsofShowsUnixEndpoint(output, pid, endpoint) {
  const lines = output.split(/\r?\n/).filter((line) => line.length > 0);
  const endpointName = basename5(endpoint);
  return lines.includes(`p${pid}`) && lines.some((line) => line === `n${endpoint}` || line === `n${endpointName}`);
}
function isNodeCliDaemonCommand(command) {
  return /\bnode(?:\.exe)?\b/i.test(command) && /\bcli\.js\b/.test(command) && /\bdaemon\b/.test(command);
}
async function executeForStdout(executeFileImpl, file, args) {
  return await new Promise((resolve) => {
    executeFileImpl(file, [...args], { encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 1000 }, (error, stdout) => {
      if (error !== null) {
        resolve(null);
        return;
      }
      resolve(stdout);
    });
  });
}
async function readText(readFileImpl, path) {
  return await readFileImpl(path, "utf8").catch(() => null);
}
async function readBinary(readFileImpl, path) {
  return await readFileImpl(path).catch(() => null);
}

// packages/omo-codex/src/install/lsp-daemon-reaper.ts
var LEGACY_EXIT_WAIT_TIMEOUT_MS = 5000;
var LEGACY_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;
async function reapLspDaemons(codexHome, deps = {}) {
  const daemonRoot = join27(codexHome, "codex-lsp", "daemon");
  const platform = deps.platform ?? process.platform;
  const tmpDir = deps.tmpDir ?? tmpdir();
  const probe = deps.probeLegacyJsonRpc ?? probeLegacyJsonRpcEndpoint;
  const attest = deps.attestLegacyDaemonOwnership ?? ((input) => attestLegacyDaemonOwnership(input));
  const killProcess = deps.killProcess ?? sendSigterm;
  const waitForProcessExit = deps.waitForProcessExit ?? defaultWaitForProcessExit;
  const entries = await readdir10(daemonRoot, { withFileTypes: true }).catch(() => []);
  const results = [];
  for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name))) {
    const versionPath = join27(daemonRoot, entry.name);
    const parsedVersion = parseVersionEntry(entry.name);
    if (parsedVersion === null || !entry.isDirectory()) {
      await removeVersionDir(versionPath);
      results.push(removed(entry.name, "removed invalid legacy version entry"));
      continue;
    }
    const metadata = await readLegacyMetadata({ versionPath, version: parsedVersion, codexHome, platform, tmpDir });
    if (metadata.kind === "remove") {
      await removeVersionDir(versionPath);
      results.push(removed(parsedVersion, metadata.reason));
      continue;
    }
    if (!await probe(metadata.endpoint)) {
      await removeVersionDir(versionPath);
      results.push(removed(parsedVersion, "removed stale legacy daemon state"));
      continue;
    }
    if (platform === "win32") {
      results.push(deferred(parsedVersion, "legacy named pipe responded but Windows cannot prove pid ownership safely"));
      continue;
    }
    const owned = await attest({ pid: metadata.pid, endpoint: metadata.endpoint, platform });
    if (!owned) {
      results.push(deferred(parsedVersion, "legacy endpoint responded but pid ownership was not proven"));
      continue;
    }
    if (!killProcess(metadata.pid)) {
      await removeVersionDir(versionPath);
      results.push(removed(parsedVersion, "removed stale legacy daemon state"));
      continue;
    }
    if (!await waitForProcessExit(metadata.pid, LEGACY_EXIT_WAIT_TIMEOUT_MS)) {
      results.push(deferred(parsedVersion, `timed out waiting ${LEGACY_EXIT_WAIT_TIMEOUT_MS}ms for the proven legacy daemon to exit`));
      continue;
    }
    await removeVersionDir(versionPath);
    results.push(terminated(parsedVersion, "terminated proven owned legacy daemon"));
  }
  return results;
}
function parseVersionEntry(entryName) {
  if (!entryName.startsWith("v"))
    return null;
  const version = entryName.slice(1);
  return LEGACY_VERSION_PATTERN.test(version) ? version : null;
}
async function readLegacyMetadata(input) {
  const pidText = await readRegularTrimmedFile(join27(input.versionPath, "daemon.pid"));
  if (pidText === "non_regular")
    return { kind: "remove", reason: "removed non-regular legacy daemon metadata" };
  if (pidText === null)
    return { kind: "remove", reason: "removed malformed legacy daemon metadata" };
  const pid = Number.parseInt(pidText, 10);
  if (!Number.isInteger(pid) || pid <= 0)
    return { kind: "remove", reason: "removed malformed legacy daemon metadata" };
  const endpointText = await readRegularTrimmedFile(join27(input.versionPath, "daemon.endpoint"));
  if (endpointText === "non_regular")
    return { kind: "remove", reason: "removed non-regular legacy daemon metadata" };
  if (endpointText === null)
    return { kind: "remove", reason: "removed malformed legacy daemon metadata" };
  const allowedEndpoints = legacyEndpointCandidates({
    version: input.version,
    versionPath: input.versionPath,
    platform: input.platform,
    tmpDir: input.tmpDir
  });
  if (!allowedEndpoints.includes(endpointText)) {
    return { kind: "remove", reason: "removed legacy daemon state with an endpoint outside the frozen vectors" };
  }
  return { kind: "valid", pid, endpoint: endpointText };
}
function legacyEndpointCandidates(input) {
  if (input.platform === "win32") {
    const normalizedVersionPath = input.versionPath.replaceAll("/", "\\");
    const digest = shortDigest(normalizedVersionPath);
    return [`\\\\.\\pipe\\omo-lsp-${input.version}-${digest}`];
  }
  const natural = posix2.join(input.versionPath, "daemon.sock");
  const hashed = posix2.join(input.tmpDir, `omo-lsp-${input.version}-${shortDigest(input.versionPath)}.sock`);
  return [natural, hashed];
}
async function readRegularTrimmedFile(path) {
  const stats = await lstat12(path).catch(() => null);
  if (stats === null)
    return null;
  if (!stats.isFile())
    return "non_regular";
  const content = (await readFile20(path, "utf8")).trim();
  return content.length > 0 ? content : null;
}
function shortDigest(value) {
  return createHash3("sha256").update(value).digest("hex").slice(0, 16);
}
async function removeVersionDir(path) {
  await rm11(path, { recursive: true, force: true });
}
function removed(version, reason) {
  return { version, status: "removed", reason };
}
function terminated(version, reason) {
  return { version, status: "terminated", reason };
}
function deferred(version, reason) {
  return { version, status: "deferred", reason };
}
function sendSigterm(pid) {
  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}
async function defaultWaitForProcessExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;; ) {
    if (!processIsRunning(pid))
      return true;
    if (Date.now() >= deadline)
      return false;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
function processIsRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// packages/omo-codex/src/install/codex-installer-bin-dir.ts
import { homedir } from "node:os";
import { join as join28, resolve as resolve9 } from "node:path";
function resolveCodexInstallerBinDir(input) {
  const explicitBinDir = input.binDir ?? input.env?.CODEX_LOCAL_BIN_DIR;
  if (explicitBinDir !== undefined && explicitBinDir.trim().length > 0)
    return resolve9(explicitBinDir.trim());
  const homeDir = input.homeDir ?? homedir();
  const defaultCodexHome = resolve9(homeDir, ".codex");
  const resolvedCodexHome = resolve9(input.codexHome);
  if (resolvedCodexHome !== defaultCodexHome)
    return join28(resolvedCodexHome, "bin");
  return resolve9(homeDir, ".local", "bin");
}

// packages/omo-codex/src/install/codex-installed-bin-dir.ts
import { readFile as readFile21, readdir as readdir11, writeFile as writeFile11 } from "node:fs/promises";
import { join as join29 } from "node:path";
var INSTALLED_BIN_DIR_MANIFEST = ".installed-bin-dir.json";
async function writeInstalledCodexBinDir(input) {
  await writeFile11(join29(input.pluginRoot, INSTALLED_BIN_DIR_MANIFEST), `${JSON.stringify({ binDir: input.binDir }, null, 2)}
`);
}

// packages/omo-codex/src/install/codex-git-bash-hooks.ts
import { readFile as readFile22, writeFile as writeFile12 } from "node:fs/promises";
import { join as join30 } from "node:path";
var WINDOWS_ONLY_GIT_BASH_HOOKS = new Set([
  "./hooks/pre-tool-use-recommending-git-bash-mcp.json",
  "./hooks/post-compact-resetting-git-bash-mcp-reminder.json"
]);
async function removeGitBashHooksOffWindows(input) {
  if (input.platform === "win32")
    return;
  const manifestPath = join30(input.pluginRoot, ".codex-plugin", "plugin.json");
  const parsed = JSON.parse(await readFile22(manifestPath, "utf8"));
  if (!isPlainRecord(parsed) || !Array.isArray(parsed.hooks))
    return;
  const hooks = parsed.hooks.filter((hook) => typeof hook !== "string" || !WINDOWS_ONLY_GIT_BASH_HOOKS.has(hook));
  if (hooks.length === parsed.hooks.length)
    return;
  await writeFile12(manifestPath, `${JSON.stringify({ ...parsed, hooks }, null, "\t")}
`);
}

// packages/omo-codex/src/install/install-ast-grep-sg.ts
import { join as join32 } from "node:path";

// packages/utils/src/ast-grep/install-script.ts
import { spawn as spawn2 } from "node:child_process";
import { existsSync as existsSync4 } from "node:fs";
import { join as join31 } from "node:path";

// packages/utils/src/ast-grep/sg-manifest.ts
function normalizeRuntimePlatform(platform = process.platform) {
  if (platform === "darwin" || platform === "linux" || platform === "win32")
    return platform;
  return "linux";
}
function normalizeRuntimeArch(arch = process.arch) {
  if (arch === "arm64" || arch === "aarch64")
    return "arm64";
  return "x64";
}
function runtimeSlug(platform = process.platform, arch = process.arch) {
  return `${normalizeRuntimePlatform(platform)}-${normalizeRuntimeArch(arch)}`;
}

// packages/utils/src/ast-grep/install-script.ts
var AST_GREP_BIN_DIR_ENV_KEY = "OMO_AST_GREP_BIN_DIR";
var KILL_GRACE_MS = 1000;
var AST_GREP_INSTALL_TIMEOUT_MS = 30000;
function astGrepRuntimeDir(baseDir, platform = process.platform, arch = process.arch) {
  return join31(baseDir, "runtime", "ast-grep", runtimeSlug(platform, arch));
}
function isMissingExecutable(error) {
  if (!("code" in error))
    return false;
  return error.code === "ENOENT";
}
function defaultSpawnProcess(command, args, options) {
  const child = spawn2(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: "ignore",
    windowsHide: true
  });
  let settled = false;
  const outcome = new Promise((resolve) => {
    const settle = (result) => {
      if (settled)
        return;
      settled = true;
      resolve(result);
    };
    child.once("error", (error) => {
      settle({ kind: "spawn-error", error, missingExecutable: isMissingExecutable(error) });
    });
    child.once("exit", (code, signal) => {
      settle({ kind: "exit", code, signal });
    });
  });
  return {
    kill: () => {
      if (!child.killed)
        child.kill();
    },
    outcome
  };
}
function scriptPathForPlatform(skillDir, platform) {
  return join31(skillDir, platform === "win32" ? "install.ps1" : "install.sh");
}
function invocationsForPlatform(scriptPath, platform) {
  if (platform !== "win32")
    return [{ command: "bash", args: [scriptPath] }];
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath];
  return [{ command: "pwsh", args }, { command: "powershell.exe", args }];
}
async function runInvocation(input) {
  const child = input.spawnProcess(input.invocation.command, input.invocation.args, { cwd: input.skillDir, env: input.env });
  let timedOut = false;
  let terminateDeadline;
  let terminateDeadlineGrace;
  const killIgnored = new Promise((_, reject) => {
    terminateDeadline = () => reject(new Error("ast-grep install child ignored termination"));
  });
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill();
    terminateDeadlineGrace = setTimeout(() => terminateDeadline?.(), KILL_GRACE_MS);
  }, input.timeoutMs);
  try {
    const outcome = await Promise.race([child.outcome, killIgnored]);
    if (timedOut)
      return { kind: "timed-out" };
    return outcome;
  } catch (error) {
    if (error instanceof Error && error.message.includes("ignored termination")) {
      return { kind: "spawn-error", error, missingExecutable: false };
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    if (terminateDeadlineGrace !== undefined)
      clearTimeout(terminateDeadlineGrace);
  }
}
function failedReason(outcome) {
  return outcome.error.message;
}
async function runAstGrepSkillInstall(options) {
  const platform = options.platform ?? process.platform;
  const fileExists = options.fileExists ?? existsSync4;
  const scriptPath = scriptPathForPlatform(options.skillDir, platform);
  if (!fileExists(scriptPath))
    return { kind: "skipped", reason: `missing ${scriptPath}` };
  const env = { ...options.env ?? process.env, [AST_GREP_BIN_DIR_ENV_KEY]: options.targetDir };
  const spawnProcess = options.spawnProcess ?? defaultSpawnProcess;
  const timeoutMs = options.timeoutMs ?? AST_GREP_INSTALL_TIMEOUT_MS;
  const invocations = invocationsForPlatform(scriptPath, platform);
  try {
    for (const invocation of invocations) {
      const outcome = await runInvocation({ env, invocation, skillDir: options.skillDir, spawnProcess, timeoutMs });
      if (outcome.kind === "timed-out")
        return { kind: "timed-out" };
      if (outcome.kind === "exit") {
        if (outcome.code === 0)
          return { kind: "succeeded" };
        return { kind: "failed", reason: `${invocation.command} exited ${outcome.code ?? outcome.signal ?? "without status"}` };
      }
      if (platform === "win32" && outcome.missingExecutable && invocation.command === "pwsh")
        continue;
      return { kind: "failed", reason: failedReason(outcome) };
    }
    return { kind: "failed", reason: "no ast-grep install shell was available" };
  } catch (error) {
    if (error instanceof Error)
      return { kind: "failed", reason: error.message };
    return { kind: "failed", reason: String(error) };
  }
}

// packages/omo-codex/src/install/install-ast-grep-sg.ts
function describeResult(result) {
  if (result.kind === "succeeded")
    return null;
  if (result.kind === "timed-out")
    return "timed out after 30s";
  return result.reason;
}
async function installAstGrepForCodex(options) {
  const plugin = options.installed.find((entry) => entry.name === "omo");
  if (plugin === undefined)
    return;
  const platform = options.platform ?? process.platform;
  const targetDir = astGrepRuntimeDir(options.codexHome, platform, options.arch ?? process.arch);
  const skillDir = join32(plugin.path, "skills", "ast-grep");
  const installer = options.installer ?? runAstGrepSkillInstall;
  try {
    const result = await installer({ platform, skillDir, targetDir });
    const failure = describeResult(result);
    if (failure !== null)
      options.log?.(`[ast-grep] skipped sg provisioning: ${failure}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    options.log?.(`[ast-grep] skipped sg provisioning: ${message}`);
  }
}

// packages/omo-codex/src/install/codex-install-telemetry.ts
async function trackCodexInstallTelemetry() {
  try {
    await Promise.resolve().then(() => init_telemetry());
    const posthog = createInstallPostHog();
    posthog.trackActive(getPostHogDistinctId(), "install_completed");
    await posthog.shutdown();
  } catch (error) {
    if (error instanceof Error)
      return;
    return;
  }
}

// packages/omo-codex/src/install/install-codex.ts
var SISYPHUS_LEGACY_CACHE_MARKETPLACES = ["lazycodex", "code-yeongyu-codex-plugins"];
async function runCodexInstaller(options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const repoRoot = resolve10(options.repoRoot ?? findRepoRoot({ importerDir: import.meta.dir, env }));
  const codexHome = resolve10(options.codexHome ?? env.CODEX_HOME ?? join35(homedir2(), ".codex"));
  const projectDirectory = resolve10(options.projectDirectory ?? env.OMO_CODEX_PROJECT ?? process.cwd());
  const binDir = resolveCodexInstallerBinDir({ binDir: options.binDir, codexHome, env });
  const runCommand = options.runCommand ?? defaultRunCommand;
  const log = options.log ?? (() => {
    return;
  });
  const buildSource = await shouldBuildSourcePackages(repoRoot);
  const versionOverride = env.LAZYCODEX_DEV_VERSION?.trim() || undefined;
  const gitBashResolution = await prepareGitBashForInstall({
    platform,
    env,
    resolveGitBash: platform === "win32" ? options.gitBashResolver ?? (() => resolveGitBashForCurrentProcess2({ platform, env })) : undefined
  });
  if (!gitBashResolution.found) {
    throw new Error(gitBashResolution.installHint);
  }
  const codexPackageRoot = join35(repoRoot, "packages", "omo-codex");
  const marketplace = await readMarketplace(repoRoot, {
    marketplacePath: join35(codexPackageRoot, "marketplace.json")
  });
  const distributionManifest = await readDistributionManifest(repoRoot);
  const installed = [];
  const pluginSources = [];
  const agentConfigs = new Map;
  for (const entry of marketplace.plugins) {
    const sourcePath = resolvePluginSource(codexPackageRoot, entry, { pathOverride: "./plugin" });
    const manifest = await readPluginManifest(sourcePath);
    if (manifest.name !== entry.name) {
      throw new Error(`plugin manifest name ${JSON.stringify(manifest.name)} does not match marketplace name ${JSON.stringify(entry.name)}`);
    }
    const version = resolveLazyCodexPluginVersion({
      manifestVersion: manifest.version,
      marketplaceName: marketplace.name,
      pluginName: entry.name,
      distributionManifest,
      versionOverride
    });
    validatePathSegment(version, "plugin version");
    log(`Building ${entry.name}@${version}`);
    const plugin = await installCachedPlugin({
      buildSource,
      codexHome,
      env,
      marketplaceName: marketplace.name,
      name: entry.name,
      runCommand,
      sourcePath,
      version
    });
    if (marketplace.name === "sisyphuslabs" && plugin.name === "omo") {
      await stampLazyCodexPluginVersion({ pluginRoot: plugin.path, version });
      await writeLazyCodexInstallSnapshot({ pluginRoot: plugin.path, distributionManifest });
      await writeInstalledCodexBinDir({ pluginRoot: plugin.path, binDir });
      await removeGitBashHooksOffWindows({ platform, pluginRoot: plugin.path });
    }
    const links = await linkCachedPluginBins({ binDir, pluginRoot: plugin.path, platform });
    for (const link of links) {
      log(`Linked ${link.name} -> ${link.target}`);
    }
    if (marketplace.name === "sisyphuslabs" && plugin.name === "omo") {
      const runtimeLink = await linkRootRuntimeBin({ binDir, codexHome, repoRoot, platform });
      if (runtimeLink !== null)
        log(`Linked ${runtimeLink.name} -> ${runtimeLink.target}`);
      else
        log(`Warning: skipped the omo-agent-toolkit runtime wrapper because ${join35(repoRoot, "dist", "cli", "index.js")} is missing; omo-agent-toolkit ulw-loop commands will be unavailable until a package shipping dist/cli is installed`);
    }
    pluginSources.push({ name: entry.name, sourcePath });
    installed.push(plugin);
  }
  await installAstGrepForCodex({
    codexHome,
    installed,
    installer: options.astGrepInstaller,
    log,
    platform
  });
  const preservedReasoning = await capturePreservedAgentReasoning({ codexHome });
  const preservedServiceTier = await capturePreservedAgentServiceTier({ codexHome });
  const agentSourceRoots = await agentSourceRootsForInstall({
    codexHome,
    marketplace,
    installed,
    pluginSources
  });
  const omoConfig = readDefaultRoleConfig({ cwd: projectDirectory, env });
  for (const warning of omoConfig.warnings)
    log(`Warning: ${warning}`);
  for (const plugin of installed) {
    const pluginRoot = agentSourceRoots.get(plugin.name) ?? plugin.path;
    const agentLinks = await linkCachedPluginAgents({
      codexHome,
      pluginRoot,
      platform,
      preservedReasoning,
      preservedServiceTier,
      defaultRoleEnabled: omoConfig.enabled
    });
    for (const link of agentLinks) {
      log(`Linked agent ${link.name} -> ${link.target}`);
      const agentName = agentNameFromToml3(link.name);
      agentConfigs.set(agentName, { name: agentName, configFile: `./agents/${link.name}` });
    }
  }
  const trustedHookStates = (await Promise.all(installed.map((plugin) => trustedHookStatesForPlugin({
    marketplaceName: marketplace.name,
    platform,
    pluginName: plugin.name,
    pluginRoot: plugin.path
  })))).flat();
  await pruneMarketplaceCache({
    codexHome,
    marketplaceName: marketplace.name,
    keepPluginNames: marketplace.plugins.map((plugin) => plugin.name)
  });
  for (const legacyMarketplaceName of legacyCacheMarketplaces(marketplace.name)) {
    await pruneMarketplacePluginCaches({
      codexHome,
      marketplaceName: legacyMarketplaceName,
      pluginNames: marketplace.plugins.map((plugin) => plugin.name)
    });
  }
  const legacyDaemonCleanup = await reapLspDaemons(codexHome).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    log(`Warning: skipped legacy Codex LSP daemon cleanup: ${message}`);
    return [];
  });
  for (const cleanup of legacyDaemonCleanup) {
    if (cleanup.status !== "deferred")
      continue;
    log(`Warning: deferred legacy Codex LSP daemon cleanup for v${cleanup.version}: ${cleanup.reason}`);
  }
  const marketplaceRoot = join35(codexHome, "plugins", "cache", marketplace.name);
  await writeCachedMarketplaceManifest({
    marketplaceName: marketplace.name,
    marketplaceRoot,
    plugins: installed
  });
  const configPath = join35(codexHome, "config.toml");
  await updateCodexConfig({
    configPath,
    repoRoot: codexPackageRoot,
    marketplaceName: marketplace.name,
    marketplaceSource: codexMarketplaceSource(marketplaceRoot),
    pluginNames: marketplace.plugins.map((plugin) => plugin.name),
    platform,
    gitBashEnabled: platform === "win32" && gitBashResolution.found,
    trustedHookStates,
    agentConfigs: [...agentConfigs.values()].sort((left, right) => left.name.localeCompare(right.name)),
    autonomousPermissions: options.autonomousPermissions !== false,
    ...options.reasoning === undefined ? {} : { reasoning: options.reasoning }
  });
  const projectCleanup = await repairProjectLocalCodexArtifactsBestEffort({
    startDirectory: projectDirectory,
    codexHome,
    log
  });
  for (const configCleanup of projectCleanup.configs) {
    if (!configCleanup.changed)
      continue;
    log(`Repaired project Codex config ${configCleanup.configPath} (backup: ${configCleanup.backupPath})`);
  }
  for (const artifact of projectCleanup.artifacts) {
    log(`Found project-local legacy artifact ${artifact.path}; left in place`);
  }
  await trackCodexInstallTelemetry();
  return {
    marketplaceName: marketplace.name,
    installed,
    configPath,
    codexHome,
    gitBashPath: gitBashResolution.path,
    projectCleanup
  };
}
function agentNameFromToml3(fileName) {
  return fileName.endsWith(".toml") ? fileName.slice(0, -".toml".length) : fileName;
}
async function agentSourceRootsForInstall(input) {
  if (input.marketplace.name !== "sisyphuslabs") {
    return new Map(input.installed.map((plugin) => [plugin.name, plugin.path]));
  }
  const snapshotPlugins = await writeInstalledMarketplaceSnapshot({
    codexHome: input.codexHome,
    marketplace: input.marketplace,
    plugins: input.pluginSources
  });
  return new Map(snapshotPlugins.map((plugin) => [plugin.name, plugin.path]));
}
function legacyCacheMarketplaces(marketplaceName) {
  return marketplaceName === "sisyphuslabs" ? SISYPHUS_LEGACY_CACHE_MARKETPLACES : [];
}
function findRepoRootFromImporter(importerDir) {
  let current = importerDir;
  for (let depth = 0;depth <= 7; depth += 1) {
    if (isRepoRootWithCodexPlugin(current))
      return current;
    for (const wrapperPackageRoot of [join35(current, "node_modules", "oh-my-openagent"), join35(current, "oh-my-openagent")]) {
      if (isRepoRootWithCodexPlugin(wrapperPackageRoot))
        return wrapperPackageRoot;
    }
    current = resolve10(current, "..");
  }
  throw new Error("Unable to locate vendored Codex plugin: expected packages/omo-codex/plugin/.codex-plugin/plugin.json in this package or sibling oh-my-openagent package within 7 parent levels");
}
function findRepoRoot(input) {
  const wrapperPackageRoot = input.env?.OMO_WRAPPER_PACKAGE_ROOT;
  if (wrapperPackageRoot !== undefined && wrapperPackageRoot.trim().length > 0) {
    const resolvedWrapperPackageRoot = resolve10(wrapperPackageRoot);
    if (isRepoRootWithCodexPlugin(resolvedWrapperPackageRoot))
      return resolvedWrapperPackageRoot;
  }
  return findRepoRootFromImporter(input.importerDir);
}
function isRepoRootWithCodexPlugin(repoRoot) {
  return existsSync7(join35(repoRoot, "packages", "omo-codex", "plugin", ".codex-plugin", "plugin.json"));
}
function codexMarketplaceSource(marketplaceRoot) {
  return { sourceType: "local", source: marketplaceRoot };
}

// packages/omo-codex/src/install/lazycodex-cli-args.ts
var CODEX_ONLY_ERROR = "lazycodex-ai installs the Codex Light edition only. Use the omo installer for OpenCode or both-platform installs.";
var PASSTHROUGH_COMMANDS = new Set([
  "doctor",
  "cleanup",
  "get-local-version",
  "boulder",
  "refresh-model-capabilities",
  "run",
  "ulw-loop"
]);
function parseLazyCodexInstallCliArgs(argv) {
  const args = [...argv];
  if (args.length === 0)
    return { kind: "install", autonomousPermissions: undefined, repoRoot: undefined };
  let repoRoot;
  let command;
  let dryRun = false;
  let noTui = false;
  let skipAuth = false;
  let autonomousPermissions;
  let index = 0;
  while (index < args.length) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h" || arg === "help")
      return { kind: "help" };
    if (arg === "--version" || arg === "-v" || arg === "version")
      return { kind: "version" };
    if (arg === "--dry-run") {
      dryRun = true;
      index += 1;
      continue;
    }
    if (arg === "--no-tui") {
      noTui = true;
      index += 1;
      continue;
    }
    if (arg === "--skip-auth") {
      skipAuth = true;
      index += 1;
      continue;
    }
    if (arg === "--codex-autonomous") {
      autonomousPermissions = true;
      index += 1;
      continue;
    }
    if (arg === "--no-codex-autonomous") {
      autonomousPermissions = false;
      index += 1;
      continue;
    }
    if (arg === "--platform") {
      const platform = readOptionValue(args, index, "--platform");
      if (platform !== "codex")
        throw new Error(CODEX_ONLY_ERROR);
      index += 2;
      continue;
    }
    if (typeof arg === "string" && arg.startsWith("--platform=")) {
      const platform = arg.slice("--platform=".length);
      if (platform.trim().length === 0)
        throw new Error("--platform requires a value");
      if (platform !== "codex")
        throw new Error(CODEX_ONLY_ERROR);
      index += 1;
      continue;
    }
    if (arg === "--repo-root") {
      repoRoot = readOptionValue(args, index, "--repo-root");
      index += 2;
      continue;
    }
    if (typeof arg === "string" && arg.startsWith("--repo-root=")) {
      const value = arg.slice("--repo-root=".length);
      if (value.trim().length === 0)
        throw new Error("--repo-root requires a path");
      repoRoot = value;
      index += 1;
      continue;
    }
    if (arg === "install" || arg === "setup") {
      if (command !== undefined)
        throw new Error(`Unsupported lazycodex-ai install option: ${String(arg)}`);
      command = "install";
      index += 1;
      continue;
    }
    if (arg === "update") {
      return parseUpdateArgs(args, index + 1, dryRun, repoRoot);
    }
    if (arg === "uninstall") {
      return { kind: "command", command: "cleanup", dryRun, args: args.slice(index + 1) };
    }
    if (PASSTHROUGH_COMMANDS.has(arg)) {
      return { kind: "command", command: arg, dryRun, args: args.slice(index + 1) };
    }
    if (command === undefined && typeof arg === "string" && !arg.startsWith("-")) {
      throw new Error(`Unsupported lazycodex-ai command: ${String(arg)}`);
    }
    throw new Error(`Unsupported lazycodex-ai install option: ${String(arg)}`);
  }
  if (!dryRun)
    return { kind: "install", autonomousPermissions, repoRoot };
  return {
    kind: "command",
    command: command ?? "install",
    dryRun,
    noTui,
    skipAuth,
    autonomousPermissions,
    repoRoot,
    args: []
  };
}
function parseUpdateArgs(args, startIndex, initialDryRun, initialRepoRoot) {
  let dryRun = initialDryRun;
  let repoRoot = initialRepoRoot;
  let index = startIndex;
  while (index < args.length) {
    const updateArg = args[index];
    if (updateArg === "--dry-run") {
      dryRun = true;
      index += 1;
      continue;
    }
    if (updateArg === "--repo-root") {
      repoRoot = readOptionValue(args, index, "--repo-root");
      index += 2;
      continue;
    }
    if (typeof updateArg === "string" && updateArg.startsWith("--repo-root=")) {
      const value = updateArg.slice("--repo-root=".length);
      if (value.trim().length === 0)
        throw new Error("--repo-root requires a path");
      repoRoot = value;
      index += 1;
      continue;
    }
    throw new Error(`Unsupported lazycodex-ai update option: ${String(updateArg)}`);
  }
  return { kind: "update", dryRun, repoRoot };
}
function readOptionValue(args, index, option) {
  const value = args[index + 1];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}
function formatLazyCodexInstallHelp() {
  const passthrough = [...PASSTHROUGH_COMMANDS].sort().join(", ");
  return [
    "Usage: lazycodex-ai install [--no-tui] [--codex-autonomous|--no-codex-autonomous] [--repo-root <path>]",
    "       lazycodex-ai uninstall [--project <path>]",
    "       lazycodex-ai update [--dry-run] [--repo-root <path>]",
    "       lazycodex-ai doctor [--source-root <path>] [--model <model>] [--json|--status|--verbose]",
    "       lazycodex-ai version",
    "       lazycodex-ai <command> [args...]",
    "",
    "Installs or removes the Codex Light edition in ~/.codex using Node/npm.",
    "`uninstall` removes managed Codex Light state; `cleanup` is a backward-compatible alias.",
    "`update` refreshes the installed Codex Light edition in place.",
    "",
    `Commands supported by lazycodex-ai: ${passthrough}.`,
    "`doctor` runs the Codex LazyCodex doctor workflow; other pass-through commands delegate to the omo CLI."
  ].join(`
`);
}

// packages/omo-codex/src/install/lazycodex-delegated-command.ts
async function runDelegatedOmoCommand(parsed, options) {
  if (parsed.command === "doctor" && process.env.LAZYCODEX_DOCTOR_LCX_ACTIVE === "1") {
    throw new Error("Refusing recursive lazycodex doctor invocation from inside $omo:lcx-doctor");
  }
  const invocation = buildDelegatedOmoInvocation(parsed);
  if (parsed.dryRun) {
    options.log(formatShellCommand(invocation.command, invocation.args));
    return;
  }
  const env = invocation.delegatesToOmo ? { ...process.env, OMO_INVOCATION_NAME: "omo-agent-toolkit", ...invocation.env } : { ...process.env, ...invocation.env };
  await options.runCommand(invocation.command, invocation.args, { cwd: options.cwd, env });
}
function buildDelegatedOmoInvocation(parsed) {
  if (parsed.command === "doctor")
    return buildLazyCodexDoctorInvocation(parsed.args);
  if (parsed.command === "install") {
    const args = ["--yes", "oh-my-openagent@latest", parsed.command, "--platform=codex"];
    if (parsed.noTui)
      args.push("--no-tui");
    if (parsed.skipAuth)
      args.push("--skip-auth");
    if (parsed.autonomousPermissions !== false)
      args.push("--codex-autonomous");
    if (parsed.autonomousPermissions === false)
      args.push("--no-codex-autonomous");
    if (parsed.repoRoot)
      args.push(`--repo-root=${parsed.repoRoot}`);
    return { command: "npx", args, delegatesToOmo: true };
  }
  const args = ["--yes", "--package", "oh-my-openagent", "omo-agent-toolkit", parsed.command];
  if (parsed.command === "cleanup") {
    args.push("--platform=codex", ...parsed.args);
  } else {
    args.push(...parsed.args);
  }
  return { command: "npx", args, delegatesToOmo: true };
}
function buildLazyCodexDoctorInvocation(doctorArgs) {
  const doctorOptions = parseLazyCodexDoctorOptions(doctorArgs);
  const codexArgs = [
    "exec",
    "--ephemeral",
    "--sandbox",
    "danger-full-access",
    "--skip-git-repo-check",
    "--cd",
    "."
  ];
  if (doctorOptions.model !== undefined)
    codexArgs.push("--model", doctorOptions.model);
  codexArgs.push(buildLazyCodexDoctorPrompt(doctorOptions.args));
  return {
    command: "codex",
    args: codexArgs,
    delegatesToOmo: false,
    env: {
      LAZYCODEX_DOCTOR_LCX_ACTIVE: "1",
      ...doctorOptions.sourceRoot === undefined ? {} : { LAZYCODEX_SOURCE_ROOT: doctorOptions.sourceRoot }
    }
  };
}
function buildLazyCodexDoctorPrompt(doctorArgs) {
  return [
    "Use $omo:lcx-doctor to diagnose this LazyCodex/Codex installation.",
    "This command is already the lazycodex doctor surface; never invoke lazycodex doctor from inside the doctor workflow.",
    "Use the resolved source root from LAZYCODEX_SOURCE_ROOT when set; otherwise use ${TMPDIR:-/tmp}/lazycodex-sources.",
    "Validate cached source checkouts before reuse, quarantine corrupt caches, and do not rely on /tmp/lazycodex-source.",
    "Sync the latest LazyCodex and OpenAI Codex sources there, inventory the local installation,",
    "probe the Codex plugin/cache/hooks/MCP state, and report PASS/WARN/FAIL findings with evidence and remediations.",
    buildDoctorOutputInstruction(doctorArgs),
    doctorArgs.length > 0 ? `Requested doctor arguments: ${doctorArgs.join(" ")}` : "Requested doctor arguments: none"
  ].join(" ");
}
function parseLazyCodexDoctorOptions(doctorArgs) {
  const args = [];
  let model;
  let sourceRoot;
  let index = 0;
  while (index < doctorArgs.length) {
    const arg = doctorArgs[index];
    if (arg === "--model") {
      const value = doctorArgs[index + 1];
      if (typeof value !== "string" || value.trim().length === 0)
        throw new Error("--model requires a value");
      model = value;
      index += 2;
      continue;
    }
    if (typeof arg === "string" && arg.startsWith("--model=")) {
      const value = arg.slice("--model=".length);
      if (value.trim().length === 0)
        throw new Error("--model requires a value");
      model = value;
      index += 1;
      continue;
    }
    if (arg === "--source-root") {
      const value = doctorArgs[index + 1];
      if (typeof value !== "string" || value.trim().length === 0)
        throw new Error("--source-root requires a path");
      sourceRoot = value;
      index += 2;
      continue;
    }
    if (typeof arg === "string" && arg.startsWith("--source-root=")) {
      const value = arg.slice("--source-root=".length);
      if (value.trim().length === 0)
        throw new Error("--source-root requires a path");
      sourceRoot = value;
      index += 1;
      continue;
    }
    args.push(arg);
    index += 1;
  }
  return { args, ...model === undefined ? {} : { model }, ...sourceRoot === undefined ? {} : { sourceRoot } };
}
function buildDoctorOutputInstruction(doctorArgs) {
  if (doctorArgs.includes("--json")) {
    return "Return exactly one JSON object with summary, environment, checks, remediations, and knownIssues fields; do not wrap it in Markdown.";
  }
  return "Return the standard Markdown LazyCodex Doctor Report.";
}
function formatShellCommand(command, args) {
  return [command, ...args].map(shellQuote).join(" ");
}
function shellQuote(value) {
  if (/^[A-Za-z0-9_/:=.,@%+-]+$/.test(value))
    return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

// packages/omo-codex/src/install/lazycodex-manual-update.ts
import { spawn as spawn3, spawnSync as spawnSync2 } from "node:child_process";
import { readFileSync as readFileSync5 } from "node:fs";
import { dirname as dirname12, join as join37 } from "node:path";
import { createInterface as createInterface2 } from "node:readline/promises";
import { fileURLToPath } from "node:url";

// packages/omo-codex/src/install/lazycodex-bun-global-paths.ts
import { join as join36 } from "node:path";
function isBunGlobalEntrypointPath(invokedPath, env) {
  if (typeof invokedPath !== "string" || invokedPath.trim().length === 0)
    return false;
  const normalizedPath = normalizePathForPrefix(invokedPath);
  return resolveBunGlobalRoots(env).some((root) => normalizedPath.startsWith(root));
}
function resolveBunGlobalRoots(env) {
  const bunInstallRoot = env.BUN_INSTALL?.trim();
  const homeRoot = env.HOME?.trim();
  return [
    ...bunInstallRoot ? [join36(bunInstallRoot, "bin"), join36(bunInstallRoot, "install", "global", "node_modules")] : [],
    ...homeRoot ? [join36(homeRoot, ".bun", "bin"), join36(homeRoot, ".bun", "install", "global", "node_modules")] : []
  ].map(normalizePathForPrefix);
}
function normalizePathForPrefix(path) {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/, "");
  return normalized.endsWith("/node_modules") || normalized.endsWith("/bin") ? `${normalized}/` : normalized;
}

// packages/omo-codex/src/install/lazycodex-manual-update.ts
var DEFAULT_UPDATE_COMMAND = "npx";
var DEFAULT_UPDATE_ARGS = ["--yes", "lazycodex-ai@latest", "install", "--no-tui", "--codex-autonomous"];
var BUN_UPDATE_COMMAND = "bun";
var BUN_GLOBAL_UPDATE_ARGS = ["update", "-g", "lazycodex-ai@latest"];
var BUN_GLOBAL_UNTRUSTED_ARGS = ["pm", "-g", "untrusted"];
var BUN_GLOBAL_TRUST_ARGS = ["pm", "-g", "trust"];
var INSTALLED_VERSION_FILE = "lazycodex-install.json";
var KNOWN_LAZYCODEX_BUN_TRUST_PACKAGES = new Set([
  "@ast-grep/cli",
  "@code-yeongyu/comment-checker",
  "@sisyphuslabs/omo-codex-plugin",
  "lazycodex-ai",
  "oh-my-openagent",
  "oh-my-opencode"
]);
var KNOWN_LAZYCODEX_BUN_TRUST_PREFIXES = ["@oh-my-opencode/", "oh-my-openagent-", "oh-my-opencode-"];
async function runLazyCodexManualUpdate(input = {}) {
  const env = input.env ?? process.env;
  const log = input.log ?? console.log;
  const commandRunner = input.runCommand ?? defaultRunCommandForManualUpdate;
  const currentVersion = resolveCurrentVersion(env);
  const latestVersion = resolveLatestVersion(env);
  const plan = resolveLazyCodexUpdatePlan({
    currentVersion,
    latestVersion,
    command: resolveCommand2(env),
    args: resolveArgs(env),
    env,
    invokedPath: input.invokedPath ?? process.argv[1]
  });
  if (!plan.shouldUpdate) {
    const printableVersion = currentVersion ?? "unknown";
    log(plan.reason === "up-to-date" ? `lazycodex-ai ${printableVersion} is already up to date.` : `Unable to check lazycodex-ai updates (${plan.reason}).`);
    return plan.reason === "up-to-date" ? 0 : 1;
  }
  if (input.dryRun) {
    log(`${plan.command} ${plan.args.join(" ")}`);
    if (plan.postUpdate === "bun-global-trust")
      log(`${DEFAULT_UPDATE_COMMAND} ${DEFAULT_UPDATE_ARGS.join(" ")}`);
    return 0;
  }
  await commandRunner(plan.command, plan.args, { cwd: process.cwd(), env });
  if (plan.postUpdate === "bun-global-trust") {
    await handleBunGlobalTrust({
      env,
      log,
      commandRunner,
      isInteractive: input.isInteractive ?? (process.stdin.isTTY === true && process.stdout.isTTY === true)
    });
    await commandRunner(DEFAULT_UPDATE_COMMAND, DEFAULT_UPDATE_ARGS, { cwd: process.cwd(), env });
  }
  return 0;
}
function resolveLazyCodexUpdatePlan(input = {}) {
  const current = parseVersion(input.currentVersion);
  if (current === null)
    return { shouldUpdate: false, reason: "unknown-current" };
  const latest = parseVersion(input.latestVersion);
  if (latest === null)
    return { shouldUpdate: false, reason: "unknown-latest" };
  if (compareVersions(latest, current) <= 0)
    return { shouldUpdate: false, reason: "up-to-date" };
  if (isBunGlobalEntrypoint(input.invokedPath, input.env ?? process.env)) {
    return { shouldUpdate: true, command: BUN_UPDATE_COMMAND, args: BUN_GLOBAL_UPDATE_ARGS, postUpdate: "bun-global-trust" };
  }
  return { shouldUpdate: true, command: input.command ?? DEFAULT_UPDATE_COMMAND, args: input.args ?? DEFAULT_UPDATE_ARGS, postUpdate: "none" };
}
function resolveCommand2(env) {
  return env.LAZYCODEX_AUTO_UPDATE_COMMAND?.trim() || DEFAULT_UPDATE_COMMAND;
}
function resolveArgs(env) {
  if (env.LAZYCODEX_AUTO_UPDATE_ARGS_JSON) {
    const parsed = JSON.parse(env.LAZYCODEX_AUTO_UPDATE_ARGS_JSON);
    if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string")) {
      throw new TypeError("LAZYCODEX_AUTO_UPDATE_ARGS_JSON must be a JSON string array");
    }
    return parsed;
  }
  return DEFAULT_UPDATE_ARGS;
}
function resolveCurrentVersion(env) {
  if (env.LAZYCODEX_CURRENT_VERSION?.trim())
    return env.LAZYCODEX_CURRENT_VERSION.trim();
  const pluginRoot = dirname12(dirname12(fileURLToPath(import.meta.url)));
  return readVersionManifest(resolveInstalledVersionPath(env, pluginRoot)) ?? readVersionManifest(join37(pluginRoot, "..", "..", "..", "package.json")) ?? readVersionManifest(join37(pluginRoot, ".codex-plugin", "plugin.json"));
}
function resolveLatestVersion(env) {
  if (env.LAZYCODEX_LATEST_VERSION?.trim())
    return env.LAZYCODEX_LATEST_VERSION.trim();
  const result = spawnSync2("npm", ["view", "lazycodex-ai", "version", "--silent"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  if (result.status !== 0)
    return;
  const version = result.stdout.trim();
  return version.length > 0 ? version : undefined;
}
async function handleBunGlobalTrust(input) {
  const packageNames = resolveKnownBunGlobalUntrustedPackages(input.env);
  if (packageNames.length === 0)
    return;
  const trustArgs = [...BUN_GLOBAL_TRUST_ARGS, ...packageNames];
  const trustCommand = [BUN_UPDATE_COMMAND, ...trustArgs].join(" ");
  if (!input.isInteractive) {
    input.log(`Bun blocked LazyCodex-related postinstall scripts. Run this command to trust them:
${trustCommand}`);
    return;
  }
  if (await confirmBunGlobalTrust(packageNames)) {
    await input.commandRunner(BUN_UPDATE_COMMAND, trustArgs, { cwd: process.cwd(), env: input.env });
    return;
  }
  input.log(`Skipped Bun postinstall trust. To run it later:
${trustCommand}`);
}
function resolveKnownBunGlobalUntrustedPackages(env) {
  const result = spawnSync2(BUN_UPDATE_COMMAND, BUN_GLOBAL_UNTRUSTED_ARGS, {
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "ignore"]
  });
  if (result.status !== 0)
    return [];
  const names = [];
  for (const match of result.stdout.matchAll(/^\.\/node_modules\/((?:@[^/\s]+\/)?[^\s]+)\s+@/gm)) {
    const packageName = match[1];
    if (packageName !== undefined && isKnownLazyCodexBunTrustPackage(packageName) && !names.includes(packageName)) {
      names.push(packageName);
    }
  }
  return names;
}
async function confirmBunGlobalTrust(packageNames) {
  const prompt = `Trust Bun postinstall scripts for ${packageNames.join(", ")}? [y/N] `;
  const readline = createInterface2({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await readline.question(prompt)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    readline.close();
  }
}
function isKnownLazyCodexBunTrustPackage(packageName) {
  return KNOWN_LAZYCODEX_BUN_TRUST_PACKAGES.has(packageName) || KNOWN_LAZYCODEX_BUN_TRUST_PREFIXES.some((prefix) => packageName.startsWith(prefix));
}
function isBunGlobalEntrypoint(invokedPath, env) {
  return isBunGlobalEntrypointPath(invokedPath, env);
}
function defaultRunCommandForManualUpdate(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn3(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: "inherit",
      shell: false
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with ${code ?? "unknown status"}`));
    });
  });
}
function parseVersion(version) {
  if (typeof version !== "string")
    return null;
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([^+]+))?(?:\+.*)?$/.exec(version.trim());
  if (match === null)
    return null;
  const major = Number.parseInt(match[1] ?? "", 10);
  const minor = Number.parseInt(match[2] ?? "", 10);
  const patch = Number.parseInt(match[3] ?? "", 10);
  const prerelease = match[4];
  return Number.isFinite(major) && Number.isFinite(minor) && Number.isFinite(patch) ? { major, minor, patch, prerelease } : null;
}
function compareVersions(left, right) {
  for (const key of ["major", "minor", "patch"]) {
    const leftValue = left[key];
    const rightValue = right[key];
    if (leftValue > rightValue)
      return 1;
    if (leftValue < rightValue)
      return -1;
  }
  if (left.prerelease === undefined && right.prerelease !== undefined)
    return 1;
  if (left.prerelease !== undefined && right.prerelease === undefined)
    return -1;
  if (left.prerelease !== undefined && right.prerelease !== undefined) {
    return left.prerelease.localeCompare(right.prerelease);
  }
  return 0;
}
function resolveInstalledVersionPath(env, pluginRoot) {
  if (env.LAZYCODEX_INSTALLED_VERSION_FILE?.trim())
    return env.LAZYCODEX_INSTALLED_VERSION_FILE.trim();
  return join37(pluginRoot, INSTALLED_VERSION_FILE);
}
function readVersionManifest(path) {
  try {
    const parsed = JSON.parse(readFileSync5(path, "utf8"));
    if (typeof parsed === "object" && parsed !== null && "version" in parsed && typeof parsed.version === "string") {
      return parsed.version;
    }
    return;
  } catch (error) {
    if (error instanceof Error)
      return;
    return;
  }
}
// packages/omo-codex/src/install/codex-git-bash-mcp-env.ts
import { readFile as readFile23, writeFile as writeFile13 } from "node:fs/promises";
import { join as join38 } from "node:path";
var GIT_BASH_ENV_KEY2 = "OMO_CODEX_GIT_BASH_PATH";
async function stampGitBashMcpEnv(input) {
  const manifestPath = join38(input.pluginRoot, ".mcp.json");
  if (!await fileExistsStrict(manifestPath))
    return false;
  const parsed = JSON.parse(await readFile23(manifestPath, "utf8"));
  if (!isPlainRecord(parsed) || !isPlainRecord(parsed["mcpServers"]))
    return false;
  let changed = false;
  if (input.platform === "win32") {
    const rawOverride = input.env?.[GIT_BASH_ENV_KEY2];
    const override = typeof rawOverride === "string" ? rawOverride.trim() : "";
    const gitBashServer = parsed["mcpServers"]["git_bash"];
    if (override !== "" && isPlainRecord(gitBashServer)) {
      const serverEnv = isPlainRecord(gitBashServer["env"]) ? gitBashServer["env"] : {};
      if (serverEnv[GIT_BASH_ENV_KEY2] !== override) {
        gitBashServer["env"] = { ...serverEnv, [GIT_BASH_ENV_KEY2]: override };
        changed = true;
      }
    }
  }
  if (!changed)
    return false;
  await writeFile13(manifestPath, `${JSON.stringify(parsed, null, "\t")}
`);
  return true;
}

// packages/omo-codex/src/install/install-local-cli.ts
async function installMarketplaceLocally(options = {}) {
  return runCodexInstaller(options);
}
function resolveDefaultRepoRootForEntrypoint(entrypointPath) {
  return resolve11(dirname13(entrypointPath), "..", "..", "..");
}
function resolveDefaultRepoRoot() {
  return resolveDefaultRepoRootForEntrypoint(fileURLToPath2(import.meta.url));
}
async function runLazyCodexInstallLocalCli(input) {
  const logWarning = (message) => {
    if (message.startsWith("Warning:"))
      input.log(message);
  };
  const parsed = parseLazyCodexInstallCliArgs(input.argv);
  if (parsed.kind === "help") {
    input.log(formatLazyCodexInstallHelp());
    return 0;
  }
  if (parsed.kind === "version") {
    const packageJson = JSON.parse(await readFile24(join39(input.defaultRepoRoot, "package.json"), "utf8"));
    const version = typeof packageJson.version === "string" ? packageJson.version : "unknown";
    input.log(`lazycodex-ai ${version}`);
    return 0;
  }
  if (parsed.kind === "command") {
    await runDelegatedOmoCommand(parsed, { cwd: input.cwd, log: input.log, runCommand: defaultRunCommand });
    return 0;
  }
  if (parsed.kind === "update") {
    if (parsed.repoRoot) {
      if (parsed.dryRun) {
        input.log(`node ${input.entrypointPath} install --repo-root=${parsed.repoRoot}`);
        return 0;
      }
      const result = await installMarketplaceLocally({
        repoRoot: resolve11(parsed.repoRoot),
        autonomousPermissions: true,
        env: input.env,
        log: logWarning
      });
      input.log(`Installed ${result.installed.length} plugin(s) from ${result.marketplaceName}.`);
      return 0;
    }
    return runLazyCodexManualUpdate({ env: input.env, dryRun: parsed.dryRun, log: input.log, invokedPath: input.invokedPath });
  }
  const repoRoot = parsed.repoRoot ? resolve11(parsed.repoRoot) : input.defaultRepoRoot;
  const result = await installMarketplaceLocally({
    repoRoot,
    autonomousPermissions: parsed.autonomousPermissions,
    env: input.env,
    log: logWarning
  });
  input.log(`Installed ${result.installed.length} plugin(s) from ${result.marketplaceName}.`);
  return 0;
}
export {
  PASSTHROUGH_COMMANDS,
  assertHookCommandTargets,
  buildDelegatedOmoInvocation,
  findMissingHookCommandTargets,
  formatLazyCodexInstallHelp,
  installCachedPlugin,
  installMarketplaceLocally,
  linkCachedPluginBins,
  linkRootRuntimeBin,
  parseLazyCodexInstallCliArgs,
  readCodexModelCatalog,
  repairNearestProjectLocalCodexArtifacts,
  resolveCodexInstallerBinDir,
  resolveDefaultRepoRoot,
  resolveDefaultRepoRootForEntrypoint,
  runDelegatedOmoCommand,
  runLazyCodexInstallLocalCli,
  stampGitBashMcpEnv,
  updateCodexConfig
};
