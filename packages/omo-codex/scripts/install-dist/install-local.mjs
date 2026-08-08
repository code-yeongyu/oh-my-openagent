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
import { accessSync as accessSync2, constants as constants2, mkdirSync as mkdirSync2 } from "node:fs";
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
    mkdirSync2(preferredDir, { recursive: true });
    accessSync2(preferredDir, constants2.W_OK);
    return preferredDir;
  } catch (error) {
    if (!(error instanceof Error))
      throw error;
    const fallbackDir = path.join(osProvider.tmpdir(), fallbackSuffix);
    mkdirSync2(fallbackDir, { recursive: true });
    return fallbackDir;
  }
}
var init_xdg_data_dir = () => {};

// packages/utils/src/atomic-write.ts
import {
  closeSync,
  fsyncSync,
  openSync,
  renameSync as renameSync2,
  unlinkSync as unlinkSync2,
  writeFileSync as writeFileSync2
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
  writeFileSync2(tempPath, content, "utf-8");
  const tempFileDescriptor = openSync(tempPath, "r+");
  try {
    tolerantFsyncSync(tempFileDescriptor, options.fsyncSync ?? fsyncSync);
  } finally {
    closeSync(tempFileDescriptor);
  }
  try {
    renameSync2(tempPath, filePath);
  } catch (error) {
    const isPermissionError = error instanceof Error && (error.message.includes("EPERM") || error.message.includes("EACCES"));
    if ((options.platform ?? process.platform) === "win32" && isPermissionError) {
      unlinkSync2(filePath);
      renameSync2(tempPath, filePath);
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
import { existsSync as existsSync8, mkdirSync as mkdirSync3, readFileSync as readFileSync4 } from "node:fs";
import { basename as basename8, join as join38 } from "node:path";
function resolveTelemetryStateDir(product, options = {}) {
  const dataDir = resolveXdgDataDir(product.cacheDirName, {
    env: options.env,
    osProvider: options.osProvider
  });
  const xdgStateDir = options.env?.XDG_DATA_HOME === undefined ? undefined : join38(options.env.XDG_DATA_HOME, product.cacheDirName);
  if (dataDir === xdgStateDir || xdgStateDir === undefined && basename8(dataDir) === product.cacheDirName) {
    return dataDir;
  }
  return join38(dataDir, product.cacheDirName);
}
function getTelemetryActivityStateFilePath(stateDir) {
  return join38(stateDir, POSTHOG_ACTIVITY_STATE_FILE);
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
function getUtcDayString(date3) {
  return date3.toISOString().slice(0, 10);
}
function isPostHogActivityState(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function readPostHogActivityState(stateDir, diagnostics) {
  const stateFilePath = getTelemetryActivityStateFilePath(stateDir);
  if (!existsSync8(stateFilePath)) {
    return {};
  }
  try {
    const stateContent = readFileSync4(stateFilePath, "utf-8");
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
    mkdirSync3(stateDir, { recursive: true });
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
import { appendFileSync, existsSync as existsSync9, mkdirSync as mkdirSync4, readFileSync as readFileSync5 } from "node:fs";
import { join as join39 } from "node:path";
function getTelemetryDiagnosticsFilePath(diagnosticsDir) {
  return join39(diagnosticsDir, DIAGNOSTICS_FILE_NAME);
}
function writeTelemetryDiagnostic(input, options) {
  const now = options.now ?? new Date;
  try {
    cleanupTelemetryDiagnostics({ diagnosticsDir: options.diagnosticsDir, now });
    mkdirSync4(options.diagnosticsDir, { recursive: true });
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
  if (!existsSync9(diagnosticsFilePath)) {
    return;
  }
  try {
    const cutoffMs = (options.now ?? new Date).getTime() - DIAGNOSTICS_RETENTION_MS;
    const retainedLines = trimToMaxBytes(readFileSync5(diagnosticsFilePath, "utf-8").split(`
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
  const timestamp2 = parsed?.["timestamp"];
  if (typeof timestamp2 !== "string") {
    return false;
  }
  const timestampMs = Date.parse(timestamp2);
  return Number.isFinite(timestampMs) && timestampMs >= cutoffMs;
}
function parseDiagnosticLine(line) {
  try {
    const parsed = JSON.parse(line);
    if (!isRecord7(parsed)) {
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
function isRecord7(value) {
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
import { dirname as dirname14, posix as posix6, sep as sep7 } from "node:path";
function createModulerModifier() {
  const getModuleFromFileName = createGetModuleFromFilename();
  return async (frames) => {
    for (const frame of frames)
      frame.module = getModuleFromFileName(frame.filename);
    return frames;
  };
}
function createGetModuleFromFilename(basePath = process.argv[1] ? dirname14(process.argv[1]) : process.cwd(), isWindows = sep7 === "\\") {
  const normalizedBase = isWindows ? normalizeWindowsPath(basePath) : basePath;
  return (filename) => {
    if (!filename)
      return;
    const normalizedFilename = isWindows ? normalizeWindowsPath(filename) : filename;
    let { dir, base: file, ext } = posix6.parse(normalizedFilename);
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
function isPlainObject4(candidate) {
  return isBuiltin(candidate, "Object");
}
function isInstanceOf(candidate, base) {
  try {
    return candidate instanceof base;
  } catch {
    return false;
  }
}
var nativeIsArray, ObjProto, type_utils_hasOwnProperty, type_utils_toString, isArray, isObject2 = (x) => x === Object(x) && !isArray(x), isUndefined = (x) => x === undefined, isString = (x) => type_utils_toString.call(x) == "[object String]", isEmptyString = (x) => isString(x) && x.trim().length === 0, isNumber = (x) => type_utils_toString.call(x) == "[object Number]" && x === x, isPlainError = (x) => x instanceof Error;
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
  static parse(uuid2) {
    let hex;
    switch (uuid2.length) {
      case 32:
        hex = /^[0-9a-f]{32}$/i.exec(uuid2)?.[0];
        break;
      case 36:
        hex = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/i.exec(uuid2)?.slice(1, 6).join("");
        break;
      case 38:
        hex = /^\{([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\}$/i.exec(uuid2)?.slice(1, 6).join("");
        break;
      case 45:
        hex = /^urn:uuid:([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/i.exec(uuid2)?.slice(1, 6).join("");
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
          const version2 = match[1];
          let osVersion = windowsVersionMap[version2] || "";
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
        let version2 = "";
        if (match && match.length >= 3)
          version2 = isUndefined(match[2]) ? match[3] : match[2];
        return [
          "watchOS",
          version2
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
    let object2;
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
        object2 = functionName.slice(0, methodStart);
        method = functionName.slice(methodStart + 1);
        const objectEnd = object2.indexOf(".Module");
        if (objectEnd > 0) {
          functionName = functionName.slice(objectEnd + 1);
          object2 = object2.slice(0, objectEnd);
        }
      }
      typeName = undefined;
    }
    if (method) {
      typeName = object2;
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
  constructor(_maxSize2) {
    this._maxSize = _maxSize2;
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
function resolveExceptionStepsConfig(config2) {
  if (!config2)
    return {
      ...DEFAULT_EXCEPTION_STEPS_CONFIG
    };
  return {
    enabled: config2.enabled ?? DEFAULT_EXCEPTION_STEPS_CONFIG.enabled,
    max_bytes: normalizePositiveInteger(config2.max_bytes, DEFAULT_EXCEPTION_STEPS_CONFIG.max_bytes)
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
  constructor(config2) {
    this._entries = [];
    this._totalBytes = 0;
    this._config = resolveExceptionStepsConfig(config2);
  }
  setConfig(config2) {
    this._config = resolveExceptionStepsConfig(config2);
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
    if (!isObject2(parsed))
      return;
    const parsedStep = parsed;
    const message = parsedStep[EXCEPTION_STEP_INTERNAL_FIELDS.MESSAGE];
    const timestamp2 = parsedStep[EXCEPTION_STEP_INTERNAL_FIELDS.TIMESTAMP];
    if (!isString(message) || message.trim().length === 0)
      return;
    if (!isString(timestamp2) && !isNumber(timestamp2))
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
  return new Promise((resolve11) => {
    const stream = createReadStream(path2);
    const lineReaded = createInterface({
      input: stream
    });
    function destroyStreamAndResolve() {
      stream.destroy();
      resolve11();
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
var version2 = "5.35.12";
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
    const errors2 = [];
    if (this._errorsWhileComputing)
      errors2.push(FeatureFlagError2.ERRORS_WHILE_COMPUTING);
    if (this._quotaLimited)
      errors2.push(FeatureFlagError2.QUOTA_LIMITED);
    if (flag === undefined)
      errors2.push(FeatureFlagError2.FLAG_MISSING);
    if (errors2.length > 0)
      properties.$feature_flag_error = errors2.join(",");
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
      const cached2 = await this.cacheProvider.getFlagDefinitions();
      if (cached2) {
        this.updateFlagState(cached2);
        this.logMsgIfDebug(() => console.debug(`[FEATURE FLAGS] ${debugMessage} (${cached2.flags.length} flags)`));
        this.onLoad?.(this.featureFlags.length);
        this.warnAboutExperienceContinuityFlags(cached2.flags);
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
    const date3 = new Date(value);
    if (!isNaN(date3.valueOf()))
      return date3;
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
    const number3 = parseInt(match.groups["number"]);
    if (number3 >= 1e4)
      return null;
    const interval = match.groups["interval"];
    if (interval == "h")
      parsedDt.setUTCHours(parsedDt.getUTCHours() - number3);
    else if (interval == "d")
      parsedDt.setUTCDate(parsedDt.getUTCDate() - number3);
    else if (interval == "w")
      parsedDt.setUTCDate(parsedDt.getUTCDate() - 7 * number3);
    else if (interval == "m")
      parsedDt.setUTCMonth(parsedDt.getUTCMonth() - number3);
    else {
      if (interval != "y")
        return null;
      parsedDt.setUTCFullYear(parsedDt.getUTCFullYear() - number3);
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
    return isObject2(x) && "__posthog_previously_captured_error" in x && x.__posthog_previously_captured_error === true;
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
        let resolve11;
        const promise = new Promise((r) => {
          resolve11 = r;
        });
        try {
          waitUntil(promise);
        } catch {
          return;
        }
        this._waitUntilCycle = {
          resolve: resolve11,
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
      const resolve11 = this._consumeWaitUntilCycle();
      try {
        await super.flush();
      } catch {} finally {
        resolve11?.();
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
      return version2;
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
      return new Promise((resolve11) => {
        const timeout = setTimeout(() => {
          cleanup();
          resolve11(false);
        }, timeoutMs);
        const cleanup = this._events.on("localEvaluationFlagsLoaded", (count) => {
          clearTimeout(timeout);
          cleanup();
          resolve11(count > 0);
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
          const errors2 = [];
          if (flagsResponse.errorsWhileComputingFlags)
            errors2.push(FeatureFlagError2.ERRORS_WHILE_COMPUTING);
          if (flagsResponse.quotaLimited?.includes("feature_flags"))
            errors2.push(FeatureFlagError2.QUOTA_LIMITED);
          const flagDetail = flagsResponse.flags[key];
          if (flagDetail === undefined)
            errors2.push(FeatureFlagError2.FLAG_MISSING);
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
          if (errors2.length > 0)
            featureFlagError = errors2.join(",");
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
      const resolve11 = this._consumeWaitUntilCycle();
      await this.featureFlagsPoller?.stopPoller(shutdownTimeoutMs);
      this.errorTracking.shutdown();
      try {
        return await super._shutdown(shutdownTimeoutMs);
      } finally {
        resolve11?.();
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
        if (isPlainObject4(value) && groups && key in groups) {
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
    captureException(error, distinctId, additionalProperties, uuid2, flags) {
      if (!ErrorTracking.isPreviouslyCapturedError(error)) {
        const syntheticException = new Error("PostHog syntheticException");
        this.addPendingPromise(ErrorTracking.buildEventMessage(this.getErrorPropertiesBuilder(), error, {
          syntheticException
        }, distinctId, additionalProperties).then((msg) => this.capture({
          ...msg,
          uuid: uuid2,
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
      const { distinctId, event, properties, groups, flags, sendFeatureFlags, timestamp: timestamp2, disableGeoip, uuid: uuid2 } = props;
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
        timestamp: timestamp2,
        disableGeoip,
        uuid: uuid2
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
    version: "4.19.4",
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
import { readFile as readFile23 } from "node:fs/promises";
import { dirname as dirname16, join as join44, resolve as resolve12 } from "node:path";
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
import { join as join40, resolve as resolve11 } from "node:path";
import { existsSync as existsSync10 } from "node:fs";
import { homedir as homedir3 } from "node:os";

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
  let rewroteAnyPackageJson = false;
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
    const rewroteLocalFileDependencies = await rewriteCachedPackageLocalFileDependencies(tempPath, input.sourcePath);
    await copyBundledMcpRuntimeDists({ pluginRoot: tempPath, sourceRoot: input.sourcePath });
    await copyRootRuntimeDists({ pluginRoot: tempPath, sourcePath: input.sourcePath });
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
import { copyFile, lstat as lstat9, mkdir as mkdir6, readFile as readFile15, readdir as readdir7, rm as rm8, writeFile as writeFile7 } from "node:fs/promises";
import { basename as basename6, join as join27 } from "node:path";

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
    var _a2;
    const inst = params?.Parent ? new Definition : this;
    init(inst, def);
    (_a2 = inst._zod).deferred ?? (_a2.deferred = []);
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
var exports_util = {};
__export(exports_util, {
  unwrapMessage: () => unwrapMessage,
  uint8ArrayToHex: () => uint8ArrayToHex,
  uint8ArrayToBase64url: () => uint8ArrayToBase64url,
  uint8ArrayToBase64: () => uint8ArrayToBase64,
  stringifyPrimitive: () => stringifyPrimitive,
  slugify: () => slugify,
  shallowClone: () => shallowClone,
  safeExtend: () => safeExtend,
  required: () => required,
  randomString: () => randomString,
  propertyKeyTypes: () => propertyKeyTypes,
  promiseAllObject: () => promiseAllObject,
  primitiveTypes: () => primitiveTypes,
  prefixIssues: () => prefixIssues,
  pick: () => pick,
  partial: () => partial,
  parsedType: () => parsedType,
  optionalKeys: () => optionalKeys,
  omit: () => omit,
  objectClone: () => objectClone,
  numKeys: () => numKeys,
  nullish: () => nullish,
  normalizeParams: () => normalizeParams,
  mergeDefs: () => mergeDefs,
  merge: () => merge,
  jsonStringifyReplacer: () => jsonStringifyReplacer,
  joinValues: () => joinValues,
  issue: () => issue,
  isPlainObject: () => isPlainObject,
  isObject: () => isObject,
  hexToUint8Array: () => hexToUint8Array,
  getSizableOrigin: () => getSizableOrigin,
  getParsedType: () => getParsedType,
  getLengthableOrigin: () => getLengthableOrigin,
  getEnumValues: () => getEnumValues,
  getElementAtPath: () => getElementAtPath,
  floatSafeRemainder: () => floatSafeRemainder,
  finalizeIssue: () => finalizeIssue,
  extend: () => extend,
  explicitlyAborted: () => explicitlyAborted,
  escapeRegex: () => escapeRegex,
  esc: () => esc,
  defineLazy: () => defineLazy,
  createTransparentProxy: () => createTransparentProxy,
  cloneDef: () => cloneDef,
  clone: () => clone,
  cleanRegex: () => cleanRegex,
  cleanEnum: () => cleanEnum,
  captureStackTrace: () => captureStackTrace,
  cached: () => cached,
  base64urlToUint8Array: () => base64urlToUint8Array,
  base64ToUint8Array: () => base64ToUint8Array,
  assignProp: () => assignProp,
  assertNotEqual: () => assertNotEqual,
  assertNever: () => assertNever,
  assertIs: () => assertIs,
  assertEqual: () => assertEqual,
  assert: () => assert,
  allowsEval: () => allowsEval,
  aborted: () => aborted,
  NUMBER_FORMAT_RANGES: () => NUMBER_FORMAT_RANGES,
  Class: () => Class,
  BIGINT_FORMAT_RANGES: () => BIGINT_FORMAT_RANGES
});
function assertEqual(val) {
  return val;
}
function assertNotEqual(val) {
  return val;
}
function assertIs(_arg) {}
function assertNever(_x) {
  throw new Error("Unexpected value in exhaustive check");
}
function assert(_) {}
function getEnumValues(entries) {
  const numericValues = Object.values(entries).filter((v) => typeof v === "number");
  const values = Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
  return values;
}
function joinValues(array, separator = "|") {
  return array.map((val) => stringifyPrimitive(val)).join(separator);
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
function objectClone(obj) {
  return Object.create(Object.getPrototypeOf(obj), Object.getOwnPropertyDescriptors(obj));
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
function cloneDef(schema) {
  return mergeDefs(schema._zod.def);
}
function getElementAtPath(obj, path) {
  if (!path)
    return obj;
  return path.reduce((acc, key) => acc?.[key], obj);
}
function promiseAllObject(promisesObj) {
  const keys = Object.keys(promisesObj);
  const promises = keys.map((key) => promisesObj[key]);
  return Promise.all(promises).then((results) => {
    const resolvedObj = {};
    for (let i = 0;i < keys.length; i++) {
      resolvedObj[keys[i]] = results[i];
    }
    return resolvedObj;
  });
}
function randomString(length = 10) {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  let str = "";
  for (let i = 0;i < length; i++) {
    str += chars[Math.floor(Math.random() * chars.length)];
  }
  return str;
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
function numKeys(data) {
  let keyCount = 0;
  for (const key in data) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      keyCount++;
    }
  }
  return keyCount;
}
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return "undefined";
    case "string":
      return "string";
    case "number":
      return Number.isNaN(data) ? "nan" : "number";
    case "boolean":
      return "boolean";
    case "function":
      return "function";
    case "bigint":
      return "bigint";
    case "symbol":
      return "symbol";
    case "object":
      if (Array.isArray(data)) {
        return "array";
      }
      if (data === null) {
        return "null";
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return "promise";
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return "map";
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return "set";
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return "date";
      }
      if (typeof File !== "undefined" && data instanceof File) {
        return "file";
      }
      return "object";
    default:
      throw new Error(`Unknown data type: ${t}`);
  }
};
var propertyKeyTypes = /* @__PURE__ */ new Set(["string", "number", "symbol"]);
var primitiveTypes = /* @__PURE__ */ new Set([
  "string",
  "number",
  "bigint",
  "boolean",
  "symbol",
  "undefined"
]);
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
function createTransparentProxy(getter) {
  let target;
  return new Proxy({}, {
    get(_, prop, receiver) {
      target ?? (target = getter());
      return Reflect.get(target, prop, receiver);
    },
    set(_, prop, value, receiver) {
      target ?? (target = getter());
      return Reflect.set(target, prop, value, receiver);
    },
    has(_, prop) {
      target ?? (target = getter());
      return Reflect.has(target, prop);
    },
    deleteProperty(_, prop) {
      target ?? (target = getter());
      return Reflect.deleteProperty(target, prop);
    },
    ownKeys(_) {
      target ?? (target = getter());
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(_, prop) {
      target ?? (target = getter());
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
    defineProperty(_, prop, descriptor) {
      target ?? (target = getter());
      return Reflect.defineProperty(target, prop, descriptor);
    }
  });
}
function stringifyPrimitive(value) {
  if (typeof value === "bigint")
    return value.toString() + "n";
  if (typeof value === "string")
    return `"${value}"`;
  return `${value}`;
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
var BIGINT_FORMAT_RANGES = {
  int64: [/* @__PURE__ */ BigInt("-9223372036854775808"), /* @__PURE__ */ BigInt("9223372036854775807")],
  uint64: [/* @__PURE__ */ BigInt(0), /* @__PURE__ */ BigInt("18446744073709551615")]
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
    var _a2;
    (_a2 = iss).path ?? (_a2.path = []);
    iss.path.unshift(path);
    return iss;
  });
}
function unwrapMessage(message) {
  return typeof message === "string" ? message : message?.message;
}
function finalizeIssue(iss, ctx, config2) {
  const message = iss.message ? iss.message : unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config2.customError?.(iss)) ?? unwrapMessage(config2.localeError?.(iss)) ?? "Invalid input";
  const { inst: _inst, continue: _continue, input: _input, ...rest } = iss;
  rest.path ?? (rest.path = []);
  rest.message = message;
  if (ctx?.reportInput) {
    rest.input = _input;
  }
  return rest;
}
function getSizableOrigin(input) {
  if (input instanceof Set)
    return "set";
  if (input instanceof Map)
    return "map";
  if (input instanceof File)
    return "file";
  return "unknown";
}
function getLengthableOrigin(input) {
  if (Array.isArray(input))
    return "array";
  if (typeof input === "string")
    return "string";
  return "unknown";
}
function parsedType(data) {
  const t = typeof data;
  switch (t) {
    case "number": {
      return Number.isNaN(data) ? "nan" : "number";
    }
    case "object": {
      if (data === null) {
        return "null";
      }
      if (Array.isArray(data)) {
        return "array";
      }
      const obj = data;
      if (obj && Object.getPrototypeOf(obj) !== Object.prototype && "constructor" in obj && obj.constructor) {
        return obj.constructor.name;
      }
    }
  }
  return t;
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
function cleanEnum(obj) {
  return Object.entries(obj).filter(([k, _]) => {
    return Number.isNaN(Number.parseInt(k, 10));
  }).map((el) => el[1]);
}
function base64ToUint8Array(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0;i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}
function uint8ArrayToBase64(bytes) {
  let binaryString = "";
  for (let i = 0;i < bytes.length; i++) {
    binaryString += String.fromCharCode(bytes[i]);
  }
  return btoa(binaryString);
}
function base64urlToUint8Array(base64url) {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - base64.length % 4) % 4);
  return base64ToUint8Array(base64 + padding);
}
function uint8ArrayToBase64url(bytes) {
  return uint8ArrayToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
function hexToUint8Array(hex) {
  const cleanHex = hex.replace(/^0x/, "");
  if (cleanHex.length % 2 !== 0) {
    throw new Error("Invalid hex string length");
  }
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0;i < cleanHex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(cleanHex.slice(i, i + 2), 16);
  }
  return bytes;
}
function uint8ArrayToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

class Class {
  constructor(..._args) {}
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
function flattenError(error, mapper = (issue2) => issue2.message) {
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
function formatError(error, mapper = (issue2) => issue2.message) {
  const fieldErrors = { _errors: [] };
  const processError = (error2, path = []) => {
    for (const issue2 of error2.issues) {
      if (issue2.code === "invalid_union" && issue2.errors.length) {
        issue2.errors.map((issues) => processError({ issues }, [...path, ...issue2.path]));
      } else if (issue2.code === "invalid_key") {
        processError({ issues: issue2.issues }, [...path, ...issue2.path]);
      } else if (issue2.code === "invalid_element") {
        processError({ issues: issue2.issues }, [...path, ...issue2.path]);
      } else {
        const fullpath = [...path, ...issue2.path];
        if (fullpath.length === 0) {
          fieldErrors._errors.push(mapper(issue2));
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
              curr[el]._errors.push(mapper(issue2));
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
  const time2 = timeSource({ precision: args.precision });
  const opts = ["Z"];
  if (args.local)
    opts.push("");
  if (args.offset)
    opts.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
  const timeRegex = `${time2}(?:${opts.join("|")})`;
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
  var _a2;
  inst._zod ?? (inst._zod = {});
  inst._zod.def = def;
  (_a2 = inst._zod).onattach ?? (_a2.onattach = []);
});
var numericOriginMap = {
  number: "number",
  bigint: "bigint",
  object: "date"
};
var $ZodCheckLessThan = /* @__PURE__ */ $constructor("$ZodCheckLessThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
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
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
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
  inst._zod.onattach.push((inst2) => {
    var _a2;
    (_a2 = inst2._zod.bag).multipleOf ?? (_a2.multipleOf = def.value);
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
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
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
  var _a2;
  $ZodCheck.init(inst, def);
  (_a2 = inst._zod.def).when ?? (_a2.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== undefined;
  });
  inst._zod.onattach.push((inst2) => {
    const curr = inst2._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
    if (def.maximum < curr)
      inst2._zod.bag.maximum = def.maximum;
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
  var _a2;
  $ZodCheck.init(inst, def);
  (_a2 = inst._zod.def).when ?? (_a2.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== undefined;
  });
  inst._zod.onattach.push((inst2) => {
    const curr = inst2._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
    if (def.minimum > curr)
      inst2._zod.bag.minimum = def.minimum;
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
  var _a2;
  $ZodCheck.init(inst, def);
  (_a2 = inst._zod.def).when ?? (_a2.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== undefined;
  });
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
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
  var _a2, _b;
  $ZodCheck.init(inst, def);
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.format = def.format;
    if (def.pattern) {
      bag.patterns ?? (bag.patterns = new Set);
      bag.patterns.add(def.pattern);
    }
  });
  if (def.pattern)
    (_a2 = inst._zod).check ?? (_a2.check = (payload) => {
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
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
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
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
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
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
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
  var _a2;
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
    (_a2 = inst._zod).deferred ?? (_a2.deferred = []);
    inst._zod.deferred?.push(() => {
      inst._zod.run = inst._zod.parse;
    });
  } else {
    const runChecks = (payload, checks2, ctx) => {
      let isAborted = aborted(payload);
      let asyncResult;
      for (const ch of checks2) {
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
        return checkResult.then((checkResult2) => inst._zod.parse(checkResult2, ctx));
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
          return canary.then((canary2) => {
            return handleCanaryResult(canary2, payload, ctx);
          });
        }
        return handleCanaryResult(canary, payload, ctx);
      }
      const result = inst._zod.parse(payload, ctx);
      if (result instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError;
        return result.then((result2) => runChecks(result2, checks, ctx));
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
      } catch (_2) {}
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
  const base642 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
  const padded = base642.padEnd(Math.ceil(base642.length / 4) * 4, "=");
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
        proms.push(result.then((result2) => handleArrayResult(result2, payload, i)));
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
      proms.push(r.then((r2) => handlePropertyResult(r2, payload, key, input, isOptionalIn, isOptionalOut)));
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
        proms.push(r.then((r2) => handlePropertyResult(r2, payload, key, input, isOptionalIn, isOptionalOut)));
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
    return Promise.all(results).then((results2) => {
      return handleUnionResults(results2, payload, inst, ctx);
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
      return Promise.all([left, right]).then(([left2, right2]) => {
        return handleIntersectionResults(payload, left2, right2);
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
            proms.push(result.then((result2) => {
              if (result2.issues.length) {
                payload.issues.push(...prefixIssues(key, result2.issues));
              }
              payload.value[outKey] = result2.value;
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
          proms.push(result.then((result2) => {
            if (result2.issues.length) {
              payload.issues.push(...prefixIssues(key, result2.issues));
            }
            payload.value[keyResult.value] = result2.value;
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
      return output.then((output2) => {
        payload.value = output2;
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
      return result.then((result2) => handleDefaultResult(result2, def));
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
      return result.then((result2) => handleNonOptionalResult(result2, inst));
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
      return result.then((result2) => {
        payload.value = result2.value;
        if (result2.issues.length) {
          payload.value = def.catchValue({
            ...payload,
            error: {
              issues: result2.issues.map((iss) => finalizeIssue(iss, ctx, config()))
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
        return right.then((right2) => handlePipeResult(right2, def.in, ctx));
      }
      return handlePipeResult(right, def.in, ctx);
    }
    const left = def.in._zod.run(payload, ctx);
    if (left instanceof Promise) {
      return left.then((left2) => handlePipeResult(left2, def.out, ctx));
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
      return r.then((r2) => handleRefineResult(r2, payload, input, inst));
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
function _string(Class2, params) {
  return new Class2({
    type: "string",
    ...normalizeParams(params)
  });
}
function _email(Class2, params) {
  return new Class2({
    type: "string",
    format: "email",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _guid(Class2, params) {
  return new Class2({
    type: "string",
    format: "guid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _uuid(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _uuidv4(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v4",
    ...normalizeParams(params)
  });
}
function _uuidv6(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v6",
    ...normalizeParams(params)
  });
}
function _uuidv7(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v7",
    ...normalizeParams(params)
  });
}
function _url(Class2, params) {
  return new Class2({
    type: "string",
    format: "url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _emoji2(Class2, params) {
  return new Class2({
    type: "string",
    format: "emoji",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _nanoid(Class2, params) {
  return new Class2({
    type: "string",
    format: "nanoid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cuid(Class2, params) {
  return new Class2({
    type: "string",
    format: "cuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cuid2(Class2, params) {
  return new Class2({
    type: "string",
    format: "cuid2",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ulid(Class2, params) {
  return new Class2({
    type: "string",
    format: "ulid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _xid(Class2, params) {
  return new Class2({
    type: "string",
    format: "xid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ksuid(Class2, params) {
  return new Class2({
    type: "string",
    format: "ksuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ipv4(Class2, params) {
  return new Class2({
    type: "string",
    format: "ipv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ipv6(Class2, params) {
  return new Class2({
    type: "string",
    format: "ipv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cidrv4(Class2, params) {
  return new Class2({
    type: "string",
    format: "cidrv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cidrv6(Class2, params) {
  return new Class2({
    type: "string",
    format: "cidrv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _base64(Class2, params) {
  return new Class2({
    type: "string",
    format: "base64",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _base64url(Class2, params) {
  return new Class2({
    type: "string",
    format: "base64url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _e164(Class2, params) {
  return new Class2({
    type: "string",
    format: "e164",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _jwt(Class2, params) {
  return new Class2({
    type: "string",
    format: "jwt",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _isoDateTime(Class2, params) {
  return new Class2({
    type: "string",
    format: "datetime",
    check: "string_format",
    offset: false,
    local: false,
    precision: null,
    ...normalizeParams(params)
  });
}
function _isoDate(Class2, params) {
  return new Class2({
    type: "string",
    format: "date",
    check: "string_format",
    ...normalizeParams(params)
  });
}
function _isoTime(Class2, params) {
  return new Class2({
    type: "string",
    format: "time",
    check: "string_format",
    precision: null,
    ...normalizeParams(params)
  });
}
function _isoDuration(Class2, params) {
  return new Class2({
    type: "string",
    format: "duration",
    check: "string_format",
    ...normalizeParams(params)
  });
}
function _number(Class2, params) {
  return new Class2({
    type: "number",
    checks: [],
    ...normalizeParams(params)
  });
}
function _int(Class2, params) {
  return new Class2({
    type: "number",
    check: "number_format",
    abort: false,
    format: "safeint",
    ...normalizeParams(params)
  });
}
function _boolean(Class2, params) {
  return new Class2({
    type: "boolean",
    ...normalizeParams(params)
  });
}
function _unknown(Class2) {
  return new Class2({
    type: "unknown"
  });
}
function _never(Class2, params) {
  return new Class2({
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
function _array(Class2, element, params) {
  return new Class2({
    type: "array",
    element,
    ...normalizeParams(params)
  });
}
function _refine(Class2, fn, _params) {
  const schema = new Class2({
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
  var _a3;
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
    (_a3 = result.schema).default ?? (_a3.default = result.schema._prefault);
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
      const uriGenerator = ctx.external.uri ?? ((id2) => id2);
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
    const schema2 = seen.schema;
    for (const key in schema2) {
      delete schema2[key];
    }
    schema2.$ref = ref;
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
    const schema2 = seen.def ?? seen.schema;
    const _cached = { ...schema2 };
    const ref = seen.ref;
    seen.ref = null;
    if (ref) {
      flattenRef(ref);
      const refSeen = ctx.seen.get(ref);
      const refSchema = refSeen.schema;
      if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
        schema2.allOf = schema2.allOf ?? [];
        schema2.allOf.push(refSchema);
      } else {
        Object.assign(schema2, refSchema);
      }
      Object.assign(schema2, _cached);
      const isParentRef = zodSchema._zod.parent === ref;
      if (isParentRef) {
        for (const key in schema2) {
          if (key === "$ref" || key === "allOf")
            continue;
          if (!(key in _cached)) {
            delete schema2[key];
          }
        }
      }
      if (refSchema.$ref && refSeen.def) {
        for (const key in schema2) {
          if (key === "$ref" || key === "allOf")
            continue;
          if (key in refSeen.def && JSON.stringify(schema2[key]) === JSON.stringify(refSeen.def[key])) {
            delete schema2[key];
          }
        }
      }
    }
    const parent = zodSchema._zod.parent;
    if (parent && parent !== ref) {
      flattenRef(parent);
      const parentSeen = ctx.seen.get(parent);
      if (parentSeen?.schema.$ref) {
        schema2.$ref = parentSeen.schema.$ref;
        if (parentSeen.def) {
          for (const key in schema2) {
            if (key === "$ref" || key === "allOf")
              continue;
            if (key in parentSeen.def && JSON.stringify(schema2[key]) === JSON.stringify(parentSeen.def[key])) {
              delete schema2[key];
            }
          }
        }
      }
    }
    ctx.override({
      zodSchema,
      jsonSchema: schema2,
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
  } else if (ctx.target === "openapi-3.0") {} else {}
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
      } else {}
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
      value: (issue2) => {
        inst.issues.push(issue2);
        inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
      }
    },
    addIssues: {
      value: (issues2) => {
        inst.issues.push(...issues2);
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
      const def2 = this.def;
      return this.clone(exports_util.mergeDefs(def2, {
        checks: [
          ...def2.checks ?? [],
          ...chks.map((ch) => typeof ch === "function" ? { _zod: { check: ch, def: { check: "custom" }, onattach: [] } } : ch)
        ]
      }), { parent: true });
    },
    with(...chks) {
      return this.check(...chks);
    },
    clone(def2, params) {
      return clone(this, def2, params);
    },
    brand() {
      return this;
    },
    register(reg, meta2) {
      reg.add(this, meta2);
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
  exports_util.defineLazy(inst, "shape", () => {
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
      return exports_util.extend(this, incoming);
    },
    safeExtend(incoming) {
      return exports_util.safeExtend(this, incoming);
    },
    merge(other) {
      return exports_util.merge(this, other);
    },
    pick(mask) {
      return exports_util.pick(this, mask);
    },
    omit(mask) {
      return exports_util.omit(this, mask);
    },
    partial(...args) {
      return exports_util.partial(ZodOptional, this, args[0]);
    },
    required(...args) {
      return exports_util.required(ZodNonOptional, this, args[0]);
    }
  });
});
function object(shape, params) {
  const def = {
    type: "object",
    shape: shape ?? {},
    ...exports_util.normalizeParams(params)
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
    ...exports_util.normalizeParams(params)
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
    ...exports_util.normalizeParams(params)
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
      ...exports_util.normalizeParams(valueType)
    });
  }
  return new ZodRecord({
    type: "record",
    keyType,
    valueType,
    ...exports_util.normalizeParams(params)
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
      ...exports_util.normalizeParams(params),
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
      ...exports_util.normalizeParams(params),
      entries: newEntries
    });
  };
});
function _enum(values, params) {
  const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
  return new ZodEnum({
    type: "enum",
    entries,
    ...exports_util.normalizeParams(params)
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
    ...exports_util.normalizeParams(params)
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
        payload.issues.push(exports_util.issue(issue2, payload.value, def));
      } else {
        const _issue = issue2;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        _issue.input ?? (_issue.input = payload.value);
        _issue.inst ?? (_issue.inst = inst);
        payload.issues.push(exports_util.issue(_issue));
      }
    };
    const output = def.transform(payload.value, payload);
    if (output instanceof Promise) {
      return output.then((output2) => {
        payload.value = output2;
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
      return typeof defaultValue === "function" ? defaultValue() : exports_util.shallowClone(defaultValue);
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
      return typeof defaultValue === "function" ? defaultValue() : exports_util.shallowClone(defaultValue);
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
    ...exports_util.normalizeParams(params)
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
function isRecord2(value) {
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
  const thinking = isRecord2(entry["thinking"]) ? entry["thinking"] : undefined;
  const reasoning = explicitReasoning ?? reasoningEffort ?? variant ?? (thinking?.["type"] === "disabled" ? "off" : undefined);
  if (reasoning !== undefined)
    normalized["reasoning"] = reasoning;
  const providerOptions = isRecord2(entry["provider_options"]) ? { ...entry["provider_options"] } : isRecord2(entry["providerOptions"]) ? { ...entry["providerOptions"] } : {};
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
var OmoFallbackModelObjectSchema = preprocess((value) => isRecord2(value) ? normalizeLegacyModelFields(value) : value, OmoLegacyFallbackModelObjectInputSchema);
var OmoFallbackModelsSchema = union([
  string2(),
  array(string2()),
  array(OmoFallbackModelObjectSchema),
  array(union([string2(), OmoFallbackModelObjectSchema]))
]);

// packages/omo-config-core/src/schema/agent.ts
function isRecord3(value) {
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
  provider_options: record(string2(), unknown()).optional(),
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
var OmoAgentDefSchema = preprocess((value) => isRecord3(value) ? normalizeLegacyModelFields(value) : value, OmoAgentDefInputSchema);
var OmoAgentsConfigSchema = record(string2(), OmoAgentDefSchema);

// packages/omo-config-core/src/schema/category.ts
function isRecord4(value) {
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
var OmoCategoryConfigSchema = preprocess((value) => isRecord4(value) ? normalizeLegacyModelFields(value) : value, OmoCategoryConfigObjectSchema);
var OmoCategoriesConfigSchema = record(string2(), OmoCategoryConfigSchema);

// packages/omo-config-core/src/schema/harness.ts
var HARNESS_IDS = ["codex", "opencode", "omo"];
var OMO_CONFIG_HARNESS_IDS = ["opencode", "senpi", "codex"];
var OmoHarnessIdSchema = _enum(OMO_CONFIG_HARNESS_IDS);

// packages/omo-config-core/src/schema/codegraph.ts
var OmoCodegraphSettingsShape = {
  enabled: boolean2(),
  auto_provision: boolean2(),
  daemon: boolean2(),
  telemetry: boolean2(),
  install_dir: string2().optional(),
  watch_debounce_ms: number2().finite().nonnegative().optional(),
  excluded_roots: array(string2()).optional(),
  session_start_cooldown_ms: number2().finite().min(60000).optional()
};
var OmoCodegraphSettingsLayerSchema = object(OmoCodegraphSettingsShape).partial().strict();
var OmoCodegraphSettingsSchema = OmoCodegraphSettingsLayerSchema.extend({
  enabled: boolean2().default(true),
  auto_provision: boolean2().default(true),
  daemon: boolean2().default(true),
  telemetry: boolean2().default(false)
}).strict();

// packages/omo-config-core/src/schema/model-catalog.ts
function isRecord5(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var OmoModelCatalogEntryInputSchema = object({
  model: string2(),
  reasoning: OmoReasoningSchema.optional(),
  variant: string2().optional(),
  reasoningEffort: OmoReasoningEffortSchema.optional()
}).strict();
var OmoModelCatalogEntrySchema = preprocess((value) => isRecord5(value) ? normalizeLegacyModelFields(value) : value, OmoModelCatalogEntryInputSchema);
var OmoModelCatalogSchema = record(string2(), OmoModelCatalogEntrySchema);
var OmoModelCatalogEntryLayerInputSchema = OmoModelCatalogEntryInputSchema.partial();
var OmoModelCatalogEntryLayerSchema = preprocess((value) => isRecord5(value) ? normalizeLegacyModelFields(value) : value, OmoModelCatalogEntryLayerInputSchema);
var OmoModelCatalogLayerSchema = record(string2(), OmoModelCatalogEntryLayerSchema);

// packages/omo-config-core/src/schema/task.ts
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
var OmoTaskSettingsSchema = object({
  default_execution_mode: _enum(["in-process", "process"]).default("in-process"),
  default_concurrency: number2().int().positive().default(5),
  provider_concurrency: record(string2(), number2().int().positive()).optional(),
  model_concurrency: record(string2(), number2().int().positive()).optional(),
  max_depth: number2().int().nonnegative().default(1),
  residency_max_children: number2().int().positive().default(8),
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
  })
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
  default_concurrency: number2().int().positive().optional(),
  provider_concurrency: record(string2(), number2().int().positive()).optional(),
  model_concurrency: record(string2(), number2().int().positive()).optional(),
  max_depth: number2().int().nonnegative().optional(),
  residency_max_children: number2().int().positive().optional(),
  ttl_ms: number2().int().positive().optional(),
  state_dir: string2().optional(),
  reattach_on_reconcile: boolean2().optional(),
  resume_children: boolean2().optional(),
  warnings: OmoTaskWarningsLayerSchema.optional(),
  wait: OmoTaskWaitLayerSchema.optional(),
  team: OmoTaskTeamSettingsLayerSchema.optional()
}).strict();

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

// packages/omo-config-core/src/schema/config.ts
var OmoOpenCodeHarnessConfigSchema = record(string2(), unknown());
var OmoTypedHarnessConfigSchema = object({
  categories: OmoCategoriesConfigSchema.optional(),
  agents: OmoAgentsConfigSchema.optional(),
  codegraph: OmoCodegraphSettingsLayerSchema.optional(),
  task: OmoTaskSettingsLayerSchema.optional(),
  teams: OmoTeamsConfigLayerSchema.optional(),
  models: OmoModelCatalogLayerSchema.optional()
}).strict();
var OmoConfigProfileSchema = object({
  categories: OmoCategoriesConfigSchema.optional(),
  agents: OmoAgentsConfigSchema.optional(),
  codegraph: OmoCodegraphSettingsLayerSchema.optional(),
  task: OmoTaskSettingsLayerSchema.optional(),
  teams: OmoTeamsConfigLayerSchema.optional(),
  models: OmoModelCatalogLayerSchema.optional(),
  "[opencode]": OmoOpenCodeHarnessConfigSchema.optional(),
  "[senpi]": OmoTypedHarnessConfigSchema.optional(),
  "[codex]": OmoTypedHarnessConfigSchema.optional()
}).strict();
var OmoConfigSchema = object({
  $schema: string2().optional(),
  categories: OmoCategoriesConfigSchema.optional(),
  agents: OmoAgentsConfigSchema.optional(),
  codegraph: OmoCodegraphSettingsSchema.optional(),
  task: OmoTaskSettingsSchema.optional(),
  teams: OmoTeamsConfigSchema.optional(),
  models: OmoModelCatalogSchema.optional(),
  "[opencode]": OmoOpenCodeHarnessConfigSchema.optional(),
  "[senpi]": OmoTypedHarnessConfigSchema.optional(),
  "[codex]": OmoTypedHarnessConfigSchema.optional(),
  profiles: record(string2(), OmoConfigProfileSchema).default({}),
  _migrations: array(string2()).optional(),
  legacy_migrations: record(string2(), unknown()).optional()
}).strict();
var OmoConfigLayerSchema = object({
  $schema: string2().optional(),
  categories: OmoCategoriesConfigSchema.optional(),
  agents: OmoAgentsConfigSchema.optional(),
  codegraph: OmoCodegraphSettingsLayerSchema.optional(),
  task: OmoTaskSettingsLayerSchema.optional(),
  teams: OmoTeamsConfigLayerSchema.optional(),
  models: OmoModelCatalogLayerSchema.optional(),
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
    let value2 = 0;
    while (digits < count || !exact) {
      let ch = text.charCodeAt(pos);
      if (ch >= 48 && ch <= 57) {
        value2 = value2 * 16 + ch - 48;
      } else if (ch >= 65 && ch <= 70) {
        value2 = value2 * 16 + ch - 65 + 10;
      } else if (ch >= 97 && ch <= 102) {
        value2 = value2 * 16 + ch - 97 + 10;
      } else {
        break;
      }
      pos++;
      digits++;
    }
    if (digits < count) {
      value2 = -1;
    }
    return value2;
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
var supportedEols = [`
`, "\r", `\r
`];

// node_modules/.bun/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/impl/format.js
function format(documentText, range, options) {
  let initialIndentLevel;
  let formatText;
  let formatTextStart;
  let rangeStart;
  let rangeEnd;
  if (range) {
    rangeStart = range.offset;
    rangeEnd = rangeStart + range.length;
    formatTextStart = rangeStart;
    while (formatTextStart > 0 && !isEOL(documentText, formatTextStart - 1)) {
      formatTextStart--;
    }
    let endOffset = rangeEnd;
    while (endOffset < documentText.length && !isEOL(documentText, endOffset)) {
      endOffset++;
    }
    formatText = documentText.substring(formatTextStart, endOffset);
    initialIndentLevel = computeIndentLevel(formatText, options);
  } else {
    formatText = documentText;
    initialIndentLevel = 0;
    formatTextStart = 0;
    rangeStart = 0;
    rangeEnd = documentText.length;
  }
  const eol = getEOL(options, documentText);
  const eolFastPathSupported = supportedEols.includes(eol);
  let numberLineBreaks = 0;
  let indentLevel = 0;
  let indentValue;
  if (options.insertSpaces) {
    indentValue = cachedSpaces[options.tabSize || 4] ?? repeat(cachedSpaces[1], options.tabSize || 4);
  } else {
    indentValue = "\t";
  }
  const indentType = indentValue === "\t" ? "\t" : " ";
  let scanner = createScanner(formatText, false);
  let hasError = false;
  function newLinesAndIndent() {
    if (numberLineBreaks > 1) {
      return repeat(eol, numberLineBreaks) + repeat(indentValue, initialIndentLevel + indentLevel);
    }
    const amountOfSpaces = indentValue.length * (initialIndentLevel + indentLevel);
    if (!eolFastPathSupported || amountOfSpaces > cachedBreakLinesWithSpaces[indentType][eol].length) {
      return eol + repeat(indentValue, initialIndentLevel + indentLevel);
    }
    if (amountOfSpaces <= 0) {
      return eol;
    }
    return cachedBreakLinesWithSpaces[indentType][eol][amountOfSpaces];
  }
  function scanNext() {
    let token = scanner.scan();
    numberLineBreaks = 0;
    while (token === 15 || token === 14) {
      if (token === 14 && options.keepLines) {
        numberLineBreaks += 1;
      } else if (token === 14) {
        numberLineBreaks = 1;
      }
      token = scanner.scan();
    }
    hasError = token === 16 || scanner.getTokenError() !== 0;
    return token;
  }
  const editOperations = [];
  function addEdit(text, startOffset, endOffset) {
    if (!hasError && (!range || startOffset < rangeEnd && endOffset > rangeStart) && documentText.substring(startOffset, endOffset) !== text) {
      editOperations.push({ offset: startOffset, length: endOffset - startOffset, content: text });
    }
  }
  let firstToken = scanNext();
  if (options.keepLines && numberLineBreaks > 0) {
    addEdit(repeat(eol, numberLineBreaks), 0, 0);
  }
  if (firstToken !== 17) {
    let firstTokenStart = scanner.getTokenOffset() + formatTextStart;
    let initialIndent = indentValue.length * initialIndentLevel < 20 && options.insertSpaces ? cachedSpaces[indentValue.length * initialIndentLevel] : repeat(indentValue, initialIndentLevel);
    addEdit(initialIndent, formatTextStart, firstTokenStart);
  }
  while (firstToken !== 17) {
    let firstTokenEnd = scanner.getTokenOffset() + scanner.getTokenLength() + formatTextStart;
    let secondToken = scanNext();
    let replaceContent = "";
    let needsLineBreak = false;
    while (numberLineBreaks === 0 && (secondToken === 12 || secondToken === 13)) {
      let commentTokenStart = scanner.getTokenOffset() + formatTextStart;
      addEdit(cachedSpaces[1], firstTokenEnd, commentTokenStart);
      firstTokenEnd = scanner.getTokenOffset() + scanner.getTokenLength() + formatTextStart;
      needsLineBreak = secondToken === 12;
      replaceContent = needsLineBreak ? newLinesAndIndent() : "";
      secondToken = scanNext();
    }
    if (secondToken === 2) {
      if (firstToken !== 1) {
        indentLevel--;
      }
      if (options.keepLines && numberLineBreaks > 0 || !options.keepLines && firstToken !== 1) {
        replaceContent = newLinesAndIndent();
      } else if (options.keepLines) {
        replaceContent = cachedSpaces[1];
      }
    } else if (secondToken === 4) {
      if (firstToken !== 3) {
        indentLevel--;
      }
      if (options.keepLines && numberLineBreaks > 0 || !options.keepLines && firstToken !== 3) {
        replaceContent = newLinesAndIndent();
      } else if (options.keepLines) {
        replaceContent = cachedSpaces[1];
      }
    } else {
      switch (firstToken) {
        case 3:
        case 1:
          indentLevel++;
          if (options.keepLines && numberLineBreaks > 0 || !options.keepLines) {
            replaceContent = newLinesAndIndent();
          } else {
            replaceContent = cachedSpaces[1];
          }
          break;
        case 5:
          if (options.keepLines && numberLineBreaks > 0 || !options.keepLines) {
            replaceContent = newLinesAndIndent();
          } else {
            replaceContent = cachedSpaces[1];
          }
          break;
        case 12:
          replaceContent = newLinesAndIndent();
          break;
        case 13:
          if (numberLineBreaks > 0) {
            replaceContent = newLinesAndIndent();
          } else if (!needsLineBreak) {
            replaceContent = cachedSpaces[1];
          }
          break;
        case 6:
          if (options.keepLines && numberLineBreaks > 0) {
            replaceContent = newLinesAndIndent();
          } else if (!needsLineBreak) {
            replaceContent = cachedSpaces[1];
          }
          break;
        case 10:
          if (options.keepLines && numberLineBreaks > 0) {
            replaceContent = newLinesAndIndent();
          } else if (secondToken === 6 && !needsLineBreak) {
            replaceContent = "";
          }
          break;
        case 7:
        case 8:
        case 9:
        case 11:
        case 2:
        case 4:
          if (options.keepLines && numberLineBreaks > 0) {
            replaceContent = newLinesAndIndent();
          } else {
            if ((secondToken === 12 || secondToken === 13) && !needsLineBreak) {
              replaceContent = cachedSpaces[1];
            } else if (secondToken !== 5 && secondToken !== 17) {
              hasError = true;
            }
          }
          break;
        case 16:
          hasError = true;
          break;
      }
      if (numberLineBreaks > 0 && (secondToken === 12 || secondToken === 13)) {
        replaceContent = newLinesAndIndent();
      }
    }
    if (secondToken === 17) {
      if (options.keepLines && numberLineBreaks > 0) {
        replaceContent = newLinesAndIndent();
      } else {
        replaceContent = options.insertFinalNewline ? eol : "";
      }
    }
    const secondTokenStart = scanner.getTokenOffset() + formatTextStart;
    addEdit(replaceContent, firstTokenEnd, secondTokenStart);
    firstToken = secondToken;
  }
  return editOperations;
}
function repeat(s, count) {
  let result = "";
  for (let i = 0;i < count; i++) {
    result += s;
  }
  return result;
}
function computeIndentLevel(content, options) {
  let i = 0;
  let nChars = 0;
  const tabSize = options.tabSize || 4;
  while (i < content.length) {
    let ch = content.charAt(i);
    if (ch === cachedSpaces[1]) {
      nChars++;
    } else if (ch === "\t") {
      nChars += tabSize;
    } else {
      break;
    }
    i++;
  }
  return Math.floor(nChars / tabSize);
}
function getEOL(options, text) {
  for (let i = 0;i < text.length; i++) {
    const ch = text.charAt(i);
    if (ch === "\r") {
      if (i + 1 < text.length && text.charAt(i + 1) === `
`) {
        return `\r
`;
      }
      return "\r";
    } else if (ch === `
`) {
      return `
`;
    }
  }
  return options && options.eol || `
`;
}
function isEOL(text, offset) {
  return `\r
`.indexOf(text.charAt(offset)) !== -1;
}

// node_modules/.bun/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/impl/parser.js
var ParseOptions;
(function(ParseOptions2) {
  ParseOptions2.DEFAULT = {
    allowTrailingComma: false
  };
})(ParseOptions || (ParseOptions = {}));
function parse4(text, errors2 = [], options = ParseOptions.DEFAULT) {
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
      const object2 = {};
      onValue(object2);
      previousParents.push(currentParent);
      currentParent = object2;
      currentProperty = null;
    },
    onObjectProperty: (name) => {
      currentProperty = name;
    },
    onObjectEnd: () => {
      currentParent = previousParents.pop();
    },
    onArrayBegin: () => {
      const array2 = [];
      onValue(array2);
      previousParents.push(currentParent);
      currentParent = array2;
      currentProperty = null;
    },
    onArrayEnd: () => {
      currentParent = previousParents.pop();
    },
    onLiteralValue: onValue,
    onError: (error, offset, length) => {
      errors2.push({ error, offset, length });
    }
  };
  visit(text, visitor, options);
  return currentParent[0];
}
function parseTree(text, errors2 = [], options = ParseOptions.DEFAULT) {
  let currentParent = { type: "array", offset: -1, length: -1, children: [], parent: undefined };
  function ensurePropertyComplete(endOffset) {
    if (currentParent.type === "property") {
      currentParent.length = endOffset - currentParent.offset;
      currentParent = currentParent.parent;
    }
  }
  function onValue(valueNode) {
    currentParent.children.push(valueNode);
    return valueNode;
  }
  const visitor = {
    onObjectBegin: (offset) => {
      currentParent = onValue({ type: "object", offset, length: -1, parent: currentParent, children: [] });
    },
    onObjectProperty: (name, offset, length) => {
      currentParent = onValue({ type: "property", offset, length: -1, parent: currentParent, children: [] });
      currentParent.children.push({ type: "string", value: name, offset, length, parent: currentParent });
    },
    onObjectEnd: (offset, length) => {
      ensurePropertyComplete(offset + length);
      currentParent.length = offset + length - currentParent.offset;
      currentParent = currentParent.parent;
      ensurePropertyComplete(offset + length);
    },
    onArrayBegin: (offset, length) => {
      currentParent = onValue({ type: "array", offset, length: -1, parent: currentParent, children: [] });
    },
    onArrayEnd: (offset, length) => {
      currentParent.length = offset + length - currentParent.offset;
      currentParent = currentParent.parent;
      ensurePropertyComplete(offset + length);
    },
    onLiteralValue: (value, offset, length) => {
      onValue({ type: getNodeType(value), offset, length, parent: currentParent, value });
      ensurePropertyComplete(offset + length);
    },
    onSeparator: (sep6, offset, length) => {
      if (currentParent.type === "property") {
        if (sep6 === ":") {
          currentParent.colonOffset = offset;
        } else if (sep6 === ",") {
          ensurePropertyComplete(offset);
        }
      }
    },
    onError: (error, offset, length) => {
      errors2.push({ error, offset, length });
    }
  };
  visit(text, visitor, options);
  const result = currentParent.children[0];
  if (result) {
    delete result.parent;
  }
  return result;
}
function findNodeAtLocation(root, path) {
  if (!root) {
    return;
  }
  let node = root;
  for (let segment of path) {
    if (typeof segment === "string") {
      if (node.type !== "object" || !Array.isArray(node.children)) {
        return;
      }
      let found = false;
      for (const propertyNode of node.children) {
        if (Array.isArray(propertyNode.children) && propertyNode.children[0].value === segment && propertyNode.children.length === 2) {
          node = propertyNode.children[1];
          found = true;
          break;
        }
      }
      if (!found) {
        return;
      }
    } else {
      const index = segment;
      if (node.type !== "array" || index < 0 || !Array.isArray(node.children) || index >= node.children.length) {
        return;
      }
      node = node.children[index];
    }
  }
  return node;
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
function getNodeType(value) {
  switch (typeof value) {
    case "boolean":
      return "boolean";
    case "number":
      return "number";
    case "string":
      return "string";
    case "object": {
      if (!value) {
        return "null";
      } else if (Array.isArray(value)) {
        return "array";
      }
      return "object";
    }
    default:
      return "null";
  }
}

// node_modules/.bun/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/impl/edit.js
function setProperty(text, originalPath, value, options) {
  const path = originalPath.slice();
  const errors2 = [];
  const root = parseTree(text, errors2);
  let parent = undefined;
  let lastSegment = undefined;
  while (path.length > 0) {
    lastSegment = path.pop();
    parent = findNodeAtLocation(root, path);
    if (parent === undefined && value !== undefined) {
      if (typeof lastSegment === "string") {
        value = { [lastSegment]: value };
      } else {
        value = [value];
      }
    } else {
      break;
    }
  }
  if (!parent) {
    if (value === undefined) {
      throw new Error("Can not delete in empty document");
    }
    return withFormatting(text, { offset: root ? root.offset : 0, length: root ? root.length : 0, content: JSON.stringify(value) }, options);
  } else if (parent.type === "object" && typeof lastSegment === "string" && Array.isArray(parent.children)) {
    const existing = findNodeAtLocation(parent, [lastSegment]);
    if (existing !== undefined) {
      if (value === undefined) {
        if (!existing.parent) {
          throw new Error("Malformed AST");
        }
        const propertyIndex = parent.children.indexOf(existing.parent);
        let removeBegin;
        let removeEnd = existing.parent.offset + existing.parent.length;
        if (propertyIndex > 0) {
          let previous = parent.children[propertyIndex - 1];
          removeBegin = previous.offset + previous.length;
        } else {
          removeBegin = parent.offset + 1;
          if (parent.children.length > 1) {
            let next = parent.children[1];
            removeEnd = next.offset;
          }
        }
        return withFormatting(text, { offset: removeBegin, length: removeEnd - removeBegin, content: "" }, options);
      } else {
        return withFormatting(text, { offset: existing.offset, length: existing.length, content: JSON.stringify(value) }, options);
      }
    } else {
      if (value === undefined) {
        return [];
      }
      const newProperty = `${JSON.stringify(lastSegment)}: ${JSON.stringify(value)}`;
      const index = options.getInsertionIndex ? options.getInsertionIndex(parent.children.map((p) => p.children[0].value)) : parent.children.length;
      let edit;
      if (index > 0) {
        let previous = parent.children[index - 1];
        edit = { offset: previous.offset + previous.length, length: 0, content: "," + newProperty };
      } else if (parent.children.length === 0) {
        edit = { offset: parent.offset + 1, length: 0, content: newProperty };
      } else {
        edit = { offset: parent.offset + 1, length: 0, content: newProperty + "," };
      }
      return withFormatting(text, edit, options);
    }
  } else if (parent.type === "array" && typeof lastSegment === "number" && Array.isArray(parent.children)) {
    const insertIndex = lastSegment;
    if (insertIndex === -1) {
      const newProperty = `${JSON.stringify(value)}`;
      let edit;
      if (parent.children.length === 0) {
        edit = { offset: parent.offset + 1, length: 0, content: newProperty };
      } else {
        const previous = parent.children[parent.children.length - 1];
        edit = { offset: previous.offset + previous.length, length: 0, content: "," + newProperty };
      }
      return withFormatting(text, edit, options);
    } else if (value === undefined && parent.children.length >= 0) {
      const removalIndex = lastSegment;
      const toRemove = parent.children[removalIndex];
      let edit;
      if (parent.children.length === 1) {
        edit = { offset: parent.offset + 1, length: parent.length - 2, content: "" };
      } else if (parent.children.length - 1 === removalIndex) {
        let previous = parent.children[removalIndex - 1];
        let offset = previous.offset + previous.length;
        let parentEndOffset = parent.offset + parent.length;
        edit = { offset, length: parentEndOffset - 2 - offset, content: "" };
      } else {
        edit = { offset: toRemove.offset, length: parent.children[removalIndex + 1].offset - toRemove.offset, content: "" };
      }
      return withFormatting(text, edit, options);
    } else if (value !== undefined) {
      let edit;
      const newProperty = `${JSON.stringify(value)}`;
      if (!options.isArrayInsertion && parent.children.length > lastSegment) {
        const toModify = parent.children[lastSegment];
        edit = { offset: toModify.offset, length: toModify.length, content: newProperty };
      } else if (parent.children.length === 0 || lastSegment === 0) {
        edit = { offset: parent.offset + 1, length: 0, content: parent.children.length === 0 ? newProperty : newProperty + "," };
      } else {
        const index = lastSegment > parent.children.length ? parent.children.length : lastSegment;
        const previous = parent.children[index - 1];
        edit = { offset: previous.offset + previous.length, length: 0, content: "," + newProperty };
      }
      return withFormatting(text, edit, options);
    } else {
      throw new Error(`Can not ${value === undefined ? "remove" : options.isArrayInsertion ? "insert" : "modify"} Array index ${insertIndex} as length is not sufficient`);
    }
  } else {
    throw new Error(`Can not add ${typeof lastSegment !== "number" ? "index" : "property"} to parent of type ${parent.type}`);
  }
}
function withFormatting(text, edit, options) {
  if (!options.formattingOptions) {
    return [edit];
  }
  let newText = applyEdit(text, edit);
  let begin = edit.offset;
  let end = edit.offset + edit.content.length;
  if (edit.length === 0 || edit.content.length === 0) {
    while (begin > 0 && !isEOL(newText, begin - 1)) {
      begin--;
    }
    while (end < newText.length && !isEOL(newText, end)) {
      end++;
    }
  }
  const edits = format(newText, { offset: begin, length: end - begin }, { ...options.formattingOptions, keepLines: false });
  for (let i = edits.length - 1;i >= 0; i--) {
    const edit2 = edits[i];
    newText = applyEdit(newText, edit2);
    begin = Math.min(begin, edit2.offset);
    end = Math.max(end, edit2.offset + edit2.length);
    end += edit2.content.length - edit2.length;
  }
  const editLength = text.length - (newText.length - end) - begin;
  return [{ offset: begin, length: editLength, content: newText.substring(begin, end) }];
}
function applyEdit(text, edit) {
  return text.substring(0, edit.offset) + edit.content + text.substring(edit.offset + edit.length);
}

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
var parse5 = parse4;
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
function modify(text, path, value, options) {
  return setProperty(text, path, value, options);
}
function applyEdits(text, edits) {
  let sortedEdits = edits.slice(0).sort((a, b) => {
    const diff = a.offset - b.offset;
    if (diff === 0) {
      return a.length - b.length;
    }
    return diff;
  });
  let lastModifiedOffset = text.length;
  for (let i = sortedEdits.length - 1;i >= 0; i--) {
    let e = sortedEdits[i];
    if (e.offset + e.length <= lastModifiedOffset) {
      text = applyEdit(text, e);
    } else {
      throw new Error("Overlapping edit");
    }
    lastModifiedOffset = e.offset;
  }
  return text;
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
function mergeCodegraphExcludedRoots(base, override) {
  return [...new Set([...base, ...override])];
}
function mergeOmoConfigRecords(base, override, parentKey) {
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (isUnsafeObjectKey(key))
      continue;
    const safeValue = sanitizeOmoConfigValue(value);
    const baseValue = result[key];
    result[key] = key === "excluded_roots" && parentKey === "codegraph" && Array.isArray(baseValue) && Array.isArray(safeValue) ? mergeCodegraphExcludedRoots(baseValue, safeValue) : isPlainObject2(baseValue) && isPlainObject2(safeValue) ? mergeOmoConfigRecords(baseValue, safeValue, key) : safeValue;
  }
  return result;
}

// packages/omo-config-core/src/loader/paths.ts
import { userInfo } from "node:os";
import { dirname as dirname9, join as join20, posix, resolve as resolve7 } from "node:path";

// packages/omo-config-core/src/internal/posix-path.ts
function toPosixPath2(path) {
  return path.split("\\").join("/");
}

// packages/omo-config-core/src/loader/types.ts
import { existsSync as existsSync4, lstatSync, readFileSync as readFileSync2, realpathSync as realpathSync2 } from "node:fs";
var DEFAULT_READ_FILE_SYSTEM = {
  existsSync: existsSync4,
  lstatSync,
  readFileSync: readFileSync2,
  realpathSync: realpathSync2
};

// packages/omo-config-core/src/loader/paths.ts
var MAX_PROJECT_CONFIG_DIRECTORY_DEPTH = 256;
var ACCOUNT_HOME_DIR = userInfo().homedir;
function resolveHomeDir(env = process.env) {
  const homeDir = env.HOME ?? env.USERPROFILE ?? process.cwd();
  return homeDir.startsWith("/") ? posix.resolve(homeDir) : toPosixPath2(resolve7(homeDir));
}
function resolveUserOmoConfigPath(env = process.env) {
  return join20(resolveUserOmoConfigDirectory(env), "omo.jsonc");
}
function resolveUserOmoConfigDirectory(env = process.env) {
  return join20(resolveHomeDir(env), ".omo");
}
function detectUserOmoJsonPath(env, fileSystem) {
  const configDir = resolveUserOmoConfigDirectory(env);
  const jsoncPath = join20(configDir, "omo.jsonc");
  if (fileSystem.existsSync(jsoncPath))
    return jsoncPath;
  const jsonPath = join20(configDir, "omo.json");
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
  const omoDir = join20(dir, ".omo");
  if (isSymlinkedProjectPath(omoDir, fileSystem))
    return null;
  const jsoncPath = join20(omoDir, "omo.jsonc");
  if (isLoadableProjectConfigFile(jsoncPath, fileSystem))
    return jsoncPath;
  const jsonPath = join20(omoDir, "omo.json");
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
  const startDir = resolve7(cwd);
  const boundaryDirs = [...new Set([resolve7(homeDir), resolve7(accountHomeDir)])];
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
    const parentDir = dirname9(currentDir);
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
function withoutControlKeys(config2) {
  const result = {};
  for (const [key, value] of Object.entries(config2)) {
    if (key === "profiles" || HARNESS_KEYS.includes(key))
      continue;
    result[key] = value;
  }
  return result;
}
function harnessLayer(config2, harness) {
  if (harness === undefined)
    return {};
  return toRecord(config2[`[${harness}]`]) ?? {};
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
  let config2 = {};
  for (const layer of layers)
    config2 = mergeOmoConfigRecords(config2, layer);
  const resolvedProfile = options.profile !== undefined && profile !== undefined ? options.profile : undefined;
  return {
    config: withoutControlKeys(config2),
    diagnostics,
    ...resolvedProfile === undefined ? {} : { profile: resolvedProfile }
  };
}

// packages/omo-config-core/src/loader/loader.ts
function parseJsoncSafe(content) {
  const errors2 = [];
  const data = parse5(content.charCodeAt(0) === 65279 ? content.slice(1) : content, errors2, {
    allowTrailingComma: true,
    disallowComments: false
  });
  return {
    data: errors2.length === 0 ? data : null,
    errors: errors2.map((error) => ({
      message: printParseErrorCode(error.error),
      offset: error.offset
    }))
  };
}
var DEFAULT_RAW_CONFIG = {
  agents: {},
  categories: {},
  codegraph: OmoCodegraphSettingsSchema.parse({}),
  task: OmoTaskSettingsSchema.parse({}),
  teams: {}
};
function stripResolutionControlKeys(config2) {
  const {
    "[codex]": _codex,
    "[opencode]": _opencode,
    "[senpi]": _senpi,
    profiles: _profiles,
    ...resolved
  } = config2;
  return resolved;
}
function validationDiagnostic(path, issues) {
  const issuePaths = issues.map((issue2) => issue2.path.map((segment) => String(segment)).join("."));
  return {
    kind: "validation",
    message: `Invalid omo config at ${path}: ${issuePaths.join(", ")}`,
    path,
    issuePaths
  };
}
function toRecord2(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return null;
  const record2 = {};
  for (const [key, entry] of Object.entries(value)) {
    record2[key] = entry;
  }
  return record2;
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
  const validation = OmoConfigLayerSchema.safeParse(parsed.data);
  if (!validation.success) {
    return {
      diagnostic: validationDiagnostic(path, validation.error.issues),
      source: { exists: true, loaded: false, path, scope }
    };
  }
  const parsedRecord = toRecord2(parsed.data);
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

// packages/omo-config-core/src/models/model-catalog-cycles.ts
function findModelCatalogCycles(catalog) {
  const cycleNames = new Set;
  const path = [];
  const visited = new Set;
  const visiting = new Set;
  function visit2(name) {
    if (visited.has(name))
      return;
    visiting.add(name);
    path.push(name);
    const next = catalog[name]?.model;
    if (next !== undefined && Object.hasOwn(catalog, next)) {
      if (visiting.has(next)) {
        const cycleStart = path.indexOf(next);
        for (const cycleName of path.slice(cycleStart))
          cycleNames.add(cycleName);
      } else {
        visit2(next);
      }
    }
    path.pop();
    visiting.delete(name);
    visited.add(name);
  }
  for (const name of Object.keys(catalog))
    visit2(name);
  return [...cycleNames].sort();
}

// packages/omo-config-core/src/models/model-reference-resolution.ts
function catalogReference(model, reasoning, catalog, cycleNames) {
  const entry = catalog?.[model];
  if (entry === undefined || cycleNames.has(model))
    return;
  return {
    model: entry.model,
    ...reasoning === undefined && entry.reasoning !== undefined ? { reasoning: entry.reasoning } : reasoning !== undefined ? { reasoning } : {}
  };
}
function resolveModelEntry(entry, catalog, cycleNames) {
  if (typeof entry === "string") {
    const resolved2 = catalogReference(entry, undefined, catalog, cycleNames);
    if (resolved2 === undefined)
      return entry;
    return resolved2.reasoning === undefined ? resolved2.model : resolved2;
  }
  const resolved = catalogReference(entry.model, entry.reasoning, catalog, cycleNames);
  if (resolved === undefined)
    return entry;
  return {
    ...entry,
    model: resolved.model,
    ...entry.reasoning === undefined && resolved.reasoning !== undefined ? { reasoning: resolved.reasoning } : {}
  };
}
function resolveFallbackModels(fallbackModels, catalog, cycleNames) {
  if (fallbackModels === undefined)
    return;
  if (typeof fallbackModels !== "string") {
    return fallbackModels.map((entry) => resolveModelEntry(entry, catalog, cycleNames));
  }
  const resolved = catalogReference(fallbackModels, undefined, catalog, cycleNames);
  if (resolved === undefined || resolved.reasoning === undefined)
    return resolved?.model ?? fallbackModels;
  return [resolved];
}
function resolveAgentDefinition(definition, catalog, cycleNames) {
  const resolvedModel = definition.model === undefined ? undefined : catalogReference(definition.model, definition.reasoning, catalog, cycleNames);
  return {
    ...definition,
    ...resolvedModel === undefined ? {} : { model: resolvedModel.model },
    ...definition.reasoning === undefined && resolvedModel?.reasoning !== undefined ? { reasoning: resolvedModel.reasoning } : {},
    ...definition.models === undefined ? {} : { models: definition.models.map((entry) => resolveModelEntry(entry, catalog, cycleNames)) }
  };
}
function resolveCategoryDefinition(definition, catalog, cycleNames) {
  const resolvedModel = definition.model === undefined ? undefined : catalogReference(definition.model, definition.reasoning, catalog, cycleNames);
  return {
    ...definition,
    ...resolvedModel === undefined ? {} : { model: resolvedModel.model },
    ...definition.reasoning === undefined && resolvedModel?.reasoning !== undefined ? { reasoning: resolvedModel.reasoning } : {},
    ...definition.models === undefined ? {} : { models: definition.models.map((entry) => resolveModelEntry(entry, catalog, cycleNames)) },
    ...definition.fallback_models === undefined ? {} : { fallback_models: resolveFallbackModels(definition.fallback_models, catalog, cycleNames) }
  };
}
function cycleDiagnostics(catalog) {
  if (catalog === undefined)
    return [];
  return findModelCatalogCycles(catalog).map((name) => ({
    kind: "model_catalog_cycle",
    message: catalog[name]?.model === name ? `Model catalog entry "${name}" references itself` : `Model catalog entry "${name}" participates in a reference cycle`,
    path: `models.${name}.model`
  }));
}
function resolveModelReferences(view) {
  const diagnostics = cycleDiagnostics(view.models);
  const cycleNames = new Set;
  for (const diagnostic of diagnostics) {
    const name = diagnostic.path.split(".")[1];
    if (name !== undefined)
      cycleNames.add(name);
  }
  const agents = view.agents === undefined ? undefined : Object.fromEntries(Object.entries(view.agents).map(([name, definition]) => [
    name,
    resolveAgentDefinition(definition, view.models, cycleNames)
  ]));
  const categories = view.categories === undefined ? undefined : Object.fromEntries(Object.entries(view.categories).map(([name, definition]) => [
    name,
    resolveCategoryDefinition(definition, view.models, cycleNames)
  ]));
  return {
    diagnostics,
    view: {
      ...view,
      ...agents === undefined ? {} : { agents },
      ...categories === undefined ? {} : { categories }
    }
  };
}

// packages/omo-config-core/src/writer/types.ts
import {
  copyFileSync,
  existsSync as existsSync5,
  lstatSync as lstatSync2,
  mkdirSync,
  readFileSync as readFileSync3,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
var DEFAULT_WRITE_FILE_SYSTEM = {
  copyFileSync,
  existsSync: existsSync5,
  lstatSync: lstatSync2,
  mkdirSync,
  readFileSync: readFileSync3,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileExclusiveSync: (path, content) => {
    writeFileSync(path, content, { encoding: "utf-8", flag: "wx" });
  },
  writeFileSync
};

class OmoConfigWriteError extends Error {
  path;
  operation;
  name = "OmoConfigWriteError";
  constructor(path, operation, cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`Failed to ${operation} omo config at ${path}: ${detail}`, { cause });
    this.path = path;
    this.operation = operation;
  }
}

// packages/omo-config-core/src/writer/writer.ts
import { randomUUID } from "node:crypto";
import { dirname as dirname10, join as join21, posix as posix2 } from "node:path";

// packages/omo-config-core/src/internal/jsonc-parse.ts
function stripBom(content) {
  return content.charCodeAt(0) === 65279 ? content.slice(1) : content;
}
function parseJsoncSafe2(content) {
  const errors2 = [];
  const data = parse5(stripBom(content), errors2, {
    allowTrailingComma: true,
    disallowComments: false
  });
  return {
    data: errors2.length > 0 ? null : data,
    errors: errors2.map((e) => ({
      message: printParseErrorCode(e.error),
      offset: e.offset,
      length: e.length
    }))
  };
}

// packages/omo-config-core/src/writer/writer.ts
var EMPTY_OMO_CONFIG = `// OMO configuration
{
}
`;
var FORMATTING_OPTIONS = {
  eol: `
`,
  insertSpaces: true,
  tabSize: 2
};
function backupSuffix() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
function isFileExistsError(error) {
  return error instanceof Error && Reflect.get(error, "code") === "EEXIST";
}
function backupCandidate(basePath, attempt) {
  return attempt === 0 ? basePath : `${basePath}.${attempt}`;
}
function writeBackup(path, content, fileSystem) {
  const basePath = `${path}.bak.${backupSuffix()}`;
  let attempt = 0;
  while (true) {
    const candidate = backupCandidate(basePath, attempt);
    try {
      fileSystem.writeFileExclusiveSync(candidate, content);
      return candidate;
    } catch (error) {
      if (!isFileExistsError(error))
        throw error;
      attempt += 1;
    }
  }
}
function resolveWritePath(options) {
  if (options.targetPath !== undefined)
    return options.targetPath;
  const fileSystem = options.fileSystem ?? DEFAULT_WRITE_FILE_SYSTEM;
  if (options.scope === "user") {
    const jsoncPath2 = resolveUserOmoConfigPath(options.env);
    if (fileSystem.existsSync(jsoncPath2))
      return jsoncPath2;
    const jsonPath2 = join21(dirname10(jsoncPath2), "omo.json");
    return fileSystem.existsSync(jsonPath2) ? jsonPath2 : jsoncPath2;
  }
  const jsoncPath = join21(options.projectDir ?? process.cwd(), ".omo", "omo.jsonc");
  if (fileSystem.existsSync(jsoncPath))
    return jsoncPath;
  const jsonPath = join21(dirname10(jsoncPath), "omo.json");
  return fileSystem.existsSync(jsonPath) ? jsonPath : jsoncPath;
}
function directoryPath(path) {
  return path.startsWith("/") ? posix2.dirname(path) : dirname10(path);
}
function writeAtomically(path, content, fileSystem) {
  const tempPath = `${path}.${randomUUID()}.tmp`;
  let tempCreated = false;
  try {
    fileSystem.writeFileExclusiveSync(tempPath, content);
    tempCreated = true;
    fileSystem.renameSync(tempPath, path);
  } catch (error) {
    try {
      if (tempCreated)
        fileSystem.unlinkSync(tempPath);
    } catch (cleanupError) {
      if (!(cleanupError instanceof Error))
        throw cleanupError;
    }
    throw new OmoConfigWriteError(path, "write", error);
  }
}
function assertConfigPathIsSafe(path, fileSystem) {
  try {
    if (fileSystem.lstatSync(path).isSymbolicLink()) {
      throw new OmoConfigWriteError(path, "read", new Error("Refusing to edit symlinked omo config"));
    }
  } catch (error) {
    if (error instanceof OmoConfigWriteError)
      throw error;
    throw new OmoConfigWriteError(path, "read", error);
  }
}
function assertProjectConfigDirectoryIsSafe(directory, fileSystem) {
  try {
    if (fileSystem.lstatSync(directory).isSymbolicLink()) {
      throw new OmoConfigWriteError(directory, "read", new Error("Refusing to edit config under symlinked project .omo directory"));
    }
  } catch (error) {
    if (error instanceof OmoConfigWriteError)
      throw error;
    throw new OmoConfigWriteError(directory, "read", error);
  }
}
function assertJsoncCanBeModified(path, content) {
  const parsed = parseJsoncSafe2(content);
  if (parsed.errors.length === 0)
    return;
  const message = parsed.errors.map((error) => `${error.message} at offset ${error.offset}`).join(", ");
  throw new OmoConfigWriteError(path, "parse", new SyntaxError(message));
}
function updateOmoConfig(options) {
  const fileSystem = options.fileSystem ?? DEFAULT_WRITE_FILE_SYSTEM;
  const path = resolveWritePath(options);
  const directory = directoryPath(path);
  const existed = fileSystem.existsSync(path);
  let content = EMPTY_OMO_CONFIG;
  try {
    fileSystem.mkdirSync(directory, { recursive: true });
    if (options.scope === "project")
      assertProjectConfigDirectoryIsSafe(directory, fileSystem);
    if (existed) {
      assertConfigPathIsSafe(path, fileSystem);
      content = fileSystem.readFileSync(path, "utf-8");
    }
  } catch (error) {
    if (error instanceof OmoConfigWriteError)
      throw error;
    throw new OmoConfigWriteError(path, "read", error);
  }
  assertJsoncCanBeModified(path, content);
  let backupPath;
  if (existed) {
    try {
      assertConfigPathIsSafe(path, fileSystem);
      backupPath = writeBackup(path, content, fileSystem);
    } catch (error) {
      if (error instanceof OmoConfigWriteError)
        throw error;
      throw new OmoConfigWriteError(path, "backup", error);
    }
  }
  let nextContent = content;
  for (const edit of options.edits) {
    nextContent = applyEdits(nextContent, modify(nextContent, [...edit.path], edit.value, { formattingOptions: FORMATTING_OPTIONS }));
  }
  writeAtomically(path, nextContent, fileSystem);
  return backupPath === undefined ? { path } : { backupPath, path };
}

// packages/omo-config-core/src/migration/batch.ts
import { dirname as dirname12, posix as posix3 } from "node:path";

// packages/omo-config-core/src/internal/plain-object.ts
var DANGEROUS_KEYS2 = new Set(["__proto__", "constructor", "prototype"]);
function isUnsafeObjectKey2(key) {
  return DANGEROUS_KEYS2.has(key);
}
function isPlainObject3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.prototype.toString.call(value) === "[object Object]";
}

// packages/omo-config-core/src/migration/backup-move.ts
function isCrossDeviceError(error) {
  return error instanceof Error && Reflect.get(error, "code") === "EXDEV";
}
function moveMigrationBackup(fileSystem, sourcePath, backupPath) {
  try {
    fileSystem.renameSync(sourcePath, backupPath);
  } catch (error) {
    if (!isCrossDeviceError(error))
      throw error;
    fileSystem.copyFileSync(sourcePath, backupPath);
    fileSystem.unlinkSync(sourcePath);
  }
}

// packages/omo-config-core/src/migration/commit.ts
import { basename as basename5, dirname as dirname11, join as join22, resolve as resolve8 } from "node:path";

// packages/omo-config-core/src/migration/merge.ts
function displayValue(value) {
  const encoded = JSON.stringify(value);
  return encoded === undefined ? String(value) : encoded;
}
function displayPath(path) {
  return path.join(".");
}
function cloneValue(value) {
  if (Array.isArray(value))
    return value.map((entry) => cloneValue(entry));
  if (!isPlainObject3(value))
    return value;
  const clone2 = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isUnsafeObjectKey2(key))
      continue;
    clone2[key] = cloneValue(entry);
  }
  return clone2;
}
function hasOwn(record2, key) {
  return Object.prototype.hasOwnProperty.call(record2, key);
}
function mergeInto(existing, legacy, path, diagnostics) {
  const additions = {};
  for (const [key, legacyValue] of Object.entries(legacy)) {
    if (isUnsafeObjectKey2(key))
      continue;
    const nextPath = [...path, key];
    if (!hasOwn(existing, key)) {
      additions[key] = cloneValue(legacyValue);
      continue;
    }
    const keptValue = existing[key];
    if (isPlainObject3(keptValue) && isPlainObject3(legacyValue)) {
      const nested = mergeInto(keptValue, legacyValue, nextPath, diagnostics);
      if (Object.keys(nested).length > 0)
        additions[key] = nested;
      continue;
    }
    diagnostics.push(`skipped: ${displayPath(nextPath)} legacy=${displayValue(legacyValue)} kept=${displayValue(keptValue)}`);
  }
  return additions;
}
function applyAdditions(existing, additions) {
  const result = cloneValue(existing);
  if (!isPlainObject3(result))
    throw new Error("Migration target must be a plain object");
  for (const [key, value] of Object.entries(additions)) {
    if (isUnsafeObjectKey2(key))
      continue;
    const current = result[key];
    result[key] = isPlainObject3(current) && isPlainObject3(value) ? applyAdditions(current, value) : cloneValue(value);
  }
  return result;
}
function mergeWithoutClobber(existing, legacy) {
  const diagnostics = [];
  const additions = mergeInto(existing, legacy, [], diagnostics);
  return {
    additions,
    diagnostics,
    merged: applyAdditions(existing, additions)
  };
}
function collectMigrationEdits(value, path = []) {
  const edits = [];
  for (const [key, entry] of Object.entries(value)) {
    if (isUnsafeObjectKey2(key))
      continue;
    const nextPath = [...path, key];
    if (isPlainObject3(entry) && Object.keys(entry).length > 0) {
      edits.push(...collectMigrationEdits(entry, nextPath));
    } else {
      edits.push({ path: nextPath, value: cloneValue(entry) });
    }
  }
  return edits;
}

// packages/omo-config-core/src/migration/predicate.ts
function hasMigrationMarker(target, migrationId) {
  const markers = target["_migrations"];
  return Array.isArray(markers) && markers.some((marker) => marker === migrationId);
}
function shouldRunMigration(input) {
  return input.legacySourcesExist && !hasMigrationMarker(input.target, input.migrationId);
}

// packages/omo-config-core/src/migration/types.ts
class MigrationValidationError extends Error {
  targetPath;
  name = "MigrationValidationError";
  constructor(targetPath, message) {
    super(`Migration validation failed for ${targetPath}: ${message}`);
    this.targetPath = targetPath;
  }
}

class MigrationTransactionError extends Error {
  name = "MigrationTransactionError";
  constructor(message) {
    super(message);
  }
}
var DEFAULT_MIGRATION_CLOCK = {
  now: () => Date.now()
};
var DEFAULT_MIGRATION_PROCESS = {
  isAlive: (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      if (!(error instanceof Error))
        throw error;
      return Reflect.get(error, "code") !== "ESRCH";
    }
  },
  pid: process.pid
};
var DEFAULT_MIGRATION_FILE_SYSTEM = {
  ...DEFAULT_WRITE_FILE_SYSTEM,
  removeIfContentsMatchSync: (path, expected) => {
    if (!DEFAULT_WRITE_FILE_SYSTEM.existsSync(path))
      return false;
    if (DEFAULT_WRITE_FILE_SYSTEM.readFileSync(path, "utf-8") !== expected)
      return false;
    DEFAULT_WRITE_FILE_SYSTEM.unlinkSync(path);
    return true;
  },
  replaceIfContentsMatchSync: (path, expected, content) => {
    if (!DEFAULT_WRITE_FILE_SYSTEM.existsSync(path))
      return false;
    if (DEFAULT_WRITE_FILE_SYSTEM.readFileSync(path, "utf-8") !== expected)
      return false;
    DEFAULT_WRITE_FILE_SYSTEM.writeFileSync(path, content, "utf-8");
    return true;
  }
};

// packages/omo-config-core/src/migration/commit.ts
function parseDocument(path, content) {
  const parsed = parseJsoncSafe2(content);
  if (parsed.errors.length > 0 || !isPlainObject3(parsed.data)) {
    const detail = parsed.errors.map((error) => `${error.message} at ${error.offset}`).join(", ");
    throw new MigrationTransactionError(`Migration document at ${path} is not a JSONC object${detail === "" ? "" : `: ${detail}`}`);
  }
  return parsed.data;
}
function targetDocument(path, fileSystem) {
  if (!fileSystem.existsSync(path))
    return {};
  return parseDocument(path, fileSystem.readFileSync(path, "utf-8"));
}
function markerValue(target, migrationId, targetPath) {
  const value = target["_migrations"];
  if (value === undefined)
    return [migrationId];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new MigrationValidationError(targetPath, "the existing migration marker must be an array of strings");
  }
  return hasMigrationMarker(target, migrationId) ? value : [...value, migrationId];
}
function validateTarget(targetPath, document) {
  const result = OmoConfigSchema.safeParse(document);
  if (result.success)
    return;
  const detail = result.error.issues.map((issue2) => `${issue2.path.join(".")}: ${issue2.message}`).join(", ");
  throw new MigrationValidationError(targetPath, detail);
}
function writerInput(targetPath, env) {
  const homeDir = resolveHomeDir(env);
  const userDirectory = toPosixPath2(join22(homeDir, ".omo"));
  const fileName = basename5(targetPath);
  if (toPosixPath2(dirname11(targetPath)) === userDirectory && (fileName === "omo.json" || fileName === "omo.jsonc")) {
    return { scope: "user" };
  }
  if (basename5(dirname11(targetPath)) === ".omo" && (fileName === "omo.json" || fileName === "omo.jsonc")) {
    return { projectDir: dirname11(dirname11(targetPath)), scope: "project" };
  }
  throw new MigrationTransactionError(`Migration target is not an omo config path: ${targetPath}`);
}
function sameResolvedPath(a, b) {
  return toPosixPath2(resolve8(a)) === toPosixPath2(resolve8(b));
}
var writeOmoMigrationTarget = (input) => {
  const options = writerInput(input.targetPath, input.env);
  const result = updateOmoConfig({
    ...options,
    edits: input.edits,
    env: input.env,
    fileSystem: input.fileSystem,
    targetPath: input.targetPath
  });
  if (!sameResolvedPath(result.path, input.targetPath)) {
    throw new MigrationTransactionError(`Migration writer resolved ${result.path} instead of ${input.targetPath}`);
  }
};
function prepareTargetWrite(input) {
  const merged = mergeWithoutClobber(input.target, input.additions);
  const marker = markerValue(input.target, input.migrationId, input.targetPath);
  const document = { ...merged.merged, _migrations: marker };
  validateTarget(input.targetPath, document);
  const edits = [...collectMigrationEdits(merged.additions), { path: ["_migrations"], value: marker }];
  return { diagnostics: merged.diagnostics, document, edits };
}
function prepareTargetReplacement(input) {
  const marker = markerValue(input.target, input.migrationId, input.targetPath);
  const document = { ...input.document, _migrations: marker };
  validateTarget(input.targetPath, document);
  const edits = [];
  for (const key of Object.keys(input.target)) {
    if (key !== "_migrations" && !Object.prototype.hasOwnProperty.call(input.document, key)) {
      edits.push({ path: [key], value: undefined });
    }
  }
  for (const [key, value] of Object.entries(input.document)) {
    if (key !== "_migrations")
      edits.push({ path: [key], value });
  }
  edits.push({ path: ["_migrations"], value: marker });
  return { diagnostics: [], document, edits };
}
function writePreparedTarget(input) {
  input.writeTarget({
    edits: input.prepared.edits,
    env: input.env,
    fileSystem: input.fileSystem,
    targetPath: input.targetPath
  });
}

// packages/omo-config-core/src/migration/journal.ts
import { join as join23 } from "node:path";
function migrationJournalPath(env) {
  return toPosixPath2(join23(resolveHomeDir(env), ".omo", ".migration-journal.json"));
}
function isFileExistsError2(error) {
  return error instanceof Error && Reflect.get(error, "code") === "EEXIST";
}
function journalTempPath(path, process3, clock, attempt) {
  const suffix = `${process3.pid}.${clock.now()}`;
  return attempt === 0 ? `${path}.${suffix}.tmp` : `${path}.${suffix}.${attempt}.tmp`;
}
function parseJournal(value) {
  if (!isPlainObject3(value))
    throw new Error("Migration journal must be an object");
  if (value["version"] !== 1)
    throw new Error("Migration journal version is unsupported");
  if (typeof value["targetPath"] !== "string" || typeof value["migrationId"] !== "string") {
    throw new Error("Migration journal target is invalid");
  }
  if (!isPlainObject3(value["targetWrite"]) || !isPlainObject3(value["targetWrite"]["additions"])) {
    throw new Error("Migration journal target write is invalid");
  }
  const targetWriteMode = value["targetWrite"]["mode"];
  if (targetWriteMode !== undefined && targetWriteMode !== "replace-target") {
    throw new Error("Migration journal target write mode is invalid");
  }
  if (typeof value["targetWritten"] !== "boolean" || !Array.isArray(value["completedMoves"])) {
    throw new Error("Migration journal completion state is invalid");
  }
  const diagnostics = value["diagnostics"];
  if (diagnostics !== undefined && (!Array.isArray(diagnostics) || !diagnostics.every((entry) => typeof entry === "string"))) {
    throw new Error("Migration journal diagnostics are invalid");
  }
  if (!value["completedMoves"].every((path) => typeof path === "string")) {
    throw new Error("Migration journal completed moves are invalid");
  }
  if (!Array.isArray(value["backupMoves"]))
    throw new Error("Migration journal backup plan is invalid");
  const backupMoves = [];
  for (const move of value["backupMoves"]) {
    if (!isPlainObject3(move) || typeof move["from"] !== "string" || typeof move["to"] !== "string") {
      throw new Error("Migration journal backup move is invalid");
    }
    backupMoves.push({ from: move["from"], to: move["to"] });
  }
  return {
    backupMoves,
    completedMoves: [...value["completedMoves"]],
    diagnostics: diagnostics === undefined ? [] : [...diagnostics],
    migrationId: value["migrationId"],
    targetPath: value["targetPath"],
    targetWrite: {
      additions: { ...value["targetWrite"]["additions"] },
      ...targetWriteMode === undefined ? {} : { mode: targetWriteMode }
    },
    targetWritten: value["targetWritten"],
    version: 1
  };
}
function readMigrationJournal(fileSystem, env) {
  const path = migrationJournalPath(env);
  if (!fileSystem.existsSync(path))
    return null;
  return parseJournal(JSON.parse(fileSystem.readFileSync(path, "utf-8")));
}
function writeMigrationJournal(journal, fileSystem, env, process3, clock) {
  const path = migrationJournalPath(env);
  const content = `${JSON.stringify(journal)}
`;
  let attempt = 0;
  while (true) {
    const temporaryPath = journalTempPath(path, process3, clock, attempt);
    try {
      fileSystem.writeFileExclusiveSync(temporaryPath, content);
      fileSystem.renameSync(temporaryPath, path);
      return;
    } catch (error) {
      if (!isFileExistsError2(error))
        throw error;
      attempt += 1;
    }
  }
}
function removeMigrationJournal(fileSystem, env) {
  const path = migrationJournalPath(env);
  if (fileSystem.existsSync(path))
    fileSystem.unlinkSync(path);
}

// packages/omo-config-core/src/migration/lock.ts
import { join as join24 } from "node:path";
var DEFAULT_LEASE_DURATION_MS = 30000;
var GUARD_LEASE_DURATION_MS = 1000;
var LIVE_OWNER_STALE_LEASE_MULTIPLIER = 2;
var MUTATION_GUARD_RETRY_DELAYS_MS = [2, 4, 8, 16, 32];
var MUTATION_GUARD_SLEEP_VIEW = new Int32Array(new SharedArrayBuffer(4));
function migrationLockPath(env) {
  return toPosixPath2(join24(resolveHomeDir(env), ".omo", ".migration.lock"));
}
function mutationGuardPath(env) {
  return `${migrationLockPath(env)}.guard`;
}
function isFileExistsError3(error) {
  return error instanceof Error && Reflect.get(error, "code") === "EEXIST";
}
function isFileMissingError(error) {
  return error instanceof Error && Reflect.get(error, "code") === "ENOENT";
}
function parseLockRecord(content) {
  try {
    const value = JSON.parse(content);
    if (typeof value !== "object" || value === null)
      return null;
    const pid = Reflect.get(value, "pid");
    const leaseExpiresAt = Reflect.get(value, "leaseExpiresAt");
    if (typeof pid !== "number" || !Number.isInteger(pid) || pid < 1)
      return null;
    if (typeof leaseExpiresAt !== "number" || !Number.isFinite(leaseExpiresAt))
      return null;
    return { leaseExpiresAt, pid };
  } catch (error) {
    if (error instanceof SyntaxError)
      return null;
    throw error;
  }
}
function leaseContent(process3, clock, duration3) {
  return `${JSON.stringify({ leaseExpiresAt: clock.now() + duration3, pid: process3.pid })}
`;
}
function isReclaimable(record2, clock, process3, leaseDurationMs) {
  const now = clock.now();
  if (record2.leaseExpiresAt > now)
    return false;
  if (!process3.isAlive(record2.pid))
    return true;
  return record2.leaseExpiresAt + leaseDurationMs * LIVE_OWNER_STALE_LEASE_MULTIPLIER <= now;
}
function sleepSync(milliseconds) {
  Atomics.wait(MUTATION_GUARD_SLEEP_VIEW, 0, 0, milliseconds);
}
function acquireMutationGuard(input) {
  const path = mutationGuardPath(input.env);
  for (let attempt = 0;attempt <= MUTATION_GUARD_RETRY_DELAYS_MS.length; attempt += 1) {
    const content = leaseContent(input.process, input.clock, GUARD_LEASE_DURATION_MS);
    try {
      input.fileSystem.writeFileExclusiveSync(path, content);
      return content;
    } catch (error) {
      if (!isFileExistsError3(error))
        throw error;
    }
    try {
      const observedContent = input.fileSystem.readFileSync(path, "utf-8");
      const observed = parseLockRecord(observedContent);
      if (observed === null || isReclaimable(observed, input.clock, input.process, GUARD_LEASE_DURATION_MS)) {
        input.fileSystem.removeIfContentsMatchSync(path, observedContent);
      }
    } catch (error) {
      if (!isFileMissingError(error))
        throw error;
    }
    const retryDelayMs = MUTATION_GUARD_RETRY_DELAYS_MS[attempt];
    if (retryDelayMs !== undefined)
      sleepSync(retryDelayMs);
  }
  return null;
}
function releaseMutationGuard(input) {
  input.fileSystem.removeIfContentsMatchSync(mutationGuardPath(input.env), input.content);
}
function acquireMigrationLock(input) {
  const leaseDurationMs = input.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
  const path = migrationLockPath(input.env);
  input.fileSystem.mkdirSync(toPosixPath2(join24(resolveHomeDir(input.env), ".omo")), { recursive: true });
  for (let attempt = 0;attempt < 3; attempt += 1) {
    const currentContent = leaseContent(input.process, input.clock, leaseDurationMs);
    try {
      input.fileSystem.writeFileExclusiveSync(path, currentContent);
      let ownedContent = currentContent;
      const mutate = (mutation) => {
        const guardContent2 = acquireMutationGuard(input);
        if (guardContent2 === null)
          throw new Error("Migration lock mutation is busy");
        try {
          const renewedContent = leaseContent(input.process, input.clock, leaseDurationMs);
          if (!mutation(renewedContent))
            throw new Error("Migration lock ownership was lost");
          ownedContent = renewedContent;
        } finally {
          releaseMutationGuard({ env: input.env, fileSystem: input.fileSystem, content: guardContent2 });
        }
      };
      return {
        release: () => {
          const guardContent2 = acquireMutationGuard(input);
          if (guardContent2 === null) {
            input.fileSystem.removeIfContentsMatchSync(path, ownedContent);
            return;
          }
          try {
            input.fileSystem.removeIfContentsMatchSync(path, ownedContent);
          } finally {
            releaseMutationGuard({ env: input.env, fileSystem: input.fileSystem, content: guardContent2 });
          }
        },
        renew: () => {
          mutate((renewedContent) => input.fileSystem.replaceIfContentsMatchSync(path, ownedContent, renewedContent));
        }
      };
    } catch (error) {
      if (!isFileExistsError3(error))
        throw error;
    }
    const guardContent = acquireMutationGuard(input);
    if (guardContent === null)
      return null;
    try {
      let observedContent;
      try {
        observedContent = input.fileSystem.readFileSync(path, "utf-8");
      } catch (error) {
        if (isFileMissingError(error))
          continue;
        throw error;
      }
      const observed = parseLockRecord(observedContent);
      if (observed !== null && !isReclaimable(observed, input.clock, input.process, leaseDurationMs))
        return null;
      input.fileSystem.removeIfContentsMatchSync(path, observedContent);
    } finally {
      releaseMutationGuard({ env: input.env, fileSystem: input.fileSystem, content: guardContent });
    }
  }
  return null;
}

// packages/omo-config-core/src/migration/recovery.ts
function resumeMigrationJournal(input) {
  const journal = readMigrationJournal(input.fileSystem, input.env);
  if (journal === null)
    return false;
  input.renewLock();
  const target = targetDocument(journal.targetPath, input.fileSystem);
  if (!hasMigrationMarker(target, journal.migrationId)) {
    const prepared = journal.targetWrite.mode === "replace-target" ? prepareTargetReplacement({
      document: journal.targetWrite.additions,
      migrationId: journal.migrationId,
      target,
      targetPath: journal.targetPath
    }) : prepareTargetWrite({
      additions: journal.targetWrite.additions,
      migrationId: journal.migrationId,
      target,
      targetPath: journal.targetPath
    });
    writePreparedTarget({
      env: input.env,
      fileSystem: input.fileSystem,
      prepared,
      targetPath: journal.targetPath,
      writeTarget: input.writeTarget
    });
  }
  const targetRecorded = { ...journal, targetWritten: true };
  writeMigrationJournal(targetRecorded, input.fileSystem, input.env, input.process, input.clock);
  for (const move of targetRecorded.backupMoves) {
    if (targetRecorded.completedMoves.includes(move.from))
      continue;
    input.renewLock();
    if (input.fileSystem.existsSync(move.from)) {
      if (input.fileSystem.existsSync(move.to)) {
        throw new MigrationTransactionError(`Migration backup path already exists: ${move.to}`);
      }
      moveMigrationBackup(input.fileSystem, move.from, move.to);
    } else if (!input.fileSystem.existsSync(move.to)) {
      throw new MigrationTransactionError(`Migration source and backup are both missing: ${move.from}`);
    }
    Object.assign(targetRecorded, { completedMoves: [...targetRecorded.completedMoves, move.from] });
    writeMigrationJournal(targetRecorded, input.fileSystem, input.env, input.process, input.clock);
  }
  removeMigrationJournal(input.fileSystem, input.env);
  return true;
}

// packages/omo-config-core/src/migration/batch.ts
function parseSource(path, content) {
  const parsed = parseJsoncSafe2(content);
  if (parsed.errors.length > 0) {
    const detail = parsed.errors.map((error) => `${error.message} at ${error.offset}`).join(", ");
    throw new MigrationTransactionError(`Migration source at ${path} is invalid JSONC: ${detail}`);
  }
  return parsed.data;
}
function loadSources(sources, fileSystem) {
  return sources.filter((source) => fileSystem.existsSync(source.path)).map((source) => ({ ...source, value: parseSource(source.path, fileSystem.readFileSync(source.path, "utf-8")) }));
}
function backupBasePath(source, migrationId) {
  return source.backupPath ?? `${source.path}.bak.${encodeURIComponent(migrationId)}`;
}
function backupMoves(sources, migrationId, fileSystem, protectedPaths) {
  const paths = new Set(sources.map((source) => source.path));
  const destinations = new Set;
  const moves = [];
  for (const source of sources) {
    if (!fileSystem.existsSync(source.path))
      continue;
    const basePath = backupBasePath(source, migrationId);
    let destination = basePath;
    let attempt = 1;
    while (fileSystem.existsSync(destination) || destinations.has(destination)) {
      if (source.backupPath !== undefined)
        throw new MigrationTransactionError(`Migration backup path already exists: ${destination}`);
      destination = `${basePath}.${attempt}`;
      attempt += 1;
    }
    if (paths.has(destination) || protectedPaths.has(destination))
      throw new MigrationTransactionError(`Migration backup path is protected: ${destination}`);
    destinations.add(destination);
    moves.push({ from: source.path, to: destination });
  }
  return moves;
}
function assertSafeSourcePaths(sources, protectedPaths) {
  const seen = new Set;
  for (const source of sources) {
    if (seen.has(source.path))
      throw new MigrationTransactionError(`Duplicate migration source: ${source.path}`);
    if (protectedPaths.has(source.path))
      throw new MigrationTransactionError(`Migration source is protected: ${source.path}`);
    seen.add(source.path);
  }
}
function directoryPath2(path) {
  return path.startsWith("/") ? posix3.dirname(path) : dirname12(path);
}
function ensureBackupDirectories(moves, fileSystem) {
  for (const move of moves)
    fileSystem.mkdirSync(directoryPath2(move.to), { recursive: true });
}
function transformResult(value) {
  if (isPlainObject3(value) && isPlainObject3(value.document) && Array.isArray(value.diagnostics) && value.diagnostics.every((diagnostic) => typeof diagnostic === "string")) {
    return { diagnostics: value.diagnostics, document: value.document };
  }
  if (!isPlainObject3(value))
    throw new MigrationTransactionError("Migration transform must return a plain object");
  return { diagnostics: [], document: value };
}
function executePlan(input) {
  const { env, fileSystem, journalResumed, plan } = input;
  const protectedPaths = new Set([plan.targetPath, migrationJournalPath(env), migrationLockPath(env)]);
  assertSafeSourcePaths(plan.sources, protectedPaths);
  const existingSources = plan.sources.filter((source) => fileSystem.existsSync(source.path));
  const target = targetDocument(plan.targetPath, fileSystem);
  const replaceTarget = plan.mode === "replace-target";
  if (!shouldRunMigration({
    legacySourcesExist: replaceTarget ? fileSystem.existsSync(plan.targetPath) : existingSources.length > 0,
    migrationId: plan.id,
    target
  })) {
    return { diagnostics: [], journalResumed, status: "skipped" };
  }
  const loaded = replaceTarget ? [{ path: plan.targetPath, value: target }] : loadSources(existingSources, fileSystem);
  const transformed = transformResult(plan.transform(loaded));
  const prepared = replaceTarget ? prepareTargetReplacement({ document: transformed.document, migrationId: plan.id, target, targetPath: plan.targetPath }) : prepareTargetWrite({ additions: transformed.document, migrationId: plan.id, target, targetPath: plan.targetPath });
  const diagnostics = [...transformed.diagnostics, ...prepared.diagnostics];
  const moves = backupMoves(existingSources, plan.id, fileSystem, protectedPaths);
  const preview = { backupMoves: moves, targetPath: plan.targetPath, transform: transformed.document };
  if (input.dryRun)
    return { diagnostics, journalResumed, preview, status: "planned" };
  ensureBackupDirectories(moves, fileSystem);
  const journal = {
    backupMoves: moves,
    completedMoves: [],
    diagnostics,
    migrationId: plan.id,
    targetPath: plan.targetPath,
    targetWrite: {
      additions: transformed.document,
      ...replaceTarget ? { mode: "replace-target" } : {}
    },
    targetWritten: false,
    version: 1
  };
  writeMigrationJournal(journal, fileSystem, env, input.process, input.clock);
  input.onBoundary?.("journal-written");
  input.renewLock();
  writePreparedTarget({ env, fileSystem, prepared, targetPath: plan.targetPath, writeTarget: input.writeTarget });
  input.onBoundary?.("target-written");
  const targetRecorded = { ...journal, targetWritten: true };
  writeMigrationJournal(targetRecorded, fileSystem, env, input.process, input.clock);
  input.onBoundary?.("target-recorded");
  for (const move of targetRecorded.backupMoves) {
    input.renewLock();
    if (fileSystem.existsSync(move.to))
      throw new MigrationTransactionError(`Migration backup path already exists: ${move.to}`);
    moveMigrationBackup(fileSystem, move.from, move.to);
    input.onBoundary?.("source-moved");
    Object.assign(targetRecorded, { completedMoves: [...targetRecorded.completedMoves, move.from] });
    writeMigrationJournal(targetRecorded, fileSystem, env, input.process, input.clock);
    input.onBoundary?.("source-recorded");
  }
  removeMigrationJournal(fileSystem, env);
  return { diagnostics, journalResumed, preview, status: "migrated" };
}
function runMigrations(options) {
  const clock = options.clock ?? DEFAULT_MIGRATION_CLOCK;
  const home = globalThis.process.env["HOME"];
  const userProfile = globalThis.process.env["USERPROFILE"];
  const env = options.env ?? { ...home === undefined ? {} : { HOME: home }, ...userProfile === undefined ? {} : { USERPROFILE: userProfile } };
  const fileSystem = options.fileSystem ?? DEFAULT_MIGRATION_FILE_SYSTEM;
  const process3 = { isAlive: options.isProcessAlive ?? DEFAULT_MIGRATION_PROCESS.isAlive, pid: options.pid ?? DEFAULT_MIGRATION_PROCESS.pid };
  const writeTarget = options.writeTarget ?? writeOmoMigrationTarget;
  const lock = acquireMigrationLock({ clock, env, fileSystem, ...options.leaseDurationMs === undefined ? {} : { leaseDurationMs: options.leaseDurationMs }, process: process3 });
  if (lock === null)
    return { journalResumed: false, results: [], status: "locked" };
  try {
    const journalResumed = resumeMigrationJournal({ clock, env, fileSystem, process: process3, renewLock: lock.renew, writeTarget });
    lock.renew();
    const results = options.discover().map((plan) => executePlan({
      clock,
      dryRun: options.dryRun ?? false,
      env,
      fileSystem,
      journalResumed,
      onBoundary: options.onBoundary,
      plan,
      process: process3,
      renewLock: lock.renew,
      writeTarget
    }));
    if (options.dryRun !== true)
      options.afterMigrations?.(results);
    return { journalResumed, results, status: "completed" };
  } finally {
    lock.release();
  }
}

// packages/omo-codex/plugin/shared/src/config-loader.ts
import { homedir } from "node:os";

// packages/omo-codex/plugin/shared/src/config-migration.ts
import { existsSync as existsSync6 } from "node:fs";
import { posix as posix4, win32 } from "node:path";
var MIGRATION_ID = "2026-07-codex-config-jsonc";
var OMO_SCHEMA_URL = "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/omo.schema.json";
function isRecord6(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function recordAt(value, key) {
  const candidate = value[key];
  return isRecord6(candidate) ? candidate : undefined;
}
function migrationHistory(sources, configPath) {
  const history = [];
  for (const source of sources) {
    if (!isRecord6(source.value))
      continue;
    for (const key of ["_migrations", "appliedMigrations"]) {
      const values = source.value[key];
      if (!Array.isArray(values))
        continue;
      for (const value of values) {
        if (typeof value === "string" && !history.includes(value))
          history.push(value);
      }
    }
  }
  return history.length === 0 ? {} : { [configPath]: history };
}
function transformConfigJsonc(configPath, sources) {
  const config2 = sources.find((source) => source.path === configPath);
  const legacy = config2 === undefined || !isRecord6(config2.value) ? {} : config2.value;
  const omo = recordAt(legacy, "[omo]");
  const senpi = recordAt(legacy, "[senpi]");
  const history = migrationHistory(sources, configPath);
  return {
    diagnostics: omo !== undefined && senpi !== undefined ? ["conflict: [senpi] legacy [omo] kept [senpi]"] : [],
    document: {
      $schema: OMO_SCHEMA_URL,
      ...recordAt(legacy, "codegraph") === undefined ? {} : { codegraph: recordAt(legacy, "codegraph") },
      ...recordAt(legacy, "[opencode]") === undefined ? {} : { "[opencode]": recordAt(legacy, "[opencode]") },
      ...recordAt(legacy, "[codex]") === undefined ? {} : { "[codex]": recordAt(legacy, "[codex]") },
      ...senpi === undefined && omo === undefined ? {} : { "[senpi]": senpi ?? omo },
      ...Object.keys(history).length === 0 ? {} : { legacy_migrations: history }
    }
  };
}
function timestamp(value) {
  return value ?? new Date().toISOString().replace(/[:.]/g, "-");
}
function sourceExists(options, path) {
  return (options.discoveryFileSystem ?? options.fileSystem ?? { existsSync: existsSync6 }).existsSync(path);
}
function migrationPlan(homeDir, options) {
  const platform = options.platform ?? process.platform;
  const paths = options.pathOperations ?? (platform === "win32" ? win32 : posix4);
  const configPath = paths.join(homeDir, ".omo", "config.jsonc");
  const sidecarPath = `${configPath}.migrations.json`;
  const sourcePaths = [configPath, sidecarPath].filter((path) => sourceExists(options, path));
  if (sourcePaths.length === 0)
    return;
  const backupRoot = paths.join(homeDir, ".omo", `migration-backup-${timestamp(options.backupTimestamp)}-opencode-config`, ".omo");
  return {
    id: MIGRATION_ID,
    sources: sourcePaths.map((path) => ({
      backupPath: paths.join(backupRoot, path === configPath ? "config.jsonc" : "config.jsonc.migrations.json"),
      path
    })),
    targetPath: paths.join(homeDir, ".omo", "omo.jsonc"),
    transform: (sources) => transformConfigJsonc(configPath, sources)
  };
}
function migratedSources(results) {
  return [...new Set(results.flatMap((result) => result.status === "migrated" ? result.preview?.backupMoves.map((move) => move.from) ?? [] : []))].sort();
}
function runCodexConfigMigration(options) {
  const environment = options.environment ?? process.env;
  const homeDir = options.homeDir ?? environment["HOME"] ?? environment["USERPROFILE"];
  if (homeDir === undefined || homeDir.length === 0) {
    return { error: "Cannot migrate configuration because no home directory is available", journalResumed: false, migratedFrom: [], results: [] };
  }
  try {
    const batch = runMigrations({
      ...options.clock === undefined ? {} : { clock: options.clock },
      discover: () => {
        const plan = migrationPlan(homeDir, options);
        return plan === undefined ? [] : [plan];
      },
      ...options.env === undefined ? { env: { HOME: homeDir } } : { env: options.env },
      ...options.fileSystem === undefined ? {} : { fileSystem: options.fileSystem },
      ...options.isProcessAlive === undefined ? {} : { isProcessAlive: options.isProcessAlive },
      ...options.onBoundary === undefined ? {} : { onBoundary: options.onBoundary },
      ...options.pid === undefined ? {} : { pid: options.pid }
    });
    return {
      ...batch.status === "locked" ? { error: "Configuration migration is already running" } : {},
      journalResumed: batch.journalResumed,
      migratedFrom: migratedSources(batch.results),
      results: batch.results
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      journalResumed: false,
      migratedFrom: [],
      results: []
    };
  }
}

// packages/omo-codex/plugin/shared/src/config-loader.ts
var ENV_BOOLEAN_SETTINGS = [
  ["auto_provision", "AUTO_PROVISION"],
  ["enabled", "ENABLED"],
  ["telemetry", "TELEMETRY"]
];
function resolveHomeDir2(options) {
  const env = options.env ?? process.env;
  return options.homeDir ?? env.HOME ?? env.USERPROFILE ?? homedir();
}
function environmentWithHome(env, homeDir) {
  return { ...env, HOME: homeDir };
}
function migrationEnvironment(homeDir, env) {
  return {
    HOME: homeDir,
    ...env.USERPROFILE === undefined ? {} : { USERPROFILE: env.USERPROFILE }
  };
}
function runCodexStartupMigration(options) {
  return runCodexConfigMigration(options);
}
function parseBoolean(value) {
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized))
    return true;
  if (["0", "false", "no", "off"].includes(normalized))
    return false;
  return;
}
function envOverrides(env, warnings) {
  const codegraph = {};
  for (const prefix of ["OMO", "CODEX"]) {
    for (const [setting, suffix] of ENV_BOOLEAN_SETTINGS) {
      const name = `${prefix}_CODEGRAPH_${suffix}`;
      const rawValue = env[name];
      if (rawValue === undefined)
        continue;
      const value = parseBoolean(rawValue);
      if (value === undefined)
        warnings.push(`${name} has invalid boolean value "${rawValue}"`);
      else
        codegraph[setting] = value;
    }
    const installDir = env[`${prefix}_CODEGRAPH_INSTALL_DIR`];
    if (installDir !== undefined)
      codegraph["install_dir"] = installDir;
    const cooldown = env[`${prefix}_CODEGRAPH_SESSION_START_COOLDOWN_MS`];
    if (cooldown !== undefined) {
      const value = Number(cooldown);
      if (!Number.isFinite(value) || value < 60000) {
        warnings.push(`${prefix}_CODEGRAPH_SESSION_START_COOLDOWN_MS has invalid number value "${cooldown}"`);
      } else
        codegraph["session_start_cooldown_ms"] = value;
    }
    const debounce = env[`${prefix}_CODEGRAPH_WATCH_DEBOUNCE_MS`];
    if (debounce !== undefined) {
      const value = Number(debounce);
      if (!Number.isFinite(value) || value < 0)
        warnings.push(`${prefix}_CODEGRAPH_WATCH_DEBOUNCE_MS has invalid number value "${debounce}"`);
      else
        codegraph["watch_debounce_ms"] = value;
    }
  }
  return Object.keys(codegraph).length === 0 ? {} : { codegraph };
}
function migrationWarnings(result) {
  const warnings = [];
  if (result.error !== undefined)
    warnings.push(`omo-codex: configuration migration: ${result.error}`);
  if (result.journalResumed)
    warnings.push("omo-codex: recovered an interrupted configuration migration");
  if (result.migratedFrom.length > 0) {
    warnings.push(`omo-codex: migrated legacy configuration from ${result.migratedFrom.join(", ")}`);
  }
  for (const migration of result.results) {
    for (const diagnostic of migration.diagnostics) {
      warnings.push(`omo-codex: configuration migration: ${diagnostic}`);
    }
  }
  return warnings;
}
function applicabilityWarnings(config2) {
  return config2.codegraph?.watch_debounce_ms === undefined ? [] : ["codegraph.watch_debounce_ms is not supported for harness codex"];
}
function codexCodegraphConfig(value) {
  if (value === undefined)
    return;
  return {
    auto_provision: value.auto_provision,
    daemon: value.daemon,
    enabled: value.enabled,
    telemetry: value.telemetry,
    ...value.excluded_roots === undefined ? {} : { excluded_roots: value.excluded_roots },
    ...value.install_dir === undefined ? {} : { install_dir: value.install_dir },
    ...value.session_start_cooldown_ms === undefined ? {} : { session_start_cooldown_ms: value.session_start_cooldown_ms },
    ...value.watch_debounce_ms === undefined ? {} : { watch_debounce_ms: value.watch_debounce_ms }
  };
}
function getCodexOmoConfig(options = {}) {
  const env = options.env ?? process.env;
  const homeDir = resolveHomeDir2(options);
  const environment = environmentWithHome(env, homeDir);
  const migration = runCodexStartupMigration({
    cwd: options.cwd ?? process.cwd(),
    environment,
    env: migrationEnvironment(homeDir, environment),
    ...options.fileSystem === undefined ? {} : { fileSystem: options.fileSystem },
    ...options.platform === undefined ? {} : { platform: options.platform }
  });
  const result = loadOmoConfig({
    ...options.cwd === undefined ? {} : { cwd: options.cwd },
    env: environment,
    ...options.fileSystem === undefined ? {} : { fileSystem: options.fileSystem },
    harness: "codex",
    ...options.platform === undefined ? {} : { platform: options.platform },
    ...options.profile === undefined ? {} : { profile: options.profile }
  });
  const trustedConfig = loadOmoConfig({
    cwd: homeDir,
    env: environment,
    ...options.fileSystem === undefined ? {} : { fileSystem: options.fileSystem },
    harness: "codex",
    ...options.platform === undefined ? {} : { platform: options.platform },
    ...options.profile === undefined ? {} : { profile: options.profile }
  });
  const envWarnings = [];
  const config2 = OmoConfigSchema.parse(mergeOmoConfigRecords(result.config, envOverrides(env, envWarnings)));
  const trustedCodegraphInstallDir = trustedConfig.config.codegraph?.install_dir;
  const { codegraph, ...resolvedConfig } = config2;
  const codexCodegraph = codexCodegraphConfig(codegraph);
  return {
    ...resolvedConfig,
    ...codexCodegraph === undefined ? {} : { codegraph: codexCodegraph },
    sources: result.sources,
    ...trustedCodegraphInstallDir === undefined ? {} : { trustedCodegraphInstallDir },
    warnings: [
      ...migrationWarnings(migration),
      ...result.diagnostics.map((diagnostic) => diagnostic.message),
      ...envWarnings,
      ...applicabilityWarnings(config2)
    ]
  };
}

// packages/omo-codex/src/install/codex-agent-model-overrides.ts
var CODEX_REASONING_EFFORTS = {
  off: "none",
  none: "none",
  minimal: "minimal",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max"
};
function getCodexAgentModelOverrides(options = {}) {
  const config2 = getCodexOmoConfig(options);
  return resolveCodexAgentModelOverrides({ agents: config2.agents, models: config2.models }, config2.warnings);
}
function resolveCodexAgentModelOverrides(view, initialWarnings = []) {
  const resolved = resolveModelReferences({ agents: view.agents, models: view.models });
  const warnings = [
    ...initialWarnings,
    ...resolved.diagnostics.map((diagnostic) => diagnostic.message)
  ];
  const agents = new Map;
  for (const [agentName, definition] of Object.entries(resolved.view.agents ?? {})) {
    const override = resolveAgentOverride(agentName, definition, warnings);
    if (Object.keys(override).length > 0)
      agents.set(agentName, override);
  }
  return { agents, warnings };
}
function unknownCodexAgentModelOverrideWarnings(input) {
  const warnings = [];
  for (const agentName of input.configuredAgents) {
    if (input.managedAgentNames.has(agentName))
      continue;
    warnings.push(`agents.${agentName} does not match a LazyCodex-managed Codex agent; override skipped`);
  }
  return warnings;
}
function applyCodexAgentModelOverride(content, override) {
  let next = content;
  if (override.model !== undefined)
    next = replaceTopLevelSetting(next, "model", override.model);
  if (override.modelReasoningEffort !== undefined) {
    next = replaceTopLevelSetting(next, "model_reasoning_effort", override.modelReasoningEffort);
  }
  if (override.serviceTier !== undefined)
    next = replaceTopLevelSetting(next, "service_tier", override.serviceTier);
  return next;
}
function resolveAgentOverride(agentName, definition, warnings) {
  const primary = primaryAgentModel(agentName, definition);
  const override = {};
  if (primary.model !== undefined)
    override.model = primary.model;
  if (primary.reasoning !== undefined) {
    const effort = CODEX_REASONING_EFFORTS[primary.reasoning.trim().toLowerCase()];
    if (effort === undefined) {
      warnings.push(`${primary.reasoningPath} has unsupported Codex effort ${JSON.stringify(primary.reasoning)}; setting skipped`);
    } else {
      override.modelReasoningEffort = effort;
    }
  }
  const serviceTier = primary.providerOptions?.["service_tier"];
  if (serviceTier !== undefined) {
    if (typeof serviceTier === "string")
      override.serviceTier = serviceTier;
    else
      warnings.push(`${primary.providerOptionsPath}.service_tier must be a string; setting skipped`);
  }
  return override;
}
function primaryAgentModel(agentName, definition) {
  const agentPath = `agents.${agentName}`;
  if (definition.model !== undefined) {
    return {
      model: definition.model,
      providerOptions: definition.provider_options,
      providerOptionsPath: `${agentPath}.provider_options`,
      reasoning: definition.reasoning,
      reasoningPath: `${agentPath}.reasoning`
    };
  }
  const first = definition.models?.[0];
  if (typeof first === "object") {
    return {
      model: first.model,
      providerOptions: first.provider_options ?? definition.provider_options,
      providerOptionsPath: first.provider_options === undefined ? `${agentPath}.provider_options` : `${agentPath}.models.0.provider_options`,
      reasoning: first.reasoning ?? definition.reasoning,
      reasoningPath: first.reasoning === undefined ? `${agentPath}.reasoning` : `${agentPath}.models.0.reasoning`
    };
  }
  return {
    ...typeof first === "string" ? { model: first } : {},
    providerOptions: definition.provider_options,
    providerOptionsPath: `${agentPath}.provider_options`,
    reasoning: definition.reasoning,
    reasoningPath: `${agentPath}.reasoning`
  };
}
function replaceTopLevelSetting(content, key, value) {
  const lines = content.split(/\n/);
  const matchingIndexes = [];
  for (let index = 0;index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined || isSectionHeader3(line))
      break;
    if (topLevelSettingKey(line) === key)
      matchingIndexes.push(index);
  }
  const firstIndex = matchingIndexes[0];
  if (firstIndex === undefined) {
    lines.splice(topLevelInsertionIndex(lines), 0, `${key} = ${JSON.stringify(value)}`);
    return lines.join(`
`);
  }
  const indent = lines[firstIndex]?.match(/^\s*/)?.[0] ?? "";
  lines[firstIndex] = `${indent}${key} = ${JSON.stringify(value)}`;
  for (let index = matchingIndexes.length - 1;index >= 1; index -= 1) {
    const duplicateIndex = matchingIndexes[index];
    if (duplicateIndex !== undefined)
      lines.splice(duplicateIndex, 1);
  }
  return lines.join(`
`);
}
function topLevelSettingKey(line) {
  const match = stripTomlLineComment2(line).trim().match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*=/);
  return match?.[1];
}
function topLevelInsertionIndex(lines) {
  const sectionIndex = lines.findIndex((line) => isSectionHeader3(line));
  const topLevelEnd = sectionIndex === -1 ? lines.length : sectionIndex;
  let insertionIndex = topLevelEnd;
  while (insertionIndex > 0 && lines[insertionIndex - 1] === "")
    insertionIndex -= 1;
  return insertionIndex;
}
function isSectionHeader3(line) {
  const trimmed = stripTomlLineComment2(line).trim();
  return trimmed.startsWith("[") && trimmed.endsWith("]");
}
function stripTomlLineComment2(line) {
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

// packages/omo-codex/src/install/preserved-agent-settings.ts
import { lstat as lstat7, readFile as readFile13, readdir as readdir6, writeFile as writeFile6 } from "node:fs/promises";
import { join as join25 } from "node:path";

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
      },
      {
        previous: { model: "gpt-5.6-sol", effort: "max" },
        current: { model: "gpt-5.6-sol", effort: "high" }
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
      }
    ]
  ],
  [
    "lazycodex-worker-high",
    [
      {
        previous: { model: "gpt-5.6-sol", effort: "max" },
        current: { model: "gpt-5.6-sol", effort: "medium" }
      }
    ]
  ],
  [
    "lazycodex-code-reviewer",
    [
      {
        previous: { model: "gpt-5.6-sol", effort: "xhigh" },
        current: { model: "gpt-5.6-terra", effort: "medium" }
      }
    ]
  ],
  [
    "lazycodex-clone-fidelity-reviewer",
    [
      {
        previous: { model: "gpt-5.6-sol", effort: "xhigh" },
        current: { model: "gpt-5.6-terra", effort: "high" }
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
      },
      {
        previous: { model: "gpt-5.6-sol", effort: "high" },
        current: { model: "gpt-5.6-sol", effort: "low" }
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
  const agentsDir = join25(input.codexHome, "agents");
  if (!await exists2(agentsDir))
    return new Map;
  const preserved = new Map;
  const agentEntries = await readdir6(agentsDir, { withFileTypes: true });
  for (const entry of agentEntries) {
    if (!entry.name.endsWith(".toml"))
      continue;
    const content = await readTextIfExists(join25(agentsDir, entry.name));
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
  const agentsDir = join25(input.codexHome, "agents");
  if (!await exists2(agentsDir))
    return new Map;
  const preserved = new Map;
  const agentEntries = await readdir6(agentsDir, { withFileTypes: true });
  for (const entry of agentEntries) {
    if (!entry.name.endsWith(".toml"))
      continue;
    const content = await readTextIfExists(join25(agentsDir, entry.name));
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
    if (isSectionHeader4(line))
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
    if (line === undefined || isSectionHeader4(line))
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
  lines.splice(topLevelInsertionIndex2(lines), 0, `${key} = ${JSON.stringify(value)}`);
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
function topLevelInsertionIndex2(lines) {
  const sectionIndex = lines.findIndex((line) => isSectionHeader4(line));
  const topLevelEnd = sectionIndex === -1 ? lines.length : sectionIndex;
  let insertionIndex = topLevelEnd;
  while (insertionIndex > 0 && lines[insertionIndex - 1] === "") {
    insertionIndex -= 1;
  }
  return insertionIndex;
}
function isSectionHeader4(line) {
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
import { join as join26 } from "node:path";
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
  const agentsDir = join26(input.codexHome, "agents");
  if (!await exists3(agentsDir))
    return;
  for (const retiredAgent of RETIRED_MANAGED_AGENT_FILES) {
    const agentPath = join26(agentsDir, retiredAgent.fileName);
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
  const agentsDir = join27(input.codexHome, "agents");
  await mkdir6(agentsDir, { recursive: true });
  const linked = [];
  for (const agentPath of bundledAgents) {
    const agentFileName = basename6(agentPath);
    const agentName = agentNameFromToml2(agentFileName);
    const linkPath = join27(agentsDir, agentFileName);
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
    const agentModelOverride = input.agentModelOverrides?.get(agentName);
    if (agentModelOverride !== undefined) {
      const content = await readFile15(linkPath, "utf8");
      await writeFile7(linkPath, applyCodexAgentModelOverride(content, agentModelOverride));
    }
    linked.push({ name: agentFileName, path: linkPath, target: agentPath });
  }
  await writeManifest(input.pluginRoot, linked.map((entry) => entry.path));
  return linked;
}
async function discoverBundledAgents(pluginRoot) {
  const componentsRoot = join27(pluginRoot, "components");
  if (!await exists4(componentsRoot))
    return [];
  const componentEntries = await readdir7(componentsRoot, { withFileTypes: true });
  const agents = [];
  for (const entry of componentEntries) {
    if (!entry.isDirectory())
      continue;
    const agentsRoot = join27(componentsRoot, entry.name, "agents");
    if (!await exists4(agentsRoot))
      continue;
    const agentEntries = await readdir7(agentsRoot, { withFileTypes: true });
    for (const file of agentEntries) {
      if (!file.isFile() || !file.name.endsWith(".toml"))
        continue;
      agents.push(join27(agentsRoot, file.name));
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
  const manifestPath = join27(pluginRoot, MANIFEST_FILE);
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
import { readFile as readFile16 } from "node:fs/promises";
import { join as join28 } from "node:path";
var DEFAULT_MARKETPLACE_PATH = "packages/omo-codex/marketplace.json";
async function readMarketplace(repoRoot, options) {
  const marketplacePath = options?.marketplacePath ?? join28(repoRoot, DEFAULT_MARKETPLACE_PATH);
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
  return join28(repoRoot, ...relativePath.split(/[\\/]/));
}
async function readPluginManifest(pluginRoot) {
  const raw = await readFile16(join28(pluginRoot, ".codex-plugin", "plugin.json"), "utf8");
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
import { join as join29, sep as sep6 } from "node:path";
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
  return join29(codexHome, INSTALLED_MARKETPLACES_DIR, marketplaceName);
}
async function writeMarketplaceManifest(marketplaceRoot, marketplace) {
  const manifestDir = join29(marketplaceRoot, ".agents", "plugins");
  await mkdir7(manifestDir, { recursive: true });
  const tempPath = join29(manifestDir, `.marketplace-${process.pid}-${Date.now()}.json.tmp`);
  await writeFile8(tempPath, `${JSON.stringify(marketplace, null, "\t")}
`);
  await rename4(tempPath, join29(manifestDir, "marketplace.json"));
}
async function writeSnapshotPlugin(marketplaceRoot, plugin) {
  const pluginsDir = join29(marketplaceRoot, "plugins");
  await mkdir7(pluginsDir, { recursive: true });
  const targetPath = join29(pluginsDir, plugin.name);
  const tempPath = join29(pluginsDir, `.tmp-${plugin.name}-${process.pid}-${Date.now()}`);
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
import { readdir as readdir8, readFile as readFile17, writeFile as writeFile9 } from "node:fs/promises";
import { join as join30 } from "node:path";
async function readDistributionManifest(repoRoot) {
  try {
    const parsed = JSON.parse(await readFile17(join30(repoRoot, "package.json"), "utf8"));
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
  const manifestPath = join30(input.pluginRoot, ".codex-plugin", "plugin.json");
  const hookPaths = await readPluginHookPaths(manifestPath);
  await stampJsonVersion(manifestPath, input.version);
  await stampJsonVersion(join30(input.pluginRoot, "package.json"), input.version);
  for (const hookPath of hookPaths) {
    await stampHookStatusMessages(join30(input.pluginRoot, hookPath), input.version);
  }
  await stampComponentVersions(input);
}
async function writeLazyCodexInstallSnapshot(input) {
  if (input.distributionManifest === undefined)
    return;
  await writeFile9(join30(input.pluginRoot, "lazycodex-install.json"), `${JSON.stringify({
    packageName: input.distributionManifest.name,
    version: input.distributionManifest.version
  }, null, "\t")}
`);
}
async function stampJsonVersion(path, version2) {
  try {
    const parsed = JSON.parse(await readFile17(path, "utf8"));
    if (!isPlainRecord(parsed))
      return;
    parsed.version = version2;
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
async function stampHookStatusMessages(path, version2) {
  try {
    const parsed = JSON.parse(await readFile17(path, "utf8"));
    if (!isPlainRecord(parsed))
      return;
    stampHookGroups(parsed.hooks, version2);
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
    entries = await readdir8(join30(input.pluginRoot, "components"));
  } catch (error) {
    if (error instanceof Error)
      return;
    throw error;
  }
  for (const entry of entries) {
    const componentRoot = join30(input.pluginRoot, "components", entry);
    await stampJsonVersion(join30(componentRoot, "package.json"), input.version);
    await stampHookStatusMessages(join30(componentRoot, "hooks", "hooks.json"), input.version);
  }
}
function stampHookGroups(hooks, version2) {
  if (!isPlainRecord(hooks))
    return;
  for (const groups of Object.values(hooks)) {
    if (!Array.isArray(groups))
      continue;
    for (const group of groups) {
      if (!isPlainRecord(group) || !Array.isArray(group.hooks))
        continue;
      for (const hook of group.hooks) {
        stampHookStatusMessage(hook, version2);
      }
    }
  }
}
function stampHookStatusMessage(hook, version2) {
  if (!isPlainRecord(hook) || typeof hook.statusMessage !== "string")
    return;
  hook.statusMessage = hook.statusMessage.replace(/^(?:LazyCodex\([^)]+\):|\(OmO(?:\s+[^)]+)?\))\s*/, `(OmO ${normalizeHookStatusVersion(version2)}) `);
}
function normalizeHookStatusVersion(version2) {
  const normalized = version2.trim();
  return normalized.length === 0 ? "local" : normalized;
}

// packages/omo-codex/src/install/codex-project-local-cleanup.ts
import { copyFile as copyFile2, lstat as lstat10, readFile as readFile18, writeFile as writeFile10 } from "node:fs/promises";
import { dirname as dirname13, join as join31, resolve as resolve9 } from "node:path";
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
  const changedConfigs = configs.filter((config2) => config2.changed);
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
  for (const config2 of configs) {
    for (const key of config2.removedKeys) {
      if (!keys.includes(key))
        keys.push(key);
    }
  }
  return keys;
}
function lastValue(values) {
  return values.length > 0 ? values[values.length - 1] ?? null : null;
}
function repairProjectLocalCodexConfigText(config2) {
  if (!isMultiAgentV2Enabled(config2))
    return { config: config2, changed: false, removedKeys: [] };
  let nextConfig = config2;
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
  const codexHomeConfigPath = codexHome === undefined ? null : join31(resolve9(codexHome), "config.toml");
  let current = resolve9(startDirectory);
  const configPathsFromCwd = [];
  while (true) {
    const configPath = join31(current, ".codex", "config.toml");
    if (await isRegularProjectLocalConfig(current, configPath)) {
      if (codexHomeConfigPath === null || resolve9(configPath) !== codexHomeConfigPath) {
        configPathsFromCwd.push(configPath);
      }
    }
    if (await exists5(join31(current, ".git"))) {
      return configPathsFromCwd.length === 0 ? null : {
        projectRoot: current,
        configPaths: [...configPathsFromCwd].reverse(),
        artifactRoots: artifactRootsForConfigPaths(configPathsFromCwd)
      };
    }
    const parent = dirname13(current);
    if (parent === current) {
      const nearestConfigPath = configPathsFromCwd[0];
      return nearestConfigPath === undefined ? null : {
        projectRoot: dirname13(dirname13(nearestConfigPath)),
        configPaths: [nearestConfigPath],
        artifactRoots: [dirname13(dirname13(nearestConfigPath))]
      };
    }
    current = parent;
  }
}
async function isRegularProjectLocalConfig(directory, configPath) {
  const codexDirStat = await maybeLstat(join31(directory, ".codex"));
  if (codexDirStat === null || !codexDirStat.isDirectory() || codexDirStat.isSymbolicLink())
    return false;
  const configStat = await maybeLstat(configPath);
  return configStat !== null && configStat.isFile() && !configStat.isSymbolicLink();
}
function artifactRootsForConfigPaths(configPaths) {
  const roots = [];
  for (const configPath of configPaths) {
    const root = dirname13(dirname13(configPath));
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
      const artifactPath = join31(projectRoot, relativePath);
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
function isMultiAgentV2Enabled(config2) {
  const featuresSection = findTomlSection(config2, "features");
  if (featuresSection !== null && settingIsBooleanTrue(featuresSection.text, "multi_agent_v2"))
    return true;
  const multiAgentSection = findTomlSection(config2, "features.multi_agent_v2");
  return multiAgentSection !== null && settingIsBooleanTrue(multiAgentSection.text, "enabled");
}
function settingIsBooleanTrue(sectionText, key) {
  return new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*true\\s*(?:#.*)?$`, "m").test(sectionText);
}
function hasSetting(sectionText, key) {
  return new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`, "m").test(sectionText);
}
function formatBackupTimestamp(date3) {
  return date3.toISOString().replace(/[:.]/g, "-");
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
import { lstat as lstat11, readFile as readFile20, readdir as readdir10, rm as rm10 } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as join32, posix as posix5 } from "node:path";

// packages/omo-codex/src/install/lsp-daemon-reaper-attestation.ts
import { execFile } from "node:child_process";
import { readFile as readFile19, readdir as readdir9, readlink as readlink5 } from "node:fs/promises";
import { connect } from "node:net";
import { basename as basename7 } from "node:path";
var PROBE_TIMEOUT_MS = 500;
async function probeLegacyJsonRpcEndpoint(endpoint, timeoutMs = PROBE_TIMEOUT_MS) {
  return await new Promise((resolve10) => {
    const socket = connect(endpoint);
    let settled = false;
    let buffer = "";
    const finish = (value) => {
      if (settled)
        return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve10(value);
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
  const executable = basename7(argv[0] ?? "");
  if (!/^node(?:\.exe)?$/i.test(executable))
    return false;
  return argv.some((value) => value === "cli.js" || value.endsWith("/cli.js") || value.endsWith("\\cli.js"));
}
function lsofShowsUnixEndpoint(output, pid, endpoint) {
  const lines = output.split(/\r?\n/).filter((line) => line.length > 0);
  const endpointName = basename7(endpoint);
  return lines.includes(`p${pid}`) && lines.some((line) => line === `n${endpoint}` || line === `n${endpointName}`);
}
function isNodeCliDaemonCommand(command) {
  return /\bnode(?:\.exe)?\b/i.test(command) && /\bcli\.js\b/.test(command) && /\bdaemon\b/.test(command);
}
async function executeForStdout(executeFileImpl, file, args) {
  return await new Promise((resolve10) => {
    executeFileImpl(file, [...args], { encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 1000 }, (error, stdout) => {
      if (error !== null) {
        resolve10(null);
        return;
      }
      resolve10(stdout);
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
  const daemonRoot = join32(codexHome, "codex-lsp", "daemon");
  const platform = deps.platform ?? process.platform;
  const tmpDir = deps.tmpDir ?? tmpdir();
  const probe = deps.probeLegacyJsonRpc ?? probeLegacyJsonRpcEndpoint;
  const attest = deps.attestLegacyDaemonOwnership ?? ((input) => attestLegacyDaemonOwnership(input));
  const killProcess = deps.killProcess ?? sendSigterm;
  const waitForProcessExit = deps.waitForProcessExit ?? defaultWaitForProcessExit;
  const entries = await readdir10(daemonRoot, { withFileTypes: true }).catch(() => []);
  const results = [];
  for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name))) {
    const versionPath = join32(daemonRoot, entry.name);
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
  const version2 = entryName.slice(1);
  return LEGACY_VERSION_PATTERN.test(version2) ? version2 : null;
}
async function readLegacyMetadata(input) {
  const pidText = await readRegularTrimmedFile(join32(input.versionPath, "daemon.pid"));
  if (pidText === "non_regular")
    return { kind: "remove", reason: "removed non-regular legacy daemon metadata" };
  if (pidText === null)
    return { kind: "remove", reason: "removed malformed legacy daemon metadata" };
  const pid = Number.parseInt(pidText, 10);
  if (!Number.isInteger(pid) || pid <= 0)
    return { kind: "remove", reason: "removed malformed legacy daemon metadata" };
  const endpointText = await readRegularTrimmedFile(join32(input.versionPath, "daemon.endpoint"));
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
  const natural = posix5.join(input.versionPath, "daemon.sock");
  const hashed = posix5.join(input.tmpDir, `omo-lsp-${input.version}-${shortDigest(input.versionPath)}.sock`);
  return [natural, hashed];
}
async function readRegularTrimmedFile(path) {
  const stats = await lstat11(path).catch(() => null);
  if (stats === null)
    return null;
  if (!stats.isFile())
    return "non_regular";
  const content = (await readFile20(path, "utf8")).trim();
  return content.length > 0 ? content : null;
}
function shortDigest(value) {
  return createHash2("sha256").update(value).digest("hex").slice(0, 16);
}
async function removeVersionDir(path) {
  await rm10(path, { recursive: true, force: true });
}
function removed(version2, reason) {
  return { version: version2, status: "removed", reason };
}
function terminated(version2, reason) {
  return { version: version2, status: "terminated", reason };
}
function deferred(version2, reason) {
  return { version: version2, status: "deferred", reason };
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
    await new Promise((resolve10) => setTimeout(resolve10, 100));
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
import { homedir as homedir2 } from "node:os";
import { join as join33, resolve as resolve10 } from "node:path";
function resolveCodexInstallerBinDir(input) {
  const explicitBinDir = input.binDir ?? input.env?.CODEX_LOCAL_BIN_DIR;
  if (explicitBinDir !== undefined && explicitBinDir.trim().length > 0)
    return resolve10(explicitBinDir.trim());
  const homeDir = input.homeDir ?? homedir2();
  const defaultCodexHome = resolve10(homeDir, ".codex");
  const resolvedCodexHome = resolve10(input.codexHome);
  if (resolvedCodexHome !== defaultCodexHome)
    return join33(resolvedCodexHome, "bin");
  return resolve10(homeDir, ".local", "bin");
}

// packages/omo-codex/src/install/codex-git-bash-hooks.ts
import { readFile as readFile21, writeFile as writeFile11 } from "node:fs/promises";
import { join as join34 } from "node:path";
var WINDOWS_ONLY_GIT_BASH_HOOKS = new Set([
  "./hooks/pre-tool-use-recommending-git-bash-mcp.json",
  "./hooks/post-compact-resetting-git-bash-mcp-reminder.json"
]);
async function removeGitBashHooksOffWindows(input) {
  if (input.platform === "win32")
    return;
  const manifestPath = join34(input.pluginRoot, ".codex-plugin", "plugin.json");
  const parsed = JSON.parse(await readFile21(manifestPath, "utf8"));
  if (!isPlainRecord(parsed) || !Array.isArray(parsed.hooks))
    return;
  const hooks = parsed.hooks.filter((hook) => typeof hook !== "string" || !WINDOWS_ONLY_GIT_BASH_HOOKS.has(hook));
  if (hooks.length === parsed.hooks.length)
    return;
  await writeFile11(manifestPath, `${JSON.stringify({ ...parsed, hooks }, null, "\t")}
`);
}

// packages/omo-codex/src/install/omo-sot-migration.ts
import { join as join35 } from "node:path";
async function seedAndMigrateOmoSot(input) {
  const commandEnv = { ...input.env };
  const scriptPath = join35(input.repoRoot, "packages", "omo-codex", "plugin", "scripts", "migrate-omo-sot.mjs");
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
import { join as join37 } from "node:path";

// packages/utils/src/ast-grep/install-script.ts
import { spawn as spawn2 } from "node:child_process";
import { existsSync as existsSync7 } from "node:fs";
import { join as join36 } from "node:path";

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
var AST_GREP_INSTALL_TIMEOUT_MS = 30000;
function astGrepRuntimeDir(baseDir, platform = process.platform, arch = process.arch) {
  return join36(baseDir, "runtime", "ast-grep", runtimeSlug(platform, arch));
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
  const outcome = new Promise((resolve11) => {
    const settle = (result) => {
      if (settled)
        return;
      settled = true;
      resolve11(result);
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
  return join36(skillDir, platform === "win32" ? "install.ps1" : "install.sh");
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
  const fileExists = options.fileExists ?? existsSync7;
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
  const skillDir = join37(plugin.path, "skills", "ast-grep");
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
  const repoRoot = resolve11(options.repoRoot ?? findRepoRoot({ importerDir: import.meta.dir, env: env2 }));
  const codexHome = resolve11(options.codexHome ?? env2.CODEX_HOME ?? join40(homedir3(), ".codex"));
  const projectDirectory = resolve11(options.projectDirectory ?? env2.OMO_CODEX_PROJECT ?? process.cwd());
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
  const codexPackageRoot = join40(repoRoot, "packages", "omo-codex");
  const marketplace = await readMarketplace(repoRoot, {
    marketplacePath: join40(codexPackageRoot, "marketplace.json")
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
    const version3 = resolveLazyCodexPluginVersion({
      manifestVersion: manifest.version,
      marketplaceName: marketplace.name,
      pluginName: entry.name,
      distributionManifest,
      versionOverride
    });
    validatePathSegment(version3, "plugin version");
    log(`Building ${entry.name}@${version3}`);
    const plugin = await installCachedPlugin({
      buildSource,
      codexHome,
      env: env2,
      marketplaceName: marketplace.name,
      name: entry.name,
      runCommand,
      sourcePath,
      version: version3
    });
    if (marketplace.name === "sisyphuslabs" && plugin.name === "omo") {
      await stampLazyCodexPluginVersion({ pluginRoot: plugin.path, version: version3 });
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
        log(`Warning: skipped the omo runtime wrapper because ${join40(repoRoot, "dist", "cli", "index.js")} is missing; omo ulw-loop commands will be unavailable until a package shipping dist/cli is installed`);
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
  const agentModelOverrides = loadOmoAgentModelOverridesForInstall({
    cwd: projectDirectory,
    env: env2,
    marketplaceName: marketplace.name,
    installed,
    log,
    platform
  });
  for (const plugin of installed) {
    const pluginRoot = agentSourceRoots.get(plugin.name) ?? plugin.path;
    const appliesOmoOverrides = marketplace.name === "sisyphuslabs" && plugin.name === "omo";
    const agentLinks = await linkCachedPluginAgents({
      codexHome,
      pluginRoot,
      platform,
      preservedReasoning,
      preservedServiceTier,
      ...appliesOmoOverrides && agentModelOverrides !== undefined ? { agentModelOverrides: agentModelOverrides.agents } : {}
    });
    for (const link of agentLinks) {
      log(`Linked agent ${link.name} -> ${link.target}`);
      const agentName = agentNameFromToml3(link.name);
      agentConfigs.set(agentName, { name: agentName, configFile: `./agents/${link.name}` });
    }
    if (appliesOmoOverrides && agentModelOverrides !== undefined) {
      const managedAgentNames = new Set(agentLinks.map((link) => agentNameFromToml3(link.name)));
      for (const warning of unknownCodexAgentModelOverrideWarnings({
        configuredAgents: agentModelOverrides.agents.keys(),
        managedAgentNames
      })) {
        log(`Warning: ${warning}`);
      }
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
  const marketplaceRoot = join40(codexHome, "plugins", "cache", marketplace.name);
  await writeCachedMarketplaceManifest({
    marketplaceName: marketplace.name,
    marketplaceRoot,
    plugins: installed
  });
  const configPath = join40(codexHome, "config.toml");
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
    autonomousPermissions: options.autonomousPermissions !== false,
    ...options.reasoning === undefined ? {} : { reasoning: options.reasoning }
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
function loadOmoAgentModelOverridesForInstall(input) {
  if (input.marketplaceName !== "sisyphuslabs" || !input.installed.some((plugin) => plugin.name === "omo")) {
    return;
  }
  try {
    const result = getCodexAgentModelOverrides({ cwd: input.cwd, env: input.env, platform: input.platform });
    for (const warning of result.warnings)
      input.log(`Warning: ${warning}`);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    input.log(`Warning: failed to load Codex agent model overrides: ${message}`);
    return;
  }
}
function findRepoRootFromImporter(importerDir) {
  let current = importerDir;
  for (let depth = 0;depth <= 7; depth += 1) {
    if (isRepoRootWithCodexPlugin(current))
      return current;
    for (const wrapperPackageRoot of [join40(current, "node_modules", "oh-my-openagent"), join40(current, "oh-my-openagent")]) {
      if (isRepoRootWithCodexPlugin(wrapperPackageRoot))
        return wrapperPackageRoot;
    }
    current = resolve11(current, "..");
  }
  throw new Error("Unable to locate vendored Codex plugin: expected packages/omo-codex/plugin/.codex-plugin/plugin.json in this package or sibling oh-my-openagent package within 7 parent levels");
}
function findRepoRoot(input) {
  const wrapperPackageRoot = input.env?.OMO_WRAPPER_PACKAGE_ROOT;
  if (wrapperPackageRoot !== undefined && wrapperPackageRoot.trim().length > 0) {
    const resolvedWrapperPackageRoot = resolve11(wrapperPackageRoot);
    if (isRepoRootWithCodexPlugin(resolvedWrapperPackageRoot))
      return resolvedWrapperPackageRoot;
  }
  return findRepoRootFromImporter(input.importerDir);
}
function isRepoRootWithCodexPlugin(repoRoot) {
  return existsSync10(join40(repoRoot, "packages", "omo-codex", "plugin", ".codex-plugin", "plugin.json"));
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
import { readFileSync as readFileSync6 } from "node:fs";
import { dirname as dirname15, join as join42 } from "node:path";
import { createInterface as createInterface2 } from "node:readline/promises";
import { fileURLToPath } from "node:url";

// packages/omo-codex/src/install/lazycodex-bun-global-paths.ts
import { join as join41 } from "node:path";
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
    ...bunInstallRoot ? [join41(bunInstallRoot, "bin"), join41(bunInstallRoot, "install", "global", "node_modules")] : [],
    ...homeRoot ? [join41(homeRoot, ".bun", "bin"), join41(homeRoot, ".bun", "install", "global", "node_modules")] : []
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
  const pluginRoot = dirname15(dirname15(fileURLToPath(import.meta.url)));
  return readVersionManifest(resolveInstalledVersionPath(env2, pluginRoot)) ?? readVersionManifest(join42(pluginRoot, "..", "..", "..", "package.json")) ?? readVersionManifest(join42(pluginRoot, ".codex-plugin", "plugin.json"));
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
  const version3 = result.stdout.trim();
  return version3.length > 0 ? version3 : undefined;
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
  return new Promise((resolve12, reject) => {
    const child = spawn3(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: "inherit",
      shell: false
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve12();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with ${code ?? "unknown status"}`));
    });
  });
}
function parseVersion(version3) {
  if (typeof version3 !== "string")
    return null;
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([^+]+))?(?:\+.*)?$/.exec(version3.trim());
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
  return join42(pluginRoot, INSTALLED_VERSION_FILE);
}
function readVersionManifest(path2) {
  try {
    const parsed = JSON.parse(readFileSync6(path2, "utf8"));
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
import { readFile as readFile22, writeFile as writeFile12 } from "node:fs/promises";
import { join as join43 } from "node:path";
var GIT_BASH_ENV_KEY2 = "OMO_CODEX_GIT_BASH_PATH";
var CODEGRAPH_RELATIVE_ARGS2 = new Set(["components/codegraph/dist/serve.js", "./components/codegraph/dist/serve.js"]);
async function stampGitBashMcpEnv(input) {
  const manifestPath = join43(input.pluginRoot, ".mcp.json");
  if (!await fileExistsStrict(manifestPath))
    return false;
  const parsed = JSON.parse(await readFile22(manifestPath, "utf8"));
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
  codegraphServer["args"] = [join43(pluginRoot, "components", "codegraph", "dist", "serve.js"), ...args.slice(1)];
  return true;
}

// packages/omo-codex/src/install/install-local-cli.ts
async function installMarketplaceLocally(options = {}) {
  return runCodexInstaller(options);
}
function resolveDefaultRepoRootForEntrypoint(entrypointPath) {
  return resolve12(dirname16(entrypointPath), "..", "..", "..");
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
    const packageJson = JSON.parse(await readFile23(join44(input.defaultRepoRoot, "package.json"), "utf8"));
    const version3 = typeof packageJson.version === "string" ? packageJson.version : "unknown";
    input.log(`lazycodex-ai ${version3}`);
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
        repoRoot: resolve12(parsed.repoRoot),
        autonomousPermissions: true,
        env: input.env,
        log: logWarning
      });
      input.log(`Installed ${result2.installed.length} plugin(s) from ${result2.marketplaceName}.`);
      return 0;
    }
    return runLazyCodexManualUpdate({ env: input.env, dryRun: parsed.dryRun, log: input.log, invokedPath: input.invokedPath });
  }
  const repoRoot = parsed.repoRoot ? resolve12(parsed.repoRoot) : input.defaultRepoRoot;
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
