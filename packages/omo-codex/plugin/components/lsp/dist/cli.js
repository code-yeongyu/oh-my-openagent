#!/usr/bin/env node

// src/cli.ts
import { spawn as spawn3 } from "node:child_process";
import { argv, execPath as execPath2, stderr } from "node:process";

// src/codex-hook-cli.ts
import { stdin as processStdin } from "node:process";

// src/codex-hook.ts
import { readFileSync as readFileSync10, realpathSync as realpathSync8 } from "node:fs";
import { homedir as homedir3 } from "node:os";
import { join as join12, resolve as resolve12 } from "node:path";

// ../../../../lsp-daemon/dist/client.js
import { statSync as statSync5 } from "node:fs";
import { isAbsolute as isAbsolute6 } from "node:path";
import { connect } from "node:net";
import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync, realpathSync, statSync } from "node:fs";
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import { closeSync as closeSync2, existsSync as existsSync2, mkdirSync as mkdirSync2, openSync as openSync2, writeSync as writeSync2 } from "node:fs";
import { Socket } from "node:net";
import { dirname as dirname3, isAbsolute as isAbsolute3 } from "node:path";
import { argv0, execPath } from "node:process";
import {
  chmodSync,
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync
} from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { homedir as homedir2, tmpdir, userInfo } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { statSync as statSync2 } from "node:fs";
import { isAbsolute as isAbsolute2 } from "node:path";
import { existsSync as existsSync11, realpathSync as realpathSync5, statSync as statSync4 } from "node:fs";
import { basename as basename3, dirname as dirname10, join as join5, resolve as resolve8 } from "node:path";
import { basename as basename2, extname } from "node:path";
import { resolve as resolve6 } from "node:path";
import { pathToFileURL as pathToFileURL3 } from "node:url";
import { pathToFileURL } from "node:url";
import { spawn as spawn2, spawnSync } from "node:child_process";
import { existsSync as existsSync3, statSync as statSync3 } from "node:fs";
import { delimiter as delimiter2, join as join2 } from "node:path";
import { readFileSync as readFileSync2, realpathSync as realpathSync2 } from "node:fs";
import { relative as relative2, resolve as resolve2 } from "node:path";
import { pathToFileURL as pathToFileURL2 } from "node:url";
import { existsSync as existsSync5, lstatSync as lstatSync3, renameSync, rmSync, writeFileSync } from "node:fs";
import { existsSync as existsSync4, lstatSync as lstatSync2, readFileSync as readFileSync3, readdirSync, realpathSync as realpathSync3 } from "node:fs";
import { dirname as dirname4, isAbsolute as isAbsolute4, relative as relative3, resolve as resolve3 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
import { createHash as createHash2 } from "node:crypto";
import { dirname as dirname5, relative as relative4, resolve as resolve4 } from "node:path";
import { existsSync as existsSync6, lstatSync as lstatSync4, readdirSync as readdirSync2 } from "node:fs";
import { dirname as dirname6, resolve as resolve5 } from "node:path";
import { existsSync as existsSync7, realpathSync as realpathSync4 } from "node:fs";
import { dirname as dirname7, join as join3 } from "node:path";
import { existsSync as existsSync8, mkdirSync as mkdirSync3, readFileSync as readFileSync4, renameSync as renameSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { dirname as dirname8 } from "node:path";
import { existsSync as existsSync9, readFileSync as readFileSync5 } from "node:fs";
import { existsSync as existsSync10 } from "node:fs";
import { delimiter as delimiter3, dirname as dirname9, isAbsolute as isAbsolute5, join as join4, resolve as resolve7 } from "node:path";
import { existsSync as existsSync12, lstatSync as lstatSync5, readdirSync as readdirSync3 } from "node:fs";
import { join as join6, resolve as resolve9 } from "node:path";
import { fileURLToPath as fileURLToPath3 } from "node:url";
import { lstatSync as lstatSync6, readdirSync as readdirSync4 } from "node:fs";
import { join as join7 } from "node:path";
import { readFileSync as readFileSync6, renameSync as renameSync3, unlinkSync as unlinkSync2, writeFileSync as writeFileSync3 } from "node:fs";

class LspRequestContextParseError extends Error {
  code;
  name = "LspRequestContextParseError";
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

class LspRequestContextUnavailableError extends Error {
  name = "LspRequestContextUnavailableError";
  constructor() {
    super("LSP request context is required. Standalone MCP startup must install one with runWithRequestContext(createStandaloneMcpRequestContext()).");
  }
}
var storage = new AsyncLocalStorage;
var CONTEXT_FIELDS = new Set(["cwd", "projectConfigPaths", "userConfigPath", "installDecisionsPath", "capabilities"]);
var CAPABILITY_FIELDS = new Set(["installDecisionTool"]);
function lspRequestContext() {
  const context = storage.getStore();
  if (!context)
    throw new LspRequestContextUnavailableError;
  return context;
}
function contextCwd() {
  return lspRequestContext().cwd;
}
function parseLspRequestContext(value) {
  if (!isRecord(value)) {
    throw new LspRequestContextParseError("invalid_context", "LSP request context must be an object.");
  }
  rejectUnknownFields(value, CONTEXT_FIELDS, "context");
  const cwd = stringField(value, "cwd");
  const projectConfigPaths = stringArrayField(value, "projectConfigPaths");
  const userConfigPath = stringField(value, "userConfigPath");
  const installDecisionsPath = stringField(value, "installDecisionsPath");
  const capabilities = capabilitiesField(value["capabilities"]);
  const canonical = canonicalCwd(cwd);
  for (const path2 of projectConfigPaths) {
    requireAbsolutePath(path2, "projectConfigPaths");
    const projectPath = canonicalizeExistingOrNearestAncestor(path2);
    if (!isPathInside(canonical, projectPath)) {
      throw new LspRequestContextParseError("project_config_outside_cwd", `Project LSP config path must be inside cwd: ${path2}`);
    }
  }
  requireAbsolutePath(userConfigPath, "userConfigPath");
  requireAbsolutePath(installDecisionsPath, "installDecisionsPath");
  return {
    cwd: canonical,
    projectConfigPaths: projectConfigPaths.map((path2) => canonicalizeExistingOrNearestAncestor(path2)),
    userConfigPath,
    installDecisionsPath,
    capabilities
  };
}
function canonicalCwd(cwd) {
  const resolved = resolve(cwd);
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    throw new LspRequestContextParseError("invalid_cwd", `LSP request cwd must be an existing directory: ${cwd}`);
  }
  return realpathSync(resolved);
}
function canonicalizeExistingOrNearestAncestor(path2) {
  let current = resolve(path2);
  const suffix = [];
  while (true) {
    try {
      const existing = realpathSync(current);
      return suffix.length === 0 ? existing : join(existing, ...suffix);
    } catch (error) {
      if (!isMissingPathError(error))
        throw error;
      const parent = dirname(current);
      if (parent === current)
        throw error;
      suffix.unshift(basename(current));
      current = parent;
    }
  }
}
function capabilitiesField(value) {
  if (!isRecord(value)) {
    throw new LspRequestContextParseError("invalid_capabilities", "LSP request capabilities must be an object.");
  }
  rejectUnknownFields(value, CAPABILITY_FIELDS, "capabilities");
  const installDecisionTool = value["installDecisionTool"];
  if (typeof installDecisionTool !== "boolean") {
    throw new LspRequestContextParseError("invalid_install_decision_capability", "LSP request capabilities.installDecisionTool must be a boolean.");
  }
  return { installDecisionTool };
}
function stringField(value, field) {
  const fieldValue = value[field];
  if (typeof fieldValue !== "string" || fieldValue.length === 0) {
    throw new LspRequestContextParseError("invalid_field", `LSP request context.${field} must be a non-empty string.`);
  }
  return fieldValue;
}
function stringArrayField(value, field) {
  const fieldValue = value[field];
  if (!Array.isArray(fieldValue) || !fieldValue.every((item) => typeof item === "string" && item.length > 0)) {
    throw new LspRequestContextParseError("invalid_field", `LSP request context.${field} must be a non-empty string array.`);
  }
  return fieldValue;
}
function requireAbsolutePath(path2, field) {
  if (!isAbsolute(path2)) {
    throw new LspRequestContextParseError("relative_path", `LSP request context.${field} must be absolute: ${path2}`);
  }
}
function isPathInside(parent, child) {
  const childPath = resolve(child);
  const relativePath = relative(parent, childPath);
  return relativePath === "" || !relativePath.startsWith("..") && !isAbsolute(relativePath);
}
function isMissingPathError(error) {
  const code = errorCode(error);
  return code === "ENOENT" || code === "ENOTDIR";
}
function rejectUnknownFields(value, allowed, scope) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new LspRequestContextParseError("unknown_field", `Unknown LSP request ${scope} field: ${unknown.join(", ")}`);
  }
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function errorCode(error) {
  if (!error || typeof error !== "object" || !("code" in error))
    return;
  const code = Reflect.get(error, "code");
  return typeof code === "string" ? code : undefined;
}
function isPlainRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class DaemonRequestError extends Error {
  requestWritten;
  constructor(message, requestWritten) {
    super(message);
    this.name = "DaemonRequestError";
    this.requestWritten = requestWritten;
  }
}

class DaemonAuthenticationRejectedError extends DaemonRequestError {
  constructor() {
    super("daemon authentication failed before dispatch", true);
    this.name = "DaemonAuthenticationRejectedError";
  }
}

class DaemonRequestCancelledError extends DaemonRequestError {
  constructor(requestWritten) {
    super("daemon request cancelled", requestWritten);
    this.name = "DaemonRequestCancelledError";
  }
}

class DaemonRequestTimedOutError extends DaemonRequestError {
  timeoutMs;
  constructor(requestWritten, timeoutMs) {
    super("daemon request timed out", requestWritten);
    this.name = "DaemonRequestTimedOutError";
    this.timeoutMs = timeoutMs;
  }
}
function daemonFailureResult(paths, error) {
  if (error instanceof DaemonRequestCancelledError)
    return daemonCancelledResult(paths);
  if (error instanceof DaemonRequestTimedOutError)
    return daemonTimedOutResult(paths, error.timeoutMs);
  return daemonUnreachableResult(paths, error);
}
function daemonCancelledResult(paths) {
  const text = [
    "LSP daemon request cancelled: the caller aborted this request (for example, the turn was interrupted).",
    "The daemon stays available; no LSP work was applied. Retry when you are ready.",
    `Socket: ${paths.socket}`
  ].join(`
`);
  return { content: [{ type: "text", text }], isError: true };
}
function daemonTimedOutResult(paths, timeoutMs) {
  const text = [
    `LSP daemon request timed out after ${timeoutMs}ms: the daemon did not respond in time.`,
    "The daemon stays available but may be busy. Retry when you are ready.",
    `Socket: ${paths.socket}`,
    `Logs: ${paths.log}`
  ].join(`
`);
  return { content: [{ type: "text", text }], isError: true };
}
function daemonUnreachableResult(paths, error) {
  const text = [
    `LSP daemon unreachable: ${errorText(error)}.`,
    "The MCP server is a thin proxy and never runs language servers in-process.",
    `Socket: ${paths.socket}`,
    `Logs: ${paths.log}`,
    "The daemon is auto-started on demand and will be retried on the next request."
  ].join(`
`);
  return { content: [{ type: "text", text }], isError: true };
}
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}
var OMO_DAEMON_PROTOCOL_VERSION = 1;
var AUTH_ERROR_CODE = -32001;
function authEnvelope(token) {
  return { protocolVersion: OMO_DAEMON_PROTOCOL_VERSION, token };
}
function readAuthToken(paths) {
  try {
    const token = readFileSync(paths.auth, "utf8").trim();
    return token.length > 0 ? token : null;
  } catch (error) {
    if (error instanceof Error)
      return null;
    throw error;
  }
}
function isAuthErrorResponse(message) {
  if (!isPlainRecord(message))
    return false;
  const error = message["error"];
  if (!isPlainRecord(error))
    return false;
  const data = error["data"];
  return error["code"] === AUTH_ERROR_CODE && isPlainRecord(data) && data["code"] === "daemon_authentication_failed";
}
var OMO_LSP_DAEMON_DIR = "OMO_LSP_DAEMON_DIR";
var OMO_LSP_DAEMON_CLI = "OMO_LSP_DAEMON_CLI";
var OMO_LSP_DAEMON_VERSION = "OMO_LSP_DAEMON_VERSION";
var DAEMON_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;

class InvalidRuntimeOverrideError extends Error {
  code = "invalid_runtime_override";
  reason;
  constructor(reason, message) {
    super(message);
    this.name = "InvalidRuntimeOverrideError";
    this.reason = reason;
  }
}

class InvalidDaemonVersionError extends Error {
  code = "invalid_daemon_version";
  version;
  constructor(version) {
    super("LSP daemon version must match [A-Za-z0-9][A-Za-z0-9._+-]{0,127}");
    this.name = "InvalidDaemonVersionError";
    this.version = version;
  }
}
function validateDaemonVersion(version) {
  if (!DAEMON_VERSION_PATTERN.test(version))
    throw new InvalidDaemonVersionError(version);
  return version;
}
function resolveDaemonRuntime(env, defaults) {
  const cliOverride = env[OMO_LSP_DAEMON_CLI];
  const versionOverride = env[OMO_LSP_DAEMON_VERSION];
  const hasCliOverride = cliOverride !== undefined;
  const hasVersionOverride = versionOverride !== undefined;
  if (hasCliOverride !== hasVersionOverride) {
    throw new InvalidRuntimeOverrideError("paired_values_required", `${OMO_LSP_DAEMON_CLI} and ${OMO_LSP_DAEMON_VERSION} must be set together`);
  }
  if (!hasCliOverride || !hasVersionOverride) {
    if (!isAbsolute2(defaults.cliPath)) {
      throw new InvalidRuntimeOverrideError("packaged_cli_must_be_absolute", "Packaged LSP daemon CLI path must be absolute");
    }
    return { cliPath: defaults.cliPath, version: validateDaemonVersion(defaults.version) };
  }
  if (!isAbsolute2(cliOverride)) {
    throw new InvalidRuntimeOverrideError("cli_must_be_absolute", `${OMO_LSP_DAEMON_CLI} must be an absolute path to an existing regular file`);
  }
  let cliStats;
  try {
    cliStats = statSync2(cliOverride);
  } catch (error) {
    if (!(error instanceof Error))
      throw error;
    throw new InvalidRuntimeOverrideError("cli_not_found", `${OMO_LSP_DAEMON_CLI} must name an existing regular file`);
  }
  if (!cliStats.isFile()) {
    throw new InvalidRuntimeOverrideError("cli_not_file", `${OMO_LSP_DAEMON_CLI} must name an existing regular file`);
  }
  return { cliPath: cliOverride, version: validateDaemonVersion(versionOverride) };
}
var requireFromHere = createRequire(import.meta.url);
var MAX_SOCKET_PATH_LENGTH = 100;

class InvalidDaemonDirectoryError extends Error {
  code = "invalid_daemon_directory";
  directory;
  constructor(directory) {
    super(`${OMO_LSP_DAEMON_DIR} must be an absolute path`);
    this.name = "InvalidDaemonDirectoryError";
    this.directory = directory;
  }
}
function resolveDaemonVersion(requireFn = requireFromHere) {
  for (const candidate of ["./package.json", "../package.json"]) {
    let loaded;
    try {
      loaded = requireFn(candidate);
    } catch (error) {
      if (!(error instanceof Error))
        throw error;
      continue;
    }
    if (typeof loaded === "object" && loaded !== null && "version" in loaded) {
      const version = Reflect.get(loaded, "version");
      if (typeof version === "string")
        return validateDaemonVersion(version);
    }
  }
  return "0";
}
function packagedRuntimeDefaults() {
  return {
    cliPath: fileURLToPath(new URL("./cli.js", import.meta.url)),
    version: resolveDaemonVersion()
  };
}
function daemonBaseDir(env = process.env, platform = defaultDaemonPlatform()) {
  const override = env[OMO_LSP_DAEMON_DIR];
  if (override !== undefined) {
    if (!platform.path.isAbsolute(override))
      throw new InvalidDaemonDirectoryError(override);
    return platform.path.resolve(override);
  }
  return platform.path.resolve(platform.path.join(platform.homedir(), ".omo", "lsp-daemon"));
}
function daemonPaths(env = process.env, runtimeDefaults = packagedRuntimeDefaults(), platform = defaultDaemonPlatform()) {
  const runtime = resolveDaemonRuntime(env, runtimeDefaults);
  const baseDir = daemonBaseDir(env, platform);
  const dir = platform.path.resolve(platform.path.join(baseDir, `v${runtime.version}`));
  return {
    version: runtime.version,
    cliPath: runtime.cliPath,
    dir,
    socket: resolveSocketPath(dir, runtime.version, platform),
    lock: platform.path.join(dir, "daemon.lock"),
    pid: platform.path.join(dir, "daemon.pid"),
    auth: platform.path.join(dir, "daemon.auth"),
    endpoint: platform.path.join(dir, "daemon.endpoint"),
    owner: platform.path.join(dir, "daemon.owner"),
    log: platform.path.join(dir, "daemon.log")
  };
}
function defaultDaemonPlatform() {
  return {
    platform: process.platform,
    homedir: homedir2,
    tmpdir,
    getuid: () => typeof process.getuid === "function" ? process.getuid() : undefined,
    username: () => userInfo().username,
    path
  };
}
function resolveSocketPath(dir, version, platform) {
  const canonicalVersionDir = platform.path.resolve(dir);
  if (platform.platform === "win32") {
    const currentUserDiscriminator = `${platform.getuid() ?? "win"}:${platform.username()}:${platform.path.resolve(platform.homedir())}`;
    const digest = shortDigest(`${canonicalVersionDir}\x00${currentUserDiscriminator}`);
    return `\\\\.\\pipe\\omo-lsp-${version}-${digest}`;
  }
  const natural = platform.path.join(canonicalVersionDir, "daemon.sock");
  if (natural.length < MAX_SOCKET_PATH_LENGTH)
    return natural;
  return platform.path.join(platform.tmpdir(), `omo-lsp-${version}-${shortDigest(canonicalVersionDir)}`, "daemon.sock");
}
function shortDigest(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
function encodeJsonLine(message) {
  return `${JSON.stringify(message)}
`;
}
function createLineDecoder(onMessage, onParseError) {
  let buffer = "";
  return {
    push(chunk) {
      buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      let index = buffer.indexOf(`
`);
      while (index !== -1) {
        const raw = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (raw.length > 0) {
          try {
            onMessage(JSON.parse(raw));
          } catch (error) {
            if (error instanceof Error) {
              onParseError?.(raw, error);
            } else {
              throw error;
            }
          }
        }
        index = buffer.indexOf(`
`);
      }
    }
  };
}
var PROBE_TIMEOUT_MS = 500;
var DEFAULT_READY_TIMEOUT_MS = 5000;
var DEFAULT_POLL_INTERVAL_MS = 100;

class DaemonUnreachableError extends Error {
  constructor(socketPath) {
    super(`LSP daemon did not become reachable at ${socketPath}`);
    this.name = "DaemonUnreachableError";
  }
}
async function ensureDaemonRunning(paths, deps = defaultEnsureDaemonDeps(), options = {}) {
  const readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const signal = options.signal;
  throwIfAborted(signal);
  if (await awaitWithSignal(deps.probe(paths, signal), signal))
    return;
  throwIfAborted(signal);
  deps.spawnDaemon(paths);
  await waitUntilReachable(paths, deps, readyTimeoutMs, pollIntervalMs, signal);
}
async function waitUntilReachable(paths, deps, readyTimeoutMs, pollIntervalMs, signal) {
  const deadline = deps.now() + readyTimeoutMs;
  for (;; ) {
    throwIfAborted(signal);
    if (await awaitWithSignal(deps.probe(paths, signal), signal))
      return;
    if (deps.now() >= deadline)
      throw new DaemonUnreachableError(paths.socket);
    await awaitWithSignal(deps.sleep(pollIntervalMs, signal), signal);
  }
}
async function probeDaemon(paths, timeoutMs = PROBE_TIMEOUT_MS, signal) {
  const token = readAuthToken(paths);
  if (!token)
    return false;
  return await pingDaemon(paths, token, timeoutMs, signal) !== null;
}
function pingDaemon(paths, token, timeoutMs = PROBE_TIMEOUT_MS, signal) {
  return new Promise((resolve22) => {
    const socket = new Socket;
    let settled = false;
    let timer;
    const finish = (value) => {
      if (settled)
        return;
      settled = true;
      if (timer !== undefined)
        clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      socket.destroy();
      resolve22(value);
    };
    const onAbort = () => finish(null);
    const decoder = createLineDecoder((message) => {
      finish(parsePingResponse(message));
    });
    socket.once("connect", () => {
      socket.write(encodeJsonLine({ jsonrpc: "2.0", id: 1, method: "omo/ping", params: { _omo: authEnvelope(token) } }));
    });
    socket.on("data", (chunk) => decoder.push(chunk));
    socket.once("error", () => {
      finish(null);
    });
    timer = setTimeout(() => finish(null), timeoutMs);
    timer.unref?.();
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    socket.connect(paths.socket);
  });
}
function spawnDaemonProcess(paths) {
  mkdirSync2(dirname3(paths.log), { recursive: true });
  const logFd = openSync2(paths.log, "a");
  try {
    const child = spawn(resolveDaemonNodeExecutable(), [paths.cliPath, "daemon"], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      windowsHide: true
    });
    child.once("spawn", () => closeSync2(logFd));
    child.once("error", (error) => {
      writeSync2(logFd, `[lsp-daemon] failed to spawn daemon: ${error.message}
`);
      closeSync2(logFd);
    });
    child.unref();
  } catch (error) {
    closeSync2(logFd);
    throw error;
  }
}
function resolveDaemonNodeExecutable(cachedExecPath = execPath, originalArgv0 = argv0, pathExists = existsSync2) {
  if (pathExists(cachedExecPath))
    return cachedExecPath;
  if (isAbsolute3(originalArgv0) && pathExists(originalArgv0))
    return originalArgv0;
  return "node";
}
function defaultEnsureDaemonDeps() {
  return {
    probe: (paths, signal) => probeDaemon(paths, PROBE_TIMEOUT_MS, signal),
    spawnDaemon: (paths) => spawnDaemonProcess(paths),
    sleep: (ms, signal) => sleepWithSignal(ms, signal),
    now: () => Date.now()
  };
}
function sleepWithSignal(ms, signal) {
  return new Promise((resolve22) => {
    let settled = false;
    const finish = () => {
      if (settled)
        return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve22();
    };
    const timer = setTimeout(finish, ms);
    if (signal?.aborted) {
      finish();
      return;
    }
    signal?.addEventListener("abort", finish, { once: true });
  });
}
function awaitWithSignal(promise, signal) {
  if (!signal)
    return promise;
  if (signal.aborted)
    return Promise.reject(abortError(signal));
  return new Promise((resolve22, reject) => {
    let settled = false;
    const finish = (run) => {
      if (settled)
        return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      run();
    };
    const onAbort = () => finish(() => reject(abortError(signal)));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then((value) => finish(() => resolve22(value)), (error) => finish(() => reject(error)));
  });
}
function throwIfAborted(signal) {
  if (signal?.aborted)
    throw abortError(signal);
}
function abortError(signal) {
  const reason = signal.reason;
  if (reason instanceof Error)
    return reason;
  const error = new Error(typeof reason === "string" ? reason : "daemon startup cancelled");
  error.name = "AbortError";
  return error;
}
function parsePingResponse(message) {
  if (!message || typeof message !== "object" || Array.isArray(message))
    return null;
  const result = Reflect.get(message, "result");
  if (!result || typeof result !== "object" || Array.isArray(result))
    return null;
  const pid = Reflect.get(result, "pid");
  const nonce = Reflect.get(result, "nonce");
  const startedAt = Reflect.get(result, "startedAt");
  const endpoint = Reflect.get(result, "endpoint");
  if (typeof pid !== "number" || typeof nonce !== "string" || typeof startedAt !== "string")
    return null;
  if (!endpoint || typeof endpoint !== "object" || Array.isArray(endpoint))
    return null;
  const path2 = Reflect.get(endpoint, "path");
  const kind = Reflect.get(endpoint, "kind");
  if (typeof path2 !== "string")
    return null;
  if (kind === "windows")
    return { pid, nonce, startedAt, endpoint: { kind, path: path2 } };
  if (kind === "missing")
    return { pid, nonce, startedAt, endpoint: { kind, path: path2 } };
  const dev = Reflect.get(endpoint, "dev");
  const ino = Reflect.get(endpoint, "ino");
  if (kind === "unix" && typeof dev === "number" && typeof ino === "number") {
    return { pid, nonce, startedAt, endpoint: { kind, path: path2, dev, ino } };
  }
  return null;
}
var HEADER_SEPARATOR = Buffer.from(`\r
\r
`);
var DEFAULT_IDLE_TIMEOUT_MS = 10 * 60000;
var BASENAME_EXTENSIONS = {
  Dockerfile: ".dockerfile",
  Containerfile: ".dockerfile"
};
function effectiveExtension(filePath) {
  return BASENAME_EXTENSIONS[basename2(filePath)] ?? extname(filePath);
}

class LspConnectionClosedError extends Error {
  serverId;
  root;
  name = "LspConnectionClosedError";
  constructor(serverId, root, message) {
    super(message ?? `LSP connection closed for ${serverId} at ${root}`);
    this.serverId = serverId;
    this.root = root;
  }
}

class LspProcessExitedError extends Error {
  serverId;
  root;
  exitCode;
  stderrTail;
  name = "LspProcessExitedError";
  constructor(serverId, root, exitCode, stderrTail) {
    const stderrSuffix = stderrTail ? `
stderr tail: ${stderrTail}` : "";
    super(`LSP server ${serverId} at ${root} exited with code ${exitCode ?? "null"}${stderrSuffix}`);
    this.serverId = serverId;
    this.root = root;
    this.exitCode = exitCode;
    this.stderrTail = stderrTail;
  }
}

class LspRequestTimeoutError extends Error {
  method;
  stderrTail;
  name = "LspRequestTimeoutError";
  constructor(method, stderrTail) {
    const stderrSuffix = stderrTail ? `
recent stderr: ${stderrTail}` : "";
    super(`LSP request timeout (method: ${method})${stderrSuffix}`);
    this.method = method;
    this.stderrTail = stderrTail;
  }
}

class LspInvalidPathError extends Error {
  name = "LspInvalidPathError";
}

class LspServerLookupError extends Error {
  lookup;
  name = "LspServerLookupError";
  constructor(message, lookup) {
    super(message);
    this.lookup = lookup;
  }
}

class LspServerInitializingError extends Error {
  originalError;
  name = "LspServerInitializingError";
  constructor(originalError) {
    super(`LSP server is still initializing. Please retry in a few seconds. Original error: ${originalError.message}`);
    this.originalError = originalError;
  }
}

class LspProcessSpawnError extends Error {
  name = "LspProcessSpawnError";
}

