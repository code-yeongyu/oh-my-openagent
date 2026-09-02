var __defProp = Object.defineProperty;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};

// ../../../../telemetry-core/src/activity-state.ts
import { existsSync, mkdirSync as mkdirSync2, readFileSync } from "node:fs";
import { basename, join } from "node:path";

// ../../../../utils/src/atomic-write.ts
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
import { dirname } from "node:path";
var TOLERATED_FSYNC_CODES = new Set([
  "EPERM",
  "EACCES",
  "ENOTSUP",
  "EINVAL"
]);
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
    const directoryFileDescriptor = openSync(dirname(filePath), "r");
    try {
      tolerantFsyncSync(directoryFileDescriptor, fsyncImpl);
    } finally {
      closeSync(directoryFileDescriptor);
    }
  } finally {
    rmSync(tempPath, { force: true });
  }
}

// ../../../../utils/src/xdg-data-dir.ts
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

// ../../../../telemetry-core/src/activity-state.ts
var POSTHOG_ACTIVITY_STATE_FILE = "posthog-activity.json";
function resolveTelemetryStateDir(product, options = {}) {
  const dataDir = resolveXdgDataDir(product.cacheDirName, {
    env: options.env,
    osProvider: options.osProvider
  });
  const xdgStateDir = options.env?.XDG_DATA_HOME === undefined ? undefined : join(options.env.XDG_DATA_HOME, product.cacheDirName);
  if (dataDir === xdgStateDir || xdgStateDir === undefined && basename(dataDir) === product.cacheDirName) {
    return dataDir;
  }
  return join(dataDir, product.cacheDirName);
}
function getTelemetryActivityStateFilePath(stateDir) {
  return join(stateDir, POSTHOG_ACTIVITY_STATE_FILE);
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
  if (!existsSync(stateFilePath)) {
    return {};
  }
  try {
    const stateContent = readFileSync(stateFilePath, "utf-8");
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

// ../../../../telemetry-core/src/constants.ts
var DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";
var DEFAULT_POSTHOG_API_KEY = "phc_CFJhj5HyvA62QPhvyaUCtaq23aUfznnijg5VaaGkNk74";
var UNCONFIGURED_POSTHOG_API_KEY = "phc_REPLACE_ME_OMO_NATIVE";

// ../../../../telemetry-core/src/diagnostics.ts
import { appendFileSync, existsSync as existsSync2, mkdirSync as mkdirSync3, readFileSync as readFileSync2 } from "node:fs";
import { join as join2 } from "node:path";
var DIAGNOSTICS_FILE_NAME = "telemetry-diagnostics.jsonl";
var DIAGNOSTICS_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
var DIAGNOSTICS_MAX_BYTES = 256 * 1024;
function getTelemetryDiagnosticsFilePath(diagnosticsDir) {
  return join2(diagnosticsDir, DIAGNOSTICS_FILE_NAME);
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
  if (!existsSync2(diagnosticsFilePath)) {
    return;
  }
  try {
    const cutoffMs = (options.now ?? new Date).getTime() - DIAGNOSTICS_RETENTION_MS;
    const retainedLines = trimToMaxBytes(readFileSync2(diagnosticsFilePath, "utf-8").split(`
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
    if (!isRecord(parsed)) {
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
function isRecord(value) {
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

// ../../../../telemetry-core/src/env.ts
var TRUTHY_DISABLE_VALUES = ["1", "true", "yes"];
var SEND_OPT_OUT_VALUES = ["0", "false", "no", "yes"];
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

// ../../../../../node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/extensions/error-tracking/modifiers/module.node.mjs
import { dirname as dirname2, posix, sep } from "path";
function createModulerModifier() {
  const getModuleFromFileName = createGetModuleFromFilename();
  return async (frames) => {
    for (const frame of frames)
      frame.module = getModuleFromFileName(frame.filename);
    return frames;
  };
}
function createGetModuleFromFilename(basePath = process.argv[1] ? dirname2(process.argv[1]) : process.cwd(), isWindows = sep === "\\") {
  const normalizedBase = isWindows ? normalizeWindowsPath(basePath) : basePath;
  return (filename) => {
    if (!filename)
      return;
    const normalizedFilename = isWindows ? normalizeWindowsPath(filename) : filename;
    let { dir, base: file, ext } = posix.parse(normalizedFilename);
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
function normalizeWindowsPath(path2) {
  return path2.replace(/^[A-Z]:/, "").replace(/\\/g, "/");
}

// ../../../../../node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/featureFlagUtils.mjs
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
};
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
var getFlagValuesFromFlags = (flags) => Object.fromEntries(Object.entries(flags ?? {}).map(([key, detail]) => [
  key,
  getFeatureFlagValue(detail)
]).filter(([, value]) => value !== undefined));
var getPayloadsFromFlags = (flags) => {
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
};
var getFeatureFlagValue = (detail) => detail === undefined ? undefined : detail.variant ?? detail.enabled;
var parsePayload = (response) => {
  if (typeof response != "string")
    return response;
  try {
    return JSON.parse(response);
  } catch {
    return response;
  }
};
var MINIMAL_FLAG_CALLED_EVENT_CAMPAIGN_PROPERTIES = [
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
var MINIMAL_FLAG_CALLED_EVENT_PROPERTIES = [
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
var minimizeFlagCalledEventProperties = (properties, transportKeys = []) => {
  const minimal = {};
  const copyKey = (key) => {
    if (properties[key] !== undefined)
      minimal[key] = properties[key];
  };
  MINIMAL_FLAG_CALLED_EVENT_PROPERTIES.forEach(copyKey);
  transportKeys.forEach(copyKey);
  return minimal;
};

// ../../../../../node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/types.mjs
var types_PostHogPersistedProperty = /* @__PURE__ */ function(PostHogPersistedProperty) {
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

// ../../../../../node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/gzip.mjs
function isGzipSupported() {
  return "CompressionStream" in globalThis && "TextEncoder" in globalThis && "Response" in globalThis && typeof Response.prototype.blob == "function";
}
var NATIVE_GZIP_VALIDATION_ERROR = "NativeGzipValidationError";
var GZIP_MAGIC_FIRST_BYTE = 31;
var GZIP_MAGIC_SECOND_BYTE = 139;
var GZIP_DEFLATE_METHOD = 8;
var hasGzipMagic = (bytes) => bytes.length >= 2 && bytes[0] === GZIP_MAGIC_FIRST_BYTE && bytes[1] === GZIP_MAGIC_SECOND_BYTE;
var crc32Table;
var getCrc32Table = () => {
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
};
var crc32 = (bytes) => {
  const table = getCrc32Table();
  let crc = 4294967295;
  for (let i = 0;i < bytes.length; i++)
    crc = table[(crc ^ bytes[i]) & 255] ^ crc >>> 8;
  return (4294967295 ^ crc) >>> 0;
};
var throwNativeGzipValidationError = (reason) => {
  const error = new Error(`Native gzip produced invalid output: ${reason}`);
  error.name = NATIVE_GZIP_VALIDATION_ERROR;
  throw error;
};
var validateNativeGzip = async (compressed, inputBytes) => {
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

// ../../../../../node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/utils/json-utils.mjs
var MAX_JSON_SAFE_VALUE_DEPTH = 20;
var MAX_JSON_SAFE_VALUE_ITEMS = 1000;
var MAX_JSON_SAFE_VALUE_NODES = 1e4;
var CIRCULAR_VALUE = "[Circular]";
var TRUNCATED_VALUE = "[Truncated]";
var UNSERIALIZABLE_VALUE = "[Unserializable]";
var FUNCTION_VALUE = "[Function]";
var dateGetTime = Date.prototype.getTime;
var dateToISOString = Date.prototype.toISOString;
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

// ../../../../../node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/utils/bot-detection.mjs
var DEFAULT_BLOCKED_UA_STRS = [
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
var isBlockedUA = function(ua, customBlockedUserAgents = []) {
  if (!ua)
    return false;
  const uaLower = ua.toLowerCase();
  return DEFAULT_BLOCKED_UA_STRS.concat(customBlockedUserAgents).some((blockedUA) => {
    const blockedUaLower = blockedUA.toLowerCase();
    return uaLower.indexOf(blockedUaLower) !== -1;
  });
};
// ../../../../../node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/utils/string-utils.mjs
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
// ../../../../../node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/utils/type-utils.mjs
var nativeIsArray = Array.isArray;
var ObjProto = Object.prototype;
var type_utils_hasOwnProperty = ObjProto.hasOwnProperty;
var type_utils_toString = ObjProto.toString;
var isArray = nativeIsArray || function(obj) {
  return type_utils_toString.call(obj) === "[object Array]";
};
var isObject = (x) => x === Object(x) && !isArray(x);
var isUndefined = (x) => x === undefined;
var isString = (x) => type_utils_toString.call(x) == "[object String]";
var isEmptyString = (x) => isString(x) && x.trim().length === 0;
var isNull = (x) => x === null;
var isNullish = (x) => isUndefined(x) || isNull(x);
var isNumber = (x) => type_utils_toString.call(x) == "[object Number]" && x === x;
var isBoolean = (x) => type_utils_toString.call(x) === "[object Boolean]";
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
function isErrorEvent(event) {
  return isBuiltin(event, "ErrorEvent");
}
function isEvent(candidate) {
  return typeof Event != "undefined" && isInstanceOf(candidate, Event);
}
function isPlainObject(candidate) {
  return isBuiltin(candidate, "Object");
}
function isInstanceOf(candidate, base) {
  try {
    return candidate instanceof base;
  } catch {
    return false;
  }
}

// ../../../../../node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/utils/number-utils.mjs
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

// ../../../../../node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/utils/bucketed-rate-limiter.mjs
var ONE_DAY_IN_MS = 86400000;
var DEFAULT_EXCEPTION_RATE_LIMITER_REFILL_RATE = 1;
var DEFAULT_EXCEPTION_RATE_LIMITER_BUCKET_SIZE = 10;
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
// ../../../../../node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/vendor/uuidv7.mjs
/*! For license information please see uuidv7.mjs.LICENSE.txt */
var DIGITS = "0123456789abcdef";

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
var getDefaultRandom = () => ({
  nextUint32: () => 65536 * Math.trunc(65536 * Math.random()) + Math.trunc(65536 * Math.random())
});
var defaultGenerator;
var uuidv7 = () => uuidv7obj().toString();
var uuidv7obj = () => (defaultGenerator || (defaultGenerator = new V7Generator)).generate();

// ../../../../../node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/utils/promise-queue.mjs
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
// ../../../../../node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/utils/logger.mjs
function createConsole(consoleLike = console) {
  const lockedMethods = {
    log: consoleLike.log.bind(consoleLike),
    warn: consoleLike.warn.bind(consoleLike),
    error: consoleLike.error.bind(consoleLike),
    debug: consoleLike.debug.bind(consoleLike)
  };
  return lockedMethods;
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
};
var passThrough = (fn) => fn();
function createLogger(prefix, maybeCall = passThrough) {
  return _createLogger(prefix, maybeCall, createConsole());
}
// ../../../../../node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/utils/user-agent-utils.mjs
var MOBILE = "Mobile";
var IOS = "iOS";
var ANDROID = "Android";
var TABLET = "Tablet";
var ANDROID_TABLET = ANDROID + " " + TABLET;
var APPLE = "Apple";
var APPLE_WATCH = APPLE + " Watch";
var SAFARI = "Safari";
var BLACKBERRY = "BlackBerry";
var SAMSUNG = "Samsung";
var SAMSUNG_BROWSER = SAMSUNG + "Browser";
var SAMSUNG_INTERNET = SAMSUNG + " Internet";
var CHROME = "Chrome";
var CHROME_OS = CHROME + " OS";
var CHROME_IOS = CHROME + " " + IOS;
var INTERNET_EXPLORER = "Internet Explorer";
var INTERNET_EXPLORER_MOBILE = INTERNET_EXPLORER + " " + MOBILE;
var OPERA = "Opera";
var OPERA_MINI = OPERA + " Mini";
var EDGE = "Edge";
var MICROSOFT_EDGE = "Microsoft " + EDGE;
var FIREFOX = "Firefox";
var FIREFOX_IOS = FIREFOX + " " + IOS;
var NINTENDO = "Nintendo";
var PLAYSTATION = "PlayStation";
var XBOX = "Xbox";
var ANDROID_MOBILE = ANDROID + " " + MOBILE;
var MOBILE_SAFARI = MOBILE + " " + SAFARI;
var WINDOWS = "Windows";
var WINDOWS_PHONE = WINDOWS + " Phone";
var GENERIC = "Generic";
var GENERIC_MOBILE = GENERIC + " " + MOBILE.toLowerCase();
var GENERIC_TABLET = GENERIC + " " + TABLET.toLowerCase();
var KONQUEROR = "Konqueror";
var OCULUS_BROWSER = "Oculus Browser";
var VIVALDI = "Vivaldi";
var YANDEX = "Yandex";
var WHALE = "Whale";
var DUCKDUCKGO = "DuckDuckGo";
var PALE_MOON = "Pale Moon";
var WATERFOX = "Waterfox";
var BRAVE = "Brave";
var GOOGLE_SEARCH_APP = "Google Search App";
var BROWSER_VERSION_REGEX_SUFFIX = "(\\d+(\\.\\d+)?)";
var DEFAULT_BROWSER_VERSION_REGEX = new RegExp("Version/" + BROWSER_VERSION_REGEX_SUFFIX);
var XBOX_REGEX = new RegExp(XBOX, "i");
var PLAYSTATION_REGEX = new RegExp(PLAYSTATION + " \\w+", "i");
var NINTENDO_REGEX = new RegExp(NINTENDO + " \\w+", "i");
var BLACKBERRY_REGEX = new RegExp(BLACKBERRY + "|PlayBook|BB10", "i");
var windowsVersionMap = {
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
var versionRegexes = {
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
var osMatchers = [
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

// ../../../../../node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/utils/index.mjs
var STRING_FORMAT = "utf8";
var UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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

// ../../../../../node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/logs/logs-utils.mjs
var OTLP_SEVERITY_MAP = {
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
var DEFAULT_OTLP_SEVERITY = OTLP_SEVERITY_MAP.info;
var INT64_RANGE_LIMIT = 9223372036854776000;
var propertyIsEnumerable = Object.prototype.propertyIsEnumerable;
function newState() {
  return {
    ancestors: new WeakSet,
    remainingNodes: MAX_JSON_SAFE_VALUE_NODES
  };
}
function toOtlpKeyValueList(attrs, logger2) {
  try {
    return encodeKeyValueList(attrs, logger2, newState(), 0);
  } catch {
    return [];
  }
}
function encodeAnyValue(value, logger2, state, depth) {
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
        logger2?.debug(`Attribute ${decimal} is outside the int64 range; encoding it as a string`);
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
          return encodeAnyValue(toJSON.call(value), logger2, state, depth + 1);
      } catch {}
      if (isArray(value))
        return {
          arrayValue: {
            values: encodeArrayValues(value, logger2, state, depth + 1)
          }
        };
      return {
        kvlistValue: {
          values: encodeKeyValueList(value, logger2, state, depth + 1)
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
function encodeArrayValues(values, logger2, state, depth) {
  const result = [];
  const itemCount = Math.min(values.length, MAX_JSON_SAFE_VALUE_ITEMS);
  let index = 0;
  for (;index < itemCount && state.remainingNodes > 0; index++)
    try {
      const element = index in values ? values[index] : undefined;
      if (isNullish(element))
        continue;
      result.push(encodeAnyValue(element, logger2, state, depth));
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
function encodeKeyValueList(attrs, logger2, state, depth) {
  const result = [];
  for (const key in attrs)
    if (propertyIsEnumerable.call(attrs, key)) {
      if (result.length >= MAX_JSON_SAFE_VALUE_ITEMS || state.remainingNodes <= 0) {
        logger2?.debug("Attributes truncated: the value exceeds the OTLP encoder budget");
        break;
      }
      try {
        const value = attrs[key];
        if (isNull(value) || isUndefined(value))
          continue;
        result.push({
          key: sanitizeString(key),
          value: encodeAnyValue(value, logger2, state, depth)
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

// ../../../../../node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/metrics/metrics-utils.mjs
var DEFAULT_HISTOGRAM_BOUNDS = [
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

// ../../../../../node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/metrics/config.mjs
var DEFAULT_FLUSH_INTERVAL_MS = 1e4;
var DEFAULT_MAX_SERIES_PER_FLUSH = 1000;
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

// ../../../../../node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/metrics/index.mjs
var OTLP_TEMPORALITY_DELTA = 1;

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
// ../../../../../node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/eventemitter.mjs
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

// ../../../../../node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/index.mjs
var exports_error_tracking = {};
__export(exports_error_tracking, {
  winjsStackLineParser: () => winjsStackLineParser,
  stripReservedExceptionStepFields: () => stripReservedExceptionStepFields,
  reverseAndStripFrames: () => reverseAndStripFrames,
  resolveExceptionStepsConfig: () => resolveExceptionStepsConfig,
  opera11StackLineParser: () => opera11StackLineParser,
  opera10StackLineParser: () => opera10StackLineParser,
  nodeStackLineParser: () => nodeStackLineParser,
  getUtf8ByteLength: () => getUtf8ByteLength,
  getInjectedReleaseId: () => getInjectedReleaseId,
  geckoStackLineParser: () => geckoStackLineParser,
  createStackParser: () => createStackParser,
  createDefaultStackParser: () => createDefaultStackParser,
  chromeStackLineParser: () => chromeStackLineParser,
  StringCoercer: () => StringCoercer,
  ReduceableCache: () => ReduceableCache,
  PromiseRejectionEventCoercer: () => PromiseRejectionEventCoercer,
  PrimitiveCoercer: () => PrimitiveCoercer,
  ObjectCoercer: () => ObjectCoercer,
  ExceptionStepsBuffer: () => ExceptionStepsBuffer,
  EventCoercer: () => EventCoercer,
  ErrorPropertiesBuilder: () => ErrorPropertiesBuilder,
  ErrorEventCoercer: () => ErrorEventCoercer,
  ErrorCoercer: () => ErrorCoercer,
  EXCEPTION_STEP_INTERNAL_FIELDS: () => EXCEPTION_STEP_INTERNAL_FIELDS,
  DOMExceptionCoercer: () => DOMExceptionCoercer,
  DEFAULT_EXCEPTION_STEPS_CONFIG: () => DEFAULT_EXCEPTION_STEPS_CONFIG
});

// ../../../../../node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/chunk-ids.mjs
var parsedStackResults;
var lastKeysCount;
var cachedFilenameChunkIds;
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

// ../../../../../node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/error-properties-builder.mjs
var MAX_CAUSE_RECURSION = 4;

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
    const coerce = (input, depth2) => {
      if (!(depth2 <= MAX_CAUSE_RECURSION))
        return;
      {
        const ctx = this.buildCoercingContext(mechanism, hint, depth2);
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
// ../../../../../node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/parsers/base.mjs
var UNKNOWN_FUNCTION = "?";
var MASKED_URL_PREFIX = "webkit-masked-url://";
var ANONYMOUS_FILENAME = "<anonymous>";
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

// ../../../../../node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/parsers/safari.mjs
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

// ../../../../../node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/parsers/chrome.mjs
var chromeRegexNoFnName = /^\s*at (\S+?)(?::(\d+))(?::(\d+))\s*$/i;
var chromeRegex = /^\s*at (?:(.+?\)(?: \[.+\])?|.*?) ?\((?:address at )?)?(?:async )?((?:<anonymous>|[-a-z]+:|.*bundle|\/)?.*?)(?::(\d+))?(?::(\d+))?\)?\s*$/i;
var chromeEvalRegex = /\((\S*)(?::(\d+))(?::(\d+))\)/;
var chromeStackLineParser = (line, platform) => {
  const noFnParts = chromeRegexNoFnName.exec(line);
  if (noFnParts) {
    const [, filename, line2, col] = noFnParts;
    return createFrame(platform, filename, UNKNOWN_FUNCTION, +line2, +col);
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

// ../../../../../node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/parsers/gecko.mjs
var geckoREgex = /^\s*(.*?)(?:\((.*?)\))?(?:^|@)?((?:[-a-z]+)?:\/.*?|\[native code\]|[^@]*(?:bundle|\d+\.js)|\/[\w\-. /=]+)(?::(\d+))?(?::(\d+))?\s*$/i;
var geckoEvalRegex = /(\S+) line (\d+)(?: > eval line \d+)* > eval/i;
var geckoStackLineParser = (line, platform) => {
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

// ../../../../../node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/parsers/winjs.mjs
var winjsRegex = /^\s*at (?:((?:\[object object\])?.+) )?\(?((?:[-a-z]+):.*?):(\d+)(?::(\d+))?\)?\s*$/i;
var winjsStackLineParser = (line, platform) => {
  const parts = winjsRegex.exec(line);
  return parts ? createFrame(platform, parts[2], parts[1] || UNKNOWN_FUNCTION, +parts[3], parts[4] ? +parts[4] : undefined) : undefined;
};

// ../../../../../node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/parsers/opera.mjs
var opera10Regex = / line (\d+).*script (?:in )?(\S+)(?:: in function (\S+))?$/i;
var opera10StackLineParser = (line, platform) => {
  const parts = opera10Regex.exec(line);
  return parts ? createFrame(platform, parts[2], parts[3] || UNKNOWN_FUNCTION, +parts[1]) : undefined;
};
var opera11Regex = / line (\d+), column (\d+)\s*(?:in (?:<anonymous function: ([^>]+)>|([^)]+))\(.*\))? in (.*):\s*$/i;
var opera11StackLineParser = (line, platform) => {
  const parts = opera11Regex.exec(line);
  return parts ? createFrame(platform, parts[5], parts[3] || parts[4] || UNKNOWN_FUNCTION, +parts[1], +parts[2]) : undefined;
};

// ../../../../../node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/parsers/node.mjs
var FILENAME_MATCH = /^\s*[-]{4,}$/;
var FULL_MATCH = /at (?:async )?(?:(.+?)\s+\()?(?:(.+):(\d+):(\d+)?|([^)]+))\)?/;
var PROMISE_COMBINATOR = /^Promise\.(?:all|any)$/;
var PROMISE_INDEX = /^index \d+$/;
var PROMISE_FRAME_FILENAME = "node:internal/promise";
var nodeStackLineParser = (line, platform) => {
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
function filenameIsInApp(filename, isNative = false) {
  const isInternal = isNative || filename && !filename.startsWith("/") && !filename.match(/^[A-Z]:/) && !filename.startsWith(".") && !filename.match(/^[a-zA-Z]([a-zA-Z0-9.\-+])*:\/\//);
  return !isInternal && filename !== undefined && !filename.includes("node_modules/");
}
function _parseIntOrUndefined(input) {
  return parseInt(input || "", 10) || undefined;
}

// ../../../../../node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/parsers/index.mjs
var WEBPACK_ERROR_REGEXP = /\(error: (.*)\)/;
var STACKTRACE_FRAME_LIMIT = 50;
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
// ../../../../../node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/coercers/dom-exception-coercer.mjs
class DOMExceptionCoercer {
  match(err) {
    return this.isDOMException(err) || this.isDOMError(err);
  }
  coerce(err, ctx) {
    const hasStack = isString(err.stack);
    return {
      type: this.getType(err),
      value: this.getValue(err),
      stack: hasStack ? err.stack : undefined,
      cause: err.cause ? ctx.next(err.cause) : undefined,
      synthetic: false
    };
  }
  getType(candidate) {
    return this.isDOMError(candidate) ? "DOMError" : "DOMException";
  }
  getValue(err) {
    const name = err.name || (this.isDOMError(err) ? "DOMError" : "DOMException");
    const message = err.message ? `${name}: ${err.message}` : name;
    return message;
  }
  isDOMException(err) {
    return isBuiltin(err, "DOMException");
  }
  isDOMError(err) {
    return isBuiltin(err, "DOMError");
  }
}
// ../../../../../node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/coercers/error-coercer.mjs
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
// ../../../../../node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/coercers/error-event-coercer.mjs
class ErrorEventCoercer {
  constructor() {}
  match(err) {
    if (!isErrorEvent(err))
      return false;
    const errorEvent = err;
    return errorEvent.error != null || this._hasUsableMessage(errorEvent);
  }
  coerce(err, ctx) {
    if (err.error != null)
      return ctx.apply(err.error);
    const exceptionLike = ctx.apply(err.message);
    return {
      ...exceptionLike,
      stack: this._buildLocationStack(err) ?? exceptionLike.stack,
      synthetic: true
    };
  }
  _hasUsableMessage(err) {
    return isString(err.message) && err.message.length > 0;
  }
  _buildLocationStack(err) {
    const location = err;
    const lineno = location.lineno ?? 0;
    const colno = location.colno ?? 0;
    if (!isString(location.filename) || location.filename.length === 0)
      return;
    if (lineno === 0)
      return;
    return `Error
    at ${location.filename}:${lineno}:${colno}`;
  }
}
// ../../../../../node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/coercers/string-coercer.mjs
var ERROR_TYPES_PATTERN = /^(?:[Uu]ncaught (?:exception: )?)?(?:((?:Eval|Internal|Range|Reference|Syntax|Type|URI|)Error): )?(.*)$/i;

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
// ../../../../../node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/types.mjs
var severityLevels = [
  "fatal",
  "error",
  "warning",
  "log",
  "info",
  "debug"
];

// ../../../../../node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/coercers/utils.mjs
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

// ../../../../../node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/coercers/object-coercer.mjs
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
// ../../../../../node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/coercers/event-coercer.mjs
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
// ../../../../../node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/coercers/primitive-coercer.mjs
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
// ../../../../../node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/coercers/promise-rejection-event.mjs
class PromiseRejectionEventCoercer {
  match(err) {
    return isBuiltin(err, "PromiseRejectionEvent") || this.isCustomEventWrappingRejection(err);
  }
  isCustomEventWrappingRejection(err) {
    if (!isEvent(err))
      return false;
    try {
      const detail = err.detail;
      return detail != null && typeof detail == "object" && "reason" in detail;
    } catch {
      return false;
    }
  }
  coerce(err, ctx) {
    const reason = this.getUnhandledRejectionReason(err);
    if (isPrimitive(reason))
      return {
        type: "UnhandledRejection",
        value: `Non-Error promise rejection captured with value: ${String(reason)}`,
        stack: ctx.syntheticException?.stack,
        synthetic: true
      };
    return ctx.apply(reason);
  }
  getUnhandledRejectionReason(error) {
    try {
      if ("reason" in error)
        return error.reason;
      if ("detail" in error && error.detail != null && typeof error.detail == "object" && "reason" in error.detail)
        return error.detail.reason;
    } catch {}
    return error;
  }
}
// ../../../../../node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/utils.mjs
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
// ../../../../../node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/exception-steps.mjs
var EXCEPTION_STEP_INTERNAL_FIELDS = {
  MESSAGE: "$message",
  TIMESTAMP: "$timestamp"
};
var RESERVED_EXCEPTION_STEP_KEYS = new Set([
  EXCEPTION_STEP_INTERNAL_FIELDS.MESSAGE,
  EXCEPTION_STEP_INTERNAL_FIELDS.TIMESTAMP
]);
var DEFAULT_EXCEPTION_STEPS_CONFIG = {
  enabled: true,
  max_bytes: 32768
};
function resolveExceptionStepsConfig(config) {
  if (!config)
    return {
      ...DEFAULT_EXCEPTION_STEPS_CONFIG
    };
  return {
    enabled: config.enabled ?? DEFAULT_EXCEPTION_STEPS_CONFIG.enabled,
    max_bytes: normalizePositiveInteger(config.max_bytes, DEFAULT_EXCEPTION_STEPS_CONFIG.max_bytes)
  };
}
function stripReservedExceptionStepFields(properties) {
  if (!properties)
    return {
      sanitizedProperties: {},
      droppedKeys: []
    };
  const droppedKeys = [];
  const sanitizedProperties = Object.keys(properties).reduce((acc, key) => {
    if (RESERVED_EXCEPTION_STEP_KEYS.has(key)) {
      droppedKeys.push(key);
      return acc;
    }
    acc[key] = properties[key];
    return acc;
  }, {});
  return {
    sanitizedProperties,
    droppedKeys
  };
}

class ExceptionStepsBuffer {
  constructor(config) {
    this._entries = [];
    this._totalBytes = 0;
    this._config = resolveExceptionStepsConfig(config);
  }
  setConfig(config) {
    this._config = resolveExceptionStepsConfig(config);
    this._trimToMaxBytes();
  }
  add(step) {
    const serialized = normalizeAndSerializeStep(step);
    if (!serialized)
      return;
    const bytes = getUtf8ByteLength(serialized.json);
    if (bytes > this._config.max_bytes)
      return;
    this._entries.push({
      step: serialized.step,
      bytes
    });
    this._totalBytes += bytes;
    this._trimToMaxBytes();
  }
  getAttachable() {
    return this._entries.map((e) => e.step);
  }
  clear() {
    this._entries = [];
    this._totalBytes = 0;
  }
  size() {
    return this._entries.length;
  }
  _trimToMaxBytes() {
    while (this._totalBytes > this._config.max_bytes && this._entries.length > 0) {
      const evicted = this._entries.shift();
      if (evicted)
        this._totalBytes -= evicted.bytes;
    }
  }
}
function normalizePositiveInteger(input, fallback) {
  if (!isNumber(input) || input === 1 / 0 || input === -1 / 0)
    return fallback;
  const normalized = Math.floor(input);
  if (normalized < 0)
    return fallback;
  return normalized;
}
function normalizeAndSerializeStep(step) {
  let json;
  try {
    json = safeJsonStringify(step);
  } catch {
    return;
  }
  try {
    const parsed = JSON.parse(json);
    if (!isObject(parsed))
      return;
    const parsedStep = parsed;
    const message = parsedStep[EXCEPTION_STEP_INTERNAL_FIELDS.MESSAGE];
    const timestamp = parsedStep[EXCEPTION_STEP_INTERNAL_FIELDS.TIMESTAMP];
    if (!isString(message) || message.trim().length === 0)
      return;
    if (!isString(timestamp) && !isNumber(timestamp))
      return;
    return {
      step: parsedStep,
      json
    };
  } catch {
    return;
  }
}
function getUtf8ByteLength(value) {
  if (typeof TextEncoder != "undefined")
    return new TextEncoder().encode(value).length;
  const encoded = encodeURIComponent(value);
  let byteLength = 0;
  for (let i = 0;i < encoded.length; i++)
    if (encoded[i] === "%") {
      byteLength += 1;
      i += 2;
    } else
      byteLength += 1;
  return byteLength;
}
// ../../../../../node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/error-tracking/release.mjs
function getInjectedReleaseId() {
  const injected = globalThis._posthogReleaseId;
  return typeof injected == "string" && injected.length > 0 ? injected : undefined;
}
// ../../../../../node_modules/.bun/@posthog+core@1.48.9/node_modules/@posthog/core/dist/posthog-core-stateless.mjs
class PostHogFetchHttpError extends Error {
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
}

class PostHogFetchNetworkError extends Error {
  constructor(error) {
    super("Network error while fetching PostHog", error instanceof Error ? {
      cause: error
    } : {}), this.error = error, this.name = "PostHogFetchNetworkError";
  }
}
var applyCallerFeatureFlagOverrides = (target, callerProperties) => {
  for (const key of Object.keys(callerProperties))
    if (key.startsWith("$feature/") || key === "$active_feature_flags")
      target[key] = callerProperties[key];
};
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
var DEFAULT_QUEUE_ROUTE = "default";

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
      consume: (response2) => {
        if (response2.status !== 200 || !response2.json) {
          const msg = `Surveys API could not be loaded: ${response2.status}`;
          const error = new Error(msg);
          this._logger.error(error);
          this._events.emit("error", new Error(msg));
          return Promise.resolve(undefined);
        }
        return response2.json();
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
// ../../../../../node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/extensions/error-tracking/modifiers/context-lines.node.mjs
import { constants as constants2 } from "node:fs";
import { open as promises_open } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { createInterface } from "node:readline";
var LRU_FILE_CONTENTS_CACHE = new exports_error_tracking.ReduceableCache(25);
var LRU_FILE_CONTENTS_FS_READ_FAILED = new exports_error_tracking.ReduceableCache(20);
var DEFAULT_LINES_OF_CONTEXT = 7;
var MAX_CONTEXTLINES_COLNO = 1000;
var MAX_CONTEXTLINES_LINENO = 1e4;
var MAX_CONTEXTLINES_FILE_SIZE = 10485760;
async function addSourceContext(frames, openSourceFile = promises_open, logger2) {
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
    if (!isAbsolute(filename) && basePath === undefined)
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
    readlinePromises.push(getContextLinesFromFile(file, ranges, cache, cacheKey, openSourceFile, logger2));
  }
  await Promise.all(readlinePromises).catch(() => {});
  if (frames && frames.length > 0)
    addSourceContextToFrames(frames, LRU_FILE_CONTENTS_CACHE, basePath);
  LRU_FILE_CONTENTS_CACHE.reduce();
  return frames;
}
async function openRegularSourceFile(path2, openSourceFile, logger2) {
  let fileHandle;
  let isValid = false;
  try {
    fileHandle = await openSourceFile(path2, constants2.O_RDONLY | constants2.O_NONBLOCK);
    const fileStat = await fileHandle.stat();
    if (!fileStat.isFile())
      return;
    if (fileStat.size > MAX_CONTEXTLINES_FILE_SIZE)
      return void logger2?.debug(`Skipping source context for oversized file ${path2}: ${fileStat.size} bytes exceeds ${MAX_CONTEXTLINES_FILE_SIZE}`);
    isValid = true;
    return fileHandle;
  } catch {
    return;
  } finally {
    if (fileHandle && !isValid)
      await fileHandle.close().catch(() => {});
  }
}
async function getContextLinesFromFile(path2, ranges, output, cacheKey, openSourceFile, logger2) {
  const fileHandle = await openRegularSourceFile(path2, openSourceFile, logger2);
  if (fileHandle === undefined)
    return void LRU_FILE_CONTENTS_FS_READ_FAILED.set(cacheKey, 1);
  const openedFileHandle = fileHandle;
  return new Promise((resolve) => {
    let finished = false;
    function destroyStreamAndResolve(stream2) {
      if (finished)
        return;
      finished = true;
      stream2?.destroy();
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
        const range2 = ranges[currentRangeIndex];
        if (range2 === undefined) {
          lineReaded.close();
          lineReaded.removeAllListeners();
          return;
        }
        rangeStart = range2[0];
        rangeEnd = range2[1];
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
function shouldSkipContextLinesForFile(path2) {
  return path2.startsWith("node:") || path2.endsWith(".min.js") || path2.endsWith(".min.cjs") || path2.endsWith(".min.mjs") || path2.startsWith("data:");
}
function shouldSkipContextLinesForFrame(frame) {
  if (frame.lineno !== undefined && frame.lineno > MAX_CONTEXTLINES_LINENO)
    return true;
  if (frame.colno !== undefined && frame.colno > MAX_CONTEXTLINES_COLNO)
    return true;
  return false;
}
function makeSourceCacheKey(path2, basePath) {
  if (isAbsolute(path2))
    return JSON.stringify([
      null,
      path2
    ]);
  return basePath === undefined ? undefined : JSON.stringify([
    basePath,
    path2
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

// ../../../../../node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/extensions/error-tracking/modifiers/relative-path.node.mjs
import { isAbsolute as isAbsolute2, relative, sep as sep2 } from "path";
function createRelativePathModifier(basePath = process.cwd()) {
  const isWindows = sep2 === "\\";
  const toUnix = (p) => isWindows ? p.replace(/\\/g, "/") : p;
  const normalizedBase = toUnix(basePath);
  return async (frames) => {
    for (const frame of frames)
      if (!(!frame.filename || frame.filename.startsWith("node:") || frame.filename.startsWith("data:"))) {
        if (isAbsolute2(frame.filename))
          frame.filename = toUnix(relative(normalizedBase, toUnix(frame.filename)));
      }
    return frames;
  };
}

// ../../../../../node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/version.mjs
var version = "5.51.1";

// ../../../../../node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/types.mjs
var FeatureFlagError2 = {
  ERRORS_WHILE_COMPUTING: "errors_while_computing_flags",
  FLAG_MISSING: "flag_missing",
  QUOTA_LIMITED: "quota_limited",
  UNKNOWN_ERROR: "unknown_error"
};

// ../../../../../node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/feature-flag-evaluations.mjs
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

// ../../../../../node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/extensions/feature-flags/crypto.mjs
async function hashSHA1(text) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle)
    throw new Error("SubtleCrypto API not available");
  const hashBuffer = await subtle.digest("SHA-1", new TextEncoder().encode(text));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// ../../../../../node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/extensions/feature-flags/feature-flags.mjs
var SIXTY_SECONDS = 60000;
var LONG_SCALE = 1152921504606847000;
var NULL_VALUES_ALLOWED_OPERATORS = [
  "is_not",
  "is_set"
];

class ClientError extends Error {
  constructor(message) {
    super();
    Error.captureStackTrace(this, this.constructor);
    this.name = "ClientError";
    this.message = message;
    Object.setPrototypeOf(this, ClientError.prototype);
  }
}
function setCustomErrorPrototype(error, constructor) {
  error.name = constructor.name;
  Error.captureStackTrace(error, constructor);
  Object.setPrototypeOf(error, constructor.prototype);
}

class InconclusiveMatchError extends Error {
  constructor(message) {
    super(message);
    setCustomErrorPrototype(this, InconclusiveMatchError);
  }
}

class RequiresServerEvaluation extends Error {
  constructor(message) {
    super(message);
    setCustomErrorPrototype(this, RequiresServerEvaluation);
  }
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
  function computeExactMatch(value2, overrideValue2) {
    if (Array.isArray(value2))
      return value2.map((val) => String(val).toLowerCase()).includes(String(overrideValue2).toLowerCase());
    return String(value2).toLowerCase() === String(overrideValue2).toLowerCase();
  }
  function compare(lhs, rhs, operator2) {
    if (operator2 === "gt")
      return lhs > rhs;
    if (operator2 === "gte")
      return lhs >= rhs;
    if (operator2 === "lt")
      return lhs < rhs;
    if (operator2 === "lte")
      return lhs <= rhs;
    throw new Error(`Invalid operator: ${operator2}`);
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

// ../../../../../node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/extensions/error-tracking/autocapture.mjs
var UNHANDLED_REJECTION_OPTION_NAMES = [
  "--unhandled-rejections",
  "--unhandled_rejections"
];
var UNHANDLED_REJECTION_MODES = new Set([
  "throw",
  "strict",
  "warn",
  "warn-with-error-code",
  "none"
]);
var STARTUP_EXEC_ARGV = [
  ...globalThis.process?.execArgv ?? []
];
var STARTUP_NODE_OPTIONS = globalThis.process?.env?.NODE_OPTIONS;
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
var STARTUP_UNHANDLED_REJECTION_MODE = getUnhandledRejectionMode();
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

// ../../../../../node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/extensions/error-tracking/index.mjs
var SHUTDOWN_TIMEOUT = 2000;

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
    return isObject(x) && "__posthog_previously_captured_error" in x && x.__posthog_previously_captured_error === true;
  }
  static async buildEventMessage(builder, error, hint, distinctId, additionalProperties) {
    const properties = {
      ...additionalProperties
    };
    const exceptionProperties = builder.buildFromUnknown(error, hint);
    exceptionProperties.$exception_list = await builder.modifyFrames(exceptionProperties.$exception_list);
    const injectedReleaseId = exports_error_tracking.getInjectedReleaseId();
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

// ../../../../../node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/storage-memory.mjs
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

// ../../../../../node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/capture-v1/config.mjs
function isCaptureMode(value) {
  return value === "v0" || value === "v1";
}
function resolveCaptureMode() {
  const envMode = typeof process != "undefined" ? process.env?.POSTHOG_CAPTURE_MODE : undefined;
  return isCaptureMode(envMode) ? envMode : "v0";
}

// ../../../../../node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/capture-v1/routing.mjs
var AI_EVENT_PREFIX = "$ai_";
var ANALYTICS_ROUTE = "analytics";
var AI_ROUTE = "ai";
function isLegacyOnlyEvent(message) {
  return typeof message.event == "string" && message.event.startsWith(AI_EVENT_PREFIX);
}

// ../../../../../node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/capture-v1/errors.mjs
class CaptureV1Error extends Error {
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
}

// ../../../../../node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/capture-v1/transform.mjs
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
var OPTION_SENTINELS = [
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
var TOPLEVEL_SENTINELS = [
  {
    property: "$session_id",
    field: "session_id"
  },
  {
    property: "$window_id",
    field: "window_id"
  }
];
function isRecord2(value) {
  return typeof value == "object" && value !== null && !Array.isArray(value);
}
function toRfc3339(timestamp) {
  if (typeof timestamp == "string") {
    const asDate2 = new Date(timestamp);
    if (Number.isNaN(asDate2.getTime()))
      return new Date().toISOString();
    const normalized = asDate2.toISOString();
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
  const sourceProperties = isRecord2(message.properties) ? message.properties : {};
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

// ../../../../../node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/capture-v1/sender.mjs
var V1_ANALYTICS_PATH = "/i/v1/analytics/events";
var DEFAULT_MAX_BACKOFF_MS = 30000;
var RETRYABLE_STATUSES = new Set([
  408,
  500,
  502,
  503,
  504
]);

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

// ../../../../../node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/ai-capture/routing.mjs
var AI_CAPTURE_ROUTE = "ai-capture";
var AI_CAPTURE_ENDPOINT_PATH = "/i/v0/ai/batch/";
var AI_MAX_EVENT_BYTES = 8388608;
var AI_BATCH_TARGET_BYTES = 5242880;

// ../../../../../node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/ai-capture/batching.mjs
var encoder = new TextEncoder;
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

// ../../../../../node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/client.mjs
var MINIMUM_POLLING_INTERVAL = 100;
var THIRTY_SECONDS = 30000;
var MAX_CACHE_SIZE = 50000;
var WAITUNTIL_DEBOUNCE_MS = 50;
var WAITUNTIL_MAX_WAIT_MS = 500;
var DEFAULT_NODE_HOST = "https://us.i.posthog.com";
var _emittedDeprecations = new Set;
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

class PostHogBackendClient extends PostHogCoreStateless {
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
    return version;
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
      if (isPlainObject(value) && groups && key in groups) {
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
}

// ../../../../../node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/extensions/context/context.mjs
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

// ../../../../../node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/gzip.node.mjs
import { gzip } from "node:zlib";
import { promisify } from "node:util";
var gzipAsync = promisify(gzip);
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

// ../../../../../node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/extensions/sentry-integration.mjs
var NAME = "posthog-node";
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
    const injectedReleaseId = exports_error_tracking.getInjectedReleaseId();
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
class PostHogSentryIntegration {
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
}
// ../../../../../node_modules/.bun/posthog-node@5.51.1/node_modules/posthog-node/dist/entrypoints/index.node.mjs
class PostHog extends PostHogBackendClient {
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
    return new exports_error_tracking.ErrorPropertiesBuilder([
      new exports_error_tracking.EventCoercer,
      new exports_error_tracking.ErrorCoercer,
      new exports_error_tracking.ObjectCoercer,
      new exports_error_tracking.StringCoercer,
      new exports_error_tracking.PrimitiveCoercer
    ], exports_error_tracking.createStackParser("node:javascript", exports_error_tracking.nodeStackLineParser), [
      createModulerModifier(),
      (frames) => addSourceContext(frames, undefined, this._logger),
      createRelativePathModifier()
    ]);
  }
}

// ../../../../telemetry-core/src/machine-id.ts
import { createHash } from "node:crypto";
import os2 from "node:os";
function getDefaultTelemetryOsProvider() {
  return os2;
}
function getTelemetryDistinctId(machineIdPrefix, osProvider = getDefaultTelemetryOsProvider()) {
  return createHash("sha256").update(`${machineIdPrefix}${osProvider.hostname()}`).digest("hex");
}

// ../../../../telemetry-core/src/posthog-client.ts
var NO_OP_CLIENT = {
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

// src/product-identity.ts
import { readFileSync as readFileSync3 } from "node:fs";
var PRODUCT_NAME = "omo-codex";
var PACKAGE_NAME = "@oh-my-opencode/omo-codex";
var CACHE_DIR_NAME = "omo-codex";
var EVENT_NAME = "omo_codex_daily_active";
var PRODUCT_ENV_PREFIX = "OMO_CODEX";
var MACHINE_ID_PREFIX = "omo-codex:";
function isComponentPackageManifest(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function readComponentVersionFromManifest() {
  try {
    const manifestUrl = new URL("../package.json", import.meta.url);
    const manifestText = readFileSync3(manifestUrl, "utf-8");
    const parsed = JSON.parse(manifestText);
    if (isComponentPackageManifest(parsed) && typeof parsed.version === "string") {
      return parsed.version;
    }
  } catch (error) {
    if (error instanceof Error) {
      return "0.0.0";
    }
    return "0.0.0";
  }
  return "0.0.0";
}
var COMPONENT_VERSION_CACHE = readComponentVersionFromManifest();
function getComponentVersion() {
  return COMPONENT_VERSION_CACHE;
}
function createComponentTelemetryProductConfig(additionalProperties) {
  const product = {
    cacheDirName: CACHE_DIR_NAME,
    defaultApiKey: DEFAULT_POSTHOG_API_KEY,
    defaultHost: DEFAULT_POSTHOG_HOST,
    eventName: EVENT_NAME,
    machineIdPrefix: MACHINE_ID_PREFIX,
    packageName: PACKAGE_NAME,
    packageVersion: getComponentVersion(),
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
function getComponentTelemetryStateDir() {
  return resolveTelemetryStateDir(createComponentTelemetryProductConfig());
}
function writeComponentTelemetryDiagnostic(input, now = new Date) {
  writeTelemetryDiagnostic(input, {
    diagnosticsDir: getComponentTelemetryStateDir(),
    now
  });
}
// src/posthog.ts
var NO_OP_POSTHOG = {
  trackActive: () => {
    return;
  },
  shutdown: async () => {
    return;
  }
};
function resolveOsProvider(options) {
  return options.osProvider ?? getDefaultTelemetryOsProvider();
}
function resolveActivityStateProvider(options) {
  if (options.activityStateProvider !== undefined) {
    return options.activityStateProvider;
  }
  if (options.stateDir === undefined) {
    return () => getDailyActiveCaptureState(createDailyActiveCaptureStateInput(getComponentTelemetryStateDir(), options.now));
  }
  const stateDir = options.stateDir;
  return () => getDailyActiveCaptureState(createDailyActiveCaptureStateInput(stateDir, options.now));
}
function createDailyActiveCaptureStateInput(stateDir, now) {
  if (now === undefined) {
    return {
      diagnostics: writeComponentTelemetryDiagnostic,
      stateDir
    };
  }
  return {
    diagnostics: writeComponentTelemetryDiagnostic,
    now,
    stateDir
  };
}
function createPluginPostHogClient(options = {}) {
  const clientInput = {
    diagnostics: writeComponentTelemetryDiagnostic,
    env: options.env ?? process.env,
    osProvider: resolveOsProvider(options),
    product: createComponentTelemetryProductConfig({
      runtime: "node",
      runtime_version: process.version
    }),
    source: "plugin"
  };
  const client = createTelemetryClient(options.transportFactory === undefined ? clientInput : {
    ...clientInput,
    transportFactory: options.transportFactory
  });
  if (!client.enabled) {
    return NO_OP_POSTHOG;
  }
  const activityStateProvider = resolveActivityStateProvider(options);
  return {
    trackActive: (distinctId, reason) => {
      const activityState = activityStateProvider();
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
async function createPluginPostHog() {
  return createPluginPostHogClient();
}
function getPostHogDistinctId() {
  return getTelemetryDistinctId(MACHINE_ID_PREFIX, getDefaultTelemetryOsProvider());
}
function __createPluginPostHogForTesting(options) {
  return createPluginPostHogClient(options);
}
function getPostHogDistinctIdForTesting(osProvider) {
  return getTelemetryDistinctId(MACHINE_ID_PREFIX, osProvider);
}
export {
  getPostHogDistinctIdForTesting,
  getPostHogDistinctId,
  getComponentVersion,
  createPluginPostHog,
  __createPluginPostHogForTesting,
  DEFAULT_POSTHOG_HOST,
  DEFAULT_POSTHOG_API_KEY
};
