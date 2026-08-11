#!/usr/bin/env node

// src/cli.ts
import { argv, stderr } from "node:process";

// ../mcp-stdio-core/src/record.ts
function isPlainRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
// ../mcp-stdio-core/src/responses.ts
function successResponse(id, result) {
  return { jsonrpc: "2.0", id, result };
}
function errorResponse(id, code, message, data) {
  return { jsonrpc: "2.0", id, error: data === undefined ? { code, message } : { code, message, data } };
}
function jsonRpcId(value) {
  return typeof value === "string" || typeof value === "number" || value === null ? value : null;
}
function messageFromError(error) {
  return error instanceof Error ? error.message : String(error);
}
// ../mcp-stdio-core/src/transport.ts
var HEADER_SEPARATOR = Buffer.from(`\r
\r
`);
async function* readStdioJsonRpcMessages(input) {
  let buffer = Buffer.alloc(0);
  for await (const chunk of input) {
    buffer = Buffer.concat([buffer, bufferFromChunk(chunk)]);
    while (true) {
      const result = readNextMessage(buffer);
      if (result.kind === "incomplete")
        break;
      buffer = result.remaining;
      if (result.message)
        yield result.message;
    }
  }
  const trailing = buffer.toString("utf8").trim();
  if (trailing.length > 0) {
    yield parseJsonPayload(trailing, "line");
  }
}
async function writeStdioJsonRpcResponse(output, response, responseMode) {
  const body = JSON.stringify(response);
  const payload = responseMode === "framed" ? `Content-Length: ${Buffer.byteLength(body, "utf8")}\r
\r
${body}` : `${body}
`;
  await writeChunk(output, payload);
}
function writeChunk(output, chunk) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const onError = (error) => {
      if (settled)
        return;
      settled = true;
      reject(error);
    };
    output.once("error", onError);
    try {
      output.write(chunk, (error) => {
        if (settled)
          return;
        settled = true;
        if (error) {
          queueMicrotask(() => output.removeListener("error", onError));
          reject(error);
          return;
        }
        output.removeListener("error", onError);
        resolve();
      });
    } catch (error) {
      output.removeListener("error", onError);
      if (settled)
        return;
      settled = true;
      reject(error);
    }
  });
}
function readNextMessage(buffer) {
  if (buffer.length === 0)
    return { kind: "incomplete" };
  return startsWithContentLength(buffer) ? readFramedMessage(buffer) : readLineMessage(buffer);
}
function readLineMessage(buffer) {
  const newlineIndex = buffer.indexOf(10);
  if (newlineIndex === -1)
    return { kind: "incomplete" };
  const line = buffer.subarray(0, newlineIndex).toString("utf8").replace(/\r$/, "");
  if (line.trim().length === 0) {
    return { kind: "complete", remaining: buffer.subarray(newlineIndex + 1) };
  }
  return {
    kind: "complete",
    message: parseJsonPayload(line, "line"),
    remaining: buffer.subarray(newlineIndex + 1)
  };
}
function readFramedMessage(buffer) {
  const separatorIndex = buffer.indexOf(HEADER_SEPARATOR);
  if (separatorIndex === -1)
    return { kind: "incomplete" };
  const headers = buffer.subarray(0, separatorIndex).toString("ascii");
  const contentLength = parseContentLength(headers);
  const bodyStart = separatorIndex + HEADER_SEPARATOR.length;
  if (contentLength === undefined) {
    return {
      kind: "complete",
      message: {
        kind: "parse_error",
        message: "Missing or invalid Content-Length header",
        responseMode: "framed"
      },
      remaining: buffer.subarray(bodyStart)
    };
  }
  const bodyEnd = bodyStart + contentLength;
  if (buffer.length < bodyEnd)
    return { kind: "incomplete" };
  const body = buffer.subarray(bodyStart, bodyEnd).toString("utf8");
  return {
    kind: "complete",
    message: parseJsonPayload(body, "framed"),
    remaining: buffer.subarray(bodyEnd)
  };
}
function startsWithContentLength(buffer) {
  const prefix = buffer.subarray(0, "content-length:".length).toString("ascii").toLowerCase();
  return prefix === "content-length:";
}
function parseContentLength(headers) {
  for (const line of headers.split(`\r
`)) {
    const match = /^content-length:\s*(\d+)$/i.exec(line);
    if (match === null)
      continue;
    const value = match[1];
    if (value === undefined)
      return;
    return Number(value);
  }
  return;
}
function parseJsonPayload(payload, responseMode) {
  try {
    return { kind: "request", payload: JSON.parse(payload), responseMode };
  } catch (error) {
    return { kind: "parse_error", message: error instanceof Error ? error.message : String(error), responseMode };
  }
}
function bufferFromChunk(chunk) {
  if (Buffer.isBuffer(chunk))
    return chunk;
  if (typeof chunk === "string")
    return Buffer.from(chunk);
  throw new TypeError(`Unsupported stdio chunk type: ${typeof chunk}`);
}

// ../mcp-stdio-core/src/server.ts
var DEFAULT_IDLE_TIMEOUT_MS = 10 * 60000;
var DEFAULT_PARENT_POLL_INTERVAL_MS = 30000;
var noopLog = () => {};
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !hasErrorCode(error, "ESRCH");
  }
}
async function runJsonRpcStdioServer(config) {
  const log = config.log ?? noopLog;
  const idleTimeoutMs = config.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  let isClosed = false;
  const idleTimer = createIdleTimer(idleTimeoutMs, log, () => {
    isClosed = true;
    config.onIdleTimeout?.();
  });
  const watchdog = createParentWatchdog(config.parentWatchdog, (parentPid, pollIntervalMs) => {
    isClosed = true;
    log("parent_exit", { parent_pid: parentPid, poll_interval_ms: pollIntervalMs });
    config.onParentExit?.();
    config.input.destroy();
  });
  log("stdio_started", { cwd: process.cwd(), idle_timeout_ms: idleTimeoutMs });
  idleTimer.arm();
  try {
    for await (const message of readStdioJsonRpcMessages(config.input)) {
      if (isClosed)
        break;
      idleTimer.arm();
      if (message.kind === "parse_error") {
        if (!await handleParseError(message, config, log))
          break;
        continue;
      }
      if (!await handleRequest(message, config, log))
        break;
    }
  } catch (error) {
    if (!(isClosed && hasErrorCode(error, "ERR_STREAM_PREMATURE_CLOSE")))
      throw error;
  } finally {
    idleTimer.clear();
    watchdog.clear();
    log("stdio_stopped");
  }
}
async function handleParseError(message, config, log) {
  log("parse_error", { message: message.message });
  const response = config.parseErrorResponse?.(message.message) ?? errorResponse(null, -32700, "Parse error", message.message);
  if (response === undefined)
    return true;
  return writeResponse(response, {
    output: config.output,
    responseMode: message.responseMode,
    log
  });
}
async function handleRequest(message, config, log) {
  const parsed = message.payload;
  const id = isPlainRecord(parsed) ? jsonRpcId(parsed["id"]) : null;
  const method = isPlainRecord(parsed) && typeof parsed["method"] === "string" ? parsed["method"] : null;
  log("request", { id: id === null ? null : String(id), method });
  let response;
  try {
    response = await config.handler(parsed, config.handlerOptions);
  } catch (error) {
    if (config.onHandlerError === undefined)
      throw error;
    config.onHandlerError(error);
    return true;
  }
  if (response === undefined)
    return true;
  if (!await writeResponse(response, {
    output: config.output,
    responseMode: message.responseMode,
    log
  }))
    return false;
  log("response", { id: String(response.id), method, is_error: response.error !== undefined });
  return true;
}
async function writeResponse(response, context) {
  try {
    await writeStdioJsonRpcResponse(context.output, response, context.responseMode);
    return true;
  } catch (error) {
    if (!isTerminalOutputError(error))
      throw error;
    context.log("output_error", { message: messageFromError(error) });
    return false;
  }
}
function isTerminalOutputError(error) {
  if (!(error instanceof Error) || !("code" in error))
    return false;
  return error.code === "EPIPE" || error.code === "ERR_STREAM_DESTROYED" || error.code === "ERR_STREAM_WRITE_AFTER_END";
}
function hasErrorCode(error, code) {
  return error instanceof Error && "code" in error && error.code === code;
}
function createParentWatchdog(config, onDeadParent) {
  if (config === undefined)
    return { clear: () => {} };
  const pollIntervalMs = config.pollIntervalMs ?? DEFAULT_PARENT_POLL_INTERVAL_MS;
  if (pollIntervalMs <= 0)
    return { clear: () => {} };
  const parentPid = config.parentPid ?? process.ppid;
  const probeAlive = config.probeAlive ?? isProcessAlive;
  let fired = false;
  const timer = setInterval(() => {
    if (fired || probeAlive(parentPid))
      return;
    fired = true;
    onDeadParent(parentPid, pollIntervalMs);
  }, pollIntervalMs);
  timer.unref();
  return {
    clear: () => {
      clearInterval(timer);
    }
  };
}
function createIdleTimer(idleTimeoutMs, log, onTimeout) {
  let timer = null;
  return {
    arm: () => {
      if (timer !== null)
        clearTimeout(timer);
      if (idleTimeoutMs <= 0)
        return;
      timer = setTimeout(() => {
        log("idle_timeout", { idle_timeout_ms: idleTimeoutMs });
        onTimeout();
      }, idleTimeoutMs);
      timer.unref();
    },
    clear: () => {
      if (timer === null)
        return;
      clearTimeout(timer);
      timer = null;
    }
  };
}
// ../utils/src/runtime/which.ts
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
var runtime = globalThis;
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
    const resolvedPath = runtime.Bun?.which(candidateName) ?? null;
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

// ../utils/src/ast-grep/sg-candidates.ts
import { homedir } from "node:os";
import { join as join2 } from "node:path";

// ../utils/src/ast-grep/sg-manifest.ts
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
function sgBinaryName(platform = process.platform) {
  return normalizeRuntimePlatform(platform) === "win32" ? "sg.exe" : "sg";
}

// ../utils/src/ast-grep/install-script.ts
var AST_GREP_BIN_DIR_ENV_KEY = "OMO_AST_GREP_BIN_DIR";

// ../utils/src/ast-grep/types.ts
var SG_PATH_ENV_KEY = "OMO_AST_GREP_SG_PATH";
var SG_BINARY_NOT_FOUND = "BINARY_NOT_FOUND";

