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
import { existsSync as existsSync5, mkdirSync as mkdirSync2, readFileSync as readFileSync2 } from "node:fs";
import { basename as basename7, join as join33 } from "node:path";
function resolveTelemetryStateDir(product, options = {}) {
  const dataDir = resolveXdgDataDir(product.cacheDirName, {
    env: options.env,
    osProvider: options.osProvider
  });
  const xdgStateDir = options.env?.XDG_DATA_HOME === undefined ? undefined : join33(options.env.XDG_DATA_HOME, product.cacheDirName);
  if (dataDir === xdgStateDir || xdgStateDir === undefined && basename7(dataDir) === product.cacheDirName) {
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
    const stateContent = readFileSync2(stateFilePath, "utf-8");
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
import { appendFileSync, existsSync as existsSync6, mkdirSync as mkdirSync3, readFileSync as readFileSync3 } from "node:fs";
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
    const retainedLines = trimToMaxBytes(readFileSync3(diagnosticsFilePath, "utf-8").split(`
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
  const env = input.env ?? process.env;
  const globalPrefix = input.globalEnvPrefix ?? "OMO";
  const prefixes = Array.from(new Set([globalPrefix, input.productEnvPrefix]));
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
function getTelemetryHost(env = process.env, defaultHost = DEFAULT_POSTHOG_HOST) {
  return env["POSTHOG_HOST"]?.trim() || defaultHost;
}
var TRUTHY_DISABLE_VALUES, SEND_OPT_OUT_VALUES;
var init_env = __esm(() => {
  TRUTHY_DISABLE_VALUES = ["1", "true", "yes"];
  SEND_OPT_OUT_VALUES = ["0", "false", "no", "yes"];
});

// packages/telemetry-core/src/machine-id.ts
import { createHash as createHash3 } from "node:crypto";
import os2 from "node:os";
function getDefaultTelemetryOsProvider() {
  return os2;
}
function getTelemetryDistinctId(machineIdPrefix, osProvider = getDefaultTelemetryOsProvider()) {
  return createHash3("sha256").update(`${machineIdPrefix}${osProvider.hostname()}`).digest("hex");
}
var init_machine_id = () => {};

// node_modules/.bun/posthog-node@5.35.12/node_modules/posthog-node/dist/extensions/error-tracking/modifiers/module.node.mjs
import { dirname as dirname10, posix as posix2, sep as sep7 } from "node:path";
function createModulerModifier() {
  const getModuleFromFileName = createGetModuleFromFilename();
  return async (frames) => {
    for (const frame of frames)
      frame.module = getModuleFromFileName(frame.filename);
    return frames;
  };
}
function createGetModuleFromFilename(basePath = process.argv[1] ? dirname10(process.argv[1]) : process.cwd(), isWindows = sep7 === "\\") {
  const normalizedBase = isWindows ? normalizeWindowsPath(basePath) : basePath;
  return (filename) => {
    if (!filename)
      return;
    const normalizedFilename = isWindows ? normalizeWindowsPath(filename) : filename;
    let { dir, base: file, ext } = posix2.parse(normalizedFilename);
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
  for (const file of files) {
    if (LRU_FILE_CONTENTS_FS_READ_FAILED.get(file))
      continue;
    const filesToLineRanges = filesToLines[file];
    if (!filesToLineRanges)
      continue;
    filesToLineRanges.sort((a, b) => a - b);
    const ranges = makeLineReaderRanges(filesToLineRanges);
    if (ranges.every((r) => rangeExistsInContentCache(file, r)))
      continue;
    const cache = emplace(LRU_FILE_CONTENTS_CACHE, file, {});
    readlinePromises.push(getContextLinesFromFile(file, ranges, cache));
  }
  await Promise.all(readlinePromises).catch(() => {});
  if (frames && frames.length > 0)
    addSourceContextToFrames(frames, LRU_FILE_CONTENTS_CACHE);
  LRU_FILE_CONTENTS_CACHE.reduce();
  return frames;
}
function getContextLinesFromFile(path2, ranges, output) {
  return new Promise((resolve9) => {
    const stream = createReadStream(path2);
    const lineReaded = createInterface({
      input: stream
    });
    function destroyStreamAndResolve() {
      stream.destroy();
      resolve9();
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
function rangeExistsInContentCache(file, range) {
  const contents = LRU_FILE_CONTENTS_CACHE.get(file);
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
import { isAbsolute as isAbsolute7, relative as relative4, sep as sep8 } from "node:path";
function createRelativePathModifier(basePath = process.cwd()) {
  const isWindows = sep8 === "\\";
  const toUnix = (p) => isWindows ? p.replace(/\\/g, "/") : p;
  const normalizedBase = toUnix(basePath);
  return async (frames) => {
    for (const frame of frames)
      if (!(!frame.filename || frame.filename.startsWith("node:") || frame.filename.startsWith("data:"))) {
        if (isAbsolute7(frame.filename))
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
        let resolve9;
        const promise = new Promise((r) => {
          resolve9 = r;
        });
        try {
          waitUntil(promise);
        } catch {
          return;
        }
        this._waitUntilCycle = {
          resolve: resolve9,
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
      const resolve9 = this._consumeWaitUntilCycle();
      try {
        await super.flush();
      } catch {} finally {
        resolve9?.();
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
      return new Promise((resolve9) => {
        const timeout = setTimeout(() => {
          cleanup();
          resolve9(false);
        }, timeoutMs);
        const cleanup = this._events.on("localEvaluationFlagsLoaded", (count) => {
          clearTimeout(timeout);
          cleanup();
          resolve9(count > 0);
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
      const resolve9 = this._consumeWaitUntilCycle();
      await this.featureFlagsPoller?.stopPoller(shutdownTimeoutMs);
      this.errorTracking.shutdown();
      try {
        return await super._shutdown(shutdownTimeoutMs);
      } finally {
        resolve9?.();
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
  const env = input.env ?? process.env;
  return !shouldDisableTelemetry({ env, productEnvPrefix: input.product.productEnvPrefix }) && getTelemetryApiKey(env, input.product.defaultApiKey).length > 0;
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
var init_record_daily_active = () => {};

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
    version: "4.19.0",
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
import { readFile as readFile22 } from "node:fs/promises";
import { dirname as dirname12, join as join39, resolve as resolve10 } from "node:path";
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
import { join as join35, resolve as resolve9 } from "node:path";
import { existsSync as existsSync7 } from "node:fs";
import { homedir as homedir2 } from "node:os";

// packages/omo-codex/src/install/codex-cache-bins.ts
import { chmod, lstat as lstat4, mkdir, readFile as readFile3, readdir as readdir2, readlink as readlink3, rm as rm3, stat as stat2, symlink, writeFile } from "node:fs/promises";
import { basename, isAbsolute as isAbsolute2, join as join5, relative, resolve as resolve2, sep } from "node:path";

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
    '  if defined OMO_NODE_BINARY set "OMO_NODE_BINARY=!OMO_NODE_BINARY:"=!"',
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
import { dirname, isAbsolute, join as join2, resolve } from "node:path";

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
    const target = isAbsolute(linkTarget) ? linkTarget : resolve(dirname(linkPath), linkTarget);
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
  { name: "codex-start-work-continuation", component: "start-work-continuation" },
  { name: "codex-telemetry", component: "telemetry" },
  { name: "codex-ultrawork", component: "ultrawork" }
];
async function removeLegacyCodexComponentBins(binDir, platform) {
  for (const entry of LEGACY_CODEX_COMPONENT_BINS) {
    const linkPath = join3(binDir, platform === "win32" ? `${entry.name}.cmd` : entry.name);
    await removeLegacyCodexComponentBin(linkPath, entry.component, platform);
  }
}
async function removeLegacyCodexComponentBin(linkPath, component, platform) {
  try {
    const stat2 = await lstat3(linkPath);
    if (platform !== "win32") {
      if (!stat2.isSymbolicLink())
        return;
      const target = await readlink2(linkPath);
      if (isManagedLegacyComponentTarget(target, component))
        await rm2(linkPath, { force: true });
      return;
    }
    if (!stat2.isFile())
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
function posixRuntimeWrapper(cliPath, codexHome, binDir, nodeCliPath) {
  const ulwLoopBin = toPosixPath(join4(binDir, "omo-ulw-loop"));
  const nodeCli = escapePosixDoubleQuoted(toPosixPath(nodeCliPath));
  const escapedCliPath = escapePosixDoubleQuoted(toPosixPath(cliPath));
  const escapedCodexHome = escapePosixDoubleQuoted(toPosixPath(codexHome));
  const escapedUlwLoopBin = escapePosixDoubleQuoted(ulwLoopBin);
  return [
    "#!/bin/sh",
    `# ${RUNTIME_WRAPPER_MARKER}`,
    `export CODEX_HOME="\${CODEX_HOME:-${escapedCodexHome}}"`,
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
  const ulwLoopBin = join4(binDir, "omo-ulw-loop.cmd");
  return [
    "@echo off",
    `rem ${RUNTIME_WRAPPER_MARKER}`,
    `if not defined CODEX_HOME set "CODEX_HOME=${codexHome}"`,
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
    `  echo omo: bun runtime not found, no Node runtime was discovered from NODE_REPL_NODE_PATH or PATH, or the node fallback CLI is missing at ${nodeCliPath}; install bun from https://bun.sh or rerun LazyCodex install from Codex Desktop 1>&2`,
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
  if (!await isFile(cliPath))
    return null;
  const nodeCliPath = join5(input.repoRoot, "dist", "cli-node", "index.js");
  const platform = input.platform ?? process.platform;
  await mkdir(input.binDir, { recursive: true });
  if (platform === "win32") {
    const linkPath2 = join5(input.binDir, "omo.cmd");
    await replaceRuntimeWrapper(linkPath2, windowsRuntimeWrapper(cliPath, input.codexHome, input.binDir, nodeCliPath));
    return { name: "omo", path: linkPath2, target: cliPath };
  }
  const linkPath = join5(input.binDir, "omo");
  await replaceRuntimeWrapper(linkPath, posixRuntimeWrapper(cliPath, input.codexHome, input.binDir, nodeCliPath));
  await chmod(linkPath, 493);
  return { name: "omo", path: linkPath, target: cliPath };
}
async function linkCachedPluginBin(binDir, link, platform) {
  if (platform === "win32") {
    const linkPath2 = join5(binDir, `${link.name}.cmd`);
    await replaceCommandShim(linkPath2, link.target);
    return linkPath2;
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
  const root = resolve2(packageRoot);
  const resolvedTarget = resolve2(root, target);
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
async function existingNonRuntimeWrapper(path) {
  try {
    const stat3 = await lstat4(path);
    if (stat3.isSymbolicLink())
      return false;
    if (!stat3.isFile())
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
    const stat3 = await lstat4(path);
    if (!stat3.isFile())
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
    const stat3 = await lstat4(path);
    if (!stat3.isSymbolicLink())
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
import { basename as basename3, dirname as dirname5, join as join12, sep as sep5 } from "node:path";

// packages/omo-codex/src/install/codex-cache-bundled-mcps.ts
import { cp, mkdir as mkdir2, readFile as readFile4, stat as stat3 } from "node:fs/promises";
import { dirname as dirname2, join as join6, resolve as resolve3 } from "node:path";
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
  for (const runtime3 of BUNDLED_MCP_RUNTIMES) {
    if (!sourceArgs.has(runtime3.sourceArg))
      continue;
    await copyBundledMcpRuntimeDist(input.pluginRoot, input.sourceRoot, runtime3);
  }
}
function resolveBundledMcpRuntimeArg(pluginRoot, arg) {
  const runtime3 = BUNDLED_MCP_RUNTIMES.find((candidate) => candidate.sourceArg === arg);
  return runtime3 ? join6(pluginRoot, runtime3.destinationArg) : null;
}
async function copyBundledMcpRuntimeDist(pluginRoot, sourceRoot, runtime3) {
  const sourcePath = resolve3(sourceRoot, runtime3.sourceDistFromPlugin);
  if (!await isDirectory(sourcePath)) {
    throw new Error(`missing built ${runtime3.label} dist at ${sourcePath}`);
  }
  const destinationPath = join6(pluginRoot, runtime3.destinationDistFromPlugin);
  await mkdir2(dirname2(destinationPath), { recursive: true });
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
import { realpathSync } from "node:fs";
import { readFile as readFile5, readdir as readdir3, writeFile as writeFile2 } from "node:fs/promises";
import { dirname as dirname3, isAbsolute as isAbsolute4, join as join8, relative as relative3, resolve as resolve5, sep as sep2 } from "node:path";

// packages/omo-codex/src/install/codex-cache-paths.ts
import { isAbsolute as isAbsolute3, join as join7, relative as relative2, resolve as resolve4 } from "node:path";
function resolveCachedRuntimePath(pluginRoot, sourceRoot, runtimePath) {
  const targetPath = resolve4(pluginRoot, runtimePath);
  if (isPathInside(targetPath, pluginRoot))
    return targetPath;
  return resolve4(sourceRoot, runtimePath);
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
  for (const packageJsonPath of packageJsonPaths) {
    const raw = await readFile5(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!isPlainRecord(parsed))
      continue;
    const packageDir = dirname3(packageJsonPath);
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
        const targetPath = resolve5(packageDir, filePath);
        if (isPathInside(targetPath, pluginRoot))
          continue;
        const sourceTargetPath = resolve5(sourcePackageDir, filePath);
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
    return realpathSync(path);
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
import { join as join10, sep as sep3 } from "node:path";

// packages/utils/src/codegraph/resolve.ts
import { existsSync as existsSync2 } from "node:fs";
import { spawnSync as spawnSync2 } from "node:child_process";
import { basename as basename2, dirname as dirname4, join as join9 } from "node:path";
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
function resolveConfiguredNodeRuntime(configured, fileExists, which) {
  if (looksLikePath(configured))
    return fileExists(configured) ? configured : null;
  return which(configured);
}
function supportsCodegraphNodeRuntime(nodePath, env, nodeVersion) {
  const version = nodeVersion(nodePath);
  if (version === null)
    return false;
  return evaluateCodegraphNodeSupport({ env, nodeVersion: version }).supported;
}
function defaultNodeRuntime(env, fileExists, which, nodeVersion) {
  const configured = env[CODEGRAPH_NODE_BIN_ENV]?.trim();
  if (configured !== undefined && configured.length > 0) {
    const resolved = resolveConfiguredNodeRuntime(configured, fileExists, which);
    return resolved !== null && supportsCodegraphNodeRuntime(resolved, env, nodeVersion) ? resolved : null;
  }
  const candidates = [
    ...isNodeExecutableName(process.execPath) ? [process.execPath] : [],
    ...CODEGRAPH_NODE_CANDIDATES.map((commandName) => which(commandName)).filter((candidate) => candidate !== null),
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
  const manifestPath = join10(pluginRoot, ".mcp.json");
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
        if (CODEGRAPH_RELATIVE_ARGS.has(arg))
          return join10(pluginRoot, "components", "codegraph", "dist", "serve.js");
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
  const manifestPath = join10(pluginRoot, ".mcp.json");
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
import { join as join11, sep as sep4 } from "node:path";
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
      const target = join11(pluginRoot, ...targetSuffix.split(/[\\/]+/));
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
  const pluginManifestPath = join11(pluginRoot, ".codex-plugin", "plugin.json");
  if (!await fileExistsStrict(pluginManifestPath))
    return [join11(pluginRoot, "hooks", "hooks.json")];
  const parsed = JSON.parse(await readFile7(pluginManifestPath, "utf8"));
  if (!isPlainRecord(parsed))
    return [];
  if (typeof parsed.hooks === "string" && parsed.hooks.trim() !== "") {
    return [join11(pluginRoot, stripDotSlash(parsed.hooks))];
  }
  if (Array.isArray(parsed.hooks)) {
    return parsed.hooks.filter((hookPath) => typeof hookPath === "string" && hookPath.trim() !== "").map((hookPath) => join11(pluginRoot, stripDotSlash(hookPath)));
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
  const targetPath = join12(input.codexHome, "plugins", "cache", input.marketplaceName, input.name, input.version);
  const tempPath = createTempSiblingPath(targetPath);
  await rm4(tempPath, { recursive: true, force: true });
  try {
    await copyDirectory(input.sourcePath, tempPath);
    await rewriteCachedPackageLocalFileDependencies(tempPath, input.sourcePath);
    await copyBundledMcpRuntimeDists({ pluginRoot: tempPath, sourceRoot: input.sourcePath });
    await copyRootRuntimeDists({ pluginRoot: tempPath, sourcePath: input.sourcePath });
    await maybeRunNpmInstall(tempPath, input.runCommand, npmInstallEnv, ["ci", "--omit=dev"]);
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
  if (!await fileExistsStrict(join12(cwd, "package.json")))
    return;
  await runCommand("npm", args, { cwd, env });
}
async function maybeRunNpmBuild(cwd, runCommand, env) {
  if (!await fileExistsStrict(join12(cwd, "package.json")))
    return;
  const packageJson = JSON.parse(await readFile8(join12(cwd, "package.json"), "utf8"));
  if (!isPlainRecord(packageJson))
    return;
  const scripts = packageJson.scripts;
  if (!isPlainRecord(scripts) || typeof scripts.build !== "string")
    return;
  await runCommand("npm", ["run", "build"], { cwd, env });
}
async function maybeRunNpmSyncSkills(cwd, runCommand, env) {
  if (!await fileExistsStrict(join12(cwd, "package.json")))
    return;
  const packageJson = JSON.parse(await readFile8(join12(cwd, "package.json"), "utf8"));
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
  return join12(dirname5(targetPath), `.tmp-${basename3(targetPath)}-${process.pid}-${Date.now()}`);
}
function createBackupSiblingPath(targetPath) {
  return join12(dirname5(targetPath), `.backup-${basename3(targetPath)}-${process.pid}-${Date.now()}`);
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
  const relative4 = path === root ? "" : path.slice(root.length + sep5.length);
  if (relative4 === "")
    return true;
  const parts = relative4.split(sep5);
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
    const content = await readFile8(join12(pluginRoot, filePath), "utf8");
    if (!removedSparkshellReferencePattern.test(content))
      continue;
    throw new Error(`removed sparkshell reference found in Codex plugin prompt surface: ${filePath}`);
  }
}
async function listRemovedSparkshellPromptSurfaceFiles(pluginRoot, relativeDirectory) {
  const directory = relativeDirectory === "" ? pluginRoot : join12(pluginRoot, relativeDirectory);
  const entries = await readdir4(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = relativeDirectory === "" ? entry.name : join12(relativeDirectory, entry.name);
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
    const sourcePath = join12(repoRoot, runtimePath);
    if (!await fileExistsStrict(join12(sourcePath, "index.js")))
      continue;
    await mkdir3(dirname5(join12(input.pluginRoot, runtimePath)), { recursive: true });
    await cp2(sourcePath, join12(input.pluginRoot, runtimePath), { recursive: true });
  }
}
function repoRootForCodexPluginSource(sourcePath) {
  const codexPackageRoot = dirname5(sourcePath);
  const packagesRoot = dirname5(codexPackageRoot);
  if (basename3(sourcePath) !== "plugin")
    return null;
  if (basename3(codexPackageRoot) !== "omo-codex")
    return null;
  if (basename3(packagesRoot) !== "packages")
    return null;
  return dirname5(packagesRoot);
}
// packages/omo-codex/src/install/codex-cache-prune.ts
import { lstat as lstat5, readdir as readdir5, rm as rm5, stat as stat4 } from "node:fs/promises";
import { join as join13 } from "node:path";
async function pruneMarketplaceCache(input) {
  const cacheRoot = join13(input.codexHome, "plugins", "cache", input.marketplaceName);
  if (!await fileExistsStrict(cacheRoot))
    return;
  const keep = new Set(input.keepPluginNames);
  const entries = await readCacheEntries(cacheRoot);
  for (const entry of entries) {
    if (!entry.isDirectory() || keep.has(entry.name))
      continue;
    await rm5(join13(cacheRoot, entry.name), { recursive: true, force: true });
  }
}
async function pruneMarketplacePluginCaches(input) {
  const cacheRoot = join13(input.codexHome, "plugins", "cache", input.marketplaceName);
  if (!await fileExistsStrict(cacheRoot))
    return;
  for (const pluginName of input.pluginNames) {
    await rm5(join13(cacheRoot, pluginName), { recursive: true, force: true });
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
import { join as join14 } from "node:path";
async function writeCachedMarketplaceManifest(input) {
  const marketplaceDir = join14(input.marketplaceRoot, ".agents", "plugins");
  await mkdir4(marketplaceDir, { recursive: true });
  for (const plugin of input.plugins) {
    const pluginPath = join14(input.marketplaceRoot, plugin.name, plugin.version);
    if (!await isDirectory2(pluginPath))
      throw new Error(`Cannot write cached marketplace manifest: ${pluginPath} does not exist`);
  }
  const manifestPath = join14(marketplaceDir, "marketplace.json");
  const tempPath = join14(marketplaceDir, `.marketplace.json.tmp-${process.pid}-${Date.now()}`);
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
import { join as join15 } from "node:path";
var PACKAGED_CODEX_INSTALLER_NAMES = new Set([
  "@code-yeongyu/lazycodex",
  "@code-yeongyu/lazycodex-ai",
  "lazycodex",
  "lazycodex-ai",
  "oh-my-opencode",
  "oh-my-openagent"
]);
async function shouldBuildSourcePackages(repoRoot) {
  if (existsSync3(join15(repoRoot, "packages", "omo-opencode", "src", "index.ts")))
    return true;
  const packageJsonPath = join15(repoRoot, "package.json");
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
    const replacement2 = replaceTomlAssignmentValue(line, assignmentIndex, value);
    const assignmentEnd = multilineScan.nextQuote ? findTomlMultilineValueEnd(section.text, offset + line.length, multilineScan.nextQuote) : offset + line.length;
    const sectionReplacement = section.text.slice(0, offset) + replacement2 + section.text.slice(assignmentEnd);
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
    const replacement2 = replaceTomlAssignmentValue(line, assignmentIndex, value);
    const assignmentEnd = multilineScan.nextQuote ? findTomlMultilineValueEnd(config, offset + line.length, multilineScan.nextQuote) : offset + line.length;
    return config.slice(0, offset) + replacement2 + config.slice(assignmentEnd);
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
    const delimiter2 = line.startsWith('"""', index) ? '"""' : line.startsWith("'''", index) ? "'''" : null;
    if (delimiter2) {
      const closingIndex = findTomlMultilineDelimiter(line, delimiter2, index + delimiter2.length);
      return { wasInside: false, nextQuote: closingIndex === -1 ? delimiter2 : null };
    }
    if (char === '"' || char === "'")
      quote = char;
    index += 1;
  }
  return { wasInside: false, nextQuote: null };
}
function findTomlMultilineDelimiter(line, delimiter2, startIndex) {
  let index = line.indexOf(delimiter2, startIndex);
  while (index !== -1) {
    if (delimiter2 === "'''" || countPrecedingBackslashes(line, index) % 2 === 0)
      return index;
    index = line.indexOf(delimiter2, index + 1);
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
import { basename as basename4, dirname as dirname6, isAbsolute as isAbsolute5, join as join16, resolve as resolve6 } from "node:path";
var RENAME_RETRY_DELAYS_MS = [10, 25, 50];
var RETRIABLE_RENAME_CODES = new Set(["EPERM", "EBUSY"]);
async function writeFileAtomic(targetPath, data) {
  const writeTarget = await resolveSymlinkTarget(targetPath);
  const temporaryPath = join16(dirname6(writeTarget), `.tmp-${basename4(writeTarget)}-${process.pid}-${Date.now()}`);
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
    return isAbsolute5(linkValue) ? linkValue : resolve6(dirname6(targetPath), linkValue);
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
function hasTomlSetting(config, keyPath) {
  const targetPath = parseTomlDottedKey(keyPath);
  if (!targetPath)
    return false;
  return hasTomlAssignment(config, (tablePath, settingPath) => {
    const fullPath = [...tablePath, ...settingPath];
    return fullPath.length === targetPath.length && fullPath.every((part, index) => part === targetPath[index]);
  });
}
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
  next = replaceOrInsertRootSetting(next, "network_access", JSON.stringify("enabled"));
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
  const codegraphEnabled = input.codegraphMcpEnabled ?? true;
  const gitBashEnabled = (input.platform ?? process.platform) === "win32" && input.gitBashEnabled === true;
  let nextConfig = removeStaleContext7PlaceholderMcp(config);
  nextConfig = ensurePluginMcpEnabled(nextConfig, "omo@sisyphuslabs", "context7", true);
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
import { join as join17 } from "node:path";
var FALLBACK_CODEX_MODEL_CATALOG = {
  current: {
    model: "gpt-5.6-sol",
    modelContextWindow: 372000,
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
    { model: "gpt-5.5", modelContextWindow: 272000 }
  ]
};
async function readCodexModelCatalog(codexPackageRoot) {
  const catalogPath = join17(codexPackageRoot, "plugin", "model-catalog.json");
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
import { readFileSync } from "node:fs";
import { dirname as dirname7, isAbsolute as isAbsolute6, join as join18 } from "node:path";
var CODEX_AGENTS_HEADER = "agents";
var CODEX_MULTI_AGENT_V2_HEADER = "features.multi_agent_v2";
var CODEX_MULTI_AGENT_V2_THREAD_LIMIT_KEY = `${CODEX_MULTI_AGENT_V2_HEADER}.max_concurrent_threads_per_session`;
var CODEX_SUBAGENT_THREAD_LIMIT = 1000;
var CODEX_MULTI_AGENT_V2_THREAD_LIMIT = 16;
function ensureCodexMultiAgentV2Config(config, options = {}) {
  const featureFlag = removeFeatureFlagSetting(config, "multi_agent_v2");
  const v2Preferred = options.multiAgentVersion === "v2";
  const modelKnown = options.multiAgentVersion != null || readRootModel(featureFlag.config) !== null;
  const agentsConfig = v2Preferred ? removeAgentsMaxThreads(featureFlag.config) : modelKnown ? ensureAgentsMaxThreads(featureFlag.config) : raiseExistingAgentsMaxThreads(featureFlag.config);
  const preserveDisable = featureFlag.value === false && !v2Preferred;
  const featureConfig = preserveDisable ? setMultiAgentV2Disable(agentsConfig) : v2Preferred ? removeMultiAgentV2Disable(agentsConfig) : agentsConfig;
  if (hasTomlSetting(featureConfig, CODEX_MULTI_AGENT_V2_THREAD_LIMIT_KEY))
    return featureConfig;
  const section = findTomlSection(featureConfig, CODEX_MULTI_AGENT_V2_HEADER);
  if (!section) {
    const enabledSetting = preserveDisable ? `enabled = false
` : "";
    return appendBlock(featureConfig, `[${CODEX_MULTI_AGENT_V2_HEADER}]
${enabledSetting}max_concurrent_threads_per_session = ${CODEX_MULTI_AGENT_V2_THREAD_LIMIT}
`);
  }
  return replaceOrInsertSetting(featureConfig, section, "max_concurrent_threads_per_session", CODEX_MULTI_AGENT_V2_THREAD_LIMIT.toString());
}
function resolveCodexMultiAgentVersion(config, configPath) {
  const model = readRootModel(config);
  if (model === null)
    return null;
  const catalogPath = resolveCatalogPath(readRootModelCatalogPath(config), configPath);
  const catalogVersion = readCatalogMultiAgentVersion(model, catalogPath);
  if (catalogVersion !== null)
    return catalogVersion;
  return /^gpt-5\.6\b/i.test(model) ? "v2" : null;
}
function resolveCatalogPath(configuredPath, configPath) {
  if (configuredPath === null)
    return join18(dirname7(configPath), "models_cache.json");
  return isAbsolute6(configuredPath) ? configuredPath : join18(dirname7(configPath), configuredPath);
}
function readCatalogMultiAgentVersion(model, cachePath) {
  let raw;
  try {
    raw = readFileSync(cachePath, "utf8");
  } catch {
    return null;
  }
  let cache;
  try {
    cache = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(cache) || !Array.isArray(cache.models))
    return null;
  for (const entry of cache.models) {
    if (!isRecord(entry))
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
function isRecord(value) {
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
function removeAgentsMaxThreads(config) {
  const section = findTomlSection(config, CODEX_AGENTS_HEADER);
  if (!section)
    return config;
  if (!/^\s*max_threads\s*=/m.test(section.text))
    return config;
  return removeSetting(config, section, "max_threads");
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
function raiseExistingAgentsMaxThreads(config) {
  const section = findTomlSection(config, CODEX_AGENTS_HEADER);
  if (!section)
    return config;
  if (!/^\s*max_threads\s*=/m.test(section.text))
    return config;
  return replaceOrInsertSetting(config, section, "max_threads", CODEX_SUBAGENT_THREAD_LIMIT.toString());
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
  config = ensureCodexReasoningConfig(config, await readCodexModelCatalog(input.repoRoot));
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
import { join as join19 } from "node:path";
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
  const manifestPath = join19(input.pluginRoot, ".codex-plugin", "plugin.json");
  if (!await exists(manifestPath))
    return [];
  const manifest = JSON.parse(await readFile12(manifestPath, "utf8"));
  if (!isPlainRecord(manifest))
    return [];
  const states = [];
  for (const hookPath of hookManifestPaths2(manifest.hooks)) {
    const hooksPath = join19(input.pluginRoot, hookPath);
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
  const resolve7 = input.resolveGitBash ?? (() => resolveGitBashForCurrentProcess2({ platform: input.platform, env: input.env }));
  const initialResolution = resolve7();
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
import { copyFile, lstat as lstat9, mkdir as mkdir6, readdir as readdir7, rm as rm8, writeFile as writeFile7 } from "node:fs/promises";
import { basename as basename5, join as join22 } from "node:path";

// packages/omo-codex/src/install/preserved-agent-settings.ts
import { lstat as lstat7, readFile as readFile13, readdir as readdir6, writeFile as writeFile6 } from "node:fs/promises";
import { join as join20 } from "node:path";

// packages/omo-codex/src/install/managed-agent-reasoning-defaults.ts
var MANAGED_REASONING_DEFAULT_UPGRADES = new Map([
  [
    "explorer",
    [
      {
        previous: { model: "gpt-5.4-mini", effort: "low" },
        current: { model: "gpt-5.6-terra", effort: "medium" }
      },
      {
        previous: { model: "gpt-5.6-terra", effort: "medium" },
        current: { model: "gpt-5.6-luna", effort: "low" }
      }
    ]
  ],
  [
    "librarian",
    [
      {
        previous: { model: "gpt-5.4-mini", effort: "low" },
        current: { model: "gpt-5.6-terra", effort: "medium" }
      },
      {
        previous: { model: "gpt-5.6-terra", effort: "medium" },
        current: { model: "gpt-5.6-luna", effort: "low" }
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
      }
    ]
  ],
  [
    "plan",
    [
      {
        previous: { model: "gpt-5.6-sol", effort: "xhigh" },
        current: { model: "gpt-5.6-sol", effort: "max" }
      }
    ]
  ],
  [
    "lazycodex-worker-medium",
    [
      {
        previous: { model: "gpt-5.6-sol", effort: "high" },
        current: { model: "gpt-5.6-luna", effort: "max" }
      }
    ]
  ],
  [
    "lazycodex-qa-executor",
    [
      {
        previous: { model: "gpt-5.6-terra", effort: "medium" },
        current: { model: "gpt-5.6-luna", effort: "high" }
      }
    ]
  ],
  [
    "lazycodex-gate-reviewer",
    [
      {
        previous: { model: "gpt-5.6-sol", effort: "xhigh" },
        current: { model: "gpt-5.6-sol", effort: "high" }
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
  if (input.bundledModel !== latest.current.model || input.bundledEffort !== latest.current.effort) {
    return input.preserved.effort;
  }
  const preservedMatchesAnyStep = steps.some((step) => input.preserved.model === step.previous.model && input.preserved.effort === step.previous.effort);
  return preservedMatchesAnyStep ? latest.current.effort : input.preserved.effort;
}

// packages/omo-codex/src/install/preserved-agent-settings.ts
async function capturePreservedAgentReasoning(input) {
  const agentsDir = join20(input.codexHome, "agents");
  if (!await exists2(agentsDir))
    return new Map;
  const preserved = new Map;
  const agentEntries = await readdir6(agentsDir, { withFileTypes: true });
  for (const entry of agentEntries) {
    if (!entry.name.endsWith(".toml"))
      continue;
    const content = await readTextIfExists(join20(agentsDir, entry.name));
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
  const agentsDir = join20(input.codexHome, "agents");
  if (!await exists2(agentsDir))
    return new Map;
  const preserved = new Map;
  const agentEntries = await readdir6(agentsDir, { withFileTypes: true });
  for (const entry of agentEntries) {
    if (!entry.name.endsWith(".toml"))
      continue;
    const content = await readTextIfExists(join20(agentsDir, entry.name));
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
import { join as join21 } from "node:path";
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
  const agentsDir = join21(input.codexHome, "agents");
  if (!await exists3(agentsDir))
    return;
  for (const retiredAgent of RETIRED_MANAGED_AGENT_FILES) {
    const agentPath = join21(agentsDir, retiredAgent.fileName);
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
    const agentFileName = basename5(agentPath);
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
  const entryStat = await lstat9(linkPath);
  if (entryStat.isDirectory() && !entryStat.isSymbolicLink()) {
    throw new Error(`${linkPath} already exists and is a directory; refusing to replace`);
  }
  await rm8(linkPath, { force: true });
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
    await lstat9(path);
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
import { readFile as readFile15 } from "node:fs/promises";
import { join as join23 } from "node:path";
var DEFAULT_MARKETPLACE_PATH = "packages/omo-codex/marketplace.json";
async function readMarketplace(repoRoot, options) {
  const marketplacePath = options?.marketplacePath ?? join23(repoRoot, DEFAULT_MARKETPLACE_PATH);
  const raw = await readFile15(marketplacePath, "utf8");
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
  const raw = await readFile15(join23(pluginRoot, ".codex-plugin", "plugin.json"), "utf8");
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
import { cp as cp3, mkdir as mkdir7, rename as rename4, rm as rm9, writeFile as writeFile8 } from "node:fs/promises";
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
  await rm9(tempPath, { recursive: true, force: true });
  await cp3(plugin.sourcePath, tempPath, {
    recursive: true,
    filter: (source) => shouldCopyMarketplaceSourcePath(source, plugin.sourcePath)
  });
  await copyBundledMcpRuntimeDists({ pluginRoot: tempPath, sourceRoot: plugin.sourcePath });
  await rm9(targetPath, { recursive: true, force: true });
  await rename4(tempPath, targetPath);
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
import { readdir as readdir8, readFile as readFile16, writeFile as writeFile9 } from "node:fs/promises";
import { join as join25 } from "node:path";
async function readDistributionManifest(repoRoot) {
  try {
    const parsed = JSON.parse(await readFile16(join25(repoRoot, "package.json"), "utf8"));
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
    const parsed = JSON.parse(await readFile16(path, "utf8"));
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
    const parsed = JSON.parse(await readFile16(manifestPath, "utf8"));
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
    const parsed = JSON.parse(await readFile16(path, "utf8"));
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
import { copyFile as copyFile2, lstat as lstat10, readFile as readFile17, writeFile as writeFile10 } from "node:fs/promises";
import { dirname as dirname9, join as join26, resolve as resolve7 } from "node:path";
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
    const original = await readFile17(configPath, "utf8");
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
  const codexHomeConfigPath = codexHome === undefined ? null : join26(resolve7(codexHome), "config.toml");
  let current = resolve7(startDirectory);
  const configPathsFromCwd = [];
  while (true) {
    const configPath = join26(current, ".codex", "config.toml");
    if (await isRegularProjectLocalConfig(current, configPath)) {
      if (codexHomeConfigPath === null || resolve7(configPath) !== codexHomeConfigPath) {
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
    return await lstat10(path);
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
import { createHash as createHash2 } from "node:crypto";
import { lstat as lstat11, readFile as readFile19, readdir as readdir10, rm as rm10 } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as join27, posix } from "node:path";

// packages/omo-codex/src/install/lsp-daemon-reaper-attestation.ts
import { execFile } from "node:child_process";
import { readFile as readFile18, readdir as readdir9, readlink as readlink5 } from "node:fs/promises";
import { connect } from "node:net";
import { basename as basename6 } from "node:path";
var PROBE_TIMEOUT_MS = 500;
async function probeLegacyJsonRpcEndpoint(endpoint, timeoutMs = PROBE_TIMEOUT_MS) {
  return await new Promise((resolve8) => {
    const socket = connect(endpoint);
    let settled = false;
    let buffer = "";
    const finish = (value) => {
      if (settled)
        return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve8(value);
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
  const readFileImpl = deps.readFile ?? readFile18;
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
  const executable = basename6(argv[0] ?? "");
  if (!/^node(?:\.exe)?$/i.test(executable))
    return false;
  return argv.some((value) => value === "cli.js" || value.endsWith("/cli.js") || value.endsWith("\\cli.js"));
}
function lsofShowsUnixEndpoint(output, pid, endpoint) {
  const lines = output.split(/\r?\n/).filter((line) => line.length > 0);
  const endpointName = basename6(endpoint);
  return lines.includes(`p${pid}`) && lines.some((line) => line === `n${endpoint}` || line === `n${endpointName}`);
}
function isNodeCliDaemonCommand(command) {
  return /\bnode(?:\.exe)?\b/i.test(command) && /\bcli\.js\b/.test(command) && /\bdaemon\b/.test(command);
}
async function executeForStdout(executeFileImpl, file, args) {
  return await new Promise((resolve8) => {
    executeFileImpl(file, [...args], { encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 1000 }, (error, stdout) => {
      if (error !== null) {
        resolve8(null);
        return;
      }
      resolve8(stdout);
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
  const natural = posix.join(input.versionPath, "daemon.sock");
  const hashed = posix.join(input.tmpDir, `omo-lsp-${input.version}-${shortDigest(input.versionPath)}.sock`);
  return [natural, hashed];
}
async function readRegularTrimmedFile(path) {
  const stats = await lstat11(path).catch(() => null);
  if (stats === null)
    return null;
  if (!stats.isFile())
    return "non_regular";
  const content = (await readFile19(path, "utf8")).trim();
  return content.length > 0 ? content : null;
}
function shortDigest(value) {
  return createHash2("sha256").update(value).digest("hex").slice(0, 16);
}
async function removeVersionDir(path) {
  await rm10(path, { recursive: true, force: true });
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
    await new Promise((resolve8) => setTimeout(resolve8, 100));
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
import { join as join28, resolve as resolve8 } from "node:path";
function resolveCodexInstallerBinDir(input) {
  const explicitBinDir = input.binDir ?? input.env?.CODEX_LOCAL_BIN_DIR;
  if (explicitBinDir !== undefined && explicitBinDir.trim().length > 0)
    return resolve8(explicitBinDir.trim());
  const homeDir = input.homeDir ?? homedir();
  const defaultCodexHome = resolve8(homeDir, ".codex");
  const resolvedCodexHome = resolve8(input.codexHome);
  if (resolvedCodexHome !== defaultCodexHome)
    return join28(resolvedCodexHome, "bin");
  return resolve8(homeDir, ".local", "bin");
}

// packages/omo-codex/src/install/codex-git-bash-hooks.ts
import { readFile as readFile20, writeFile as writeFile11 } from "node:fs/promises";
import { join as join29 } from "node:path";
var WINDOWS_ONLY_GIT_BASH_HOOKS = new Set([
  "./hooks/pre-tool-use-recommending-git-bash-mcp.json",
  "./hooks/post-compact-resetting-git-bash-mcp-reminder.json"
]);
async function removeGitBashHooksOffWindows(input) {
  if (input.platform === "win32")
    return;
  const manifestPath = join29(input.pluginRoot, ".codex-plugin", "plugin.json");
  const parsed = JSON.parse(await readFile20(manifestPath, "utf8"));
  if (!isPlainRecord(parsed) || !Array.isArray(parsed.hooks))
    return;
  const hooks = parsed.hooks.filter((hook) => typeof hook !== "string" || !WINDOWS_ONLY_GIT_BASH_HOOKS.has(hook));
  if (hooks.length === parsed.hooks.length)
    return;
  await writeFile11(manifestPath, `${JSON.stringify({ ...parsed, hooks }, null, "\t")}
`);
}

// packages/omo-codex/src/install/omo-sot-migration.ts
import { join as join30 } from "node:path";
async function seedAndMigrateOmoSot(input) {
  const commandEnv = { ...input.env };
  const scriptPath = join30(input.repoRoot, "packages", "omo-codex", "plugin", "scripts", "migrate-omo-sot.mjs");
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
import { join as join32 } from "node:path";

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
import { spawn as spawn2 } from "node:child_process";
import { existsSync as existsSync4 } from "node:fs";
import { join as join31 } from "node:path";
var AST_GREP_BIN_DIR_ENV_KEY = "OMO_AST_GREP_BIN_DIR";
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
  const outcome = new Promise((resolve9) => {
    const settle = (result) => {
      if (settled)
        return;
      settled = true;
      resolve9(result);
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
  const env2 = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const repoRoot = resolve9(options.repoRoot ?? findRepoRoot({ importerDir: import.meta.dir, env: env2 }));
  const codexHome = resolve9(options.codexHome ?? env2.CODEX_HOME ?? join35(homedir2(), ".codex"));
  const projectDirectory = resolve9(options.projectDirectory ?? env2.OMO_CODEX_PROJECT ?? process.cwd());
  const binDir = resolveCodexInstallerBinDir({ binDir: options.binDir, codexHome, env: env2 });
  const runCommand = options.runCommand ?? defaultRunCommand;
  const log = options.log ?? (() => {
    return;
  });
  const buildSource = await shouldBuildSourcePackages(repoRoot);
  const versionOverride = env2.LAZYCODEX_DEV_VERSION?.trim() || undefined;
  const gitBashResolution = await prepareGitBashForInstall({
    platform,
    env: env2,
    resolveGitBash: platform === "win32" ? options.gitBashResolver ?? (() => resolveGitBashForCurrentProcess2({ platform, env: env2 })) : undefined
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
    const version2 = resolveLazyCodexPluginVersion({
      manifestVersion: manifest.version,
      marketplaceName: marketplace.name,
      pluginName: entry.name,
      distributionManifest,
      versionOverride
    });
    validatePathSegment(version2, "plugin version");
    log(`Building ${entry.name}@${version2}`);
    const plugin = await installCachedPlugin({
      buildSource,
      codexHome,
      env: env2,
      marketplaceName: marketplace.name,
      name: entry.name,
      runCommand,
      sourcePath,
      version: version2
    });
    if (marketplace.name === "sisyphuslabs" && plugin.name === "omo") {
      await stampLazyCodexPluginVersion({ pluginRoot: plugin.path, version: version2 });
      await writeLazyCodexInstallSnapshot({ pluginRoot: plugin.path, distributionManifest });
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
        log(`Warning: skipped the omo runtime wrapper because ${join35(repoRoot, "dist", "cli", "index.js")} is missing; omo ulw-loop commands will be unavailable until a package shipping dist/cli is installed`);
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
    codegraphMcpEnabled: options.codegraphMcpEnabled ?? resolveCodegraphNodeSupport({ env: env2 }).supported,
    gitBashEnabled: platform === "win32" && gitBashResolution.found,
    trustedHookStates,
    agentConfigs: [...agentConfigs.values()].sort((left, right) => left.name.localeCompare(right.name)),
    autonomousPermissions: options.autonomousPermissions !== false
  });
  await seedAndMigrateOmoSot({ env: env2, log, repoRoot, runCommand });
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
    current = resolve9(current, "..");
  }
  throw new Error("Unable to locate vendored Codex plugin: expected packages/omo-codex/plugin/.codex-plugin/plugin.json in this package or sibling oh-my-openagent package within 7 parent levels");
}
function findRepoRoot(input) {
  const wrapperPackageRoot = input.env?.OMO_WRAPPER_PACKAGE_ROOT;
  if (wrapperPackageRoot !== undefined && wrapperPackageRoot.trim().length > 0) {
    const resolvedWrapperPackageRoot = resolve9(wrapperPackageRoot);
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
  const env2 = invocation.delegatesToOmo ? { ...process.env, OMO_INVOCATION_NAME: "omo", ...invocation.env } : { ...process.env, ...invocation.env };
  await options.runCommand(invocation.command, invocation.args, { cwd: options.cwd, env: env2 });
}
function buildDelegatedOmoInvocation(parsed) {
  if (parsed.command === "doctor")
    return buildLazyCodexDoctorInvocation(parsed.args);
  if (parsed.command === "install") {
    const args2 = ["--yes", "oh-my-openagent@latest", parsed.command, "--platform=codex"];
    if (parsed.noTui)
      args2.push("--no-tui");
    if (parsed.skipAuth)
      args2.push("--skip-auth");
    if (parsed.autonomousPermissions !== false)
      args2.push("--codex-autonomous");
    if (parsed.autonomousPermissions === false)
      args2.push("--no-codex-autonomous");
    if (parsed.repoRoot)
      args2.push(`--repo-root=${parsed.repoRoot}`);
    return { command: "npx", args: args2, delegatesToOmo: true };
  }
  const args = ["--yes", "--package", "oh-my-openagent", "omo", parsed.command];
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
import { spawn as spawn3, spawnSync as spawnSync3 } from "node:child_process";
import { readFileSync as readFileSync4 } from "node:fs";
import { dirname as dirname11, join as join37 } from "node:path";
import { createInterface as createInterface2 } from "node:readline/promises";
import { fileURLToPath } from "node:url";

// packages/omo-codex/src/install/lazycodex-bun-global-paths.ts
import { join as join36 } from "node:path";
function isBunGlobalEntrypointPath(invokedPath, env2) {
  if (typeof invokedPath !== "string" || invokedPath.trim().length === 0)
    return false;
  const normalizedPath = normalizePathForPrefix(invokedPath);
  return resolveBunGlobalRoots(env2).some((root) => normalizedPath.startsWith(root));
}
function resolveBunGlobalRoots(env2) {
  const bunInstallRoot = env2.BUN_INSTALL?.trim();
  const homeRoot = env2.HOME?.trim();
  return [
    ...bunInstallRoot ? [join36(bunInstallRoot, "bin"), join36(bunInstallRoot, "install", "global", "node_modules")] : [],
    ...homeRoot ? [join36(homeRoot, ".bun", "bin"), join36(homeRoot, ".bun", "install", "global", "node_modules")] : []
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
  const env2 = input.env ?? process.env;
  const log = input.log ?? console.log;
  const commandRunner = input.runCommand ?? defaultRunCommandForManualUpdate;
  const currentVersion = resolveCurrentVersion(env2);
  const latestVersion = resolveLatestVersion(env2);
  const plan = resolveLazyCodexUpdatePlan({
    currentVersion,
    latestVersion,
    command: resolveCommand2(env2),
    args: resolveArgs(env2),
    env: env2,
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
  await commandRunner(plan.command, plan.args, { cwd: process.cwd(), env: env2 });
  if (plan.postUpdate === "bun-global-trust") {
    await handleBunGlobalTrust({
      env: env2,
      log,
      commandRunner,
      isInteractive: input.isInteractive ?? (process.stdin.isTTY === true && process.stdout.isTTY === true)
    });
    await commandRunner(DEFAULT_UPDATE_COMMAND, DEFAULT_UPDATE_ARGS, { cwd: process.cwd(), env: env2 });
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
function resolveCommand2(env2) {
  return env2.LAZYCODEX_AUTO_UPDATE_COMMAND?.trim() || DEFAULT_UPDATE_COMMAND;
}
function resolveArgs(env2) {
  if (env2.LAZYCODEX_AUTO_UPDATE_ARGS_JSON) {
    const parsed = JSON.parse(env2.LAZYCODEX_AUTO_UPDATE_ARGS_JSON);
    if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string")) {
      throw new TypeError("LAZYCODEX_AUTO_UPDATE_ARGS_JSON must be a JSON string array");
    }
    return parsed;
  }
  return DEFAULT_UPDATE_ARGS;
}
function resolveCurrentVersion(env2) {
  if (env2.LAZYCODEX_CURRENT_VERSION?.trim())
    return env2.LAZYCODEX_CURRENT_VERSION.trim();
  const pluginRoot = dirname11(dirname11(fileURLToPath(import.meta.url)));
  return readVersionManifest(resolveInstalledVersionPath(env2, pluginRoot)) ?? readVersionManifest(join37(pluginRoot, "..", "..", "..", "package.json")) ?? readVersionManifest(join37(pluginRoot, ".codex-plugin", "plugin.json"));
}
function resolveLatestVersion(env2) {
  if (env2.LAZYCODEX_LATEST_VERSION?.trim())
    return env2.LAZYCODEX_LATEST_VERSION.trim();
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
function resolveKnownBunGlobalUntrustedPackages(env2) {
  const result = spawnSync3(BUN_UPDATE_COMMAND, BUN_GLOBAL_UNTRUSTED_ARGS, {
    encoding: "utf8",
    env: env2,
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
function isBunGlobalEntrypoint(invokedPath, env2) {
  return isBunGlobalEntrypointPath(invokedPath, env2);
}
function defaultRunCommandForManualUpdate(command, args, options) {
  return new Promise((resolve10, reject) => {
    const child = spawn3(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: "inherit",
      shell: false
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve10();
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
function resolveInstalledVersionPath(env2, pluginRoot) {
  if (env2.LAZYCODEX_INSTALLED_VERSION_FILE?.trim())
    return env2.LAZYCODEX_INSTALLED_VERSION_FILE.trim();
  return join37(pluginRoot, INSTALLED_VERSION_FILE);
}
function readVersionManifest(path2) {
  try {
    const parsed = JSON.parse(readFileSync4(path2, "utf8"));
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
import { readFile as readFile21, writeFile as writeFile12 } from "node:fs/promises";
import { join as join38 } from "node:path";
var GIT_BASH_ENV_KEY2 = "OMO_CODEX_GIT_BASH_PATH";
var CODEGRAPH_RELATIVE_ARGS2 = new Set(["components/codegraph/dist/serve.js", "./components/codegraph/dist/serve.js"]);
async function stampGitBashMcpEnv(input) {
  const manifestPath = join38(input.pluginRoot, ".mcp.json");
  if (!await fileExistsStrict(manifestPath))
    return false;
  const parsed = JSON.parse(await readFile21(manifestPath, "utf8"));
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
  await writeFile12(manifestPath, `${JSON.stringify(parsed, null, "\t")}
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
  codegraphServer["args"] = [join38(pluginRoot, "components", "codegraph", "dist", "serve.js"), ...args.slice(1)];
  return true;
}

// packages/omo-codex/src/install/install-local-cli.ts
async function installMarketplaceLocally(options = {}) {
  return runCodexInstaller(options);
}
function resolveDefaultRepoRootForEntrypoint(entrypointPath) {
  return resolve10(dirname12(entrypointPath), "..", "..", "..");
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
    const packageJson = JSON.parse(await readFile22(join39(input.defaultRepoRoot, "package.json"), "utf8"));
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
        repoRoot: resolve10(parsed.repoRoot),
        autonomousPermissions: true,
        env: input.env,
        log: logWarning
      });
      input.log(`Installed ${result2.installed.length} plugin(s) from ${result2.marketplaceName}.`);
      return 0;
    }
    return runLazyCodexManualUpdate({ env: input.env, dryRun: parsed.dryRun, log: input.log, invokedPath: input.invokedPath });
  }
  const repoRoot = parsed.repoRoot ? resolve10(parsed.repoRoot) : input.defaultRepoRoot;
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