class LspClientRespawnBudgetExceededError extends Error {
  serverId;
  root;
  retryLimit;
  name = "LspClientRespawnBudgetExceededError";
  constructor(serverId, root, retryLimit) {
    super(`LSP server ${serverId} at ${root} failed to stay alive; respawn budget exhausted ` + `(${retryLimit} consecutive dead generations). Retrying after the cooldown may succeed.`);
    this.serverId = serverId;
    this.root = root;
    this.retryLimit = retryLimit;
  }
}
function isLspDeadConnectionError(err) {
  return err instanceof LspConnectionClosedError || err instanceof LspProcessExitedError;
}
function writeCleanupError(message) {
  process.stderr.write(`${message}
`);
}
function reportBestEffortCleanupError(operation, error, logger = writeCleanupError) {
  const message = error instanceof Error ? error.message : String(error);
  logger(`[lsp] ignored ${operation} failure during cleanup: ${message}`);
}
var DEFAULT_MAX_REFERENCES = 200;
var DEFAULT_MAX_SYMBOLS = 200;
var DEFAULT_MAX_DIAGNOSTICS = 200;
var DEFAULT_MAX_DIRECTORY_FILES = 50;
var REQUEST_TIMEOUT_MS = 15000;
var INIT_TIMEOUT_MS = 60000;
var IDLE_TIMEOUT_MS = 5 * 60000;
var MAX_RESIDENT_CLIENTS = 6;
var REAPER_INTERVAL_MS = 60000;
var STOP_HARD_KILL_TIMEOUT_MS = 5000;
var STOP_SIGKILL_GRACE_MS = 1000;
var CLIENT_RESPAWN_RETRY_LIMIT = 2;
var CLIENT_RESPAWN_COOLDOWN_MS = 60000;
var HEADER_SEPARATOR2 = `\r
\r
`;
var PARSE_ERROR = -32700;
var INVALID_REQUEST = -32600;
var METHOD_NOT_FOUND = -32601;
var INTERNAL_ERROR = -32603;

class JsonRpcConnection {
  reader;
  writer;
  pendingRequests = new Map;
  notificationHandlers = new Map;
  requestHandlers = new Map;
  closeHandlers = [];
  errorHandlers = [];
  inputBuffer = Buffer.alloc(0);
  nextRequestId = 1;
  listening = false;
  disposed = false;
  constructor(reader, writer) {
    this.reader = reader;
    this.writer = writer;
  }
  listen() {
    if (this.listening)
      return;
    this.listening = true;
    this.reader.on("data", this.handleData);
    this.reader.on("close", this.handleClose);
    this.reader.on("end", this.handleClose);
    this.reader.on("error", this.handleStreamError);
    this.writer.on("error", this.handleStreamError);
  }
  onNotification(method, handler) {
    this.notificationHandlers.set(method, handler);
  }
  onRequest(method, handler) {
    this.requestHandlers.set(method, handler);
  }
  onClose(handler) {
    this.closeHandlers.push(handler);
  }
  onError(handler) {
    this.errorHandlers.push(handler);
  }
  async sendRequest(method, params, options = {}) {
    if (this.disposed)
      throw new Error("JSON-RPC connection is disposed");
    const id = this.nextRequestId;
    this.nextRequestId += 1;
    const key = String(id);
    const message = params === undefined ? { jsonrpc: "2.0", id, method } : { jsonrpc: "2.0", id, method, params };
    let requestWritten = false;
    let cancelAfterWrite = false;
    let settled = false;
    const writeCancel = () => this.writeMessage({ jsonrpc: "2.0", method: "$/cancelRequest", params: { id } });
    const responsePromise = new Promise((resolve22, reject) => {
      const cleanup = () => {
        options.signal?.removeEventListener("abort", onAbort);
      };
      const settleCancel = () => {
        if (settled)
          return;
        settled = true;
        this.pendingRequests.delete(key);
        cleanup();
        const rejectCancelled = () => reject(abortError2(options.signal));
        if (!requestWritten) {
          cancelAfterWrite = true;
          rejectCancelled();
          return;
        }
        writeCancel().then(rejectCancelled, (error) => {
          this.emitError(toError(error));
          rejectCancelled();
        });
      };
      const onAbort = () => settleCancel();
      this.pendingRequests.set(key, {
        resolve(result) {
          settled = true;
          cleanup();
          resolve22(result);
        },
        reject(error) {
          settled = true;
          cleanup();
          reject(error);
        },
        cleanup
      });
      if (options.signal?.aborted) {
        settleCancel();
        return;
      }
      options.signal?.addEventListener("abort", onAbort, { once: true });
    });
    if (settled)
      return responsePromise;
    try {
      await this.writeMessage(message);
      requestWritten = true;
      if (cancelAfterWrite)
        await writeCancel();
    } catch (error) {
      if (settled)
        return responsePromise;
      const pending = this.pendingRequests.get(key);
      if (pending) {
        pending.cleanup();
        this.pendingRequests.delete(key);
      }
      throw error;
    }
    return responsePromise;
  }
  pendingRequestCount() {
    return this.pendingRequests.size;
  }
  async sendNotification(method, params) {
    if (this.disposed)
      return;
    const message = params === undefined ? { jsonrpc: "2.0", method } : { jsonrpc: "2.0", method, params };
    await this.writeMessage(message);
  }
  dispose() {
    if (this.disposed)
      return;
    this.disposed = true;
    this.reader.off("data", this.handleData);
    this.reader.off("close", this.handleClose);
    this.reader.off("end", this.handleClose);
    this.reader.off("error", this.handleStreamError);
    this.writer.off("error", this.handleStreamError);
    for (const pending of this.pendingRequests.values()) {
      pending.cleanup();
      pending.reject(new Error("JSON-RPC connection disposed"));
    }
    this.pendingRequests.clear();
    this.notificationHandlers.clear();
    this.requestHandlers.clear();
  }
  handleData = (chunk) => {
    const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
    this.inputBuffer = Buffer.concat([this.inputBuffer, chunkBuffer]);
    this.drainInputBuffer();
  };
  handleClose = () => {
    for (const handler of this.closeHandlers) {
      handler();
    }
  };
  handleStreamError = (error) => {
    this.emitError(error);
  };
  drainInputBuffer() {
    while (true) {
      const headerEnd = this.inputBuffer.indexOf(HEADER_SEPARATOR2);
      if (headerEnd === -1)
        return;
      const headers = this.inputBuffer.subarray(0, headerEnd).toString("ascii");
      const contentLength = parseContentLength2(headers);
      if (contentLength === null) {
        this.inputBuffer = Buffer.alloc(0);
        this.emitError(new Error("JSON-RPC message is missing Content-Length header"));
        return;
      }
      const bodyStart = headerEnd + Buffer.byteLength(HEADER_SEPARATOR2);
      const bodyEnd = bodyStart + contentLength;
      if (this.inputBuffer.length < bodyEnd)
        return;
      const body = this.inputBuffer.subarray(bodyStart, bodyEnd).toString("utf8");
      this.inputBuffer = this.inputBuffer.subarray(bodyEnd);
      this.dispatchBody(body);
    }
  }
  dispatchBody(body) {
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (error) {
      this.writeError(null, PARSE_ERROR, error instanceof Error ? error.message : "Parse error").catch((writeError) => this.emitError(toError(writeError)));
      return;
    }
    if (!isJsonRpcObject(parsed)) {
      this.writeError(null, INVALID_REQUEST, "Invalid JSON-RPC message").catch((error) => this.emitError(toError(error)));
      return;
    }
    if ("id" in parsed && (("result" in parsed) || ("error" in parsed))) {
      this.handleResponse(parsed);
      return;
    }
    if (typeof parsed["method"] !== "string") {
      const id = getMessageId(parsed) ?? null;
      this.writeError(id, INVALID_REQUEST, "Invalid JSON-RPC method").catch((error) => this.emitError(toError(error)));
      return;
    }
    if ("id" in parsed) {
      this.handleRequest(parsed);
      return;
    }
    this.handleNotification(parsed["method"], parsed["params"]);
  }
  handleResponse(message) {
    const id = getMessageId(message);
    if (id === undefined)
      return;
    const pending = this.pendingRequests.get(String(id));
    if (!pending)
      return;
    this.pendingRequests.delete(String(id));
    pending.cleanup();
    if ("error" in message) {
      pending.reject(jsonRpcErrorToError(message["error"]));
      return;
    }
    pending.resolve(message["result"]);
  }
  handleNotification(method, params) {
    const handler = this.notificationHandlers.get(method);
    if (!handler)
      return;
    try {
      handler(params);
    } catch (error) {
      if (error instanceof Error) {
        this.emitError(error);
        return;
      }
      this.emitError(new Error(String(error)));
    }
  }
  handleRequest(message) {
    const id = getMessageId(message);
    if (id === undefined) {
      this.writeError(null, INVALID_REQUEST, "Invalid JSON-RPC id").catch((error) => this.emitError(toError(error)));
      return;
    }
    const method = typeof message["method"] === "string" ? message["method"] : "";
    const handler = this.requestHandlers.get(method);
    if (!handler) {
      this.writeError(id, METHOD_NOT_FOUND, `Method not found: ${method}`).catch((error) => this.emitError(toError(error)));
      return;
    }
    Promise.resolve().then(() => handler(message["params"])).then((result) => this.writeMessage({ jsonrpc: "2.0", id, result }), (error) => this.writeError(id, INTERNAL_ERROR, toError(error).message)).catch((error) => this.emitError(toError(error)));
  }
  async writeError(id, code, message) {
    await this.writeMessage({ jsonrpc: "2.0", id, error: { code, message } });
  }
  writeMessage(message) {
    const body = JSON.stringify(message);
    const payload = `Content-Length: ${Buffer.byteLength(body, "utf8")}\r
\r
${body}`;
    return new Promise((resolve22, reject) => {
      this.writer.write(payload, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve22();
      });
    });
  }
  emitError(error) {
    for (const handler of this.errorHandlers) {
      handler(error);
    }
  }
}
function abortError2(signal) {
  const reason = signal?.reason;
  if (reason instanceof Error)
    return reason;
  const error = new Error(typeof reason === "string" ? reason : "LSP request cancelled");
  error.name = "AbortError";
  return error;
}
function parseContentLength2(headers) {
  for (const line of headers.split(`\r
`)) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1)
      continue;
    const name = line.slice(0, separatorIndex).trim().toLowerCase();
    if (name !== "content-length")
      continue;
    const value = Number.parseInt(line.slice(separatorIndex + 1).trim(), 10);
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  return null;
}
function isJsonRpcObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function getMessageId(message) {
  const id = message["id"];
  if (typeof id === "number" || typeof id === "string" || id === null)
    return id;
  return;
}
function jsonRpcErrorToError(value) {
  if (!isJsonRpcObject(value))
    return new Error("JSON-RPC request failed");
  const message = typeof value["message"] === "string" ? value["message"] : "JSON-RPC request failed";
  const error = new Error(message);
  if (typeof value["code"] === "number") {
    error.name = `JsonRpcError(${value["code"]})`;
  }
  return error;
}
function toError(error) {
  return error instanceof Error ? error : new Error(String(error));
}
function isMissingProcessError(error) {
  if (!(error instanceof Error) || !("code" in error))
    return false;
  return error.code === "ESRCH";
}
function reportKillError(context, error) {
  if (!isMissingProcessError(error)) {
    reportBestEffortCleanupError(context, error);
  }
}
function validateCwd(cwd) {
  try {
    if (!existsSync3(cwd)) {
      return { valid: false, error: `Working directory does not exist: ${cwd}` };
    }
    const stats = statSync3(cwd);
    if (!stats.isDirectory()) {
      return { valid: false, error: `Path is not a directory: ${cwd}` };
    }
    return { valid: true };
  } catch (err) {
    return {
      valid: false,
      error: `Cannot access working directory: ${cwd} (${err instanceof Error ? err.message : String(err)})`
    };
  }
}
function wrap(proc) {
  const exitedPromise = new Promise((resolve22) => {
    proc.once("close", (code) => resolve22(code ?? 0));
    proc.once("error", () => resolve22(1));
  });
  if (!proc.stdin || !proc.stdout || !proc.stderr) {
    throw new LspProcessSpawnError("Spawned process is missing one of stdin/stdout/stderr pipes");
  }
  return {
    stdin: proc.stdin,
    stdout: proc.stdout,
    stderr: proc.stderr,
    get pid() {
      return proc.pid ?? undefined;
    },
    get exitCode() {
      return proc.exitCode;
    },
    get killed() {
      return proc.killed;
    },
    exited: exitedPromise,
    kill(signal) {
      killProcessTree(proc, signal ?? "SIGTERM");
    }
  };
}
function killProcessTree(proc, signal) {
  if (process.platform === "win32" && proc.pid) {
    const result = spawnSync("taskkill", ["/pid", String(proc.pid), "/f", "/t"], {
      stdio: "ignore",
      windowsHide: true
    });
    if (!result.error && result.status === 0)
      return;
    if (result.error)
      reportKillError("windows process tree kill", result.error);
  }
  if (process.platform !== "win32" && proc.pid) {
    try {
      process.kill(-proc.pid, signal);
      return;
    } catch (error) {
      reportKillError("process group kill", error);
    }
  }
  try {
    proc.kill(signal);
  } catch (error) {
    reportKillError("process kill", error);
  }
}
function isWindowsShellShim(command) {
  const lowerCommand = command.toLowerCase();
  return lowerCommand.endsWith(".cmd") || lowerCommand.endsWith(".bat");
}
function splitPath(pathValue, platform) {
  const separator = platform === "win32" ? ";" : delimiter2;
  return pathValue.split(separator).filter(Boolean);
}
function getWindowsPathExtensions(env) {
  const rawExtensions = env["PATHEXT"] ?? ".COM;.EXE;.BAT;.CMD";
  const extensions = rawExtensions.split(";").map((extension) => extension.trim()).filter(Boolean).map((extension) => extension.startsWith(".") ? extension : `.${extension}`);
  return [...new Set([...extensions, ".exe", ".cmd", ".bat", ""])];
}
function resolveWindowsCommand(command, env) {
  const hasPathSeparator = command.includes("/") || command.includes("\\");
  const pathValue = env["PATH"] ?? env["Path"] ?? "";
  const baseDirectories = hasPathSeparator ? [""] : splitPath(pathValue, "win32");
  const extensions = getWindowsPathExtensions(env);
  for (const baseDirectory of baseDirectories) {
    for (const extension of extensions) {
      const candidate = baseDirectory ? join2(baseDirectory, `${command}${extension}`) : `${command}${extension}`;
      if (existsSync3(candidate))
        return candidate;
    }
  }
  return command;
}
function createSpawnCommand(command, platform = process.platform, commandProcessor = process.env["ComSpec"] ?? "cmd.exe", env = process.env) {
  const [cmd, ...args] = command;
  if (!cmd) {
    throw new LspProcessSpawnError("[lsp] empty command");
  }
  if (platform !== "win32") {
    return { command: cmd, args, shell: false };
  }
  const resolvedCommand = resolveWindowsCommand(cmd, env);
  if (!isWindowsShellShim(resolvedCommand)) {
    return { command: resolvedCommand, args, shell: false };
  }
  return {
    command: commandProcessor,
    args: ["/d", "/s", "/c", resolvedCommand, ...args],
    shell: false
  };
}
function spawnProcess(command, options) {
  const cwdValidation = validateCwd(options.cwd);
  if (!cwdValidation.valid) {
    throw new LspInvalidPathError(`[lsp] ${cwdValidation.error}`);
  }
  const [cmd] = command;
  if (!cmd) {
    throw new LspProcessSpawnError("[lsp] empty command");
  }
  const preparedCommand = createSpawnCommand(command, process.platform, process.env["ComSpec"] ?? "cmd.exe", options.env);
  const proc = spawn2(preparedCommand.command, preparedCommand.args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    shell: preparedCommand.shell,
    detached: process.platform !== "win32"
  });
  return wrap(proc);
}
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseConfigurationItems(params) {
  if (!isRecord2(params) || !Array.isArray(params["items"]))
    return [];
  const items = [];
  for (const item of params["items"]) {
    if (!isRecord2(item))
      continue;
    const section = item["section"];
    items.push(section === undefined || typeof section !== "string" ? {} : { section });
  }
  return items;
}
function parseDiagnosticsParams(params) {
  if (!isRecord2(params) || typeof params["uri"] !== "string")
    return null;
  const diagnostics = Array.isArray(params["diagnostics"]) ? params["diagnostics"].filter(isDiagnostic) : [];
  const version = typeof params["version"] === "number" ? params["version"] : undefined;
  return { uri: params["uri"], diagnostics, ...version === undefined ? {} : { version } };
}
function createLspSpawnEnv(_root, input) {
  return { ...input };
}
function isDiagnostic(value) {
  return isRecord2(value) && isRange(value["range"]) && typeof value["message"] === "string";
}
function isRange(value) {
  return isRecord2(value) && isPosition(value["start"]) && isPosition(value["end"]);
}
function isPosition(value) {
  return isRecord2(value) && typeof value["line"] === "number" && typeof value["character"] === "number";
}

class LspClientNotStartedError extends Error {
  serverId;
  root;
  name = "LspClientNotStartedError";
  constructor(serverId, root) {
    super("LSP client not started");
    this.serverId = serverId;
    this.root = root;
  }
}

class LspClientTransport {
  root;
  server;
  proc = null;
  connection = null;
  stderrBuffer = [];
  processExited = false;
  diagnosticsStore = new Map;
  requestTimeoutMs;
  initializeTimeoutMs;
  workspaceApplyEditHandler = null;
  diagnosticPullSupported = false;
  documentFormattingSupported = false;
  constructor(root, server2, timeouts = {}) {
    this.root = root;
    this.server = server2;
    this.requestTimeoutMs = timeouts.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
    this.initializeTimeoutMs = timeouts.initializeTimeoutMs ?? INIT_TIMEOUT_MS;
  }
  pid() {
    return this.proc?.pid;
  }
  command() {
    return [...this.server.command];
  }
  setWorkspaceApplyEditHandler(handler) {
    this.workspaceApplyEditHandler = handler;
  }
  hasWorkspaceApplyEditHandler() {
    return this.workspaceApplyEditHandler !== null;
  }
  setDiagnosticPullSupported(supported) {
    this.diagnosticPullSupported = supported;
  }
  isDiagnosticPullSupported() {
    return this.diagnosticPullSupported;
  }
  setDocumentFormattingSupported(supported) {
    this.documentFormattingSupported = supported;
  }
  isDocumentFormattingSupported() {
    return this.documentFormattingSupported;
  }
  handlePublishDiagnostics(params) {
    this.diagnosticsStore.set(params.uri, [...params.diagnostics]);
  }
  async start() {
    const env = createLspSpawnEnv(this.root, {
      ...process.env,
      ...this.server.env
    });
    this.proc = spawnProcess(this.server.command, {
      cwd: this.root,
      env
    });
    this.startStderrReading();
    if (this.proc.exitCode !== null) {
      const stderr = this.stderrBuffer.join(`
`);
      throw new LspProcessExitedError(this.server.id, this.root, this.proc.exitCode, stderr.slice(-2000));
    }
    this.connection = new JsonRpcConnection(this.proc.stdout, this.proc.stdin);
    this.connection.onNotification("textDocument/publishDiagnostics", (params) => {
      const diagnosticsParams = parseDiagnosticsParams(params);
      if (diagnosticsParams?.uri) {
        this.handlePublishDiagnostics(diagnosticsParams);
      }
    });
    this.connection.onRequest("workspace/configuration", (params) => {
      const items = parseConfigurationItems(params);
      return items.map((item) => {
        if (item.section === "json")
          return { validate: { enable: true } };
        return {};
      });
    });
    this.connection.onRequest("client/registerCapability", () => null);
    this.connection.onRequest("window/workDoneProgress/create", () => null);
    if (this.workspaceApplyEditHandler) {
      this.connection.onRequest("workspace/applyEdit", this.workspaceApplyEditHandler);
    }
    this.connection.onClose(() => {
      this.processExited = true;
    });
    this.connection.onError((error) => {
      reportBestEffortCleanupError("connection error notification", error);
    });
    this.connection.listen();
  }
  startStderrReading() {
    if (!this.proc)
      return;
    this.proc.stderr.setEncoding("utf-8");
    this.proc.stderr.on("data", (chunk) => {
      this.stderrBuffer.push(chunk);
      if (this.stderrBuffer.length > 100) {
        this.stderrBuffer.shift();
      }
    });
  }
  isConnectionClosedError(error) {
    if (!(error instanceof Error)) {
      return false;
    }
    const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
    return code === "ERR_STREAM_DESTROYED" || /connection closed|connection is disposed|stream was destroyed/i.test(error.message);
  }
  async sendRequest(method, ...args) {
    if (!this.connection)
      throw new LspClientNotStartedError(this.server.id, this.root);
    if (this.processExited || this.proc && this.proc.exitCode !== null) {
      const stderrTail = this.stderrBuffer.slice(-10).join(`
`);
      throw new LspProcessExitedError(this.server.id, this.root, this.proc?.exitCode ?? null, stderrTail || undefined);
    }
    const options = args[1];
    const timeoutMs = options?.timeoutMs ?? this.requestTimeoutMs;
    const timeoutController = new AbortController;
    const timeoutHandle = setTimeout(() => {
      const stderrTail = this.stderrBuffer.slice(-5).join(`
`);
      timeoutController.abort(new LspRequestTimeoutError(method, stderrTail || undefined));
    }, timeoutMs);
    const combinedSignal = combineAbortSignals(options?.signal, timeoutController.signal);
    try {
      const result = args.length === 0 ? await this.connection.sendRequest(method, undefined, { signal: combinedSignal.signal }) : await this.connection.sendRequest(method, args[0], { signal: combinedSignal.signal });
      return result;
    } catch (error) {
      if (this.processExited || this.proc && this.proc.exitCode !== null) {
        throw new LspProcessExitedError(this.server.id, this.root, this.proc?.exitCode ?? null, this.stderrBuffer.slice(-10).join(`
`) || undefined);
      }
      if (this.isConnectionClosedError(error)) {
        throw new LspConnectionClosedError(this.server.id, this.root, error.message);
      }
      throw error;
    } finally {
      clearTimeout(timeoutHandle);
      combinedSignal.dispose();
    }
  }
  async sendNotification(method, ...args) {
    if (!this.connection)
      return;
    if (this.processExited || this.proc && this.proc.exitCode !== null)
      return;
    try {
      if (args.length === 0) {
        await this.connection.sendNotification(method);
      } else {
        await this.connection.sendNotification(method, args[0]);
      }
    } catch (error) {
      if (this.isConnectionClosedError(error)) {
        throw new LspConnectionClosedError(this.server.id, this.root, error.message);
      }
      throw error;
    }
  }
  isAlive() {
    return this.proc !== null && !this.processExited && this.proc.exitCode === null;
  }
  async stop() {
    if (this.connection) {
      try {
        await this.sendRequest("shutdown");
      } catch (error) {
        reportBestEffortCleanupError("shutdown request", error instanceof Error ? error : String(error));
      }
      try {
        await this.sendNotification("exit");
      } catch (error) {
        reportBestEffortCleanupError("exit notification", error instanceof Error ? error : String(error));
      }
      try {
        this.connection.dispose();
      } catch (error) {
        reportBestEffortCleanupError("connection dispose", error instanceof Error ? error : String(error));
      }
      this.connection = null;
    }
    const proc = this.proc;
    if (proc) {
      this.proc = null;
      let exitedBeforeTimeout = false;
      try {
        proc.kill();
        let timeoutId;
        const timeoutPromise = new Promise((resolve22) => {
          timeoutId = setTimeout(resolve22, STOP_HARD_KILL_TIMEOUT_MS);
        });
        await Promise.race([
          proc.exited.then(() => {
            exitedBeforeTimeout = true;
          }).finally(() => {
            if (timeoutId)
              clearTimeout(timeoutId);
          }),
          timeoutPromise
        ]);
        if (!exitedBeforeTimeout) {
          try {
            proc.kill("SIGKILL");
            await Promise.race([
              proc.exited,
              new Promise((resolve22) => setTimeout(resolve22, STOP_SIGKILL_GRACE_MS))
            ]);
          } catch (error) {
            reportBestEffortCleanupError("hard process kill", error instanceof Error ? error : String(error));
          }
        }
      } catch (error) {
        reportBestEffortCleanupError("process stop", error instanceof Error ? error : String(error));
      }
    }
    this.processExited = true;
    this.diagnosticsStore.clear();
  }
  getStoredDiagnostics(uri) {
    return this.diagnosticsStore.get(uri) ?? [];
  }
}
function combineAbortSignals(primary, secondary) {
  const controller = new AbortController;
  const abortFrom = (signal) => {
    if (!controller.signal.aborted)
      controller.abort(signal.reason);
  };
  const onPrimaryAbort = () => {
    if (primary)
      abortFrom(primary);
  };
  const onSecondaryAbort = () => abortFrom(secondary);
  if (primary?.aborted)
    abortFrom(primary);
  else
    primary?.addEventListener("abort", onPrimaryAbort, { once: true });
  if (secondary.aborted)
    abortFrom(secondary);
  else
    secondary.addEventListener("abort", onSecondaryAbort, { once: true });
  return {
    signal: controller.signal,
    dispose: () => {
      primary?.removeEventListener("abort", onPrimaryAbort);
      secondary.removeEventListener("abort", onSecondaryAbort);
    }
  };
}
function supportsDiagnosticPull(capabilities) {
  if (capabilities === undefined)
    return false;
  return Object.hasOwn(capabilities, "diagnosticProvider");
}
function supportsDocumentFormatting(capabilities) {
  if (capabilities === undefined)
    return false;
  const provider = capabilities.documentFormattingProvider;
  if (provider === undefined || provider === null || provider === false)
    return false;
  return provider === true || typeof provider === "object";
}