// ../utils/src/ast-grep/sg-candidates.ts
var HOMEBREW_PREFIXES = {
  darwin: ["/opt/homebrew/bin", "/usr/local/bin"],
  linux: ["/home/linuxbrew/.linuxbrew/bin", "/usr/local/bin"],
  win32: []
};
function nonEmptyValue(value) {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? null : trimmed;
}
function astGrepBinaryName(platform) {
  return platform === "win32" ? "ast-grep.exe" : "ast-grep";
}
function candidate(tier, path) {
  return { path, tier };
}
function envOverrideCandidates(env) {
  const override = nonEmptyValue(env[SG_PATH_ENV_KEY]);
  return override === null ? [] : [candidate("env-override", override)];
}
function omoRuntimeCandidates(options) {
  const binaryName = sgBinaryName(options.platform);
  const slug = runtimeSlug(options.platform, options.arch);
  const paths = [];
  if (options.runtimeDir !== undefined)
    paths.push(join2(options.runtimeDir, binaryName));
  const codexHome = nonEmptyValue(options.env["CODEX_HOME"]);
  if (codexHome !== null)
    paths.push(join2(codexHome, "runtime", "ast-grep", slug, binaryName));
  paths.push(join2(options.homeDir, ".omo", "runtime", "ast-grep", slug, binaryName));
  return paths.map((path) => candidate("omo-runtime", path));
}
function skillBinCandidates(options) {
  const names = [astGrepBinaryName(options.platform), sgBinaryName(options.platform)];
  const directories = [];
  const cacheDir = nonEmptyValue(options.env[AST_GREP_BIN_DIR_ENV_KEY]);
  if (cacheDir !== null)
    directories.push(cacheDir);
  if (options.packageDir !== undefined)
    directories.push(join2(options.packageDir, "bin"));
  return directories.flatMap((directory) => names.map((name) => candidate("skill-bin", join2(directory, name))));
}
function homebrewCandidates(platform) {
  const prefixes = platform === "darwin" || platform === "linux" || platform === "win32" ? HOMEBREW_PREFIXES[platform] : [];
  const names = [astGrepBinaryName(platform), sgBinaryName(platform)];
  return prefixes.flatMap((prefix) => names.map((name) => candidate("homebrew", join2(prefix, name))));
}
function planSgCandidates(options) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const homeDir = options.homeDir ?? homedir();
  return {
    afterPath: homebrewCandidates(platform),
    beforePath: [
      ...envOverrideCandidates(env),
      ...omoRuntimeCandidates({ arch, env, homeDir, platform, runtimeDir: options.runtimeDir }),
      ...skillBinCandidates({ env, packageDir: options.packageDir, platform })
    ],
    pathCommands: ["ast-grep", "sg"]
  };
}

// ../utils/src/ast-grep/sg-install-hints.ts
var OMO_PROVISION_HINT = "Start an OMO session so the bundled ast-grep skill provisions the pinned runtime automatically";
var ENV_OVERRIDE_HINT = `Or point ${SG_PATH_ENV_KEY} at an existing ast-grep binary`;
var DARWIN_HINTS = [
  "brew install ast-grep",
  "npm install -g @ast-grep/cli",
  "cargo install ast-grep --locked"
];
var LINUX_HINTS = [
  "npm install -g @ast-grep/cli",
  "cargo install ast-grep --locked",
  "brew install ast-grep  # linuxbrew"
];
var WIN32_HINTS = [
  "scoop install main/ast-grep",
  "winget install ast-grep",
  "choco install ast-grep",
  "npm install -g @ast-grep/cli"
];
function platformHints(platform) {
  if (platform === "darwin")
    return DARWIN_HINTS;
  if (platform === "win32")
    return WIN32_HINTS;
  return LINUX_HINTS;
}
function sgInstallHints(platform = process.platform) {
  return [...platformHints(platform), OMO_PROVISION_HINT, ENV_OVERRIDE_HINT];
}
function sgBinaryNotFoundMessage(platform = process.platform) {
  return `ast-grep binary not found for ${platform}: no candidate passed the --version probe across the env override, OMO runtime, skill bin cache, PATH, or Homebrew prefixes.`;
}

// ../utils/src/ast-grep/sg-resolver.ts
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
var SG_VERSION_PROBE_TIMEOUT_MS = 5000;
var cacheEntry = null;
function cacheFingerprint(options, plan) {
  return JSON.stringify([
    options.platform ?? process.platform,
    options.arch ?? process.arch,
    plan.beforePath.map((candidate2) => candidate2.path)
  ]);
}
function defaultFileExists(filePath) {
  if (!existsSync(filePath))
    return false;
  try {
    const stats = statSync(filePath);
    return stats.isFile() && stats.size > 0;
  } catch {
    return false;
  }
}
function defaultVersionProbe(binaryPath) {
  return String(execFileSync(binaryPath, ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: SG_VERSION_PROBE_TIMEOUT_MS
  }));
}
function probePasses(binaryPath, deps) {
  try {
    return deps.runVersionProbeSync(binaryPath).toLowerCase().includes("ast-grep");
  } catch {
    return false;
  }
}
function acceptsCandidate(binaryPath, deps) {
  return deps.fileExists(binaryPath) && probePasses(binaryPath, deps);
}
function firstAccepted(candidates, deps) {
  for (const candidate2 of candidates) {
    if (acceptsCandidate(candidate2.path, deps))
      return { found: true, path: candidate2.path, tier: candidate2.tier };
  }
  return null;
}
function pathCandidates(commands, deps) {
  const resolved = [];
  for (const commandName of commands) {
    const found = deps.which(commandName);
    if (found !== null)
      resolved.push({ path: found, tier: "path" });
  }
  return resolved;
}
function notFound(platform) {
  return {
    error: { code: SG_BINARY_NOT_FOUND, hints: sgInstallHints(platform), message: sgBinaryNotFoundMessage(platform) },
    found: false
  };
}
function cacheIsStillValid(resolution, deps, revalidate) {
  if (!resolution.found)
    return false;
  if (!deps.fileExists(resolution.path))
    return false;
  return !revalidate || probePasses(resolution.path, deps);
}
function resolverDeps(options) {
  return {
    fileExists: options.fileExists ?? defaultFileExists,
    platform: options.platform ?? process.platform,
    runVersionProbeSync: options.runVersionProbeSync ?? defaultVersionProbe,
    which: options.which ?? bunWhich
  };
}
function resolveSgBinarySync(options = {}) {
  const deps = resolverDeps(options);
  const useCache = options.cache ?? true;
  try {
    const plan = planSgCandidates(options);
    const fingerprint = cacheFingerprint(options, plan);
    if (useCache && cacheEntry !== null && cacheEntry.fingerprint === fingerprint) {
      if (cacheIsStillValid(cacheEntry.resolution, deps, options.revalidate ?? false))
        return cacheEntry.resolution;
      cacheEntry = null;
    }
    const resolution = firstAccepted(plan.beforePath, deps) ?? firstAccepted(pathCandidates(plan.pathCommands, deps), deps) ?? firstAccepted(plan.afterPath, deps) ?? notFound(deps.platform);
    if (useCache && resolution.found)
      cacheEntry = { fingerprint, resolution };
    return resolution;
  } catch {
    return notFound(deps.platform);
  }
}

// src/sg-runner.ts
import { spawn } from "node:child_process";
var MAX_JSON_RECORD_BYTES = 1024 * 1024;
var MAX_STDERR_BYTES = 64 * 1024;
var MAX_MCP_PAYLOAD_BYTES = 4 * 1024 * 1024;
var MAX_MATCHES = 500;
var DEFAULT_MATCHES = 50;
var DEFAULT_TIMEOUT_MS = 300000;
var MAX_TIMEOUT_MS = 300000;

