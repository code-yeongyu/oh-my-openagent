#!/usr/bin/env node
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
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);

// packages/utils/src/xdg-data-dir.ts
import { accessSync as accessSync2, constants as constants2, mkdirSync } from "node:fs";
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
    accessSync2(preferredDir, constants2.W_OK);
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
  unlinkSync,
  writeFileSync
} from "node:fs";
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
  const tempPath = `${filePath}.tmp`;
  writeFileSync(tempPath, content, "utf-8");
  const tempFileDescriptor = openSync(tempPath, "r+");
  try {
    tolerantFsyncSync(tempFileDescriptor, options.fsyncSync ?? fsyncSync);
  } finally {
    closeSync(tempFileDescriptor);
  }
  try {
    renameSync(tempPath, filePath);
  } catch (error) {
    const isPermissionError = error instanceof Error && (error.message.includes("EPERM") || error.message.includes("EACCES"));
    if ((options.platform ?? process.platform) === "win32" && isPermissionError) {
      unlinkSync(filePath);
      renameSync(tempPath, filePath);
      return;
    }
    throw error;
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
import { existsSync as existsSync5, mkdirSync as mkdirSync2, readFileSync } from "node:fs";
import { basename as basename6, join as join29 } from "node:path";
function resolveTelemetryStateDir(product, options = {}) {
  const dataDir = resolveXdgDataDir(product.cacheDirName, {
    env: options.env,
    osProvider: options.osProvider
  });
  const xdgStateDir = options.env?.XDG_DATA_HOME === undefined ? undefined : join29(options.env.XDG_DATA_HOME, product.cacheDirName);
  if (dataDir === xdgStateDir || xdgStateDir === undefined && basename6(dataDir) === product.cacheDirName) {
    return dataDir;
  }
  return join29(dataDir, product.cacheDirName);
}
function getTelemetryActivityStateFilePath(stateDir) {
  return join29(stateDir, POSTHOG_ACTIVITY_STATE_FILE);
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
var POSTHOG_ACTIVITY_STATE_FILE = "posthog-activity.json";
var init_activity_state = __esm(() => {
  init_atomic_write();
  init_xdg_data_dir();
});

// packages/telemetry-core/src/constants.ts
var DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com", DEFAULT_POSTHOG_API_KEY = "phc_CFJhj5HyvA62QPhvyaUCtaq23aUfznnijg5VaaGkNk74";

// packages/telemetry-core/src/diagnostics.ts
import { appendFileSync, existsSync as existsSync6, mkdirSync as mkdirSync3, readFileSync as readFileSync2 } from "node:fs";
import { join as join30 } from "node:path";
function getTelemetryDiagnosticsFilePath(diagnosticsDir) {
  return join30(diagnosticsDir, DIAGNOSTICS_FILE_NAME);
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
    if (!isRecord2(parsed)) {
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
function isRecord2(value) {
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
  const env2 = input.env ?? process.env;
  const globalPrefix = input.globalEnvPrefix ?? "OMO";
  const prefixes = Array.from(new Set([globalPrefix, input.productEnvPrefix]));
  for (const prefix of prefixes) {
    if (isDisableFlag(env2[`${prefix}_DISABLE_POSTHOG`])) {
      return true;
    }
    if (isSendOptOutFlag(env2[`${prefix}_SEND_ANONYMOUS_TELEMETRY`])) {
      return true;
    }
  }
  return false;
}
function getTelemetryApiKey(env2 = process.env, defaultApiKey = DEFAULT_POSTHOG_API_KEY) {
  return env2["POSTHOG_API_KEY"]?.trim() ?? defaultApiKey;
}
function getTelemetryHost(env2 = process.env, defaultHost = DEFAULT_POSTHOG_HOST) {
  return env2["POSTHOG_HOST"]?.trim() || defaultHost;
}
var TRUTHY_DISABLE_VALUES, SEND_OPT_OUT_VALUES;
var init_env = __esm(() => {
  TRUTHY_DISABLE_VALUES = ["1", "true", "yes"];
  SEND_OPT_OUT_VALUES = ["0", "false", "no", "yes"];
});

// packages/telemetry-core/src/machine-id.ts
import { createHash as createHash2 } from "node:crypto";
import os2 from "node:os";
function getDefaultTelemetryOsProvider() {
  return os2;
}
function getTelemetryDistinctId(machineIdPrefix, osProvider = getDefaultTelemetryOsProvider()) {
  return createHash2("sha256").update(`${machineIdPrefix}${osProvider.hostname()}`).digest("hex");
}
var init_machine_id = () => {};

// node_modules/.bun/posthog-node@5.35.12/node_modules/posthog-node/dist/extensions/error-tracking/modifiers/module.node.mjs
import { dirname as dirname8, posix, sep as sep7 } from "node:path";
function createModulerModifier() {
  const getModuleFromFileName = createGetModuleFromFilename();
  return async (frames) => {
    for (const frame of frames)
      frame.module = getModuleFromFileName(frame.filename);
    return frames;
  };
}
function createGetModuleFromFilename(basePath = process.argv[1] ? dirname8(process.argv[1]) : process.cwd(), isWindows = sep7 === "\\") {
  const normalizedBase = isWindows ? normalizeWindowsPath(basePath) : basePath;
  return (filename) => {
    if (!filename)
      return;
    const normalizedFilename = isWindows ? normalizeWindowsPath(filename) : filename;
    let { dir, base: file2, ext } = posix.parse(normalizedFilename);
    if (ext === ".js" || ext === ".mjs" || ext === ".cjs")
      file2 = file2.slice(0, -1 * ext.length);
    const decodedFile = decodeURIComponent(file2);
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
var init_module_node = () => {};

// node_modules/.bun/@posthog+core@1.30.3/node_modules/@posthog/core/dist/featureFlagUtils.mjs
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
};
var init_featureFlagUtils = () => {};

// node_modules/.bun/@posthog+core@1.30.3/node_modules/@posthog/core/dist/types.mjs
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
    PostHogPersistedProperty["SurveyLastSeenDate"] = "survey_last_seen_date";
    PostHogPersistedProperty["SurveysSeen"] = "surveys_seen";
    PostHogPersistedProperty["Surveys"] = "surveys";
    PostHogPersistedProperty["RemoteConfig"] = "remote_config";
    PostHogPersistedProperty["FlagsEndpointWasHit"] = "flags_endpoint_was_hit";
    PostHogPersistedProperty["DeviceId"] = "device_id";
    return PostHogPersistedProperty;
  }({});
});

// node_modules/.bun/@posthog+core@1.30.3/node_modules/@posthog/core/dist/gzip.mjs
function isGzipSupported() {
  return "CompressionStream" in globalThis && "TextEncoder" in globalThis && "Response" in globalThis && typeof Response.prototype.blob == "function";
}
async function gzipCompress(input, isDebug = true, options) {
  try {
    const inputBytes = new TextEncoder().encode(input);
    const compressedStream = new CompressionStream("gzip");
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

// node_modules/.bun/@posthog+core@1.30.3/node_modules/@posthog/core/dist/utils/bot-detection.mjs
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

// node_modules/.bun/@posthog+core@1.30.3/node_modules/@posthog/core/dist/utils/string-utils.mjs
var init_string_utils = () => {};

// node_modules/.bun/@posthog+core@1.30.3/node_modules/@posthog/core/dist/utils/type-utils.mjs
function isPrimitive(value) {
  return value === null || typeof value != "object";
}
function isBuiltin(candidate, className) {
  return Object.prototype.toString.call(candidate) === `[object ${className}]`;
}
function isErrorEvent(event) {
  return isBuiltin(event, "ErrorEvent");
}
function isEvent(candidate) {
  return typeof Event != "undefined" && isInstanceOf(candidate, Event);
}
function isPlainObject2(candidate) {
  return isBuiltin(candidate, "Object");
}
function isInstanceOf(candidate, base) {
  try {
    return candidate instanceof base;
  } catch {
    return false;
  }
}
var nativeIsArray, ObjProto, type_utils_hasOwnProperty, type_utils_toString, isArray, isObject = (x) => x === Object(x) && !isArray(x), isUndefined = (x) => x === undefined, isString = (x) => type_utils_toString.call(x) == "[object String]", isEmptyString = (x) => isString(x) && x.trim().length === 0, isNumber = (x) => type_utils_toString.call(x) == "[object Number]" && x === x, isPlainError = (x) => x instanceof Error;
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

// node_modules/.bun/@posthog+core@1.30.3/node_modules/@posthog/core/dist/utils/number-utils.mjs
function clampToRange(value, min, max, logger3, fallbackValue) {
  if (min > max) {
    logger3.warn("min cannot be greater than max.");
    min = max;
  }
  if (isNumber(value))
    if (value > max) {
      logger3.warn(" cannot be  greater than max: " + max + ". Using max value instead.");
      return max;
    } else {
      if (!(value < min))
        return value;
      logger3.warn(" cannot be less than min: " + min + ". Using min value instead.");
      return min;
    }
  logger3.warn(" must be a number. using max or fallback. max: " + max + ", fallback: " + fallbackValue);
  return clampToRange(fallbackValue || max, min, max, logger3);
}
var init_number_utils = __esm(() => {
  init_type_utils();
});

// node_modules/.bun/@posthog+core@1.30.3/node_modules/@posthog/core/dist/utils/bucketed-rate-limiter.mjs
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
var ONE_DAY_IN_MS = 86400000;
var init_bucketed_rate_limiter = __esm(() => {
  init_number_utils();
});

// node_modules/.bun/@posthog+core@1.30.3/node_modules/@posthog/core/dist/vendor/uuidv7.mjs
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

// node_modules/.bun/@posthog+core@1.30.3/node_modules/@posthog/core/dist/utils/promise-queue.mjs
class PromiseQueue {
  add(promise) {
    const promiseUUID = uuidv7();
    this.promiseByIds[promiseUUID] = promise;
    promise.catch(() => {}).finally(() => {
      delete this.promiseByIds[promiseUUID];
    });
    return promise;
  }
  async join() {
    let promises = Object.values(this.promiseByIds);
    let length = promises.length;
    while (length > 0) {
      await Promise.all(promises);
      promises = Object.values(this.promiseByIds);
      length = promises.length;
    }
  }
  get length() {
    return Object.keys(this.promiseByIds).length;
  }
  constructor() {
    this.promiseByIds = {};
  }
}
var init_promise_queue = __esm(() => {
  init_uuidv7();
});

// node_modules/.bun/@posthog+core@1.30.3/node_modules/@posthog/core/dist/utils/logger.mjs
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
  const logger3 = {
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
  return logger3;
}, passThrough = (fn) => fn();
var init_logger = () => {};

// node_modules/.bun/@posthog+core@1.30.3/node_modules/@posthog/core/dist/utils/user-agent-utils.mjs
var MOBILE = "Mobile", IOS = "iOS", ANDROID = "Android", TABLET = "Tablet", ANDROID_TABLET, APPLE = "Apple", APPLE_WATCH, SAFARI = "Safari", BLACKBERRY = "BlackBerry", SAMSUNG = "Samsung", SAMSUNG_BROWSER, SAMSUNG_INTERNET, CHROME = "Chrome", CHROME_OS, CHROME_IOS, INTERNET_EXPLORER = "Internet Explorer", INTERNET_EXPLORER_MOBILE, OPERA = "Opera", OPERA_MINI, EDGE = "Edge", MICROSOFT_EDGE, FIREFOX = "Firefox", FIREFOX_IOS, NINTENDO = "Nintendo", PLAYSTATION = "PlayStation", XBOX = "Xbox", ANDROID_MOBILE, MOBILE_SAFARI, WINDOWS = "Windows", WINDOWS_PHONE, GENERIC = "Generic", GENERIC_MOBILE, GENERIC_TABLET, KONQUEROR = "Konqueror", OCULUS_BROWSER = "Oculus Browser", VIVALDI = "Vivaldi", YANDEX = "Yandex", WHALE = "Whale", DUCKDUCKGO = "DuckDuckGo", PALE_MOON = "Pale Moon", WATERFOX = "Waterfox", BRAVE = "Brave", BROWSER_VERSION_REGEX_SUFFIX = "(\\d+(\\.\\d+)?)", DEFAULT_BROWSER_VERSION_REGEX, XBOX_REGEX, PLAYSTATION_REGEX, NINTENDO_REGEX, BLACKBERRY_REGEX, windowsVersionMap, versionRegexes, osMatchers;
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

// node_modules/.bun/@posthog+core@1.30.3/node_modules/@posthog/core/dist/utils/index.mjs
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
function allSettled(promises) {
  return Promise.all(promises.map((p) => (p ?? Promise.resolve()).then((value) => ({
    status: "fulfilled",
    value
  }), (reason) => ({
    status: "rejected",
    reason
  }))));
}
var STRING_FORMAT = "utf8", isError = (x) => x instanceof Error;
var init_utils = __esm(() => {
  init_bot_detection();
  init_bucketed_rate_limiter();
  init_number_utils();
  init_string_utils();
  init_type_utils();
  init_promise_queue();
  init_logger();
  init_user_agent_utils();
});

// node_modules/.bun/@posthog+core@1.30.3/node_modules/@posthog/core/dist/logs/logs-utils.mjs
var OTLP_SEVERITY_MAP, DEFAULT_OTLP_SEVERITY;
var init_logs_utils = __esm(() => {
  init_utils();
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
});

// node_modules/.bun/@posthog+core@1.30.3/node_modules/@posthog/core/dist/logs/index.mjs
var init_logs = __esm(() => {
  init_logs_utils();
  init_types();
  init_utils();
});

// node_modules/.bun/@posthog+core@1.30.3/node_modules/@posthog/core/dist/surveys/validation.mjs
var init_validation = __esm(() => {
  init_types();
});

// node_modules/.bun/@posthog+core@1.30.3/node_modules/@posthog/core/dist/cookie.mjs
var init_cookie = __esm(() => {
  init_utils();
  init_uuidv7();
});

// node_modules/.bun/@posthog+core@1.30.3/node_modules/@posthog/core/dist/eventemitter.mjs
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

// node_modules/.bun/@posthog+core@1.30.3/node_modules/@posthog/core/dist/error-tracking/chunk-ids.mjs
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

// node_modules/.bun/@posthog+core@1.30.3/node_modules/@posthog/core/dist/error-tracking/error-properties-builder.mjs
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
var MAX_CAUSE_RECURSION = 4;
var init_error_properties_builder = __esm(() => {
  init_utils();
  init_chunk_ids();
});

// node_modules/.bun/@posthog+core@1.30.3/node_modules/@posthog/core/dist/error-tracking/parsers/base.mjs
function createFrame(platform, filename, func, lineno, colno) {
  const frame = {
    platform,
    filename,
    function: func === "<anonymous>" ? UNKNOWN_FUNCTION : func,
    in_app: true
  };
  if (!isUndefined(lineno))
    frame.lineno = lineno;
  if (!isUndefined(colno))
    frame.colno = colno;
  return frame;
}
var UNKNOWN_FUNCTION = "?";
var init_base = __esm(() => {
  init_utils();
});

// node_modules/.bun/@posthog+core@1.30.3/node_modules/@posthog/core/dist/error-tracking/parsers/safari.mjs
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

// node_modules/.bun/@posthog+core@1.30.3/node_modules/@posthog/core/dist/error-tracking/parsers/chrome.mjs
var chromeRegexNoFnName, chromeRegex, chromeEvalRegex, chromeStackLineParser = (line, platform) => {
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
var init_chrome = __esm(() => {
  init_base();
  init_safari();
  chromeRegexNoFnName = /^\s*at (\S+?)(?::(\d+))(?::(\d+))\s*$/i;
  chromeRegex = /^\s*at (?:(.+?\)(?: \[.+\])?|.*?) ?\((?:address at )?)?(?:async )?((?:<anonymous>|[-a-z]+:|.*bundle|\/)?.*?)(?::(\d+))?(?::(\d+))?\)?\s*$/i;
  chromeEvalRegex = /\((\S*)(?::(\d+))(?::(\d+))\)/;
});

// node_modules/.bun/@posthog+core@1.30.3/node_modules/@posthog/core/dist/error-tracking/parsers/gecko.mjs
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

// node_modules/.bun/@posthog+core@1.30.3/node_modules/@posthog/core/dist/error-tracking/parsers/winjs.mjs
var winjsRegex, winjsStackLineParser = (line, platform) => {
  const parts = winjsRegex.exec(line);
  return parts ? createFrame(platform, parts[2], parts[1] || UNKNOWN_FUNCTION, +parts[3], parts[4] ? +parts[4] : undefined) : undefined;
};
var init_winjs = __esm(() => {
  init_base();
  winjsRegex = /^\s*at (?:((?:\[object object\])?.+) )?\(?((?:[-a-z]+):.*?):(\d+)(?::(\d+))?\)?\s*$/i;
});

// node_modules/.bun/@posthog+core@1.30.3/node_modules/@posthog/core/dist/error-tracking/parsers/opera.mjs
var opera10Regex, opera10StackLineParser = (line, platform) => {
  const parts = opera10Regex.exec(line);
  return parts ? createFrame(platform, parts[2], parts[3] || UNKNOWN_FUNCTION, +parts[1]) : undefined;
}, opera11Regex, opera11StackLineParser = (line, platform) => {
  const parts = opera11Regex.exec(line);
  return parts ? createFrame(platform, parts[5], parts[3] || parts[4] || UNKNOWN_FUNCTION, +parts[1], +parts[2]) : undefined;
};
var init_opera = __esm(() => {
  init_base();
  opera10Regex = / line (\d+).*script (?:in )?(\S+)(?:: in function (\S+))?$/i;
  opera11Regex = / line (\d+), column (\d+)\s*(?:in (?:<anonymous function: ([^>]+)>|([^)]+))\(.*\))? in (.*):\s*$/i;
});

// node_modules/.bun/@posthog+core@1.30.3/node_modules/@posthog/core/dist/error-tracking/parsers/node.mjs
function filenameIsInApp(filename, isNative = false) {
  const isInternal = isNative || filename && !filename.startsWith("/") && !filename.match(/^[A-Z]:/) && !filename.startsWith(".") && !filename.match(/^[a-zA-Z]([a-zA-Z0-9.\-+])*:\/\//);
  return !isInternal && filename !== undefined && !filename.includes("node_modules/");
}
function _parseIntOrUndefined(input) {
  return parseInt(input || "", 10) || undefined;
}
var FILENAME_MATCH, FULL_MATCH, nodeStackLineParser = (line, platform) => {
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
});

// node_modules/.bun/@posthog+core@1.30.3/node_modules/@posthog/core/dist/error-tracking/parsers/index.mjs
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

// node_modules/.bun/@posthog+core@1.30.3/node_modules/@posthog/core/dist/error-tracking/coercers/dom-exception-coercer.mjs
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
var init_dom_exception_coercer = __esm(() => {
  init_utils();
});

// node_modules/.bun/@posthog+core@1.30.3/node_modules/@posthog/core/dist/error-tracking/coercers/error-coercer.mjs
class ErrorCoercer {
  match(err) {
    return isPlainError(err);
  }
  coerce(err, ctx) {
    return {
      type: this.getType(err),
      value: this.getMessage(err, ctx),
      stack: this.getStack(err),
      cause: err.cause ? ctx.next(err.cause) : undefined,
      synthetic: false
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
  init_utils();
});

// node_modules/.bun/@posthog+core@1.30.3/node_modules/@posthog/core/dist/error-tracking/coercers/error-event-coercer.mjs
class ErrorEventCoercer {
  constructor() {}
  match(err) {
    return isErrorEvent(err) && err.error != null;
  }
  coerce(err, ctx) {
    const exceptionLike = ctx.apply(err.error);
    if (!exceptionLike)
      return {
        type: "ErrorEvent",
        value: err.message,
        stack: ctx.syntheticException?.stack,
        synthetic: true
      };
    return exceptionLike;
  }
}
var init_error_event_coercer = __esm(() => {
  init_utils();
});

// node_modules/.bun/@posthog+core@1.30.3/node_modules/@posthog/core/dist/error-tracking/coercers/string-coercer.mjs
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

// node_modules/.bun/@posthog+core@1.30.3/node_modules/@posthog/core/dist/error-tracking/types.mjs
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

// node_modules/.bun/@posthog+core@1.30.3/node_modules/@posthog/core/dist/error-tracking/coercers/utils.mjs
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

// node_modules/.bun/@posthog+core@1.30.3/node_modules/@posthog/core/dist/error-tracking/coercers/object-coercer.mjs
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
      stack: ctx.syntheticException?.stack,
      level: this.isSeverityLevel(candidate.level) ? candidate.level : "error",
      synthetic: true
    };
  }
  getType(err) {
    return isEvent(err) ? err.constructor.name : "Error";
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

// node_modules/.bun/@posthog+core@1.30.3/node_modules/@posthog/core/dist/error-tracking/coercers/event-coercer.mjs
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

// node_modules/.bun/@posthog+core@1.30.3/node_modules/@posthog/core/dist/error-tracking/coercers/primitive-coercer.mjs
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

// node_modules/.bun/@posthog+core@1.30.3/node_modules/@posthog/core/dist/error-tracking/coercers/promise-rejection-event.mjs
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
var init_promise_rejection_event = __esm(() => {
  init_utils();
});

// node_modules/.bun/@posthog+core@1.30.3/node_modules/@posthog/core/dist/error-tracking/coercers/index.mjs
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

// node_modules/.bun/@posthog+core@1.30.3/node_modules/@posthog/core/dist/error-tracking/utils.mjs
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

// node_modules/.bun/@posthog+core@1.30.3/node_modules/@posthog/core/dist/error-tracking/exception-steps.mjs
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
  const json = safeStringify(step);
  if (!json)
    return;
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
function safeStringify(value) {
  const seen = new WeakSet;
  try {
    return JSON.stringify(value, (_key, replacementValue) => {
      if (typeof replacementValue == "bigint")
        return replacementValue.toString();
      if (typeof replacementValue == "function" || typeof replacementValue == "symbol")
        return;
      if (replacementValue instanceof Date)
        return replacementValue.toISOString();
      if (replacementValue instanceof Error)
        return {
          name: replacementValue.name,
          message: replacementValue.message,
          stack: replacementValue.stack
        };
      if (replacementValue && typeof replacementValue == "object") {
        if (seen.has(replacementValue))
          return "[Circular]";
        seen.add(replacementValue);
      }
      return replacementValue;
    });
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
var EXCEPTION_STEP_INTERNAL_FIELDS, RESERVED_EXCEPTION_STEP_KEYS, DEFAULT_EXCEPTION_STEPS_CONFIG;
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
  DEFAULT_EXCEPTION_STEPS_CONFIG = {
    enabled: true,
    max_bytes: 32768
  };
});

// node_modules/.bun/@posthog+core@1.30.3/node_modules/@posthog/core/dist/error-tracking/index.mjs
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
var init_error_tracking = __esm(() => {
  init_error_properties_builder();
  init_parsers();
  init_coercers();
  init_utils3();
  init_exception_steps();
});

// node_modules/.bun/@posthog+core@1.30.3/node_modules/@posthog/core/dist/posthog-core-stateless.mjs
async function logFlushError(err) {
  if (err instanceof PostHogFetchHttpError) {
    let text = "";
    try {
      text = await err.text;
    } catch {}
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
function isPostHogFetchContentTooLargeError(err) {
  return typeof err == "object" && err instanceof PostHogFetchHttpError && err.status === 413;
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
      retryCheck: isPostHogFetchError
    };
    this.requestTimeout = options.requestTimeout ?? 1e4;
    this.featureFlagsRequestTimeoutMs = options.featureFlagsRequestTimeoutMs ?? 3000;
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
    return {
      distinct_id: payload.distinct_id,
      event: payload.event,
      properties: {
        ...payload.properties || {},
        ...this.getCommonEventProperties()
      }
    };
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
      retryCount: 0
    }, this.remoteConfigRequestTimeoutMs).then((response) => response.json()).catch((error) => {
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
      retryCount: 0
    }, this.featureFlagsRequestTimeoutMs).then((response) => response.json()).then((response) => ({
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
    const extraPayload = {};
    if (disableGeoip ?? this.disableGeoip)
      extraPayload["geoip_disable"] = true;
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
    const response = await this.fetchWithRetry(url, fetchOptions).then((response2) => {
      if (response2.status !== 200 || !response2.json) {
        const msg = `Surveys API could not be loaded: ${response2.status}`;
        const error = new Error(msg);
        this._logger.error(error);
        this._events.emit("error", new Error(msg));
        return;
      }
      return response2.json();
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
  enqueue(type, _message, options) {
    this.wrap(() => {
      if (this.optedOut)
        return void this._events.emit(type, "Library is disabled. Not sending event. To re-enable, call posthog.optIn()");
      let message = this.prepareMessage(type, _message, options);
      message = this.processBeforeEnqueue(message);
      if (message === null)
        return;
      const queue = this.getPersistedProperty(types_PostHogPersistedProperty.Queue) || [];
      if (queue.length >= this.maxQueueSize) {
        queue.shift();
        this._logger.info("Queue is full, the oldest event is dropped.");
      }
      queue.push({
        message
      });
      this.setPersistedProperty(types_PostHogPersistedProperty.Queue, queue);
      this._events.emit(type, message);
      if (queue.length >= this.flushAt)
        this.flushBackground();
      if (this.flushInterval && !this._flushTimer)
        this._flushTimer = safeSetTimeout(() => this.flushBackground(), this.flushInterval);
    });
  }
  async sendImmediate(type, _message, options) {
    if (this.disabled)
      return void this._logger.warn("The client is disabled");
    if (!this._isInitialized)
      await this._initPromise;
    if (this.optedOut)
      return void this._events.emit(type, "Library is disabled. Not sending event. To re-enable, call posthog.optIn()");
    let message = this.prepareMessage(type, _message, options);
    message = this.processBeforeEnqueue(message);
    if (message === null)
      return;
    const data = {
      api_key: this.apiKey,
      batch: [
        message
      ],
      sent_at: currentISOTime()
    };
    if (this.historicalMigration)
      data.historical_migration = true;
    const payload = JSON.stringify(data);
    const url = `${this.host}/batch/`;
    const gzippedPayload = this.disableCompression ? null : await gzipCompress(payload, this.isDebug);
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
    try {
      const response = await this.fetchWithRetry(url, fetchOptions);
      await response.body?.cancel()?.catch(() => {});
    } catch (err) {
      this._events.emit("error", err);
    }
  }
  prepareMessage(type, _message, options) {
    const message = {
      ..._message,
      type,
      library: this.getLibraryId(),
      library_version: this.getLibraryVersion(),
      timestamp: options?.timestamp ? options?.timestamp : currentISOTime(),
      uuid: options?.uuid ? options.uuid : uuidv7()
    };
    const addGeoipDisableProperty = options?.disableGeoip ?? this.disableGeoip;
    if (addGeoipDisableProperty) {
      if (!message.properties)
        message.properties = {};
      message["properties"]["$geoip_disable"] = true;
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
    this.flush().catch(async (err) => {
      await logFlushError(err);
    });
  }
  async flush() {
    if (this.disabled)
      return;
    const nextFlushPromise = allSettled([
      this.flushPromise
    ]).then(() => this._flush());
    this.flushPromise = nextFlushPromise;
    this.addPendingPromise(nextFlushPromise);
    allSettled([
      nextFlushPromise
    ]).then(() => {
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
  async _flush() {
    this.clearFlushTimer();
    await this._initPromise;
    let queue = this.getPersistedProperty(types_PostHogPersistedProperty.Queue) || [];
    if (!queue.length)
      return;
    const sentMessages = [];
    const originalQueueLength = queue.length;
    while (queue.length > 0 && sentMessages.length < originalQueueLength) {
      const batchItems = queue.slice(0, this.maxBatchSize);
      const batchMessages = batchItems.map((item) => item.message);
      const persistQueueChange = async () => {
        const refreshedQueue = this.getPersistedProperty(types_PostHogPersistedProperty.Queue) || [];
        const newQueue = refreshedQueue.slice(batchItems.length);
        this.setPersistedProperty(types_PostHogPersistedProperty.Queue, newQueue);
        queue = newQueue;
        await this.flushStorage();
      };
      const data = {
        api_key: this.apiKey,
        batch: batchMessages,
        sent_at: currentISOTime()
      };
      if (this.historicalMigration)
        data.historical_migration = true;
      const payload = JSON.stringify(data);
      const url = `${this.host}/batch/`;
      const gzippedPayload = this.disableCompression ? null : await gzipCompress(payload, this.isDebug);
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
      const retryOptions = {
        retryCheck: (err) => {
          if (isPostHogFetchContentTooLargeError(err))
            return false;
          return isPostHogFetchError(err);
        }
      };
      try {
        const response = await this.fetchWithRetry(url, fetchOptions, retryOptions);
        await response.body?.cancel()?.catch(() => {});
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
    }
    this._events.emit("flush", sentMessages);
  }
  async _sendLogsBatch(payload) {
    if (this.disabled)
      return {
        kind: "fatal",
        error: new Error("The client is disabled")
      };
    const serialized = JSON.stringify(payload);
    const url = `${this.host}/i/v1/logs?token=${encodeURIComponent(this.apiKey)}`;
    const gzippedPayload = this.disableCompression ? null : await gzipCompress(serialized, this.isDebug);
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
        retryCheck: (err) => {
          if (isPostHogFetchContentTooLargeError(err))
            return false;
          return isPostHogFetchError(err);
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
  async fetchWithRetry(url, options, retryOptions, requestTimeout) {
    const body = options.body ? options.body : "";
    let reqByteLength = -1;
    try {
      reqByteLength = body instanceof Blob ? body.size : Buffer.byteLength(body, STRING_FORMAT);
    } catch {
      if (body instanceof Blob)
        reqByteLength = body.size;
      else {
        const encoded = new TextEncoder().encode(body);
        reqByteLength = encoded.length;
      }
    }
    return await retriable(async () => {
      const ctrl = new AbortController;
      const timeoutMs = requestTimeout ?? this.requestTimeout;
      const timer = safeSetTimeout(() => ctrl.abort(), timeoutMs);
      let res = null;
      try {
        res = await this.fetch(url, {
          signal: ctrl.signal,
          ...options
        });
      } catch (e) {
        throw new PostHogFetchNetworkError(e);
      } finally {
        clearTimeout(timer);
      }
      const isNoCors = options.mode === "no-cors";
      if (!isNoCors && (res.status < 200 || res.status >= 400))
        throw new PostHogFetchHttpError(res, reqByteLength);
      return res;
    }, {
      ...this._retryOptions,
      ...retryOptions
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
          const queue = this.getPersistedProperty(types_PostHogPersistedProperty.Queue) || [];
          if (queue.length === 0)
            break;
          await this.flush();
          if (hasTimedOut)
            break;
        }
      } catch (e) {
        if (!isPostHogFetchError(e))
          throw e;
        await logFlushError(e);
      }
    };
    let timeoutHandle;
    try {
      return await Promise.race([
        new Promise((_, reject) => {
          timeoutHandle = safeSetTimeout(() => {
            this._logger.error("Timed out while shutting down PostHog");
            hasTimedOut = true;
            reject("Timeout while shutting down PostHog. Some events may not have been sent.");
          }, shutdownTimeoutMs);
        }),
        doShutdown()
      ]);
    } finally {
      clearTimeout(timeoutHandle);
    }
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
var PostHogFetchHttpError, PostHogFetchNetworkError;
var init_posthog_core_stateless = __esm(() => {
  init_eventemitter();
  init_featureFlagUtils();
  init_gzip();
  init_types();
  init_utils();
  init_uuidv7();
  init_error_tracking();
  PostHogFetchHttpError = class PostHogFetchHttpError extends Error {
    constructor(response, reqByteLength) {
      super("HTTP error while fetching PostHog: status=" + response.status + ", reqByteLength=" + reqByteLength), this.response = response, this.reqByteLength = reqByteLength, this.name = "PostHogFetchHttpError";
    }
    get status() {
      return this.response.status;
    }
    get text() {
      return this.response.text();
    }
    get json() {
      return this.response.json();
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

// node_modules/.bun/@posthog+core@1.30.3/node_modules/@posthog/core/dist/posthog-core.mjs
var init_posthog_core = __esm(() => {
  init_featureFlagUtils();
  init_types();
  init_posthog_core_stateless();
  init_uuidv7();
  init_utils();
});

// node_modules/.bun/@posthog+core@1.30.3/node_modules/@posthog/core/dist/tracing-headers.mjs
var init_tracing_headers = __esm(() => {
  init_type_utils();
});

// node_modules/.bun/@posthog+core@1.30.3/node_modules/@posthog/core/dist/index.mjs
var init_dist = __esm(() => {
  init_featureFlagUtils();
  init_gzip();
  init_logs_utils();
  init_logs();
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

// node_modules/.bun/posthog-node@5.35.12/node_modules/posthog-node/dist/extensions/error-tracking/modifiers/context-lines.node.mjs
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
async function addSourceContext(frames) {
  const filesToLines = {};
  for (let i = frames.length - 1;i >= 0; i--) {
    const frame = frames[i];
    const filename = frame?.filename;
    if (!frame || typeof filename != "string" || typeof frame.lineno != "number" || shouldSkipContextLinesForFile(filename) || shouldSkipContextLinesForFrame(frame))
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
  for (const file2 of files) {
    if (LRU_FILE_CONTENTS_FS_READ_FAILED.get(file2))
      continue;
    const filesToLineRanges = filesToLines[file2];
    if (!filesToLineRanges)
      continue;
    filesToLineRanges.sort((a, b) => a - b);
    const ranges = makeLineReaderRanges(filesToLineRanges);
    if (ranges.every((r) => rangeExistsInContentCache(file2, r)))
      continue;
    const cache = emplace(LRU_FILE_CONTENTS_CACHE, file2, {});
    readlinePromises.push(getContextLinesFromFile(file2, ranges, cache));
  }
  await Promise.all(readlinePromises).catch(() => {});
  if (frames && frames.length > 0)
    addSourceContextToFrames(frames, LRU_FILE_CONTENTS_CACHE);
  LRU_FILE_CONTENTS_CACHE.reduce();
  return frames;
}
function getContextLinesFromFile(path2, ranges, output) {
  return new Promise((resolve10) => {
    const stream = createReadStream(path2);
    const lineReaded = createInterface({
      input: stream
    });
    function destroyStreamAndResolve() {
      stream.destroy();
      resolve10();
    }
    let lineNumber = 0;
    let currentRangeIndex = 0;
    const range = ranges[currentRangeIndex];
    if (range === undefined)
      return void destroyStreamAndResolve();
    let rangeStart = range[0];
    let rangeEnd = range[1];
    function onStreamError() {
      LRU_FILE_CONTENTS_FS_READ_FAILED.set(path2, 1);
      lineReaded.close();
      lineReaded.removeAllListeners();
      destroyStreamAndResolve();
    }
    stream.on("error", onStreamError);
    lineReaded.on("error", onStreamError);
    lineReaded.on("close", destroyStreamAndResolve);
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
function addSourceContextToFrames(frames, cache) {
  for (const frame of frames)
    if (frame.filename && frame.context_line === undefined && typeof frame.lineno == "number") {
      const contents = cache.get(frame.filename);
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
function rangeExistsInContentCache(file2, range) {
  const contents = LRU_FILE_CONTENTS_CACHE.get(file2);
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
var LRU_FILE_CONTENTS_CACHE, LRU_FILE_CONTENTS_FS_READ_FAILED, DEFAULT_LINES_OF_CONTEXT = 7, MAX_CONTEXTLINES_COLNO = 1000, MAX_CONTEXTLINES_LINENO = 1e4;
var init_context_lines_node = __esm(() => {
  init_dist();
  LRU_FILE_CONTENTS_CACHE = new exports_error_tracking.ReduceableCache(25);
  LRU_FILE_CONTENTS_FS_READ_FAILED = new exports_error_tracking.ReduceableCache(20);
});

// node_modules/.bun/posthog-node@5.35.12/node_modules/posthog-node/dist/extensions/error-tracking/modifiers/relative-path.node.mjs
import { isAbsolute as isAbsolute5, relative as relative4, sep as sep8 } from "node:path";
function createRelativePathModifier(basePath = process.cwd()) {
  const isWindows = sep8 === "\\";
  const toUnix = (p) => isWindows ? p.replace(/\\/g, "/") : p;
  const normalizedBase = toUnix(basePath);
  return async (frames) => {
    for (const frame of frames)
      if (!(!frame.filename || frame.filename.startsWith("node:") || frame.filename.startsWith("data:"))) {
        if (isAbsolute5(frame.filename))
          frame.filename = toUnix(relative4(normalizedBase, toUnix(frame.filename)));
      }
    return frames;
  };
}
var init_relative_path_node = () => {};

// node_modules/.bun/posthog-node@5.35.12/node_modules/posthog-node/dist/version.mjs
var version = "5.35.12";
var init_version = () => {};

// node_modules/.bun/posthog-node@5.35.12/node_modules/posthog-node/dist/types.mjs
var FeatureFlagError2;
var init_types3 = __esm(() => {
  FeatureFlagError2 = {
    ERRORS_WHILE_COMPUTING: "errors_while_computing_flags",
    FLAG_MISSING: "flag_missing",
    QUOTA_LIMITED: "quota_limited",
    UNKNOWN_ERROR: "unknown_error"
  };
});

// node_modules/.bun/posthog-node@5.35.12/node_modules/posthog-node/dist/feature-flag-evaluations.mjs
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
  isEnabled(key) {
    const flag = this._flags[key];
    this._recordAccess(key);
    return flag?.enabled ?? false;
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

// node_modules/.bun/posthog-node@5.35.12/node_modules/posthog-node/dist/extensions/feature-flags/crypto.mjs
async function hashSHA1(text) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle)
    throw new Error("SubtleCrypto API not available");
  const hashBuffer = await subtle.digest("SHA-1", new TextEncoder().encode(text));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
var init_crypto = () => {};

// node_modules/.bun/posthog-node@5.35.12/node_modules/posthog-node/dist/extensions/feature-flags/feature-flags.mjs
class FeatureFlagsPoller {
  constructor({ pollingInterval, personalApiKey, projectApiKey, timeout, host, customHeaders, ...options }) {
    this.debugMode = false;
    this.shouldBeginExponentialBackoff = false;
    this.backOffCount = 0;
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
        if (await this.isConditionMatch(flag, effectiveBucketingValue, condition, effectiveProperties, evaluationContext)) {
          const variantOverride = condition.variant;
          const flagVariants = flagFilters.multivariate?.variants || [];
          result = variantOverride && flagVariants.some((variant) => variant.key === variantOverride) ? variantOverride : await this.getMatchingVariant(flag, effectiveBucketingValue) || true;
          break;
        }
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
        matches = propertyType === "cohort" ? await matchCohort(prop, properties, this.cohorts, this.debugMode, (depProp) => this.evaluateFlagDependency(depProp, properties, evaluationContext)) : propertyType === "flag" ? await this.evaluateFlagDependency(prop, properties, evaluationContext) : matchProperty(prop, properties, warnFunction);
        if (!matches)
          return false;
      }
      if (rolloutPercentage == undefined)
        return true;
    }
    if (rolloutPercentage != null && await _hash(flag.key, bucketingValue) > rolloutPercentage / 100)
      return false;
    return true;
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
    this.poller = setTimeout(() => this.loadFeatureFlags(true), this.getPollingInterval());
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
          throw new ClientError(`Your project key or personal API key is invalid. Setting next polling interval to ${this.getPollingInterval()}ms. More information: https://posthog.com/docs/api#rate-limiting`);
        case 402:
          console.warn("[FEATURE FLAGS] Feature flags quota limit exceeded - unsetting all local flags. Learn more about billing limits at https://posthog.com/docs/billing/limits-alerts");
          this.featureFlags = [];
          this.featureFlagsByKey = {};
          this.groupTypeMapping = {};
          this.cohorts = {};
          return;
        case 403:
          this.beginBackoff();
          throw new ClientError(`Your personal API key does not have permission to fetch feature flag definitions for local evaluation. Setting next polling interval to ${this.getPollingInterval()}ms. Are you sure you're using the correct personal and Project API key pair? More information: https://posthog.com/docs/api/overview`);
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
            cohorts: responseJson.cohorts || {}
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
  _requestFeatureFlagDefinitions() {
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
    try {
      const fetch1 = this.fetch;
      return fetch1(url, options);
    } finally {
      clearTimeout(abortTimeout);
    }
  }
  async stopPoller(timeoutMs = 30000) {
    clearTimeout(this.poller);
    if (this.cacheProvider)
      try {
        const shutdownResult = this.cacheProvider.shutdown();
        if (shutdownResult instanceof Promise)
          await Promise.race([
            shutdownResult,
            new Promise((_, reject) => setTimeout(() => reject(new Error(`Cache shutdown timeout after ${timeoutMs}ms`)), timeoutMs))
          ]);
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
      this.name = this.constructor.name;
      Error.captureStackTrace(this, this.constructor);
      Object.setPrototypeOf(this, InconclusiveMatchError.prototype);
    }
  };
  RequiresServerEvaluation = class RequiresServerEvaluation extends Error {
    constructor(message) {
      super(message);
      this.name = this.constructor.name;
      Error.captureStackTrace(this, this.constructor);
      Object.setPrototypeOf(this, RequiresServerEvaluation.prototype);
    }
  };
});

// node_modules/.bun/posthog-node@5.35.12/node_modules/posthog-node/dist/extensions/error-tracking/autocapture.mjs
function makeUncaughtExceptionHandler(captureFn, onFatalFn) {
  let calledFatalError = false;
  return Object.assign((error) => {
    const userProvidedListenersCount = global.process.listeners("uncaughtException").filter((listener) => listener.name !== "domainUncaughtExceptionClear" && listener._posthogErrorHandler !== true).length;
    const processWouldExit = userProvidedListenersCount === 0;
    captureFn(error, {
      mechanism: {
        type: "onuncaughtexception",
        handled: false
      }
    });
    if (!calledFatalError && processWouldExit) {
      calledFatalError = true;
      onFatalFn(error);
    }
  }, {
    _posthogErrorHandler: true
  });
}
function addUncaughtExceptionListener(captureFn, onFatalFn) {
  globalThis.process?.on("uncaughtException", makeUncaughtExceptionHandler(captureFn, onFatalFn));
}
function addUnhandledRejectionListener(captureFn) {
  globalThis.process?.on("unhandledRejection", (reason) => captureFn(reason, {
    mechanism: {
      type: "onunhandledrejection",
      handled: false
    }
  }));
}
var init_autocapture = () => {};

// node_modules/.bun/posthog-node@5.35.12/node_modules/posthog-node/dist/extensions/error-tracking/index.mjs
class ErrorTracking {
  constructor(client, options, _logger) {
    this.client = client;
    this._exceptionAutocaptureEnabled = options.enableExceptionAutocapture || false;
    this._logger = _logger;
    this._rateLimiter = new BucketedRateLimiter({
      refillRate: 1,
      bucketSize: 10,
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
      if (!ErrorTracking.isPreviouslyCapturedError(exception)) {
        const eventMessage = await ErrorTracking.buildEventMessage(this.client.getErrorPropertiesBuilder(), exception, hint);
        const exceptionProperties = eventMessage.properties;
        const exceptionType = exceptionProperties?.$exception_list[0]?.type ?? "Exception";
        const isRateLimited = this._rateLimiter.consumeRateLimit(exceptionType);
        if (isRateLimited)
          return void this._logger.info("Skipping exception capture because of client rate limiting.", {
            exception: exceptionType
          });
        return this.client.capture(eventMessage);
      }
    })());
  }
  async onFatalError(exception) {
    console.error(exception);
    await this.client.shutdown(SHUTDOWN_TIMEOUT);
    process.exit(1);
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

// node_modules/.bun/posthog-node@5.35.12/node_modules/posthog-node/dist/storage-memory.mjs
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

// node_modules/.bun/posthog-node@5.35.12/node_modules/posthog-node/dist/client.mjs
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
  _emittedDeprecations = new Set;
  PostHogBackendClient = class PostHogBackendClient extends PostHogCoreStateless {
    constructor(apiKey, options = {}) {
      const normalizedApiKey = normalizeApiKey(apiKey);
      const normalizedOptions = {
        ...options,
        host: normalizeHost(options.host),
        personalApiKey: normalizePersonalApiKey(options.personalApiKey)
      };
      super(normalizedApiKey, normalizedOptions), this._memoryStorage = new PostHogMemoryStorage;
      this.options = normalizedOptions;
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
            customHeaders: this.getCustomHeaders(),
            cacheProvider: normalizedOptions.flagDefinitionCacheProvider,
            strictLocalEvaluation: normalizedOptions.strictLocalEvaluation
          });
      }
      this.errorTracking = new ErrorTracking(this, normalizedOptions, this._logger);
      this.distinctIdHasSentFlagCalls = {};
      this.maxCacheSize = normalizedOptions.maxCacheSize || MAX_CACHE_SIZE;
    }
    enqueue(type, message, options) {
      super.enqueue(type, message, options);
      this.scheduleDebouncedFlush();
    }
    async flush() {
      const flushPromise = super.flush();
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
        let resolve10;
        const promise = new Promise((r) => {
          resolve10 = r;
        });
        try {
          waitUntil(promise);
        } catch {
          return;
        }
        this._waitUntilCycle = {
          resolve: resolve10,
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
      const resolve10 = this._consumeWaitUntilCycle();
      try {
        await super.flush();
      } catch {} finally {
        resolve10?.();
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
    getLibraryVersion() {
      return version;
    }
    getCustomUserAgent() {
      return `${this.getLibraryId()}/${this.getLibraryVersion()}`;
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
    capture(props) {
      if (typeof props == "string")
        this._logger.warn("Called capture() with a string as the first argument when an object was expected.");
      if (props.event === "$exception" && !props._originatedFromCaptureException)
        this._logger.warn("Using `posthog.capture('$exception')` is unreliable because it does not attach required metadata. Use `posthog.captureException(error)` instead, which attaches required metadata automatically.");
      this.addPendingPromise(this.prepareEventMessage(props).then(({ distinctId, event, properties, options }) => super.captureStateless(distinctId, event, properties, {
        timestamp: options.timestamp,
        disableGeoip: options.disableGeoip,
        uuid: options.uuid
      })).catch((err) => {
        if (err)
          console.error(err);
      }));
    }
    async captureImmediate(props) {
      if (typeof props == "string")
        this._logger.warn("Called captureImmediate() with a string as the first argument when an object was expected.");
      if (props.event === "$exception" && !props._originatedFromCaptureException)
        this._logger.warn("Capturing a `$exception` event via `posthog.captureImmediate('$exception')` is unreliable because it does not attach required metadata. Use `posthog.captureExceptionImmediate(error)` instead, which attaches this metadata by default.");
      return this.addPendingPromise(this.prepareEventMessage(props).then(({ distinctId, event, properties, options }) => super.captureStatelessImmediate(distinctId, event, properties, {
        timestamp: options.timestamp,
        disableGeoip: options.disableGeoip,
        uuid: options.uuid
      })).catch((err) => {
        if (err)
          console.error(err);
      }));
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
      super.identifyStateless(distinctId, eventProperties, {
        disableGeoip
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
      await super.identifyStatelessImmediate(distinctId, eventProperties, {
        disableGeoip
      });
    }
    alias(data) {
      super.aliasStateless(data.alias, data.distinctId, undefined, {
        disableGeoip: data.disableGeoip
      });
    }
    async aliasImmediate(data) {
      await super.aliasStatelessImmediate(data.alias, data.distinctId, undefined, {
        disableGeoip: data.disableGeoip
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
      return new Promise((resolve10) => {
        const timeout = setTimeout(() => {
          cleanup();
          resolve10(false);
        }, timeoutMs);
        const cleanup = this._events.on("localEvaluationFlagsLoaded", (count) => {
          clearTimeout(timeout);
          cleanup();
          resolve10(count > 0);
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
      const evaluationContext = this.createFeatureFlagEvaluationContext(distinctId, groups, personProperties, groupProperties);
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
        const flagsResponse = await super.getFeatureFlagDetailsStateless(evaluationContext.distinctId, evaluationContext.groups, evaluationContext.personProperties, evaluationContext.groupProperties, disableGeoip, [
          key
        ]);
        if (flagsResponse === undefined)
          featureFlagError = FeatureFlagError2.UNKNOWN_ERROR;
        else {
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
              variant: flagDetail.variant,
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
      const evaluationContext = this.createFeatureFlagEvaluationContext(resolvedDistinctId, groups, personProperties, groupProperties);
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
        const remoteEvaluationResult = await super.getFeatureFlagsAndPayloadsStateless(evaluationContext.distinctId, evaluationContext.groups, evaluationContext.personProperties, evaluationContext.groupProperties, disableGeoip, flagKeys);
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
      const evaluationContext = this.createFeatureFlagEvaluationContext(resolvedDistinctId, groups, personProperties, groupProperties);
      if (onlyEvaluateLocally == undefined)
        onlyEvaluateLocally = this.options.strictLocalEvaluation ?? false;
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
            locallyEvaluated: true
          };
          locallyEvaluatedKeys.add(key);
        }
      const fallbackToFlags = localResult ? localResult.fallbackToFlags : true;
      if (fallbackToFlags && !onlyEvaluateLocally) {
        const details = await super.getFeatureFlagDetailsStateless(evaluationContext.distinctId, evaluationContext.groups, evaluationContext.personProperties, evaluationContext.groupProperties, disableGeoip, flagKeys);
        if (details) {
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
              locallyEvaluated: false
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
            locallyEvaluated: existing?.locallyEvaluated ?? false
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
      super.groupIdentifyStateless(groupType, groupKey, properties, {
        disableGeoip
      }, distinctId);
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
      const resolve10 = this._consumeWaitUntilCycle();
      await this.featureFlagsPoller?.stopPoller(shutdownTimeoutMs);
      this.errorTracking.shutdown();
      try {
        return await super._shutdown(shutdownTimeoutMs);
      } finally {
        resolve10?.();
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
        if (isPlainObject2(value) && groups && key in groups) {
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
        distinct_id: distinctId,
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
      if (!ErrorTracking.isPreviouslyCapturedError(error)) {
        const syntheticException = new Error("PostHog syntheticException");
        this.addPendingPromise(ErrorTracking.buildEventMessage(this.getErrorPropertiesBuilder(), error, {
          syntheticException
        }, distinctId, additionalProperties).then((msg) => this.capture({
          ...msg,
          uuid,
          flags
        })));
      }
    }
    async captureExceptionImmediate(error, distinctId, additionalProperties, flags) {
      if (!ErrorTracking.isPreviouslyCapturedError(error)) {
        const syntheticException = new Error("PostHog syntheticException");
        return this.addPendingPromise(ErrorTracking.buildEventMessage(this.getErrorPropertiesBuilder(), error, {
          syntheticException
        }, distinctId, additionalProperties).then((msg) => this.captureImmediate({
          ...msg,
          flags
        })));
      }
    }
    async prepareEventMessage(props) {
      const { distinctId, event, properties, groups, flags, sendFeatureFlags, timestamp, disableGeoip, uuid } = props;
      const contextData = this.context?.get();
      let mergedDistinctId = distinctId || contextData?.distinctId;
      const mergedProperties = {
        ...this.props,
        ...contextData?.properties || {},
        ...properties || {}
      };
      if (!mergedDistinctId) {
        mergedDistinctId = uuidv7();
        mergedProperties.$process_person_profile = false;
      }
      if (contextData?.sessionId && !mergedProperties.$session_id)
        mergedProperties.$session_id = contextData.sessionId;
      const eventMessage = this._runBeforeSend({
        distinctId: mergedDistinctId,
        event,
        properties: mergedProperties,
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
        const props2 = {
          ...additionalProperties,
          ...eventMessage.properties || {},
          $groups: eventMessage.groups || groups
        };
        return props2;
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
      for (const fn of fns) {
        result = fn(result);
        if (!result) {
          this._logger.info(`Event '${eventMessage.event}' was rejected in beforeSend function`);
          return null;
        }
        if (!result.properties || Object.keys(result.properties).length === 0) {
          const message = `Event '${result.event}' has no properties after beforeSend function, this is likely an error.`;
          this._logger.warn(message);
        }
      }
      return result;
    }
  };
});

// node_modules/.bun/posthog-node@5.35.12/node_modules/posthog-node/dist/extensions/context/context.mjs
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

// node_modules/.bun/posthog-node@5.35.12/node_modules/posthog-node/dist/extensions/sentry-integration.mjs
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

// node_modules/.bun/posthog-node@5.35.12/node_modules/posthog-node/dist/extensions/tracing-headers.mjs
var init_tracing_headers2 = () => {};

// node_modules/.bun/posthog-node@5.35.12/node_modules/posthog-node/dist/extensions/express.mjs
var init_express = __esm(() => {
  init_error_tracking2();
  init_tracing_headers2();
});

// node_modules/.bun/posthog-node@5.35.12/node_modules/posthog-node/dist/exports.mjs
var init_exports = __esm(() => {
  init_feature_flag_evaluations();
  init_dist();
  init_sentry_integration();
  init_express();
  init_types3();
});

// node_modules/.bun/posthog-node@5.35.12/node_modules/posthog-node/dist/entrypoints/index.node.mjs
var PostHog;
var init_index_node = __esm(() => {
  init_module_node();
  init_context_lines_node();
  init_relative_path_node();
  init_client();
  init_dist();
  init_context();
  init_exports();
  PostHog = class PostHog extends PostHogBackendClient {
    getLibraryId() {
      return "posthog-node";
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
        addSourceContext,
        createRelativePathModifier()
      ]);
    }
  };
});

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
  const env2 = input.env ?? process.env;
  return !shouldDisableTelemetry({ env: env2, productEnvPrefix: input.product.productEnvPrefix }) && getTelemetryApiKey(env2, input.product.defaultApiKey).length > 0;
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
  const env2 = input.env ?? process.env;
  const factory = input.transportFactory ?? createDefaultPostHogTransport;
  try {
    return factory(getTelemetryApiKey(env2, input.product.defaultApiKey), {
      enableExceptionAutocapture: false,
      enableLocalEvaluation: false,
      strictLocalEvaluation: true,
      disableRemoteConfig: true,
      flushAt: 1,
      flushInterval: 0,
      host: getTelemetryHost(env2, input.product.defaultHost),
      disableGeoip: false
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

// packages/telemetry-core/src/record-daily-active.ts
var init_record_daily_active = __esm(() => {
  init_activity_state();
  init_posthog_client();
  init_machine_id();
});

// packages/telemetry-core/src/index.ts
var init_src = __esm(() => {
  init_activity_state();
  init_diagnostics();
  init_env();
  init_machine_id();
  init_posthog_client();
  init_record_daily_active();
});

// packages/omo-codex/package.json
var package_default;
var init_package = __esm(() => {
  package_default = {
    name: "@oh-my-opencode/omo-codex",
    version: "4.13.0",
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
      "@oh-my-opencode/utils": "workspace:*"
    },
    devDependencies: {
      "bun-types": "1.3.14"
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
function createCliPostHog() {
  return createPostHogClient("cli");
}
function createInstallPostHog() {
  return createPostHogClient("install");
}
function createPluginPostHog() {
  return createPostHogClient("plugin");
}
function __setOsProviderForTesting(provider) {
  osProviderOverride2 = provider;
}
function __resetOsProviderForTesting() {
  osProviderOverride2 = null;
}
function __setActivityStateProviderForTesting(provider) {
  activityStateProviderOverride = provider;
}
function __resetActivityStateProviderForTesting() {
  activityStateProviderOverride = null;
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
var exports_telemetry = {};
__export(exports_telemetry, {
  getPostHogDistinctId: () => getPostHogDistinctId,
  createPluginPostHog: () => createPluginPostHog,
  createInstallPostHog: () => createInstallPostHog,
  createCliPostHog: () => createCliPostHog,
  __setOsProviderForTesting: () => __setOsProviderForTesting,
  __setActivityStateProviderForTesting: () => __setActivityStateProviderForTesting,
  __resetOsProviderForTesting: () => __resetOsProviderForTesting,
  __resetActivityStateProviderForTesting: () => __resetActivityStateProviderForTesting
});
var init_telemetry = __esm(() => {
  init_posthog();
});

// packages/omo-codex/src/install/install-local-cli.ts
import { readFile as readFile19 } from "node:fs/promises";
import { dirname as dirname10, join as join35, resolve as resolve11 } from "node:path";
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
// packages/utils/src/runtime/which.ts
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
var runtime2 = globalThis;
function isUnsafeCommandName(commandName) {
  if (commandName.includes("/") || commandName.includes("\\"))
    return true;
  if (commandName === "." || commandName === ".." || commandName.includes(".."))
    return true;
  if (/^[a-zA-Z]:/.test(commandName))
    return true;
  if (commandName.includes("\x00"))
    return true;
  return false;
}
function isExecutable(filePath) {
  try {
    accessSync(filePath, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch (error) {
    if (!(error instanceof Error) && Object.prototype.toString.call(error) !== "[object Error]") {
      throw error;
    }
    return false;
  }
}
function resolvePathValue() {
  if (process.platform === "win32")
    return process.env["Path"] ?? process.env["PATH"];
  return process.env["PATH"];
}
function getWindowsCandidates(commandName) {
  if (process.platform !== "win32")
    return [commandName];
  if (/\.[^\\/]+$/.test(commandName))
    return [commandName];
  return [commandName, `${commandName}.exe`, `${commandName}.cmd`, `${commandName}.bat`, `${commandName}.com`];
}
function bunWhich(commandName) {
  if (!commandName)
    return null;
  if (isUnsafeCommandName(commandName))
    return null;
  const candidateNames = getWindowsCandidates(commandName);
  for (const candidateName of candidateNames) {
    const resolvedPath = runtime2.Bun?.which(candidateName) ?? null;
    if (resolvedPath !== null)
      return resolvedPath;
  }
  const pathValue = resolvePathValue();
  if (!pathValue)
    return null;
  const pathEntries = pathValue.split(delimiter).filter((pathEntry) => pathEntry.length > 0);
  if (pathEntries.length === 0)
    return null;
  for (const pathEntry of pathEntries) {
    for (const candidateName of candidateNames) {
      const candidatePath = join(pathEntry, candidateName);
      if (isExecutable(candidatePath))
        return candidatePath;
    }
  }
  return null;
}
// packages/utils/src/runtime/git-bash.ts
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
var GIT_BASH_ENV_KEY = "OMO_CODEX_GIT_BASH_PATH";
var WINGET_INSTALL_ARGS = ["install", "--id", "Git.Git", "-e", "--source", "winget"];
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
var WINDOWS_CMD_SHIM_COMMANDS = new Set(["npm", "npx"]);
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
import { join as join31, resolve as resolve10 } from "node:path";
import { existsSync as existsSync7 } from "node:fs";
import { homedir as homedir2 } from "node:os";

// packages/omo-codex/src/install/codex-cache-bins.ts
import { chmod, lstat as lstat3, mkdir, readFile as readFile2, readdir, readlink as readlink2, rm as rm2, stat, symlink, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join as join4, relative, resolve, sep } from "node:path";

// packages/omo-codex/src/install/codex-cache-command-shim.ts
var COMMAND_SHIM_MARKER = ":: generated by oh-my-openagent Codex installer";

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

// packages/omo-codex/src/install/codex-cache-legacy-bins.ts
import { lstat as lstat2, readFile, readlink, rm } from "node:fs/promises";
import { join as join2 } from "node:path";
var LEGACY_CODEX_COMPONENT_BINS = [
  { name: "omo", component: "ulw-loop" },
  { name: "codex-comment-checker", component: "comment-checker" },
  { name: "codex-lsp", component: "lsp" },
  { name: "codex-rules", component: "rules" },
  { name: "codex-start-work-continuation", component: "start-work-continuation" },
  { name: "codex-telemetry", component: "telemetry" },
  { name: "codex-ultrawork", component: "ultrawork" }
];
async function removeLegacyCodexComponentBins(binDir, platform) {
  for (const entry of LEGACY_CODEX_COMPONENT_BINS) {
    const linkPath = join2(binDir, platform === "win32" ? `${entry.name}.cmd` : entry.name);
    await removeLegacyCodexComponentBin(linkPath, entry.component, platform);
  }
}
async function removeLegacyCodexComponentBin(linkPath, component, platform) {
  try {
    const stat = await lstat2(linkPath);
    if (platform !== "win32") {
      if (!stat.isSymbolicLink())
        return;
      const target = await readlink(linkPath);
      if (isManagedLegacyComponentTarget(target, component))
        await rm(linkPath, { force: true });
      return;
    }
    if (!stat.isFile())
      return;
    const content = await readFile(linkPath, "utf8");
    if (content.includes(COMMAND_SHIM_MARKER))
      await rm(linkPath, { force: true });
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
  return suffix[0] === "components" && suffix[1] === component && suffix[2] === "dist" && suffix[3] === "cli.js" && (hasPluginCachePrefix(parts, suffixStart) || hasOmoCodexPluginPrefix(parts, suffixStart));
}
function hasPluginCachePrefix(parts, endExclusive) {
  for (let index = 0;index < endExclusive - 1; index += 1) {
    if (parts[index] === "plugins" && parts[index + 1] === "cache")
      return true;
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
function isNodeErrorWithCode2(error) {
  return typeof error === "object" && error !== null && "code" in error;
}

// packages/omo-codex/src/install/codex-cache-runtime-wrapper.ts
import { join as join3 } from "node:path";
var RUNTIME_WRAPPER_MARKER = "OMO_GENERATED_RUNTIME_WRAPPER";
function posixRuntimeWrapper(cliPath, codexHome, binDir, nodeCliPath) {
  const ulwLoopBin = toPosixPath(join3(binDir, "omo-ulw-loop"));
  const nodeCli = escapePosixDoubleQuoted(toPosixPath(nodeCliPath));
  const escapedCliPath = escapePosixDoubleQuoted(toPosixPath(cliPath));
  const escapedCodexHome = escapePosixDoubleQuoted(toPosixPath(codexHome));
  const escapedUlwLoopBin = escapePosixDoubleQuoted(ulwLoopBin);
  return [
    "#!/bin/sh",
    `# ${RUNTIME_WRAPPER_MARKER}`,
    `export CODEX_HOME="\${CODEX_HOME:-${escapedCodexHome}}"`,
    'export OMO_SPARKSHELL_APP_SERVER_SOCKET="${OMO_SPARKSHELL_APP_SERVER_SOCKET:-$CODEX_HOME/app-server-control/app-server-control.sock}"',
    'if [ "$1" = "ulw-loop" ] && [ -x "' + escapedUlwLoopBin + '" ]; then',
    "  shift",
    '  exec "' + escapedUlwLoopBin + '" "$@"',
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
    `  echo "omo: bun runtime not found (checked PATH, ~/.bun/bin, /opt/homebrew/bin, /usr/local/bin) and the node fallback CLI is missing at ${nodeCli}; install bun from https://bun.sh, or reinstall omo and force the fallback with OMO_RUNTIME=node" >&2`,
    "  exit 127",
    "fi",
    `if [ ! -f "${escapedCliPath}" ]; then`,
    `  echo "omo: runtime target missing at ${escapedCliPath}; reinstall with: npx --yes lazycodex-ai@latest install --no-tui" >&2`,
    "  exit 1",
    "fi",
    `exec "$BUN_BINARY" "${escapedCliPath}" "$@"`,
    ""
  ].join(`
`);
}
function windowsRuntimeWrapper(cliPath, codexHome, binDir, nodeCliPath) {
  const ulwLoopBin = join3(binDir, "omo-ulw-loop.cmd");
  return [
    "@echo off",
    `rem ${RUNTIME_WRAPPER_MARKER}`,
    `if not defined CODEX_HOME set "CODEX_HOME=${codexHome}"`,
    'if not defined OMO_SPARKSHELL_APP_SERVER_SOCKET set "OMO_SPARKSHELL_APP_SERVER_SOCKET=%CODEX_HOME%\\app-server-control\\app-server-control.sock"',
    `if "%~1"=="ulw-loop" if exist "${ulwLoopBin}" (`,
    "  shift /1",
    `  "${ulwLoopBin}" %*`,
    "  exit /b %ERRORLEVEL%",
    ")",
    `if "%OMO_RUNTIME%"=="node" if exist "${nodeCliPath}" (`,
    `  node "${nodeCliPath}" %*`,
    "  exit /b %ERRORLEVEL%",
    ")",
    'if not defined BUN_BINARY where bun >nul 2>nul && set "BUN_BINARY=bun"',
    'if not defined BUN_BINARY if exist "%USERPROFILE%\\.bun\\bin\\bun.exe" set "BUN_BINARY=%USERPROFILE%\\.bun\\bin\\bun.exe"',
    "if not defined BUN_BINARY (",
    `  if exist "${nodeCliPath}" (`,
    `    node "${nodeCliPath}" %*`,
    "    exit /b %ERRORLEVEL%",
    "  )",
    `  echo omo: bun runtime not found and the node fallback CLI is missing at ${nodeCliPath}; install bun from https://bun.sh or reinstall omo and force OMO_RUNTIME=node 1>&2`,
    "  exit /b 127",
    ")",
    `if not exist "${cliPath}" (`,
    `  echo omo: runtime target missing at ${cliPath}; reinstall with: npx --yes lazycodex-ai@latest install --no-tui 1>&2`,
    "  exit /b 1",
    ")",
    `"%BUN_BINARY%" "${cliPath}" %*`,
    ""
  ].join(`\r
`);
}
function toPosixPath(path) {
  return path.replaceAll("\\", "/");
}
function escapePosixDoubleQuoted(value) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', "\\\"").replaceAll("$", "\\$").replaceAll("`", "\\`");
}

// packages/omo-codex/src/install/codex-cache-bins.ts
var RESERVED_NESTED_BIN_NAMES = new Set(["omo", "lazycodex", "lazycodex-ai", "oh-my-opencode", "oh-my-openagent"]);
async function linkCachedPluginBins(input) {
  const binLinks = await discoverPackageBins(input.pluginRoot);
  const platform = input.platform ?? process.platform;
  await mkdir(input.binDir, { recursive: true });
  await removeLegacyCodexComponentBins(input.binDir, platform);
  const linked = [];
  for (const link of binLinks) {
    const linkPath = await linkCachedPluginBin(input.binDir, link, platform);
    linked.push({ name: link.name, path: linkPath, target: link.target });
  }
  return linked;
}
async function linkRootRuntimeBin(input) {
  const cliPath = join4(input.repoRoot, "dist", "cli", "index.js");
  if (!await isFile(cliPath))
    return null;
  const nodeCliPath = join4(input.repoRoot, "dist", "cli-node", "index.js");
  const platform = input.platform ?? process.platform;
  await mkdir(input.binDir, { recursive: true });
  if (platform === "win32") {
    const linkPath2 = join4(input.binDir, "omo.cmd");
    await replaceRuntimeWrapper(linkPath2, windowsRuntimeWrapper(cliPath, input.codexHome, input.binDir, nodeCliPath));
    return { name: "omo", path: linkPath2, target: cliPath };
  }
  const linkPath = join4(input.binDir, "omo");
  await replaceRuntimeWrapper(linkPath, posixRuntimeWrapper(cliPath, input.codexHome, input.binDir, nodeCliPath));
  await chmod(linkPath, 493);
  return { name: "omo", path: linkPath, target: cliPath };
}
async function linkCachedPluginBin(binDir, link, platform) {
  if (platform === "win32") {
    const linkPath2 = join4(binDir, `${link.name}.cmd`);
    await replaceCommandShim(linkPath2, link.target);
    return linkPath2;
  }
  const linkPath = join4(binDir, link.name);
  await replaceSymlink(linkPath, link.target);
  return linkPath;
}
async function isFile(path) {
  try {
    return (await stat(path)).isFile();
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
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.some((entry) => entry.isFile() && entry.name === "package.json")) {
    await appendPackageBinLinks(join4(directory, "package.json"), directory, root, links);
  }
  for (const entry of entries) {
    if (!entry.isDirectory())
      continue;
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist")
      continue;
    const childPath = join4(directory, entry.name);
    if (!childPath.startsWith(root))
      continue;
    await collectPackageBins(childPath, root, links);
  }
}
async function appendPackageBinLinks(packageJsonPath, packageRoot, root, links) {
  const packageJson = JSON.parse(await readFile2(packageJsonPath, "utf8"));
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
  const root = resolve(packageRoot);
  const resolvedTarget = resolve(root, target);
  const relativeTarget = relative(root, resolvedTarget);
  if (relativeTarget === "" || relativeTarget !== ".." && !relativeTarget.startsWith(`..${sep}`) && !isAbsolute(relativeTarget)) {
    return resolvedTarget;
  }
  throw new Error("Package bin target must stay inside package root");
}
async function replaceSymlink(linkPath, targetPath) {
  if (await existingNonSymlink(linkPath))
    throw new Error(`${linkPath} already exists and is not a symlink`);
  await rm2(linkPath, { force: true });
  await symlink(targetPath, linkPath);
}
async function replaceCommandShim(linkPath, targetPath) {
  if (await existingNonShim(linkPath))
    throw new Error(`${linkPath} already exists and is not a command shim`);
  await writeFile(linkPath, `@echo off\r
${COMMAND_SHIM_MARKER}\r
node "${targetPath}" %*\r
`);
}
async function replaceRuntimeWrapper(linkPath, content) {
  if (await existingNonRuntimeWrapper(linkPath))
    throw new Error(`${linkPath} already exists and is not a generated OMO runtime wrapper`);
  await rm2(linkPath, { force: true });
  await writeFile(linkPath, content);
}
async function existingNonRuntimeWrapper(path) {
  try {
    const stat2 = await lstat3(path);
    if (stat2.isSymbolicLink())
      return false;
    if (!stat2.isFile())
      return true;
    const content = await readFile2(path, "utf8");
    return !content.includes(RUNTIME_WRAPPER_MARKER);
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT")
      return false;
    throw error;
  }
}
async function existingNonShim(path) {
  try {
    const stat2 = await lstat3(path);
    if (!stat2.isFile())
      return true;
    const content = await readFile2(path, "utf8");
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
    const stat2 = await lstat3(path);
    if (!stat2.isSymbolicLink())
      return true;
    await readlink2(path);
    return false;
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT")
      return false;
    throw error;
  }
}
// packages/omo-codex/src/install/codex-cache-install.ts
import { cp as cp2, mkdir as mkdir3, readFile as readFile7, rename, rm as rm3 } from "node:fs/promises";
import { basename as basename3, dirname as dirname4, join as join11, sep as sep5 } from "node:path";

// packages/omo-codex/src/install/codex-cache-bundled-mcps.ts
import { cp, mkdir as mkdir2, readFile as readFile3, stat as stat2 } from "node:fs/promises";
import { dirname, join as join5, resolve as resolve2 } from "node:path";
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
  const sourceArgs = await readSourceMcpArgs(join5(input.sourceRoot, ".mcp.json"));
  for (const runtime3 of BUNDLED_MCP_RUNTIMES) {
    if (!sourceArgs.has(runtime3.sourceArg))
      continue;
    await copyBundledMcpRuntimeDist(input.pluginRoot, input.sourceRoot, runtime3);
  }
}
function resolveBundledMcpRuntimeArg(pluginRoot, arg) {
  const runtime3 = BUNDLED_MCP_RUNTIMES.find((candidate) => candidate.sourceArg === arg);
  return runtime3 ? join5(pluginRoot, runtime3.destinationArg) : null;
}
async function copyBundledMcpRuntimeDist(pluginRoot, sourceRoot, runtime3) {
  const sourcePath = resolve2(sourceRoot, runtime3.sourceDistFromPlugin);
  if (!await isDirectory(sourcePath)) {
    throw new Error(`missing built ${runtime3.label} dist at ${sourcePath}`);
  }
  const destinationPath = join5(pluginRoot, runtime3.destinationDistFromPlugin);
  await mkdir2(dirname(destinationPath), { recursive: true });
  await cp(sourcePath, destinationPath, { recursive: true });
}
async function readSourceMcpArgs(path) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile3(path, "utf8"));
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
    return (await stat2(path)).isDirectory();
  } catch (error) {
    if (error instanceof Error)
      return false;
    return false;
  }
}

// packages/omo-codex/src/install/codex-cache-local-dependencies.ts
import { realpathSync } from "node:fs";
import { readFile as readFile4, readdir as readdir2, writeFile as writeFile2 } from "node:fs/promises";
import { dirname as dirname2, isAbsolute as isAbsolute3, join as join7, relative as relative3, resolve as resolve4, sep as sep2 } from "node:path";

// packages/omo-codex/src/install/codex-cache-paths.ts
import { isAbsolute as isAbsolute2, join as join6, relative as relative2, resolve as resolve3 } from "node:path";
function resolveCachedRuntimePath(pluginRoot, sourceRoot, runtimePath) {
  const targetPath = resolve3(pluginRoot, runtimePath);
  if (isPathInside(targetPath, pluginRoot))
    return targetPath;
  return resolve3(sourceRoot, runtimePath);
}
function isPathInside(candidatePath, rootPath) {
  const pathFromRoot = relative2(rootPath, candidatePath);
  return pathFromRoot === "" || !pathFromRoot.startsWith("..") && !isAbsolute2(pathFromRoot);
}

// packages/omo-codex/src/install/codex-cache-local-dependencies.ts
async function rewriteCachedPackageLocalFileDependencies(pluginRoot, sourceRoot) {
  const packageJsonPaths = [];
  await collectPackageJsonPaths(pluginRoot, pluginRoot, packageJsonPaths);
  const packageLock = await readPackageLock(pluginRoot);
  for (const packageJsonPath of packageJsonPaths) {
    const raw = await readFile4(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!isPlainRecord(parsed))
      continue;
    const packageDir = dirname2(packageJsonPath);
    const sourcePackageDir = join7(sourceRoot, relative3(pluginRoot, packageDir));
    let changed = false;
    for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      const dependencies = parsed[field];
      if (!isPlainRecord(dependencies))
        continue;
      for (const [name, specifier] of Object.entries(dependencies)) {
        if (typeof specifier !== "string" || !specifier.startsWith("file:"))
          continue;
        const filePath = specifier.slice("file:".length);
        if (filePath.length === 0 || isAbsolute3(filePath))
          continue;
        const targetPath = resolve4(packageDir, filePath);
        if (isPathInside(targetPath, pluginRoot))
          continue;
        const sourceTargetPath = resolve4(sourcePackageDir, filePath);
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
    if (changed)
      await writeFile2(packageJsonPath, `${JSON.stringify(parsed, null, "\t")}
`);
  }
  if (packageLock.changed)
    await writeFile2(packageLock.path, `${JSON.stringify(packageLock.value, null, "\t")}
`);
}
async function readPackageLock(pluginRoot) {
  const path = join7(pluginRoot, "package-lock.json");
  try {
    const parsed = JSON.parse(await readFile4(path, "utf8"));
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
    return realpathSync(path);
  } catch (error) {
    if (error instanceof Error)
      return path;
    throw error;
  }
}
async function collectPackageJsonPaths(directory, root, paths) {
  const entries = await readdir2(directory, { withFileTypes: true });
  if (entries.some((entry) => entry.isFile() && entry.name === "package.json")) {
    paths.push(join7(directory, "package.json"));
  }
  for (const entry of entries) {
    if (!entry.isDirectory())
      continue;
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist")
      continue;
    const childPath = join7(directory, entry.name);
    if (!isPathInside(childPath, root))
      continue;
    await collectPackageJsonPaths(childPath, root, paths);
  }
}

// packages/omo-codex/src/install/codex-cache-mcp-manifest.ts
import { readFile as readFile5, writeFile as writeFile3 } from "node:fs/promises";
import { join as join9, sep as sep3 } from "node:path";

// packages/utils/src/codegraph/resolve.ts
import { existsSync as existsSync2 } from "node:fs";
import { spawnSync as spawnSync2 } from "node:child_process";
import { basename as basename2, dirname as dirname3, join as join8 } from "node:path";
import { createRequire } from "node:module";

// packages/utils/src/codegraph/node-support.ts
var CODEGRAPH_MIN_NODE_MAJOR = 20;
var CODEGRAPH_BLOCKED_NODE_MAJOR = 25;
var CODEGRAPH_UNSAFE_NODE_ENV = "CODEGRAPH_ALLOW_UNSAFE_NODE";
var CODEGRAPH_NODE_BIN_ENV = "CODEGRAPH_NODE_BIN";
function evaluateCodegraphNodeSupport(options = {}) {
  const nodeVersion = options.nodeVersion ?? process.versions.node;
  const env = options.env ?? process.env;
  const override = (env[CODEGRAPH_UNSAFE_NODE_ENV]?.trim().length ?? 0) > 0;
  const major = parseNodeMajor(nodeVersion);
  if (major >= CODEGRAPH_BLOCKED_NODE_MAJOR) {
    return { major, override, reason: "too-new", supported: override };
  }
  if (major < CODEGRAPH_MIN_NODE_MAJOR) {
    return { major, override, reason: "too-old", supported: override };
  }
  return { major, override, supported: true };
}
function parseNodeMajor(version) {
  const normalized = version.startsWith("v") ? version.slice(1) : version;
  const major = Number.parseInt(normalized.split(".")[0] ?? "", 10);
  return Number.isNaN(major) ? 0 : major;
}

// packages/utils/src/codegraph/resolve.ts
var CODEGRAPH_NODE_CANDIDATES = ["node24", "node22", "node20", "node"];
var CODEGRAPH_NODE_PATH_CANDIDATES = [
  "/opt/homebrew/opt/node@24/bin/node",
  "/opt/homebrew/opt/node@22/bin/node",
  "/opt/homebrew/opt/node@20/bin/node",
  "/usr/local/opt/node@24/bin/node",
  "/usr/local/opt/node@22/bin/node",
  "/usr/local/opt/node@20/bin/node"
];
var requireFromHere = createRequire(import.meta.url);
function defaultNodeVersion(nodePath) {
  if (nodePath === process.execPath && isNodeExecutableName(nodePath))
    return process.versions.node;
  try {
    const result = spawnSync2(nodePath, ["--version"], {
      encoding: "utf8",
      timeout: 2000,
      windowsHide: true
    });
    if (result.error !== undefined || result.status !== 0)
      return null;
    const version = `${result.stdout}
${result.stderr}`.trim().split(/\s+/)[0];
    return version === undefined || version.length === 0 ? null : version;
  } catch (error) {
    if (error instanceof Error)
      return null;
    throw error;
  }
}
function isNodeExecutableName(filePath) {
  const executable = basename2(filePath).toLowerCase();
  return executable === "node" || executable === "node.exe" || /^node\d+(\.exe)?$/.test(executable);
}
function looksLikePath(command) {
  return command.includes("/") || command.includes("\\") || /^[a-zA-Z]:/.test(command);
}
function resolveConfiguredNodeRuntime(configured, fileExists, which2) {
  if (looksLikePath(configured))
    return fileExists(configured) ? configured : null;
  return which2(configured);
}
function supportsCodegraphNodeRuntime(nodePath, env, nodeVersion) {
  const version = nodeVersion(nodePath);
  if (version === null)
    return false;
  return evaluateCodegraphNodeSupport({ env, nodeVersion: version }).supported;
}
function defaultNodeRuntime(env, fileExists, which2, nodeVersion) {
  const configured = env[CODEGRAPH_NODE_BIN_ENV]?.trim();
  if (configured !== undefined && configured.length > 0) {
    const resolved = resolveConfiguredNodeRuntime(configured, fileExists, which2);
    return resolved !== null && supportsCodegraphNodeRuntime(resolved, env, nodeVersion) ? resolved : null;
  }
  const candidates = [
    ...isNodeExecutableName(process.execPath) ? [process.execPath] : [],
    ...CODEGRAPH_NODE_CANDIDATES.map((commandName) => which2(commandName)).filter((candidate) => candidate !== null),
    ...CODEGRAPH_NODE_PATH_CANDIDATES.filter((candidate) => fileExists(candidate))
  ];
  const seen = new Set;
  for (const candidate of candidates) {
    if (seen.has(candidate))
      continue;
    seen.add(candidate);
    if (supportsCodegraphNodeRuntime(candidate, env, nodeVersion))
      return candidate;
  }
  return null;
}
function resolveCodegraphNodeRuntime(options = {}) {
  const env = options.env ?? process.env;
  return defaultNodeRuntime(env, options.fileExists ?? existsSync2, options.which ?? bunWhich, options.nodeVersion ?? defaultNodeVersion);
}
function resolveCodegraphNodeSupport(options = {}) {
  const env = options.env ?? process.env;
  const nodeVersion = options.nodeVersion ?? defaultNodeVersion;
  const runtime3 = resolveCodegraphNodeRuntime({ ...options, env, nodeVersion });
  if (runtime3 === null) {
    return evaluateCodegraphNodeSupport({ env, nodeVersion: "0.0.0" });
  }
  return evaluateCodegraphNodeSupport({ env, nodeVersion: nodeVersion(runtime3) ?? "0.0.0" });
}

// packages/omo-codex/src/install/codex-cache-mcp-manifest.ts
var CODEGRAPH_RELATIVE_ARGS = new Set(["components/codegraph/dist/serve.js", "./components/codegraph/dist/serve.js"]);
var CONTEXT7_API_KEY_ENV = "CONTEXT7_API_KEY";
async function rewriteCachedMcpManifest(pluginRoot, sourceRoot = pluginRoot, options = {}) {
  const manifestPath = join9(pluginRoot, ".mcp.json");
  if (!await fileExistsStrict(manifestPath))
    return;
  const raw = await readFile5(manifestPath, "utf8");
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
        if (CODEGRAPH_RELATIVE_ARGS.has(arg))
          return join9(pluginRoot, "components", "codegraph", "dist", "serve.js");
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
    if (!Array.isArray(currentArgs))
      continue;
    if (server === parsed.mcpServers.codegraph) {
      const runtime3 = options.codegraphNodeRuntime?.() ?? resolveCodegraphNodeRuntime();
      if (runtime3 !== null && server.command === "node") {
        server.command = runtime3;
        changed = true;
      }
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
  const raw = await readFile5(manifestPath, "utf8");
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
import { readFile as readFile6 } from "node:fs/promises";
import { join as join10, sep as sep4 } from "node:path";
var PLUGIN_ROOT_TARGET_PATTERN = /\$\{PLUGIN_ROOT\}[\\/]+([^"']+)/g;
async function findMissingHookCommandTargets(pluginRoot) {
  const commands = [];
  for (const manifestPath of await hookManifestPaths(pluginRoot)) {
    if (!await fileExistsStrict(manifestPath))
      continue;
    const parsed = JSON.parse(await readFile6(manifestPath, "utf8"));
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
  const parsed = JSON.parse(await readFile6(pluginManifestPath, "utf8"));
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
  if (input.buildSource !== false) {
    await maybeRunNpmInstall(input.sourcePath, input.runCommand);
    await maybeRunNpmBuild(input.sourcePath, input.runCommand);
  }
  const targetPath = join11(input.codexHome, "plugins", "cache", input.marketplaceName, input.name, input.version);
  const tempPath = createTempSiblingPath(targetPath);
  await rm3(tempPath, { recursive: true, force: true });
  try {
    await copyDirectory(input.sourcePath, tempPath);
    await rewriteCachedPackageLocalFileDependencies(tempPath, input.sourcePath);
    await copyBundledMcpRuntimeDists({ pluginRoot: tempPath, sourceRoot: input.sourcePath });
    await maybeRunNpmInstall(tempPath, input.runCommand, ["ci", "--omit=dev"]);
    if (input.buildSource === false)
      await maybeRunNpmSyncSkills(tempPath, input.runCommand);
    await rewriteCachedMcpManifest(tempPath, input.sourcePath);
    await rewriteCachedManifestRoot(tempPath, tempPath, targetPath);
    await assertHookCommandTargets(tempPath);
    await promoteDirectory(tempPath, targetPath, input.renameDirectory ?? rename);
  } catch (error) {
    await rm3(tempPath, { recursive: true, force: true });
    throw error;
  }
  return { name: input.name, version: input.version, path: targetPath };
}
async function maybeRunNpmInstall(cwd, runCommand, args = ["install"]) {
  if (!await fileExistsStrict(join11(cwd, "package.json")))
    return;
  await runCommand("npm", args, { cwd });
}
async function maybeRunNpmBuild(cwd, runCommand) {
  if (!await fileExistsStrict(join11(cwd, "package.json")))
    return;
  const packageJson = JSON.parse(await readFile7(join11(cwd, "package.json"), "utf8"));
  if (!isPlainRecord(packageJson))
    return;
  const scripts = packageJson.scripts;
  if (!isPlainRecord(scripts) || typeof scripts.build !== "string")
    return;
  await runCommand("npm", ["run", "build"], { cwd });
}
async function maybeRunNpmSyncSkills(cwd, runCommand) {
  if (!await fileExistsStrict(join11(cwd, "package.json")))
    return;
  const packageJson = JSON.parse(await readFile7(join11(cwd, "package.json"), "utf8"));
  if (!isPlainRecord(packageJson))
    return;
  const scripts = packageJson.scripts;
  if (!isPlainRecord(scripts) || typeof scripts["sync:skills"] !== "string")
    return;
  await runCommand("npm", ["run", "sync:skills"], { cwd });
}
function createTempSiblingPath(targetPath) {
  return join11(dirname4(targetPath), `.tmp-${basename3(targetPath)}-${process.pid}-${Date.now()}`);
}
function createBackupSiblingPath(targetPath) {
  return join11(dirname4(targetPath), `.backup-${basename3(targetPath)}-${process.pid}-${Date.now()}`);
}
async function copyDirectory(sourcePath, targetPath) {
  await mkdir3(dirname4(targetPath), { recursive: true });
  await cp2(sourcePath, targetPath, { recursive: true, filter: (source) => shouldCopyPluginPath(source, sourcePath) });
}
async function promoteDirectory(tempPath, targetPath, renameDirectory) {
  const backupPath = createBackupSiblingPath(targetPath);
  await rm3(backupPath, { recursive: true, force: true });
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
    await rm3(backupPath, { recursive: true, force: true });
}
async function restoreBackupDirectory(backupPath, targetPath, renameDirectory) {
  if (!await fileExistsStrict(backupPath))
    return;
  await rm3(targetPath, { recursive: true, force: true });
  await renameDirectory(backupPath, targetPath);
}
function shouldCopyPluginPath(path, root) {
  const relative4 = path === root ? "" : path.slice(root.length + sep5.length);
  if (relative4 === "")
    return true;
  const parts = relative4.split(sep5);
  return !parts.some((part) => part === ".git" || part === "node_modules");
}
// packages/omo-codex/src/install/codex-cache-prune.ts
import { lstat as lstat4, readdir as readdir3, rm as rm4, stat as stat3 } from "node:fs/promises";
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
    await rm4(join12(cacheRoot, entry.name), { recursive: true, force: true });
  }
}
async function pruneMarketplacePluginCaches(input) {
  const cacheRoot = join12(input.codexHome, "plugins", "cache", input.marketplaceName);
  if (!await fileExistsStrict(cacheRoot))
    return;
  for (const pluginName of input.pluginNames) {
    await rm4(join12(cacheRoot, pluginName), { recursive: true, force: true });
  }
  const remainingEntries = await readCacheEntryNames(cacheRoot);
  if (remainingEntries.length === 0) {
    await rm4(cacheRoot, { recursive: true, force: true });
  }
}
async function readCacheEntries(path) {
  const emptyEntries = [];
  return readCacheRoot(path, () => readdir3(path, { withFileTypes: true }), emptyEntries);
}
async function readCacheEntryNames(path) {
  const emptyNames = [];
  return readCacheRoot(path, () => readdir3(path), emptyNames);
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
    const entry = await lstat4(path);
    if (!entry.isSymbolicLink())
      return false;
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT")
      return true;
    throw error;
  }
  try {
    await stat3(path);
    return false;
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT")
      return true;
    throw error;
  }
}
// packages/omo-codex/src/install/codex-cached-marketplace-manifest.ts
import { mkdir as mkdir4, writeFile as writeFile4 } from "node:fs/promises";
import { join as join13 } from "node:path";
async function writeCachedMarketplaceManifest(input) {
  const marketplaceDir = join13(input.marketplaceRoot, ".agents", "plugins");
  await mkdir4(marketplaceDir, { recursive: true });
  await writeFile4(join13(marketplaceDir, "marketplace.json"), `${JSON.stringify({
    name: input.marketplaceName,
    plugins: input.plugins.map((plugin) => ({
      name: plugin.name,
      source: { source: "local", path: `./${plugin.name}/${plugin.version}` }
    }))
  }, null, "\t")}
`);
}

// packages/omo-codex/src/install/codex-package-layout.ts
import { existsSync as existsSync3 } from "node:fs";
import { readFile as readFile8 } from "node:fs/promises";
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
  const packageJson = JSON.parse(await readFile8(packageJsonPath, "utf8"));
  if (!isPlainRecord(packageJson) || typeof packageJson.name !== "string")
    return true;
  return !PACKAGED_CODEX_INSTALLER_NAMES.has(packageJson.name);
}

// packages/omo-codex/src/install/codex-config-toml.ts
import { mkdir as mkdir5, readFile as readFile10 } from "node:fs/promises";
import { dirname as dirname6 } from "node:path";

// packages/omo-codex/src/install/toml-section-editor.ts
function findTomlSection(config, header) {
  const headerLine = `[${header}]`;
  const targetHeaderPath = parseTomlDottedKey(header);
  const lines = config.match(/[^\n]*\n?|$/g) ?? [];
  let offset = 0;
  let start = -1;
  for (const line of lines) {
    if (line.length === 0)
      break;
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
  const linePattern = new RegExp(`^[ \\t]*${escapeRegExp(key)}[ \\t]*=.*$`, "m");
  const replacement = linePattern.test(section.text) ? section.text.replace(linePattern, `${key} = ${value}`) : insertSetting(section.text, key, value);
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
function appendBlock(config, block) {
  const prefix = config.trimEnd();
  return `${prefix}${prefix.length > 0 ? `

` : ""}${block.trimEnd()}
`;
}
function findFirstTableStart(config) {
  const lines = config.match(/[^\n]*\n?|$/g) ?? [];
  let offset = 0;
  for (const line of lines) {
    if (line.length === 0)
      break;
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
  return splitTomlSections(config).filter((section) => section.header === null || !shouldRemove(section.header)).map((section) => section.text).join("").replace(/\n{3,}/g, `

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
function parseHookStateHeaderKey(header) {
  const path = parseTomlDottedKey(header);
  if (path?.[0] !== "hooks" || path[1] !== "state")
    return null;
  return path[2] ?? null;
}
function parseTomlHeader(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]") || trimmed.startsWith("[["))
    return null;
  return trimmed.slice(1, -1);
}

// packages/omo-codex/src/install/codex-config-agents.ts
var LEGACY_MANAGED_CODEX_AGENT_NAMES_TO_PURGE = ["codex-ultrawork-reviewer"];
var CURRENT_MANAGED_CODEX_AGENT_NAMES = [
  "explorer",
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
import { lstat as lstat5, readlink as readlink3, realpath, rename as rename2, unlink, writeFile as writeFile5 } from "node:fs/promises";
import { basename as basename4, dirname as dirname5, isAbsolute as isAbsolute4, join as join15, resolve as resolve5 } from "node:path";
var RENAME_RETRY_DELAYS_MS = [10, 25, 50];
var RETRIABLE_RENAME_CODES = new Set(["EPERM", "EBUSY"]);
async function writeFileAtomic(targetPath, data) {
  const writeTarget = await resolveSymlinkTarget(targetPath);
  const temporaryPath = join15(dirname5(writeTarget), `.tmp-${basename4(writeTarget)}-${process.pid}-${Date.now()}`);
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
    const linkStats = await lstat5(targetPath);
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
    const linkValue = await readlink3(targetPath);
    return isAbsolute4(linkValue) ? linkValue : resolve5(dirname5(targetPath), linkValue);
  }
}
async function renameWithRetry(fromPath, toPath) {
  for (let attempt = 0;; attempt += 1) {
    try {
      await rename2(fromPath, toPath);
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

// packages/omo-codex/src/install/codex-config-features.ts
function ensureFeatureEnabled(config, featureName) {
  const section = findTomlSection(config, "features");
  if (!section)
    return appendBlock(config, `[features]
${featureName} = true
`);
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
var AUTONOMOUS_FEATURES = ["multi_agent", "child_agents_md", "unified_exec", "goals"];
function ensureAutonomousPermissions(config) {
  let next = replaceOrInsertRootSetting(config, "approval_policy", JSON.stringify("never"));
  next = replaceOrInsertRootSetting(next, "sandbox_mode", JSON.stringify("danger-full-access"));
  next = replaceOrInsertRootSetting(next, "network_access", JSON.stringify("enabled"));
  for (const featureName of AUTONOMOUS_FEATURES) {
    next = ensureFeatureEnabled2(next, featureName);
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
function ensureFeatureEnabled2(config, key) {
  const section = findTomlSection(config, "features");
  if (section === null)
    return appendBlock(config, `[features]
${key} = true
`);
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
  const codegraphEnabled = input.codegraphMcpEnabled ?? true;
  const gitBashEnabled = (input.platform ?? process.platform) === "win32" && input.gitBashEnabled === true;
  let nextConfig = ensurePluginMcpEnabled(config, "omo@sisyphuslabs", "context7", true);
  nextConfig = ensurePluginMcpEnabled(nextConfig, "omo@sisyphuslabs", "codegraph", codegraphEnabled);
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

// packages/omo-codex/src/install/codex-config-reasoning.ts
var MANAGED_KEYS = ["model", "model_context_window", "model_reasoning_effort", "plan_mode_reasoning_effort"];
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
import { readFile as readFile9 } from "node:fs/promises";
import { join as join16 } from "node:path";
var FALLBACK_CODEX_MODEL_CATALOG = {
  current: {
    model: "gpt-5.5",
    modelContextWindow: 400000,
    modelReasoningEffort: "high",
    planModeReasoningEffort: "xhigh"
  },
  managedProfiles: [
    {
      model: "gpt-5.5",
      modelContextWindow: 1e6,
      modelReasoningEffort: "high",
      planModeReasoningEffort: "xhigh"
    },
    { model: "gpt-5.5", modelContextWindow: 272000 }
  ]
};
async function readCodexModelCatalog(codexPackageRoot) {
  const catalogPath = join16(codexPackageRoot, "plugin", "model-catalog.json");
  try {
    const parsed = JSON.parse(await readFile9(catalogPath, "utf8"));
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
var CODEX_AGENTS_HEADER = "agents";
var CODEX_MULTI_AGENT_V2_HEADER = "features.multi_agent_v2";
var CODEX_SUBAGENT_THREAD_LIMIT = 1000;
function ensureCodexMultiAgentV2Config(config) {
  const normalizedConfig = removeFeatureFlagSetting(config, "multi_agent_v2");
  const agentsConfig = ensureAgentsMaxThreads(normalizedConfig);
  const section = findTomlSection(agentsConfig, CODEX_MULTI_AGENT_V2_HEADER);
  const maxThreadsValue = CODEX_SUBAGENT_THREAD_LIMIT.toString();
  if (!section) {
    return appendBlock(agentsConfig, `[${CODEX_MULTI_AGENT_V2_HEADER}]
max_concurrent_threads_per_session = ${maxThreadsValue}
`);
  }
  return replaceOrInsertSetting(agentsConfig, section, "max_concurrent_threads_per_session", maxThreadsValue);
}
function removeFeatureFlagSetting(config, featureName) {
  const section = findTomlSection(config, "features");
  if (!section)
    return config;
  return removeSetting(config, section, featureName);
}
function ensureAgentsMaxThreads(config) {
  const maxThreadsValue = CODEX_SUBAGENT_THREAD_LIMIT.toString();
  const section = findTomlSection(config, CODEX_AGENTS_HEADER);
  if (!section) {
    return appendBlock(config, `[${CODEX_AGENTS_HEADER}]
max_threads = ${maxThreadsValue}
`);
  }
  return replaceOrInsertSetting(config, section, "max_threads", maxThreadsValue);
}

// packages/omo-codex/src/install/codex-config-toml.ts
async function updateCodexConfig(input) {
  await mkdir5(dirname6(input.configPath), { recursive: true });
  let config = "";
  if (await exists(input.configPath))
    config = await readFile10(input.configPath, "utf8");
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
  config = ensureFeatureEnabled(config, "child_agents_md");
  config = removeUnsupportedCodexMultiAgentModeConfig(config);
  config = ensureCodexReasoningConfig(config, await readCodexModelCatalog(input.repoRoot));
  config = ensureCodexMultiAgentV2Config(config);
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
async function exists(path) {
  try {
    await readFile10(path, "utf8");
    return true;
  } catch (error) {
    if (error instanceof Error)
      return false;
    return false;
  }
}

// packages/omo-codex/src/install/codex-hook-trust.ts
import { createHash } from "node:crypto";
import { readFile as readFile11 } from "node:fs/promises";
import { join as join17 } from "node:path";
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
  const manifestPath = join17(input.pluginRoot, ".codex-plugin", "plugin.json");
  if (!await exists2(manifestPath))
    return [];
  const manifest = JSON.parse(await readFile11(manifestPath, "utf8"));
  if (!isPlainRecord(manifest))
    return [];
  const states = [];
  for (const hookPath of hookManifestPaths2(manifest.hooks)) {
    const hooksPath = join17(input.pluginRoot, hookPath);
    if (!await exists2(hooksPath))
      continue;
    const parsed = JSON.parse(await readFile11(hooksPath, "utf8"));
    if (!isPlainRecord(parsed) || !isPlainRecord(parsed.hooks))
      continue;
    states.push(...trustedHookStatesForHooksFile({
      keySource: `${input.pluginName}@${input.marketplaceName}:${hookPath}`,
      hooks: parsed.hooks
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
        if (typeof handler.command !== "string" || handler.command.trim() === "")
          continue;
        const key = `${input.keySource}:${eventLabel}:${groupIndex}:${handlerIndex}`;
        states.push({ key, trustedHash: commandHookHash(eventLabel, group.matcher, handler) });
      }
    }
  }
  return states;
}
function commandHookHash(eventName, matcher, handler) {
  const timeout = Math.max(Number(handler.timeout ?? 600), 1);
  const normalizedHandler = {
    type: "command",
    command: handler.command,
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
async function exists2(path) {
  try {
    await readFile11(path, "utf8");
    return true;
  } catch (error) {
    if (error instanceof Error)
      return false;
    return false;
  }
}

// packages/omo-codex/src/install/git-bash.ts
var SKIP_GIT_BASH_AUTO_INSTALL_ENV_KEY = "OMO_CODEX_SKIP_GIT_BASH_AUTO_INSTALL";
var resolveGitBashForCurrentProcess2 = (input = {}) => {
  return toCodexResolution(resolveGitBashForCurrentProcess(input));
};
async function prepareGitBashForInstall(input) {
  const resolve6 = input.resolveGitBash ?? (() => resolveGitBashForCurrentProcess2({ platform: input.platform, env: input.env }));
  const initialResolution = resolve6();
  if (input.platform !== "win32" || initialResolution.found)
    return initialResolution;
  if (input.env[SKIP_GIT_BASH_AUTO_INSTALL_ENV_KEY] === "1")
    return initialResolution;
  try {
    await input.runCommand("winget", WINGET_INSTALL_ARGS, { cwd: input.cwd });
  } catch (error) {
    if (!(error instanceof Error))
      throw error;
    return initialResolution;
  }
  return resolve6();
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
import { copyFile, lstat as lstat7, mkdir as mkdir6, readFile as readFile13, readdir as readdir4, rm as rm6, writeFile as writeFile6 } from "node:fs/promises";
import { basename as basename5, join as join19 } from "node:path";

// packages/omo-codex/src/install/retired-managed-agent-purge.ts
import { lstat as lstat6, readFile as readFile12, rm as rm5 } from "node:fs/promises";
import { join as join18 } from "node:path";
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
  const agentsDir = join18(input.codexHome, "agents");
  if (!await exists3(agentsDir))
    return;
  for (const retiredAgent of RETIRED_MANAGED_AGENT_FILES) {
    const agentPath = join18(agentsDir, retiredAgent.fileName);
    if (!await exists3(agentPath))
      continue;
    const agentStat = await lstat6(agentPath);
    if (agentStat.isDirectory() && !agentStat.isSymbolicLink())
      continue;
    const content = await readTextIfExists(agentPath);
    if (content === null || !hasRequiredMarkers(content, retiredAgent.requiredMarkers))
      continue;
    await rm5(agentPath, { force: true });
  }
}
function hasRequiredMarkers(content, markers) {
  return markers.every((marker) => content.includes(marker));
}
async function readTextIfExists(path) {
  try {
    return await readFile12(path, "utf8");
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT")
      return null;
    throw error;
  }
}
async function exists3(path) {
  try {
    await lstat6(path);
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

// packages/omo-codex/src/install/link-cached-plugin-agents.ts
var MANIFEST_FILE = ".installed-agents.json";
async function capturePreservedAgentReasoning(input) {
  const agentsDir = join19(input.codexHome, "agents");
  if (!await exists4(agentsDir))
    return new Map;
  const preserved = new Map;
  const agentEntries = await readdir4(agentsDir, { withFileTypes: true });
  for (const entry of agentEntries) {
    if (!entry.name.endsWith(".toml"))
      continue;
    const content = await readTextIfExists2(join19(agentsDir, entry.name));
    if (content === null)
      continue;
    const effort = extractReasoningEffort(content);
    if (effort !== null)
      preserved.set(agentNameFromToml(entry.name), effort);
  }
  return preserved;
}
async function capturePreservedAgentServiceTier(input) {
  const agentsDir = join19(input.codexHome, "agents");
  if (!await exists4(agentsDir))
    return new Map;
  const preserved = new Map;
  const agentEntries = await readdir4(agentsDir, { withFileTypes: true });
  for (const entry of agentEntries) {
    if (!entry.name.endsWith(".toml"))
      continue;
    const content = await readTextIfExists2(join19(agentsDir, entry.name));
    if (content === null)
      continue;
    preserved.set(agentNameFromToml(entry.name), extractServiceTier(content));
  }
  return preserved;
}
async function linkCachedPluginAgents(input) {
  const bundledAgents = await discoverBundledAgents(input.pluginRoot);
  await purgeRetiredManagedAgentFiles({ codexHome: input.codexHome });
  if (bundledAgents.length === 0) {
    await writeManifest(input.pluginRoot, []);
    return [];
  }
  const agentsDir = join19(input.codexHome, "agents");
  await mkdir6(agentsDir, { recursive: true });
  const linked = [];
  for (const agentPath of bundledAgents) {
    const agentFileName = basename5(agentPath);
    const agentName = agentNameFromToml(agentFileName);
    const linkPath = join19(agentsDir, agentFileName);
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
  await writeManifest(input.pluginRoot, linked.map((entry) => entry.path));
  return linked;
}
async function restorePreservedServiceTier(input) {
  if (!input.preserved)
    return;
  const content = await readFile13(input.linkPath, "utf8");
  if (extractServiceTier(content) === input.value)
    return;
  const replacement = replaceServiceTier(content, input.value);
  if (!replacement.replaced)
    return;
  await writeFile6(input.linkPath, replacement.content);
}
async function discoverBundledAgents(pluginRoot) {
  const componentsRoot = join19(pluginRoot, "components");
  if (!await exists4(componentsRoot))
    return [];
  const componentEntries = await readdir4(componentsRoot, { withFileTypes: true });
  const agents = [];
  for (const entry of componentEntries) {
    if (!entry.isDirectory())
      continue;
    const agentsRoot = join19(componentsRoot, entry.name, "agents");
    if (!await exists4(agentsRoot))
      continue;
    const agentEntries = await readdir4(agentsRoot, { withFileTypes: true });
    for (const file2 of agentEntries) {
      if (!file2.isFile() || !file2.name.endsWith(".toml"))
        continue;
      agents.push(join19(agentsRoot, file2.name));
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
  const entryStat = await lstat7(linkPath);
  if (entryStat.isDirectory() && !entryStat.isSymbolicLink()) {
    throw new Error(`${linkPath} already exists and is a directory; refusing to replace`);
  }
  await rm6(linkPath, { force: true });
}
async function writeManifest(pluginRoot, agentPaths) {
  const manifestPath = join19(pluginRoot, MANIFEST_FILE);
  const payload = { agents: [...agentPaths].sort() };
  await writeFile6(manifestPath, `${JSON.stringify(payload, null, "\t")}
`);
}
async function restorePreservedReasoning(input) {
  if (input.value === undefined)
    return;
  const content = await readFile13(input.target, "utf8");
  const bundledEffort = extractReasoningEffort(content);
  if (bundledEffort === input.value)
    return;
  const replacement = replaceReasoningEffort(content, input.value);
  if (!replacement.replaced)
    return;
  await writeFile6(input.linkPath, replacement.content);
}
async function readTextIfExists2(path) {
  try {
    return await readFile13(path, "utf8");
  } catch (error) {
    if (nodeErrorCode2(error) === "ENOENT")
      return null;
    throw error;
  }
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
function replaceReasoningEffort(content, value) {
  return replaceTopLevelStringSetting(content, "model_reasoning_effort", value, { insertIfMissing: false });
}
function replaceServiceTier(content, value) {
  return replaceTopLevelStringSetting(content, "service_tier", value, { insertIfMissing: true });
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
function parseJsonString(value) {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "string" ? parsed : null;
  } catch (error) {
    if (error instanceof Error)
      return null;
    return null;
  }
}
async function exists4(path) {
  try {
    await lstat7(path);
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

// packages/omo-codex/src/install/codex-marketplace.ts
import { readFile as readFile14 } from "node:fs/promises";
import { join as join20 } from "node:path";
var DEFAULT_MARKETPLACE_PATH = "packages/omo-codex/marketplace.json";
async function readMarketplace(repoRoot, options) {
  const marketplacePath = options?.marketplacePath ?? join20(repoRoot, DEFAULT_MARKETPLACE_PATH);
  const raw = await readFile14(marketplacePath, "utf8");
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
  return join20(repoRoot, ...relativePath.split(/[\\/]/));
}
async function readPluginManifest(pluginRoot) {
  const raw = await readFile14(join20(pluginRoot, ".codex-plugin", "plugin.json"), "utf8");
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
  const relative4 = path.slice(2);
  if (relative4.length === 0)
    throw new Error("local plugin source path must not be empty");
  for (const part of relative4.split(/[\\/]/)) {
    if (part === "" || part === "." || part === "..") {
      throw new Error("local plugin source path must stay within the marketplace root");
    }
  }
  return path;
}

// packages/omo-codex/src/install/codex-marketplace-snapshot.ts
import { cp as cp3, mkdir as mkdir7, rename as rename3, rm as rm7, writeFile as writeFile7 } from "node:fs/promises";
import { join as join21, sep as sep6 } from "node:path";
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
  return join21(codexHome, INSTALLED_MARKETPLACES_DIR, marketplaceName);
}
async function writeMarketplaceManifest(marketplaceRoot, marketplace) {
  const manifestDir = join21(marketplaceRoot, ".agents", "plugins");
  await mkdir7(manifestDir, { recursive: true });
  const tempPath = join21(manifestDir, `.marketplace-${process.pid}-${Date.now()}.json.tmp`);
  await writeFile7(tempPath, `${JSON.stringify(marketplace, null, "\t")}
`);
  await rename3(tempPath, join21(manifestDir, "marketplace.json"));
}
async function writeSnapshotPlugin(marketplaceRoot, plugin) {
  const pluginsDir = join21(marketplaceRoot, "plugins");
  await mkdir7(pluginsDir, { recursive: true });
  const targetPath = join21(pluginsDir, plugin.name);
  const tempPath = join21(pluginsDir, `.tmp-${plugin.name}-${process.pid}-${Date.now()}`);
  await rm7(tempPath, { recursive: true, force: true });
  await cp3(plugin.sourcePath, tempPath, {
    recursive: true,
    filter: (source) => shouldCopyMarketplaceSourcePath(source, plugin.sourcePath)
  });
  await copyBundledMcpRuntimeDists({ pluginRoot: tempPath, sourceRoot: plugin.sourcePath });
  await rm7(targetPath, { recursive: true, force: true });
  await rename3(tempPath, targetPath);
  await rewriteCachedMcpManifest(targetPath, plugin.sourcePath);
  return { name: plugin.name, path: targetPath };
}
function shouldCopyMarketplaceSourcePath(path, root) {
  const relative4 = path === root ? "" : path.slice(root.length + sep6.length);
  if (relative4 === "")
    return true;
  const parts = relative4.split(sep6);
  return !parts.some((part) => part === ".git" || part === "node_modules");
}

// packages/omo-codex/src/install/lazycodex-version-stamp.ts
import { readdir as readdir5, readFile as readFile15, writeFile as writeFile8 } from "node:fs/promises";
import { join as join22 } from "node:path";
async function readDistributionManifest(repoRoot) {
  try {
    const parsed = JSON.parse(await readFile15(join22(repoRoot, "package.json"), "utf8"));
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
  if (input.marketplaceName === "sisyphuslabs" && input.pluginName === "omo" && input.distributionManifest !== undefined) {
    return input.distributionManifest.version;
  }
  return input.manifestVersion ?? "local";
}
async function stampLazyCodexPluginVersion(input) {
  const manifestPath = join22(input.pluginRoot, ".codex-plugin", "plugin.json");
  const hookPaths = await readPluginHookPaths(manifestPath);
  await stampJsonVersion(manifestPath, input.version);
  await stampJsonVersion(join22(input.pluginRoot, "package.json"), input.version);
  for (const hookPath of hookPaths) {
    await stampHookStatusMessages(join22(input.pluginRoot, hookPath), input.version);
  }
  await stampComponentVersions(input);
}
async function writeLazyCodexInstallSnapshot(input) {
  if (input.distributionManifest === undefined)
    return;
  await writeFile8(join22(input.pluginRoot, "lazycodex-install.json"), `${JSON.stringify({
    packageName: input.distributionManifest.name,
    version: input.distributionManifest.version
  }, null, "\t")}
`);
}
async function stampJsonVersion(path, version) {
  try {
    const parsed = JSON.parse(await readFile15(path, "utf8"));
    if (!isPlainRecord(parsed))
      return;
    parsed.version = version;
    await writeFile8(path, `${JSON.stringify(parsed, null, "\t")}
`);
  } catch (error) {
    if (error instanceof Error)
      return;
    throw error;
  }
}
async function readPluginHookPaths(manifestPath) {
  try {
    const parsed = JSON.parse(await readFile15(manifestPath, "utf8"));
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
    const parsed = JSON.parse(await readFile15(path, "utf8"));
    if (!isPlainRecord(parsed))
      return;
    stampHookGroups(parsed.hooks, version);
    await writeFile8(path, `${JSON.stringify(parsed, null, "\t")}
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
    entries = await readdir5(join22(input.pluginRoot, "components"));
  } catch (error) {
    if (error instanceof Error)
      return;
    throw error;
  }
  for (const entry of entries) {
    const componentRoot = join22(input.pluginRoot, "components", entry);
    await stampJsonVersion(join22(componentRoot, "package.json"), input.version);
    await stampHookStatusMessages(join22(componentRoot, "hooks", "hooks.json"), input.version);
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
  hook.statusMessage = hook.statusMessage.replace(/^LazyCodex\([^)]+\):\s*/, "(OmO) ");
}

// packages/omo-codex/src/install/codex-project-local-cleanup.ts
import { copyFile as copyFile2, lstat as lstat8, readFile as readFile16, writeFile as writeFile9 } from "node:fs/promises";
import { dirname as dirname7, join as join23, resolve as resolve6 } from "node:path";
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
    const original = await readFile16(configPath, "utf8");
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
    await writeFile9(configPath, `${repair.config.trimEnd()}
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
  if (!isMultiAgentV2Enabled(config))
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
  const codexHomeConfigPath = codexHome === undefined ? null : join23(resolve6(codexHome), "config.toml");
  let current = resolve6(startDirectory);
  const configPathsFromCwd = [];
  while (true) {
    const configPath = join23(current, ".codex", "config.toml");
    if (await isRegularProjectLocalConfig(current, configPath)) {
      if (codexHomeConfigPath === null || resolve6(configPath) !== codexHomeConfigPath) {
        configPathsFromCwd.push(configPath);
      }
    }
    if (await exists5(join23(current, ".git"))) {
      return configPathsFromCwd.length === 0 ? null : {
        projectRoot: current,
        configPaths: [...configPathsFromCwd].reverse(),
        artifactRoots: artifactRootsForConfigPaths(configPathsFromCwd)
      };
    }
    const parent = dirname7(current);
    if (parent === current) {
      const nearestConfigPath = configPathsFromCwd[0];
      return nearestConfigPath === undefined ? null : {
        projectRoot: dirname7(dirname7(nearestConfigPath)),
        configPaths: [nearestConfigPath],
        artifactRoots: [dirname7(dirname7(nearestConfigPath))]
      };
    }
    current = parent;
  }
}
async function isRegularProjectLocalConfig(directory, configPath) {
  const codexDirStat = await maybeLstat(join23(directory, ".codex"));
  if (codexDirStat === null || !codexDirStat.isDirectory() || codexDirStat.isSymbolicLink())
    return false;
  const configStat = await maybeLstat(configPath);
  return configStat !== null && configStat.isFile() && !configStat.isSymbolicLink();
}
function artifactRootsForConfigPaths(configPaths) {
  const roots = [];
  for (const configPath of configPaths) {
    const root = dirname7(dirname7(configPath));
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
      const artifactPath = join23(projectRoot, relativePath);
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
function isMultiAgentV2Enabled(config) {
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
    return await lstat8(path);
  } catch (error) {
    if (nodeErrorCode3(error) === "ENOENT")
      return null;
    throw error;
  }
}
async function exists5(path) {
  return await maybeLstat(path) !== null;
}
function nodeErrorCode3(error) {
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
import { readFile as readFile17, readdir as readdir6, rm as rm8 } from "node:fs/promises";
import { connect } from "node:net";
import { join as join24 } from "node:path";
async function reapLspDaemons(codexHome, deps = {}) {
  const killProcess = deps.killProcess ?? sendSigterm;
  const isDaemonLive = deps.isDaemonLive ?? probeSocketLive;
  const daemonRoot = join24(codexHome, "codex-lsp", "daemon");
  const reaped = [];
  let entries;
  try {
    entries = await readdir6(daemonRoot);
  } catch {
    return reaped;
  }
  for (const entry of entries) {
    const versionDir = join24(daemonRoot, entry);
    const pid = await readPidFile(join24(versionDir, "daemon.pid"));
    const socketPath = await readEndpointFile(join24(versionDir, "daemon.endpoint"));
    if (pid !== null && socketPath !== null && await isDaemonLive(socketPath) && killProcess(pid)) {
      reaped.push(pid);
    }
    await rm8(versionDir, { recursive: true, force: true });
  }
  return reaped;
}
async function readEndpointFile(path) {
  try {
    const content = (await readFile17(path, "utf8")).trim();
    return content.length > 0 ? content : null;
  } catch {
    return null;
  }
}
async function readPidFile(path) {
  try {
    const pid = Number.parseInt((await readFile17(path, "utf8")).trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}
function probeSocketLive(socketPath, timeoutMs = 500) {
  return new Promise((resolve7) => {
    const socket = connect(socketPath);
    const done = (ok) => {
      socket.destroy();
      resolve7(ok);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    timer.unref();
    socket.once("connect", () => {
      clearTimeout(timer);
      done(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      done(false);
    });
  });
}
function sendSigterm(pid) {
  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

// packages/omo-codex/src/install/codex-installer-bin-dir.ts
import { homedir } from "node:os";
import { join as join25, resolve as resolve7 } from "node:path";
function resolveCodexInstallerBinDir(input) {
  const explicitBinDir = input.binDir ?? input.env?.CODEX_LOCAL_BIN_DIR;
  if (explicitBinDir !== undefined && explicitBinDir.trim().length > 0)
    return resolve7(explicitBinDir.trim());
  const homeDir = input.homeDir ?? homedir();
  const defaultCodexHome = resolve7(homeDir, ".codex");
  const resolvedCodexHome = resolve7(input.codexHome);
  if (resolvedCodexHome !== defaultCodexHome)
    return join25(resolvedCodexHome, "bin");
  return resolve7(homeDir, ".local", "bin");
}

// packages/omo-codex/src/install/omo-sot-migration.ts
import { join as join26 } from "node:path";
async function seedAndMigrateOmoSot(input) {
  const commandEnv = { ...input.env };
  const scriptPath = join26(input.repoRoot, "packages", "omo-codex", "plugin", "scripts", "migrate-omo-sot.mjs");
  try {
    await input.runCommand(process.execPath, [scriptPath, "--seed"], {
      cwd: input.repoRoot,
      env: commandEnv
    });
  } catch (error) {
    if (!(error instanceof Error))
      throw error;
    input.log(`Warning: skipped OMO SOT seed/migration: ${error.message}`);
  }
}

// packages/omo-codex/src/install/install-ast-grep-sg.ts
import { join as join28 } from "node:path";

// packages/utils/src/deep-merge.ts
var DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
// packages/utils/src/record-type-guard.ts
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
// node_modules/.bun/js-yaml@4.2.0/node_modules/js-yaml/dist/js-yaml.mjs
/*! js-yaml 4.2.0 https://github.com/nodeca/js-yaml @license MIT */
var __create = Object.create;
var __defProp2 = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJSMin = (cb, mod) => () => (mod || (cb((mod = { exports: {} }).exports, mod), cb = null), mod.exports);
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function")
    for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key;i < n; i++) {
      key = keys[i];
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp2(to, key, {
          get: ((k) => from[k]).bind(null, key),
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
        });
    }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp2(target, "default", {
  value: mod,
  enumerable: true
}) : target, mod));
var require_common = /* @__PURE__ */ __commonJSMin((exports, module) => {
  function isNothing(subject) {
    return typeof subject === "undefined" || subject === null;
  }
  function isObject(subject) {
    return typeof subject === "object" && subject !== null;
  }
  function toArray(sequence) {
    if (Array.isArray(sequence))
      return sequence;
    else if (isNothing(sequence))
      return [];
    return [sequence];
  }
  function extend(target, source) {
    if (source) {
      const sourceKeys = Object.keys(source);
      for (let index = 0, length = sourceKeys.length;index < length; index += 1) {
        const key = sourceKeys[index];
        target[key] = source[key];
      }
    }
    return target;
  }
  function repeat(string, count) {
    let result = "";
    for (let cycle = 0;cycle < count; cycle += 1)
      result += string;
    return result;
  }
  function isNegativeZero(number) {
    return number === 0 && Number.NEGATIVE_INFINITY === 1 / number;
  }
  module.exports.isNothing = isNothing;
  module.exports.isObject = isObject;
  module.exports.toArray = toArray;
  module.exports.repeat = repeat;
  module.exports.isNegativeZero = isNegativeZero;
  module.exports.extend = extend;
});
var require_exception = /* @__PURE__ */ __commonJSMin((exports, module) => {
  function formatError(exception, compact) {
    let where = "";
    const message = exception.reason || "(unknown reason)";
    if (!exception.mark)
      return message;
    if (exception.mark.name)
      where += 'in "' + exception.mark.name + '" ';
    where += "(" + (exception.mark.line + 1) + ":" + (exception.mark.column + 1) + ")";
    if (!compact && exception.mark.snippet)
      where += `

` + exception.mark.snippet;
    return message + " " + where;
  }
  function YAMLException(reason, mark) {
    Error.call(this);
    this.name = "YAMLException";
    this.reason = reason;
    this.mark = mark;
    this.message = formatError(this, false);
    if (Error.captureStackTrace)
      Error.captureStackTrace(this, this.constructor);
    else
      this.stack = (/* @__PURE__ */ new Error()).stack || "";
  }
  YAMLException.prototype = Object.create(Error.prototype);
  YAMLException.prototype.constructor = YAMLException;
  YAMLException.prototype.toString = function toString(compact) {
    return this.name + ": " + formatError(this, compact);
  };
  module.exports = YAMLException;
});
var require_snippet = /* @__PURE__ */ __commonJSMin((exports, module) => {
  var common = require_common();
  function getLine(buffer, lineStart, lineEnd, position, maxLineLength) {
    let head = "";
    let tail = "";
    const maxHalfLength = Math.floor(maxLineLength / 2) - 1;
    if (position - lineStart > maxHalfLength) {
      head = " ... ";
      lineStart = position - maxHalfLength + head.length;
    }
    if (lineEnd - position > maxHalfLength) {
      tail = " ...";
      lineEnd = position + maxHalfLength - tail.length;
    }
    return {
      str: head + buffer.slice(lineStart, lineEnd).replace(/\t/g, "→") + tail,
      pos: position - lineStart + head.length
    };
  }
  function padStart(string, max) {
    return common.repeat(" ", max - string.length) + string;
  }
  function makeSnippet(mark, options) {
    options = Object.create(options || null);
    if (!mark.buffer)
      return null;
    if (!options.maxLength)
      options.maxLength = 79;
    if (typeof options.indent !== "number")
      options.indent = 1;
    if (typeof options.linesBefore !== "number")
      options.linesBefore = 3;
    if (typeof options.linesAfter !== "number")
      options.linesAfter = 2;
    const re = /\r?\n|\r|\0/g;
    const lineStarts = [0];
    const lineEnds = [];
    let match;
    let foundLineNo = -1;
    while (match = re.exec(mark.buffer)) {
      lineEnds.push(match.index);
      lineStarts.push(match.index + match[0].length);
      if (mark.position <= match.index && foundLineNo < 0)
        foundLineNo = lineStarts.length - 2;
    }
    if (foundLineNo < 0)
      foundLineNo = lineStarts.length - 1;
    let result = "";
    const lineNoLength = Math.min(mark.line + options.linesAfter, lineEnds.length).toString().length;
    const maxLineLength = options.maxLength - (options.indent + lineNoLength + 3);
    for (let i = 1;i <= options.linesBefore; i++) {
      if (foundLineNo - i < 0)
        break;
      const line2 = getLine(mark.buffer, lineStarts[foundLineNo - i], lineEnds[foundLineNo - i], mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo - i]), maxLineLength);
      result = common.repeat(" ", options.indent) + padStart((mark.line - i + 1).toString(), lineNoLength) + " | " + line2.str + `
` + result;
    }
    const line = getLine(mark.buffer, lineStarts[foundLineNo], lineEnds[foundLineNo], mark.position, maxLineLength);
    result += common.repeat(" ", options.indent) + padStart((mark.line + 1).toString(), lineNoLength) + " | " + line.str + `
`;
    result += common.repeat("-", options.indent + lineNoLength + 3 + line.pos) + `^
`;
    for (let i = 1;i <= options.linesAfter; i++) {
      if (foundLineNo + i >= lineEnds.length)
        break;
      const line2 = getLine(mark.buffer, lineStarts[foundLineNo + i], lineEnds[foundLineNo + i], mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo + i]), maxLineLength);
      result += common.repeat(" ", options.indent) + padStart((mark.line + i + 1).toString(), lineNoLength) + " | " + line2.str + `
`;
    }
    return result.replace(/\n$/, "");
  }
  module.exports = makeSnippet;
});
var require_type = /* @__PURE__ */ __commonJSMin((exports, module) => {
  var YAMLException = require_exception();
  var TYPE_CONSTRUCTOR_OPTIONS = [
    "kind",
    "multi",
    "resolve",
    "construct",
    "instanceOf",
    "predicate",
    "represent",
    "representName",
    "defaultStyle",
    "styleAliases"
  ];
  var YAML_NODE_KINDS = [
    "scalar",
    "sequence",
    "mapping"
  ];
  function compileStyleAliases(map) {
    const result = {};
    if (map !== null)
      Object.keys(map).forEach(function(style) {
        map[style].forEach(function(alias) {
          result[String(alias)] = style;
        });
      });
    return result;
  }
  function Type(tag, options) {
    options = options || {};
    Object.keys(options).forEach(function(name) {
      if (TYPE_CONSTRUCTOR_OPTIONS.indexOf(name) === -1)
        throw new YAMLException('Unknown option "' + name + '" is met in definition of "' + tag + '" YAML type.');
    });
    this.options = options;
    this.tag = tag;
    this.kind = options["kind"] || null;
    this.resolve = options["resolve"] || function() {
      return true;
    };
    this.construct = options["construct"] || function(data) {
      return data;
    };
    this.instanceOf = options["instanceOf"] || null;
    this.predicate = options["predicate"] || null;
    this.represent = options["represent"] || null;
    this.representName = options["representName"] || null;
    this.defaultStyle = options["defaultStyle"] || null;
    this.multi = options["multi"] || false;
    this.styleAliases = compileStyleAliases(options["styleAliases"] || null);
    if (YAML_NODE_KINDS.indexOf(this.kind) === -1)
      throw new YAMLException('Unknown kind "' + this.kind + '" is specified for "' + tag + '" YAML type.');
  }
  module.exports = Type;
});
var require_schema = /* @__PURE__ */ __commonJSMin((exports, module) => {
  var YAMLException = require_exception();
  var Type = require_type();
  function compileList(schema, name) {
    const result = [];
    schema[name].forEach(function(currentType) {
      let newIndex = result.length;
      result.forEach(function(previousType, previousIndex) {
        if (previousType.tag === currentType.tag && previousType.kind === currentType.kind && previousType.multi === currentType.multi)
          newIndex = previousIndex;
      });
      result[newIndex] = currentType;
    });
    return result;
  }
  function compileMap() {
    const result = {
      scalar: {},
      sequence: {},
      mapping: {},
      fallback: {},
      multi: {
        scalar: [],
        sequence: [],
        mapping: [],
        fallback: []
      }
    };
    function collectType(type) {
      if (type.multi) {
        result.multi[type.kind].push(type);
        result.multi["fallback"].push(type);
      } else
        result[type.kind][type.tag] = result["fallback"][type.tag] = type;
    }
    for (let index = 0, length = arguments.length;index < length; index += 1)
      arguments[index].forEach(collectType);
    return result;
  }
  function Schema(definition) {
    return this.extend(definition);
  }
  Schema.prototype.extend = function extend(definition) {
    let implicit = [];
    let explicit = [];
    if (definition instanceof Type)
      explicit.push(definition);
    else if (Array.isArray(definition))
      explicit = explicit.concat(definition);
    else if (definition && (Array.isArray(definition.implicit) || Array.isArray(definition.explicit))) {
      if (definition.implicit)
        implicit = implicit.concat(definition.implicit);
      if (definition.explicit)
        explicit = explicit.concat(definition.explicit);
    } else
      throw new YAMLException("Schema.extend argument should be a Type, [ Type ], or a schema definition ({ implicit: [...], explicit: [...] })");
    implicit.forEach(function(type) {
      if (!(type instanceof Type))
        throw new YAMLException("Specified list of YAML types (or a single Type object) contains a non-Type object.");
      if (type.loadKind && type.loadKind !== "scalar")
        throw new YAMLException("There is a non-scalar type in the implicit list of a schema. Implicit resolving of such types is not supported.");
      if (type.multi)
        throw new YAMLException("There is a multi type in the implicit list of a schema. Multi tags can only be listed as explicit.");
    });
    explicit.forEach(function(type) {
      if (!(type instanceof Type))
        throw new YAMLException("Specified list of YAML types (or a single Type object) contains a non-Type object.");
    });
    const result = Object.create(Schema.prototype);
    result.implicit = (this.implicit || []).concat(implicit);
    result.explicit = (this.explicit || []).concat(explicit);
    result.compiledImplicit = compileList(result, "implicit");
    result.compiledExplicit = compileList(result, "explicit");
    result.compiledTypeMap = compileMap(result.compiledImplicit, result.compiledExplicit);
    return result;
  };
  module.exports = Schema;
});
var require_str = /* @__PURE__ */ __commonJSMin((exports, module) => {
  module.exports = new (require_type())("tag:yaml.org,2002:str", {
    kind: "scalar",
    construct: function(data) {
      return data !== null ? data : "";
    }
  });
});
var require_seq = /* @__PURE__ */ __commonJSMin((exports, module) => {
  module.exports = new (require_type())("tag:yaml.org,2002:seq", {
    kind: "sequence",
    construct: function(data) {
      return data !== null ? data : [];
    }
  });
});
var require_map = /* @__PURE__ */ __commonJSMin((exports, module) => {
  module.exports = new (require_type())("tag:yaml.org,2002:map", {
    kind: "mapping",
    construct: function(data) {
      return data !== null ? data : {};
    }
  });
});
var require_failsafe = /* @__PURE__ */ __commonJSMin((exports, module) => {
  module.exports = new (require_schema())({ explicit: [
    require_str(),
    require_seq(),
    require_map()
  ] });
});
var require_null = /* @__PURE__ */ __commonJSMin((exports, module) => {
  var Type = require_type();
  function resolveYamlNull(data) {
    if (data === null)
      return true;
    const max = data.length;
    return max === 1 && data === "~" || max === 4 && (data === "null" || data === "Null" || data === "NULL");
  }
  function constructYamlNull() {
    return null;
  }
  function isNull(object) {
    return object === null;
  }
  module.exports = new Type("tag:yaml.org,2002:null", {
    kind: "scalar",
    resolve: resolveYamlNull,
    construct: constructYamlNull,
    predicate: isNull,
    represent: {
      canonical: function() {
        return "~";
      },
      lowercase: function() {
        return "null";
      },
      uppercase: function() {
        return "NULL";
      },
      camelcase: function() {
        return "Null";
      },
      empty: function() {
        return "";
      }
    },
    defaultStyle: "lowercase"
  });
});
var require_bool = /* @__PURE__ */ __commonJSMin((exports, module) => {
  var Type = require_type();
  function resolveYamlBoolean(data) {
    if (data === null)
      return false;
    const max = data.length;
    return max === 4 && (data === "true" || data === "True" || data === "TRUE") || max === 5 && (data === "false" || data === "False" || data === "FALSE");
  }
  function constructYamlBoolean(data) {
    return data === "true" || data === "True" || data === "TRUE";
  }
  function isBoolean(object) {
    return Object.prototype.toString.call(object) === "[object Boolean]";
  }
  module.exports = new Type("tag:yaml.org,2002:bool", {
    kind: "scalar",
    resolve: resolveYamlBoolean,
    construct: constructYamlBoolean,
    predicate: isBoolean,
    represent: {
      lowercase: function(object) {
        return object ? "true" : "false";
      },
      uppercase: function(object) {
        return object ? "TRUE" : "FALSE";
      },
      camelcase: function(object) {
        return object ? "True" : "False";
      }
    },
    defaultStyle: "lowercase"
  });
});
var require_int = /* @__PURE__ */ __commonJSMin((exports, module) => {
  var common = require_common();
  var Type = require_type();
  function isHexCode(c) {
    return c >= 48 && c <= 57 || c >= 65 && c <= 70 || c >= 97 && c <= 102;
  }
  function isOctCode(c) {
    return c >= 48 && c <= 55;
  }
  function isDecCode(c) {
    return c >= 48 && c <= 57;
  }
  function resolveYamlInteger(data) {
    if (data === null)
      return false;
    const max = data.length;
    let index = 0;
    let hasDigits = false;
    if (!max)
      return false;
    let ch = data[index];
    if (ch === "-" || ch === "+")
      ch = data[++index];
    if (ch === "0") {
      if (index + 1 === max)
        return true;
      ch = data[++index];
      if (ch === "b") {
        index++;
        for (;index < max; index++) {
          ch = data[index];
          if (ch !== "0" && ch !== "1")
            return false;
          hasDigits = true;
        }
        return hasDigits && Number.isFinite(parseYamlInteger(data));
      }
      if (ch === "x") {
        index++;
        for (;index < max; index++) {
          if (!isHexCode(data.charCodeAt(index)))
            return false;
          hasDigits = true;
        }
        return hasDigits && Number.isFinite(parseYamlInteger(data));
      }
      if (ch === "o") {
        index++;
        for (;index < max; index++) {
          if (!isOctCode(data.charCodeAt(index)))
            return false;
          hasDigits = true;
        }
        return hasDigits && Number.isFinite(parseYamlInteger(data));
      }
    }
    for (;index < max; index++) {
      if (!isDecCode(data.charCodeAt(index)))
        return false;
      hasDigits = true;
    }
    if (!hasDigits)
      return false;
    return Number.isFinite(parseYamlInteger(data));
  }
  function parseYamlInteger(data) {
    let value = data;
    let sign = 1;
    let ch = value[0];
    if (ch === "-" || ch === "+") {
      if (ch === "-")
        sign = -1;
      value = value.slice(1);
      ch = value[0];
    }
    if (value === "0")
      return 0;
    if (ch === "0") {
      if (value[1] === "b")
        return sign * parseInt(value.slice(2), 2);
      if (value[1] === "x")
        return sign * parseInt(value.slice(2), 16);
      if (value[1] === "o")
        return sign * parseInt(value.slice(2), 8);
    }
    return sign * parseInt(value, 10);
  }
  function constructYamlInteger(data) {
    return parseYamlInteger(data);
  }
  function isInteger(object) {
    return Object.prototype.toString.call(object) === "[object Number]" && object % 1 === 0 && !common.isNegativeZero(object);
  }
  module.exports = new Type("tag:yaml.org,2002:int", {
    kind: "scalar",
    resolve: resolveYamlInteger,
    construct: constructYamlInteger,
    predicate: isInteger,
    represent: {
      binary: function(obj) {
        return obj >= 0 ? "0b" + obj.toString(2) : "-0b" + obj.toString(2).slice(1);
      },
      octal: function(obj) {
        return obj >= 0 ? "0o" + obj.toString(8) : "-0o" + obj.toString(8).slice(1);
      },
      decimal: function(obj) {
        return obj.toString(10);
      },
      hexadecimal: function(obj) {
        return obj >= 0 ? "0x" + obj.toString(16).toUpperCase() : "-0x" + obj.toString(16).toUpperCase().slice(1);
      }
    },
    defaultStyle: "decimal",
    styleAliases: {
      binary: [2, "bin"],
      octal: [8, "oct"],
      decimal: [10, "dec"],
      hexadecimal: [16, "hex"]
    }
  });
});
var require_float = /* @__PURE__ */ __commonJSMin((exports, module) => {
  var common = require_common();
  var Type = require_type();
  var YAML_FLOAT_PATTERN = /* @__PURE__ */ new RegExp("^(?:[-+]?(?:[0-9]+)(?:\\.[0-9]*)?(?:[eE][-+]?[0-9]+)?|\\.[0-9]+(?:[eE][-+]?[0-9]+)?|[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$");
  var YAML_FLOAT_SPECIAL_PATTERN = /* @__PURE__ */ new RegExp("^(?:[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$");
  function resolveYamlFloat(data) {
    if (data === null)
      return false;
    if (!YAML_FLOAT_PATTERN.test(data))
      return false;
    if (Number.isFinite(parseFloat(data, 10)))
      return true;
    return YAML_FLOAT_SPECIAL_PATTERN.test(data);
  }
  function constructYamlFloat(data) {
    let value = data.toLowerCase();
    const sign = value[0] === "-" ? -1 : 1;
    if ("+-".indexOf(value[0]) >= 0)
      value = value.slice(1);
    if (value === ".inf")
      return sign === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    else if (value === ".nan")
      return NaN;
    return sign * parseFloat(value, 10);
  }
  var SCIENTIFIC_WITHOUT_DOT = /^[-+]?[0-9]+e/;
  function representYamlFloat(object, style) {
    if (isNaN(object))
      switch (style) {
        case "lowercase":
          return ".nan";
        case "uppercase":
          return ".NAN";
        case "camelcase":
          return ".NaN";
      }
    else if (Number.POSITIVE_INFINITY === object)
      switch (style) {
        case "lowercase":
          return ".inf";
        case "uppercase":
          return ".INF";
        case "camelcase":
          return ".Inf";
      }
    else if (Number.NEGATIVE_INFINITY === object)
      switch (style) {
        case "lowercase":
          return "-.inf";
        case "uppercase":
          return "-.INF";
        case "camelcase":
          return "-.Inf";
      }
    else if (common.isNegativeZero(object))
      return "-0.0";
    const res = object.toString(10);
    return SCIENTIFIC_WITHOUT_DOT.test(res) ? res.replace("e", ".e") : res;
  }
  function isFloat(object) {
    return Object.prototype.toString.call(object) === "[object Number]" && (object % 1 !== 0 || common.isNegativeZero(object));
  }
  module.exports = new Type("tag:yaml.org,2002:float", {
    kind: "scalar",
    resolve: resolveYamlFloat,
    construct: constructYamlFloat,
    predicate: isFloat,
    represent: representYamlFloat,
    defaultStyle: "lowercase"
  });
});
var require_json = /* @__PURE__ */ __commonJSMin((exports, module) => {
  module.exports = require_failsafe().extend({ implicit: [
    require_null(),
    require_bool(),
    require_int(),
    require_float()
  ] });
});
var require_core = /* @__PURE__ */ __commonJSMin((exports, module) => {
  module.exports = require_json();
});
var require_timestamp = /* @__PURE__ */ __commonJSMin((exports, module) => {
  var Type = require_type();
  var YAML_DATE_REGEXP = /* @__PURE__ */ new RegExp("^([0-9][0-9][0-9][0-9])-([0-9][0-9])-([0-9][0-9])$");
  var YAML_TIMESTAMP_REGEXP = /* @__PURE__ */ new RegExp("^([0-9][0-9][0-9][0-9])-([0-9][0-9]?)-([0-9][0-9]?)(?:[Tt]|[ \\t]+)([0-9][0-9]?):([0-9][0-9]):([0-9][0-9])(?:\\.([0-9]*))?(?:[ \\t]*(Z|([-+])([0-9][0-9]?)(?::([0-9][0-9]))?))?$");
  function resolveYamlTimestamp(data) {
    if (data === null)
      return false;
    if (YAML_DATE_REGEXP.exec(data) !== null)
      return true;
    if (YAML_TIMESTAMP_REGEXP.exec(data) !== null)
      return true;
    return false;
  }
  function constructYamlTimestamp(data) {
    let fraction = 0;
    let delta = null;
    let match = YAML_DATE_REGEXP.exec(data);
    if (match === null)
      match = YAML_TIMESTAMP_REGEXP.exec(data);
    if (match === null)
      throw new Error("Date resolve error");
    const year = +match[1];
    const month = +match[2] - 1;
    const day = +match[3];
    if (!match[4])
      return new Date(Date.UTC(year, month, day));
    const hour = +match[4];
    const minute = +match[5];
    const second = +match[6];
    if (match[7]) {
      fraction = match[7].slice(0, 3);
      while (fraction.length < 3)
        fraction += "0";
      fraction = +fraction;
    }
    if (match[9]) {
      const tzHour = +match[10];
      const tzMinute = +(match[11] || 0);
      delta = (tzHour * 60 + tzMinute) * 60000;
      if (match[9] === "-")
        delta = -delta;
    }
    const date = new Date(Date.UTC(year, month, day, hour, minute, second, fraction));
    if (delta)
      date.setTime(date.getTime() - delta);
    return date;
  }
  function representYamlTimestamp(object) {
    return object.toISOString();
  }
  module.exports = new Type("tag:yaml.org,2002:timestamp", {
    kind: "scalar",
    resolve: resolveYamlTimestamp,
    construct: constructYamlTimestamp,
    instanceOf: Date,
    represent: representYamlTimestamp
  });
});
var require_merge = /* @__PURE__ */ __commonJSMin((exports, module) => {
  var Type = require_type();
  function resolveYamlMerge(data) {
    return data === "<<" || data === null;
  }
  module.exports = new Type("tag:yaml.org,2002:merge", {
    kind: "scalar",
    resolve: resolveYamlMerge
  });
});
var require_binary = /* @__PURE__ */ __commonJSMin((exports, module) => {
  var Type = require_type();
  var BASE64_MAP = `ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=
\r`;
  function resolveYamlBinary(data) {
    if (data === null)
      return false;
    let bitlen = 0;
    const max = data.length;
    const map = BASE64_MAP;
    for (let idx = 0;idx < max; idx++) {
      const code = map.indexOf(data.charAt(idx));
      if (code > 64)
        continue;
      if (code < 0)
        return false;
      bitlen += 6;
    }
    return bitlen % 8 === 0;
  }
  function constructYamlBinary(data) {
    const input = data.replace(/[\r\n=]/g, "");
    const max = input.length;
    const map = BASE64_MAP;
    let bits = 0;
    const result = [];
    for (let idx = 0;idx < max; idx++) {
      if (idx % 4 === 0 && idx) {
        result.push(bits >> 16 & 255);
        result.push(bits >> 8 & 255);
        result.push(bits & 255);
      }
      bits = bits << 6 | map.indexOf(input.charAt(idx));
    }
    const tailbits = max % 4 * 6;
    if (tailbits === 0) {
      result.push(bits >> 16 & 255);
      result.push(bits >> 8 & 255);
      result.push(bits & 255);
    } else if (tailbits === 18) {
      result.push(bits >> 10 & 255);
      result.push(bits >> 2 & 255);
    } else if (tailbits === 12)
      result.push(bits >> 4 & 255);
    return new Uint8Array(result);
  }
  function representYamlBinary(object) {
    let result = "";
    let bits = 0;
    const max = object.length;
    const map = BASE64_MAP;
    for (let idx = 0;idx < max; idx++) {
      if (idx % 3 === 0 && idx) {
        result += map[bits >> 18 & 63];
        result += map[bits >> 12 & 63];
        result += map[bits >> 6 & 63];
        result += map[bits & 63];
      }
      bits = (bits << 8) + object[idx];
    }
    const tail = max % 3;
    if (tail === 0) {
      result += map[bits >> 18 & 63];
      result += map[bits >> 12 & 63];
      result += map[bits >> 6 & 63];
      result += map[bits & 63];
    } else if (tail === 2) {
      result += map[bits >> 10 & 63];
      result += map[bits >> 4 & 63];
      result += map[bits << 2 & 63];
      result += map[64];
    } else if (tail === 1) {
      result += map[bits >> 2 & 63];
      result += map[bits << 4 & 63];
      result += map[64];
      result += map[64];
    }
    return result;
  }
  function isBinary(obj) {
    return Object.prototype.toString.call(obj) === "[object Uint8Array]";
  }
  module.exports = new Type("tag:yaml.org,2002:binary", {
    kind: "scalar",
    resolve: resolveYamlBinary,
    construct: constructYamlBinary,
    predicate: isBinary,
    represent: representYamlBinary
  });
});
var require_omap = /* @__PURE__ */ __commonJSMin((exports, module) => {
  var Type = require_type();
  var _hasOwnProperty = Object.prototype.hasOwnProperty;
  var _toString = Object.prototype.toString;
  function resolveYamlOmap(data) {
    if (data === null)
      return true;
    const objectKeys = [];
    const object = data;
    for (let index = 0, length = object.length;index < length; index += 1) {
      const pair = object[index];
      let pairHasKey = false;
      if (_toString.call(pair) !== "[object Object]")
        return false;
      let pairKey;
      for (pairKey in pair)
        if (_hasOwnProperty.call(pair, pairKey))
          if (!pairHasKey)
            pairHasKey = true;
          else
            return false;
      if (!pairHasKey)
        return false;
      if (objectKeys.indexOf(pairKey) === -1)
        objectKeys.push(pairKey);
      else
        return false;
    }
    return true;
  }
  function constructYamlOmap(data) {
    return data !== null ? data : [];
  }
  module.exports = new Type("tag:yaml.org,2002:omap", {
    kind: "sequence",
    resolve: resolveYamlOmap,
    construct: constructYamlOmap
  });
});
var require_pairs = /* @__PURE__ */ __commonJSMin((exports, module) => {
  var Type = require_type();
  var _toString = Object.prototype.toString;
  function resolveYamlPairs(data) {
    if (data === null)
      return true;
    const object = data;
    const result = new Array(object.length);
    for (let index = 0, length = object.length;index < length; index += 1) {
      const pair = object[index];
      if (_toString.call(pair) !== "[object Object]")
        return false;
      const keys = Object.keys(pair);
      if (keys.length !== 1)
        return false;
      result[index] = [keys[0], pair[keys[0]]];
    }
    return true;
  }
  function constructYamlPairs(data) {
    if (data === null)
      return [];
    const object = data;
    const result = new Array(object.length);
    for (let index = 0, length = object.length;index < length; index += 1) {
      const pair = object[index];
      const keys = Object.keys(pair);
      result[index] = [keys[0], pair[keys[0]]];
    }
    return result;
  }
  module.exports = new Type("tag:yaml.org,2002:pairs", {
    kind: "sequence",
    resolve: resolveYamlPairs,
    construct: constructYamlPairs
  });
});
var require_set = /* @__PURE__ */ __commonJSMin((exports, module) => {
  var Type = require_type();
  var _hasOwnProperty = Object.prototype.hasOwnProperty;
  function resolveYamlSet(data) {
    if (data === null)
      return true;
    const object = data;
    for (const key in object)
      if (_hasOwnProperty.call(object, key)) {
        if (object[key] !== null)
          return false;
      }
    return true;
  }
  function constructYamlSet(data) {
    return data !== null ? data : {};
  }
  module.exports = new Type("tag:yaml.org,2002:set", {
    kind: "mapping",
    resolve: resolveYamlSet,
    construct: constructYamlSet
  });
});
var require_default = /* @__PURE__ */ __commonJSMin((exports, module) => {
  module.exports = require_core().extend({
    implicit: [require_timestamp(), require_merge()],
    explicit: [
      require_binary(),
      require_omap(),
      require_pairs(),
      require_set()
    ]
  });
});
var require_loader = /* @__PURE__ */ __commonJSMin((exports, module) => {
  var common = require_common();
  var YAMLException = require_exception();
  var makeSnippet = require_snippet();
  var DEFAULT_SCHEMA = require_default();
  var _hasOwnProperty = Object.prototype.hasOwnProperty;
  var CONTEXT_FLOW_IN = 1;
  var CONTEXT_FLOW_OUT = 2;
  var CONTEXT_BLOCK_IN = 3;
  var CONTEXT_BLOCK_OUT = 4;
  var CHOMPING_CLIP = 1;
  var CHOMPING_STRIP = 2;
  var CHOMPING_KEEP = 3;
  var PATTERN_NON_PRINTABLE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/;
  var PATTERN_NON_ASCII_LINE_BREAKS = /[\x85\u2028\u2029]/;
  var PATTERN_FLOW_INDICATORS = /[,\[\]{}]/;
  var PATTERN_TAG_HANDLE = /^(?:!|!!|![0-9A-Za-z-]+!)$/;
  var PATTERN_TAG_URI = /^(?:!|[^,\[\]{}])(?:%[0-9a-f]{2}|[0-9a-z\-#;/?:@&=+$,_.!~*'()\[\]])*$/i;
  function _class(obj) {
    return Object.prototype.toString.call(obj);
  }
  function isEol(c) {
    return c === 10 || c === 13;
  }
  function isWhiteSpace(c) {
    return c === 9 || c === 32;
  }
  function isWsOrEol(c) {
    return c === 9 || c === 32 || c === 10 || c === 13;
  }
  function isFlowIndicator(c) {
    return c === 44 || c === 91 || c === 93 || c === 123 || c === 125;
  }
  function fromHexCode(c) {
    if (c >= 48 && c <= 57)
      return c - 48;
    const lc = c | 32;
    if (lc >= 97 && lc <= 102)
      return lc - 97 + 10;
    return -1;
  }
  function escapedHexLen(c) {
    if (c === 120)
      return 2;
    if (c === 117)
      return 4;
    if (c === 85)
      return 8;
    return 0;
  }
  function fromDecimalCode(c) {
    if (c >= 48 && c <= 57)
      return c - 48;
    return -1;
  }
  function simpleEscapeSequence(c) {
    switch (c) {
      case 48:
        return "\x00";
      case 97:
        return "\x07";
      case 98:
        return "\b";
      case 116:
        return "\t";
      case 9:
        return "\t";
      case 110:
        return `
`;
      case 118:
        return "\v";
      case 102:
        return "\f";
      case 114:
        return "\r";
      case 101:
        return "\x1B";
      case 32:
        return " ";
      case 34:
        return '"';
      case 47:
        return "/";
      case 92:
        return "\\";
      case 78:
        return "";
      case 95:
        return " ";
      case 76:
        return "\u2028";
      case 80:
        return "\u2029";
      default:
        return "";
    }
  }
  function charFromCodepoint(c) {
    if (c <= 65535)
      return String.fromCharCode(c);
    return String.fromCharCode((c - 65536 >> 10) + 55296, (c - 65536 & 1023) + 56320);
  }
  function setProperty(object, key, value) {
    if (key === "__proto__")
      Object.defineProperty(object, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value
      });
    else
      object[key] = value;
  }
  var simpleEscapeCheck = new Array(256);
  var simpleEscapeMap = new Array(256);
  for (let i = 0;i < 256; i++) {
    simpleEscapeCheck[i] = simpleEscapeSequence(i) ? 1 : 0;
    simpleEscapeMap[i] = simpleEscapeSequence(i);
  }
  function State(input, options) {
    this.input = input;
    this.filename = options["filename"] || null;
    this.schema = options["schema"] || DEFAULT_SCHEMA;
    this.onWarning = options["onWarning"] || null;
    this.legacy = options["legacy"] || false;
    this.json = options["json"] || false;
    this.listener = options["listener"] || null;
    this.maxDepth = typeof options["maxDepth"] === "number" ? options["maxDepth"] : 100;
    this.maxMergeSeqLength = typeof options["maxMergeSeqLength"] === "number" ? options["maxMergeSeqLength"] : 20;
    this.implicitTypes = this.schema.compiledImplicit;
    this.typeMap = this.schema.compiledTypeMap;
    this.length = input.length;
    this.position = 0;
    this.line = 0;
    this.lineStart = 0;
    this.lineIndent = 0;
    this.depth = 0;
    this.firstTabInLine = -1;
    this.documents = [];
    this.anchorMapTransactions = [];
  }
  function generateError(state, message) {
    const mark = {
      name: state.filename,
      buffer: state.input.slice(0, -1),
      position: state.position,
      line: state.line,
      column: state.position - state.lineStart
    };
    mark.snippet = makeSnippet(mark);
    return new YAMLException(message, mark);
  }
  function throwError(state, message) {
    throw generateError(state, message);
  }
  function throwWarning(state, message) {
    if (state.onWarning)
      state.onWarning.call(null, generateError(state, message));
  }
  function storeAnchor(state, name, value) {
    const transactions = state.anchorMapTransactions;
    if (transactions.length !== 0) {
      const transaction = transactions[transactions.length - 1];
      if (!_hasOwnProperty.call(transaction, name))
        transaction[name] = {
          existed: _hasOwnProperty.call(state.anchorMap, name),
          value: state.anchorMap[name]
        };
    }
    state.anchorMap[name] = value;
  }
  function beginAnchorTransaction(state) {
    state.anchorMapTransactions.push(Object.create(null));
  }
  function commitAnchorTransaction(state) {
    const transaction = state.anchorMapTransactions.pop();
    const transactions = state.anchorMapTransactions;
    if (transactions.length === 0)
      return;
    const parent = transactions[transactions.length - 1];
    const names = Object.keys(transaction);
    for (let index = 0, length = names.length;index < length; index += 1) {
      const name = names[index];
      if (!_hasOwnProperty.call(parent, name))
        parent[name] = transaction[name];
    }
  }
  function rollbackAnchorTransaction(state) {
    const transaction = state.anchorMapTransactions.pop();
    const names = Object.keys(transaction);
    for (let index = names.length - 1;index >= 0; index -= 1) {
      const entry = transaction[names[index]];
      if (entry.existed)
        state.anchorMap[names[index]] = entry.value;
      else
        delete state.anchorMap[names[index]];
    }
  }
  function snapshotState(state) {
    return {
      position: state.position,
      line: state.line,
      lineStart: state.lineStart,
      lineIndent: state.lineIndent,
      firstTabInLine: state.firstTabInLine,
      tag: state.tag,
      anchor: state.anchor,
      kind: state.kind,
      result: state.result
    };
  }
  function restoreState(state, snapshot) {
    state.position = snapshot.position;
    state.line = snapshot.line;
    state.lineStart = snapshot.lineStart;
    state.lineIndent = snapshot.lineIndent;
    state.firstTabInLine = snapshot.firstTabInLine;
    state.tag = snapshot.tag;
    state.anchor = snapshot.anchor;
    state.kind = snapshot.kind;
    state.result = snapshot.result;
  }
  var directiveHandlers = {
    YAML: function handleYamlDirective(state, name, args) {
      if (state.version !== null)
        throwError(state, "duplication of %YAML directive");
      if (args.length !== 1)
        throwError(state, "YAML directive accepts exactly one argument");
      const match = /^([0-9]+)\.([0-9]+)$/.exec(args[0]);
      if (match === null)
        throwError(state, "ill-formed argument of the YAML directive");
      const major = parseInt(match[1], 10);
      const minor = parseInt(match[2], 10);
      if (major !== 1)
        throwError(state, "unacceptable YAML version of the document");
      state.version = args[0];
      state.checkLineBreaks = minor < 2;
      if (minor !== 1 && minor !== 2)
        throwWarning(state, "unsupported YAML version of the document");
    },
    TAG: function handleTagDirective(state, name, args) {
      let prefix;
      if (args.length !== 2)
        throwError(state, "TAG directive accepts exactly two arguments");
      const handle = args[0];
      prefix = args[1];
      if (!PATTERN_TAG_HANDLE.test(handle))
        throwError(state, "ill-formed tag handle (first argument) of the TAG directive");
      if (_hasOwnProperty.call(state.tagMap, handle))
        throwError(state, 'there is a previously declared suffix for "' + handle + '" tag handle');
      if (!PATTERN_TAG_URI.test(prefix))
        throwError(state, "ill-formed tag prefix (second argument) of the TAG directive");
      try {
        prefix = decodeURIComponent(prefix);
      } catch (err) {
        throwError(state, "tag prefix is malformed: " + prefix);
      }
      state.tagMap[handle] = prefix;
    }
  };
  function captureSegment(state, start, end, checkJson) {
    if (start < end) {
      const _result = state.input.slice(start, end);
      if (checkJson)
        for (let _position = 0, _length = _result.length;_position < _length; _position += 1) {
          const _character = _result.charCodeAt(_position);
          if (!(_character === 9 || _character >= 32 && _character <= 1114111))
            throwError(state, "expected valid JSON character");
        }
      else if (PATTERN_NON_PRINTABLE.test(_result))
        throwError(state, "the stream contains non-printable characters");
      state.result += _result;
    }
  }
  function mergeMappings(state, destination, source, overridableKeys) {
    if (!common.isObject(source))
      throwError(state, "cannot merge mappings; the provided source object is unacceptable");
    const sourceKeys = Object.keys(source);
    for (let index = 0, quantity = sourceKeys.length;index < quantity; index += 1) {
      const key = sourceKeys[index];
      if (!_hasOwnProperty.call(destination, key)) {
        setProperty(destination, key, source[key]);
        overridableKeys[key] = true;
      }
    }
  }
  function storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, startLine, startLineStart, startPos) {
    if (Array.isArray(keyNode)) {
      keyNode = Array.prototype.slice.call(keyNode);
      for (let index = 0, quantity = keyNode.length;index < quantity; index += 1) {
        if (Array.isArray(keyNode[index]))
          throwError(state, "nested arrays are not supported inside keys");
        if (typeof keyNode === "object" && _class(keyNode[index]) === "[object Object]")
          keyNode[index] = "[object Object]";
      }
    }
    if (typeof keyNode === "object" && _class(keyNode) === "[object Object]")
      keyNode = "[object Object]";
    keyNode = String(keyNode);
    if (_result === null)
      _result = {};
    if (keyTag === "tag:yaml.org,2002:merge")
      if (Array.isArray(valueNode)) {
        if (valueNode.length > state.maxMergeSeqLength)
          throwError(state, "merge sequence length exceeded maxMergeSeqLength (" + state.maxMergeSeqLength + ")");
        const seen = /* @__PURE__ */ new Set;
        for (let index = 0, quantity = valueNode.length;index < quantity; index += 1) {
          const src = valueNode[index];
          if (seen.has(src))
            continue;
          seen.add(src);
          mergeMappings(state, _result, src, overridableKeys);
        }
      } else
        mergeMappings(state, _result, valueNode, overridableKeys);
    else {
      if (!state.json && !_hasOwnProperty.call(overridableKeys, keyNode) && _hasOwnProperty.call(_result, keyNode)) {
        state.line = startLine || state.line;
        state.lineStart = startLineStart || state.lineStart;
        state.position = startPos || state.position;
        throwError(state, "duplicated mapping key");
      }
      setProperty(_result, keyNode, valueNode);
      delete overridableKeys[keyNode];
    }
    return _result;
  }
  function readLineBreak(state) {
    const ch = state.input.charCodeAt(state.position);
    if (ch === 10)
      state.position++;
    else if (ch === 13) {
      state.position++;
      if (state.input.charCodeAt(state.position) === 10)
        state.position++;
    } else
      throwError(state, "a line break is expected");
    state.line += 1;
    state.lineStart = state.position;
    state.firstTabInLine = -1;
  }
  function skipSeparationSpace(state, allowComments, checkIndent) {
    let lineBreaks = 0;
    let ch = state.input.charCodeAt(state.position);
    while (ch !== 0) {
      while (isWhiteSpace(ch)) {
        if (ch === 9 && state.firstTabInLine === -1)
          state.firstTabInLine = state.position;
        ch = state.input.charCodeAt(++state.position);
      }
      if (allowComments && ch === 35)
        do
          ch = state.input.charCodeAt(++state.position);
        while (ch !== 10 && ch !== 13 && ch !== 0);
      if (isEol(ch)) {
        readLineBreak(state);
        ch = state.input.charCodeAt(state.position);
        lineBreaks++;
        state.lineIndent = 0;
        while (ch === 32) {
          state.lineIndent++;
          ch = state.input.charCodeAt(++state.position);
        }
      } else
        break;
    }
    if (checkIndent !== -1 && lineBreaks !== 0 && state.lineIndent < checkIndent)
      throwWarning(state, "deficient indentation");
    return lineBreaks;
  }
  function testDocumentSeparator(state) {
    let _position = state.position;
    let ch = state.input.charCodeAt(_position);
    if ((ch === 45 || ch === 46) && ch === state.input.charCodeAt(_position + 1) && ch === state.input.charCodeAt(_position + 2)) {
      _position += 3;
      ch = state.input.charCodeAt(_position);
      if (ch === 0 || isWsOrEol(ch))
        return true;
    }
    return false;
  }
  function writeFoldedLines(state, count) {
    if (count === 1)
      state.result += " ";
    else if (count > 1)
      state.result += common.repeat(`
`, count - 1);
  }
  function readPlainScalar(state, nodeIndent, withinFlowCollection) {
    let captureStart;
    let captureEnd;
    let hasPendingContent;
    let _line;
    let _lineStart;
    let _lineIndent;
    const _kind = state.kind;
    const _result = state.result;
    let ch = state.input.charCodeAt(state.position);
    if (isWsOrEol(ch) || isFlowIndicator(ch) || ch === 35 || ch === 38 || ch === 42 || ch === 33 || ch === 124 || ch === 62 || ch === 39 || ch === 34 || ch === 37 || ch === 64 || ch === 96)
      return false;
    if (ch === 63 || ch === 45) {
      const following = state.input.charCodeAt(state.position + 1);
      if (isWsOrEol(following) || withinFlowCollection && isFlowIndicator(following))
        return false;
    }
    state.kind = "scalar";
    state.result = "";
    captureStart = captureEnd = state.position;
    hasPendingContent = false;
    while (ch !== 0) {
      if (ch === 58) {
        const following = state.input.charCodeAt(state.position + 1);
        if (isWsOrEol(following) || withinFlowCollection && isFlowIndicator(following))
          break;
      } else if (ch === 35) {
        if (isWsOrEol(state.input.charCodeAt(state.position - 1)))
          break;
      } else if (state.position === state.lineStart && testDocumentSeparator(state) || withinFlowCollection && isFlowIndicator(ch))
        break;
      else if (isEol(ch)) {
        _line = state.line;
        _lineStart = state.lineStart;
        _lineIndent = state.lineIndent;
        skipSeparationSpace(state, false, -1);
        if (state.lineIndent >= nodeIndent) {
          hasPendingContent = true;
          ch = state.input.charCodeAt(state.position);
          continue;
        } else {
          state.position = captureEnd;
          state.line = _line;
          state.lineStart = _lineStart;
          state.lineIndent = _lineIndent;
          break;
        }
      }
      if (hasPendingContent) {
        captureSegment(state, captureStart, captureEnd, false);
        writeFoldedLines(state, state.line - _line);
        captureStart = captureEnd = state.position;
        hasPendingContent = false;
      }
      if (!isWhiteSpace(ch))
        captureEnd = state.position + 1;
      ch = state.input.charCodeAt(++state.position);
    }
    captureSegment(state, captureStart, captureEnd, false);
    if (state.result)
      return true;
    state.kind = _kind;
    state.result = _result;
    return false;
  }
  function readSingleQuotedScalar(state, nodeIndent) {
    let captureStart;
    let captureEnd;
    let ch = state.input.charCodeAt(state.position);
    if (ch !== 39)
      return false;
    state.kind = "scalar";
    state.result = "";
    state.position++;
    captureStart = captureEnd = state.position;
    while ((ch = state.input.charCodeAt(state.position)) !== 0)
      if (ch === 39) {
        captureSegment(state, captureStart, state.position, true);
        ch = state.input.charCodeAt(++state.position);
        if (ch === 39) {
          captureStart = state.position;
          state.position++;
          captureEnd = state.position;
        } else
          return true;
      } else if (isEol(ch)) {
        captureSegment(state, captureStart, captureEnd, true);
        writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
        captureStart = captureEnd = state.position;
      } else if (state.position === state.lineStart && testDocumentSeparator(state))
        throwError(state, "unexpected end of the document within a single quoted scalar");
      else {
        state.position++;
        if (!isWhiteSpace(ch))
          captureEnd = state.position;
      }
    throwError(state, "unexpected end of the stream within a single quoted scalar");
  }
  function readDoubleQuotedScalar(state, nodeIndent) {
    let captureStart;
    let captureEnd;
    let tmp;
    let ch = state.input.charCodeAt(state.position);
    if (ch !== 34)
      return false;
    state.kind = "scalar";
    state.result = "";
    state.position++;
    captureStart = captureEnd = state.position;
    while ((ch = state.input.charCodeAt(state.position)) !== 0)
      if (ch === 34) {
        captureSegment(state, captureStart, state.position, true);
        state.position++;
        return true;
      } else if (ch === 92) {
        captureSegment(state, captureStart, state.position, true);
        ch = state.input.charCodeAt(++state.position);
        if (isEol(ch))
          skipSeparationSpace(state, false, nodeIndent);
        else if (ch < 256 && simpleEscapeCheck[ch]) {
          state.result += simpleEscapeMap[ch];
          state.position++;
        } else if ((tmp = escapedHexLen(ch)) > 0) {
          let hexLength = tmp;
          let hexResult = 0;
          for (;hexLength > 0; hexLength--) {
            ch = state.input.charCodeAt(++state.position);
            if ((tmp = fromHexCode(ch)) >= 0)
              hexResult = (hexResult << 4) + tmp;
            else
              throwError(state, "expected hexadecimal character");
          }
          state.result += charFromCodepoint(hexResult);
          state.position++;
        } else
          throwError(state, "unknown escape sequence");
        captureStart = captureEnd = state.position;
      } else if (isEol(ch)) {
        captureSegment(state, captureStart, captureEnd, true);
        writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
        captureStart = captureEnd = state.position;
      } else if (state.position === state.lineStart && testDocumentSeparator(state))
        throwError(state, "unexpected end of the document within a double quoted scalar");
      else {
        state.position++;
        if (!isWhiteSpace(ch))
          captureEnd = state.position;
      }
    throwError(state, "unexpected end of the stream within a double quoted scalar");
  }
  function readFlowCollection(state, nodeIndent) {
    let readNext = true;
    let _line;
    let _lineStart;
    let _pos;
    const _tag = state.tag;
    let _result;
    const _anchor = state.anchor;
    let terminator;
    let isPair;
    let isExplicitPair;
    let isMapping;
    const overridableKeys = Object.create(null);
    let keyNode;
    let keyTag;
    let valueNode;
    let ch = state.input.charCodeAt(state.position);
    if (ch === 91) {
      terminator = 93;
      isMapping = false;
      _result = [];
    } else if (ch === 123) {
      terminator = 125;
      isMapping = true;
      _result = {};
    } else
      return false;
    if (state.anchor !== null)
      storeAnchor(state, state.anchor, _result);
    ch = state.input.charCodeAt(++state.position);
    while (ch !== 0) {
      skipSeparationSpace(state, true, nodeIndent);
      ch = state.input.charCodeAt(state.position);
      if (ch === terminator) {
        state.position++;
        state.tag = _tag;
        state.anchor = _anchor;
        state.kind = isMapping ? "mapping" : "sequence";
        state.result = _result;
        return true;
      } else if (!readNext)
        throwError(state, "missed comma between flow collection entries");
      else if (ch === 44)
        throwError(state, "expected the node content, but found ','");
      keyTag = keyNode = valueNode = null;
      isPair = isExplicitPair = false;
      if (ch === 63) {
        if (isWsOrEol(state.input.charCodeAt(state.position + 1))) {
          isPair = isExplicitPair = true;
          state.position++;
          skipSeparationSpace(state, true, nodeIndent);
        }
      }
      _line = state.line;
      _lineStart = state.lineStart;
      _pos = state.position;
      composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
      keyTag = state.tag;
      keyNode = state.result;
      skipSeparationSpace(state, true, nodeIndent);
      ch = state.input.charCodeAt(state.position);
      if ((isExplicitPair || state.line === _line) && ch === 58) {
        isPair = true;
        ch = state.input.charCodeAt(++state.position);
        skipSeparationSpace(state, true, nodeIndent);
        composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
        valueNode = state.result;
      }
      if (isMapping)
        storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos);
      else if (isPair)
        _result.push(storeMappingPair(state, null, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos));
      else
        _result.push(keyNode);
      skipSeparationSpace(state, true, nodeIndent);
      ch = state.input.charCodeAt(state.position);
      if (ch === 44) {
        readNext = true;
        ch = state.input.charCodeAt(++state.position);
      } else
        readNext = false;
    }
    throwError(state, "unexpected end of the stream within a flow collection");
  }
  function readBlockScalar(state, nodeIndent) {
    let folding;
    let chomping = CHOMPING_CLIP;
    let didReadContent = false;
    let detectedIndent = false;
    let textIndent = nodeIndent;
    let emptyLines = 0;
    let atMoreIndented = false;
    let tmp;
    let ch = state.input.charCodeAt(state.position);
    if (ch === 124)
      folding = false;
    else if (ch === 62)
      folding = true;
    else
      return false;
    state.kind = "scalar";
    state.result = "";
    while (ch !== 0) {
      ch = state.input.charCodeAt(++state.position);
      if (ch === 43 || ch === 45)
        if (CHOMPING_CLIP === chomping)
          chomping = ch === 43 ? CHOMPING_KEEP : CHOMPING_STRIP;
        else
          throwError(state, "repeat of a chomping mode identifier");
      else if ((tmp = fromDecimalCode(ch)) >= 0)
        if (tmp === 0)
          throwError(state, "bad explicit indentation width of a block scalar; it cannot be less than one");
        else if (!detectedIndent) {
          textIndent = nodeIndent + tmp - 1;
          detectedIndent = true;
        } else
          throwError(state, "repeat of an indentation width identifier");
      else
        break;
    }
    if (isWhiteSpace(ch)) {
      do
        ch = state.input.charCodeAt(++state.position);
      while (isWhiteSpace(ch));
      if (ch === 35)
        do
          ch = state.input.charCodeAt(++state.position);
        while (!isEol(ch) && ch !== 0);
    }
    while (ch !== 0) {
      readLineBreak(state);
      state.lineIndent = 0;
      ch = state.input.charCodeAt(state.position);
      while ((!detectedIndent || state.lineIndent < textIndent) && ch === 32) {
        state.lineIndent++;
        ch = state.input.charCodeAt(++state.position);
      }
      if (!detectedIndent && state.lineIndent > textIndent)
        textIndent = state.lineIndent;
      if (isEol(ch)) {
        emptyLines++;
        continue;
      }
      if (!detectedIndent && textIndent === 0)
        throwError(state, "missing indentation for block scalar");
      if (state.lineIndent < textIndent) {
        if (chomping === CHOMPING_KEEP)
          state.result += common.repeat(`
`, didReadContent ? 1 + emptyLines : emptyLines);
        else if (chomping === CHOMPING_CLIP) {
          if (didReadContent)
            state.result += `
`;
        }
        break;
      }
      if (folding)
        if (isWhiteSpace(ch)) {
          atMoreIndented = true;
          state.result += common.repeat(`
`, didReadContent ? 1 + emptyLines : emptyLines);
        } else if (atMoreIndented) {
          atMoreIndented = false;
          state.result += common.repeat(`
`, emptyLines + 1);
        } else if (emptyLines === 0) {
          if (didReadContent)
            state.result += " ";
        } else
          state.result += common.repeat(`
`, emptyLines);
      else
        state.result += common.repeat(`
`, didReadContent ? 1 + emptyLines : emptyLines);
      didReadContent = true;
      detectedIndent = true;
      emptyLines = 0;
      const captureStart = state.position;
      while (!isEol(ch) && ch !== 0)
        ch = state.input.charCodeAt(++state.position);
      captureSegment(state, captureStart, state.position, false);
    }
    return true;
  }
  function readBlockSequence(state, nodeIndent) {
    const _tag = state.tag;
    const _anchor = state.anchor;
    const _result = [];
    let detected = false;
    if (state.firstTabInLine !== -1)
      return false;
    if (state.anchor !== null)
      storeAnchor(state, state.anchor, _result);
    let ch = state.input.charCodeAt(state.position);
    while (ch !== 0) {
      if (state.firstTabInLine !== -1) {
        state.position = state.firstTabInLine;
        throwError(state, "tab characters must not be used in indentation");
      }
      if (ch !== 45)
        break;
      if (!isWsOrEol(state.input.charCodeAt(state.position + 1)))
        break;
      detected = true;
      state.position++;
      if (skipSeparationSpace(state, true, -1)) {
        if (state.lineIndent <= nodeIndent) {
          _result.push(null);
          ch = state.input.charCodeAt(state.position);
          continue;
        }
      }
      const _line = state.line;
      composeNode(state, nodeIndent, CONTEXT_BLOCK_IN, false, true);
      _result.push(state.result);
      skipSeparationSpace(state, true, -1);
      ch = state.input.charCodeAt(state.position);
      if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0)
        throwError(state, "bad indentation of a sequence entry");
      else if (state.lineIndent < nodeIndent)
        break;
    }
    if (detected) {
      state.tag = _tag;
      state.anchor = _anchor;
      state.kind = "sequence";
      state.result = _result;
      return true;
    }
    return false;
  }
  function readBlockMapping(state, nodeIndent, flowIndent) {
    let allowCompact;
    let _keyLine;
    let _keyLineStart;
    let _keyPos;
    const _tag = state.tag;
    const _anchor = state.anchor;
    const _result = {};
    const overridableKeys = Object.create(null);
    let keyTag = null;
    let keyNode = null;
    let valueNode = null;
    let atExplicitKey = false;
    let detected = false;
    if (state.firstTabInLine !== -1)
      return false;
    if (state.anchor !== null)
      storeAnchor(state, state.anchor, _result);
    let ch = state.input.charCodeAt(state.position);
    while (ch !== 0) {
      if (!atExplicitKey && state.firstTabInLine !== -1) {
        state.position = state.firstTabInLine;
        throwError(state, "tab characters must not be used in indentation");
      }
      const following = state.input.charCodeAt(state.position + 1);
      const _line = state.line;
      if ((ch === 63 || ch === 58) && isWsOrEol(following)) {
        if (ch === 63) {
          if (atExplicitKey) {
            storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
            keyTag = keyNode = valueNode = null;
          }
          detected = true;
          atExplicitKey = true;
          allowCompact = true;
        } else if (atExplicitKey) {
          atExplicitKey = false;
          allowCompact = true;
        } else
          throwError(state, "incomplete explicit mapping pair; a key node is missed; or followed by a non-tabulated empty line");
        state.position += 1;
        ch = following;
      } else {
        _keyLine = state.line;
        _keyLineStart = state.lineStart;
        _keyPos = state.position;
        if (!composeNode(state, flowIndent, CONTEXT_FLOW_OUT, false, true))
          break;
        if (state.line === _line) {
          ch = state.input.charCodeAt(state.position);
          while (isWhiteSpace(ch))
            ch = state.input.charCodeAt(++state.position);
          if (ch === 58) {
            ch = state.input.charCodeAt(++state.position);
            if (!isWsOrEol(ch))
              throwError(state, "a whitespace character is expected after the key-value separator within a block mapping");
            if (atExplicitKey) {
              storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
              keyTag = keyNode = valueNode = null;
            }
            detected = true;
            atExplicitKey = false;
            allowCompact = false;
            keyTag = state.tag;
            keyNode = state.result;
          } else if (detected)
            throwError(state, "can not read an implicit mapping pair; a colon is missed");
          else {
            state.tag = _tag;
            state.anchor = _anchor;
            return true;
          }
        } else if (detected)
          throwError(state, "can not read a block mapping entry; a multiline key may not be an implicit key");
        else {
          state.tag = _tag;
          state.anchor = _anchor;
          return true;
        }
      }
      if (state.line === _line || state.lineIndent > nodeIndent) {
        if (atExplicitKey) {
          _keyLine = state.line;
          _keyLineStart = state.lineStart;
          _keyPos = state.position;
        }
        if (composeNode(state, nodeIndent, CONTEXT_BLOCK_OUT, true, allowCompact))
          if (atExplicitKey)
            keyNode = state.result;
          else
            valueNode = state.result;
        if (!atExplicitKey) {
          storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _keyLine, _keyLineStart, _keyPos);
          keyTag = keyNode = valueNode = null;
        }
        skipSeparationSpace(state, true, -1);
        ch = state.input.charCodeAt(state.position);
      }
      if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0)
        throwError(state, "bad indentation of a mapping entry");
      else if (state.lineIndent < nodeIndent)
        break;
    }
    if (atExplicitKey)
      storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
    if (detected) {
      state.tag = _tag;
      state.anchor = _anchor;
      state.kind = "mapping";
      state.result = _result;
    }
    return detected;
  }
  function readTagProperty(state) {
    let isVerbatim = false;
    let isNamed = false;
    let tagHandle;
    let tagName;
    let ch = state.input.charCodeAt(state.position);
    if (ch !== 33)
      return false;
    if (state.tag !== null)
      throwError(state, "duplication of a tag property");
    ch = state.input.charCodeAt(++state.position);
    if (ch === 60) {
      isVerbatim = true;
      ch = state.input.charCodeAt(++state.position);
    } else if (ch === 33) {
      isNamed = true;
      tagHandle = "!!";
      ch = state.input.charCodeAt(++state.position);
    } else
      tagHandle = "!";
    let _position = state.position;
    if (isVerbatim) {
      do
        ch = state.input.charCodeAt(++state.position);
      while (ch !== 0 && ch !== 62);
      if (state.position < state.length) {
        tagName = state.input.slice(_position, state.position);
        ch = state.input.charCodeAt(++state.position);
      } else
        throwError(state, "unexpected end of the stream within a verbatim tag");
    } else {
      while (ch !== 0 && !isWsOrEol(ch)) {
        if (ch === 33)
          if (!isNamed) {
            tagHandle = state.input.slice(_position - 1, state.position + 1);
            if (!PATTERN_TAG_HANDLE.test(tagHandle))
              throwError(state, "named tag handle cannot contain such characters");
            isNamed = true;
            _position = state.position + 1;
          } else
            throwError(state, "tag suffix cannot contain exclamation marks");
        ch = state.input.charCodeAt(++state.position);
      }
      tagName = state.input.slice(_position, state.position);
      if (PATTERN_FLOW_INDICATORS.test(tagName))
        throwError(state, "tag suffix cannot contain flow indicator characters");
    }
    if (tagName && !PATTERN_TAG_URI.test(tagName))
      throwError(state, "tag name cannot contain such characters: " + tagName);
    try {
      tagName = decodeURIComponent(tagName);
    } catch (err) {
      throwError(state, "tag name is malformed: " + tagName);
    }
    if (isVerbatim)
      state.tag = tagName;
    else if (_hasOwnProperty.call(state.tagMap, tagHandle))
      state.tag = state.tagMap[tagHandle] + tagName;
    else if (tagHandle === "!")
      state.tag = "!" + tagName;
    else if (tagHandle === "!!")
      state.tag = "tag:yaml.org,2002:" + tagName;
    else
      throwError(state, 'undeclared tag handle "' + tagHandle + '"');
    return true;
  }
  function readAnchorProperty(state) {
    let ch = state.input.charCodeAt(state.position);
    if (ch !== 38)
      return false;
    if (state.anchor !== null)
      throwError(state, "duplication of an anchor property");
    ch = state.input.charCodeAt(++state.position);
    const _position = state.position;
    while (ch !== 0 && !isWsOrEol(ch) && !isFlowIndicator(ch))
      ch = state.input.charCodeAt(++state.position);
    if (state.position === _position)
      throwError(state, "name of an anchor node must contain at least one character");
    state.anchor = state.input.slice(_position, state.position);
    return true;
  }
  function readAlias(state) {
    let ch = state.input.charCodeAt(state.position);
    if (ch !== 42)
      return false;
    ch = state.input.charCodeAt(++state.position);
    const _position = state.position;
    while (ch !== 0 && !isWsOrEol(ch) && !isFlowIndicator(ch))
      ch = state.input.charCodeAt(++state.position);
    if (state.position === _position)
      throwError(state, "name of an alias node must contain at least one character");
    const alias = state.input.slice(_position, state.position);
    if (!_hasOwnProperty.call(state.anchorMap, alias))
      throwError(state, 'unidentified alias "' + alias + '"');
    state.result = state.anchorMap[alias];
    skipSeparationSpace(state, true, -1);
    return true;
  }
  function tryReadBlockMappingFromProperty(state, propertyStart, nodeIndent, flowIndent) {
    const fallbackState = snapshotState(state);
    beginAnchorTransaction(state);
    restoreState(state, propertyStart);
    state.tag = null;
    state.anchor = null;
    state.kind = null;
    state.result = null;
    if (readBlockMapping(state, nodeIndent, flowIndent) && state.kind === "mapping") {
      commitAnchorTransaction(state);
      return true;
    }
    rollbackAnchorTransaction(state);
    restoreState(state, fallbackState);
    return false;
  }
  function composeNode(state, parentIndent, nodeContext, allowToSeek, allowCompact) {
    let allowBlockScalars;
    let allowBlockCollections;
    let indentStatus = 1;
    let atNewLine = false;
    let hasContent = false;
    let propertyStart = null;
    let type;
    let flowIndent;
    let blockIndent;
    if (state.depth >= state.maxDepth)
      throwError(state, "nesting exceeded maxDepth (" + state.maxDepth + ")");
    state.depth += 1;
    if (state.listener !== null)
      state.listener("open", state);
    state.tag = null;
    state.anchor = null;
    state.kind = null;
    state.result = null;
    const allowBlockStyles = allowBlockScalars = allowBlockCollections = CONTEXT_BLOCK_OUT === nodeContext || CONTEXT_BLOCK_IN === nodeContext;
    if (allowToSeek) {
      if (skipSeparationSpace(state, true, -1)) {
        atNewLine = true;
        if (state.lineIndent > parentIndent)
          indentStatus = 1;
        else if (state.lineIndent === parentIndent)
          indentStatus = 0;
        else if (state.lineIndent < parentIndent)
          indentStatus = -1;
      }
    }
    if (indentStatus === 1)
      while (true) {
        const ch = state.input.charCodeAt(state.position);
        const propertyState = snapshotState(state);
        if (atNewLine && (ch === 33 && state.tag !== null || ch === 38 && state.anchor !== null))
          break;
        if (!readTagProperty(state) && !readAnchorProperty(state))
          break;
        if (propertyStart === null)
          propertyStart = propertyState;
        if (skipSeparationSpace(state, true, -1)) {
          atNewLine = true;
          allowBlockCollections = allowBlockStyles;
          if (state.lineIndent > parentIndent)
            indentStatus = 1;
          else if (state.lineIndent === parentIndent)
            indentStatus = 0;
          else if (state.lineIndent < parentIndent)
            indentStatus = -1;
        } else
          allowBlockCollections = false;
      }
    if (allowBlockCollections)
      allowBlockCollections = atNewLine || allowCompact;
    if (indentStatus === 1 || CONTEXT_BLOCK_OUT === nodeContext) {
      if (CONTEXT_FLOW_IN === nodeContext || CONTEXT_FLOW_OUT === nodeContext)
        flowIndent = parentIndent;
      else
        flowIndent = parentIndent + 1;
      blockIndent = state.position - state.lineStart;
      if (indentStatus === 1)
        if (allowBlockCollections && (readBlockSequence(state, blockIndent) || readBlockMapping(state, blockIndent, flowIndent)) || readFlowCollection(state, flowIndent))
          hasContent = true;
        else {
          const ch = state.input.charCodeAt(state.position);
          if (propertyStart !== null && allowBlockStyles && !allowBlockCollections && ch !== 124 && ch !== 62 && tryReadBlockMappingFromProperty(state, propertyStart, propertyStart.position - propertyStart.lineStart, flowIndent))
            hasContent = true;
          else if (allowBlockScalars && readBlockScalar(state, flowIndent) || readSingleQuotedScalar(state, flowIndent) || readDoubleQuotedScalar(state, flowIndent))
            hasContent = true;
          else if (readAlias(state)) {
            hasContent = true;
            if (state.tag !== null || state.anchor !== null)
              throwError(state, "alias node should not have any properties");
          } else if (readPlainScalar(state, flowIndent, CONTEXT_FLOW_IN === nodeContext)) {
            hasContent = true;
            if (state.tag === null)
              state.tag = "?";
          }
          if (state.anchor !== null)
            storeAnchor(state, state.anchor, state.result);
        }
      else if (indentStatus === 0)
        hasContent = allowBlockCollections && readBlockSequence(state, blockIndent);
    }
    if (state.tag === null) {
      if (state.anchor !== null)
        storeAnchor(state, state.anchor, state.result);
    } else if (state.tag === "?") {
      if (state.result !== null && state.kind !== "scalar")
        throwError(state, 'unacceptable node kind for !<?> tag; it should be "scalar", not "' + state.kind + '"');
      for (let typeIndex = 0, typeQuantity = state.implicitTypes.length;typeIndex < typeQuantity; typeIndex += 1) {
        type = state.implicitTypes[typeIndex];
        if (type.resolve(state.result)) {
          state.result = type.construct(state.result);
          state.tag = type.tag;
          if (state.anchor !== null)
            storeAnchor(state, state.anchor, state.result);
          break;
        }
      }
    } else if (state.tag !== "!") {
      if (_hasOwnProperty.call(state.typeMap[state.kind || "fallback"], state.tag))
        type = state.typeMap[state.kind || "fallback"][state.tag];
      else {
        type = null;
        const typeList = state.typeMap.multi[state.kind || "fallback"];
        for (let typeIndex = 0, typeQuantity = typeList.length;typeIndex < typeQuantity; typeIndex += 1)
          if (state.tag.slice(0, typeList[typeIndex].tag.length) === typeList[typeIndex].tag) {
            type = typeList[typeIndex];
            break;
          }
      }
      if (!type)
        throwError(state, "unknown tag !<" + state.tag + ">");
      if (state.result !== null && type.kind !== state.kind)
        throwError(state, "unacceptable node kind for !<" + state.tag + '> tag; it should be "' + type.kind + '", not "' + state.kind + '"');
      if (!type.resolve(state.result, state.tag))
        throwError(state, "cannot resolve a node with !<" + state.tag + "> explicit tag");
      else {
        state.result = type.construct(state.result, state.tag);
        if (state.anchor !== null)
          storeAnchor(state, state.anchor, state.result);
      }
    }
    if (state.listener !== null)
      state.listener("close", state);
    state.depth -= 1;
    return state.tag !== null || state.anchor !== null || hasContent;
  }
  function readDocument(state) {
    const documentStart = state.position;
    let hasDirectives = false;
    let ch;
    state.version = null;
    state.checkLineBreaks = state.legacy;
    state.tagMap = Object.create(null);
    state.anchorMap = Object.create(null);
    while ((ch = state.input.charCodeAt(state.position)) !== 0) {
      skipSeparationSpace(state, true, -1);
      ch = state.input.charCodeAt(state.position);
      if (state.lineIndent > 0 || ch !== 37)
        break;
      hasDirectives = true;
      ch = state.input.charCodeAt(++state.position);
      let _position = state.position;
      while (ch !== 0 && !isWsOrEol(ch))
        ch = state.input.charCodeAt(++state.position);
      const directiveName = state.input.slice(_position, state.position);
      const directiveArgs = [];
      if (directiveName.length < 1)
        throwError(state, "directive name must not be less than one character in length");
      while (ch !== 0) {
        while (isWhiteSpace(ch))
          ch = state.input.charCodeAt(++state.position);
        if (ch === 35) {
          do
            ch = state.input.charCodeAt(++state.position);
          while (ch !== 0 && !isEol(ch));
          break;
        }
        if (isEol(ch))
          break;
        _position = state.position;
        while (ch !== 0 && !isWsOrEol(ch))
          ch = state.input.charCodeAt(++state.position);
        directiveArgs.push(state.input.slice(_position, state.position));
      }
      if (ch !== 0)
        readLineBreak(state);
      if (_hasOwnProperty.call(directiveHandlers, directiveName))
        directiveHandlers[directiveName](state, directiveName, directiveArgs);
      else
        throwWarning(state, 'unknown document directive "' + directiveName + '"');
    }
    skipSeparationSpace(state, true, -1);
    if (state.lineIndent === 0 && state.input.charCodeAt(state.position) === 45 && state.input.charCodeAt(state.position + 1) === 45 && state.input.charCodeAt(state.position + 2) === 45) {
      state.position += 3;
      skipSeparationSpace(state, true, -1);
    } else if (hasDirectives)
      throwError(state, "directives end mark is expected");
    composeNode(state, state.lineIndent - 1, CONTEXT_BLOCK_OUT, false, true);
    skipSeparationSpace(state, true, -1);
    if (state.checkLineBreaks && PATTERN_NON_ASCII_LINE_BREAKS.test(state.input.slice(documentStart, state.position)))
      throwWarning(state, "non-ASCII line breaks are interpreted as content");
    state.documents.push(state.result);
    if (state.position === state.lineStart && testDocumentSeparator(state)) {
      if (state.input.charCodeAt(state.position) === 46) {
        state.position += 3;
        skipSeparationSpace(state, true, -1);
      }
      return;
    }
    if (state.position < state.length - 1)
      throwError(state, "end of the stream or a document separator is expected");
  }
  function loadDocuments(input, options) {
    input = String(input);
    options = options || {};
    if (input.length !== 0) {
      if (input.charCodeAt(input.length - 1) !== 10 && input.charCodeAt(input.length - 1) !== 13)
        input += `
`;
      if (input.charCodeAt(0) === 65279)
        input = input.slice(1);
    }
    const state = new State(input, options);
    const nullpos = input.indexOf("\x00");
    if (nullpos !== -1) {
      state.position = nullpos;
      throwError(state, "null byte is not allowed in input");
    }
    state.input += "\x00";
    while (state.input.charCodeAt(state.position) === 32) {
      state.lineIndent += 1;
      state.position += 1;
    }
    while (state.position < state.length - 1)
      readDocument(state);
    return state.documents;
  }
  function loadAll(input, iterator, options) {
    if (iterator !== null && typeof iterator === "object" && typeof options === "undefined") {
      options = iterator;
      iterator = null;
    }
    const documents = loadDocuments(input, options);
    if (typeof iterator !== "function")
      return documents;
    for (let index = 0, length = documents.length;index < length; index += 1)
      iterator(documents[index]);
  }
  function load(input, options) {
    const documents = loadDocuments(input, options);
    if (documents.length === 0)
      return;
    else if (documents.length === 1)
      return documents[0];
    throw new YAMLException("expected a single document in the stream, but found more");
  }
  module.exports.loadAll = loadAll;
  module.exports.load = load;
});
var require_dumper = /* @__PURE__ */ __commonJSMin((exports, module) => {
  var common = require_common();
  var YAMLException = require_exception();
  var DEFAULT_SCHEMA = require_default();
  var _toString = Object.prototype.toString;
  var _hasOwnProperty = Object.prototype.hasOwnProperty;
  var CHAR_BOM = 65279;
  var CHAR_TAB = 9;
  var CHAR_LINE_FEED = 10;
  var CHAR_CARRIAGE_RETURN = 13;
  var CHAR_SPACE = 32;
  var CHAR_EXCLAMATION = 33;
  var CHAR_DOUBLE_QUOTE = 34;
  var CHAR_SHARP = 35;
  var CHAR_PERCENT = 37;
  var CHAR_AMPERSAND = 38;
  var CHAR_SINGLE_QUOTE = 39;
  var CHAR_ASTERISK = 42;
  var CHAR_COMMA = 44;
  var CHAR_MINUS = 45;
  var CHAR_COLON = 58;
  var CHAR_EQUALS = 61;
  var CHAR_GREATER_THAN = 62;
  var CHAR_QUESTION = 63;
  var CHAR_COMMERCIAL_AT = 64;
  var CHAR_LEFT_SQUARE_BRACKET = 91;
  var CHAR_RIGHT_SQUARE_BRACKET = 93;
  var CHAR_GRAVE_ACCENT = 96;
  var CHAR_LEFT_CURLY_BRACKET = 123;
  var CHAR_VERTICAL_LINE = 124;
  var CHAR_RIGHT_CURLY_BRACKET = 125;
  var ESCAPE_SEQUENCES = {};
  ESCAPE_SEQUENCES[0] = "\\0";
  ESCAPE_SEQUENCES[7] = "\\a";
  ESCAPE_SEQUENCES[8] = "\\b";
  ESCAPE_SEQUENCES[9] = "\\t";
  ESCAPE_SEQUENCES[10] = "\\n";
  ESCAPE_SEQUENCES[11] = "\\v";
  ESCAPE_SEQUENCES[12] = "\\f";
  ESCAPE_SEQUENCES[13] = "\\r";
  ESCAPE_SEQUENCES[27] = "\\e";
  ESCAPE_SEQUENCES[34] = "\\\"";
  ESCAPE_SEQUENCES[92] = "\\\\";
  ESCAPE_SEQUENCES[133] = "\\N";
  ESCAPE_SEQUENCES[160] = "\\_";
  ESCAPE_SEQUENCES[8232] = "\\L";
  ESCAPE_SEQUENCES[8233] = "\\P";
  var DEPRECATED_BOOLEANS_SYNTAX = [
    "y",
    "Y",
    "yes",
    "Yes",
    "YES",
    "on",
    "On",
    "ON",
    "n",
    "N",
    "no",
    "No",
    "NO",
    "off",
    "Off",
    "OFF"
  ];
  var DEPRECATED_BASE60_SYNTAX = /^[-+]?[0-9_]+(?::[0-9_]+)+(?:\.[0-9_]*)?$/;
  function compileStyleMap(schema, map) {
    if (map === null)
      return {};
    const result = {};
    const keys = Object.keys(map);
    for (let index = 0, length = keys.length;index < length; index += 1) {
      let tag = keys[index];
      let style = String(map[tag]);
      if (tag.slice(0, 2) === "!!")
        tag = "tag:yaml.org,2002:" + tag.slice(2);
      const type = schema.compiledTypeMap["fallback"][tag];
      if (type && _hasOwnProperty.call(type.styleAliases, style))
        style = type.styleAliases[style];
      result[tag] = style;
    }
    return result;
  }
  function encodeHex(character) {
    let handle;
    let length;
    const string = character.toString(16).toUpperCase();
    if (character <= 255) {
      handle = "x";
      length = 2;
    } else if (character <= 65535) {
      handle = "u";
      length = 4;
    } else if (character <= 4294967295) {
      handle = "U";
      length = 8;
    } else
      throw new YAMLException("code point within a string may not be greater than 0xFFFFFFFF");
    return "\\" + handle + common.repeat("0", length - string.length) + string;
  }
  var QUOTING_TYPE_SINGLE = 1;
  var QUOTING_TYPE_DOUBLE = 2;
  function State(options) {
    this.schema = options["schema"] || DEFAULT_SCHEMA;
    this.indent = Math.max(1, options["indent"] || 2);
    this.noArrayIndent = options["noArrayIndent"] || false;
    this.skipInvalid = options["skipInvalid"] || false;
    this.flowLevel = common.isNothing(options["flowLevel"]) ? -1 : options["flowLevel"];
    this.styleMap = compileStyleMap(this.schema, options["styles"] || null);
    this.sortKeys = options["sortKeys"] || false;
    this.lineWidth = options["lineWidth"] || 80;
    this.noRefs = options["noRefs"] || false;
    this.noCompatMode = options["noCompatMode"] || false;
    this.condenseFlow = options["condenseFlow"] || false;
    this.quotingType = options["quotingType"] === '"' ? QUOTING_TYPE_DOUBLE : QUOTING_TYPE_SINGLE;
    this.forceQuotes = options["forceQuotes"] || false;
    this.replacer = typeof options["replacer"] === "function" ? options["replacer"] : null;
    this.implicitTypes = this.schema.compiledImplicit;
    this.explicitTypes = this.schema.compiledExplicit;
    this.tag = null;
    this.result = "";
    this.duplicates = [];
    this.usedDuplicates = null;
  }
  function indentString(string, spaces) {
    const ind = common.repeat(" ", spaces);
    let position = 0;
    let result = "";
    const length = string.length;
    while (position < length) {
      let line;
      const next = string.indexOf(`
`, position);
      if (next === -1) {
        line = string.slice(position);
        position = length;
      } else {
        line = string.slice(position, next + 1);
        position = next + 1;
      }
      if (line.length && line !== `
`)
        result += ind;
      result += line;
    }
    return result;
  }
  function generateNextLine(state, level) {
    return `
` + common.repeat(" ", state.indent * level);
  }
  function testImplicitResolving(state, str) {
    for (let index = 0, length = state.implicitTypes.length;index < length; index += 1)
      if (state.implicitTypes[index].resolve(str))
        return true;
    return false;
  }
  function isWhitespace(c) {
    return c === CHAR_SPACE || c === CHAR_TAB;
  }
  function isPrintable(c) {
    return c >= 32 && c <= 126 || c >= 161 && c <= 55295 && c !== 8232 && c !== 8233 || c >= 57344 && c <= 65533 && c !== CHAR_BOM || c >= 65536 && c <= 1114111;
  }
  function isNsCharOrWhitespace(c) {
    return isPrintable(c) && c !== CHAR_BOM && c !== CHAR_CARRIAGE_RETURN && c !== CHAR_LINE_FEED;
  }
  function isPlainSafe(c, prev, inblock) {
    const cIsNsCharOrWhitespace = isNsCharOrWhitespace(c);
    const cIsNsChar = cIsNsCharOrWhitespace && !isWhitespace(c);
    return (inblock ? cIsNsCharOrWhitespace : cIsNsCharOrWhitespace && c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET) && c !== CHAR_SHARP && !(prev === CHAR_COLON && !cIsNsChar) || isNsCharOrWhitespace(prev) && !isWhitespace(prev) && c === CHAR_SHARP || prev === CHAR_COLON && cIsNsChar;
  }
  function isPlainSafeFirst(c) {
    return isPrintable(c) && c !== CHAR_BOM && !isWhitespace(c) && c !== CHAR_MINUS && c !== CHAR_QUESTION && c !== CHAR_COLON && c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET && c !== CHAR_SHARP && c !== CHAR_AMPERSAND && c !== CHAR_ASTERISK && c !== CHAR_EXCLAMATION && c !== CHAR_VERTICAL_LINE && c !== CHAR_EQUALS && c !== CHAR_GREATER_THAN && c !== CHAR_SINGLE_QUOTE && c !== CHAR_DOUBLE_QUOTE && c !== CHAR_PERCENT && c !== CHAR_COMMERCIAL_AT && c !== CHAR_GRAVE_ACCENT;
  }
  function isPlainSafeLast(c) {
    return !isWhitespace(c) && c !== CHAR_COLON;
  }
  function codePointAt(string, pos) {
    const first = string.charCodeAt(pos);
    let second;
    if (first >= 55296 && first <= 56319 && pos + 1 < string.length) {
      second = string.charCodeAt(pos + 1);
      if (second >= 56320 && second <= 57343)
        return (first - 55296) * 1024 + second - 56320 + 65536;
    }
    return first;
  }
  function needIndentIndicator(string) {
    return /^\n* /.test(string);
  }
  var STYLE_PLAIN = 1;
  var STYLE_SINGLE = 2;
  var STYLE_LITERAL = 3;
  var STYLE_FOLDED = 4;
  var STYLE_DOUBLE = 5;
  function chooseScalarStyle(string, singleLineOnly, indentPerLevel, lineWidth, testAmbiguousType, quotingType, forceQuotes, inblock) {
    let i;
    let char = 0;
    let prevChar = null;
    let hasLineBreak = false;
    let hasFoldableLine = false;
    const shouldTrackWidth = lineWidth !== -1;
    let previousLineBreak = -1;
    let plain = isPlainSafeFirst(codePointAt(string, 0)) && isPlainSafeLast(codePointAt(string, string.length - 1));
    if (singleLineOnly || forceQuotes)
      for (i = 0;i < string.length; char >= 65536 ? i += 2 : i++) {
        char = codePointAt(string, i);
        if (!isPrintable(char))
          return STYLE_DOUBLE;
        plain = plain && isPlainSafe(char, prevChar, inblock);
        prevChar = char;
      }
    else {
      for (i = 0;i < string.length; char >= 65536 ? i += 2 : i++) {
        char = codePointAt(string, i);
        if (char === CHAR_LINE_FEED) {
          hasLineBreak = true;
          if (shouldTrackWidth) {
            hasFoldableLine = hasFoldableLine || i - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ";
            previousLineBreak = i;
          }
        } else if (!isPrintable(char))
          return STYLE_DOUBLE;
        plain = plain && isPlainSafe(char, prevChar, inblock);
        prevChar = char;
      }
      hasFoldableLine = hasFoldableLine || shouldTrackWidth && i - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ";
    }
    if (!hasLineBreak && !hasFoldableLine) {
      if (plain && !forceQuotes && !testAmbiguousType(string))
        return STYLE_PLAIN;
      return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
    }
    if (indentPerLevel > 9 && needIndentIndicator(string))
      return STYLE_DOUBLE;
    if (!forceQuotes)
      return hasFoldableLine ? STYLE_FOLDED : STYLE_LITERAL;
    return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
  }
  function writeScalar(state, string, level, iskey, inblock) {
    state.dump = function() {
      if (string.length === 0)
        return state.quotingType === QUOTING_TYPE_DOUBLE ? '""' : "''";
      if (!state.noCompatMode) {
        if (DEPRECATED_BOOLEANS_SYNTAX.indexOf(string) !== -1 || DEPRECATED_BASE60_SYNTAX.test(string))
          return state.quotingType === QUOTING_TYPE_DOUBLE ? '"' + string + '"' : "'" + string + "'";
      }
      const indent = state.indent * Math.max(1, level);
      const lineWidth = state.lineWidth === -1 ? -1 : Math.max(Math.min(state.lineWidth, 40), state.lineWidth - indent);
      const singleLineOnly = iskey || state.flowLevel > -1 && level >= state.flowLevel;
      function testAmbiguity(string2) {
        return testImplicitResolving(state, string2);
      }
      switch (chooseScalarStyle(string, singleLineOnly, state.indent, lineWidth, testAmbiguity, state.quotingType, state.forceQuotes && !iskey, inblock)) {
        case STYLE_PLAIN:
          return string;
        case STYLE_SINGLE:
          return "'" + string.replace(/'/g, "''") + "'";
        case STYLE_LITERAL:
          return "|" + blockHeader(string, state.indent) + dropEndingNewline(indentString(string, indent));
        case STYLE_FOLDED:
          return ">" + blockHeader(string, state.indent) + dropEndingNewline(indentString(foldString(string, lineWidth), indent));
        case STYLE_DOUBLE:
          return '"' + escapeString(string, lineWidth) + '"';
        default:
          throw new YAMLException("impossible error: invalid scalar style");
      }
    }();
  }
  function blockHeader(string, indentPerLevel) {
    const indentIndicator = needIndentIndicator(string) ? String(indentPerLevel) : "";
    const clip = string[string.length - 1] === `
`;
    return indentIndicator + (clip && (string[string.length - 2] === `
` || string === `
`) ? "+" : clip ? "" : "-") + `
`;
  }
  function dropEndingNewline(string) {
    return string[string.length - 1] === `
` ? string.slice(0, -1) : string;
  }
  function foldString(string, width) {
    const lineRe = /(\n+)([^\n]*)/g;
    let result = function() {
      let nextLF = string.indexOf(`
`);
      nextLF = nextLF !== -1 ? nextLF : string.length;
      lineRe.lastIndex = nextLF;
      return foldLine(string.slice(0, nextLF), width);
    }();
    let prevMoreIndented = string[0] === `
` || string[0] === " ";
    let moreIndented;
    let match;
    while (match = lineRe.exec(string)) {
      const prefix = match[1];
      const line = match[2];
      moreIndented = line[0] === " ";
      result += prefix + (!prevMoreIndented && !moreIndented && line !== "" ? `
` : "") + foldLine(line, width);
      prevMoreIndented = moreIndented;
    }
    return result;
  }
  function foldLine(line, width) {
    if (line === "" || line[0] === " ")
      return line;
    const breakRe = / [^ ]/g;
    let match;
    let start = 0;
    let end;
    let curr = 0;
    let next = 0;
    let result = "";
    while (match = breakRe.exec(line)) {
      next = match.index;
      if (next - start > width) {
        end = curr > start ? curr : next;
        result += `
` + line.slice(start, end);
        start = end + 1;
      }
      curr = next;
    }
    result += `
`;
    if (line.length - start > width && curr > start)
      result += line.slice(start, curr) + `
` + line.slice(curr + 1);
    else
      result += line.slice(start);
    return result.slice(1);
  }
  function escapeString(string) {
    let result = "";
    let char = 0;
    for (let i = 0;i < string.length; char >= 65536 ? i += 2 : i++) {
      char = codePointAt(string, i);
      const escapeSeq = ESCAPE_SEQUENCES[char];
      if (!escapeSeq && isPrintable(char)) {
        result += string[i];
        if (char >= 65536)
          result += string[i + 1];
      } else
        result += escapeSeq || encodeHex(char);
    }
    return result;
  }
  function writeFlowSequence(state, level, object) {
    let _result = "";
    const _tag = state.tag;
    for (let index = 0, length = object.length;index < length; index += 1) {
      let value = object[index];
      if (state.replacer)
        value = state.replacer.call(object, String(index), value);
      if (writeNode(state, level, value, false, false) || typeof value === "undefined" && writeNode(state, level, null, false, false)) {
        if (_result !== "")
          _result += "," + (!state.condenseFlow ? " " : "");
        _result += state.dump;
      }
    }
    state.tag = _tag;
    state.dump = "[" + _result + "]";
  }
  function writeBlockSequence(state, level, object, compact) {
    let _result = "";
    const _tag = state.tag;
    for (let index = 0, length = object.length;index < length; index += 1) {
      let value = object[index];
      if (state.replacer)
        value = state.replacer.call(object, String(index), value);
      if (writeNode(state, level + 1, value, true, true, false, true) || typeof value === "undefined" && writeNode(state, level + 1, null, true, true, false, true)) {
        if (!compact || _result !== "")
          _result += generateNextLine(state, level);
        if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0))
          _result += "-";
        else
          _result += "- ";
        _result += state.dump;
      }
    }
    state.tag = _tag;
    state.dump = _result || "[]";
  }
  function writeFlowMapping(state, level, object) {
    let _result = "";
    const _tag = state.tag;
    const objectKeyList = Object.keys(object);
    for (let index = 0, length = objectKeyList.length;index < length; index += 1) {
      let pairBuffer = "";
      if (_result !== "")
        pairBuffer += ", ";
      if (state.condenseFlow)
        pairBuffer += '"';
      const objectKey = objectKeyList[index];
      let objectValue = object[objectKey];
      if (state.replacer)
        objectValue = state.replacer.call(object, objectKey, objectValue);
      if (!writeNode(state, level, objectKey, false, false))
        continue;
      if (state.dump.length > 1024)
        pairBuffer += "? ";
      pairBuffer += state.dump + (state.condenseFlow ? '"' : "") + ":" + (state.condenseFlow ? "" : " ");
      if (!writeNode(state, level, objectValue, false, false))
        continue;
      pairBuffer += state.dump;
      _result += pairBuffer;
    }
    state.tag = _tag;
    state.dump = "{" + _result + "}";
  }
  function writeBlockMapping(state, level, object, compact) {
    let _result = "";
    const _tag = state.tag;
    const objectKeyList = Object.keys(object);
    if (state.sortKeys === true)
      objectKeyList.sort();
    else if (typeof state.sortKeys === "function")
      objectKeyList.sort(state.sortKeys);
    else if (state.sortKeys)
      throw new YAMLException("sortKeys must be a boolean or a function");
    for (let index = 0, length = objectKeyList.length;index < length; index += 1) {
      let pairBuffer = "";
      if (!compact || _result !== "")
        pairBuffer += generateNextLine(state, level);
      const objectKey = objectKeyList[index];
      let objectValue = object[objectKey];
      if (state.replacer)
        objectValue = state.replacer.call(object, objectKey, objectValue);
      if (!writeNode(state, level + 1, objectKey, true, true, true))
        continue;
      const explicitPair = state.tag !== null && state.tag !== "?" || state.dump && state.dump.length > 1024;
      if (explicitPair)
        if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0))
          pairBuffer += "?";
        else
          pairBuffer += "? ";
      pairBuffer += state.dump;
      if (explicitPair)
        pairBuffer += generateNextLine(state, level);
      if (!writeNode(state, level + 1, objectValue, true, explicitPair))
        continue;
      if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0))
        pairBuffer += ":";
      else
        pairBuffer += ": ";
      pairBuffer += state.dump;
      _result += pairBuffer;
    }
    state.tag = _tag;
    state.dump = _result || "{}";
  }
  function detectType(state, object, explicit) {
    const typeList = explicit ? state.explicitTypes : state.implicitTypes;
    for (let index = 0, length = typeList.length;index < length; index += 1) {
      const type = typeList[index];
      if ((type.instanceOf || type.predicate) && (!type.instanceOf || typeof object === "object" && object instanceof type.instanceOf) && (!type.predicate || type.predicate(object))) {
        if (explicit)
          if (type.multi && type.representName)
            state.tag = type.representName(object);
          else
            state.tag = type.tag;
        else
          state.tag = "?";
        if (type.represent) {
          const style = state.styleMap[type.tag] || type.defaultStyle;
          let _result;
          if (_toString.call(type.represent) === "[object Function]")
            _result = type.represent(object, style);
          else if (_hasOwnProperty.call(type.represent, style))
            _result = type.represent[style](object, style);
          else
            throw new YAMLException("!<" + type.tag + '> tag resolver accepts not "' + style + '" style');
          state.dump = _result;
        }
        return true;
      }
    }
    return false;
  }
  function writeNode(state, level, object, block, compact, iskey, isblockseq) {
    state.tag = null;
    state.dump = object;
    if (!detectType(state, object, false))
      detectType(state, object, true);
    const type = _toString.call(state.dump);
    const inblock = block;
    if (block)
      block = state.flowLevel < 0 || state.flowLevel > level;
    const objectOrArray = type === "[object Object]" || type === "[object Array]";
    let duplicateIndex;
    let duplicate;
    if (objectOrArray) {
      duplicateIndex = state.duplicates.indexOf(object);
      duplicate = duplicateIndex !== -1;
    }
    if (state.tag !== null && state.tag !== "?" || duplicate || state.indent !== 2 && level > 0)
      compact = false;
    if (duplicate && state.usedDuplicates[duplicateIndex])
      state.dump = "*ref_" + duplicateIndex;
    else {
      if (objectOrArray && duplicate && !state.usedDuplicates[duplicateIndex])
        state.usedDuplicates[duplicateIndex] = true;
      if (type === "[object Object]")
        if (block && Object.keys(state.dump).length !== 0) {
          writeBlockMapping(state, level, state.dump, compact);
          if (duplicate)
            state.dump = "&ref_" + duplicateIndex + state.dump;
        } else {
          writeFlowMapping(state, level, state.dump);
          if (duplicate)
            state.dump = "&ref_" + duplicateIndex + " " + state.dump;
        }
      else if (type === "[object Array]")
        if (block && state.dump.length !== 0) {
          if (state.noArrayIndent && !isblockseq && level > 0)
            writeBlockSequence(state, level - 1, state.dump, compact);
          else
            writeBlockSequence(state, level, state.dump, compact);
          if (duplicate)
            state.dump = "&ref_" + duplicateIndex + state.dump;
        } else {
          writeFlowSequence(state, level, state.dump);
          if (duplicate)
            state.dump = "&ref_" + duplicateIndex + " " + state.dump;
        }
      else if (type === "[object String]") {
        if (state.tag !== "?")
          writeScalar(state, state.dump, level, iskey, inblock);
      } else if (type === "[object Undefined]")
        return false;
      else {
        if (state.skipInvalid)
          return false;
        throw new YAMLException("unacceptable kind of an object to dump " + type);
      }
      if (state.tag !== null && state.tag !== "?") {
        let tagStr = encodeURI(state.tag[0] === "!" ? state.tag.slice(1) : state.tag).replace(/!/g, "%21");
        if (state.tag[0] === "!")
          tagStr = "!" + tagStr;
        else if (tagStr.slice(0, 18) === "tag:yaml.org,2002:")
          tagStr = "!!" + tagStr.slice(18);
        else
          tagStr = "!<" + tagStr + ">";
        state.dump = tagStr + " " + state.dump;
      }
    }
    return true;
  }
  function getDuplicateReferences(object, state) {
    const objects = [];
    const duplicatesIndexes = [];
    inspectNode(object, objects, duplicatesIndexes);
    const length = duplicatesIndexes.length;
    for (let index = 0;index < length; index += 1)
      state.duplicates.push(objects[duplicatesIndexes[index]]);
    state.usedDuplicates = new Array(length);
  }
  function inspectNode(object, objects, duplicatesIndexes) {
    if (object !== null && typeof object === "object") {
      const index = objects.indexOf(object);
      if (index !== -1) {
        if (duplicatesIndexes.indexOf(index) === -1)
          duplicatesIndexes.push(index);
      } else {
        objects.push(object);
        if (Array.isArray(object))
          for (let i = 0, length = object.length;i < length; i += 1)
            inspectNode(object[i], objects, duplicatesIndexes);
        else {
          const objectKeyList = Object.keys(object);
          for (let i = 0, length = objectKeyList.length;i < length; i += 1)
            inspectNode(object[objectKeyList[i]], objects, duplicatesIndexes);
        }
      }
    }
  }
  function dump(input, options) {
    options = options || {};
    const state = new State(options);
    if (!state.noRefs)
      getDuplicateReferences(input, state);
    let value = input;
    if (state.replacer)
      value = state.replacer.call({ "": value }, "", value);
    if (writeNode(state, 0, value, true, true))
      return state.dump + `
`;
    return "";
  }
  module.exports.dump = dump;
});
var import_js_yaml = /* @__PURE__ */ __toESM((/* @__PURE__ */ __commonJSMin((exports, module) => {
  var loader = require_loader();
  var dumper = require_dumper();
  function renamed(from, to) {
    return function() {
      throw new Error("Function yaml." + from + " is removed in js-yaml 4. Use yaml." + to + " instead, which is now safe by default.");
    };
  }
  module.exports.Type = require_type();
  module.exports.Schema = require_schema();
  module.exports.FAILSAFE_SCHEMA = require_failsafe();
  module.exports.JSON_SCHEMA = require_json();
  module.exports.CORE_SCHEMA = require_core();
  module.exports.DEFAULT_SCHEMA = require_default();
  module.exports.load = loader.load;
  module.exports.loadAll = loader.loadAll;
  module.exports.dump = dumper.dump;
  module.exports.YAMLException = require_exception();
  module.exports.types = {
    binary: require_binary(),
    float: require_float(),
    map: require_map(),
    null: require_null(),
    pairs: require_pairs(),
    set: require_set(),
    timestamp: require_timestamp(),
    bool: require_bool(),
    int: require_int(),
    merge: require_merge(),
    omap: require_omap(),
    seq: require_seq(),
    str: require_str()
  };
  module.exports.safeLoad = renamed("safeLoad", "load");
  module.exports.safeLoadAll = renamed("safeLoadAll", "loadAll");
  module.exports.safeDump = renamed("safeDump", "dump");
}))(), 1);
var { Type, Schema, FAILSAFE_SCHEMA, JSON_SCHEMA, CORE_SCHEMA, DEFAULT_SCHEMA, load, loadAll, dump, YAMLException, types, safeLoad, safeLoadAll, safeDump } = import_js_yaml.default;
var index_vite_proxy_tmp_default = import_js_yaml.default;
// node_modules/.bun/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/impl/scanner.js
var CharacterCodes;
(function(CharacterCodes2) {
  CharacterCodes2[CharacterCodes2["lineFeed"] = 10] = "lineFeed";
  CharacterCodes2[CharacterCodes2["carriageReturn"] = 13] = "carriageReturn";
  CharacterCodes2[CharacterCodes2["space"] = 32] = "space";
  CharacterCodes2[CharacterCodes2["_0"] = 48] = "_0";
  CharacterCodes2[CharacterCodes2["_1"] = 49] = "_1";
  CharacterCodes2[CharacterCodes2["_2"] = 50] = "_2";
  CharacterCodes2[CharacterCodes2["_3"] = 51] = "_3";
  CharacterCodes2[CharacterCodes2["_4"] = 52] = "_4";
  CharacterCodes2[CharacterCodes2["_5"] = 53] = "_5";
  CharacterCodes2[CharacterCodes2["_6"] = 54] = "_6";
  CharacterCodes2[CharacterCodes2["_7"] = 55] = "_7";
  CharacterCodes2[CharacterCodes2["_8"] = 56] = "_8";
  CharacterCodes2[CharacterCodes2["_9"] = 57] = "_9";
  CharacterCodes2[CharacterCodes2["a"] = 97] = "a";
  CharacterCodes2[CharacterCodes2["b"] = 98] = "b";
  CharacterCodes2[CharacterCodes2["c"] = 99] = "c";
  CharacterCodes2[CharacterCodes2["d"] = 100] = "d";
  CharacterCodes2[CharacterCodes2["e"] = 101] = "e";
  CharacterCodes2[CharacterCodes2["f"] = 102] = "f";
  CharacterCodes2[CharacterCodes2["g"] = 103] = "g";
  CharacterCodes2[CharacterCodes2["h"] = 104] = "h";
  CharacterCodes2[CharacterCodes2["i"] = 105] = "i";
  CharacterCodes2[CharacterCodes2["j"] = 106] = "j";
  CharacterCodes2[CharacterCodes2["k"] = 107] = "k";
  CharacterCodes2[CharacterCodes2["l"] = 108] = "l";
  CharacterCodes2[CharacterCodes2["m"] = 109] = "m";
  CharacterCodes2[CharacterCodes2["n"] = 110] = "n";
  CharacterCodes2[CharacterCodes2["o"] = 111] = "o";
  CharacterCodes2[CharacterCodes2["p"] = 112] = "p";
  CharacterCodes2[CharacterCodes2["q"] = 113] = "q";
  CharacterCodes2[CharacterCodes2["r"] = 114] = "r";
  CharacterCodes2[CharacterCodes2["s"] = 115] = "s";
  CharacterCodes2[CharacterCodes2["t"] = 116] = "t";
  CharacterCodes2[CharacterCodes2["u"] = 117] = "u";
  CharacterCodes2[CharacterCodes2["v"] = 118] = "v";
  CharacterCodes2[CharacterCodes2["w"] = 119] = "w";
  CharacterCodes2[CharacterCodes2["x"] = 120] = "x";
  CharacterCodes2[CharacterCodes2["y"] = 121] = "y";
  CharacterCodes2[CharacterCodes2["z"] = 122] = "z";
  CharacterCodes2[CharacterCodes2["A"] = 65] = "A";
  CharacterCodes2[CharacterCodes2["B"] = 66] = "B";
  CharacterCodes2[CharacterCodes2["C"] = 67] = "C";
  CharacterCodes2[CharacterCodes2["D"] = 68] = "D";
  CharacterCodes2[CharacterCodes2["E"] = 69] = "E";
  CharacterCodes2[CharacterCodes2["F"] = 70] = "F";
  CharacterCodes2[CharacterCodes2["G"] = 71] = "G";
  CharacterCodes2[CharacterCodes2["H"] = 72] = "H";
  CharacterCodes2[CharacterCodes2["I"] = 73] = "I";
  CharacterCodes2[CharacterCodes2["J"] = 74] = "J";
  CharacterCodes2[CharacterCodes2["K"] = 75] = "K";
  CharacterCodes2[CharacterCodes2["L"] = 76] = "L";
  CharacterCodes2[CharacterCodes2["M"] = 77] = "M";
  CharacterCodes2[CharacterCodes2["N"] = 78] = "N";
  CharacterCodes2[CharacterCodes2["O"] = 79] = "O";
  CharacterCodes2[CharacterCodes2["P"] = 80] = "P";
  CharacterCodes2[CharacterCodes2["Q"] = 81] = "Q";
  CharacterCodes2[CharacterCodes2["R"] = 82] = "R";
  CharacterCodes2[CharacterCodes2["S"] = 83] = "S";
  CharacterCodes2[CharacterCodes2["T"] = 84] = "T";
  CharacterCodes2[CharacterCodes2["U"] = 85] = "U";
  CharacterCodes2[CharacterCodes2["V"] = 86] = "V";
  CharacterCodes2[CharacterCodes2["W"] = 87] = "W";
  CharacterCodes2[CharacterCodes2["X"] = 88] = "X";
  CharacterCodes2[CharacterCodes2["Y"] = 89] = "Y";
  CharacterCodes2[CharacterCodes2["Z"] = 90] = "Z";
  CharacterCodes2[CharacterCodes2["asterisk"] = 42] = "asterisk";
  CharacterCodes2[CharacterCodes2["backslash"] = 92] = "backslash";
  CharacterCodes2[CharacterCodes2["closeBrace"] = 125] = "closeBrace";
  CharacterCodes2[CharacterCodes2["closeBracket"] = 93] = "closeBracket";
  CharacterCodes2[CharacterCodes2["colon"] = 58] = "colon";
  CharacterCodes2[CharacterCodes2["comma"] = 44] = "comma";
  CharacterCodes2[CharacterCodes2["dot"] = 46] = "dot";
  CharacterCodes2[CharacterCodes2["doubleQuote"] = 34] = "doubleQuote";
  CharacterCodes2[CharacterCodes2["minus"] = 45] = "minus";
  CharacterCodes2[CharacterCodes2["openBrace"] = 123] = "openBrace";
  CharacterCodes2[CharacterCodes2["openBracket"] = 91] = "openBracket";
  CharacterCodes2[CharacterCodes2["plus"] = 43] = "plus";
  CharacterCodes2[CharacterCodes2["slash"] = 47] = "slash";
  CharacterCodes2[CharacterCodes2["formFeed"] = 12] = "formFeed";
  CharacterCodes2[CharacterCodes2["tab"] = 9] = "tab";
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
(function(ParseOptions2) {
  ParseOptions2.DEFAULT = {
    allowTrailingComma: false
  };
})(ParseOptions || (ParseOptions = {}));

// node_modules/.bun/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/main.js
var ScanError;
(function(ScanError2) {
  ScanError2[ScanError2["None"] = 0] = "None";
  ScanError2[ScanError2["UnexpectedEndOfComment"] = 1] = "UnexpectedEndOfComment";
  ScanError2[ScanError2["UnexpectedEndOfString"] = 2] = "UnexpectedEndOfString";
  ScanError2[ScanError2["UnexpectedEndOfNumber"] = 3] = "UnexpectedEndOfNumber";
  ScanError2[ScanError2["InvalidUnicode"] = 4] = "InvalidUnicode";
  ScanError2[ScanError2["InvalidEscapeCharacter"] = 5] = "InvalidEscapeCharacter";
  ScanError2[ScanError2["InvalidCharacter"] = 6] = "InvalidCharacter";
})(ScanError || (ScanError = {}));
var SyntaxKind;
(function(SyntaxKind2) {
  SyntaxKind2[SyntaxKind2["OpenBraceToken"] = 1] = "OpenBraceToken";
  SyntaxKind2[SyntaxKind2["CloseBraceToken"] = 2] = "CloseBraceToken";
  SyntaxKind2[SyntaxKind2["OpenBracketToken"] = 3] = "OpenBracketToken";
  SyntaxKind2[SyntaxKind2["CloseBracketToken"] = 4] = "CloseBracketToken";
  SyntaxKind2[SyntaxKind2["CommaToken"] = 5] = "CommaToken";
  SyntaxKind2[SyntaxKind2["ColonToken"] = 6] = "ColonToken";
  SyntaxKind2[SyntaxKind2["NullKeyword"] = 7] = "NullKeyword";
  SyntaxKind2[SyntaxKind2["TrueKeyword"] = 8] = "TrueKeyword";
  SyntaxKind2[SyntaxKind2["FalseKeyword"] = 9] = "FalseKeyword";
  SyntaxKind2[SyntaxKind2["StringLiteral"] = 10] = "StringLiteral";
  SyntaxKind2[SyntaxKind2["NumericLiteral"] = 11] = "NumericLiteral";
  SyntaxKind2[SyntaxKind2["LineCommentTrivia"] = 12] = "LineCommentTrivia";
  SyntaxKind2[SyntaxKind2["BlockCommentTrivia"] = 13] = "BlockCommentTrivia";
  SyntaxKind2[SyntaxKind2["LineBreakTrivia"] = 14] = "LineBreakTrivia";
  SyntaxKind2[SyntaxKind2["Trivia"] = 15] = "Trivia";
  SyntaxKind2[SyntaxKind2["Unknown"] = 16] = "Unknown";
  SyntaxKind2[SyntaxKind2["EOF"] = 17] = "EOF";
})(SyntaxKind || (SyntaxKind = {}));
var ParseErrorCode;
(function(ParseErrorCode2) {
  ParseErrorCode2[ParseErrorCode2["InvalidSymbol"] = 1] = "InvalidSymbol";
  ParseErrorCode2[ParseErrorCode2["InvalidNumberFormat"] = 2] = "InvalidNumberFormat";
  ParseErrorCode2[ParseErrorCode2["PropertyNameExpected"] = 3] = "PropertyNameExpected";
  ParseErrorCode2[ParseErrorCode2["ValueExpected"] = 4] = "ValueExpected";
  ParseErrorCode2[ParseErrorCode2["ColonExpected"] = 5] = "ColonExpected";
  ParseErrorCode2[ParseErrorCode2["CommaExpected"] = 6] = "CommaExpected";
  ParseErrorCode2[ParseErrorCode2["CloseBraceExpected"] = 7] = "CloseBraceExpected";
  ParseErrorCode2[ParseErrorCode2["CloseBracketExpected"] = 8] = "CloseBracketExpected";
  ParseErrorCode2[ParseErrorCode2["EndOfFileExpected"] = 9] = "EndOfFileExpected";
  ParseErrorCode2[ParseErrorCode2["InvalidCommentToken"] = 10] = "InvalidCommentToken";
  ParseErrorCode2[ParseErrorCode2["UnexpectedEndOfComment"] = 11] = "UnexpectedEndOfComment";
  ParseErrorCode2[ParseErrorCode2["UnexpectedEndOfString"] = 12] = "UnexpectedEndOfString";
  ParseErrorCode2[ParseErrorCode2["UnexpectedEndOfNumber"] = 13] = "UnexpectedEndOfNumber";
  ParseErrorCode2[ParseErrorCode2["InvalidUnicode"] = 14] = "InvalidUnicode";
  ParseErrorCode2[ParseErrorCode2["InvalidEscapeCharacter"] = 15] = "InvalidEscapeCharacter";
  ParseErrorCode2[ParseErrorCode2["InvalidCharacter"] = 16] = "InvalidCharacter";
})(ParseErrorCode || (ParseErrorCode = {}));

// packages/utils/src/jsonc-parser.ts
var pluginConfigFileDetectionCache = new Map;

// packages/utils/src/index.ts
init_xdg_data_dir();
init_atomic_write();

// packages/utils/src/logging/logger.ts
var DEFAULT_MAX_LOG_FILE_SIZE_BYTES = 50 * 1024 * 1024;
// packages/utils/src/logger.ts
var sharedSubunitLogger = () => {};
function log(message, data) {
  sharedSubunitLogger(message, data);
}
// packages/utils/src/omo-config.ts
var HARNESS_IDS = ["codex", "opencode", "omo"];
// packages/utils/src/omo-config/loader.ts
var HARNESS_BLOCK_KEYS = HARNESS_IDS.map((harness) => `[${harness}]`);
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
import { spawn as spawn3 } from "node:child_process";
import { existsSync as existsSync4 } from "node:fs";
import { join as join27 } from "node:path";
var AST_GREP_BIN_DIR_ENV_KEY = "OMO_AST_GREP_BIN_DIR";
var AST_GREP_INSTALL_TIMEOUT_MS = 30000;
function astGrepRuntimeDir(baseDir, platform = process.platform, arch = process.arch) {
  return join27(baseDir, "runtime", "ast-grep", runtimeSlug(platform, arch));
}
function isMissingExecutable(error) {
  if (!("code" in error))
    return false;
  return error.code === "ENOENT";
}
function defaultSpawnProcess(command, args, options) {
  const child = spawn3(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: "ignore",
    windowsHide: true
  });
  let settled = false;
  const outcome = new Promise((resolve8) => {
    const settle = (result) => {
      if (settled)
        return;
      settled = true;
      resolve8(result);
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
  return join27(skillDir, platform === "win32" ? "install.ps1" : "install.sh");
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
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, input.timeoutMs);
  timeout.unref?.();
  try {
    const outcome = await child.outcome;
    return timedOut ? { kind: "timed-out" } : outcome;
  } finally {
    clearTimeout(timeout);
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
// packages/utils/src/codegraph/provision.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
var execFileAsync = promisify(execFile);
// packages/utils/src/command-executor/execute-command.ts
import { exec } from "node:child_process";
import { promisify as promisify2 } from "node:util";
var execAsync = promisify2(exec);
// packages/utils/src/internal-initiator-marker.ts
var INTERNAL_INITIATOR_MARKER_DETECT_PATTERN = /<!--\s*OMO_INTERNAL_INITIATOR\s*-->/;
var INTERNAL_NOREPLY_MARKER_DETECT_PATTERN = /<!--\s*OMO_INTERNAL_NOREPLY\s*-->/;
function hasInternalInitiatorMarker(text) {
  return INTERNAL_INITIATOR_MARKER_DETECT_PATTERN.test(text);
}
function hasInternalNoReplyMarker(text) {
  return INTERNAL_NOREPLY_MARKER_DETECT_PATTERN.test(text);
}
function isTextPartLike(part) {
  return part.type === "text" && typeof part.text === "string";
}
function isSyntheticOrInternalTextPart(part) {
  return isTextPartLike(part) && (part.synthetic === true || hasInternalInitiatorMarker(part.text));
}
function isSyntheticOrInternalOnlyTextParts(parts) {
  const textParts = (parts ?? []).filter(isTextPartLike);
  return textParts.length > 0 && textParts.every(isSyntheticOrInternalTextPart);
}
function isSyntheticOrInternalUserMessage(message) {
  const role = message.info?.role ?? message.role;
  return role === "user" && isSyntheticOrInternalOnlyTextParts(message.parts);
}
function isNoReplyTextPart(part) {
  return isTextPartLike(part) && hasInternalNoReplyMarker(part.text);
}
function isTerminalNoReplyUserMessage(message) {
  const role = message.info?.role ?? message.role;
  if (role !== "user") {
    return false;
  }
  const textParts = (message.parts ?? []).filter(isTextPartLike);
  return textParts.some(isNoReplyTextPart);
}
// packages/utils/src/migration/agent-names.ts
var BUILTIN_AGENT_NAMES = new Set([
  "sisyphus",
  "oracle",
  "librarian",
  "explore",
  "multimodal-looker",
  "metis",
  "momus",
  "prometheus",
  "atlas",
  "build"
]);
// packages/utils/src/migration/model-versions.ts
var CURRENT_USER_SELECTABLE_MODELS = new Set([
  "anthropic/claude-opus-4-5",
  "anthropic/claude-opus-4-6",
  "anthropic/claude-sonnet-4-5"
]);
// packages/utils/src/write-file-atomically.ts
init_atomic_write();
// packages/utils/src/session-idle-settle.ts
var DEFAULT_SESSION_IDLE_SETTLE_MS = 150;
var DEFAULT_SESSION_STATUS_TIMEOUT_MS = 5000;
function settleAfterSessionIdle(ms = DEFAULT_SESSION_IDLE_SETTLE_MS) {
  return ms > 0 ? new Promise((resolve9) => setTimeout(resolve9, ms)) : Promise.resolve();
}
function withStatusTimeout(promise, timeoutMs) {
  let timeoutID;
  const timeoutPromise = new Promise((_resolve, reject) => {
    timeoutID = setTimeout(() => {
      reject(new Error(`session.status() timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutID !== undefined) {
      clearTimeout(timeoutID);
    }
  });
}
var ACTIVE_SESSION_STATUSES = new Set(["busy", "retry", "running"]);
function getSessionStatusPayload(response) {
  if (isRecord(response) && isRecord(response.data)) {
    return response.data;
  }
  if (isRecord(response)) {
    return response;
  }
  return {};
}
function isActiveSessionStatusType(statusType) {
  return ACTIVE_SESSION_STATUSES.has(statusType);
}
async function isSessionActive(client, sessionID, statusTimeoutMs = DEFAULT_SESSION_STATUS_TIMEOUT_MS) {
  if (typeof client.session?.status !== "function") {
    return false;
  }
  try {
    const statusResult = await withStatusTimeout(client.session.status(), statusTimeoutMs);
    const status = getSessionStatusPayload(statusResult)[sessionID];
    if (!isRecord(status)) {
      return false;
    }
    const statusType = status.type;
    return typeof statusType === "string" && isActiveSessionStatusType(statusType);
  } catch (error) {
    if (error instanceof Error) {
      return false;
    }
    return false;
  }
}

// packages/utils/src/prompt-async-gate/prompt-message-state.ts
function messageRole(message) {
  if (!isRecord(message)) {
    return;
  }
  const info = message.info;
  if (isRecord(info) && typeof info.role === "string") {
    return info.role;
  }
  return typeof message.role === "string" ? message.role : undefined;
}
function messageFinish(message) {
  if (!isRecord(message)) {
    return;
  }
  const info = message.info;
  if (isRecord(info)) {
    if (info.finish === true) {
      return true;
    }
    if (typeof info.finish === "string" && info.finish.length > 0) {
      return info.finish;
    }
  }
  if (message.finish === true) {
    return true;
  }
  return typeof message.finish === "string" && message.finish.length > 0 ? message.finish : undefined;
}
function messageCompleted(message) {
  if (!isRecord(message)) {
    return false;
  }
  const info = message.info;
  const time = isRecord(info) && isRecord(info.time) ? info.time : undefined;
  const completed = time?.completed;
  if (typeof completed === "number" && Number.isFinite(completed)) {
    return true;
  }
  return typeof completed === "string" && completed.length > 0;
}
function messageHasTerminalError(message) {
  if (!isRecord(message)) {
    return false;
  }
  const info = message.info;
  if (isRecord(info) && info.error !== undefined && info.error !== null) {
    return true;
  }
  return message.error !== undefined && message.error !== null;
}
function toInternalInitiatorTextPartLike(part) {
  const result = {};
  if (!isRecord(part)) {
    return result;
  }
  if (typeof part.type === "string") {
    result.type = part.type;
  }
  if (typeof part.text === "string") {
    result.text = part.text;
  }
  if (typeof part.synthetic === "boolean") {
    result.synthetic = part.synthetic;
  }
  return result;
}
function toInternalInitiatorMessageLike(message) {
  if (!isRecord(message)) {
    return;
  }
  const result = {};
  const info = message.info;
  if (isRecord(info) && typeof info.role === "string") {
    result.info = { role: info.role };
  }
  if (typeof message.role === "string") {
    result.role = message.role;
  }
  if (Array.isArray(message.parts)) {
    result.parts = message.parts.map(toInternalInitiatorTextPartLike);
  }
  return result;
}
function messageIsSyntheticOrInternalUser(message) {
  const initiatorMessage = toInternalInitiatorMessageLike(message);
  return initiatorMessage !== undefined && isSyntheticOrInternalUserMessage(initiatorMessage);
}
function messageIsTerminalNoReplyUser(message) {
  const initiatorMessage = toInternalInitiatorMessageLike(message);
  return initiatorMessage !== undefined && isTerminalNoReplyUserMessage(initiatorMessage);
}
var QUESTION_TOOL_NAMES = new Set(["question", "ask_user_question", "askuserquestion"]);
function partToolName(part) {
  if (typeof part.name === "string") {
    return part.name;
  }
  if (typeof part.tool === "string") {
    return part.tool;
  }
  return typeof part.toolName === "string" ? part.toolName : undefined;
}
function partIsToolCall(part) {
  return part.type === "tool" || part.type === "tool_use" || part.type === "tool-call" || part.type === "tool-invocation";
}
function partIsQuestionTool(part) {
  if (!isRecord(part) || !partIsToolCall(part)) {
    return false;
  }
  const toolName = partToolName(part);
  return toolName !== undefined && QUESTION_TOOL_NAMES.has(toolName.toLowerCase());
}
function partIsUnansweredQuestionTool(part) {
  if (!partIsQuestionTool(part) || !isRecord(part)) {
    return false;
  }
  const state = part.state;
  if (!isRecord(state)) {
    return true;
  }
  return state.status !== "completed";
}
function partIsWaitingOnTool(part) {
  if (!isRecord(part)) {
    return false;
  }
  if (!partIsToolCall(part)) {
    return false;
  }
  const state = part.state;
  if (!isRecord(state)) {
    return false;
  }
  return state.status === "pending" || state.status === "running";
}
function partIsUnresolvedTool(part) {
  if (!isRecord(part) || !partIsToolCall(part)) {
    return false;
  }
  const state = part.state;
  if (!isRecord(state)) {
    return true;
  }
  return state.status !== "completed";
}
function partHasSubstantiveAssistantOutput(part) {
  if (!isRecord(part)) {
    return false;
  }
  if (part.type === "step-start" || part.type === "step-finish") {
    return false;
  }
  if (part.type === "text") {
    return typeof part.text === "string" && part.text.trim().length > 0;
  }
  return typeof part.type === "string" && part.type.length > 0;
}
function messageHasQuestionTool(message) {
  return isRecord(message) && Array.isArray(message.parts) && message.parts.some(partIsUnansweredQuestionTool);
}
function messageHasWaitingTool(message) {
  return isRecord(message) && Array.isArray(message.parts) && message.parts.some(partIsWaitingOnTool);
}
function messageHasUnresolvedTool(message) {
  return isRecord(message) && Array.isArray(message.parts) && message.parts.some(partIsUnresolvedTool);
}
function messageHasSubstantiveAssistantOutput(message) {
  return isRecord(message) && Array.isArray(message.parts) && message.parts.some(partHasSubstantiveAssistantOutput);
}

// packages/utils/src/prompt-async-gate/message-inspection-error.ts
function isPromptMessageInspectionAborted(error) {
  if (error instanceof Error && error.name === "MessageAbortedError") {
    return true;
  }
  return isRecord(error) && error.name === "MessageAbortedError";
}

// packages/utils/src/prompt-async-gate/timing.ts
var DEFAULT_PROMPT_GATE_MESSAGES_FETCH_TIMEOUT_MS = 5000;
var promptGateMessagesFetchTimeoutMsForTesting;
function getPromptGateMessagesFetchTimeoutMs() {
  return promptGateMessagesFetchTimeoutMsForTesting ?? DEFAULT_PROMPT_GATE_MESSAGES_FETCH_TIMEOUT_MS;
}
async function withDispatchTimeout(operation, dispatchTimeoutMs, operationName) {
  if (dispatchTimeoutMs <= 0) {
    return operation;
  }
  let timeoutID;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutID = setTimeout(() => {
      reject(new Error(`${operationName} timed out after ${dispatchTimeoutMs}ms`));
    }, dispatchTimeoutMs);
  });
  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    if (timeoutID !== undefined) {
      clearTimeout(timeoutID);
    }
  }
}

// packages/utils/src/prompt-async-gate/pending-tool-turn.ts
function getPromptQuery(input) {
  if (!isRecord(input)) {
    return { directory: "" };
  }
  const query = input.query;
  if (!isRecord(query)) {
    return { directory: "" };
  }
  const promptQuery = { directory: "" };
  if (typeof query.directory === "string") {
    return typeof query.limit === "number" ? { directory: query.directory, limit: query.limit } : { directory: query.directory };
  }
  if (typeof query.limit === "number") {
    return { ...promptQuery, limit: query.limit };
  }
  return promptQuery;
}
function getMessagesData(response) {
  if (isRecord(response) && Array.isArray(response.data)) {
    return response.data;
  }
  return Array.isArray(response) ? response : [];
}
function latestAssistantTurnBlocksInternalPrompt(messages) {
  let sawAssistantAfterLatestUser = false;
  for (let index = messages.length - 1;index >= 0; index--) {
    const message = messages[index];
    const role = messageRole(message);
    if (role === "assistant") {
      sawAssistantAfterLatestUser = true;
      if (messageHasQuestionTool(message)) {
        return true;
      }
      const finish = messageFinish(message);
      if (finish === "tool-calls") {
        return !isRecord(message) || !Array.isArray(message.parts) || messageHasUnresolvedTool(message);
      }
      if ((finish === undefined || finish === "unknown") && !messageHasSubstantiveAssistantOutput(message)) {
        return !(messageCompleted(message) && messageHasTerminalError(message));
      }
      if (messageCompleted(message)) {
        return false;
      }
      if (finish === true) {
        return false;
      }
      if (finish === undefined || finish === "unknown") {
        return true;
      }
      if (!isRecord(message) || !Array.isArray(message.parts)) {
        return finish === "tool-calls";
      }
      return messageHasWaitingTool(message);
    }
    if (role === "user") {
      if (messageIsSyntheticOrInternalUser(message)) {
        if (messageIsTerminalNoReplyUser(message)) {
          continue;
        }
        if (!sawAssistantAfterLatestUser) {
          return true;
        }
        continue;
      }
      return false;
    }
  }
  return false;
}
async function sessionLatestAssistantBlocksInternalPrompt(args) {
  const session = args.client.session;
  if (typeof session?.messages !== "function") {
    return false;
  }
  const messages = session.messages.bind(session);
  try {
    const response = await withDispatchTimeout(messages({
      path: { id: args.sessionID },
      query: getPromptQuery(args.input)
    }), args.timeoutMs, `[prompt-async-gate] ${args.sessionName} session.messages`);
    return latestAssistantTurnBlocksInternalPrompt(getMessagesData(response));
  } catch (error) {
    log("[prompt-async-gate] latest assistant prompt-block check failed", {
      sessionID: args.sessionID,
      source: args.source,
      error: String(error)
    });
    return !isPromptMessageInspectionAborted(error);
  }
}

// packages/utils/src/prompt-async-gate/recent-dispatches.ts
var recentPromptDispatches = new Map;
function recentDispatchKey(sessionID, dedupeKey) {
  return `${sessionID}\x00${dedupeKey}`;
}
function pruneRecentPromptDispatches(now = Date.now()) {
  for (const [key, dispatch] of recentPromptDispatches) {
    if (dispatch.expiresAt <= now) {
      recentPromptDispatches.delete(key);
    }
  }
}
function rememberRecentPromptDispatch(args) {
  pruneRecentPromptDispatches();
  if (args.holdMs <= 0) {
    return;
  }
  recentPromptDispatches.set(recentDispatchKey(args.sessionID, args.dedupeKey), {
    source: args.source,
    expiresAt: Date.now() + args.holdMs
  });
  log("[prompt-async-gate] remembered semantic prompt dispatch", {
    sessionID: args.sessionID,
    source: args.source,
    holdMs: args.holdMs
  });
}

// packages/utils/src/prompt-async-gate/reservations.ts
var promptAsyncReservations = new Map;
var expiredReservationHandler;
function setExpiredReservationHandler(handler) {
  expiredReservationHandler = handler;
}
function notifyExpiredReservation(sessionID) {
  expiredReservationHandler?.(sessionID);
}
function pruneExpiredReservations(now = Date.now()) {
  const expiredSessionIDs = [];
  for (const [sessionID, reservation] of promptAsyncReservations) {
    if (typeof reservation.expiresAt === "number" && reservation.expiresAt <= now) {
      promptAsyncReservations.delete(sessionID);
      expiredSessionIDs.push(sessionID);
      log("[prompt-async-gate] expired reservation released", {
        sessionID,
        source: reservation.source
      });
    }
  }
  for (const sessionID of expiredSessionIDs) {
    notifyExpiredReservation(sessionID);
  }
}
function getActiveReservation(sessionID) {
  pruneExpiredReservations();
  return promptAsyncReservations.get(sessionID);
}
function setPromptReservation(sessionID, reservation) {
  promptAsyncReservations.set(sessionID, reservation);
}
function finishPromptReservation(sessionID, reservation, dispatchAttempted, postDispatchHoldMs) {
  const current = promptAsyncReservations.get(sessionID);
  if (current?.token !== reservation.token) {
    return;
  }
  if (dispatchAttempted && postDispatchHoldMs > 0) {
    promptAsyncReservations.set(sessionID, {
      ...reservation,
      expiresAt: Date.now() + postDispatchHoldMs
    });
    return;
  }
  promptAsyncReservations.delete(sessionID);
}

// packages/utils/src/prompt-async-gate/session-idle-dispatch.ts
async function dispatchAfterSessionIdle(args) {
  const {
    sessionName,
    client,
    sessionID,
    input,
    source,
    dedupeKey,
    settleMs,
    postDispatchHoldMs,
    semanticDedupeHoldMs,
    dispatchTimeoutMs,
    checkStatus,
    checkToolState,
    dispatch
  } = args;
  const existing = getActiveReservation(sessionID);
  if (existing) {
    log(`[prompt-async-gate] ${sessionName} skipped because session is reserved`, {
      sessionID,
      source,
      reservedBy: existing.source,
      reservedAgeMs: Date.now() - existing.reservedAt
    });
    return { status: "reserved", reservedBy: existing.source };
  }
  const reservation = {
    source,
    dedupeKey,
    reservedAt: Date.now(),
    token: Symbol(source)
  };
  setPromptReservation(sessionID, reservation);
  let dispatchAttempted = false;
  try {
    const canReadStatus = checkStatus && typeof client.session?.status === "function";
    if (settleMs > 0) {
      await settleAfterSessionIdle(settleMs);
    }
    let sessionActive = false;
    if (canReadStatus) {
      try {
        sessionActive = await withDispatchTimeout(isSessionActive(client, sessionID), Math.min(dispatchTimeoutMs, 5000), `[prompt-async-gate] ${sessionName} isSessionActive`);
      } catch (error) {
        if (error instanceof Error) {
          sessionActive = false;
        }
        sessionActive = false;
      }
    }
    if (sessionActive) {
      log(`[prompt-async-gate] ${sessionName} skipped because session is active`, { sessionID, source });
      return { status: "active" };
    }
    if (checkToolState && typeof client.session?.messages === "function" && await sessionLatestAssistantBlocksInternalPrompt({
      client,
      sessionID,
      input,
      sessionName,
      source,
      timeoutMs: Math.min(dispatchTimeoutMs, getPromptGateMessagesFetchTimeoutMs())
    })) {
      log(`[prompt-async-gate] ${sessionName} skipped because latest assistant is still active`, {
        sessionID,
        source
      });
      return { status: "active" };
    }
    log(`[prompt-async-gate] ${sessionName} dispatching`, { sessionID, source });
    dispatchAttempted = true;
    const response = await withDispatchTimeout(dispatch(input), dispatchTimeoutMs, `[prompt-async-gate] ${sessionName} dispatch`);
    rememberRecentPromptDispatch({
      sessionID,
      dedupeKey,
      source,
      holdMs: semanticDedupeHoldMs
    });
    log(`[prompt-async-gate] ${sessionName} dispatched`, { sessionID, source });
    return { status: "dispatched", response };
  } catch (error) {
    if (dispatchAttempted) {
      rememberRecentPromptDispatch({
        sessionID,
        dedupeKey,
        source,
        holdMs: semanticDedupeHoldMs
      });
    }
    const errorText = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    log(`[prompt-async-gate] ${sessionName} failed`, { sessionID, source, error: errorText });
    return { status: "failed", error, dispatchAttempted };
  } finally {
    finishPromptReservation(sessionID, reservation, dispatchAttempted, postDispatchHoldMs);
  }
}

// packages/utils/src/prompt-async-gate/queue.ts
var promptQueues = new Map;
var promptQueueDraining = new Set;
var promptQueueInFlight = new Map;
var promptQueueTimers = new Map;
setExpiredReservationHandler((sessionID) => {
  schedulePromptQueueDrain(sessionID, 0);
});
function setPromptQueue(sessionID, queue) {
  if (queue.length === 0) {
    promptQueues.delete(sessionID);
    return;
  }
  promptQueues.set(sessionID, queue);
}
function queuedResult(entry, position, queuedBy = entry.source) {
  return {
    status: "queued",
    queuedBy,
    position
  };
}
function clearPromptQueueTimer(sessionID) {
  const timer = promptQueueTimers.get(sessionID);
  if (timer !== undefined) {
    clearTimeout(timer);
    promptQueueTimers.delete(sessionID);
  }
}
function schedulePromptQueueDrain(sessionID, delayMs) {
  const queue = promptQueues.get(sessionID);
  if (!queue || queue.length === 0) {
    clearPromptQueueTimer(sessionID);
    return;
  }
  clearPromptQueueTimer(sessionID);
  const timer = setTimeout(() => {
    promptQueueTimers.delete(sessionID);
    drainPromptQueue(sessionID).catch((error) => {
      log("[prompt-async-gate] queued prompt drain failed", {
        sessionID,
        error: String(error)
      });
    });
  }, Math.max(0, delayMs));
  promptQueueTimers.set(sessionID, timer);
}
function removePromptQueueEntry(sessionID, entry) {
  const queue = promptQueues.get(sessionID);
  if (!queue) {
    return;
  }
  const nextQueue = queue.filter((queued) => queued.id !== entry.id);
  setPromptQueue(sessionID, nextQueue);
}
async function drainPromptQueue(sessionID, awaitedEntry) {
  if (promptQueueDraining.has(sessionID)) {
    return awaitedEntry ? queuedResult(awaitedEntry, 1) : undefined;
  }
  promptQueueDraining.add(sessionID);
  clearPromptQueueTimer(sessionID);
  let awaitedResult;
  try {
    while (true) {
      const queue = promptQueues.get(sessionID);
      const entry = queue?.[0];
      if (!entry) {
        break;
      }
      promptQueueInFlight.set(sessionID, entry);
      const result = await dispatchAfterSessionIdle({
        sessionName: entry.sessionName,
        client: entry.client,
        sessionID: entry.sessionID,
        input: entry.input,
        source: entry.source,
        dedupeKey: entry.dedupeKey,
        settleMs: entry.settleMs,
        postDispatchHoldMs: entry.postDispatchHoldMs,
        semanticDedupeHoldMs: entry.semanticDedupeHoldMs,
        dispatchTimeoutMs: entry.dispatchTimeoutMs,
        checkStatus: entry.checkStatus,
        checkToolState: entry.checkToolState,
        dispatch: entry.dispatch
      });
      if (promptQueueInFlight.get(sessionID)?.id === entry.id) {
        promptQueueInFlight.delete(sessionID);
      }
      if (result.status === "active" || result.status === "reserved") {
        const queued = queuedResult(entry, 1, result.status === "reserved" ? result.reservedBy : entry.source);
        if (awaitedEntry?.id === entry.id) {
          awaitedResult = queued;
        }
        schedulePromptQueueDrain(sessionID, entry.queueRetryMs);
        break;
      }
      removePromptQueueEntry(sessionID, entry);
      if (awaitedEntry?.id === entry.id) {
        awaitedResult = result;
      }
      const remainingQueue = promptQueues.get(sessionID);
      if (!remainingQueue || remainingQueue.length === 0) {
        break;
      }
      schedulePromptQueueDrain(sessionID, entry.postDispatchHoldMs);
      break;
    }
  } finally {
    promptQueueDraining.delete(sessionID);
  }
  return awaitedResult;
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
  const skillDir = join28(plugin.path, "skills", "ast-grep");
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
    const { createInstallPostHog: createInstallPostHog2, getPostHogDistinctId: getPostHogDistinctId2 } = await Promise.resolve().then(() => (init_telemetry(), exports_telemetry));
    const posthog = createInstallPostHog2();
    posthog.trackActive(getPostHogDistinctId2(), "install_completed");
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
  const env3 = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const repoRoot = resolve10(options.repoRoot ?? findRepoRoot({ importerDir: import.meta.dir, env: env3 }));
  const codexHome = resolve10(options.codexHome ?? env3.CODEX_HOME ?? join31(homedir2(), ".codex"));
  const projectDirectory = resolve10(options.projectDirectory ?? env3.OMO_CODEX_PROJECT ?? process.cwd());
  const binDir = resolveCodexInstallerBinDir({ binDir: options.binDir, codexHome, env: env3 });
  const runCommand = options.runCommand ?? defaultRunCommand;
  const log2 = options.log ?? (() => {
    return;
  });
  const buildSource = await shouldBuildSourcePackages(repoRoot);
  const gitBashResolution = await prepareGitBashForInstall({
    platform,
    env: env3,
    cwd: repoRoot,
    runCommand,
    resolveGitBash: platform === "win32" ? options.gitBashResolver ?? (() => resolveGitBashForCurrentProcess2({ platform, env: env3 })) : undefined
  });
  if (!gitBashResolution.found) {
    throw new Error(gitBashResolution.installHint);
  }
  const codexPackageRoot = join31(repoRoot, "packages", "omo-codex");
  const marketplace = await readMarketplace(repoRoot, {
    marketplacePath: join31(codexPackageRoot, "marketplace.json")
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
    const version2 = resolveLazyCodexPluginVersion({
      manifestVersion: manifest.version,
      marketplaceName: marketplace.name,
      pluginName: entry.name,
      distributionManifest
    });
    validatePathSegment(version2, "plugin version");
    log2(`Building ${entry.name}@${version2}`);
    const plugin = await installCachedPlugin({
      buildSource,
      codexHome,
      marketplaceName: marketplace.name,
      name: entry.name,
      runCommand,
      sourcePath,
      version: version2
    });
    if (marketplace.name === "sisyphuslabs" && plugin.name === "omo") {
      await stampLazyCodexPluginVersion({ pluginRoot: plugin.path, version: version2 });
      await writeLazyCodexInstallSnapshot({ pluginRoot: plugin.path, distributionManifest });
    }
    const links = await linkCachedPluginBins({ binDir, pluginRoot: plugin.path, platform });
    for (const link of links) {
      log2(`Linked ${link.name} -> ${link.target}`);
    }
    if (marketplace.name === "sisyphuslabs" && plugin.name === "omo") {
      const runtimeLink = await linkRootRuntimeBin({ binDir, codexHome, repoRoot, platform });
      if (runtimeLink !== null)
        log2(`Linked ${runtimeLink.name} -> ${runtimeLink.target}`);
      else
        log2(`Warning: skipped the omo runtime wrapper because ${join31(repoRoot, "dist", "cli", "index.js")} is missing; omo sparkshell/ulw-loop commands will be unavailable until a package shipping dist/cli is installed`);
    }
    pluginSources.push({ name: entry.name, sourcePath });
    installed.push(plugin);
  }
  await installAstGrepForCodex({
    codexHome,
    installed,
    installer: options.astGrepInstaller,
    log: log2,
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
  for (const plugin of installed) {
    const pluginRoot = agentSourceRoots.get(plugin.name) ?? plugin.path;
    const agentLinks = await linkCachedPluginAgents({
      codexHome,
      pluginRoot,
      platform,
      preservedReasoning,
      preservedServiceTier
    });
    for (const link of agentLinks) {
      log2(`Linked agent ${link.name} -> ${link.target}`);
      const agentName = agentNameFromToml2(link.name);
      agentConfigs.set(agentName, { name: agentName, configFile: `./agents/${link.name}` });
    }
  }
  const trustedHookStates = (await Promise.all(installed.map((plugin) => trustedHookStatesForPlugin({
    marketplaceName: marketplace.name,
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
  await reapLspDaemons(codexHome).catch(() => []);
  const marketplaceRoot = join31(codexHome, "plugins", "cache", marketplace.name);
  await writeCachedMarketplaceManifest({
    marketplaceName: marketplace.name,
    marketplaceRoot,
    plugins: installed
  });
  const configPath = join31(codexHome, "config.toml");
  await updateCodexConfig({
    configPath,
    repoRoot: codexPackageRoot,
    marketplaceName: marketplace.name,
    marketplaceSource: codexMarketplaceSource(marketplaceRoot),
    pluginNames: marketplace.plugins.map((plugin) => plugin.name),
    platform,
    codegraphMcpEnabled: options.codegraphMcpEnabled ?? resolveCodegraphNodeSupport({ env: env3 }).supported,
    gitBashEnabled: platform === "win32" && gitBashResolution.found,
    trustedHookStates,
    agentConfigs: [...agentConfigs.values()].sort((left, right) => left.name.localeCompare(right.name)),
    autonomousPermissions: options.autonomousPermissions !== false
  });
  await seedAndMigrateOmoSot({ env: env3, log: log2, repoRoot, runCommand });
  const projectCleanup = await repairProjectLocalCodexArtifactsBestEffort({
    startDirectory: projectDirectory,
    codexHome,
    log: log2
  });
  for (const configCleanup of projectCleanup.configs) {
    if (!configCleanup.changed)
      continue;
    log2(`Repaired project Codex config ${configCleanup.configPath} (backup: ${configCleanup.backupPath})`);
  }
  for (const artifact of projectCleanup.artifacts) {
    log2(`Found project-local legacy artifact ${artifact.path}; left in place`);
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
function agentNameFromToml2(fileName) {
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
    for (const wrapperPackageRoot of [join31(current, "node_modules", "oh-my-openagent"), join31(current, "oh-my-openagent")]) {
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
  return existsSync7(join31(repoRoot, "packages", "omo-codex", "plugin", ".codex-plugin", "plugin.json"));
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
  const env3 = invocation.delegatesToOmo ? { ...process.env, OMO_INVOCATION_NAME: "omo", ...invocation.env } : { ...process.env, ...invocation.env };
  await options.runCommand(invocation.command, invocation.args, { cwd: options.cwd, env: env3 });
}
function buildDelegatedOmoInvocation(parsed) {
  if (parsed.command === "doctor")
    return buildLazyCodexDoctorInvocation(parsed.args);
  const args = ["--yes", "--package", "oh-my-openagent", "omo", parsed.command];
  if (parsed.command === "install") {
    args.push("--platform=codex");
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
  } else if (parsed.command === "cleanup") {
    args.push("--platform=codex", ...parsed.args);
  } else {
    args.push(...parsed.args);
  }
  return { command: "npx", args, delegatesToOmo: true };
}
function buildLazyCodexDoctorInvocation(doctorArgs) {
  return {
    command: "codex",
    args: [
      "exec",
      "--ephemeral",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "--cd",
      ".",
      buildLazyCodexDoctorPrompt(doctorArgs)
    ],
    delegatesToOmo: false,
    env: {
      LAZYCODEX_DOCTOR_LCX_ACTIVE: "1"
    }
  };
}
function buildLazyCodexDoctorPrompt(doctorArgs) {
  return [
    "Use $omo:lcx-doctor to diagnose this LazyCodex/Codex installation.",
    "This command is already the lazycodex doctor surface; never invoke lazycodex doctor from inside the doctor workflow.",
    "Sync the latest LazyCodex and OpenAI Codex sources into /tmp, inventory the local installation,",
    "probe the Codex plugin/cache/hooks/MCP state, and report PASS/WARN/FAIL findings with evidence and remediations.",
    buildDoctorOutputInstruction(doctorArgs),
    doctorArgs.length > 0 ? `Requested doctor arguments: ${doctorArgs.join(" ")}` : "Requested doctor arguments: none"
  ].join(" ");
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
import { spawn as spawn4, spawnSync as spawnSync3 } from "node:child_process";
import { readFileSync as readFileSync3 } from "node:fs";
import { dirname as dirname9, join as join33 } from "node:path";
import { createInterface as createInterface2 } from "node:readline/promises";
import { fileURLToPath } from "node:url";

// packages/omo-codex/src/install/lazycodex-bun-global-paths.ts
import { join as join32 } from "node:path";
function isBunGlobalEntrypointPath(invokedPath, env3) {
  if (typeof invokedPath !== "string" || invokedPath.trim().length === 0)
    return false;
  const normalizedPath = normalizePathForPrefix(invokedPath);
  return resolveBunGlobalRoots(env3).some((root) => normalizedPath.startsWith(root));
}
function resolveBunGlobalRoots(env3) {
  const bunInstallRoot = env3.BUN_INSTALL?.trim();
  const homeRoot = env3.HOME?.trim();
  return [
    ...bunInstallRoot ? [join32(bunInstallRoot, "bin"), join32(bunInstallRoot, "install", "global", "node_modules")] : [],
    ...homeRoot ? [join32(homeRoot, ".bun", "bin"), join32(homeRoot, ".bun", "install", "global", "node_modules")] : []
  ].map(normalizePathForPrefix);
}
function normalizePathForPrefix(path2) {
  const normalized = path2.replaceAll("\\", "/").replace(/\/+$/, "");
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
  const env3 = input.env ?? process.env;
  const log2 = input.log ?? console.log;
  const commandRunner = input.runCommand ?? defaultRunCommandForManualUpdate;
  const currentVersion = resolveCurrentVersion(env3);
  const latestVersion = resolveLatestVersion(env3);
  const plan = resolveLazyCodexUpdatePlan({
    currentVersion,
    latestVersion,
    command: resolveCommand2(env3),
    args: resolveArgs(env3),
    env: env3,
    invokedPath: input.invokedPath ?? process.argv[1]
  });
  if (!plan.shouldUpdate) {
    const printableVersion = currentVersion ?? "unknown";
    log2(plan.reason === "up-to-date" ? `lazycodex-ai ${printableVersion} is already up to date.` : `Unable to check lazycodex-ai updates (${plan.reason}).`);
    return plan.reason === "up-to-date" ? 0 : 1;
  }
  if (input.dryRun) {
    log2(`${plan.command} ${plan.args.join(" ")}`);
    if (plan.postUpdate === "bun-global-trust")
      log2(`${DEFAULT_UPDATE_COMMAND} ${DEFAULT_UPDATE_ARGS.join(" ")}`);
    return 0;
  }
  await commandRunner(plan.command, plan.args, { cwd: process.cwd(), env: env3 });
  if (plan.postUpdate === "bun-global-trust") {
    await handleBunGlobalTrust({
      env: env3,
      log: log2,
      commandRunner,
      isInteractive: input.isInteractive ?? (process.stdin.isTTY === true && process.stdout.isTTY === true)
    });
    await commandRunner(DEFAULT_UPDATE_COMMAND, DEFAULT_UPDATE_ARGS, { cwd: process.cwd(), env: env3 });
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
function resolveCommand2(env3) {
  return env3.LAZYCODEX_AUTO_UPDATE_COMMAND?.trim() || DEFAULT_UPDATE_COMMAND;
}
function resolveArgs(env3) {
  if (env3.LAZYCODEX_AUTO_UPDATE_ARGS_JSON) {
    const parsed = JSON.parse(env3.LAZYCODEX_AUTO_UPDATE_ARGS_JSON);
    if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string")) {
      throw new TypeError("LAZYCODEX_AUTO_UPDATE_ARGS_JSON must be a JSON string array");
    }
    return parsed;
  }
  return DEFAULT_UPDATE_ARGS;
}
function resolveCurrentVersion(env3) {
  if (env3.LAZYCODEX_CURRENT_VERSION?.trim())
    return env3.LAZYCODEX_CURRENT_VERSION.trim();
  const pluginRoot = dirname9(dirname9(fileURLToPath(import.meta.url)));
  return readVersionManifest(resolveInstalledVersionPath(env3, pluginRoot)) ?? readVersionManifest(join33(pluginRoot, "..", "..", "..", "package.json")) ?? readVersionManifest(join33(pluginRoot, ".codex-plugin", "plugin.json"));
}
function resolveLatestVersion(env3) {
  if (env3.LAZYCODEX_LATEST_VERSION?.trim())
    return env3.LAZYCODEX_LATEST_VERSION.trim();
  const result = spawnSync3("npm", ["view", "lazycodex-ai", "version", "--silent"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  if (result.status !== 0)
    return;
  const version2 = result.stdout.trim();
  return version2.length > 0 ? version2 : undefined;
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
function resolveKnownBunGlobalUntrustedPackages(env3) {
  const result = spawnSync3(BUN_UPDATE_COMMAND, BUN_GLOBAL_UNTRUSTED_ARGS, {
    encoding: "utf8",
    env: env3,
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
function isBunGlobalEntrypoint(invokedPath, env3) {
  return isBunGlobalEntrypointPath(invokedPath, env3);
}
function defaultRunCommandForManualUpdate(command, args, options) {
  return new Promise((resolve11, reject) => {
    const child = spawn4(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: "inherit",
      shell: false
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve11();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with ${code ?? "unknown status"}`));
    });
  });
}
function parseVersion(version2) {
  if (typeof version2 !== "string")
    return null;
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([^+]+))?(?:\+.*)?$/.exec(version2.trim());
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
function resolveInstalledVersionPath(env3, pluginRoot) {
  if (env3.LAZYCODEX_INSTALLED_VERSION_FILE?.trim())
    return env3.LAZYCODEX_INSTALLED_VERSION_FILE.trim();
  return join33(pluginRoot, INSTALLED_VERSION_FILE);
}
function readVersionManifest(path2) {
  try {
    const parsed = JSON.parse(readFileSync3(path2, "utf8"));
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
import { readFile as readFile18, writeFile as writeFile10 } from "node:fs/promises";
import { join as join34 } from "node:path";
var GIT_BASH_ENV_KEY2 = "OMO_CODEX_GIT_BASH_PATH";
var CODEGRAPH_RELATIVE_ARGS2 = new Set(["components/codegraph/dist/serve.js", "./components/codegraph/dist/serve.js"]);
async function stampGitBashMcpEnv(input) {
  const manifestPath = join34(input.pluginRoot, ".mcp.json");
  if (!await fileExistsStrict(manifestPath))
    return false;
  const parsed = JSON.parse(await readFile18(manifestPath, "utf8"));
  if (!isPlainRecord(parsed) || !isPlainRecord(parsed["mcpServers"]))
    return false;
  let changed = stampCodegraphMcpPath(parsed["mcpServers"], input.pluginRoot);
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
  await writeFile10(manifestPath, `${JSON.stringify(parsed, null, "\t")}
`);
  return true;
}
function stampCodegraphMcpPath(mcpServers, pluginRoot) {
  const codegraphServer = mcpServers["codegraph"];
  if (!isPlainRecord(codegraphServer) || !Array.isArray(codegraphServer["args"]))
    return false;
  const args = codegraphServer["args"];
  const entrypoint = args[0];
  if (typeof entrypoint !== "string" || !CODEGRAPH_RELATIVE_ARGS2.has(entrypoint))
    return false;
  codegraphServer["args"] = [join34(pluginRoot, "components", "codegraph", "dist", "serve.js"), ...args.slice(1)];
  return true;
}

// packages/omo-codex/src/install/install-local-cli.ts
async function installMarketplaceLocally(options = {}) {
  return runCodexInstaller(options);
}
function resolveDefaultRepoRootForEntrypoint(entrypointPath) {
  return resolve11(dirname10(entrypointPath), "..", "..", "..");
}
function resolveDefaultRepoRoot() {
  return resolveDefaultRepoRootForEntrypoint(fileURLToPath2(import.meta.url));
}
async function runLazyCodexInstallLocalCli(input) {
  const parsed = parseLazyCodexInstallCliArgs(input.argv);
  if (parsed.kind === "help") {
    input.log(formatLazyCodexInstallHelp());
    return 0;
  }
  if (parsed.kind === "version") {
    const packageJson = JSON.parse(await readFile19(join35(input.defaultRepoRoot, "package.json"), "utf8"));
    const version2 = typeof packageJson.version === "string" ? packageJson.version : "unknown";
    input.log(`lazycodex-ai ${version2}`);
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
      const result2 = await installMarketplaceLocally({
        repoRoot: resolve11(parsed.repoRoot),
        autonomousPermissions: true,
        env: input.env
      });
      input.log(`Installed ${result2.installed.length} plugin(s) from ${result2.marketplaceName}.`);
      return 0;
    }
    return runLazyCodexManualUpdate({ env: input.env, dryRun: parsed.dryRun, log: input.log, invokedPath: input.invokedPath });
  }
  const repoRoot = parsed.repoRoot ? resolve11(parsed.repoRoot) : input.defaultRepoRoot;
  const result = await installMarketplaceLocally({
    repoRoot,
    autonomousPermissions: parsed.autonomousPermissions,
    env: input.env
  });
  input.log(`Installed ${result.installed.length} plugin(s) from ${result.marketplaceName}.`);
  return 0;
}
export {
  updateCodexConfig,
  stampGitBashMcpEnv,
  runLazyCodexInstallLocalCli,
  runDelegatedOmoCommand,
  resolveDefaultRepoRootForEntrypoint,
  resolveDefaultRepoRoot,
  resolveCodexInstallerBinDir,
  repairNearestProjectLocalCodexArtifacts,
  readCodexModelCatalog,
  parseLazyCodexInstallCliArgs,
  linkRootRuntimeBin,
  linkCachedPluginBins,
  installMarketplaceLocally,
  installCachedPlugin,
  formatLazyCodexInstallHelp,
  findMissingHookCommandTargets,
  buildDelegatedOmoInvocation,
  assertHookCommandTargets,
  PASSTHROUGH_COMMANDS
};