class LspClientConnection extends LspClientTransport {
  async initialize() {
    const rootUri = pathToFileURL(this.root).href;
    const result = await this.sendRequest("initialize", {
      processId: process.pid,
      rootUri,
      rootPath: this.root,
      workspaceFolders: [{ uri: rootUri, name: "workspace" }],
      capabilities: {
        textDocument: {
          hover: { contentFormat: ["markdown", "plaintext"] },
          definition: { linkSupport: true },
          references: {},
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          publishDiagnostics: {},
          formatting: { dynamicRegistration: false },
          rename: {
            prepareSupport: true,
            prepareSupportDefaultBehavior: 1
          },
          codeAction: {
            codeActionLiteralSupport: {
              codeActionKind: {
                valueSet: [
                  "quickfix",
                  "refactor",
                  "refactor.extract",
                  "refactor.inline",
                  "refactor.rewrite",
                  "source",
                  "source.organizeImports",
                  "source.fixAll"
                ]
              }
            },
            isPreferredSupport: true,
            disabledSupport: true,
            dataSupport: true,
            resolveSupport: {
              properties: ["edit", "command"]
            }
          }
        },
        workspace: {
          symbol: {},
          workspaceFolders: true,
          configuration: true,
          ...this.hasWorkspaceApplyEditHandler() ? { applyEdit: true } : {},
          workspaceEdit: {
            documentChanges: true,
            resourceOperations: ["create", "rename", "delete"]
          }
        }
      },
      initializationOptions: this.server.initialization
    }, { timeoutMs: this.initializeTimeoutMs });
    this.setDiagnosticPullSupported(supportsDiagnosticPull(result?.capabilities));
    this.setDocumentFormattingSupported(supportsDocumentFormatting(result?.capabilities));
    await this.sendNotification("initialized", {});
    await this.sendNotification("workspace/didChangeConfiguration", {
      settings: { json: { validate: { enable: true } } }
    });
  }
}
var SYMBOL_KIND_MAP = {
  1: "File",
  2: "Module",
  3: "Namespace",
  4: "Package",
  5: "Class",
  6: "Method",
  7: "Property",
  8: "Field",
  9: "Constructor",
  10: "Enum",
  11: "Interface",
  12: "Function",
  13: "Variable",
  14: "Constant",
  15: "String",
  16: "Number",
  17: "Boolean",
  18: "Array",
  19: "Object",
  20: "Key",
  21: "Null",
  22: "EnumMember",
  23: "Struct",
  24: "Event",
  25: "Operator",
  26: "TypeParameter"
};
var SEVERITY_MAP = {
  1: "error",
  2: "warning",
  3: "information",
  4: "hint"
};
var EXT_TO_LANG = {
  ".abap": "abap",
  ".bat": "bat",
  ".bib": "bibtex",
  ".bibtex": "bibtex",
  ".clj": "clojure",
  ".cljs": "clojure",
  ".cljc": "clojure",
  ".edn": "clojure",
  ".coffee": "coffeescript",
  ".c": "c",
  ".cpp": "cpp",
  ".cxx": "cpp",
  ".cc": "cpp",
  ".c++": "cpp",
  ".cs": "csharp",
  ".css": "css",
  ".d": "d",
  ".pas": "pascal",
  ".pascal": "pascal",
  ".diff": "diff",
  ".patch": "diff",
  ".dart": "dart",
  ".dockerfile": "dockerfile",
  ".ex": "elixir",
  ".exs": "elixir",
  ".erl": "erlang",
  ".hrl": "erlang",
  ".fs": "fsharp",
  ".fsi": "fsharp",
  ".fsx": "fsharp",
  ".fsscript": "fsharp",
  ".gitcommit": "git-commit",
  ".gitrebase": "git-rebase",
  ".go": "go",
  ".groovy": "groovy",
  ".gleam": "gleam",
  ".hbs": "handlebars",
  ".handlebars": "handlebars",
  ".hs": "haskell",
  ".html": "html",
  ".htm": "html",
  ".ini": "ini",
  ".java": "java",
  ".jl": "julia",
  ".js": "javascript",
  ".jsx": "javascriptreact",
  ".json": "json",
  ".jsonc": "jsonc",
  ".tex": "latex",
  ".latex": "latex",
  ".less": "less",
  ".lua": "lua",
  ".makefile": "makefile",
  makefile: "makefile",
  ".md": "markdown",
  ".markdown": "markdown",
  ".m": "objective-c",
  ".mm": "objective-cpp",
  ".pl": "perl",
  ".pm": "perl",
  ".pm6": "perl6",
  ".php": "php",
  ".ps1": "powershell",
  ".psm1": "powershell",
  ".pug": "jade",
  ".jade": "jade",
  ".py": "python",
  ".pyi": "python",
  ".r": "r",
  ".cshtml": "razor",
  ".razor": "razor",
  ".rb": "ruby",
  ".rake": "ruby",
  ".gemspec": "ruby",
  ".ru": "ruby",
  ".erb": "erb",
  ".html.erb": "erb",
  ".js.erb": "erb",
  ".css.erb": "erb",
  ".json.erb": "erb",
  ".rs": "rust",
  ".scss": "scss",
  ".sass": "sass",
  ".scala": "scala",
  ".shader": "shaderlab",
  ".sh": "shellscript",
  ".bash": "shellscript",
  ".zsh": "shellscript",
  ".ksh": "shellscript",
  ".sql": "sql",
  ".svelte": "svelte",
  ".swift": "swift",
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".mts": "typescript",
  ".cts": "typescript",
  ".mtsx": "typescriptreact",
  ".ctsx": "typescriptreact",
  ".xml": "xml",
  ".xsl": "xsl",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".vue": "vue",
  ".zig": "zig",
  ".zon": "zig",
  ".astro": "astro",
  ".ml": "ocaml",
  ".mli": "ocaml",
  ".tf": "terraform",
  ".tfvars": "terraform-vars",
  ".hcl": "hcl",
  ".nix": "nix",
  ".typ": "typst",
  ".typc": "typst",
  ".ets": "typescript",
  ".lhs": "haskell",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".prisma": "prisma",
  ".h": "c",
  ".hpp": "cpp",
  ".hh": "cpp",
  ".hxx": "cpp",
  ".h++": "cpp",
  ".objc": "objective-c",
  ".objcpp": "objective-cpp",
  ".fish": "fish",
  ".graphql": "graphql",
  ".gql": "graphql"
};
function getLanguageId(ext) {
  return EXT_TO_LANG[ext] ?? "plaintext";
}
var WATCHED_FILE_BATCH_SIZE = 128;
var DEFAULT_VERSIONLESS_PUBLISH_QUIESCENCE_MS = 250;
function canonicalPath(filePath) {
  const absolute = resolve2(filePath);
  try {
    return realpathSync2(absolute);
  } catch {
    return absolute;
  }
}
function normalizeDocumentUri(uri) {
  let decoded = uri;
  try {
    decoded = decodeURIComponent(uri);
  } catch {
    decoded = uri;
  }
  if (process.platform !== "win32")
    return decoded;
  return decoded.replace(/^(file:\/\/\/)([a-z]):/, (_match, prefix, drive) => `${prefix}${drive.toUpperCase()}:`);
}
function isSameOrDescendant(candidate, parent) {
  const suffix = relative2(parent, candidate);
  return suffix === "" || !suffix.startsWith("..") && suffix !== "..";
}
function movedPath(candidate, oldPath, newPath) {
  const suffix = relative2(oldPath, candidate);
  return suffix === "" ? newPath : resolve2(newPath, suffix);
}

class WorkspaceDocumentState {
  sendNotification;
  clearDiagnostics;
  openDocuments = new Map;
  openByUri = new Map;
  openPromises = new Map;
  now;
  versionlessPublishQuiescenceMs;
  constructor(sendNotification, clearDiagnostics, options = {}) {
    this.sendNotification = sendNotification;
    this.clearDiagnostics = clearDiagnostics;
    this.now = options.now ?? (() => Date.now());
    this.versionlessPublishQuiescenceMs = options.versionlessPublishQuiescenceMs ?? DEFAULT_VERSIONLESS_PUBLISH_QUIESCENCE_MS;
  }
  async openFile(filePath) {
    const path2 = canonicalPath(filePath);
    const existingOpen = this.openPromises.get(path2);
    if (existingOpen) {
      await existingOpen;
      return this.openFile(path2);
    }
    const text = readFileSync2(path2, "utf-8");
    const existing = this.openDocuments.get(path2);
    if (!existing)
      return this.openDocumentSingleFlight(path2, text);
    if (existing.text === text)
      return;
    await this.changeDocument(existing, text);
  }
  getVersion(filePath) {
    return this.openDocuments.get(canonicalPath(filePath))?.version;
  }
  getStoredDiagnostics(uri) {
    const state = this.openByUri.get(normalizeDocumentUri(uri));
    if (!state)
      return [];
    return state.lastPublish?.diagnostics ?? state.pullCache?.diagnostics ?? [];
  }
  captureDiagnosticSnapshot(filePath) {
    const state = this.openDocuments.get(canonicalPath(filePath));
    if (!state)
      return null;
    return {
      path: state.path,
      uri: state.uri,
      version: state.version,
      documentGeneration: state.generation,
      publishGeneration: state.publishGeneration
    };
  }
  isCurrentSnapshot(snapshot) {
    const state = this.openDocuments.get(snapshot.path);
    return state !== undefined && state.uri === snapshot.uri && state.version === snapshot.version && state.generation === snapshot.documentGeneration;
  }
  getPullCache(snapshot) {
    const state = this.openByUri.get(normalizeDocumentUri(snapshot.uri));
    if (!state?.pullCache || state.pullCache.documentVersion !== snapshot.version)
      return null;
    return state.pullCache;
  }
  recordPullDiagnostics(snapshot, report) {
    const state = this.openByUri.get(normalizeDocumentUri(snapshot.uri));
    if (!state)
      return;
    state.pullCache = {
      documentVersion: snapshot.version,
      diagnostics: [...report.diagnostics],
      ...report.resultId === undefined ? {} : { resultId: report.resultId }
    };
  }
  recordPublishedDiagnostics(params) {
    const state = this.openByUri.get(normalizeDocumentUri(params.uri));
    if (!state)
      return;
    state.publishGeneration += 1;
    state.lastPublish = {
      diagnostics: [...params.diagnostics],
      publishGeneration: state.publishGeneration,
      documentGenerationAtArrival: state.generation,
      arrivedAt: this.now(),
      ...params.version === undefined ? {} : { version: params.version }
    };
    this.notifyWaiters(state);
  }
  resolvePushDiagnostics(snapshot) {
    const state = this.openByUri.get(normalizeDocumentUri(snapshot.uri));
    if (!state?.lastPublish)
      return { status: "missing" };
    const publish = state.lastPublish;
    if (publish.version !== undefined) {
      return publish.version === snapshot.version ? { status: "ready", diagnostics: publish.diagnostics } : { status: "missing" };
    }
    if (publish.documentGenerationAtArrival < snapshot.documentGeneration)
      return { status: "missing" };
    const readyAt = publish.arrivedAt + this.versionlessPublishQuiescenceMs;
    const waitMs = Math.max(0, readyAt - this.now());
    return waitMs === 0 ? { status: "ready", diagnostics: publish.diagnostics } : { status: "wait", waitMs };
  }
  waitForDiagnosticsActivity(snapshot, timeoutMs) {
    const state = this.openByUri.get(normalizeDocumentUri(snapshot.uri));
    if (!state || timeoutMs <= 0)
      return Promise.resolve();
    return new Promise((resolveActivity) => {
      let settled = false;
      const finish = () => {
        if (settled)
          return;
        settled = true;
        clearTimeout(timer);
        state.waiters.delete(finish);
        resolveActivity();
      };
      const timer = setTimeout(finish, timeoutMs);
      if (typeof timer.unref === "function")
        timer.unref();
      state.waiters.add(finish);
    });
  }
  validateVersions(operations) {
    const versions = new Map([...this.openDocuments].map(([path2, state]) => [path2, state.version]));
    for (const operation of operations) {
      if (operation.kind === "text") {
        const current = versions.get(operation.path);
        if (operation.documentVersion !== null && current !== operation.documentVersion) {
          const observed = current === undefined ? "closed document" : `open document version ${current}`;
          return {
            changeIndex: operation.changeIndex,
            message: `document version ${operation.documentVersion} does not match ${observed} for ${operation.path}`
          };
        }
        if (current !== undefined)
          versions.set(operation.path, current + 1);
        continue;
      }
      if (operation.kind === "rename") {
        const moved = [...versions].filter(([path2]) => isSameOrDescendant(path2, operation.oldPath));
        for (const [path2] of moved)
          versions.delete(path2);
        for (const [path2] of moved)
          versions.set(movedPath(path2, operation.oldPath, operation.newPath), 1);
        continue;
      }
      if (operation.kind === "delete") {
        for (const path2 of [...versions.keys()]) {
          if (isSameOrDescendant(path2, operation.path))
            versions.delete(path2);
        }
        continue;
      }
      if (operation.kind === "create" && operation.replaced && versions.has(operation.path)) {
        versions.set(operation.path, 1);
      }
    }
    return null;
  }
  async synchronize(delta) {
    const watched = [];
    for (const mutation of delta.operations)
      await this.synchronizeMutation(mutation, watched);
    for (let index = 0;index < watched.length; index += WATCHED_FILE_BATCH_SIZE) {
      await this.sendNotification("workspace/didChangeWatchedFiles", {
        changes: watched.slice(index, index + WATCHED_FILE_BATCH_SIZE)
      });
    }
  }
  async synchronizeMutation(mutation, watched) {
    if (mutation.kind === "text") {
      const state = this.openDocuments.get(mutation.path);
      if (state)
        await this.changeDocument(state, mutation.afterText);
      else
        watched.push({ uri: pathToFileURL2(mutation.path).href, type: 2 });
      return;
    }
    if (mutation.kind === "create") {
      const state = this.openDocuments.get(mutation.path);
      if (state) {
        await this.closeDocument(state);
        await this.openDocumentSingleFlight(mutation.path, readFileSync2(mutation.path, "utf-8"));
      } else {
        watched.push({ uri: pathToFileURL2(mutation.path).href, type: mutation.replaced ? 2 : 1 });
      }
      return;
    }
    if (mutation.kind === "rename") {
      const moved = [...this.openDocuments.values()].filter((state) => isSameOrDescendant(state.path, mutation.oldPath));
      for (const state of moved)
        await this.closeDocument(state);
      for (const state of moved) {
        const path2 = movedPath(state.path, mutation.oldPath, mutation.newPath);
        await this.openDocumentSingleFlight(path2, readFileSync2(path2, "utf-8"));
      }
      if (moved.length === 0) {
        watched.push({ uri: pathToFileURL2(mutation.oldPath).href, type: 3 });
        watched.push({ uri: pathToFileURL2(mutation.newPath).href, type: 1 });
      }
      return;
    }
    const removed = [...this.openDocuments.values()].filter((state) => isSameOrDescendant(state.path, mutation.path));
    for (const state of removed)
      await this.closeDocument(state);
    if (removed.length === 0)
      watched.push({ uri: pathToFileURL2(mutation.path).href, type: 3 });
  }
  async openDocumentSingleFlight(path2, text) {
    const existing = this.openPromises.get(path2);
    if (existing)
      return existing;
    const open = (async () => {
      const state = {
        path: path2,
        uri: pathToFileURL2(path2).href,
        languageId: getLanguageId(effectiveExtension(path2)),
        text,
        version: 1,
        generation: 1,
        publishGeneration: 0,
        waiters: new Set
      };
      this.openDocuments.set(path2, state);
      this.openByUri.set(normalizeDocumentUri(state.uri), state);
      this.notifyWaiters(state);
      await this.sendNotification("textDocument/didOpen", {
        textDocument: { uri: state.uri, languageId: state.languageId, version: state.version, text }
      });
    })().finally(() => {
      this.openPromises.delete(path2);
    });
    this.openPromises.set(path2, open);
    return open;
  }
  async changeDocument(state, text) {
    state.text = text;
    state.version += 1;
    state.generation += 1;
    this.clearDiagnostics(state.uri);
    this.notifyWaiters(state);
    await this.sendNotification("textDocument/didChange", {
      textDocument: { uri: state.uri, version: state.version },
      contentChanges: [{ text }]
    });
    await this.sendNotification("textDocument/didSave", { textDocument: { uri: state.uri }, text });
  }
  async closeDocument(state) {
    this.openDocuments.delete(state.path);
    this.openByUri.delete(normalizeDocumentUri(state.uri));
    this.clearDiagnostics(state.uri);
    this.notifyWaiters(state);
    await this.sendNotification("textDocument/didClose", { textDocument: { uri: state.uri } });
  }
  notifyWaiters(state) {
    for (const waiter of [...state.waiters])
      waiter();
  }
}
var CONCURRENT_FAILURE_REASON_BY_PHASE = {
  applying: "workspace/applyEdit is already in progress for this workspace mutation",
  settled: "workspace/applyEdit was already handled for this workspace mutation"
};
function workspaceApplyEditConcurrentFailureReason(phase) {
  return CONCURRENT_FAILURE_REASON_BY_PHASE[phase];
}

class WorkspaceEditPathError extends Error {
  path;
  detail;
  name = "WorkspaceEditPathError";
  constructor(path2, detail) {
    super(`${detail}: ${path2}`);
    this.path = path2;
    this.detail = detail;
  }
}
function isPathInsideWorkspace(filePath, workspaceRoot) {
  const relativePath = relative3(workspaceRoot, filePath);
  return relativePath === "" || !relativePath.startsWith("..") && !isAbsolute4(relativePath);
}
function canonicalizeMissingPath(filePath) {
  let ancestor = filePath;
  while (!existsSync4(ancestor)) {
    const parent = dirname4(ancestor);
    if (parent === ancestor)
      throw new WorkspaceEditPathError(filePath, "no existing ancestor");
    ancestor = parent;
  }
  return resolve3(realpathSync3(ancestor), relative3(ancestor, filePath));
}
function canonicalWorkspaceRoot(workspaceRoot) {
  try {
    const canonical = realpathSync3(resolve3(workspaceRoot));
    if (!lstatSync2(canonical).isDirectory()) {
      return { success: false, error: `workspace root is not a directory: ${workspaceRoot}` };
    }
    return {
      success: true,
      path: canonical,
      requestedPath: resolve3(workspaceRoot),
      followedSymbolicLink: existsSync4(resolve3(workspaceRoot)) && lstatSync2(resolve3(workspaceRoot)).isSymbolicLink()
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { success: false, error: `workspace root ${workspaceRoot}: ${detail}` };
  }
}
function uriToCanonicalWorkspacePath(uri, workspaceRoot) {
  let requestedPath;
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== "file:" || parsed.search !== "" || parsed.hash !== "") {
      return { success: false, error: `non-file URI ${uri}` };
    }
    requestedPath = resolve3(fileURLToPath2(parsed));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { success: false, error: `non-file URI ${uri}: ${detail}` };
  }
  try {
    const canonical = existsSync4(requestedPath) ? realpathSync3(requestedPath) : canonicalizeMissingPath(requestedPath);
    if (!isPathInsideWorkspace(canonical, workspaceRoot)) {
      return { success: false, error: `${requestedPath}: outside workspace ${workspaceRoot}` };
    }
    return {
      success: true,
      path: canonical,
      requestedPath,
      followedSymbolicLink: existsSync4(requestedPath) && lstatSync2(requestedPath).isSymbolicLink()
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { success: false, error: `${requestedPath}: ${detail}` };
  }
}
function snapshotPath(path2, includeChildren) {
  if (!existsSync4(path2))
    return { kind: "missing" };
  const stats = lstatSync2(path2);
  if (stats.isFile())
    return { kind: "file", content: readFileSync3(path2, "utf-8") };
  if (stats.isDirectory()) {
    return includeChildren ? { kind: "directory", children: readdirSync(path2).sort() } : { kind: "directory" };
  }
  throw new WorkspaceEditPathError(path2, "unsupported filesystem entry");
}
var DEFAULT_IO = {
  writeFile(path2, content) {
    writeFileSync(path2, content, "utf-8");
  },
  rename(oldPath, newPath) {
    renameSync(oldPath, newPath);
  },
  remove(path2, recursive) {
    rmSync(path2, { recursive, force: false });
  }
};
function snapshotsEqual(expected, actual) {
  if (expected.kind !== actual.kind)
    return false;
  if (expected.kind === "file" && actual.kind === "file")
    return expected.content === actual.content;
  if (expected.kind === "directory" && actual.kind === "directory" && expected.children !== undefined) {
    return JSON.stringify(expected.children) === JSON.stringify(actual.children);
  }
  return true;
}
function liveSnapshot(path2, expected) {
  return snapshotPath(path2, expected.kind === "directory" && expected.children !== undefined);
}
function firstOperationIndex(plan) {
  return plan.operations[0]?.changeIndex ?? 0;
}
function failedCommit(plan, failure) {
  const { message, changeIndex, mutations = [], filesModified = [], totalEdits = 0, lateAbort = false } = failure;
  return {
    result: {
      success: false,
      filesModified,
      totalEdits,
      errors: [`change ${changeIndex}: ${message}`],
      failedChange: changeIndex,
      ...lateAbort ? { lateAbort: true } : {}
    },
    delta: mutationDelta(mutations),
    fingerprint: plan.fingerprint
  };
}
function verifySnapshots(plan) {
  for (const [path2, expected] of plan.snapshots) {
    let actual;
    try {
      actual = liveSnapshot(path2, expected);
    } catch (error) {
      const changeIndex = plan.firstChangeByPath.get(path2) ?? firstOperationIndex(plan);
      const detail = error instanceof Error ? error.message : String(error);
      return failedCommit(plan, { message: `cannot verify snapshot for ${path2}: ${detail}`, changeIndex });
    }
    if (!snapshotsEqual(expected, actual)) {
      const changeIndex = plan.firstChangeByPath.get(path2) ?? firstOperationIndex(plan);
      return failedCommit(plan, { message: `workspace state changed before commit: ${path2}`, changeIndex });
    }
  }
  return null;
}
function addModifiedPath(paths, path2) {
  if (!paths.includes(path2))
    paths.push(path2);
}
function reportedPath(plan, path2) {
  return plan.reportedPathByCanonical.get(path2) ?? path2;
}
function changedPathsForMutation(mutation) {
  return mutation.kind === "rename" ? [mutation.oldPath, mutation.newPath] : [mutation.path];
}
function mutationDelta(operations) {
  const changedPaths = new Set;
  for (const operation of operations) {
    for (const path2 of changedPathsForMutation(operation))
      changedPaths.add(path2);
  }
  return { operations, changedPaths: [...changedPaths].sort() };
}
function resolveIo(overrides) {
  return {
    writeFile: overrides?.writeFile ?? DEFAULT_IO.writeFile,
    rename: overrides?.rename ?? DEFAULT_IO.rename,
    remove: overrides?.remove ?? DEFAULT_IO.remove
  };
}
function commitOperation(context, operation) {
  const { plan, io, accumulator } = context;
  if (operation.kind === "noop")
    return;
  if (operation.kind === "text") {
    io.writeFile(operation.path, operation.afterText);
    accumulator.mutations.push({
      kind: "text",
      path: operation.path,
      beforeText: operation.beforeText,
      afterText: operation.afterText
    });
    addModifiedPath(accumulator.filesModified, reportedPath(plan, operation.path));
    accumulator.totalEdits += operation.editCount;
    return;
  }
  if (operation.kind === "create") {
    io.writeFile(operation.path, "");
    accumulator.mutations.push({ kind: "create", path: operation.path, replaced: operation.replaced });
    addModifiedPath(accumulator.filesModified, reportedPath(plan, operation.path));
    return;
  }
  if (operation.kind === "rename") {
    if (operation.replaceDestination) {
      const targetKind = existsSync5(operation.newPath) && lstatSync3(operation.newPath).isDirectory() ? "directory" : "file";
      io.remove(operation.newPath, targetKind === "directory");
      accumulator.mutations.push({ kind: "delete", path: operation.newPath, targetKind });
      addModifiedPath(accumulator.filesModified, reportedPath(plan, operation.newPath));
    }
    io.rename(operation.oldPath, operation.newPath);
    accumulator.mutations.push({
      kind: "rename",
      oldPath: operation.oldPath,
      newPath: operation.newPath,
      sourceKind: operation.sourceKind
    });
    addModifiedPath(accumulator.filesModified, reportedPath(plan, operation.newPath));
    return;
  }
  io.remove(operation.path, operation.recursive);
  accumulator.mutations.push({
    kind: "delete",
    path: operation.path,
    targetKind: operation.targetKind
  });
  addModifiedPath(accumulator.filesModified, reportedPath(plan, operation.path));
}
function commitWorkspaceEditPlan(plan, options = {}) {
  if (options.signal?.aborted) {
    return failedCommit(plan, { message: "cancelled before commit", changeIndex: firstOperationIndex(plan) });
  }
  const stale = verifySnapshots(plan);
  if (stale)
    return stale;
  if (options.signal?.aborted) {
    return failedCommit(plan, { message: "cancelled before commit", changeIndex: firstOperationIndex(plan) });
  }
  const io = resolveIo(options.io);
  const accumulator = { mutations: [], filesModified: [], totalEdits: 0 };
  const context = { plan, io, accumulator };
  let lateAbort = false;
  for (const operation of plan.operations) {
    try {
      commitOperation(context, operation);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return failedCommit(plan, {
        message: `I/O failure during ${operation.kind}: ${detail}`,
        changeIndex: operation.changeIndex,
        mutations: accumulator.mutations,
        filesModified: accumulator.filesModified,
        totalEdits: accumulator.totalEdits,
        lateAbort: lateAbort || options.signal?.aborted === true
      });
    }
    if (options.signal?.aborted)
      lateAbort = true;
  }
  const result = {
    success: true,
    filesModified: accumulator.filesModified,
    totalEdits: accumulator.totalEdits,
    errors: [],
    ...lateAbort ? { lateAbort: true } : {}
  };
  return { result, delta: mutationDelta(accumulator.mutations), fingerprint: plan.fingerprint };
}
function canonicalFingerprint(operations) {
  const canonical = operations.map((operation) => {
    switch (operation.kind) {
      case "text":
        return {
          kind: operation.kind,
          changeIndex: operation.changeIndex,
          path: operation.path,
          edits: operation.edits,
          version: operation.version
        };
      case "rename":
        return {
          kind: operation.kind,
          changeIndex: operation.changeIndex,
          oldPath: operation.oldPath,
          newPath: operation.newPath,
          overwrite: operation.overwrite,
          ignoreIfExists: operation.ignoreIfExists
        };
      case "create":
        return {
          kind: operation.kind,
          changeIndex: operation.changeIndex,
          path: operation.path,
          overwrite: operation.overwrite,
          ignoreIfExists: operation.ignoreIfExists
        };
      case "delete":
        return {
          kind: operation.kind,
          changeIndex: operation.changeIndex,
          path: operation.path,
          recursive: operation.recursive,
          ignoreIfNotExists: operation.ignoreIfNotExists
        };
    }
  });
  return createHash2("sha256").update(JSON.stringify(canonical)).digest("hex");
}