class SgRunnerError extends Error {
  code;
  stderr;
  durationMs;
  constructor(code, message, stderr = "", durationMs = 0) {
    super(message);
    this.name = "SgRunnerError";
    this.code = code;
    this.stderr = stderr;
    this.durationMs = durationMs;
  }
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function truncateUtf8(value, maxBytes) {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= maxBytes)
    return value;
  let end = maxBytes;
  while (end > 0 && (bytes[end] & 192) === 128)
    end -= 1;
  return bytes.subarray(0, end).toString("utf8");
}
function decodeStderr(bytes) {
  let start = bytes.length - 1;
  while (start >= 0 && (bytes[start] & 192) === 128 && bytes.length - start <= 3)
    start -= 1;
  const lead = bytes[start];
  const width = lead >= 194 && lead <= 223 ? 2 : lead >= 224 && lead <= 239 ? 3 : lead >= 240 && lead <= 244 ? 4 : 1;
  const complete = start >= 0 && width > bytes.length - start ? bytes.subarray(0, start) : bytes;
  return truncateUtf8(new TextDecoder().decode(complete), MAX_STDERR_BYTES);
}
async function spawnSgRunner(input) {
  const startedAt = performance.now();
  if (input.signal?.aborted)
    throw new SgRunnerError("ABORTED", "ast-grep request was aborted");
  return await new Promise((resolve, reject) => {
    const maxMatches = input.maxMatches ?? DEFAULT_MATCHES;
    const child = spawn(input.sgPath, [...input.args], {
      cwd: input.workdir,
      env: input.env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const records = [];
    let serializedRecordsBytes = 2;
    const stderrChunks = [];
    let stderrBytes = 0;
    let stderrLinePrefix = "";
    let hasSgErrorDiagnostic = false;
    let pending = Buffer.alloc(0);
    let malformed = false;
    let fatalError = null;
    let stopReason = null;
    let truncationReason = null;
    let killTimer;
    let settled = false;
    const duration = () => Math.max(0, Math.round(performance.now() - startedAt));
    const stderrText = () => decodeStderr(Buffer.concat(stderrChunks));
    const stop = (reason) => {
      if (stopReason === null)
        stopReason = reason;
      if (child.exitCode !== null || child.signalCode !== null)
        return;
      if (process.platform === "win32") {
        child.kill();
        return;
      }
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null)
          child.kill("SIGKILL");
      }, 1000);
      killTimer.unref();
    };
    const failOutput = (code) => {
      fatalError ??= code;
      stop("limit");
    };
    const parseLine = (line) => {
      const value = line.length > 0 && line[line.length - 1] === 13 ? line.subarray(0, -1) : line;
      if (value.length === 0)
        return true;
      if (value.length > MAX_JSON_RECORD_BYTES) {
        failOutput("OUTPUT_TOO_LARGE");
        return false;
      }
      let text;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(value);
      } catch {
        failOutput("ENCODING_ERROR");
        return false;
      }
      try {
        const parsed = JSON.parse(text);
        if (!isRecord(parsed))
          throw new Error("record is not an object");
        const serializedBytes = Buffer.byteLength(JSON.stringify(parsed), "utf8");
        const nextAggregateBytes = serializedRecordsBytes + serializedBytes + (records.length > 0 ? 1 : 0);
        if (nextAggregateBytes > MAX_MCP_PAYLOAD_BYTES) {
          truncationReason = "output_cap";
          stop("limit");
          child.stdout.pause();
          return false;
        }
        records.push(parsed);
        serializedRecordsBytes = nextAggregateBytes;
        if (records.length > maxMatches) {
          records.length = maxMatches;
          truncationReason = "match_limit";
          stop("limit");
          child.stdout.pause();
          return false;
        }
      } catch {
        malformed = true;
      }
      return true;
    };
    const timeout = setTimeout(() => stop("timeout"), input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    timeout.unref();
    const onAbort = () => stop("abort");
    input.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk) => {
      if (stopReason === "limit")
        return;
      pending = Buffer.concat([pending, chunk]);
      let newline = pending.indexOf(10);
      while (newline >= 0) {
        const line = pending.subarray(0, newline);
        pending = pending.subarray(newline + 1);
        if (!parseLine(line))
          return;
        newline = pending.indexOf(10);
      }
      if (pending.length > MAX_JSON_RECORD_BYTES)
        failOutput("OUTPUT_TOO_LARGE");
    });
    child.stderr.on("data", (chunk) => {
      if (!hasSgErrorDiagnostic) {
        for (const byte of chunk) {
          if (byte === 10 || byte === 13) {
            stderrLinePrefix = "";
          } else if (stderrLinePrefix.length < 80) {
            stderrLinePrefix += String.fromCharCode(byte);
            if (/^[\t ]*(?:ERROR\b|error:)/.test(stderrLinePrefix))
              hasSgErrorDiagnostic = true;
          }
        }
      }
      const remaining = MAX_STDERR_BYTES - stderrBytes;
      if (remaining <= 0)
        return;
      const kept = chunk.subarray(0, remaining);
      stderrChunks.push(kept);
      stderrBytes += kept.length;
    });
    child.once("error", (error) => {
      if (settled)
        return;
      settled = true;
      clearTimeout(timeout);
      if (killTimer)
        clearTimeout(killTimer);
      input.signal?.removeEventListener("abort", onAbort);
      reject(new SgRunnerError("SG_FAILED", error.message, stderrText(), duration()));
    });
    child.once("close", (exitCode) => {
      if (settled)
        return;
      settled = true;
      clearTimeout(timeout);
      if (killTimer)
        clearTimeout(killTimer);
      input.signal?.removeEventListener("abort", onAbort);
      const stderr = stderrText();
      if (stopReason === "abort")
        return reject(new SgRunnerError("ABORTED", "ast-grep request was aborted", stderr, duration()));
      if (stopReason === "timeout")
        return reject(new SgRunnerError("TIMEOUT", "ast-grep request timed out", stderr, duration()));
      if (fatalError)
        return reject(new SgRunnerError(fatalError, "ast-grep output could not be read safely", stderr, duration()));
      if (stopReason !== "limit" && pending.length > 0)
        parseLine(pending);
      if (fatalError)
        return reject(new SgRunnerError(fatalError, "ast-grep output could not be read safely", stderr, duration()));
      const failedExit = exitCode !== 0 && exitCode !== 1;
      const diagnosedExitOne = exitCode === 1 && hasSgErrorDiagnostic;
      if (stopReason === null && (failedExit || diagnosedExitOne)) {
        return reject(new SgRunnerError("SG_FAILED", `ast-grep exited with code ${exitCode ?? "unknown"}`, stderr, duration()));
      }
      if (malformed && records.length === 0)
        return reject(new SgRunnerError("OUTPUT_PARSE_FAILED", "ast-grep produced no parseable JSON records", stderr, duration()));
      const limited = stopReason === "limit" && truncationReason !== null;
      const salvaged = malformed && records.length > 0;
      resolve({
        records,
        truncated: limited || salvaged,
        reason: limited ? truncationReason : salvaged ? "sg_output_truncated" : null,
        salvagedRecords: salvaged ? records.length : 0,
        stderr,
        durationMs: duration(),
        atLeastMatches: limited ? records.length + 1 : records.length,
        maxPayloadBytes: MAX_MCP_PAYLOAD_BYTES,
        exitCode
      });
    });
  });
}

// src/normalize.ts
import { posix, win32 } from "node:path";
function object(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new TypeError(`Invalid ${label}`);
  return value;
}
function number(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new TypeError(`Invalid ${label}`);
  return value;
}
function point(raw, byteOffset) {
  const value = object(raw, "range point");
  return {
    line: number(value.line, "line") + 1,
    column: number(value.column, "column"),
    byteOffset: number(byteOffset, "byte offset")
  };
}
function slash(value) {
  return value.replaceAll("\\", "/");
}
function isWindowsPath(value) {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}
function stablePath(file, workdir) {
  if (isWindowsPath(file) || isWindowsPath(workdir)) {
    const root2 = win32.resolve(workdir);
    const absolute2 = win32.resolve(root2, file);
    const relative2 = win32.relative(root2, absolute2);
    const inside2 = relative2 === "" || !relative2.startsWith("..\\") && relative2 !== ".." && !win32.isAbsolute(relative2);
    return slash(inside2 ? relative2 || "." : absolute2);
  }
  const root = posix.resolve(workdir);
  const absolute = posix.resolve(root, file);
  const relative = posix.relative(root, absolute);
  const inside = relative === "" || !relative.startsWith("../") && relative !== ".." && !posix.isAbsolute(relative);
  return inside ? relative || "." : absolute;
}
function nodeText(value) {
  if (typeof value === "string")
    return value;
  const node = object(value, "metavariable node");
  return typeof node.text === "string" ? node.text : "";
}
function nodeByteRange(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const range = object(value.range, "metavariable range");
  const bytes = object(range.byteOffset, "metavariable byte range");
  return typeof bytes.start === "number" && typeof bytes.end === "number" ? { start: bytes.start, end: bytes.end } : null;
}
function normalizeMetavariables(raw, text, matchStart) {
  const meta = raw === undefined ? {} : object(raw, "metaVariables");
  const singles = meta.single === undefined ? {} : object(meta.single, "single metavariables");
  const multis = meta.multi === undefined ? {} : object(meta.multi, "multi metavariables");
  const single = {};
  const multi = {};
  for (const [name, value] of Object.entries(singles))
    single[name] = nodeText(value);
  for (const [name, value] of Object.entries(multis)) {
    if (!Array.isArray(value) || value.length === 0) {
      multi[name] = "";
      continue;
    }
    const first = nodeByteRange(value[0]);
    const last = nodeByteRange(value[value.length - 1]);
    const bytes = Buffer.from(text, "utf8");
    const start = (first?.start ?? matchStart) - matchStart;
    const end = (last?.end ?? matchStart) - matchStart;
    multi[name] = start >= 0 && end >= start && end <= bytes.length ? new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(start, end)) : value.map(nodeText).join("");
  }
  return { single, multi };
}
function normalizeMatch(rawValue, workdir) {
  const raw = object(rawValue, "ast-grep record");
  const text = typeof raw.text === "string" ? raw.text : "";
  const file = typeof raw.file === "string" ? raw.file : "";
  const range = object(raw.range, "range");
  const bytes = object(range.byteOffset, "byte range");
  const startByte = number(bytes.start, "start byte offset");
  const normalized = {
    path: stablePath(file, workdir),
    ...typeof raw.language === "string" ? { language: raw.language.toLowerCase() } : {},
    text,
    range: {
      start: point(range.start, startByte),
      end: point(range.end, number(bytes.end, "end byte offset"))
    },
    metavariables: normalizeMetavariables(raw.metaVariables, text, startByte)
  };
  const consumed = new Set(["text", "range", "file", "lines", "language", "metaVariables", "charCount", "transformed"]);
  for (const [key, value] of Object.entries(raw))
    if (!consumed.has(key))
      normalized[key] = value;
  return normalized;
}
function normalizeRecords(records, workdir) {
  return records.map((record2) => normalizeMatch(record2, workdir)).sort((left, right) => {
    const pathOrder = left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
    return pathOrder || left.range.start.byteOffset - right.range.start.byteOffset;
  });
}

// src/pattern-hints.ts
var LANGUAGES = new Set([
  "bash",
  "c",
  "cpp",
  "csharp",
  "css",
  "elixir",
  "go",
  "haskell",
  "html",
  "java",
  "javascript",
  "json",
  "kotlin",
  "lua",
  "nix",
  "php",
  "python",
  "ruby",
  "rust",
  "scala",
  "solidity",
  "swift",
  "typescript",
  "tsx",
  "yaml"
]);
var LANG_ALIASES = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  py: "python",
  py3: "python",
  rb: "ruby",
  rs: "rust",
  kt: "kotlin",
  ex: "elixir",
  hs: "haskell",
  sh: "bash",
  zsh: "bash",
  cc: "cpp",
  "c++": "cpp",
  cxx: "cpp",
  cs: "csharp",
  yml: "yaml",
  sol: "solidity",
  golang: "go"
};
var RE_BACKSLASH = /\\w|\\d|\\s|\\b/;
var RE_DOT_STAR = /(?<!\$)\.\*|(?<!\$)\.\+/;
function isRegexCharClass(pattern) {
  const trimmed = pattern.trim();
  if (!/^\[\^?[^\]]+\]$/.test(trimmed))
    return false;
  const inner = trimmed.replace(/^\[\^?/, "").replace(/\]$/, "");
  if (inner.includes(","))
    return false;
  if (/[a-zA-Z0-9]-[a-zA-Z0-9]/.test(inner))
    return true;
  if (/^\[\^/.test(trimmed))
    return true;
  if (/[_. ]/.test(inner))
    return true;
  return false;
}
var RE_DOUBLE_DOLLAR = /(?<!\$)\$\$(?!\$)[A-Za-z_]/;
var RE_ANY_METAVAR = /(?<!\$)\$(?!\$)([A-Za-z_][A-Za-z0-9_]*)/g;
var RE_PY_TRAILING_COLON = /^\s*(?:def|class)\s+\$?\w+[^:]*:\s*$/m;
var RE_JS_INCOMPLETE = /^\s*(?:async\s+)?function\s+\$?\w+(?:\([^)]*\))?\s*$/m;
var RE_GO_INCOMPLETE = /^\s*func\s+\$?\w+(?:\([^)]*\))?\s*$/m;
var RE_RUST_INCOMPLETE = /^\s*fn\s+\$?\w+(?:\([^)]*\))?\s*$/m;
function normalizeLanguage(lang) {
  if (typeof lang !== "string")
    return null;
  const lower = lang.toLowerCase();
  const canonical = LANG_ALIASES[lower] ?? lower;
  return LANGUAGES.has(canonical) ? canonical : null;
}
function findAlternation(pattern) {
  const stripped = pattern.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, "");
  if (stripped.includes("||"))
    return false;
  return /(?:\w|\$\w+|\w+\(\))\s*\|\s*(?:\w|\$\w+|\w+\(\))/.test(stripped);
}
function isValidPaths(paths) {
  if (!Array.isArray(paths))
    return false;
  if (paths.length === 0)
    return false;
  return paths.every((p) => typeof p === "string" && p.length > 0);
}
function isValidLimit(limit) {
  return typeof limit === "number" && Number.isFinite(limit) && Number.isInteger(limit) && limit > 0;
}
function extractMetavars(text) {
  const single = new Set;
  const multi = new Set;
  const reMulti = /\$\$\$([A-Z][A-Z0-9_]*)/g;
  let m;
  while ((m = reMulti.exec(text)) !== null) {
    multi.add(m[1]);
  }
  const reSingle = /(?<!\$)\$(?!\$)([A-Z][A-Z0-9_]*)/g;
  while ((m = reSingle.exec(text)) !== null) {
    single.add(m[1]);
  }
  return { single, multi };
}
function validatePatternHints(pattern, language, opts = {}) {
  const force = opts.force ?? false;
  const hints = [];
  if (pattern.trim().length === 0) {
    hints.push({ code: "PATTERN_EMPTY", severity: "always-reject", message: "Pattern is empty." });
  }
  const canonical = normalizeLanguage(language);
  if (canonical === null) {
    hints.push({
      code: "LANGUAGE_UNSUPPORTED",
      severity: "always-reject",
      message: `Language '${language}' is not supported. Use one of the 25 ast-grep languages.`
    });
  }
  if (opts.paths !== undefined && !isValidPaths(opts.paths)) {
    hints.push({ code: "INVALID_PATH", severity: "always-reject", message: "Paths must be a non-empty array of non-empty strings." });
  }
  if (opts.limit !== undefined && !isValidLimit(opts.limit)) {
    hints.push({ code: "INVALID_LIMIT", severity: "always-reject", message: "Limit must be a positive finite integer." });
  }
  const alwaysReject = hints.find((h) => h.severity === "always-reject");
  if (alwaysReject) {
    return { ok: false, rejected: true, code: alwaysReject.code, hints };
  }
  if (RE_BACKSLASH.test(pattern)) {
    hints.push({
      code: "REGEX_BACKSLASH_ESCAPE",
      severity: "reject",
      message: "Backslash escapes (\\w, \\d, \\s, \\b) are regex, not ast-grep. Use $VAR for identifiers."
    });
  }
  if (RE_DOT_STAR.test(pattern)) {
    hints.push({
      code: "REGEX_DOT_STAR",
      severity: "reject",
      message: "'.*' and '.+' are regex wildcards. Use $$$ for multiple nodes or $VAR for one."
    });
  }
  if (isRegexCharClass(pattern)) {
    hints.push({
      code: "REGEX_CHAR_CLASS",
      severity: "reject",
      message: "Character classes like [a-z] are regex syntax. ast-grep has no AST equivalent."
    });
  }
  if (canonical === "python" && RE_PY_TRAILING_COLON.test(pattern)) {
    hints.push({
      code: "PATTERN_INCOMPLETE_FORM",
      severity: "reject",
      message: "Python pattern has trailing ':'. Drop the colon: 'def $FUNC($$$)' or 'class $C($$$)'."
    });
  }
  if ((canonical === "javascript" || canonical === "typescript" || canonical === "tsx") && RE_JS_INCOMPLETE.test(pattern)) {
    hints.push({
      code: "PATTERN_INCOMPLETE_FORM",
      severity: "reject",
      message: "JS/TS function pattern is incomplete. Add params and body: 'function $NAME($$$) { $$$ }'."
    });
  }
  if (canonical === "go" && RE_GO_INCOMPLETE.test(pattern)) {
    hints.push({
      code: "PATTERN_INCOMPLETE_FORM",
      severity: "reject",
      message: "Go function pattern is incomplete. Add params and body: 'func $NAME($$$) { $$$ }'."
    });
  }
  if (canonical === "rust" && RE_RUST_INCOMPLETE.test(pattern)) {
    hints.push({
      code: "PATTERN_INCOMPLETE_FORM",
      severity: "reject",
      message: "Rust fn pattern is incomplete. Add params and body: 'fn $NAME($$$) -> $RET { $$$ }'."
    });
  }
  if (RE_DOUBLE_DOLLAR.test(pattern)) {
    hints.push({
      code: "METAVAR_DOUBLE_DOLLAR",
      severity: "reject",
      message: "$$NAME is invalid. Use $$$NAME for multi-node capture or $NAME for single."
    });
  }
  let m;
  RE_ANY_METAVAR.lastIndex = 0;
  while ((m = RE_ANY_METAVAR.exec(pattern)) !== null) {
    const name = m[1];
    if (name === "_")
      continue;
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
      hints.push({
        code: "INVALID_METAVAR_NAME",
        severity: "reject",
        message: `Metavariable name $${name} must be UPPERCASE (e.g. $${name.toUpperCase()}) or use $_ for wildcard.`
      });
      break;
    }
  }
  if (findAlternation(pattern)) {
    hints.push({
      code: "BARE_ALTERNATION",
      severity: "warn",
      message: "Literal '|' may be a TS union or bitwise-or. If regex alternation, use separate calls."
    });
  }
  const hardReject = hints.find((h) => h.severity === "reject");
  if (hardReject && !force) {
    return { ok: false, rejected: true, code: "PATTERN_HINT_REJECTED", hints };
  }
  return { ok: true, rejected: false, code: null, hints };
}
function validateRewriteHints(pattern, rewrite, language, opts = {}) {
  const force = opts.force ?? false;
  const patternResult = validatePatternHints(pattern, language, opts);
  const hints = [...patternResult.hints];
  if (patternResult.rejected && patternResult.code !== "PATTERN_HINT_REJECTED") {
    return patternResult;
  }
  const pm = extractMetavars(pattern);
  const rm = extractMetavars(rewrite);
  const patternNames = new Set([...pm.single, ...pm.multi]);
  const rewriteNames = new Set([...rm.single, ...rm.multi]);
  for (const name of rewriteNames) {
    if (!patternNames.has(name)) {
      hints.push({
        code: "REWRITE_UNBOUND_METAVARIABLE",
        severity: "always-reject",
        message: `Rewrite uses metavariable $${name} not captured by pattern.`
      });
      break;
    }
  }
  for (const name of rewriteNames) {
    if (!patternNames.has(name))
      continue;
    const pSingle = pm.single.has(name);
    const pMulti = pm.multi.has(name);
    const rSingle = rm.single.has(name);
    const rMulti = rm.multi.has(name);
    if (pSingle && !pMulti && rMulti && !rSingle || pMulti && !pSingle && rSingle && !rMulti) {
      hints.push({
        code: "REWRITE_CARDINALITY_MISMATCH",
        severity: "always-reject",
        message: `Metavariable ${name} cardinality mismatch between pattern and rewrite.`
      });
      break;
    }
  }
  const alwaysReject = hints.find((h) => h.severity === "always-reject");
  if (alwaysReject) {
    return { ok: false, rejected: true, code: alwaysReject.code, hints };
  }
  if (patternResult.rejected && !force) {
    return { ok: false, rejected: true, code: "PATTERN_HINT_REJECTED", hints };
  }
  return { ok: true, rejected: false, code: null, hints };
}