class WorkspaceEditValidationError extends Error {
  changeIndex;
  detail;
  name = "WorkspaceEditValidationError";
  constructor(changeIndex, detail) {
    super(`change ${changeIndex}: ${detail}`);
    this.changeIndex = changeIndex;
    this.detail = detail;
  }
}
function isRecord3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parsePosition(value) {
  if (!isRecord3(value) || typeof value["line"] !== "number" || typeof value["character"] !== "number") {
    return null;
  }
  return { line: value["line"], character: value["character"] };
}
function parseRange(value) {
  if (!isRecord3(value))
    return null;
  const start = parsePosition(value["start"]);
  const end = parsePosition(value["end"]);
  return start && end ? { start, end } : null;
}
function parseTextEdits(value, changeIndex) {
  if (!Array.isArray(value)) {
    throw new WorkspaceEditValidationError(changeIndex, "text edits must be an array");
  }
  const edits = [];
  for (const candidate of value) {
    if (!isRecord3(candidate) || typeof candidate["newText"] !== "string") {
      throw new WorkspaceEditValidationError(changeIndex, "text edit requires range and newText");
    }
    if ("annotationId" in candidate) {
      throw new WorkspaceEditValidationError(changeIndex, "annotated text edits are unsupported");
    }
    const range = parseRange(candidate["range"]);
    if (!range)
      throw new WorkspaceEditValidationError(changeIndex, "text edit range is malformed");
    edits.push({ range, newText: candidate["newText"] });
  }
  return edits;
}
function parseBooleanOption(options, key, changeIndex) {
  const value = options[key];
  if (value === undefined)
    return false;
  if (typeof value !== "boolean") {
    throw new WorkspaceEditValidationError(changeIndex, `${key} must be boolean`);
  }
  return value;
}
function parseOptions(value, allowed, changeIndex) {
  if (value === undefined)
    return {};
  if (!isRecord3(value))
    throw new WorkspaceEditValidationError(changeIndex, "resource options must be an object");
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key))
      throw new WorkspaceEditValidationError(changeIndex, `unsupported resource option ${key}`);
  }
  const parsed = {};
  for (const key of allowed)
    parsed[key] = parseBooleanOption(value, key, changeIndex);
  return parsed;
}
function parseResourceChange(input) {
  const kind = input.change["kind"];
  if (kind === "create" || kind === "delete") {
    parseSinglePathResource(input, kind);
    return;
  }
  if (kind !== "rename") {
    throw new WorkspaceEditValidationError(input.changeIndex, `unsupported resource operation ${String(kind)}`);
  }
  parseRename(input);
}
function parseSinglePathResource(input, kind) {
  const { change, changeIndex, workspaceRoot, target } = input;
  if (typeof change["uri"] !== "string")
    throw new WorkspaceEditValidationError(changeIndex, `${kind}.uri is required`);
  const resolvedPath = uriToCanonicalWorkspacePath(change["uri"], workspaceRoot);
  if (!resolvedPath.success) {
    target.failures.push({ changeIndex, message: resolvedPath.error });
    return;
  }
  if (kind === "create") {
    const options2 = parseOptions(change["options"], ["overwrite", "ignoreIfExists"], changeIndex);
    target.operations.push({
      kind,
      changeIndex,
      path: resolvedPath.path,
      reportedPath: resolvedPath.requestedPath,
      overwrite: options2["overwrite"] ?? false,
      ignoreIfExists: options2["ignoreIfExists"] ?? false,
      followedSymbolicLink: resolvedPath.followedSymbolicLink
    });
    return;
  }
  const options = parseOptions(change["options"], ["recursive", "ignoreIfNotExists"], changeIndex);
  target.operations.push({
    kind,
    changeIndex,
    path: resolvedPath.path,
    reportedPath: resolvedPath.requestedPath,
    recursive: options["recursive"] ?? false,
    ignoreIfNotExists: options["ignoreIfNotExists"] ?? false,
    followedSymbolicLink: resolvedPath.followedSymbolicLink
  });
}
function parseRename(input) {
  const { change, changeIndex, workspaceRoot, target } = input;
  if (typeof change["oldUri"] !== "string" || typeof change["newUri"] !== "string") {
    throw new WorkspaceEditValidationError(changeIndex, "rename requires oldUri and newUri");
  }
  const oldPath = uriToCanonicalWorkspacePath(change["oldUri"], workspaceRoot);
  const newPath = uriToCanonicalWorkspacePath(change["newUri"], workspaceRoot);
  if (!oldPath.success || !newPath.success) {
    target.failures.push({
      changeIndex,
      message: !oldPath.success ? oldPath.error : !newPath.success ? newPath.error : "invalid rename path"
    });
    return;
  }
  const options = parseOptions(change["options"], ["overwrite", "ignoreIfExists"], changeIndex);
  target.operations.push({
    kind: "rename",
    changeIndex,
    oldPath: oldPath.path,
    newPath: newPath.path,
    reportedOldPath: oldPath.requestedPath,
    reportedNewPath: newPath.requestedPath,
    overwrite: options["overwrite"] ?? false,
    ignoreIfExists: options["ignoreIfExists"] ?? false,
    followedSymbolicLink: oldPath.followedSymbolicLink || newPath.followedSymbolicLink
  });
}
function failureResult(failures) {
  const sorted = [...failures].sort((left, right) => left.changeIndex - right.changeIndex);
  const first = sorted[0];
  return {
    success: false,
    filesModified: [],
    totalEdits: 0,
    errors: sorted.map((failure) => `change ${failure.changeIndex}: ${failure.message}`),
    ...first ? { failedChange: first.changeIndex } : {}
  };
}
function parseWorkspaceEdit(edit, workspaceRoot) {
  if (!isRecord3(edit))
    return { operations: [], failures: [{ changeIndex: 0, message: "No edit provided" }] };
  if (edit["changeAnnotations"] !== undefined) {
    return { operations: [], failures: [{ changeIndex: 0, message: "change annotations are unsupported" }] };
  }
  const hasChanges = edit["changes"] !== undefined;
  const hasDocumentChanges = edit["documentChanges"] !== undefined;
  if (hasChanges && hasDocumentChanges) {
    return {
      operations: [],
      failures: [{ changeIndex: 0, message: "changes and documentChanges cannot be combined" }]
    };
  }
  const target = { operations: [], failures: [] };
  if (hasChanges)
    return parseChanges(edit["changes"], workspaceRoot, target);
  return parseDocumentChanges(edit["documentChanges"], workspaceRoot, target);
}
function parseChanges(value, workspaceRoot, target) {
  if (!isRecord3(value))
    return { ...target, failures: [{ changeIndex: 0, message: "changes must be an object" }] };
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  for (const [changeIndex, [uri, rawEdits]] of entries.entries()) {
    const resolvedPath = uriToCanonicalWorkspacePath(uri, workspaceRoot);
    if (!resolvedPath.success) {
      target.failures.push({ changeIndex, message: resolvedPath.error });
      continue;
    }
    try {
      target.operations.push({
        kind: "text",
        changeIndex,
        path: resolvedPath.path,
        reportedPath: resolvedPath.requestedPath,
        edits: parseTextEdits(rawEdits, changeIndex),
        version: null
      });
    } catch (error) {
      if (error instanceof WorkspaceEditValidationError) {
        target.failures.push({ changeIndex, message: error.detail });
        continue;
      }
      throw error;
    }
  }
  return target;
}
function parseDocumentChanges(value, workspaceRoot, target) {
  if (value === undefined)
    return target;
  if (!Array.isArray(value)) {
    return { ...target, failures: [{ changeIndex: 0, message: "documentChanges must be an array" }] };
  }
  for (const [changeIndex, change] of value.entries()) {
    try {
      parseDocumentChange({ change, changeIndex, workspaceRoot, target });
    } catch (error) {
      if (error instanceof WorkspaceEditValidationError) {
        target.failures.push({ changeIndex, message: error.detail });
        continue;
      }
      throw error;
    }
  }
  return target;
}
function parseDocumentChange(input) {
  const { change, changeIndex, workspaceRoot, target } = input;
  if (!isRecord3(change))
    throw new WorkspaceEditValidationError(changeIndex, "document change must be an object");
  if ("annotationId" in change) {
    throw new WorkspaceEditValidationError(changeIndex, "annotated resource operations are unsupported");
  }
  if (typeof change["kind"] === "string") {
    parseResourceChange({ change, changeIndex, workspaceRoot, target });
    return;
  }
  const identifier = change["textDocument"];
  if (!isRecord3(identifier) || typeof identifier["uri"] !== "string") {
    throw new WorkspaceEditValidationError(changeIndex, "textDocument.uri is required");
  }
  const version = identifier["version"];
  if (version !== null && (!Number.isInteger(version) || typeof version !== "number" || version < 0)) {
    throw new WorkspaceEditValidationError(changeIndex, "document version must be null or a non-negative integer");
  }
  const resolvedPath = uriToCanonicalWorkspacePath(identifier["uri"], workspaceRoot);
  if (!resolvedPath.success) {
    target.failures.push({ changeIndex, message: resolvedPath.error });
    return;
  }
  target.operations.push({
    kind: "text",
    changeIndex,
    path: resolvedPath.path,
    reportedPath: resolvedPath.requestedPath,
    edits: parseTextEdits(change["edits"], changeIndex),
    version
  });
}
function comparePosition(left, right) {
  return left.line === right.line ? left.character - right.character : left.line - right.line;
}
function positionsEqual(left, right) {
  return left.line === right.line && left.character === right.character;
}
function rangesEqual(left, right) {
  return positionsEqual(left.start, right.start) && positionsEqual(left.end, right.end);
}
function isEmptyRange(range) {
  return positionsEqual(range.start, range.end);
}
function formatRange(range) {
  return `${range.start.line + 1}:${range.start.character + 1}-${range.end.line + 1}:${range.end.character + 1}`;
}
function validatePosition(position, label, context) {
  const { lines, changeIndex } = context;
  if (!Number.isInteger(position.line) || !Number.isInteger(position.character)) {
    throw new WorkspaceEditValidationError(changeIndex, `${label} position must use integer line and character`);
  }
  if (position.line < 0 || position.character < 0) {
    throw new WorkspaceEditValidationError(changeIndex, `${label} position cannot be negative`);
  }
  const line = lines[position.line];
  if (line === undefined) {
    throw new WorkspaceEditValidationError(changeIndex, `${label} line ${position.line} is outside the document`);
  }
  if (position.character > line.length) {
    throw new WorkspaceEditValidationError(changeIndex, `${label} character ${position.character} is outside line ${position.line}`);
  }
}
function validateRange(range, lines, changeIndex) {
  const context = { lines, changeIndex };
  validatePosition(range.start, "start", context);
  validatePosition(range.end, "end", context);
  if (comparePosition(range.start, range.end) > 0) {
    throw new WorkspaceEditValidationError(changeIndex, `range ${formatRange(range)} ends before it starts`);
  }
}
function sortAndDeduplicate(edits) {
  const sorted = edits.map((edit, index) => ({ edit, index })).sort((left, right) => {
    const positionOrder = comparePosition(right.edit.range.start, left.edit.range.start);
    return positionOrder === 0 ? right.index - left.index : positionOrder;
  });
  const unique = [];
  for (const entry of sorted) {
    const previous = unique.at(-1);
    if (previous !== undefined && !isEmptyRange(entry.edit.range) && rangesEqual(previous.range, entry.edit.range) && previous.newText === entry.edit.newText) {
      continue;
    }
    unique.push(entry.edit);
  }
  return unique;
}
function validateNoOverlap(edits, changeIndex) {
  for (let index = 0;index < edits.length - 1; index += 1) {
    const later = edits[index];
    const earlier = edits[index + 1];
    if (later === undefined || earlier === undefined)
      continue;
    if (comparePosition(earlier.range.end, later.range.start) > 0) {
      throw new WorkspaceEditValidationError(changeIndex, `overlapping edits ${formatRange(earlier.range)} and ${formatRange(later.range)}`);
    }
  }
}
function applyNormalizedTextEdits(content, edits) {
  const lines = content.split(`
`);
  for (const edit of edits) {
    const { start, end } = edit.range;
    const startLine = lines[start.line];
    const endLine = lines[end.line];
    if (startLine === undefined || endLine === undefined)
      continue;
    const replacement = startLine.slice(0, start.character) + edit.newText + endLine.slice(end.character);
    lines.splice(start.line, end.line - start.line + 1, ...replacement.split(`
`));
  }
  return lines.join(`
`);
}
function normalizeTextEdits(content, edits, changeIndex) {
  const lines = content.split(`
`);
  for (const edit of edits) {
    validateRange(edit.range, lines, changeIndex);
  }
  const normalized = sortAndDeduplicate(edits);
  validateNoOverlap(normalized, changeIndex);
  return { edits: normalized, text: applyNormalizedTextEdits(content, normalized) };
}
function isSameOrDescendant2(candidate, parent) {
  const relativePath = relative4(parent, candidate);
  return relativePath === "" || !relativePath.startsWith("..") && relativePath !== "..";
}
function removeVirtualSubtree(virtual, path2) {
  for (const candidate of [...virtual.keys()]) {
    if (isSameOrDescendant2(candidate, path2))
      virtual.delete(candidate);
  }
  virtual.set(path2, { kind: "missing" });
}
function moveVirtualSubtree(virtual, oldPath, newPath) {
  const moved = [...virtual.entries()].filter(([candidate]) => isSameOrDescendant2(candidate, oldPath));
  removeVirtualSubtree(virtual, oldPath);
  removeVirtualSubtree(virtual, newPath);
  for (const [candidate, entry] of moved) {
    const suffix = relative4(oldPath, candidate);
    virtual.set(suffix === "" ? newPath : resolve4(newPath, suffix), entry);
  }
}
function virtualDirectoryHasChildren(virtual, path2) {
  for (const [candidate, entry] of virtual) {
    if (candidate !== path2 && entry.kind !== "missing" && isSameOrDescendant2(candidate, path2))
      return true;
  }
  return false;
}
function requireVirtualParent(virtual, path2, changeIndex) {
  if (virtual.get(dirname5(path2))?.kind !== "directory") {
    throw new WorkspaceEditValidationError(changeIndex, `parent directory does not exist for ${path2}`);
  }
}
function simulateOperations(parsed, snapshots) {
  const virtual = new Map(snapshots);
  const planned = [];
  const failures = [];
  for (const operation of parsed) {
    try {
      planned.push(simulateOperation(operation, virtual));
    } catch (error) {
      if (error instanceof WorkspaceEditValidationError) {
        failures.push({ changeIndex: operation.changeIndex, message: error.detail });
        continue;
      }
      throw error;
    }
  }
  return { operations: planned, failures };
}
function simulateOperation(operation, virtual) {
  switch (operation.kind) {
    case "text":
      return simulateText(operation, virtual);
    case "create":
      return simulateCreate(operation, virtual);
    case "rename":
      return simulateRename(operation, virtual);
    case "delete":
      return simulateDelete(operation, virtual);
  }
}
function rejectSymbolicLink(operation) {
  if (operation.followedSymbolicLink) {
    throw new WorkspaceEditValidationError(operation.changeIndex, "resource operations through symbolic links are unsupported");
  }
}
function simulateText(operation, virtual) {
  const entry = virtual.get(operation.path);
  if (entry?.kind !== "file")
    throw new WorkspaceEditValidationError(operation.changeIndex, `${operation.path} is not a file`);
  const normalized = normalizeTextEdits(entry.content, operation.edits, operation.changeIndex);
  virtual.set(operation.path, { kind: "file", content: normalized.text });
  return {
    kind: "text",
    changeIndex: operation.changeIndex,
    path: operation.path,
    beforeText: entry.content,
    afterText: normalized.text,
    editCount: normalized.edits.length,
    documentVersion: operation.version
  };
}
function simulateCreate(operation, virtual) {
  rejectSymbolicLink(operation);
  requireVirtualParent(virtual, operation.path, operation.changeIndex);
  const target = virtual.get(operation.path) ?? { kind: "missing" };
  if (target.kind !== "missing") {
    if (operation.overwrite && target.kind === "file") {
      virtual.set(operation.path, { kind: "file", content: "" });
      return { kind: "create", changeIndex: operation.changeIndex, path: operation.path, replaced: true };
    }
    if (operation.ignoreIfExists)
      return { kind: "noop", changeIndex: operation.changeIndex };
    throw new WorkspaceEditValidationError(operation.changeIndex, `create target already exists: ${operation.path}`);
  }
  virtual.set(operation.path, { kind: "file", content: "" });
  return { kind: "create", changeIndex: operation.changeIndex, path: operation.path, replaced: false };
}
function simulateRename(operation, virtual) {
  rejectSymbolicLink(operation);
  const source = virtual.get(operation.oldPath) ?? { kind: "missing" };
  if (source.kind === "missing") {
    throw new WorkspaceEditValidationError(operation.changeIndex, `rename source does not exist: ${operation.oldPath}`);
  }
  if (operation.oldPath === operation.newPath)
    return { kind: "noop", changeIndex: operation.changeIndex };
  if (isSameOrDescendant2(operation.newPath, operation.oldPath)) {
    throw new WorkspaceEditValidationError(operation.changeIndex, "cannot rename a path into its own subtree");
  }
  requireVirtualParent(virtual, operation.newPath, operation.changeIndex);
  const destination = virtual.get(operation.newPath) ?? { kind: "missing" };
  if (destination.kind !== "missing" && !operation.overwrite) {
    if (operation.ignoreIfExists)
      return { kind: "noop", changeIndex: operation.changeIndex };
    throw new WorkspaceEditValidationError(operation.changeIndex, `rename target already exists: ${operation.newPath}`);
  }
  moveVirtualSubtree(virtual, operation.oldPath, operation.newPath);
  return {
    kind: "rename",
    changeIndex: operation.changeIndex,
    oldPath: operation.oldPath,
    newPath: operation.newPath,
    sourceKind: source.kind,
    replaceDestination: destination.kind !== "missing"
  };
}
function simulateDelete(operation, virtual) {
  rejectSymbolicLink(operation);
  const target = virtual.get(operation.path) ?? { kind: "missing" };
  if (target.kind === "missing") {
    if (operation.ignoreIfNotExists)
      return { kind: "noop", changeIndex: operation.changeIndex };
    throw new WorkspaceEditValidationError(operation.changeIndex, `delete target does not exist: ${operation.path}`);
  }
  if (target.kind === "directory" && !operation.recursive && virtualDirectoryHasChildren(virtual, operation.path)) {
    throw new WorkspaceEditValidationError(operation.changeIndex, `directory is not empty: ${operation.path}`);
  }
  removeVirtualSubtree(virtual, operation.path);
  return {
    kind: "delete",
    changeIndex: operation.changeIndex,
    path: operation.path,
    targetKind: target.kind,
    recursive: operation.recursive
  };
}

class WorkspaceSnapshotBuilder {
  workspaceRoot;
  snapshots = new Map;
  constructor(workspaceRoot) {
    this.workspaceRoot = workspaceRoot;
  }
  build(operations) {
    this.add(this.workspaceRoot, false);
    for (const operation of operations) {
      switch (operation.kind) {
        case "rename":
          this.add(operation.oldPath, true);
          this.add(operation.newPath, true);
          break;
        case "delete":
          this.add(operation.path, true);
          break;
        case "text":
        case "create":
          this.add(operation.path, false);
          break;
      }
    }
    return this.snapshots;
  }
  add(path2, includeChildren) {
    let candidate = path2;
    while (true) {
      const existing = this.snapshots.get(candidate);
      if (existing === undefined || includeChildren && existing.kind === "directory" && existing.children === undefined) {
        this.snapshots.set(candidate, snapshotPath(candidate, includeChildren && candidate === path2));
      }
      if (candidate === this.workspaceRoot)
        break;
      candidate = dirname6(candidate);
    }
    if (!includeChildren || !existsSync6(path2) || !lstatSync4(path2).isDirectory())
      return;
    for (const child of readdirSync2(path2))
      this.add(resolve5(path2, child), true);
  }
}
function snapshotOperations(operations, workspaceRoot) {
  return new WorkspaceSnapshotBuilder(workspaceRoot).build(operations);
}

class PlanPathIndex {
  firstChangeByPath = new Map;
  reportedPathByCanonical = new Map;
  build(operations) {
    for (const operation of operations) {
      switch (operation.kind) {
        case "rename":
          this.add(operation.oldPath, operation.reportedOldPath, operation.changeIndex);
          this.add(operation.newPath, operation.reportedNewPath, operation.changeIndex);
          break;
        case "text":
        case "create":
        case "delete":
          this.add(operation.path, operation.reportedPath, operation.changeIndex);
          break;
      }
    }
  }
  add(path2, reportedPath2, changeIndex) {
    if (!this.firstChangeByPath.has(path2))
      this.firstChangeByPath.set(path2, changeIndex);
    if (!this.reportedPathByCanonical.has(path2))
      this.reportedPathByCanonical.set(path2, reportedPath2);
  }
}
function fingerprintWorkspaceEdit(edit, workspaceRoot) {
  const root = canonicalWorkspaceRoot(workspaceRoot);
  if (!root.success)
    return { success: false, result: failureResult([{ changeIndex: 0, message: root.error }]) };
  const parsed = parseWorkspaceEdit(edit, root.path);
  if (parsed.failures.length > 0)
    return { success: false, result: failureResult(parsed.failures) };
  return { success: true, fingerprint: canonicalFingerprint(parsed.operations) };
}
function planWorkspaceEdit(edit, workspaceRoot) {
  const root = canonicalWorkspaceRoot(workspaceRoot);
  if (!root.success)
    return { success: false, result: failureResult([{ changeIndex: 0, message: root.error }]) };
  const parsed = parseWorkspaceEdit(edit, root.path);
  if (parsed.failures.length > 0)
    return { success: false, result: failureResult(parsed.failures) };
  let snapshots;
  try {
    snapshots = snapshotOperations(parsed.operations, root.path);
  } catch (error) {
    return {
      success: false,
      result: failureResult([{ changeIndex: 0, message: error instanceof Error ? error.message : String(error) }])
    };
  }
  const simulated = simulateOperations(parsed.operations, snapshots);
  if (simulated.failures.length > 0)
    return { success: false, result: failureResult(simulated.failures) };
  const paths = new PlanPathIndex;
  paths.build(parsed.operations);
  const plan = {
    workspaceRoot: root.path,
    operations: simulated.operations,
    snapshots,
    firstChangeByPath: paths.firstChangeByPath,
    reportedPathByCanonical: paths.reportedPathByCanonical,
    fingerprint: canonicalFingerprint(parsed.operations)
  };
  return { success: true, plan };
}
function failure(message, failedChange, base) {
  return {
    success: false,
    filesModified: base?.filesModified ?? [],
    totalEdits: base?.totalEdits ?? 0,
    errors: [message],
    ...failedChange === undefined ? {} : { failedChange },
    ...base?.lateAbort ? { lateAbort: true } : {}
  };
}
function responseFor(result) {
  if (result.success)
    return { applied: true };
  return {
    applied: false,
    failureReason: result.errors[0] ?? "workspace edit failed",
    ...result.failedChange === undefined ? {} : { failedChange: result.failedChange }
  };
}
function isRecord4(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class WorkspaceMutationController {
  workspaceRoot;
  documents;
  activeLease = null;
  nextLeaseId = 1;
  io;
  constructor(workspaceRoot, documents) {
    this.workspaceRoot = workspaceRoot;
    this.documents = documents;
  }
  setIo(io) {
    this.io = io;
  }
  acquire(signal) {
    if (this.activeLease)
      return { success: false, result: failure("workspace mutation is already in progress") };
    if (signal?.aborted)
      return { success: false, result: failure("cancelled before mutating request") };
    const lease = {
      id: this.nextLeaseId,
      phase: "idle",
      ...signal === undefined ? {} : { signal }
    };
    this.nextLeaseId += 1;
    this.activeLease = lease;
    return { success: true, lease };
  }
  release(lease) {
    if (this.activeLease?.id !== lease.id)
      return;
    this.activeLease.phase = "sealed";
    this.activeLease = null;
  }
  isBeforeCommit(lease) {
    return this.activeLease?.id === lease.id && this.activeLease.phase === "idle";
  }
  async handleApplyEdit(params) {
    const lease = this.activeLease;
    if (!lease)
      return { applied: false, failureReason: "workspace/applyEdit requires an active workspace mutation" };
    if (lease.phase !== "idle") {
      return {
        applied: false,
        failureReason: workspaceApplyEditConcurrentFailureReason(lease.phase === "applying" ? "applying" : "settled")
      };
    }
    lease.phase = "applying";
    lease.applyCompletion = new Promise((resolve62) => {
      lease.resolveApply = resolve62;
    });
    const edit = isRecord4(params) ? params["edit"] : undefined;
    const record2 = edit === undefined ? { fingerprint: null, result: failure("workspace/applyEdit params.edit is required", 0) } : await this.applyEdit(edit, lease);
    lease.serverApply = record2;
    lease.phase = "settled";
    lease.resolveApply?.();
    return responseFor(record2.result);
  }
  async reconcileRename(leaseToken, edit) {
    const lease = this.requireActiveLease(leaseToken);
    if (!lease)
      return { edit, apply: failure("workspace mutation lease ended before rename reconciliation") };
    if (lease.phase === "applying")
      await lease.applyCompletion;
    if (lease.serverApply)
      return this.reconcileServerApply(lease.serverApply, edit);
    lease.phase = "sealed";
    if (!edit)
      return { edit, apply: failure("No edit provided") };
    const applied = await this.applyEdit(edit, lease);
    return { edit, apply: applied.result };
  }
  reconcileServerApply(record2, edit) {
    if (!edit)
      return { edit, apply: record2.result };
    const fingerprint = fingerprintWorkspaceEdit(edit, this.workspaceRoot);
    if (fingerprint.success && record2.fingerprint !== null && fingerprint.fingerprint === record2.fingerprint) {
      return { edit, apply: record2.result };
    }
    return {
      edit,
      apply: failure("rename result conflicts with server-applied workspace edit", 0, record2.result)
    };
  }
  async applyEdit(edit, lease) {
    const planned = planWorkspaceEdit(edit, this.workspaceRoot);
    if (!planned.success)
      return { fingerprint: null, result: planned.result };
    const versionFailure = this.documents.validateVersions(planned.plan.operations);
    if (versionFailure) {
      return {
        fingerprint: planned.plan.fingerprint,
        result: failure(versionFailure.message, versionFailure.changeIndex)
      };
    }
    const commit = commitWorkspaceEditPlan(planned.plan, {
      ...lease.signal === undefined ? {} : { signal: lease.signal },
      ...this.io === undefined ? {} : { io: this.io }
    });
    let result = commit.result;
    if (commit.delta.operations.length > 0) {
      try {
        await this.documents.synchronize(commit.delta);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result = failure(`document synchronization failed after filesystem commit: ${message}`, undefined, result);
      }
    }
    if (lease.signal?.aborted && !result.lateAbort)
      result = { ...result, lateAbort: true };
    return { fingerprint: planned.plan.fingerprint, result };
  }
  requireActiveLease(lease) {
    return this.activeLease?.id === lease.id ? this.activeLease : null;
  }
}
var DIAGNOSTICS_FRESHNESS_TIMEOUT_MS = 3000;
var VERSIONLESS_PUBLISH_QUIESCENCE_MS = 250;

class LspClient extends LspClientConnection {
  diagnosticPullErrors = [];
  documents;
  workspaceMutations;
  diagnosticsFreshnessTimeoutMs;
  constructor(root, server2, options = {}) {
    super(root, server2, options);
    this.diagnosticsFreshnessTimeoutMs = options.diagnosticsFreshnessTimeoutMs ?? DIAGNOSTICS_FRESHNESS_TIMEOUT_MS;
    this.documents = new WorkspaceDocumentState((method, params) => this.sendNotification(method, params), (uri) => this.diagnosticsStore.delete(uri), {
      versionlessPublishQuiescenceMs: options.versionlessPublishQuiescenceMs ?? VERSIONLESS_PUBLISH_QUIESCENCE_MS
    });
    this.workspaceMutations = new WorkspaceMutationController(root, this.documents);
    this.setWorkspaceApplyEditHandler((params) => this.workspaceMutations.handleApplyEdit(params));
  }
  getDiagnosticPullErrors() {
    return this.diagnosticPullErrors;
  }
  async openFile(filePath) {
    const absPath = this.resolveWorkspacePath(filePath);
    await this.documents.openFile(absPath);
  }
  getOpenDocumentVersion(filePath) {
    return this.documents.getVersion(this.resolveWorkspacePath(filePath));
  }
  getStoredDiagnostics(uri) {
    return [...this.documents.getStoredDiagnostics(uri)];
  }
  setWorkspaceEditIo(io) {
    this.workspaceMutations.setIo(io);
  }
  handlePublishDiagnostics(params) {
    super.handlePublishDiagnostics(params);
    this.documents.recordPublishedDiagnostics(params);
  }
  async definition(filePath, line, character, signal) {
    const absPath = this.resolveWorkspacePath(filePath);
    await this.openFile(absPath);
    const options = signal === undefined ? {} : { signal };
    return this.sendRequest("textDocument/definition", {
      textDocument: { uri: pathToFileURL3(absPath).href },
      position: { line: line - 1, character }
    }, options);
  }
  async references(filePath, line, character, includeDeclaration = true, signal) {
    const absPath = this.resolveWorkspacePath(filePath);
    await this.openFile(absPath);
    const options = signal === undefined ? {} : { signal };
    return this.sendRequest("textDocument/references", {
      textDocument: { uri: pathToFileURL3(absPath).href },
      position: { line: line - 1, character },
      context: { includeDeclaration }
    }, options);
  }
  async documentSymbols(filePath, signal) {
    const absPath = this.resolveWorkspacePath(filePath);
    await this.openFile(absPath);
    const options = signal === undefined ? {} : { signal };
    return this.sendRequest("textDocument/documentSymbol", {
      textDocument: { uri: pathToFileURL3(absPath).href }
    }, options);
  }
  async formatDocument(filePath, options, signal) {
    if (!this.isDocumentFormattingSupported())
      return null;
    const absPath = this.resolveWorkspacePath(filePath);
    await this.openFile(absPath);
    const requestOptions = signal === undefined ? {} : { signal };
    const edits = await this.sendRequest("textDocument/formatting", {
      textDocument: { uri: pathToFileURL3(absPath).href },
      options
    }, requestOptions);
    return edits ?? [];
  }
  async workspaceSymbols(query, signal) {
    const options = signal === undefined ? {} : { signal };
    return this.sendRequest("workspace/symbol", { query }, options);
  }
  isUnsupportedDiagnosticPullError(error) {
    if (!(error instanceof Error))
      return false;
    const code = "code" in error && typeof error.code === "number" ? error.code : undefined;
    if (code === -32601)
      return true;
    return /unsupported|not supported|method not found|unknown request/i.test(error.message);
  }
  freshnessTimeout(absPath) {
    return {
      items: [],
      transientError: {
        kind: "freshness_timeout",
        message: `Timed out waiting for fresh diagnostics for ${absPath} within ${this.diagnosticsFreshnessTimeoutMs}ms.`
      }
    };
  }
  parseDiagnosticPullReport(value) {
    if (value.kind === "unchanged") {
      return {
        type: "unchanged",
        ...value.resultId === undefined ? {} : { resultId: value.resultId }
      };
    }
    return {
      type: "full",
      diagnostics: value.items ?? [],
      ...value.resultId === undefined ? {} : { resultId: value.resultId }
    };
  }
  async diagnostics(filePath, signal) {
    signal?.throwIfAborted();
    const absPath = this.resolveWorkspacePath(filePath);
    const uri = pathToFileURL3(absPath).href;
    await this.openFile(absPath);
    const deadlineAt = Date.now() + this.diagnosticsFreshnessTimeoutMs;
    for (;; ) {
      signal?.throwIfAborted();
      const snapshot = this.documents.captureDiagnosticSnapshot(absPath);
      if (!snapshot)
        return this.freshnessTimeout(absPath);
      const push = this.documents.resolvePushDiagnostics(snapshot);
      if (push.status === "ready")
        return { items: [...push.diagnostics] };
      let pushFallbackOnly = !this.isDiagnosticPullSupported();
      if (!pushFallbackOnly) {
        const cached = this.documents.getPullCache(snapshot);
        try {
          const remainingMs2 = deadlineAt - Date.now();
          if (remainingMs2 <= 0)
            return this.freshnessTimeout(absPath);
          const result = await this.sendRequest("textDocument/diagnostic", {
            textDocument: { uri },
            ...cached?.resultId === undefined ? {} : { previousResultId: cached.resultId }
          }, { timeoutMs: remainingMs2, ...signal === undefined ? {} : { signal } });
          if (!this.documents.isCurrentSnapshot(snapshot))
            continue;
          const report = this.parseDiagnosticPullReport(result);
          if (report.type === "full") {
            this.documents.recordPullDiagnostics(snapshot, {
              kind: "full",
              diagnostics: report.diagnostics,
              ...report.resultId === undefined ? {} : { resultId: report.resultId }
            });
            return { items: [...report.diagnostics] };
          }
          if (cached !== null && cached.documentVersion === snapshot.version && cached.resultId === report.resultId) {
            return { items: [...cached.diagnostics] };
          }
        } catch (error) {
          if (this.isUnsupportedDiagnosticPullError(error)) {
            this.setDiagnosticPullSupported(false);
            pushFallbackOnly = true;
          } else if (error instanceof LspRequestTimeoutError) {
            pushFallbackOnly = true;
          } else {
            this.diagnosticPullErrors.push(error instanceof Error ? error : new Error(String(error)));
            throw error;
          }
        }
      }
      if (!pushFallbackOnly)
        continue;
      const remainingMs = deadlineAt - Date.now();
      if (remainingMs <= 0) {
        if (!this.isDiagnosticPullSupported() && snapshot.publishGeneration === 0) {
          const cached = this.documents.getPullCache(snapshot);
          return { items: cached === null ? [] : [...cached.diagnostics] };
        }
        return this.freshnessTimeout(absPath);
      }
      const waitMs = push.status === "wait" ? Math.min(push.waitMs, remainingMs) : remainingMs;
      await waitForDiagnosticsActivity(this.documents.waitForDiagnosticsActivity(snapshot, waitMs), signal);
    }
  }
  async prepareRename(filePath, line, character, signal) {
    const absPath = this.resolveWorkspacePath(filePath);
    await this.openFile(absPath);
    const options = signal === undefined ? {} : { signal };
    return this.sendRequest("textDocument/prepareRename", {
      textDocument: { uri: pathToFileURL3(absPath).href },
      position: { line: line - 1, character }
    }, options);
  }
  async rename(filePath, line, character, newName, signal) {
    const absPath = this.resolveWorkspacePath(filePath);
    await this.openFile(absPath);
    const acquired = this.workspaceMutations.acquire(signal);
    if (!acquired.success)
      return { edit: null, apply: acquired.result };
    const preCommitSignal = createPreCommitAbortSignal(signal, () => this.workspaceMutations.isBeforeCommit(acquired.lease));
    try {
      const renameParams = {
        textDocument: { uri: pathToFileURL3(absPath).href },
        position: { line: line - 1, character },
        newName
      };
      const edit = preCommitSignal === undefined ? await this.sendRequest("textDocument/rename", renameParams) : await this.sendRequest("textDocument/rename", renameParams, {
        signal: preCommitSignal.signal
      });
      return await this.workspaceMutations.reconcileRename(acquired.lease, edit);
    } finally {
      preCommitSignal?.dispose();
      this.workspaceMutations.release(acquired.lease);
    }
  }
  resolveWorkspacePath(filePath) {
    return resolve6(this.root, filePath);
  }
}
function waitForDiagnosticsActivity(wait, signal) {
  if (!signal)
    return wait;
  if (signal.aborted)
    return Promise.reject(abortError3(signal));
  return new Promise((resolve72, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(abortError3(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    wait.then(() => {
      signal.removeEventListener("abort", onAbort);
      resolve72();
    }, (error) => {
      signal.removeEventListener("abort", onAbort);
      reject(error);
    });
  });
}
function createPreCommitAbortSignal(source, isBeforeCommit) {
  if (!source)
    return;
  const controller = new AbortController;
  const onAbort = () => {
    if (isBeforeCommit() && !controller.signal.aborted)
      controller.abort(preCommitAbortReason(source));
  };
  if (source.aborted)
    onAbort();
  else
    source.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    dispose: () => source.removeEventListener("abort", onAbort)
  };
}
function preCommitAbortReason(source) {
  const reason = source.reason;
  if (reason instanceof Error && reason.name !== "AbortError")
    return reason;
  return new Error("LSP request cancelled before workspace edit commit");
}
function abortError3(signal) {
  const reason = signal.reason;
  if (reason instanceof Error)
    return reason;
  const error = new Error(typeof reason === "string" ? reason : "operation cancelled");
  error.name = "AbortError";
  return error;
}
function installProcessSignalCleanup(cleanup) {
  const signals = process.platform === "win32" ? ["SIGINT", "SIGTERM", "SIGBREAK"] : ["SIGINT", "SIGTERM"];
  const handler = () => {
    cleanup().catch((error) => {
      reportBestEffortCleanupError("signal cleanup", error);
    });
  };
  for (const signal of signals) {
    process.on(signal, handler);
  }
  return () => {
    for (const signal of signals) {
      process.removeListener(signal, handler);
    }
  };
}
async function stopClientBestEffort(client) {
  try {
    await client.stop();
  } catch (error) {
    reportBestEffortCleanupError("client stop", error);
  }
}
function awaitWithSignal2(promise, signal) {
  if (!signal)
    return promise;
  return new Promise((resolve72, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled)
        return;
      settled = true;
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then((value) => {
      if (settled)
        return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve72(value);
    }, (err) => {
      if (settled)
        return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      reject(err);
    });
  });
}

class LspManager {
  clients = new Map;
  pendingStops = new Map;
  respawnBudgets = new Map;
  reaperHandle = null;
  signalDisposer = null;
  disposed = false;
  idleTimeoutMs;
  initTimeoutMs;
  maxResidentClients;
  reaperIntervalMs;
  clientFactory;
  now;
  constructor(options = {}) {
    this.idleTimeoutMs = options.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
    this.initTimeoutMs = options.initTimeoutMs ?? INIT_TIMEOUT_MS;
    this.maxResidentClients = options.maxResidentClients ?? MAX_RESIDENT_CLIENTS;
    this.reaperIntervalMs = options.reaperIntervalMs ?? REAPER_INTERVAL_MS;
    this.clientFactory = options.clientFactory ?? ((root, server2) => new LspClient(root, server2));
    this.now = options.now ?? (() => Date.now());
    this.startReaper();
    this.signalDisposer = installProcessSignalCleanup(() => this.stopAll());
  }
  startReaper() {
    if (this.reaperHandle)
      return;
    this.reaperHandle = setInterval(() => {
      this.reapStale();
    }, this.reaperIntervalMs);
    if (typeof this.reaperHandle.unref === "function") {
      this.reaperHandle.unref();
    }
  }
  getKey(root, serverId) {
    return `${root}::${serverId}`;
  }
  tombstoneStop(key, client) {
    const stop = stopClientBestEffort(client);
    this.pendingStops.set(key, stop);
    stop.finally(() => {
      if (this.pendingStops.get(key) === stop) {
        this.pendingStops.delete(key);
      }
    });
    return stop;
  }
  recordDeadGeneration(key) {
    let budget = this.respawnBudgets.get(key);
    if (budget === undefined) {
      budget = { deadGenerations: 0, exhaustedAt: null };
      this.respawnBudgets.set(key, budget);
    }
    budget.deadGenerations += 1;
  }
  markHealthyGeneration(key) {
    this.respawnBudgets.delete(key);
  }
  ensureRespawnAllowed(key, root, serverId) {
    const budget = this.respawnBudgets.get(key);
    if (budget === undefined || budget.deadGenerations < CLIENT_RESPAWN_RETRY_LIMIT)
      return;
    if (budget.exhaustedAt === null) {
      budget.exhaustedAt = this.now();
      throw new LspClientRespawnBudgetExceededError(serverId, root, CLIENT_RESPAWN_RETRY_LIMIT);
    }
    if (this.now() - budget.exhaustedAt < CLIENT_RESPAWN_COOLDOWN_MS) {
      throw new LspClientRespawnBudgetExceededError(serverId, root, CLIENT_RESPAWN_RETRY_LIMIT);
    }
    budget.deadGenerations = 0;
    budget.exhaustedAt = null;
  }
  reapStale() {
    const t = this.now();
    for (const [key, managed] of this.clients) {
      if (managed.isInitializing && managed.initializingSince !== null && t - managed.initializingSince > this.initTimeoutMs) {
        this.clients.delete(key);
        this.tombstoneStop(key, managed.client);
        continue;
      }
      if (!managed.isInitializing && managed.refCount === 0 && managed.pendingWaiters === 0 && t - managed.lastUsedAt > this.idleTimeoutMs) {
        this.clients.delete(key);
        this.tombstoneStop(key, managed.client);
      }
    }
  }
  evictForAdmission() {
    while (this.clients.size >= this.maxResidentClients) {
      const victim = this.leastRecentlyUsedIdleClient();
      if (!victim)
        return;
      this.clients.delete(victim.key);
      this.tombstoneStop(victim.key, victim.managed.client);
    }
  }
  leastRecentlyUsedIdleClient() {
    let candidate = null;
    for (const [key, managed] of this.clients) {
      if (managed.refCount > 0 || managed.pendingWaiters > 0 || managed.isInitializing)
        continue;
      if (candidate === null || managed.lastUsedAt < candidate.managed.lastUsedAt) {
        candidate = { key, managed };
      }
    }
    return candidate;
  }
  async tryDeleteIfOrphaned(key, managed) {
    if (managed.refCount === 0 && managed.pendingWaiters === 0 && !managed.isInitializing && this.clients.get(key) === managed) {
      this.clients.delete(key);
      await this.tombstoneStop(key, managed.client);
    }
  }
  async getClient(root, server2, signal) {
    if (this.disposed) {
      throw new Error("LspManager has been disposed");
    }
    signal?.throwIfAborted();
    const key = this.getKey(root, server2.id);
    for (;; ) {
      const pendingStop = this.pendingStops.get(key);
      if (pendingStop === undefined)
        break;
      await awaitWithSignal2(pendingStop, signal);
      signal?.throwIfAborted();
    }
    if (this.disposed) {
      throw new Error("LspManager has been disposed");
    }
    let managed = this.clients.get(key);
    if (managed) {
      const t = this.now();
      if (managed.isInitializing && managed.initializingSince !== null && t - managed.initializingSince > this.initTimeoutMs) {
        this.clients.delete(key);
        await this.tombstoneStop(key, managed.client);
        managed = undefined;
      }
    }
    if (managed) {
      if (managed.initPromise) {
        managed.pendingWaiters++;
        try {
          await awaitWithSignal2(managed.initPromise, signal);
        } catch (err) {
          managed.pendingWaiters--;
          await this.tryDeleteIfOrphaned(key, managed);
          throw err;
        }
        managed.pendingWaiters--;
      }
      if (signal?.aborted) {
        await this.tryDeleteIfOrphaned(key, managed);
        signal.throwIfAborted();
      }
      if (!managed.client.isAlive()) {
        this.recordDeadGeneration(key);
        if (this.clients.get(key) === managed) {
          this.clients.delete(key);
        }
        await this.tombstoneStop(key, managed.client);
        return this.getClient(root, server2, signal);
      }
      this.markHealthyGeneration(key);
      managed.refCount++;
      managed.lastUsedAt = this.now();
      return managed.client;
    }
    this.evictForAdmission();
    this.ensureRespawnAllowed(key, root, server2.id);
    const client = this.clientFactory(root, server2);
    const initStartedAt = this.now();
    const initPromise = (async () => {
      await client.start();
      await client.initialize();
    })();
    const newManaged = {
      client,
      refCount: 0,
      pendingWaiters: 1,
      lastUsedAt: initStartedAt,
      initPromise,
      isInitializing: true,
      initializingSince: initStartedAt
    };
    this.clients.set(key, newManaged);
    try {
      await awaitWithSignal2(initPromise, signal);
    } catch (err) {
      newManaged.pendingWaiters--;
      if (this.clients.get(key) === newManaged) {
        this.clients.delete(key);
      }
      await this.tombstoneStop(key, client);
      throw err;
    }
    newManaged.pendingWaiters--;
    newManaged.isInitializing = false;
    newManaged.initializingSince = null;
    newManaged.initPromise = null;
    if (signal?.aborted) {
      await this.tryDeleteIfOrphaned(key, newManaged);
      signal.throwIfAborted();
    }
    if (!client.isAlive()) {
      this.recordDeadGeneration(key);
      if (this.clients.get(key) === newManaged) {
        this.clients.delete(key);
      }
      await this.tombstoneStop(key, client);
      return this.getClient(root, server2, signal);
    }
    this.markHealthyGeneration(key);
    newManaged.refCount++;
    newManaged.lastUsedAt = this.now();
    return client;
  }
  releaseClient(root, serverId) {
    const key = this.getKey(root, serverId);
    const managed = this.clients.get(key);
    if (managed && managed.refCount > 0) {
      managed.refCount--;
      managed.lastUsedAt = this.now();
    }
  }
  invalidateClient(root, serverId, client) {
    const key = this.getKey(root, serverId);
    const managed = this.clients.get(key);
    if (!managed)
      return;
    if (client && managed.client !== client)
      return;
    this.clients.delete(key);
    this.tombstoneStop(key, managed.client);
  }
  warmupClient(root, server2) {
    if (this.disposed)
      return;
    const key = this.getKey(root, server2.id);
    if (this.clients.has(key) || this.pendingStops.has(key))
      return;
    this.evictForAdmission();
    try {
      this.ensureRespawnAllowed(key, root, server2.id);
    } catch {
      return;
    }
    const client = this.clientFactory(root, server2);
    const initStartedAt = this.now();
    const initPromise = (async () => {
      await client.start();
      await client.initialize();
    })();
    const managed = {
      client,
      refCount: 0,
      pendingWaiters: 0,
      lastUsedAt: initStartedAt,
      initPromise,
      isInitializing: true,
      initializingSince: initStartedAt
    };
    this.clients.set(key, managed);
    initPromise.then(() => {
      managed.isInitializing = false;
      managed.initializingSince = null;
      managed.initPromise = null;
      managed.lastUsedAt = this.now();
    }, () => {
      if (this.clients.get(key) === managed) {
        this.clients.delete(key);
      }
      this.tombstoneStop(key, client);
    });
  }
  isServerInitializing(root, serverId) {
    const managed = this.clients.get(this.getKey(root, serverId));
    return managed?.isInitializing ?? false;
  }
  getSnapshot() {
    const snapshots = [];
    for (const [key, managed] of this.clients) {
      const [root, serverId] = key.split("::");
      snapshots.push({
        root,
        serverId,
        refCount: managed.refCount,
        pendingWaiters: managed.pendingWaiters,
        lastUsedAt: managed.lastUsedAt,
        isInitializing: managed.isInitializing,
        alive: managed.client.isAlive(),
        command: managed.client.command()
      });
    }
    return snapshots;
  }
  hasClient(root, serverId) {
    return this.clients.has(this.getKey(root, serverId));
  }
  clientCount() {
    return this.clients.size;
  }
  async stopAll() {
    this.disposed = true;
    if (this.reaperHandle) {
      clearInterval(this.reaperHandle);
      this.reaperHandle = null;
    }
    if (this.signalDisposer) {
      this.signalDisposer();
      this.signalDisposer = null;
    }
    const stopPromises = [];
    for (const managed of this.clients.values()) {
      stopPromises.push(stopClientBestEffort(managed.client));
    }
    const tombstonedStops = [...this.pendingStops.values()];
    this.clients.clear();
    this.respawnBudgets.clear();
    await Promise.allSettled([...stopPromises, ...tombstonedStops]);
    this.pendingStops.clear();
  }
}
var _defaultInstance = null;
function getLspManager() {
  if (!_defaultInstance) {
    _defaultInstance = new LspManager;
  }
  return _defaultInstance;
}
var GIT_WORKSPACE_MARKER = ".git";
var PROJECT_WORKSPACE_MARKERS = [
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle"
];
var WORKSPACE_MARKERS = [GIT_WORKSPACE_MARKER, ...PROJECT_WORKSPACE_MARKERS];
function findWorkspaceRootOutsideContext(directory) {
  const marked = nearestMarkedAncestor(directory);
  if (marked !== undefined)
    return marked;
  return realpathSync4(nearestExistingAncestor(directory));
}
function nearestMarkedAncestor(directory) {
  let current = directory;
  for (;; ) {
    if (existsSync7(current) && WORKSPACE_MARKERS.some((marker) => existsSync7(join3(current, marker)))) {
      return realpathSync4(current);
    }
    const parent = dirname7(current);
    if (parent === current)
      return;
    current = parent;
  }
}
function nearestExistingAncestor(directory) {
  let current = directory;
  while (!existsSync7(current)) {
    const parent = dirname7(current);
    if (parent === current)
      return current;
    current = parent;
  }
  return current;
}
var LSP_INSTALL_HINTS = {
  typescript: "npm install -g typescript-language-server typescript",
  deno: "Install Deno from https://deno.land",
  vue: "npm install -g @vue/language-server",
  eslint: "npm install -g vscode-langservers-extracted",
  oxlint: "npm install -g oxlint",
  biome: "npm install -g @biomejs/biome",
  gopls: "go install golang.org/x/tools/gopls@latest",
  "ruby-lsp": "gem install ruby-lsp",
  basedpyright: "pip install basedpyright",
  pyright: "pip install pyright",
  ty: "pip install ty",
  ruff: "pip install ruff",
  "elixir-ls": "See https://github.com/elixir-lsp/elixir-ls",
  zls: "See https://github.com/zigtools/zls",
  csharp: "dotnet tool install -g csharp-ls",
  fsharp: "dotnet tool install -g fsautocomplete",
  "sourcekit-lsp": "Included with Xcode or Swift toolchain",
  rust: "Install rust-analyzer and ensure it is in PATH. If using rustup: rustup component add rust-analyzer. " + "If rust-analyzer exits while loading rust-src: rustup component remove rust-src && rustup component add rust-src.",
  clangd: "See https://clangd.llvm.org/installation",
  svelte: "npm install -g svelte-language-server",
  astro: "npm install -g @astrojs/language-server",
  "bash-ls": "npm install -g bash-language-server",
  jdtls: "See https://github.com/eclipse-jdtls/eclipse.jdt.ls",
  "yaml-ls": "npm install -g yaml-language-server",
  "lua-ls": "See https://github.com/LuaLS/lua-language-server",
  php: "npm install -g intelephense",
  dart: "Included with Dart SDK",
  "terraform-ls": "See https://github.com/hashicorp/terraform-ls",
  terraform: "See https://github.com/hashicorp/terraform-ls",
  prisma: "npm install -g prisma",
  "ocaml-lsp": "opam install ocaml-lsp-server",
  texlab: "See https://github.com/latex-lsp/texlab",
  dockerfile: "npm install -g dockerfile-language-server-nodejs",
  gleam: "See https://gleam.run/getting-started/installing/",
  "clojure-lsp": "See https://clojure-lsp.io/installation/",
  nixd: "nix profile install nixpkgs#nixd",
  tinymist: "See https://github.com/Myriad-Dreamin/tinymist",
  "haskell-language-server": "ghcup install hls",
  bash: "npm install -g bash-language-server",
  "kotlin-ls": "See https://github.com/Kotlin/kotlin-lsp",
  julials: `julia -e 'using Pkg; Pkg.add("LanguageServer")'`,
  razor: "Razor runs through the Roslyn language server (cohosting). " + "Install: dotnet tool install -g roslyn-language-server --prerelease (requires v5.8.0+). See https://github.com/dotnet/razor"
};
var LSP_LOCAL_INSTALL_HINTS = {
  typescript: "bun add -d typescript-language-server typescript",
  vue: "bun add -d @vue/language-server",
  eslint: "bun add -d vscode-langservers-extracted",
  oxlint: "bun add -d oxlint",
  biome: "bun add -d @biomejs/biome",
  svelte: "bun add -d svelte-language-server",
  astro: "bun add -d @astrojs/language-server",
  bash: "bun add -d bash-language-server",
  "bash-ls": "bun add -d bash-language-server",
  "yaml-ls": "bun add -d yaml-language-server",
  php: "bun add -d intelephense",
  prisma: "bun add -d prisma",
  dockerfile: "bun add -d dockerfile-language-server-nodejs",
  pyright: "uv add --dev pyright",
  basedpyright: "uv add --dev basedpyright",
  ruff: "uv add --dev ruff",
  ty: "uv add --dev ty",
  "ruby-lsp": "bundle add ruby-lsp --group development"
};
var BUILTIN_SERVERS = {
  typescript: {
    command: ["typescript-language-server", "--stdio"],
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]
  },
  deno: { command: ["deno", "lsp"], extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs"] },
  vue: { command: ["vue-language-server", "--stdio"], extensions: [".vue"] },
  eslint: {
    command: ["vscode-eslint-language-server", "--stdio"],
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue"]
  },
  oxlint: {
    command: ["oxlint", "--lsp"],
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue", ".astro", ".svelte"]
  },
  biome: {
    command: ["biome", "lsp-proxy", "--stdio"],
    extensions: [
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
      ".mjs",
      ".cjs",
      ".mts",
      ".cts",
      ".json",
      ".jsonc",
      ".vue",
      ".astro",
      ".svelte",
      ".css",
      ".graphql",
      ".gql",
      ".html"
    ]
  },
  gopls: { command: ["gopls"], extensions: [".go"] },
  "ruby-lsp": {
    command: ["rubocop", "--lsp"],
    extensions: [".rb", ".rake", ".gemspec", ".ru"]
  },
  basedpyright: {
    command: ["basedpyright-langserver", "--stdio"],
    extensions: [".py", ".pyi"]
  },
  pyright: { command: ["pyright-langserver", "--stdio"], extensions: [".py", ".pyi"] },
  ty: { command: ["ty", "server"], extensions: [".py", ".pyi"] },
  ruff: { command: ["ruff", "server"], extensions: [".py", ".pyi"] },
  "elixir-ls": { command: ["elixir-ls"], extensions: [".ex", ".exs"] },
  zls: { command: ["zls"], extensions: [".zig", ".zon"] },
  csharp: { command: ["csharp-ls"], extensions: [".cs"] },
  fsharp: { command: ["fsautocomplete"], extensions: [".fs", ".fsi", ".fsx", ".fsscript"] },
  "sourcekit-lsp": { command: ["sourcekit-lsp"], extensions: [".swift", ".m", ".mm"] },
  rust: { command: ["rust-analyzer"], extensions: [".rs"] },
  clangd: {
    command: ["clangd", "--background-index", "--clang-tidy"],
    extensions: [".c", ".cpp", ".cc", ".cxx", ".c++", ".h", ".hpp", ".hh", ".hxx", ".h++"]
  },
  svelte: { command: ["svelteserver", "--stdio"], extensions: [".svelte"] },
  astro: { command: ["astro-ls", "--stdio"], extensions: [".astro"] },
  bash: {
    command: ["bash-language-server", "start"],
    extensions: [".sh", ".bash", ".zsh", ".ksh"]
  },
  "bash-ls": {
    command: ["bash-language-server", "start"],
    extensions: [".sh", ".bash", ".zsh", ".ksh"]
  },
  jdtls: { command: ["jdtls"], extensions: [".java"] },
  "yaml-ls": { command: ["yaml-language-server", "--stdio"], extensions: [".yaml", ".yml"] },
  "lua-ls": { command: ["lua-language-server"], extensions: [".lua"] },
  php: { command: ["intelephense", "--stdio"], extensions: [".php"] },
  dart: { command: ["dart", "language-server", "--lsp"], extensions: [".dart"] },
  terraform: { command: ["terraform-ls", "serve"], extensions: [".tf", ".tfvars"] },
  "terraform-ls": { command: ["terraform-ls", "serve"], extensions: [".tf", ".tfvars"] },
  prisma: { command: ["prisma", "language-server"], extensions: [".prisma"] },
  "ocaml-lsp": { command: ["ocamllsp"], extensions: [".ml", ".mli"] },
  texlab: { command: ["texlab"], extensions: [".tex", ".bib"] },
  dockerfile: { command: ["docker-langserver", "--stdio"], extensions: [".dockerfile"] },
  gleam: { command: ["gleam", "lsp"], extensions: [".gleam"] },
  "clojure-lsp": {
    command: ["clojure-lsp", "listen"],
    extensions: [".clj", ".cljs", ".cljc", ".edn"]
  },
  nixd: { command: ["nixd"], extensions: [".nix"] },
  tinymist: { command: ["tinymist"], extensions: [".typ", ".typc"] },
  "haskell-language-server": {
    command: ["haskell-language-server-wrapper", "--lsp"],
    extensions: [".hs", ".lhs"]
  },
  "kotlin-ls": { command: ["kotlin-lsp", "--stdio"], extensions: [".kt", ".kts"] },
  julials: {
    command: ["julia", "--startup-file=no", "--history-file=no", "-e", "using LanguageServer; runserver()"],
    extensions: [".jl"]
  },
  razor: {
    command: ["roslyn-language-server", "--stdio"],
    extensions: [".razor", ".cshtml"]
  }
};
function getInstallDecisionsPath() {
  return lspRequestContext().installDecisionsPath;
}
function loadInstallDecisions() {
  const path2 = getInstallDecisionsPath();
  if (!existsSync8(path2))
    return {};
  try {
    const parsed = JSON.parse(readFileSync4(path2, "utf8"));
    return isInstallDecisions(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
function loadInstallDecision(serverId) {
  return loadInstallDecisions()[serverId];
}
function recordInstallDecision(serverId, decision, decidedAt = new Date().toISOString()) {
  const decisions = loadInstallDecisions();
  decisions[serverId] = { decision, decidedAt };
  writeInstallDecisions(decisions);
}
function isInstallDecision(value) {
  return value === "declined" || value === "allowed";
}
function writeInstallDecisions(decisions) {
  const path2 = getInstallDecisionsPath();
  mkdirSync3(dirname8(path2), { recursive: true });
  const tmpPath = `${path2}.tmp`;
  writeFileSync2(tmpPath, `${JSON.stringify(decisions, null, 2)}
`, "utf8");
  renameSync2(tmpPath, path2);
}
function isInstallDecisions(value) {
  return isRecord5(value) && Object.values(value).every(isInstallDecisionRecord);
}
function isInstallDecisionRecord(value) {
  if (!isRecord5(value))
    return false;
  return isInstallDecision(value["decision"]) && typeof value["decidedAt"] === "string";
}
function isRecord5(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function getProjectConfigPaths() {
  return lspRequestContext().projectConfigPaths;
}
function getUserConfigPath() {
  return lspRequestContext().userConfigPath;
}
function loadJsonFile(path2) {
  if (!existsSync9(path2))
    return null;
  try {
    const parsed = JSON.parse(readFileSync5(path2, "utf-8"));
    return isConfigJson(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function loadAllConfigs() {
  const configs = new Map;
  const project = loadFirstJsonFile(getProjectConfigPaths());
  if (project)
    configs.set("project", project);
  const user = loadJsonFile(getUserConfigPath());
  if (user)
    configs.set("user", user);
  return configs;
}
function loadFirstJsonFile(paths) {
  for (const path2 of paths) {
    const config = loadJsonFile(path2);
    if (config)
      return config;
  }
  return null;
}
function getMergedServers() {
  const configs = loadAllConfigs();
  const servers = [];
  const disabled = new Set;
  const seen = new Set;
  const sources = ["project", "user"];
  for (const source of sources) {
    const config = configs.get(source);
    if (!config?.lsp)
      continue;
    for (const [id, rawEntry] of Object.entries(config.lsp)) {
      const entry = parseLspEntry(rawEntry);
      if (!entry)
        continue;
      if (entry.disabled) {
        disabled.add(id);
        continue;
      }
      if (seen.has(id))
        continue;
      const server2 = createServerFromEntry(id, entry, source);
      if (!server2)
        continue;
      servers.push(server2);
      seen.add(id);
    }
  }
  for (const [id, config] of Object.entries(BUILTIN_SERVERS)) {
    if (disabled.has(id) || seen.has(id))
      continue;
    servers.push({
      id,
      command: config.command,
      extensions: config.extensions,
      priority: -100,
      source: "builtin"
    });
  }
  return servers.sort((a, b) => {
    if (a.source !== b.source) {
      const order = {
        project: 0,
        user: 1,
        builtin: 2
      };
      return order[a.source] - order[b.source];
    }
    return b.priority - a.priority;
  });
}
function createServerFromEntry(id, entry, source) {
  const builtin = BUILTIN_SERVERS[id];
  if (source === "project") {
    if (!builtin)
      return null;
    const server3 = createServer({
      id,
      command: builtin.command,
      extensions: entry.extensions ?? builtin.extensions,
      priority: entry.priority ?? 0,
      source
    });
    if (entry.initialization !== undefined) {
      server3.initialization = entry.initialization;
    }
    return server3;
  }
  if (entry.command && entry.extensions) {
    const server3 = createServer({
      id,
      command: entry.command,
      extensions: entry.extensions,
      priority: entry.priority ?? 0,
      source
    });
    applyOptionalServerFields(server3, entry);
    return server3;
  }
  if (!builtin)
    return null;
  const server2 = createServer({
    id,
    command: entry.command ?? builtin.command,
    extensions: entry.extensions ?? builtin.extensions,
    priority: entry.priority ?? 0,
    source
  });
  applyOptionalServerFields(server2, entry);
  return server2;
}
function createServer(input) {
  const server2 = {
    id: input.id,
    command: input.command,
    extensions: input.extensions,
    priority: input.priority,
    source: input.source
  };
  if (input.env !== undefined) {
    server2.env = input.env;
  }
  if (input.initialization !== undefined) {
    server2.initialization = input.initialization;
  }
  return server2;
}
function applyOptionalServerFields(server2, entry) {
  if (entry.env !== undefined) {
    server2.env = entry.env;
  }
  if (entry.initialization !== undefined) {
    server2.initialization = entry.initialization;
  }
}
function isConfigJson(value) {
  if (!isRecord6(value))
    return false;
  const lsp = value["lsp"];
  return lsp === undefined || isRecord6(lsp);
}
function parseLspEntry(value) {
  return isLspEntry(value) ? value : null;
}
function isLspEntry(value) {
  if (!isRecord6(value))
    return false;
  const disabled = value["disabled"];
  const command = value["command"];
  const extensions = value["extensions"];
  const priority = value["priority"];
  const env = value["env"];
  const initialization = value["initialization"];
  return (disabled === undefined || typeof disabled === "boolean") && (command === undefined || isStringArray(command)) && (extensions === undefined || isStringArray(extensions)) && (priority === undefined || typeof priority === "number") && (env === undefined || isStringRecord(env)) && (initialization === undefined || isRecord6(initialization));
}
function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
function isStringRecord(value) {
  return isRecord6(value) && Object.values(value).every((item) => typeof item === "string");
}
function isRecord6(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function getDisabledServerIds() {
  const configs = loadAllConfigs();
  const disabled = new Set;
  for (const config of configs.values()) {
    if (!config.lsp)
      continue;
    for (const [id, rawEntry] of Object.entries(config.lsp)) {
      const entry = parseLspEntry(rawEntry);
      if (!entry)
        continue;
      if (entry.disabled)
        disabled.add(id);
    }
  }
  return disabled;
}
var LOCAL_BIN_RULES = [
  {
    markers: ["package.json", "bun.lock", "bun.lockb", "package-lock.json", "yarn.lock", "pnpm-lock.yaml"],
    binDirs: [join4("node_modules", ".bin")]
  },
  {
    markers: [
      "pyproject.toml",
      "ty.toml",
      "requirements.txt",
      "setup.py",
      "setup.cfg",
      "Pipfile",
      "pyrightconfig.json",
      "ruff.toml",
      ".ruff.toml"
    ],
    binDirs: [
      join4(".venv", "bin"),
      join4(".venv", "Scripts"),
      join4("venv", "bin"),
      join4("venv", "Scripts"),
      join4(".env", "bin"),
      join4(".env", "Scripts")
    ]
  },
  {
    markers: ["Gemfile", "Gemfile.lock"],
    binDirs: [join4("vendor", "bundle", "bin"), "bin"]
  },
  {
    markers: ["go.mod", "go.sum", "go.work"],
    binDirs: ["bin"]
  }
];
var resolutionCache = new Map;
var probeCount = 0;
function probe(path2) {
  probeCount += 1;
  return existsSync10(path2);
}
function executableSuffixes(platform, pathExt) {
  if (platform !== "win32")
    return [""];
  const configured = pathExt ?? process.env["PATHEXT"] ?? "";
  const systemExts = configured.split(";").filter((entry) => entry.length > 0).map((entry) => entry.toLowerCase());
  return [...new Set(["", ...systemExts, ".exe", ".cmd", ".bat", ".ps1"])];
}
function probeWithSuffixes(directory, command, suffixes) {
  for (const suffix of suffixes) {
    const candidate = join4(directory, command + suffix);
    if (probe(candidate))
      return candidate;
  }
  return null;
}
function resolveLocal(command, workingDirectory, suffixes, stopAt) {
  const boundary = stopAt === undefined ? undefined : resolve7(stopAt);
  let current = resolve7(workingDirectory);
  while (true) {
    for (const rule of LOCAL_BIN_RULES) {
      if (!rule.markers.some((marker) => probe(join4(current, marker))))
        continue;
      for (const binDir of rule.binDirs) {
        const found = probeWithSuffixes(join4(current, binDir), command, suffixes);
        if (found !== null)
          return found;
      }
    }
    if (probe(join4(current, ".git")))
      return null;
    if (boundary !== undefined && current === boundary)
      return null;
    const parent = dirname9(current);
    if (parent === current)
      return null;
    current = parent;
  }
}
function resolveFromPath(command, suffixes, platform, pathEnvOverride) {
  let pathEnv = pathEnvOverride ?? process.env["PATH"] ?? "";
  if (platform === "win32" && !pathEnv) {
    pathEnv = process.env["Path"] ?? "";
  }
  for (const entry of pathEnv.split(delimiter3)) {
    if (entry.length === 0)
      continue;
    const found = probeWithSuffixes(entry, command, suffixes);
    if (found !== null)
      return found;
  }
  return null;
}
function resolveServerBinary(command, workingDirectory, options = {}) {
  if (command.length === 0)
    return null;
  const [cmd] = command;
  if (cmd === undefined || cmd.length === 0)
    return null;
  const platform = options.platform ?? process.platform;
  const suffixes = executableSuffixes(platform, options.pathExt);
  if (cmd.includes("/") || cmd.includes("\\")) {
    const explicit = isAbsolute5(cmd) ? cmd : resolve7(workingDirectory ?? process.cwd(), cmd);
    return probe(explicit) ? explicit : null;
  }
  const cacheKey = JSON.stringify([
    workingDirectory ?? "",
    cmd,
    platform,
    options.stopAt ?? "",
    options.pathExt ?? "",
    options.pathEnv ?? process.env["PATH"] ?? ""
  ]);
  const cached = resolutionCache.get(cacheKey);
  if (cached !== undefined)
    return cached;
  let resolved = null;
  if (workingDirectory !== undefined && workingDirectory.length > 0) {
    resolved = resolveLocal(cmd, workingDirectory, suffixes, options.stopAt);
  }
  resolved ??= resolveFromPath(cmd, suffixes, platform, options.pathEnv);
  if (resolved === null && cmd === "node")
    resolved = cmd;
  resolutionCache.set(cacheKey, resolved);
  return resolved;
}
function isServerInstalled(command, workingDirectory, options = {}) {
  if (command.length === 0)
    return false;
  return resolveServerBinary(command, workingDirectory, options) !== null;
}
function withResolvedCommand(command, binaryPath) {
  return [binaryPath, ...command.slice(1)];
}
function findServerForExtension(ext) {
  const servers = getMergedServers();
  const workingDirectory = contextCwd();
  for (const server2 of servers) {
    if (!server2.extensions.includes(ext))
      continue;
    const binaryPath = resolveServerBinary(server2.command, workingDirectory);
    if (binaryPath !== null) {
      const resolvedServer = {
        id: server2.id,
        command: withResolvedCommand(server2.command, binaryPath),
        extensions: server2.extensions,
        priority: server2.priority
      };
      if (server2.env !== undefined) {
        return {
          status: "found",
          server: {
            ...resolvedServer,
            env: server2.env,
            ...server2.initialization === undefined ? {} : { initialization: server2.initialization }
          }
        };
      }
      return {
        status: "found",
        server: {
          ...resolvedServer,
          ...server2.initialization === undefined ? {} : { initialization: server2.initialization }
        }
      };
    }
  }
  for (const server2 of servers) {
    if (server2.extensions.includes(ext)) {
      const installHint = LSP_INSTALL_HINTS[server2.id] ?? `Install '${server2.command[0]}' and ensure it's in your PATH`;
      return {
        status: "not_installed",
        server: {
          id: server2.id,
          command: server2.command,
          extensions: server2.extensions
        },
        installHint
      };
    }
  }
  const availableServers = [...new Set(servers.map((s) => s.id))];
  return {
    status: "not_configured",
    extension: ext,
    availableServers
  };
}
function getAllServers() {
  const servers = getMergedServers();
  const disabled = getDisabledServerIds();
  const workingDirectory = contextCwd();
  const result = [];
  const seen = new Set;
  for (const server2 of servers) {
    if (seen.has(server2.id))
      continue;
    result.push({
      id: server2.id,
      installed: isServerInstalled(server2.command, workingDirectory),
      extensions: server2.extensions,
      disabled: false,
      source: server2.source,
      priority: server2.priority
    });
    seen.add(server2.id);
  }
  for (const id of disabled) {
    if (seen.has(id))
      continue;
    const builtin = BUILTIN_SERVERS[id];
    result.push({
      id,
      installed: builtin ? isServerInstalled(builtin.command, workingDirectory) : false,
      extensions: builtin?.extensions ?? [],
      disabled: true,
      source: "disabled",
      priority: 0
    });
  }
  return result;
}
function isDirectoryPath(filePath) {
  try {
    return statSync4(filePath).isDirectory();
  } catch {
    return false;
  }
}
function findWorkspaceRoot(filePath) {
  const cwd = contextCwd();
  const abs = resolveReadablePathInsideContext(filePath);
  let dir = abs;
  if (!isDirectoryPath(dir)) {
    dir = dirname10(dir);
  }
  if (!isPathInside(cwd, abs))
    return findWorkspaceRootOutsideContext(dir);
  const fallbackRoot = nearestExistingDirectoryInsideContext(dir, cwd) ?? cwd;
  let nearestPackageRoot;
  while (isPathInside(cwd, dir)) {
    const canonicalDir = existingDirectoryInsideContext(dir, cwd);
    if (canonicalDir !== undefined) {
      if (existsSync11(join5(dir, GIT_WORKSPACE_MARKER))) {
        return canonicalDir;
      }
      if (nearestPackageRoot === undefined && hasProjectWorkspaceMarker(dir)) {
        nearestPackageRoot = canonicalDir;
      }
    }
    if (dir === cwd)
      break;
    dir = dirname10(dir);
  }
  return nearestPackageRoot ?? fallbackRoot;
}
function hasProjectWorkspaceMarker(directory) {
  return PROJECT_WORKSPACE_MARKERS.some((marker) => existsSync11(join5(directory, marker)));
}
function resolveReadablePathInsideContext(filePath) {
  const cwd = contextCwd();
  const abs = resolve8(cwd, filePath);
  if (isPathInside(cwd, abs))
    return abs;
  const rebased = rebaseThroughCanonicalAncestor(abs, cwd);
  if (rebased !== undefined)
    return rebased;
  return canonicalizeExistingOrNearestAncestor(abs);
}
function resolvePathInsideContext(filePath) {
  const cwd = contextCwd();
  const abs = resolveReadablePathInsideContext(filePath);
  const canonical = canonicalizeExistingOrNearestAncestor(abs);
  if (!isPathInside(cwd, canonical)) {
    throw new LspInvalidPathError(`LSP file path must be inside request cwd: ${filePath}`);
  }
  return canonical;
}
function rebaseThroughCanonicalAncestor(path2, cwd) {
  let current = path2;
  const suffix = [];
  while (true) {
    if (existsSync11(current)) {
      const canonical = realpathSync5(current);
      if (isPathInside(cwd, canonical))
        return suffix.length === 0 ? canonical : join5(canonical, ...suffix);
    }
    const parent = dirname10(current);
    if (parent === current)
      return;
    suffix.unshift(basename3(current));
    current = parent;
  }
}
function existingDirectoryInsideContext(directory, cwd) {
  if (!existsSync11(directory))
    return;
  const canonical = realpathSync5(directory);
  if (!statSync4(canonical).isDirectory())
    return;
  return isPathInside(cwd, canonical) ? canonical : undefined;
}
function nearestExistingDirectoryInsideContext(directory, cwd) {
  let current = directory;
  while (isPathInside(cwd, current)) {
    const canonical = existingDirectoryInsideContext(current, cwd);
    if (canonical !== undefined)
      return canonical;
    if (current === cwd)
      return;
    current = dirname10(current);
  }
  return;
}
function formatServerLookupError(result) {
  if (result.status === "not_installed") {
    return formatNotInstalled(result);
  }
  const context = lspRequestContext();
  const firstProjectConfigPath = context.projectConfigPaths[0] ?? "<project lsp config>";
  return [
    `No LSP server configured for extension: ${result.extension}`,
    "",
    `Available servers: ${result.availableServers.slice(0, 10).join(", ")}${result.availableServers.length > 10 ? "..." : ""}`,
    "",
    `Configure a custom server in '${firstProjectConfigPath}' or '${context.userConfigPath}':`,
    "  {",
    '    "lsp": {',
    '      "my-server": {',
    '        "command": ["my-lsp", "--stdio"],',
    `        "extensions": ["${result.extension}"]`,
    "      }",
    "    }",
    "  }"
  ].join(`
`);
}
function formatInstallOptions(serverId, installHint) {
  const localHint = LSP_LOCAL_INSTALL_HINTS[serverId];
  if (localHint === undefined) {
    return ["To install, run:", `  ${installHint}`];
  }
  return [
    "To install in THIS repository (preferred — no global install needed):",
    `  ${localHint}`,
    "",
    "Or install it globally:",
    `  ${installHint}`
  ];
}
function formatNotInstalled(result) {
  const { server: server2, installHint } = result;
  const extensions = server2.extensions.join(", ");
  const decision = loadInstallDecision(server2.id)?.decision;
  const context = lspRequestContext();
  if (decision === "declined") {
    return `LSP server '${server2.id}' (${extensions}) is NOT INSTALLED; user previously declined installation — proceed without LSP.`;
  }
  const header = [
    `LSP server '${server2.id}' for ${extensions} is NOT INSTALLED.`,
    "",
    `Command not found: ${server2.command[0]}`,
    ""
  ];
  const installOptions = formatInstallOptions(server2.id, installHint);
  if (decision === "allowed") {
    return [
      ...header,
      "The user has pre-authorized LSP installation. Run the install command, then retry this tool:",
      ...installOptions.slice(1)
    ].join(`
`);
  }
  if (!context.capabilities.installDecisionTool) {
    return [
      ...header,
      ...installOptions,
      "",
      "ACTION REQUIRED — ASK THE USER whether to install this LSP server.",
      "Install-decision recording is unavailable in this harness; proceed without LSP if the user declines."
    ].join(`
`);
  }
  return [
    ...header,
    ...installOptions,
    "",
    "ACTION REQUIRED — ASK THE USER whether to install this LSP server.",
    "- If the user agrees: run the install command above, then retry this tool.",
    "- If the user declines, OR has NOT explicitly asked for LSP installation:",
    `    call lsp_install_decision { server_id: "${server2.id}", decision: "declined" },`,
    `    which writes to ${context.installDecisionsPath},`,
    "    then ignore this message and proceed WITHOUT LSP."
  ].join(`
`);
}
var READ_ONLY_TOOLS = new Set([
  "diagnostics",
  "definition",
  "references",
  "documentSymbols",
  "workspaceSymbols",
  "prepareRename"
]);
async function withLspClient(filePath, fn, toolName, options = {}) {
  const absPath = READ_ONLY_TOOLS.has(toolName) ? resolveReadablePathInsideContext(filePath) : resolvePathInsideContext(filePath);
  if (isDirectoryPath(absPath)) {
    throw new LspInvalidPathError("Directory paths are not supported by this LSP tool. " + "Use lsp.diagnostics with a directory path for directory diagnostics.");
  }
  const ext = effectiveExtension(absPath);
  const result = findServerForExtension(ext);
  if (result.status !== "found") {
    throw new LspServerLookupError(formatServerLookupError(result), result);
  }
  const server2 = result.server;
  const root = findWorkspaceRoot(absPath);
  const manager = options.manager ?? getLspManager();
  const acquireAndCall = async (allowRetry) => {
    const client = await manager.getClient(root, server2, options.signal);
    try {
      return await fn(client, root, absPath);
    } catch (err) {
      if (allowRetry && READ_ONLY_TOOLS.has(toolName) && isLspDeadConnectionError(err)) {
        manager.invalidateClient(root, server2.id, client);
        return acquireAndCall(false);
      }
      if (err instanceof LspRequestTimeoutError) {
        if (manager.isServerInitializing(root, server2.id)) {
          throw new LspServerInitializingError(err);
        }
      }
      throw err;
    } finally {
      manager.releaseClient(root, server2.id);
    }
  };
  return acquireAndCall(true);
}
var DIAGNOSTIC_SEVERITY_FILTERS = {
  error: 1,
  warning: 2,
  information: 3,
  hint: 4
};
function uriToPath(uri) {
  return fileURLToPath3(uri);
}
function formatLocation(loc) {
  if ("targetUri" in loc) {
    const uri2 = uriToPath(loc.targetUri);
    const line2 = loc.targetRange.start.line + 1;
    const char2 = loc.targetRange.start.character;
    return `${uri2}:${line2}:${char2}`;
  }
  const uri = uriToPath(loc.uri);
  const line = loc.range.start.line + 1;
  const char = loc.range.start.character;
  return `${uri}:${line}:${char}`;
}
function formatSymbolKind(kind) {
  return SYMBOL_KIND_MAP[kind] ?? `Unknown(${kind})`;
}
function formatSeverity(severity) {
  if (!severity)
    return "unknown";
  return SEVERITY_MAP[severity] ?? `unknown(${severity})`;
}
function formatDocumentSymbol(symbol, indent = 0) {
  const prefix = "  ".repeat(indent);
  const kind = formatSymbolKind(symbol.kind);
  const line = symbol.range.start.line + 1;
  let result = `${prefix}${symbol.name} (${kind}) - line ${line}`;
  if (symbol.children && symbol.children.length > 0) {
    for (const child of symbol.children) {
      result += `
${formatDocumentSymbol(child, indent + 1)}`;
    }
  }
  return result;
}
function formatSymbolInfo(symbol) {
  const kind = formatSymbolKind(symbol.kind);
  const loc = formatLocation(symbol.location);
  const container = symbol.containerName ? ` (in ${symbol.containerName})` : "";
  return `${symbol.name} (${kind})${container} - ${loc}`;
}
function formatDiagnostic(diag) {
  const severity = formatSeverity(diag.severity);
  const line = diag.range.start.line + 1;
  const char = diag.range.start.character;
  const source = diag.source ? `[${diag.source}]` : "";
  const code = diag.code ? ` (${diag.code})` : "";
  return `${severity}${source}${code} at ${line}:${char}: ${diag.message}`;
}
function filterDiagnosticsBySeverity(diagnostics, severityFilter) {
  if (!severityFilter || severityFilter === "all") {
    return diagnostics;
  }
  const targetSeverity = DIAGNOSTIC_SEVERITY_FILTERS[severityFilter];
  return diagnostics.filter((d) => d.severity === targetSeverity);
}
function formatPrepareRenameResult(result) {
  if (!result)
    return "Cannot rename at this position";
  if ("defaultBehavior" in result) {
    return result.defaultBehavior ? "Rename supported (using default behavior)" : "Cannot rename at this position";
  }
  if ("range" in result && result.range) {
    const startLine = result.range.start.line + 1;
    const startChar = result.range.start.character;
    const endLine = result.range.end.line + 1;
    const endChar = result.range.end.character;
    const placeholder = result.placeholder ? ` (current: "${result.placeholder}")` : "";
    return `Rename available at ${startLine}:${startChar}-${endLine}:${endChar}${placeholder}`;
  }
  if ("start" in result && "end" in result) {
    const startLine = result.start.line + 1;
    const startChar = result.start.character;
    const endLine = result.end.line + 1;
    const endChar = result.end.character;
    return `Rename available at ${startLine}:${startChar}-${endLine}:${endChar}`;
  }
  return "Cannot rename at this position";
}
function formatApplyResult(result) {
  const lines = [];
  if (result.success) {
    lines.push(`Applied ${result.totalEdits} edit(s) to ${result.filesModified.length} file(s):`);
    for (const file of result.filesModified) {
      lines.push(`  - ${file}`);
    }
    if (result.lateAbort) {
      lines.push("Cancellation arrived after the filesystem commit began; the committed edit completed.");
    }
  } else {
    lines.push("Failed to apply some changes:");
    for (const err of result.errors) {
      lines.push(`  Error: ${err}`);
    }
    if (result.filesModified.length > 0) {
      lines.push(`Successfully modified: ${result.filesModified.join(", ")}`);
    }
  }
  return lines.join(`
`);
}
var SKIP_DIRECTORIES = new Set(["node_modules", ".git", "dist", "build", ".next", "out"]);
var DIRECTORY_DIAGNOSTICS_MAX_CONCURRENCY = 4;
function collectFilesWithExtension(dir, extension, maxFiles) {
  const files = [];
  function walk(currentDir) {
    if (files.length >= maxFiles)
      return;
    let entries = [];
    try {
      entries = readdirSync3(currentDir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= maxFiles)
        return;
      const fullPath = join6(currentDir, entry);
      let stat;
      try {
        stat = lstatSync5(fullPath);
      } catch {
        continue;
      }
      if (!stat || stat.isSymbolicLink())
        continue;
      if (stat.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry)) {
          walk(fullPath);
        }
      } else if (stat.isFile() && effectiveExtension(fullPath) === extension) {
        files.push(fullPath);
      }
    }
  }
  walk(dir);
  return files;
}
async function aggregateDiagnosticsForDirectory(directory, extension, severity, maxFiles = DEFAULT_MAX_DIRECTORY_FILES, options = {}) {
  if (!extension.startsWith(".")) {
    throw new LspInvalidPathError(`Extension must start with a dot (e.g., ".ts", not "${extension}"). Use ".${extension}" instead.`);
  }
  const absDir = resolve9(options.workspaceRoot ?? contextCwd(), directory);
  if (!existsSync12(absDir)) {
    throw new LspInvalidPathError(`Directory does not exist: ${absDir}`);
  }
  const serverResult = options.server === undefined ? findServerForExtension(extension) : { status: "found", server: options.server };
  if (serverResult.status !== "found") {
    throw new LspServerLookupError(formatServerLookupError(serverResult));
  }
  const server2 = serverResult.server;
  const allFiles = (options.listFiles ?? collectFilesWithExtension)(absDir, extension, maxFiles + 1);
  const wasCapped = allFiles.length > maxFiles;
  const filesToProcess = allFiles.slice(0, maxFiles);
  if (filesToProcess.length === 0) {
    const output = [
      `Directory: ${absDir}`,
      `Extension: ${extension}`,
      "Files scanned: 0",
      `No files found with extension "${extension}".`
    ].join(`
`);
    return { output, totalDiagnostics: 0, fileFailures: [] };
  }
  const root = options.workspaceRoot ?? findWorkspaceRoot(absDir);
  const manager = options.manager ?? getLspManager();
  const allDiagnostics = [];
  const fileErrors = [];
  const maxConcurrency = Math.max(1, options.maxConcurrency ?? DIRECTORY_DIAGNOSTICS_MAX_CONCURRENCY);
  options.signal?.throwIfAborted();
  const client = await manager.getClient(root, server2, options.signal);
  try {
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(maxConcurrency, filesToProcess.length) }, async () => {
      for (;; ) {
        if (options.signal?.aborted)
          return;
        const file = filesToProcess[nextIndex];
        nextIndex += 1;
        if (file === undefined)
          return;
        try {
          const result = await client.diagnostics(file, options.signal);
          const filtered = filterDiagnosticsBySeverity(result.items, severity);
          allDiagnostics.push(...filtered.map((diagnostic) => ({
            filePath: file,
            diagnostic
          })));
        } catch (e) {
          fileErrors.push({
            file,
            error: e instanceof Error ? e.message : String(e)
          });
        }
      }
    });
    await Promise.all(workers);
  } finally {
    manager.releaseClient(root, server2.id);
  }
  const displayDiagnostics = allDiagnostics.slice(0, DEFAULT_MAX_DIAGNOSTICS);
  const wasDiagCapped = allDiagnostics.length > DEFAULT_MAX_DIAGNOSTICS;
  const lines = [
    `Directory: ${absDir}`,
    `Extension: ${extension}`,
    `Files scanned: ${filesToProcess.length}${wasCapped ? ` (capped at ${maxFiles})` : ""}`,
    `Files with errors: ${fileErrors.length}`,
    `Total diagnostics: ${allDiagnostics.length}`
  ];
  if (fileErrors.length > 0) {
    lines.push("", "File processing errors:");
    for (const { file, error } of fileErrors) {
      lines.push(`  ${file}: ${error}`);
    }
  }
  if (displayDiagnostics.length > 0) {
    lines.push("");
    for (const { filePath, diagnostic } of displayDiagnostics) {
      lines.push(`${filePath}: ${formatDiagnostic(diagnostic)}`);
    }
    if (wasDiagCapped) {
      lines.push("", `... (${allDiagnostics.length - DEFAULT_MAX_DIAGNOSTICS} more diagnostics not shown)`);
    }
  }
  return { output: lines.join(`
`), totalDiagnostics: allDiagnostics.length, fileFailures: fileErrors };
}
var SKIP_DIRECTORIES2 = new Set(["node_modules", ".git", "dist", "build", ".next", "out"]);
var MAX_SCAN_ENTRIES = 500;
function inferExtensionFromDirectory(directory) {
  const extensionCounts = new Map;
  let scanned = 0;
  function walk(dir) {
    if (scanned >= MAX_SCAN_ENTRIES)
      return;
    let entries;
    try {
      entries = readdirSync4(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (scanned >= MAX_SCAN_ENTRIES)
        return;
      const fullPath = join7(dir, entry);
      let stat;
      try {
        stat = lstatSync6(fullPath);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink())
        continue;
      scanned++;
      if (stat.isDirectory()) {
        if (!SKIP_DIRECTORIES2.has(entry)) {
          walk(fullPath);
        }
      } else if (stat.isFile()) {
        const ext = effectiveExtension(fullPath);
        if (ext && ext in EXT_TO_LANG) {
          extensionCounts.set(ext, (extensionCounts.get(ext) ?? 0) + 1);
        }
      }
    }
  }
  walk(directory);
  if (extensionCounts.size === 0)
    return null;
  let maxExt = "";
  let maxCount = 0;
  for (const [ext, count] of extensionCounts) {
    if (count > maxCount) {
      maxCount = count;
      maxExt = ext;
    }
  }
  return maxExt || null;
}
var RUST_SRC_REPAIR_MESSAGE = [
  "rust-analyzer exited while loading Rust standard library sources.",
  "",
  "Repair rust-src for the active toolchain:",
  "  rustup component remove rust-src",
  "  rustup component add rust-src"
];
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function formatKnownLspStartupFailure(error) {
  if (!(error instanceof LspProcessExitedError))
    return null;
  if (error.serverId !== "rust")
    return null;
  const details = error.stderrTail ?? error.message;
  const lowerDetails = details.toLowerCase();
  const isRustSrcFailure = lowerDetails.includes("rust-src") && (lowerDetails.includes("failed to install component") || lowerDetails.includes("detected conflict") || lowerDetails.includes("can't load standard library") || lowerDetails.includes("try installing") || lowerDetails.includes("sysroot"));
  if (!isRustSrcFailure)
    return null;
  return [...RUST_SRC_REPAIR_MESSAGE, "", "Original stderr tail:", details].join(`
`);
}
function handleMissingDependencyError(error) {
  const knownStartupFailure = formatKnownLspStartupFailure(error);
  if (knownStartupFailure)
    return knownStartupFailure;
  const message = errorMessage(error);
  return message.includes("NOT INSTALLED") || message.includes("No LSP server configured") ? message : null;
}
function missingDependencyResult(error, details) {
  const message = handleMissingDependencyError(error);
  if (!message)
    return null;
  return {
    content: [{ type: "text", text: message }],
    details: {
      ...details,
      error: message,
      errorKind: "missing_dependency",
      ...availabilityDetails(error)
    }
  };
}
function availabilityDetails(error) {
  const availability = missingDependencyAvailability(error);
  return availability === null ? {} : { availability };
}
function missingDependencyAvailability(error) {
  if (!(error instanceof LspServerLookupError) || error.lookup === undefined)
    return null;
  const context = lspRequestContext();
  switch (error.lookup.status) {
    case "not_configured":
      return {
        kind: "not_configured",
        extension: error.lookup.extension,
        availableServers: [...error.lookup.availableServers],
        projectConfigPaths: [...context.projectConfigPaths],
        userConfigPath: context.userConfigPath,
        installDecisionTool: context.capabilities.installDecisionTool
      };
    case "not_installed":
      return {
        kind: "not_installed",
        serverId: error.lookup.server.id,
        command: [...error.lookup.server.command],
        extensions: [...error.lookup.server.extensions],
        installHint: error.lookup.installHint,
        installDecisionTool: context.capabilities.installDecisionTool,
        installDecisionsPath: context.installDecisionsPath
      };
    default: {
      const exhaustive = error.lookup;
      return exhaustive;
    }
  }
}
function requireString(params, key) {
  const value = params[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required string parameter '${key}'`);
  }
  return value;
}
function optionalString(params, key) {
  const value = params[key];
  return typeof value === "string" ? value : undefined;
}
function requireNumber(params, key) {
  const value = params[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Missing required number parameter '${key}'`);
  }
  return value;
}
function optionalNumber(params, key) {
  const value = params[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function optionalBoolean(params, key) {
  const value = params[key];
  return typeof value === "boolean" ? value : undefined;
}
function severityFilter(params) {
  const value = params["severity"];
  if (value === "error" || value === "warning" || value === "information" || value === "hint" || value === "all") {
    return value;
  }
  return "all";
}
function clientOptions(signal) {
  return signal === undefined ? {} : { signal };
}
function text(text2, details, isError = false) {
  return { content: [{ type: "text", text: text2 }], details, isError };
}
function asDiagnosticArray(result) {
  if (!result)
    return [];
  if (Array.isArray(result))
    return result;
  return result.items ?? [];
}
async function executeLspDiagnostics(params, signal) {
  const filePath = requireString(params, "filePath");
  const severity = severityFilter(params);
  try {
    const absPath = resolveReadablePathInsideContext(filePath);
    if (isDirectoryPath(absPath)) {
      const extension = inferExtensionFromDirectory(absPath);
      if (!extension) {
        const message = `No supported source files found in directory: ${absPath}`;
        const details3 = {
          filePath,
          severity,
          mode: "directory",
          diagnostics: [],
          totalDiagnostics: 0,
          truncated: false,
          error: message,
          errorKind: "no_files"
        };
        return text(message, details3);
      }
      const output2 = await aggregateDiagnosticsForDirectory(absPath, extension, severity, undefined, signal === undefined ? {} : { signal });
      const details2 = {
        filePath,
        severity,
        mode: "directory",
        diagnostics: [],
        totalDiagnostics: output2.totalDiagnostics,
        truncated: false,
        fileFailures: [...output2.fileFailures]
      };
      return text(output2.output, details2);
    }
    const result = await withLspClient(filePath, async (client, _workspaceRoot, resolvedFilePath) => client.diagnostics(resolvedFilePath, signal), "diagnostics", clientOptions(signal));
    if (result.transientError) {
      const message = result.transientError.message;
      const details2 = {
        filePath,
        severity,
        mode: "file",
        diagnostics: [],
        totalDiagnostics: 0,
        truncated: false,
        error: message,
        errorKind: result.transientError.kind
      };
      return text(message, details2, true);
    }
    const diagnostics = filterDiagnosticsBySeverity(asDiagnosticArray(result), severity);
    const total = diagnostics.length;
    const truncated = total > DEFAULT_MAX_DIAGNOSTICS;
    const limited = truncated ? diagnostics.slice(0, DEFAULT_MAX_DIAGNOSTICS) : diagnostics;
    const output = total === 0 ? "No diagnostics found" : [
      ...truncated ? [`Found ${total} diagnostics (showing first ${DEFAULT_MAX_DIAGNOSTICS}):`] : [],
      ...limited.map(formatDiagnostic)
    ].join(`
`);
    const details = {
      filePath,
      severity,
      mode: "file",
      diagnostics: diagnostics.map((diagnostic) => ({ file: absPath, diagnostic })),
      totalDiagnostics: total,
      truncated
    };
    return text(output, details);
  } catch (error) {
    const missingDependency = missingDependencyResult(error, {
      filePath,
      severity,
      mode: "file",
      diagnostics: [],
      totalDiagnostics: 0,
      truncated: false
    });
    if (missingDependency)
      return missingDependency;
    throw error;
  }
}
var DEFAULT_FORMATTING_OPTIONS = {
  tabSize: 4,
  insertSpaces: false,
  trimTrailingWhitespace: true,
  insertFinalNewline: true,
  trimFinalNewlines: true
};
var UNCHANGED = { status: "unchanged", linesAdded: 0, linesRemoved: 0 };
async function formatDocumentWithClient(client, filePath, options = {}) {
  const edits = await client.formatDocument(filePath, options.formattingOptions ?? DEFAULT_FORMATTING_OPTIONS, options.signal);
  if (edits === null)
    return { status: "unavailable", reason: "capability_not_advertised" };
  if (edits.length === 0)
    return UNCHANGED;
  const before = readFileSync6(filePath, "utf-8");
  const normalized = normalizeTextEdits(before, edits, 0);
  if (normalized.text === before)
    return UNCHANGED;
  writeAtomically(filePath, normalized.text);
  await client.openFile(filePath);
  return {
    status: "formatted",
    ...lineDelta(normalized.edits)
  };
}
function lineDelta(edits) {
  let linesAdded = 0;
  let linesRemoved = 0;
  for (const edit of edits) {
    linesRemoved += edit.range.end.line - edit.range.start.line + 1;
    linesAdded += edit.newText.split(`
`).length;
  }
  return { linesAdded, linesRemoved };
}
function writeAtomically(filePath, content) {
  const tempPath = `${filePath}.omo-format.tmp`;
  writeFileSync3(tempPath, content, "utf-8");
  try {
    renameSync3(tempPath, filePath);
  } catch (error) {
    try {
      unlinkSync2(tempPath);
    } catch {}
    throw error;
  }
}
async function executeLspFormat(params, signal) {
  const filePath = requireString(params, "filePath");
  try {
    const result = await withLspClient(filePath, async (client, _workspaceRoot, resolvedFilePath) => formatDocumentWithClient(client, resolvedFilePath, signal === undefined ? {} : { signal }), "format", clientOptions(signal));
    return text(describeResult(filePath, result), formatDetails(filePath, result));
  } catch (error) {
    const missingDependency = missingDependencyResult(error, {
      filePath,
      status: "unavailable",
      reason: "server_unavailable",
      linesAdded: 0,
      linesRemoved: 0
    });
    if (missingDependency)
      return missingDependency;
    throw error;
  }
}
function formatDetails(filePath, result) {
  if (result.status === "unavailable") {
    return { filePath, status: "unavailable", reason: result.reason, linesAdded: 0, linesRemoved: 0 };
  }
  return {
    filePath,
    status: result.status,
    linesAdded: result.linesAdded,
    linesRemoved: result.linesRemoved
  };
}
function describeResult(filePath, result) {
  if (result.status === "unavailable") {
    return `Formatting unavailable for ${filePath}: the language server does not advertise documentFormattingProvider.`;
  }
  if (result.status === "unchanged") {
    return `Already formatted: ${filePath}`;
  }
  return `Formatted ${filePath} (+${result.linesAdded}/-${result.linesRemoved} lines)`;
}
async function executeLspInstallDecision(params) {
  const serverId = requireString(params, "server_id");
  const decision = params["decision"];
  if (!isInstallDecision(decision)) {
    return text(`Invalid decision '${String(decision)}'. Expected "declined" or "allowed".`, { serverId, errorKind: "invalid_decision" }, true);
  }
  const serverIds = [...new Set(getMergedServers().map((server2) => server2.id))];
  if (!serverIds.includes(serverId)) {
    const preview = serverIds.slice(0, 20).join(", ");
    return text(`Unknown LSP server '${serverId}'. Known servers: ${preview}${serverIds.length > 20 ? "..." : ""}`, { serverId, errorKind: "unknown_server" }, true);
  }
  recordInstallDecision(serverId, decision);
  return text(`Recorded install decision for '${serverId}': ${decision}. ${decisionFollowUp(decision)}`, {
    serverId,
    decision
  });
}
function decisionFollowUp(decision) {
  return decision === "declined" ? "Future LSP lookups for this server stay quiet; proceed without LSP." : "Future LSP lookups keep install instructions without asking the user.";
}
async function executeLspGotoDefinition(params, signal) {
  const filePath = requireString(params, "filePath");
  const line = requireNumber(params, "line");
  const character = requireNumber(params, "character");
  try {
    const result = await withLspClient(filePath, async (client, _workspaceRoot, resolvedFilePath) => client.definition(resolvedFilePath, line, character, signal), "definition", clientOptions(signal));
    const locations = !result ? [] : Array.isArray(result) ? result : [result];
    const details = { filePath, line, character, locations };
    if (locations.length === 0)
      return text("No definition found", details);
    return text(locations.map(formatLocation).join(`
`), details);
  } catch (error) {
    const missingDependency = missingDependencyResult(error, {
      filePath,
      line,
      character,
      locations: []
    });
    if (missingDependency)
      return missingDependency;
    throw error;
  }
}
async function executeLspFindReferences(params, signal) {
  const filePath = requireString(params, "filePath");
  const line = requireNumber(params, "line");
  const character = requireNumber(params, "character");
  const includeDeclaration = optionalBoolean(params, "includeDeclaration") ?? true;
  try {
    const result = await withLspClient(filePath, async (client, _workspaceRoot, resolvedFilePath) => client.references(resolvedFilePath, line, character, includeDeclaration, signal), "references", clientOptions(signal));
    const references = Array.isArray(result) ? result : [];
    const total = references.length;
    const truncated = total > DEFAULT_MAX_REFERENCES;
    const limited = truncated ? references.slice(0, DEFAULT_MAX_REFERENCES) : references;
    const details = {
      filePath,
      line,
      character,
      references,
      totalReferences: total,
      truncated
    };
    if (total === 0)
      return text("No references found", details);
    const output = [
      ...truncated ? [`Found ${total} references (showing first ${DEFAULT_MAX_REFERENCES}):`] : [],
      ...limited.map(formatLocation)
    ].join(`
`);
    return text(output, details);
  } catch (error) {
    const missingDependency = missingDependencyResult(error, {
      filePath,
      line,
      character,
      references: [],
      totalReferences: 0,
      truncated: false
    });
    if (missingDependency)
      return missingDependency;
    throw error;
  }
}
async function executeLspPrepareRename(params, signal) {
  const filePath = requireString(params, "filePath");
  const line = requireNumber(params, "line");
  const character = requireNumber(params, "character");
  try {
    const result = await withLspClient(filePath, async (client, _workspaceRoot, resolvedFilePath) => client.prepareRename(resolvedFilePath, line, character, signal), "prepareRename", clientOptions(signal));
    const details = { filePath, line, character, result };
    return text(formatPrepareRenameResult(result), details);
  } catch (error) {
    const missingDependency = missingDependencyResult(error, {
      filePath,
      line,
      character,
      result: null
    });
    if (missingDependency)
      return missingDependency;
    throw error;
  }
}
async function executeLspRename(params, signal) {
  const filePath = requireString(params, "filePath");
  const line = requireNumber(params, "line");
  const character = requireNumber(params, "character");
  const newName = requireString(params, "newName");
  try {
    const result = await withLspClient(filePath, async (client, _workspaceRoot, resolvedFilePath) => client.rename(resolvedFilePath, line, character, newName, signal), "rename", clientOptions(signal));
    const details = { filePath, line, character, newName, apply: result.apply, edit: result.edit };
    return text(formatApplyResult(result.apply), details, !result.apply.success);
  } catch (error) {
    const missingDependency = missingDependencyResult(error, {
      filePath,
      line,
      character,
      newName,
      apply: null,
      edit: null
    });
    if (missingDependency)
      return missingDependency;
    throw error;
  }
}
function objectSchema(properties, required = []) {
  return {
    type: "object",
    properties,
    required
  };
}
async function executeLspStatus() {
  const servers = getAllServers();
  const snapshots = getLspManager().getSnapshot();
  const installed = servers.filter((server2) => server2.installed && !server2.disabled);
  const configuredLines = servers.map((server2) => {
    const state = server2.disabled ? "disabled" : server2.installed ? "installed" : "missing";
    return `- ${server2.id}: ${state}; source=${server2.source}; extensions=${server2.extensions.join(", ")}`;
  });
  const activeLines = snapshots.map((snapshot) => {
    const state = snapshot.alive ? snapshot.isInitializing ? "initializing" : "alive" : "dead";
    return `- ${snapshot.serverId}: ${state}; root=${snapshot.root}; refs=${snapshot.refCount}`;
  });
  const lines = [
    `Configured LSP servers: ${servers.length}`,
    `Installed LSP servers: ${installed.length}`,
    "",
    ...configuredLines,
    "",
    `Active LSP clients: ${snapshots.length}`,
    ...activeLines
  ];
  return text(lines.join(`
`), { servers, snapshots });
}
function isDocumentSymbol(symbol) {
  return "range" in symbol;
}
async function executeLspSymbols(params, signal) {
  const filePath = requireString(params, "filePath");
  const rawScope = optionalString(params, "scope") ?? "document";
  const scope = rawScope === "workspace" ? "workspace" : "document";
  const limit = Math.min(optionalNumber(params, "limit") ?? DEFAULT_MAX_SYMBOLS, DEFAULT_MAX_SYMBOLS);
  try {
    if (scope === "workspace") {
      const query = optionalString(params, "query");
      if (!query) {
        const message = "Error: 'query' is required for workspace scope";
        return text(message, {
          filePath,
          scope,
          symbols: [],
          totalSymbols: 0,
          truncated: false,
          error: message,
          errorKind: "missing_query"
        });
      }
      const symbols2 = await withLspClient(filePath, async (client) => client.workspaceSymbols(query, signal), "workspaceSymbols", clientOptions(signal));
      return formatSymbolsResult(filePath, scope, symbols2, limit, query);
    }
    const symbols = await withLspClient(filePath, async (client, _workspaceRoot, resolvedFilePath) => client.documentSymbols(resolvedFilePath, signal), "documentSymbols", clientOptions(signal));
    return formatSymbolsResult(filePath, scope, symbols, limit);
  } catch (error) {
    const query = optionalString(params, "query");
    const missingDependency = missingDependencyResult(error, {
      filePath,
      scope,
      symbols: [],
      totalSymbols: 0,
      truncated: false,
      ...query === undefined ? {} : { query }
    });
    if (missingDependency)
      return missingDependency;
    throw error;
  }
}
function formatSymbolsResult(filePath, scope, symbols, limit, query) {
  const total = symbols.length;
  const truncated = total > limit;
  const limited = truncated ? symbols.slice(0, limit) : symbols;
  const details = {
    filePath,
    scope,
    symbols,
    totalSymbols: total,
    truncated,
    ...query === undefined ? {} : { query }
  };
  if (total === 0)
    return text("No symbols found", details);
  const lines = [];
  if (truncated)
    lines.push(`Found ${total} symbols (showing first ${limit}):`);
  const documentSymbols = limited.filter(isDocumentSymbol);
  if (documentSymbols.length === limited.length) {
    lines.push(...documentSymbols.map((symbol) => formatDocumentSymbol(symbol)));
  } else {
    lines.push(...limited.filter((symbol) => !isDocumentSymbol(symbol)).map(formatSymbolInfo));
  }
  return text(lines.join(`
`), details);
}
var LSP_MCP_TOOLS = [
  {
    name: "status",
    aliases: ["lsp_status"],
    title: "LSP Status",
    description: "List configured and active LSP servers without starting a new language server.",
    inputSchema: objectSchema({}),
    execute: executeLspStatus
  },
  {
    name: "diagnostics",
    aliases: ["lsp_diagnostics"],
    title: "LSP Diagnostics",
    description: "Get errors, warnings, and hints for a source file or directory.",
    inputSchema: objectSchema({
      filePath: { type: "string", description: "File or directory path to check." },
      severity: {
        type: "string",
        enum: ["error", "warning", "information", "hint", "all"],
        description: "Severity filter. Defaults to all."
      }
    }, ["filePath"]),
    execute: executeLspDiagnostics
  },
  {
    name: "goto_definition",
    aliases: ["lsp_goto_definition"],
    title: "LSP Goto Definition",
    description: "Find where a symbol is defined.",
    inputSchema: objectSchema({
      filePath: { type: "string", description: "Source file containing the symbol." },
      line: { type: "number", description: "1-based line number." },
      character: { type: "number", description: "0-based column." }
    }, ["filePath", "line", "character"]),
    execute: executeLspGotoDefinition
  },
  {
    name: "find_references",
    aliases: ["lsp_find_references"],
    title: "LSP Find References",
    description: "Find references of a symbol across the workspace.",
    inputSchema: objectSchema({
      filePath: { type: "string", description: "Source file containing the symbol." },
      line: { type: "number", description: "1-based line number." },
      character: { type: "number", description: "0-based column." },
      includeDeclaration: { type: "boolean", description: "Include the declaration. Defaults to true." }
    }, ["filePath", "line", "character"]),
    execute: executeLspFindReferences
  },
  {
    name: "symbols",
    aliases: ["lsp_symbols"],
    title: "LSP Symbols",
    description: "List document symbols or search workspace symbols.",
    inputSchema: objectSchema({
      filePath: { type: "string", description: "File path used as LSP context." },
      scope: {
        type: "string",
        enum: ["document", "workspace"],
        description: "Use document for file outline or workspace for project-wide search."
      },
      query: { type: "string", description: "Workspace symbol query." },
      limit: { type: "number", description: "Maximum number of symbols to return." }
    }, ["filePath", "scope"]),
    execute: executeLspSymbols
  },
  {
    name: "prepare_rename",
    aliases: ["lsp_prepare_rename"],
    title: "LSP Prepare Rename",
    description: "Check whether a symbol can be renamed at a position.",
    inputSchema: objectSchema({
      filePath: { type: "string", description: "Source file path." },
      line: { type: "number", description: "1-based line number." },
      character: { type: "number", description: "0-based column." }
    }, ["filePath", "line", "character"]),
    execute: executeLspPrepareRename
  },
  {
    name: "rename",
    aliases: ["lsp_rename"],
    title: "LSP Rename",
    description: "Rename a symbol across the workspace and apply the returned workspace edit.",
    inputSchema: objectSchema({
      filePath: { type: "string", description: "Source file path." },
      line: { type: "number", description: "1-based line number." },
      character: { type: "number", description: "0-based column." },
      newName: { type: "string", description: "New symbol name." }
    }, ["filePath", "line", "character", "newName"]),
    execute: executeLspRename
  },
  {
    name: "format",
    aliases: ["lsp_format"],
    title: "LSP Format",
    description: "Format a source file with its language server and write the returned edits to disk.",
    inputSchema: objectSchema({
      filePath: { type: "string", description: "Source file path to format." }
    }, ["filePath"]),
    execute: executeLspFormat
  },
  {
    name: "install_decision",
    aliases: ["lsp_install_decision"],
    title: "LSP Install Decision",
    description: "Record whether the user allowed or declined installing a missing LSP server. Record 'declined' when the user declines, or has not explicitly asked for LSP installation, to silence future prompts.",
    inputSchema: objectSchema({
      server_id: {
        type: "string",
        description: "The LSP server id from the not-installed message (e.g. 'rust')."
      },
      decision: {
        type: "string",
        enum: ["declined", "allowed"],
        description: "'declined' silences future prompts; 'allowed' pre-authorizes installation."
      }
    }, ["server_id", "decision"]),
    execute: executeLspInstallDecision
  }
];
var CONTEXT_KEY = "_context";
var DEFAULT_REQUEST_TIMEOUT_MS = 30000;
var nextProxyRequestId = 1;
async function callToolViaDaemon(name, args, options) {
  const context = requireContext(options.context);
  const paths = options.paths ?? daemonPaths();
  const ensure = options.ensure ?? ((ensurePaths, signal) => ensureDaemonRunning(ensurePaths, undefined, signal === undefined ? {} : { signal }));
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const requestArgs = withContext(args, context);
  let lastError;
  let authRefreshUsed = false;
  for (let attempt = 0;attempt < 3; attempt += 1) {
    try {
      await ensureDaemonAvailable(paths, ensure, options.signal);
      const token = readAuthToken(paths);
      if (!token)
        throw new DaemonRequestError("daemon auth token missing", false);
      const sendOptions = options.signal === undefined ? { timeoutMs } : { timeoutMs, signal: options.signal };
      return await sendToolCall(paths, token, name, requestArgs, sendOptions);
    } catch (error) {
      lastError = error;
      if (error instanceof DaemonAuthenticationRejectedError && !authRefreshUsed) {
        authRefreshUsed = true;
        continue;
      }
      if (error instanceof DaemonRequestCancelledError)
        break;
      if (error instanceof DaemonRequestError && (error.requestWritten || !isRetryableTool(name)))
        break;
    }
  }
  return daemonFailureResult(paths, lastError);
}
function callDiagnosticsViaDaemon(filePath, options) {
  return callToolViaDaemon("diagnostics", { filePath, severity: "error" }, options);
}
function requireContext(context) {
  if (!context)
    throw new DaemonRequestError("daemon tool context is required", false);
  return parseLspRequestContext(context);
}
function withContext(args, context) {
  return { ...args, [CONTEXT_KEY]: context };
}
function ensureDaemonAvailable(paths, ensure, signal) {
  if (!signal)
    return ensure(paths);
  return new Promise((resolve10, reject) => {
    let settled = false;
    const finish = (run) => {
      if (settled)
        return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      run();
    };
    const onAbort = () => finish(() => reject(new DaemonRequestCancelledError(false)));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve().then(() => ensure(paths, signal)).then(() => finish(() => resolve10()), (error) => finish(() => reject(signal.aborted ? new DaemonRequestCancelledError(false) : error)));
  });
}
function sendToolCall(paths, token, name, args, options) {
  return new Promise((resolve10, reject) => {
    const socket = connect(paths.socket);
    const requestId = allocateProxyRequestId();
    let settled = false;
    let requestWritten = false;
    let cancelAfterWrite = false;
    const cancelPayload = () => encodeJsonLine({
      jsonrpc: "2.0",
      method: "$/cancelRequest",
      params: { _omo: authEnvelope(token), id: requestId }
    });
    const finish = (run) => {
      if (settled)
        return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      destroyAfterCancel();
      run();
    };
    const sendCancel = () => {
      if (!requestWritten) {
        cancelAfterWrite = true;
        return;
      }
      if (!socket.writable)
        return;
      socket.write(cancelPayload());
    };
    const destroyAfterCancel = () => {
      socket.destroy();
    };
    const onAbort = () => {
      sendCancel();
      finish(() => reject(new DaemonRequestCancelledError(requestWritten)));
    };
    const timer = setTimeout(() => {
      sendCancel();
      finish(() => reject(new DaemonRequestTimedOutError(requestWritten, options.timeoutMs)));
    }, options.timeoutMs);
    timer.unref();
    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const decoder = createLineDecoder((message) => {
      if (isAuthErrorResponse(message)) {
        finish(() => reject(new DaemonAuthenticationRejectedError));
        return;
      }
      const result = toToolResult(message, requestId);
      if (result)
        finish(() => resolve10(result));
      else
        finish(() => reject(new DaemonRequestError("invalid daemon response", requestWritten)));
    });
    socket.once("connect", () => {
      const payload = encodeJsonLine({
        jsonrpc: "2.0",
        id: requestId,
        method: "tools/call",
        params: { _omo: authEnvelope(token), name, arguments: args }
      });
      socket.write(payload, () => {
        requestWritten = true;
        if (cancelAfterWrite && socket.writable)
          socket.write(cancelPayload());
      });
    });
    socket.on("data", (chunk) => decoder.push(chunk));
    socket.once("error", (error) => finish(() => reject(new DaemonRequestError(error.message, requestWritten))));
    socket.once("close", () => finish(() => reject(new DaemonRequestError("daemon connection closed", requestWritten))));
  });
}
function toToolResult(message, requestId) {
  if (!isPlainRecord(message) || message["id"] !== requestId)
    return null;
  const result = message["result"];
  if (!isPlainRecord(result) || !Array.isArray(result["content"]))
    return null;
  return {
    content: result["content"],
    isError: result["isError"] === true,
    details: result["details"]
  };
}
function allocateProxyRequestId() {
  const id = nextProxyRequestId;
  nextProxyRequestId += 1;
  if (nextProxyRequestId > Number.MAX_SAFE_INTEGER)
    nextProxyRequestId = 1;
  return id;
}
function isRetryableTool(name) {
  return name !== "rename" && name !== "lsp_rename";
}
var OMO_LSP_DAEMON_CLI2 = "OMO_LSP_DAEMON_CLI";
var OMO_LSP_DAEMON_VERSION2 = "OMO_LSP_DAEMON_VERSION";
var DAEMON_VERSION_PATTERN2 = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;

class InvalidRuntimeOverrideError2 extends Error {
  code = "invalid_runtime_override";
  reason;
  constructor(reason, message) {
    super(message);
    this.name = "InvalidRuntimeOverrideError";
    this.reason = reason;
  }
}
function validateDaemonVersion2(version) {
  if (!DAEMON_VERSION_PATTERN2.test(version)) {
    throw new Error("LSP daemon version must match [A-Za-z0-9][A-Za-z0-9._+-]{0,127}");
  }
  return version;
}
function resolveDaemonRuntime2(env, defaults) {
  const cliOverride = env[OMO_LSP_DAEMON_CLI2];
  const versionOverride = env[OMO_LSP_DAEMON_VERSION2];
  const hasCliOverride = cliOverride !== undefined;
  const hasVersionOverride = versionOverride !== undefined;
  if (hasCliOverride !== hasVersionOverride) {
    throw new InvalidRuntimeOverrideError2("paired_values_required", `${OMO_LSP_DAEMON_CLI2} and ${OMO_LSP_DAEMON_VERSION2} must be set together`);
  }
  if (!hasCliOverride || !hasVersionOverride) {
    if (!isAbsolute6(defaults.cliPath)) {
      throw new InvalidRuntimeOverrideError2("packaged_cli_must_be_absolute", "Packaged LSP daemon CLI path must be absolute");
    }
    return { cliPath: defaults.cliPath, version: validateDaemonVersion2(defaults.version) };
  }
  if (!isAbsolute6(cliOverride)) {
    throw new InvalidRuntimeOverrideError2("cli_must_be_absolute", `${OMO_LSP_DAEMON_CLI2} must be an absolute path to an existing regular file`);
  }
  const stat = statSync5(cliOverride, { throwIfNoEntry: false });
  if (!stat) {
    throw new InvalidRuntimeOverrideError2("cli_not_found", `${OMO_LSP_DAEMON_CLI2} points to a missing file`);
  }
  if (!stat.isFile()) {
    throw new InvalidRuntimeOverrideError2("cli_not_file", `${OMO_LSP_DAEMON_CLI2} must point to a regular file`);
  }
  return { cliPath: cliOverride, version: validateDaemonVersion2(versionOverride) };
}
function callDiagnosticsViaDaemon2(filePath, options) {
  return callDiagnosticsViaDaemon(filePath, options);
}

// ../../../../lsp-core/src/post-edit/orchestration.ts
import { extname as extname2 } from "node:path";
var DEFAULT_MAX_CONCURRENCY = 4;
var CLEAN_DIAGNOSTICS_TEXT = "No diagnostics found";
function createPostEditNotConfiguredCache() {
  return { notConfiguredExtensions: new Set };
}
async function collectPostEditDiagnostics(input) {
  const cache = input.cache === undefined ? createPostEditNotConfiguredCache() : input.cache;
  const filePaths = firstSeenDiagnosticTargets(input.filePaths, cache);
  const results = await runBoundedDiagnostics(filePaths, input.runDiagnostics, input.maxConcurrency);
  const blocks = [];
  const observations = [];
  for (const result of results) {
    const classification = classifyDiagnostics(result.outcome);
    switch (classification.kind) {
      case "clean":
        observations.push({ filePath: result.filePath, kind: "clean" });
        break;
      case "not_configured":
        cache.notConfiguredExtensions.add(classification.extension);
        observations.push({ filePath: result.filePath, kind: "not_configured" });
        break;
      case "block":
        blocks.push({ filePath: result.filePath, diagnostics: classification.diagnostics });
        observations.push({ filePath: result.filePath, kind: "block" });
        break;
      default: {
        const exhaustive = classification;
        return exhaustive;
      }
    }
  }
  return { blocks, observations };
}
function firstSeenDiagnosticTargets(filePaths, cache) {
  const seen = new Set;
  const targets = [];
  for (const filePath of filePaths) {
    if (filePath.length === 0 || seen.has(filePath))
      continue;
    seen.add(filePath);
    const extension = extensionKey(filePath);
    if (extension !== undefined && cache.notConfiguredExtensions.has(extension))
      continue;
    targets.push({ index: targets.length, filePath });
  }
  return targets;
}
async function runBoundedDiagnostics(filePaths, runDiagnostics, maxConcurrency) {
  const results = [];
  const workerCount = Math.min(Math.max(1, maxConcurrency ?? DEFAULT_MAX_CONCURRENCY), filePaths.length);
  let nextIndex = 0;
  async function worker() {
    for (;; ) {
      const target = filePaths[nextIndex];
      nextIndex += 1;
      if (target === undefined)
        return;
      results[target.index] = {
        index: target.index,
        filePath: target.filePath,
        outcome: await collectFileDiagnostics(target.filePath, runDiagnostics)
      };
    }
  }
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results.filter((result) => result !== undefined);
}
async function collectFileDiagnostics(filePath, runDiagnostics) {
  try {
    return normalizeDiagnosticsOutcome(await runDiagnostics(filePath));
  } catch (error) {
    if (error instanceof Error)
      return formatDiagnosticsError(error);
    return normalizeDiagnosticsText(String(error));
  }
}
function normalizeDiagnosticsOutcome(outcome) {
  if (typeof outcome === "string")
    return normalizeDiagnosticsText(outcome);
  return outcome;
}
function normalizeDiagnosticsText(text2) {
  return text2.trim();
}
function formatDiagnosticsError(error) {
  const message = normalizeDiagnosticsText(error.message);
  return message.length > 0 ? message : normalizeDiagnosticsText(String(error));
}
function classifyDiagnostics(outcome) {
  if (typeof outcome !== "string") {
    return { kind: "not_configured", extension: outcome.extension };
  }
  const diagnostics = outcome;
  if (diagnostics.length === 0 || diagnostics === CLEAN_DIAGNOSTICS_TEXT)
    return { kind: "clean" };
  return { kind: "block", diagnostics };
}
function extensionKey(filePath) {
  const extension = extname2(filePath).toLowerCase();
  return extension.length === 0 ? undefined : extension;
}
// ../../../../lsp-core/src/request-context.ts
import { AsyncLocalStorage as AsyncLocalStorage2 } from "node:async_hooks";
import { existsSync as existsSync13, realpathSync as realpathSync6, statSync as statSync6 } from "node:fs";
import { basename as basename4, delimiter as delimiter4, dirname as dirname2, isAbsolute as isAbsolute7, join as join8, relative as relative5, resolve as resolve10 } from "node:path";

class LspRequestContextParseError2 extends Error {
  code;
  name = "LspRequestContextParseError";
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
var storage2 = new AsyncLocalStorage2;
var CONTEXT_FIELDS2 = new Set(["cwd", "projectConfigPaths", "userConfigPath", "installDecisionsPath", "capabilities"]);
var CAPABILITY_FIELDS2 = new Set(["installDecisionTool"]);
function parseLspRequestContext2(value) {
  if (!isRecord7(value)) {
    throw new LspRequestContextParseError2("invalid_context", "LSP request context must be an object.");
  }
  rejectUnknownFields2(value, CONTEXT_FIELDS2, "context");
  const cwd = stringField2(value, "cwd");
  const projectConfigPaths = stringArrayField2(value, "projectConfigPaths");
  const userConfigPath = stringField2(value, "userConfigPath");
  const installDecisionsPath = stringField2(value, "installDecisionsPath");
  const capabilities = capabilitiesField2(value["capabilities"]);
  const canonical = canonicalCwd2(cwd);
  for (const path2 of projectConfigPaths) {
    requireAbsolutePath2(path2, "projectConfigPaths");
    const projectPath = canonicalizeExistingOrNearestAncestor2(path2);
    if (!isPathInside2(canonical, projectPath)) {
      throw new LspRequestContextParseError2("project_config_outside_cwd", `Project LSP config path must be inside cwd: ${path2}`);
    }
  }
  requireAbsolutePath2(userConfigPath, "userConfigPath");
  requireAbsolutePath2(installDecisionsPath, "installDecisionsPath");
  return {
    cwd: canonical,
    projectConfigPaths: projectConfigPaths.map((path2) => canonicalizeExistingOrNearestAncestor2(path2)),
    userConfigPath,
    installDecisionsPath,
    capabilities
  };
}
function canonicalCwd2(cwd) {
  const resolved = resolve10(cwd);
  if (!existsSync13(resolved) || !statSync6(resolved).isDirectory()) {
    throw new LspRequestContextParseError2("invalid_cwd", `LSP request cwd must be an existing directory: ${cwd}`);
  }
  return realpathSync6(resolved);
}
function canonicalizeExistingOrNearestAncestor2(path2) {
  let current = resolve10(path2);
  const suffix = [];
  while (true) {
    try {
      const existing = realpathSync6(current);
      return suffix.length === 0 ? existing : join8(existing, ...suffix);
    } catch (error) {
      if (!isMissingPathError2(error))
        throw error;
      const parent = dirname2(current);
      if (parent === current)
        throw error;
      suffix.unshift(basename4(current));
      current = parent;
    }
  }
}
function capabilitiesField2(value) {
  if (!isRecord7(value)) {
    throw new LspRequestContextParseError2("invalid_capabilities", "LSP request capabilities must be an object.");
  }
  rejectUnknownFields2(value, CAPABILITY_FIELDS2, "capabilities");
  const installDecisionTool = value["installDecisionTool"];
  if (typeof installDecisionTool !== "boolean") {
    throw new LspRequestContextParseError2("invalid_install_decision_capability", "LSP request capabilities.installDecisionTool must be a boolean.");
  }
  return { installDecisionTool };
}
function stringField2(value, field) {
  const fieldValue = value[field];
  if (typeof fieldValue !== "string" || fieldValue.length === 0) {
    throw new LspRequestContextParseError2("invalid_field", `LSP request context.${field} must be a non-empty string.`);
  }
  return fieldValue;
}
function stringArrayField2(value, field) {
  const fieldValue = value[field];
  if (!Array.isArray(fieldValue) || !fieldValue.every((item) => typeof item === "string" && item.length > 0)) {
    throw new LspRequestContextParseError2("invalid_field", `LSP request context.${field} must be a non-empty string array.`);
  }
  return fieldValue;
}
function requireAbsolutePath2(path2, field) {
  if (!isAbsolute7(path2)) {
    throw new LspRequestContextParseError2("relative_path", `LSP request context.${field} must be absolute: ${path2}`);
  }
}
function isPathInside2(parent, child) {
  const childPath = resolve10(child);
  const relativePath = relative5(parent, childPath);
  return relativePath === "" || !relativePath.startsWith("..") && !isAbsolute7(relativePath);
}
function isMissingPathError2(error) {
  const code = errorCode2(error);
  return code === "ENOENT" || code === "ENOTDIR";
}
function rejectUnknownFields2(value, allowed, scope) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new LspRequestContextParseError2("unknown_field", `Unknown LSP request ${scope} field: ${unknown.join(", ")}`);
  }
}
function isRecord7(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function errorCode2(error) {
  if (!error || typeof error !== "object" || !("code" in error))
    return;
  const code = Reflect.get(error, "code");
  return typeof code === "string" ? code : undefined;
}

// src/daemon-cli-path.ts
import { existsSync as existsSync15, readFileSync as readFileSync7 } from "node:fs";
import { createRequire as createRequire2 } from "node:module";
import { dirname as dirname11, join as join10 } from "node:path";
import { fileURLToPath as fileURLToPath4 } from "node:url";
var requireFromHere2 = createRequire2(import.meta.url);
var PACKAGE_LSP_DAEMON_CLI = "@code-yeongyu/lsp-daemon/cli";
function ensureLspDaemonCliEnv(env = process.env) {
  const runtime = resolveDaemonRuntime2(env, resolveLspDaemonCli());
  env[OMO_LSP_DAEMON_CLI2] = runtime.cliPath;
  env[OMO_LSP_DAEMON_VERSION2] = runtime.version;
}
function resolveLspDaemonCliPath(env = process.env) {
  const runtime = resolveDaemonRuntime2(env, resolveLspDaemonCli());
  if (env[OMO_LSP_DAEMON_CLI2] === undefined)
    env[OMO_LSP_DAEMON_CLI2] = runtime.cliPath;
  if (env[OMO_LSP_DAEMON_VERSION2] === undefined)
    env[OMO_LSP_DAEMON_VERSION2] = runtime.version;
  return runtime.cliPath;
}
function resolveLspDaemonCli() {
  const packageCli = resolvePackageLspDaemonCliPath();
  if (packageCli !== null)
    return resolveConfiguredLspDaemonCli(packageCli);
  const bundledCli = fileURLToPath4(new URL("../../lsp-daemon/dist/cli.js", import.meta.url));
  if (existsSync15(bundledCli))
    return resolveConfiguredLspDaemonCli(bundledCli);
  return resolveConfiguredLspDaemonCli(bundledCli);
}
function resolvePackageLspDaemonCliPath() {
  try {
    return requireFromHere2.resolve(PACKAGE_LSP_DAEMON_CLI);
  } catch (error) {
    if (!(error instanceof Error))
      throw error;
    return null;
  }
}
function resolveConfiguredLspDaemonCli(cliPath) {
  const version = readDaemonPackageVersion(cliPath);
  if (version === null) {
    throw new Error(`Unable to determine packaged LSP daemon version beside ${cliPath}`);
  }
  return {
    cliPath,
    version
  };
}
function readDaemonPackageVersion(cliPath) {
  try {
    const parsed = JSON.parse(readFileSync7(join10(dirname11(cliPath), "package.json"), "utf8"));
    if (isRecord9(parsed) && typeof parsed["version"] === "string" && parsed["version"].length > 0) {
      return parsed["version"];
    }
  } catch (error) {
    if (!(error instanceof Error))
      throw error;
  }
  return null;
}
function isRecord9(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/lsp-session-state.ts
import { mkdirSync as mkdirSync4, readFileSync as readFileSync9, writeFileSync as writeFileSync4 } from "node:fs";
import { homedir } from "node:os";
import { dirname as dirname13, join as join11 } from "node:path";
function sessionIdFrom(input) {
  return typeof input.session_id === "string" && input.session_id.length > 0 ? input.session_id : undefined;
}
function readLspPostEditCache(sessionId) {
  if (sessionId === undefined)
    return { notConfiguredExtensions: new Set };
  const state = readSessionState(sessionStatePath(sessionId));
  return { notConfiguredExtensions: new Set(state.notConfiguredExtensions) };
}
function writeLspPostEditCache(sessionId, cache) {
  if (sessionId === undefined)
    return;
  writeSessionState(sessionStatePath(sessionId), {
    notConfiguredExtensions: [...cache.notConfiguredExtensions].sort()
  });
}
function markLspSessionCompacted(sessionId) {
  if (sessionId === undefined)
    return;
  writeSessionState(sessionStatePath(sessionId), emptyState());
}
function isLspDaemonUnreachableDiagnostics(diagnostics) {
  return diagnostics.includes("LSP daemon unreachable");
}
function sessionStatePath(sessionId) {
  const root = process.env["PLUGIN_DATA"] ?? join11(homedir(), ".codex", "codex-lsp");
  return join11(root, "sessions", `${safePathSegment(sessionId)}.json`);
}
function readSessionState(path2) {
  try {
    const parsed = JSON.parse(readFileSync9(path2, "utf8"));
    if (isRecord10(parsed) && isLspSessionState(parsed))
      return normalizeSessionState(parsed);
    return emptyState();
  } catch (error) {
    if (error instanceof SyntaxError || isRecord10(error) && error["code"] === "ENOENT")
      return emptyState();
    throw error;
  }
}
function writeSessionState(path2, state) {
  mkdirSync4(dirname13(path2), { recursive: true });
  writeFileSync4(path2, `${JSON.stringify(state)}
`);
}
function emptyState() {
  return { notConfiguredExtensions: [] };
}
function safePathSegment(value) {
  return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "unknown-session";
}
function isLspSessionState(value) {
  const notConfiguredExtensions = value["notConfiguredExtensions"] ?? value["unavailableExtensions"];
  return Array.isArray(notConfiguredExtensions) && notConfiguredExtensions.every((item) => typeof item === "string");
}
function normalizeSessionState(value) {
  const notConfiguredExtensions = value["notConfiguredExtensions"] ?? value["unavailableExtensions"];
  return {
    notConfiguredExtensions: Array.isArray(notConfiguredExtensions) ? notConfiguredExtensions.filter((item) => typeof item === "string").sort() : []
  };
}
function isRecord10(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/mutated-file-paths.ts
var MUTATION_TOOL_NAMES = new Set(["apply_patch", "write", "edit", "multiedit", "multi_edit"]);
function extractMutatedFilePaths(input) {
  if (!isMutationTool(input.tool_name))
    return [];
  if (isFailedToolResponse(input.tool_response))
    return [];
  const toolInput = isRecord11(input.tool_input) ? input.tool_input : {};
  const paths = new Set;
  addStringValue(paths, toolInput["path"]);
  addStringValue(paths, toolInput["filePath"]);
  addStringValue(paths, toolInput["file_path"]);
  addStringArray(paths, toolInput["paths"]);
  addStringArray(paths, toolInput["filePaths"]);
  addStringArray(paths, toolInput["file_paths"]);
  addPatchPayloads(paths, toolInput);
  addPatchFiles(paths, toolInput["files"]);
  addPatchFiles(paths, toolInput["changes"]);
  return [...paths];
}
function isMutationTool(value) {
  if (typeof value !== "string")
    return false;
  return MUTATION_TOOL_NAMES.has(value.toLowerCase());
}
function isFailedToolResponse(value) {
  if (!isRecord11(value))
    return false;
  return value["isError"] === true || value["is_error"] === true || value["error"] === true || value["status"] === "error";
}
function addStringValue(paths, value) {
  if (typeof value === "string" && value.length > 0) {
    paths.add(value);
  }
}
function addStringArray(paths, value) {
  if (!Array.isArray(value))
    return;
  for (const item of value) {
    addStringValue(paths, item);
  }
}
function addPatchPayloads(paths, input) {
  addPatchInput(paths, input["input"]);
  addPatchInput(paths, input["patch"]);
  addPatchInput(paths, input["command"]);
}
function addPatchInput(paths, value) {
  if (typeof value !== "string")
    return;
  for (const line of value.split(`
`)) {
    const path2 = extractPatchHeaderPath(line);
    if (path2 !== undefined)
      paths.add(path2);
  }
}
function extractPatchHeaderPath(line) {
  const prefixes = ["*** Add File: ", "*** Update File: ", "*** Move to: "];
  for (const prefix of prefixes) {
    if (line.startsWith(prefix))
      return line.slice(prefix.length).trim();
  }
  return;
}
function addPatchFiles(paths, value) {
  if (!Array.isArray(value))
    return;
  for (const item of value) {
    if (!isRecord11(item))
      continue;
    addStringValue(paths, item["path"]);
    addStringValue(paths, item["filePath"]);
    addStringValue(paths, item["file_path"]);
    addStringValue(paths, item["movePath"]);
    addStringValue(paths, item["move_path"]);
  }
}
function isRecord11(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/codex-hook.ts
var DIAGNOSTIC_START_PATTERN = /(?:error|warning|information|hint)\[[^\]\r\n]+\] \(\d+\) at \d+:\d+:/g;
var DIAGNOSTIC_CHUNK_PATTERN = /^(?:error|warning|information|hint)\[[^\]\r\n]+\] \(\d+\) at \d+:\d+:/;
var DEFAULT_MAX_HOOK_FEEDBACK_CHARS = 8000;
var CONTEXT_PRESSURE_MAX_HOOK_FEEDBACK_CHARS = 1200;
var CONTEXT_PRESSURE_MARKERS = [
  "context compacted",
  "context_length_exceeded",
  "skill descriptions were shortened",
  "context_too_large",
  "codex ran out of room in the model's context window",
  "your input exceeds the context window",
  "long threads and multiple compactions"
];
async function runLspDiagnosticsText(filePath) {
  ensureLspDaemonCliEnv();
  const result = await callDiagnosticsViaDaemon2(filePath, { context: codexLspRequestContext() });
  return postEditOutcomeFromDaemonResult(result);
}
function postEditOutcomeFromDaemonResult(result) {
  const availability = notConfiguredAvailability(result.details);
  if (availability !== undefined)
    return { kind: "not_configured", extension: availability.extension };
  return result.content.map((block) => block.text).join(`
`);
}
function notConfiguredAvailability(details) {
  if (!isRecord12(details))
    return;
  const availability = details["availability"];
  if (!isRecord12(availability))
    return;
  if (availability["kind"] !== "not_configured")
    return;
  const extension = availability["extension"];
  return typeof extension === "string" && extension.length > 0 ? { extension } : undefined;
}
function codexLspRequestContext(env = process.env, cwd = process.cwd()) {
  const canonicalCwd3 = realpathSync8(resolve12(cwd));
  const codexHome = resolve12(env["CODEX_HOME"]?.trim() || join12(homedir3(), ".codex"));
  return parseLspRequestContext2({
    cwd: canonicalCwd3,
    projectConfigPaths: [join12(canonicalCwd3, ".codex", "lsp-client.json")],
    userConfigPath: join12(codexHome, "lsp-client.json"),
    installDecisionsPath: join12(codexHome, "lsp-install-decisions.json"),
    capabilities: { installDecisionTool: true }
  });
}
async function runLspPostToolUseHook(input, runDiagnostics = runLspDiagnosticsText) {
  const sessionId = sessionIdFrom(input);
  const filePaths = extractMutatedFilePaths(input);
  if (filePaths.length === 0)
    return "";
  const cache = readLspPostEditCache(sessionId);
  const result = await collectPostEditDiagnostics({ filePaths, runDiagnostics, cache });
  writeLspPostEditCache(sessionId, cache);
  const blocks = result.blocks.filter(({ diagnostics }) => !isLspDaemonUnreachableDiagnostics(diagnostics));
  if (blocks.length === 0)
    return "";
  const rawReason = blocks.map(formatDiagnosticBlock).join(`

`);
  const reason = limitHookText(rawReason, hookFeedbackLimit(input.transcript_path));
  const output = {
    decision: "block",
    reason,
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: reason
    }
  };
  return `${JSON.stringify(output)}
`;
}
async function runLspPostCompactHook(input) {
  markLspSessionCompacted(sessionIdFrom(input));
  return "";
}
function formatDiagnosticBlock({ filePath, diagnostics }) {
  return `LSP diagnostics after editing ${filePath}:

${formatDiagnosticsForDisplay(diagnostics)}`;
}
function formatDiagnosticsForDisplay(diagnostics) {
  const chunks = splitDiagnosticChunks(diagnostics);
  if (!chunks.some(isDiagnosticChunk))
    return chunks.join(`
`).trim();
  return chunks.map(formatDiagnosticChunk).join(`
`);
}
function splitDiagnosticChunks(diagnostics) {
  const normalized = diagnostics.replace(/\r\n/g, `
`).replace(/\r/g, `
`).trim();
  if (normalized.length === 0)
    return [];
  const matches = Array.from(normalized.matchAll(DIAGNOSTIC_START_PATTERN));
  const firstMatch = matches[0];
  if (firstMatch?.index === undefined)
    return [normalized];
  const chunks = [];
  const leadingText = normalized.slice(0, firstMatch.index).trim();
  if (leadingText.length > 0)
    chunks.push(leadingText);
  for (const [index, match] of matches.entries()) {
    if (match.index === undefined)
      continue;
    const nextMatch = matches[index + 1];
    const end = nextMatch?.index ?? normalized.length;
    const chunk = normalized.slice(match.index, end).trim();
    if (chunk.length > 0)
      chunks.push(chunk);
  }
  return chunks;
}
function formatDiagnosticChunk(chunk) {
  const lines = chunk.split(`
`);
  const firstLine = lines[0];
  if (firstLine === undefined)
    return "";
  if (!isDiagnosticChunk(firstLine))
    return chunk;
  const followingLines = lines.slice(1).map((line) => `  ${line}`);
  return [`- ${firstLine}`, ...followingLines].join(`
`);
}
function isDiagnosticChunk(chunk) {
  return DIAGNOSTIC_CHUNK_PATTERN.test(chunk);
}
function hookFeedbackLimit(transcriptPath) {
  return isContextPressureTranscript(transcriptPath) ? CONTEXT_PRESSURE_MAX_HOOK_FEEDBACK_CHARS : DEFAULT_MAX_HOOK_FEEDBACK_CHARS;
}
function isContextPressureTranscript(transcriptPath) {
  if (typeof transcriptPath !== "string")
    return false;
  try {
    return hasContextPressureMarker(readFileSync10(transcriptPath, "utf8"));
  } catch (error) {
    if (error instanceof Error)
      return false;
    throw error;
  }
}
function hasContextPressureMarker(text2) {
  const normalizedText = text2.toLowerCase();
  return CONTEXT_PRESSURE_MARKERS.some((marker) => normalizedText.includes(marker));
}
function limitHookText(text2, maxChars) {
  if (text2.length <= maxChars)
    return text2;
  const marker = `

[Truncated hook output to ${maxChars} chars to avoid Codex context overflow.]`;
  if (marker.length >= maxChars)
    return marker.slice(0, maxChars);
  const head = text2.slice(0, maxChars - marker.length).replace(/[ \t\r\n]+$/, "");
  return `${head}${marker}`;
}
function isRecord12(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/codex-hook-cli.ts
async function runPostToolUseHookCli(stdin = processStdin) {
  await runHookCli((input) => runLspPostToolUseHook(input), stdin);
}
async function runPostCompactHookCli(stdin = processStdin) {
  await runHookCli((input) => runLspPostCompactHook(input), stdin);
}
async function runHookCli(runHook, stdin) {
  try {
    const raw = await readStdin(stdin);
    if (!raw.trim())
      return;
    const parsed = JSON.parse(raw);
    const input = isRecord12(parsed) ? parsed : {};
    const output = await runHook(input);
    if (output)
      process.stdout.write(output);
  } catch {
    return;
  }
}
async function readStdin(stdin) {
  stdin.setEncoding("utf8");
  let raw = "";
  for await (const chunk of stdin) {
    raw += chunk;
  }
  return raw;
}

// src/cli.ts
async function main() {
  const [command = "mcp", subcommand = ""] = argv.slice(2);
  if (command === "hook" && subcommand === "post-tool-use") {
    await runPostToolUseHookCli();
    return;
  }
  if (command === "hook" && subcommand === "post-compact") {
    await runPostCompactHookCli();
    return;
  }
  if (command === "mcp") {
    await runPackageLspMcpCli();
    return;
  }
  stderr.write(`Usage: omo-lsp [mcp | hook post-tool-use | hook post-compact]
`);
  process.exitCode = 2;
}
main().catch((error) => {
  stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}
`);
  process.exitCode = 1;
});
async function runPackageLspMcpCli() {
  const cliPath = resolveLspDaemonCliPath();
  const child = spawn3(execPath2, [cliPath, "mcp"], { stdio: "inherit", windowsHide: true });
  await new Promise((resolve11, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code !== null && code !== 0)
        process.exitCode = code;
      if (code === null && signal !== null)
        process.exitCode = 1;
      resolve11();
    });
  });
}