// src/tools/search.ts
var MAX_PATTERN_BYTES = 16 * 1024;
var MAX_GLOBS = 32;
var MAX_PATHS = 64;
var MIN_TIMEOUT_MS = 1000;
var MAX_PATH_LEN = 4096;
var MAX_GLOB_LEN = 1024;
var MAX_SELECTOR_LEN = 128;
var MAX_WORKDIR_LEN = 4096;
var SEARCH_TOOL_NAME = "search";
var SEARCH_TOOL_DESCRIPTION = "Search code structurally with ast-grep. The pattern is code, not regex, and must parse as one AST node in the required language; use narrow paths. `$NAME` and `$_` match one whole node, while `$$$NAME` and `$$$` match zero-or-more nodes. Names are uppercase, `$$NAME` is invalid, partial-token captures do not work, and a repeated metavariable must match identical code. Wrap non-standalone syntax and use `selector` when needed. Parse warnings mean the query failed, not that the code is absent.";
var LANGUAGES2 = [
  "bash",
  "c",
  "cpp",
  "csharp",
  "css",
  "elixir",
  "go",
  "haskell",
  "html",
  "java",
  "javascript",
  "json",
  "kotlin",
  "lua",
  "nix",
  "php",
  "python",
  "ruby",
  "rust",
  "scala",
  "solidity",
  "swift",
  "typescript",
  "tsx",
  "yaml"
];
var STRICTNESS = ["cst", "smart", "ast", "relaxed", "signature"];
function codePoints(value) {
  let count = 0;
  for (const _ of value)
    count++;
  return count;
}
var searchInputSchema = {
  parse(input) {
    const result = parseSearchInput(input);
    if (!result.ok)
      throw new Error(result.error);
    return result.value;
  }
};
function parseSearchInput(input) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, error: "Input must be an object" };
  }
  const obj = input;
  if (typeof obj.pattern !== "string")
    return { ok: false, error: "pattern must be a string" };
  if (obj.pattern.length === 0)
    return { ok: false, error: "pattern must be at least 1 character" };
  if (Buffer.byteLength(obj.pattern, "utf8") > MAX_PATTERN_BYTES) {
    return { ok: false, error: "pattern must be at most 16384 bytes" };
  }
  if (typeof obj.language !== "string" || !LANGUAGES2.includes(obj.language)) {
    return { ok: false, error: `language must be one of: ${LANGUAGES2.join(", ")}` };
  }
  if (!Array.isArray(obj.paths))
    return { ok: false, error: "paths must be an array" };
  if (obj.paths.length < 1 || obj.paths.length > MAX_PATHS) {
    return { ok: false, error: `paths must have 1-${MAX_PATHS} entries` };
  }
  for (const p of obj.paths) {
    if (typeof p !== "string" || p.length === 0)
      return { ok: false, error: "each path must be a non-empty string" };
    if (codePoints(p) > MAX_PATH_LEN)
      return { ok: false, error: `each path must be at most ${MAX_PATH_LEN} characters` };
  }
  if (obj.workdir !== undefined) {
    if (typeof obj.workdir !== "string")
      return { ok: false, error: "workdir must be a string" };
    if (obj.workdir.length === 0)
      return { ok: false, error: "workdir must be at least 1 character" };
    if (codePoints(obj.workdir) > MAX_WORKDIR_LEN)
      return { ok: false, error: `workdir must be at most ${MAX_WORKDIR_LEN} characters` };
  }
  if (obj.globs !== undefined) {
    if (!Array.isArray(obj.globs))
      return { ok: false, error: "globs must be an array" };
    if (obj.globs.length > MAX_GLOBS)
      return { ok: false, error: `globs must have at most ${MAX_GLOBS} entries` };
    for (const g of obj.globs) {
      if (typeof g !== "string" || g.length === 0)
        return { ok: false, error: "each glob must be a non-empty string" };
      if (codePoints(g) > MAX_GLOB_LEN)
        return { ok: false, error: `each glob must be at most ${MAX_GLOB_LEN} characters` };
    }
  }
  if (obj.selector !== undefined) {
    if (typeof obj.selector !== "string")
      return { ok: false, error: "selector must be a string" };
    if (obj.selector.length === 0)
      return { ok: false, error: "selector must be at least 1 character" };
    if (codePoints(obj.selector) > MAX_SELECTOR_LEN)
      return { ok: false, error: `selector must be at most ${MAX_SELECTOR_LEN} characters` };
  }
  let strictness = "smart";
  if (obj.strictness !== undefined) {
    if (typeof obj.strictness !== "string" || !STRICTNESS.includes(obj.strictness)) {
      return { ok: false, error: `strictness must be one of: ${STRICTNESS.join(", ")}` };
    }
    strictness = obj.strictness;
  }
  let maxMatches = DEFAULT_MATCHES;
  if (obj.maxMatches !== undefined) {
    if (typeof obj.maxMatches !== "number" || !Number.isInteger(obj.maxMatches) || obj.maxMatches < 1 || obj.maxMatches > MAX_MATCHES) {
      return { ok: false, error: `maxMatches must be an integer between 1 and ${MAX_MATCHES}` };
    }
    maxMatches = obj.maxMatches;
  }
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (obj.timeoutMs !== undefined) {
    if (typeof obj.timeoutMs !== "number" || !Number.isInteger(obj.timeoutMs) || obj.timeoutMs < MIN_TIMEOUT_MS || obj.timeoutMs > MAX_TIMEOUT_MS) {
      return { ok: false, error: `timeoutMs must be an integer between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}` };
    }
    timeoutMs = obj.timeoutMs;
  }
  if (obj.includeHidden !== undefined && typeof obj.includeHidden !== "boolean") {
    return { ok: false, error: "includeHidden must be a boolean" };
  }
  if (obj.followSymlinks !== undefined && typeof obj.followSymlinks !== "boolean") {
    return { ok: false, error: "followSymlinks must be a boolean" };
  }
  if (obj.force !== undefined && typeof obj.force !== "boolean") {
    return { ok: false, error: "force must be a boolean" };
  }
  const known = new Set([
    "pattern",
    "language",
    "paths",
    "workdir",
    "globs",
    "selector",
    "strictness",
    "maxMatches",
    "timeoutMs",
    "includeHidden",
    "followSymlinks",
    "force"
  ]);
  for (const key of Object.keys(obj)) {
    if (!known.has(key))
      return { ok: false, error: `Unknown property: ${key}` };
  }
  return {
    ok: true,
    value: {
      pattern: obj.pattern,
      language: obj.language,
      paths: obj.paths,
      workdir: obj.workdir,
      globs: obj.globs,
      selector: obj.selector,
      strictness,
      maxMatches,
      timeoutMs,
      includeHidden: obj.includeHidden,
      followSymlinks: obj.followSymlinks,
      force: obj.force
    }
  };
}
function buildSearchArgs(input) {
  const args = ["run", "-p", input.pattern, "--lang", input.language, "--json=stream"];
  args.push("--strictness", input.strictness ?? "smart");
  if (input.selector)
    args.push("--selector", input.selector);
  if (input.globs)
    for (const glob of input.globs)
      args.push("--globs", glob);
  if (input.includeHidden)
    args.push("--no-ignore", "hidden");
  if (input.followSymlinks)
    args.push("--follow");
  args.push(...input.paths);
  return args;
}
var RETRYABLE_CODES = new Set([
  "TIMEOUT",
  "ABORTED",
  "OUTPUT_PARSE_FAILED",
  "REWRITE_STALE_PREVIEW"
]);
var ERROR_NODE_RE = /Pattern contains an ERROR node/i;
function detectPatternParseFailure(stderr) {
  return ERROR_NODE_RE.test(stderr);
}
function makeError(code, message, language, phase, stderr, hint, durationMs) {
  return {
    schemaVersion: 1,
    ok: false,
    error: {
      code,
      message,
      retryable: RETRYABLE_CODES.has(code),
      phase,
      language,
      details: { stderr, hint }
    }
  };
}
var LIMIT_WARNING = "Result limit reached; narrow paths or globs.";
async function executeSearch(input, sgPath, signal) {
  const startedAt = performance.now();
  const workdir = input.workdir ?? process.cwd();
  const maxMatches = input.maxMatches ?? DEFAULT_MATCHES;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const validation = validatePatternHints(input.pattern, input.language, {
    force: input.force,
    paths: input.paths,
    limit: maxMatches
  });
  if (validation.rejected) {
    const rejectHint = validation.hints.find((h) => h.severity === "always-reject" || h.severity === "reject");
    return makeError(validation.code ?? "INVALID_ARGUMENT", rejectHint?.message ?? "Pattern validation failed", input.language, "preflight", "", validation.hints.map((h) => h.message).join("; "), Math.round(performance.now() - startedAt));
  }
  const args = buildSearchArgs(input);
  let runnerResult;
  try {
    runnerResult = await spawnSgRunner({
      sgPath,
      args,
      workdir,
      maxMatches,
      timeoutMs,
      signal
    });
  } catch (error) {
    if (error instanceof SgRunnerError) {
      return makeError(error.code, error.message, input.language, "search", error.stderr, "", error.durationMs);
    }
    return makeError("SG_FAILED", error instanceof Error ? error.message : String(error), input.language, "search", "", "", Math.round(performance.now() - startedAt));
  }
  if (detectPatternParseFailure(runnerResult.stderr)) {
    return makeError("PATTERN_PARSE_FAILED", "Pattern did not parse as one " + input.language + " AST node.", input.language, "search", runnerResult.stderr, "Use a complete function, call, declaration, or wrapped context.", runnerResult.durationMs);
  }
  const warnings = validation.hints.map((h) => h.message);
  const matches = normalizeRecords(runnerResult.records, workdir);
  const fileSet = new Set(matches.map((m) => m.path));
  const returnedFiles = fileSet.size;
  const truncated = runnerResult.truncated;
  const reason = runnerResult.reason;
  const totalMatches = truncated ? null : matches.length;
  const totalFiles = truncated ? null : returnedFiles;
  if (truncated) {
    warnings.push(LIMIT_WARNING);
  }
  return {
    schemaVersion: 1,
    ok: true,
    kind: "search",
    workdir,
    matches,
    counts: {
      returnedMatches: matches.length,
      returnedFiles,
      totalMatches,
      totalFiles,
      atLeastMatches: runnerResult.atLeastMatches
    },
    truncation: {
      truncated,
      reason,
      maxMatches,
      maxPayloadBytes: runnerResult.maxPayloadBytes,
      salvagedRecords: runnerResult.salvagedRecords
    },
    warnings,
    durationMs: runnerResult.durationMs
  };
}

// src/tools/rewrite.ts
var MAX_PATTERN_BYTES2 = 16 * 1024;
var MAX_REWRITE_BYTES = 64 * 1024;
var MAX_PATHS2 = 64;
var MAX_PATH_CHARS = 4096;
var MAX_GLOBS2 = 32;
var MAX_GLOB_CHARS = 1024;
var MAX_SELECTOR_CHARS = 128;
var MAX_WORKDIR_CHARS = 4096;
var MIN_TIMEOUT_MS2 = 1000;
var REWRITE_TOOL_NAME = "rewrite";
var REWRITE_TOOL_DESCRIPTION = "Preview or apply an AST-aware rewrite. The pattern follows the same metavariable rules as `search`; the replacement may only reference metavariables captured by the pattern, and an empty replacement deletes the match. Dry-run is the default. Apply uses a JSON preview followed by a separate `--update-all` process because `sg` cannot safely combine JSON output and mutation. Truncated previews are never applied, and rewrite idempotency is not guaranteed.";
var APPLY_PREVIEW_WARNING = "Mutation counts are based on the preview pass; sg update-all does not return equivalent JSON.";
var LANGUAGES3 = [
  "bash",
  "c",
  "cpp",
  "csharp",
  "css",
  "elixir",
  "go",
  "haskell",
  "html",
  "java",
  "javascript",
  "json",
  "kotlin",
  "lua",
  "nix",
  "php",
  "python",
  "ruby",
  "rust",
  "scala",
  "solidity",
  "swift",
  "typescript",
  "tsx",
  "yaml"
];
var STRICTNESS2 = ["cst", "smart", "ast", "relaxed", "signature"];
function codePointLength(value) {
  return [...value].length;
}
var KNOWN_KEYS = new Set([
  "pattern",
  "rewrite",
  "language",
  "paths",
  "workdir",
  "globs",
  "selector",
  "strictness",
  "apply",
  "maxMatches",
  "timeoutMs",
  "includeHidden",
  "followSymlinks",
  "force"
]);
function parseRewriteInput(input) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Input must be an object");
  }
  const obj = input;
  for (const key of Object.keys(obj)) {
    if (!KNOWN_KEYS.has(key))
      throw new Error(`Unknown property: ${key}`);
  }
  if (typeof obj.pattern !== "string" || obj.pattern.length === 0)
    throw new Error("pattern must be a non-empty string");
  if (Buffer.byteLength(obj.pattern, "utf8") > MAX_PATTERN_BYTES2)
    throw new Error("pattern must be at most 16KiB");
  if (typeof obj.rewrite !== "string")
    throw new Error("rewrite must be a string");
  if (Buffer.byteLength(obj.rewrite, "utf8") > MAX_REWRITE_BYTES)
    throw new Error("rewrite must be at most 64KiB");
  if (typeof obj.language !== "string" || !LANGUAGES3.includes(obj.language)) {
    throw new Error(`language must be one of: ${LANGUAGES3.join(", ")}`);
  }
  if (!Array.isArray(obj.paths))
    throw new Error("paths must be an array");
  if (obj.paths.length < 1 || obj.paths.length > MAX_PATHS2)
    throw new Error(`paths must have 1-${MAX_PATHS2} entries`);
  for (const path of obj.paths) {
    if (typeof path !== "string" || path.length === 0)
      throw new Error("each path must be a non-empty string");
    if (codePointLength(path) > MAX_PATH_CHARS) {
      throw new Error(`each path must be at most ${MAX_PATH_CHARS} characters`);
    }
  }
  if (obj.workdir !== undefined) {
    if (typeof obj.workdir !== "string" || obj.workdir.length === 0) {
      throw new Error("workdir must be a non-empty string");
    }
    if (codePointLength(obj.workdir) > MAX_WORKDIR_CHARS) {
      throw new Error(`workdir must be at most ${MAX_WORKDIR_CHARS} characters`);
    }
  }
  if (obj.globs !== undefined) {
    if (!Array.isArray(obj.globs))
      throw new Error("globs must be an array");
    if (obj.globs.length > MAX_GLOBS2)
      throw new Error(`globs must have at most ${MAX_GLOBS2} entries`);
    for (const glob of obj.globs) {
      if (typeof glob !== "string" || glob.length === 0)
        throw new Error("each glob must be a non-empty string");
      if (codePointLength(glob) > MAX_GLOB_CHARS) {
        throw new Error(`each glob must be at most ${MAX_GLOB_CHARS} characters`);
      }
    }
  }
  if (obj.selector !== undefined) {
    if (typeof obj.selector !== "string" || obj.selector.length === 0) {
      throw new Error("selector must be a non-empty string");
    }
    if (codePointLength(obj.selector) > MAX_SELECTOR_CHARS) {
      throw new Error(`selector must be at most ${MAX_SELECTOR_CHARS} characters`);
    }
  }
  let strictness = "smart";
  if (obj.strictness !== undefined) {
    if (typeof obj.strictness !== "string" || !STRICTNESS2.includes(obj.strictness)) {
      throw new Error(`strictness must be one of: ${STRICTNESS2.join(", ")}`);
    }
    strictness = obj.strictness;
  }
  if (obj.apply !== undefined && typeof obj.apply !== "boolean")
    throw new Error("apply must be a boolean");
  let maxMatches = DEFAULT_MATCHES;
  if (obj.maxMatches !== undefined) {
    if (typeof obj.maxMatches !== "number" || !Number.isInteger(obj.maxMatches) || obj.maxMatches < 1 || obj.maxMatches > MAX_MATCHES) {
      throw new Error(`maxMatches must be an integer between 1 and ${MAX_MATCHES}`);
    }
    maxMatches = obj.maxMatches;
  }
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (obj.timeoutMs !== undefined) {
    if (typeof obj.timeoutMs !== "number" || !Number.isInteger(obj.timeoutMs) || obj.timeoutMs < MIN_TIMEOUT_MS2 || obj.timeoutMs > MAX_TIMEOUT_MS) {
      throw new Error(`timeoutMs must be an integer between ${MIN_TIMEOUT_MS2} and ${MAX_TIMEOUT_MS}`);
    }
    timeoutMs = obj.timeoutMs;
  }
  for (const flag of ["includeHidden", "followSymlinks", "force"]) {
    if (obj[flag] !== undefined && typeof obj[flag] !== "boolean")
      throw new Error(`${flag} must be a boolean`);
  }
  return {
    pattern: obj.pattern,
    rewrite: obj.rewrite,
    language: obj.language,
    paths: obj.paths,
    workdir: obj.workdir,
    globs: obj.globs,
    selector: obj.selector,
    strictness,
    apply: obj.apply ?? false,
    maxMatches,
    timeoutMs,
    includeHidden: obj.includeHidden,
    followSymlinks: obj.followSymlinks,
    force: obj.force
  };
}
function scopeArgs(input) {
  const args = ["--strictness", input.strictness];
  if (input.selector)
    args.push("--selector", input.selector);
  if (input.globs)
    for (const glob of input.globs)
      args.push("--globs", glob);
  if (input.includeHidden)
    args.push("--no-ignore", "hidden");
  if (input.followSymlinks)
    args.push("--follow");
  return args;
}
function baseArgs(input) {
  return ["run", "-p", input.pattern, "-r", input.rewrite, "--lang", input.language];
}
function buildRewriteArgs(input) {
  return [...baseArgs(input), "--json=stream", ...scopeArgs(input), ...input.paths];
}
function buildRewriteApplyArgs(input) {
  return [...baseArgs(input), "--update-all", ...scopeArgs(input), ...input.paths];
}
var RETRYABLE = new Set([
  "ABORTED",
  "OUTPUT_PARSE_FAILED",
  "REWRITE_STALE_PREVIEW",
  "TIMEOUT"
]);
var ERROR_NODE_RE2 = /Pattern contains an ERROR node/i;
function failure(code, message, phase, language, durationMs, details = {}) {
  return {
    schemaVersion: 1,
    ok: false,
    kind: "rewrite",
    error: { code, message, retryable: RETRYABLE.has(code), phase, language, details },
    durationMs
  };
}
function toRewriteMatches(records, workdir) {
  return normalizeRecords(records, workdir).map((match) => ({
    ...match,
    replacement: typeof match.replacement === "string" ? match.replacement : ""
  }));
}
function preflightCode(code) {
  switch (code) {
    case "REWRITE_UNBOUND_METAVARIABLE":
      return "REWRITE_UNBOUND_METAVARIABLE";
    case "REWRITE_CARDINALITY_MISMATCH":
      return "REWRITE_METAVARIABLE_KIND_MISMATCH";
    case "LANGUAGE_UNSUPPORTED":
      return "UNSUPPORTED_LANGUAGE";
    case "PATTERN_HINT_REJECTED":
      return "PATTERN_HINT_REJECTED";
    default:
      return "INVALID_ARGUMENT";
  }
}
async function executeRewrite(rawInput, sgPath, signal, hooks) {
  const startedAt = performance.now();
  const elapsed = () => Math.max(0, Math.round(performance.now() - startedAt));
  let input;
  try {
    input = parseRewriteInput(rawInput);
  } catch (error) {
    return failure("INVALID_ARGUMENT", error instanceof Error ? error.message : String(error), "preflight", typeof rawInput?.language === "string" ? rawInput.language : "unknown", elapsed());
  }
  const workdir = input.workdir ?? process.env.OMO_AST_GREP_PROJECT_CWD ?? process.cwd();
  const validation = validateRewriteHints(input.pattern, input.rewrite, input.language, {
    force: input.force,
    paths: input.paths,
    limit: input.maxMatches
  });
  if (validation.rejected) {
    const blocking = validation.hints.find((hint) => hint.severity === "always-reject" || hint.severity === "reject");
    return failure(preflightCode(validation.code), blocking?.message ?? "Rewrite preflight rejected the request.", "preflight", input.language, elapsed(), { hints: validation.hints.map((hint) => hint.message) });
  }
  const warnings = validation.hints.map((hint) => hint.message);
  let preview;
  try {
    preview = await spawnSgRunner({
      sgPath,
      args: buildRewriteArgs(input),
      workdir,
      maxMatches: input.maxMatches,
      timeoutMs: input.timeoutMs,
      signal
    });
  } catch (error) {
    if (error instanceof SgRunnerError) {
      return failure(error.code, error.message, "preview", input.language, error.durationMs, {
        stderr: error.stderr
      });
    }
    return failure("SG_FAILED", error instanceof Error ? error.message : String(error), "preview", input.language, elapsed());
  }
  if (ERROR_NODE_RE2.test(preview.stderr)) {
    return failure("PATTERN_PARSE_FAILED", "ast-grep reported an ERROR node while parsing the pattern; the query failed rather than finding nothing.", "preview", input.language, elapsed(), { stderr: preview.stderr });
  }
  const matches = toRewriteMatches(preview.records, workdir);
  const truncation = {
    truncated: preview.truncated,
    reason: preview.reason,
    maxMatches: input.maxMatches,
    maxPayloadBytes: preview.maxPayloadBytes,
    salvagedRecords: preview.salvagedRecords
  };
  const counts = {
    plannedMatches: matches.length,
    plannedFiles: new Set(matches.map((match) => match.path)).size
  };
  const dryRun = (secondPassExitCode, extraWarnings = []) => ({
    schemaVersion: 1,
    ok: true,
    kind: "rewrite",
    workdir,
    applied: false,
    matches,
    counts,
    truncation,
    application: {
      requested: input.apply,
      performed: false,
      countsArePreviewBased: true,
      idempotencyChecked: false,
      secondPassExitCode
    },
    warnings: [...warnings, ...extraWarnings],
    durationMs: elapsed()
  });
  if (!input.apply)
    return dryRun(null);
  if (truncation.truncated) {
    return failure("PREVIEW_TRUNCATED", `Preview exceeded maxMatches=${input.maxMatches} or was only partially salvaged; a truncated preview is never applied. Narrow paths or globs, then retry.`, "preview", input.language, elapsed(), { stderr: preview.stderr });
  }
  if (matches.length === 0) {
    return dryRun(null, ["Nothing to apply: the preview found no matches."]);
  }
  await hooks?.onPreviewComplete?.();
  const remainingBudgetMs = input.timeoutMs - elapsed();
  if (remainingBudgetMs <= 0) {
    return failure("TIMEOUT", "The tool deadline expired before the mutation pass could start; nothing was modified.", "apply", input.language, elapsed(), { stderr: preview.stderr });
  }
  let applyExitCode;
  let applyStderr = "";
  try {
    const applied = await spawnSgRunner({
      sgPath,
      args: buildRewriteApplyArgs(input),
      workdir,
      maxMatches: input.maxMatches,
      timeoutMs: remainingBudgetMs,
      signal
    });
    applyExitCode = applied.exitCode;
    applyStderr = applied.stderr;
  } catch (error) {
    if (error instanceof SgRunnerError) {
      return failure(error.code, error.message, "apply", input.language, elapsed(), {
        stderr: error.stderr
      });
    }
    return failure("SG_FAILED", error instanceof Error ? error.message : String(error), "apply", input.language, elapsed());
  }
  if (applyExitCode === 1) {
    return failure("REWRITE_STALE_PREVIEW", "The preview found matches but the mutation pass found none; the files or search scope changed between passes. Re-run the preview before applying.", "apply", input.language, elapsed(), { stderr: applyStderr });
  }
  return {
    schemaVersion: 1,
    ok: true,
    kind: "rewrite",
    workdir,
    applied: true,
    matches,
    counts,
    truncation,
    application: {
      requested: true,
      performed: true,
      countsArePreviewBased: true,
      idempotencyChecked: false,
      secondPassExitCode: applyExitCode
    },
    warnings: [...warnings, APPLY_PREVIEW_WARNING],
    durationMs: elapsed()
  };
}

// src/tools/scan.ts
var MAX_PATHS3 = 64;
var MAX_GLOBS3 = 32;
var MIN_TIMEOUT_MS3 = 1000;
var MAX_PATH_LENGTH = 4096;
var MAX_GLOB_LENGTH = 1024;
var MAX_INLINE_RULE_BYTES = 64 * 1024;
var SCAN_TOOL_NAME = "scan";
var SCAN_TOOL_DESCRIPTION = "Scan files with exactly one explicit ast-grep YAML rule source. Provide either ruleFile or inlineRules; ambient sgconfig.yml discovery is never used. Dry-run is the default. Apply uses a bounded JSON preview followed by a separate plain --update-all pass, and truncated previews are never applied.";
function codePointLength2(value) {
  return [...value].length;
}
var KNOWN_KEYS2 = new Set([
  "ruleFile",
  "inlineRules",
  "paths",
  "workdir",
  "globs",
  "maxMatches",
  "timeoutMs",
  "includeHidden",
  "followSymlinks",
  "includeMetadata",
  "apply"
]);
function parseScanInput(input) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Input must be an object");
  }
  const obj = input;
  for (const key of Object.keys(obj)) {
    if (!KNOWN_KEYS2.has(key))
      throw new Error(`Unknown property: ${key}`);
  }
  const hasRuleFile = obj.ruleFile !== undefined;
  const hasInlineRules = obj.inlineRules !== undefined;
  if (hasRuleFile === hasInlineRules) {
    throw new Error("Exactly one of ruleFile or inlineRules must be provided");
  }
  if (hasRuleFile && (typeof obj.ruleFile !== "string" || obj.ruleFile.length === 0)) {
    throw new Error("ruleFile must be a non-empty string");
  }
  if (typeof obj.ruleFile === "string" && codePointLength2(obj.ruleFile) > MAX_PATH_LENGTH) {
    throw new Error(`ruleFile must be at most ${MAX_PATH_LENGTH} characters`);
  }
  if (hasInlineRules && (typeof obj.inlineRules !== "string" || obj.inlineRules.length === 0)) {
    throw new Error("inlineRules must be a non-empty string");
  }
  if (typeof obj.inlineRules === "string" && Buffer.byteLength(obj.inlineRules, "utf8") > MAX_INLINE_RULE_BYTES) {
    throw new Error("inlineRules must be at most 64KiB");
  }
  if (!Array.isArray(obj.paths))
    throw new Error("paths must be an array");
  if (obj.paths.length < 1 || obj.paths.length > MAX_PATHS3) {
    throw new Error(`paths must have 1-${MAX_PATHS3} entries`);
  }
  for (const path of obj.paths) {
    if (typeof path !== "string" || path.length === 0)
      throw new Error("each path must be a non-empty string");
    if (codePointLength2(path) > MAX_PATH_LENGTH)
      throw new Error(`each path must be at most ${MAX_PATH_LENGTH} characters`);
  }
  if (obj.workdir !== undefined && (typeof obj.workdir !== "string" || obj.workdir.length === 0)) {
    throw new Error("workdir must be a non-empty string");
  }
  if (typeof obj.workdir === "string" && codePointLength2(obj.workdir) > MAX_PATH_LENGTH) {
    throw new Error(`workdir must be at most ${MAX_PATH_LENGTH} characters`);
  }
  if (obj.globs !== undefined) {
    if (!Array.isArray(obj.globs))
      throw new Error("globs must be an array");
    if (obj.globs.length > MAX_GLOBS3)
      throw new Error(`globs must have at most ${MAX_GLOBS3} entries`);
    for (const glob of obj.globs) {
      if (typeof glob !== "string" || glob.length === 0)
        throw new Error("each glob must be a non-empty string");
      if (codePointLength2(glob) > MAX_GLOB_LENGTH)
        throw new Error(`each glob must be at most ${MAX_GLOB_LENGTH} characters`);
    }
  }
  let maxMatches = DEFAULT_MATCHES;
  if (obj.maxMatches !== undefined) {
    if (typeof obj.maxMatches !== "number" || !Number.isInteger(obj.maxMatches) || obj.maxMatches < 1 || obj.maxMatches > MAX_MATCHES) {
      throw new Error(`maxMatches must be an integer between 1 and ${MAX_MATCHES}`);
    }
    maxMatches = obj.maxMatches;
  }
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (obj.timeoutMs !== undefined) {
    if (typeof obj.timeoutMs !== "number" || !Number.isInteger(obj.timeoutMs) || obj.timeoutMs < MIN_TIMEOUT_MS3 || obj.timeoutMs > MAX_TIMEOUT_MS) {
      throw new Error(`timeoutMs must be an integer between ${MIN_TIMEOUT_MS3} and ${MAX_TIMEOUT_MS}`);
    }
    timeoutMs = obj.timeoutMs;
  }
  for (const flag of ["includeHidden", "followSymlinks", "includeMetadata", "apply"]) {
    if (obj[flag] !== undefined && typeof obj[flag] !== "boolean")
      throw new Error(`${flag} must be a boolean`);
  }
  return {
    ruleFile: obj.ruleFile,
    inlineRules: obj.inlineRules,
    paths: obj.paths,
    workdir: obj.workdir,
    globs: obj.globs,
    maxMatches,
    timeoutMs,
    includeHidden: obj.includeHidden,
    followSymlinks: obj.followSymlinks,
    includeMetadata: obj.includeMetadata ?? false,
    apply: obj.apply ?? false
  };
}
function sourceArgs(input) {
  return input.ruleFile !== undefined ? ["--rule", input.ruleFile] : ["--inline-rules", input.inlineRules];
}
function scopeArgs2(input) {
  const args = [];
  if (input.globs)
    for (const glob of input.globs)
      args.push("--globs", glob);
  if (input.includeHidden)
    args.push("--no-ignore", "hidden");
  if (input.followSymlinks)
    args.push("--follow");
  return args;
}
function buildScanArgs(input) {
  return [
    "scan",
    ...sourceArgs(input),
    ...input.includeMetadata ? ["--include-metadata"] : [],
    "--json=stream",
    ...scopeArgs2(input),
    ...input.paths
  ];
}
function buildScanApplyArgs(input) {
  return ["scan", ...sourceArgs(input), "--update-all", ...scopeArgs2(input), ...input.paths];
}
var RETRYABLE2 = new Set(["ABORTED", "OUTPUT_PARSE_FAILED", "TIMEOUT"]);
var RULE_PARSE_RE = /Cannot parse rule|not a valid ast-grep rule|Fail to parse yaml as RuleConfig/i;
var DEPRECATION_WARNING_RE = /^warning:.*\bsg\b.*deprecated/im;
var APPLY_PREVIEW_WARNING2 = "Mutation counts are based on the preview pass; sg scan --update-all does not return equivalent JSON.";
function failure2(code, message, phase, durationMs, details = {}) {
  return {
    schemaVersion: 1,
    ok: false,
    kind: "scan",
    error: { code, message, retryable: RETRYABLE2.has(code), phase, details },
    durationMs
  };
}
function runnerFailure(error, phase) {
  if (RULE_PARSE_RE.test(error.stderr)) {
    return failure2("RULE_PARSE_FAILED", "ast-grep could not parse the explicit YAML rule source.", phase, error.durationMs, { stderr: error.stderr });
  }
  return failure2(error.code, error.message, phase, error.durationMs, { stderr: error.stderr });
}
function toScanMatches(records, workdir) {
  return normalizeRecords(records, workdir).map((normalized) => {
    const raw = normalized;
    const rule = {
      ruleId: typeof raw.ruleId === "string" ? raw.ruleId : "",
      ...typeof raw.severity === "string" ? { severity: raw.severity } : {},
      ...typeof raw.note === "string" ? { note: raw.note } : {},
      ...typeof raw.message === "string" ? { message: raw.message } : {},
      labels: Array.isArray(raw.labels) ? raw.labels : [],
      ...raw.metadata !== undefined ? { metadata: raw.metadata } : {}
    };
    const match = { ...raw };
    delete match.ruleId;
    delete match.severity;
    delete match.note;
    delete match.message;
    delete match.labels;
    delete match.metadata;
    return {
      ...match,
      replacement: typeof raw.replacement === "string" ? raw.replacement : "",
      rule
    };
  });
}
async function executeScan(rawInput, sgPath, signal) {
  const startedAt = performance.now();
  const elapsed = () => Math.max(0, Math.round(performance.now() - startedAt));
  let input;
  try {
    input = parseScanInput(rawInput);
  } catch (error) {
    return failure2("INVALID_ARGUMENT", error instanceof Error ? error.message : String(error), "preflight", elapsed());
  }
  const workdir = input.workdir ?? process.env.OMO_AST_GREP_PROJECT_CWD ?? process.cwd();
  let preview;
  try {
    preview = await spawnSgRunner({
      sgPath,
      args: buildScanArgs(input),
      workdir,
      maxMatches: input.maxMatches,
      timeoutMs: input.timeoutMs,
      signal
    });
  } catch (error) {
    if (error instanceof SgRunnerError)
      return runnerFailure(error, "preview");
    return failure2("SG_FAILED", error instanceof Error ? error.message : String(error), "preview", elapsed());
  }
  const matches = toScanMatches(preview.records, workdir);
  const truncation = {
    truncated: preview.truncated,
    reason: preview.reason,
    maxMatches: input.maxMatches,
    maxPayloadBytes: preview.maxPayloadBytes,
    salvagedRecords: preview.salvagedRecords
  };
  const counts = {
    plannedMatches: matches.length,
    plannedFiles: new Set(matches.map((match) => match.path)).size
  };
  const warnings = DEPRECATION_WARNING_RE.test(preview.stderr) ? [preview.stderr.trim()] : [];
  const dryRun = (extraWarnings = []) => ({
    schemaVersion: 1,
    ok: true,
    kind: "scan",
    workdir,
    applied: false,
    matches,
    counts,
    truncation,
    application: {
      requested: input.apply,
      performed: false,
      countsArePreviewBased: true,
      secondPassExitCode: null
    },
    warnings: [...warnings, ...extraWarnings],
    durationMs: elapsed()
  });
  if (!input.apply)
    return dryRun();
  if (preview.truncated) {
    return failure2("PREVIEW_TRUNCATED", `Preview exceeded maxMatches=${input.maxMatches} or was only partially salvaged; a truncated preview is never applied. Narrow paths or globs, then retry.`, "preview", elapsed(), { stderr: preview.stderr });
  }
  if (matches.length === 0)
    return dryRun(["Nothing to apply: the preview found no matches."]);
  const remainingBudgetMs = input.timeoutMs - elapsed();
  if (remainingBudgetMs <= 0) {
    return failure2("TIMEOUT", "The tool deadline expired during the preview pass; the mutation pass was not started.", "preview", elapsed(), { stderr: preview.stderr });
  }
  let applied;
  try {
    applied = await spawnSgRunner({
      sgPath,
      args: buildScanApplyArgs(input),
      workdir,
      maxMatches: input.maxMatches,
      timeoutMs: remainingBudgetMs,
      signal
    });
  } catch (error) {
    if (error instanceof SgRunnerError)
      return runnerFailure(error, "apply");
    return failure2("SG_FAILED", error instanceof Error ? error.message : String(error), "apply", elapsed());
  }
  return {
    schemaVersion: 1,
    ok: true,
    kind: "scan",
    workdir,
    applied: true,
    matches,
    counts,
    truncation,
    application: {
      requested: true,
      performed: true,
      countsArePreviewBased: true,
      secondPassExitCode: applied.exitCode
    },
    warnings: [...warnings, APPLY_PREVIEW_WARNING2],
    durationMs: elapsed()
  };
}

// src/mcp.ts
var AST_GREP_SERVER_NAME = "ast_grep";
var AST_GREP_SERVER_VERSION = "0.1.0";
var DEFAULT_PROTOCOL_VERSION = "2024-11-05";
var LANGUAGES4 = [
  "bash",
  "c",
  "cpp",
  "csharp",
  "css",
  "elixir",
  "go",
  "haskell",
  "html",
  "java",
  "javascript",
  "json",
  "kotlin",
  "lua",
  "nix",
  "php",
  "python",
  "ruby",
  "rust",
  "scala",
  "solidity",
  "swift",
  "typescript",
  "tsx",
  "yaml"
];
var STRICTNESS3 = ["cst", "smart", "ast", "relaxed", "signature"];
var PATTERN_BYTES_NOTE = "Max 16 KiB (16384 BYTES, UTF-8) — the limit counts bytes, not characters.";
var REWRITE_BYTES_NOTE = "Max 64 KiB (65536 BYTES, UTF-8) — the limit counts bytes, not characters.";
var INLINE_RULES_BYTES_NOTE = "Max 64 KiB (65536 BYTES, UTF-8) — the limit counts bytes, not characters.";
var pathsSchema = {
  type: "array",
  minItems: 1,
  maxItems: 64,
  items: { type: "string", minLength: 1, maxLength: 4096 },
  description: "Files or directories to search. Required — there is no implicit '.' default."
};
var globsSchema = {
  type: "array",
  maxItems: 32,
  items: { type: "string", minLength: 1, maxLength: 1024 },
  description: "Optional include/exclude globs passed through to ast-grep."
};
var workdirSchema = {
  type: "string",
  minLength: 1,
  maxLength: 4096,
  description: "Working directory for the sg process. Defaults to the server's cwd."
};
var maxMatchesSchema = {
  type: "integer",
  minimum: 1,
  maximum: 500,
  description: "Maximum matches to return (default 50)."
};
var timeoutMsSchema = {
  type: "integer",
  minimum: 1000,
  maximum: 300000,
  description: "Whole-call timeout budget in milliseconds (default 300000)."
};
var includeHiddenSchema = { type: "boolean", description: "Include hidden files (--no-ignore hidden)." };
var followSymlinksSchema = { type: "boolean", description: "Follow symlinks (--follow)." };
var AST_GREP_MCP_TOOLS = [
  {
    name: SEARCH_TOOL_NAME,
    description: SEARCH_TOOL_DESCRIPTION,
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", minLength: 1, description: `ast-grep pattern — code, not regex. ${PATTERN_BYTES_NOTE}` },
        language: { type: "string", enum: [...LANGUAGES4], description: "Language the pattern must parse in." },
        paths: pathsSchema,
        workdir: workdirSchema,
        globs: globsSchema,
        selector: { type: "string", minLength: 1, maxLength: 128, description: "Optional sub-node selector." },
        strictness: { type: "string", enum: [...STRICTNESS3], description: "Match strictness (default smart)." },
        maxMatches: maxMatchesSchema,
        timeoutMs: timeoutMsSchema,
        includeHidden: includeHiddenSchema,
        followSymlinks: followSymlinksSchema,
        force: { type: "boolean", description: "Bypass non-fatal pattern hint rejections." }
      },
      required: ["pattern", "language", "paths"],
      additionalProperties: false
    }
  },
  {
    name: REWRITE_TOOL_NAME,
    description: REWRITE_TOOL_DESCRIPTION,
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", minLength: 1, description: `ast-grep pattern — code, not regex. ${PATTERN_BYTES_NOTE}` },
        rewrite: { type: "string", description: `Replacement code; empty deletes the match. ${REWRITE_BYTES_NOTE}` },
        language: { type: "string", enum: [...LANGUAGES4], description: "Language the pattern must parse in." },
        paths: pathsSchema,
        workdir: workdirSchema,
        globs: globsSchema,
        selector: { type: "string", minLength: 1, maxLength: 128, description: "Optional sub-node selector." },
        strictness: { type: "string", enum: [...STRICTNESS3], description: "Match strictness (default smart)." },
        apply: { type: "boolean", description: "Write the rewrite to disk. Default false (dry run)." },
        maxMatches: maxMatchesSchema,
        timeoutMs: timeoutMsSchema,
        includeHidden: includeHiddenSchema,
        followSymlinks: followSymlinksSchema,
        force: { type: "boolean", description: "Bypass non-fatal pattern hint rejections." }
      },
      required: ["pattern", "rewrite", "language", "paths"],
      additionalProperties: false
    }
  },
  {
    name: SCAN_TOOL_NAME,
    description: SCAN_TOOL_DESCRIPTION,
    inputSchema: {
      type: "object",
      properties: {
        ruleFile: { type: "string", minLength: 1, maxLength: 4096, description: "Path to a YAML rule file. Mutually exclusive with inlineRules." },
        inlineRules: {
          type: "string",
          minLength: 1,
          description: `Inline YAML rule text. Mutually exclusive with ruleFile. ${INLINE_RULES_BYTES_NOTE}`
        },
        paths: pathsSchema,
        workdir: workdirSchema,
        globs: globsSchema,
        maxMatches: maxMatchesSchema,
        timeoutMs: timeoutMsSchema,
        includeHidden: includeHiddenSchema,
        followSymlinks: followSymlinksSchema,
        includeMetadata: { type: "boolean", description: "Include rule metadata in each match." },
        apply: { type: "boolean", description: "Write rule fixes to disk. Default false (dry run)." }
      },
      required: ["paths"],
      oneOf: [
        { type: "object", required: ["ruleFile"], not: { required: ["inlineRules"] } },
        { type: "object", required: ["inlineRules"], not: { required: ["ruleFile"] } }
      ],
      additionalProperties: false
    }
  }
];
async function handleAstGrepMcpRequest(input, options = {}) {
  if (!isPlainRecord(input))
    return errorResponse(null, -32600, "Invalid Request");
  const id = jsonRpcId(input["id"]);
  const method = input["method"];
  if (method === "notifications/initialized")
    return;
  if (method === "ping")
    return successResponse(id, {});
  if (method === "initialize") {
    return successResponse(id, {
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: AST_GREP_SERVER_NAME, version: AST_GREP_SERVER_VERSION },
      protocolVersion: requestedProtocolVersion(input["params"])
    });
  }
  if (method === "tools/list")
    return successResponse(id, { tools: [...AST_GREP_MCP_TOOLS] });
  if (method === "tools/call")
    return await handleToolCall(id, input["params"], options);
  return errorResponse(id, -32601, `Method not found: ${String(method)}`);
}
async function runMcpStdioServer(input = process.stdin, output = process.stdout, options = {}) {
  let active = null;
  await runJsonRpcStdioServer({
    input,
    output,
    handler: async (request) => {
      const controller = new AbortController;
      active = controller;
      try {
        return await handleAstGrepMcpRequest(request, { ...options, signal: controller.signal });
      } finally {
        if (active === controller)
          active = null;
      }
    },
    handlerOptions: undefined,
    idleTimeoutMs: 0,
    parentWatchdog: options.parentWatchdog ?? {},
    log: options.lifecycleLog,
    onParentExit: () => {
      active?.abort(new Error("parent process exited"));
    }
  });
}
async function handleToolCall(id, params, options) {
  if (!isPlainRecord(params) || typeof params["name"] !== "string") {
    return errorResponse(id, -32602, "tools/call requires params.name");
  }
  const name = params["name"];
  const args = coerceToolArguments(params["arguments"]);
  if (name !== SEARCH_TOOL_NAME && name !== REWRITE_TOOL_NAME && name !== SCAN_TOOL_NAME) {
    return toolFailure(id, "INVALID_ARGUMENT", `Unknown ast_grep tool: ${name}. Available tools: ${AST_GREP_MCP_TOOLS.map((tool) => tool.name).join(", ")}.`);
  }
  let sgPath;
  try {
    sgPath = resolveSgPath(options);
  } catch (error) {
    return toolFailure(id, "BINARY_NOT_FOUND", messageOf(error), hintsOf(error));
  }
  try {
    const payload = await dispatch(name, args, sgPath, options);
    return toolResponse(id, payload, payload.ok !== true);
  } catch (error) {
    if (error instanceof ToolArgumentError) {
      return toolFailure(id, "INVALID_ARGUMENT", error.message, [], { language: error.language });
    }
    return toolFailure(id, "SG_FAILED", messageOf(error));
  }
}

class ToolArgumentError extends Error {
  language;
  constructor(message, language) {
    super(message);
    this.name = "ToolArgumentError";
    this.language = language;
  }
}
async function dispatch(name, args, sgPath, options) {
  const executors = options.executors ?? {};
  const input = args;
  if (name === SEARCH_TOOL_NAME) {
    let parsed;
    try {
      parsed = searchInputSchema.parse(args);
    } catch (error) {
      throw new ToolArgumentError(messageOf(error), languageOf(args));
    }
    const execute2 = executors.search ?? ((value, path, signal) => executeSearch(value, path, signal));
    return await execute2(parsed, sgPath, options.signal);
  }
  if (name === REWRITE_TOOL_NAME) {
    const execute2 = executors.rewrite ?? ((value, path, signal) => executeRewrite(value, path, signal));
    return await execute2(input, sgPath, options.signal);
  }
  const execute = executors.scan ?? ((value, path, signal) => executeScan(value, path, signal));
  return await execute(input, sgPath, options.signal);
}
function coerceToolArguments(value) {
  return isPlainRecord(value) ? value : {};
}
function resolveSgPath(options) {
  if (options.resolveSgPath !== undefined)
    return options.resolveSgPath();
  const resolution = resolveSgBinarySync();
  if (!resolution.found) {
    throw Object.assign(new Error(resolution.error.message), { hints: resolution.error.hints });
  }
  return resolution.path;
}
function toolResponse(id, payload, isError) {
  return successResponse(id, {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    isError
  });
}
function toolFailure(id, code, message, hints = [], extra = {}) {
  return toolResponse(id, {
    schemaVersion: 1,
    ok: false,
    error: {
      code,
      message,
      retryable: false,
      phase: "preflight",
      ...extra,
      details: hints.length > 0 ? { hints } : {}
    }
  }, true);
}
function languageOf(args) {
  return typeof args["language"] === "string" ? args["language"] : "unknown";
}
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
function hintsOf(error) {
  if (!(error instanceof Error) || !("hints" in error))
    return [];
  const hints = error.hints;
  return Array.isArray(hints) ? hints.filter((hint) => typeof hint === "string") : [];
}
function requestedProtocolVersion(params) {
  if (!isPlainRecord(params) || typeof params["protocolVersion"] !== "string")
    return DEFAULT_PROTOCOL_VERSION;
  return params["protocolVersion"];
}

// src/cli.ts
async function main() {
  const [command = "mcp"] = argv.slice(2);
  if (command === "mcp") {
    await runMcpStdioServer(process.stdin, process.stdout);
    return;
  }
  stderr.write(`Usage: omo-ast-grep [mcp]
`);
  process.exitCode = 2;
}
main().catch((error) => {
  stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}
`);
  process.exitCode = 1;
});
