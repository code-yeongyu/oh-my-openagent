#!/usr/bin/env node

// components/codegraph/src/cli.ts
import { realpathSync as realpathSync3 } from "node:fs";
import { basename as basename3, resolve as resolve3 } from "node:path";
import { stderr as processStderr3 } from "node:process";
import { fileURLToPath as fileURLToPath3 } from "node:url";

// components/codegraph/src/hook.ts
import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { appendFileSync, chmodSync, existsSync as existsSync2, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, renameSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir as homedir3 } from "node:os";
import { basename, dirname as dirname2, join as join3, resolve } from "node:path";
import { cwd as processCwd, env as processEnv, stderr as processStderr, stdin as processStdin, stdout as processStdout } from "node:process";
import { fileURLToPath } from "node:url";

// components/codegraph/src/codegraph-env.ts
import { homedir } from "node:os";
import { join } from "node:path";
var CODEGRAPH_INSTALL_DIR_ENV = "CODEGRAPH_INSTALL_DIR";
var CODEGRAPH_NO_DOWNLOAD_ENV = "CODEGRAPH_NO_DOWNLOAD";
var CODEGRAPH_TELEMETRY_ENV = "CODEGRAPH_TELEMETRY";
var DO_NOT_TRACK_ENV = "DO_NOT_TRACK";
function buildCodegraphEnv(options = {}) {
  const homeDir = options.homeDir ?? homedir();
  return {
    [CODEGRAPH_INSTALL_DIR_ENV]: join(homeDir, ".omo", "codegraph"),
    [CODEGRAPH_NO_DOWNLOAD_ENV]: "1",
    [CODEGRAPH_TELEMETRY_ENV]: "0",
    [DO_NOT_TRACK_ENV]: "1"
  };
}

// components/codegraph/src/codegraph-resolve.ts
import { accessSync, constants, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir as homedir2 } from "node:os";
import { delimiter, dirname, join as join2 } from "node:path";
var CODEGRAPH_PACKAGE = "@colbymchenry/codegraph";
var CODEGRAPH_ENV_BIN = "OMO_CODEGRAPH_BIN";
var requireFromHere = createRequire(import.meta.url);
function defaultRequireResolve(specifier) {
  return requireFromHere.resolve(specifier);
}
function defaultNodeRuntime() {
  return process.execPath || null;
}
function defaultProvisionedBin(homeDir, fileExists) {
  const binaryName = process.platform === "win32" ? "codegraph.cmd" : "codegraph";
  const candidates = [
    join2(homeDir, ".omo", "codegraph", "bin", binaryName),
    join2(homeDir, ".omo", "codegraph", "node-servers", "node_modules", ".bin", binaryName)
  ];
  return candidates.find((candidate) => fileExists(candidate)) ?? null;
}
function resolveBundledShim(requireResolve, fileExists) {
  try {
    const packageJson = requireResolve(`${CODEGRAPH_PACKAGE}/package.json`);
    const packageRoot = dirname(packageJson);
    const candidates = [join2(packageRoot, "bin", "codegraph.js"), join2(packageRoot, "npm-shim.js")];
    return candidates.find((candidate) => fileExists(candidate)) ?? null;
  } catch (error) {
    if (error instanceof Error)
      return null;
    throw error;
  }
}
function isUnsafeCommandName(commandName) {
  if (commandName.includes("/") || commandName.includes("\\"))
    return true;
  if (commandName === "." || commandName === ".." || commandName.includes(".."))
    return true;
  if (/^[a-zA-Z]:/.test(commandName))
    return true;
  return commandName.includes("\x00");
}
function isExecutable(filePath) {
  try {
    accessSync(filePath, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch (error) {
    if (error instanceof Error)
      return false;
    throw error;
  }
}
function resolvePathValue(env) {
  if (process.platform === "win32")
    return env["Path"] ?? env["PATH"];
  return env["PATH"];
}
function getWindowsCandidates(commandName) {
  if (process.platform !== "win32")
    return [commandName];
  if (/\.[^\\/]+$/.test(commandName))
    return [commandName];
  return [commandName, `${commandName}.exe`, `${commandName}.cmd`, `${commandName}.bat`, `${commandName}.com`];
}
function findOnPath(commandName, env) {
  if (commandName.length === 0 || isUnsafeCommandName(commandName))
    return null;
  const pathValue = resolvePathValue(env);
  if (pathValue === undefined || pathValue.length === 0)
    return null;
  const candidateNames = getWindowsCandidates(commandName);
  const pathEntries = pathValue.split(delimiter).filter((pathEntry) => pathEntry.length > 0);
  for (const pathEntry of pathEntries) {
    for (const candidateName of candidateNames) {
      const candidatePath = join2(pathEntry, candidateName);
      if (isExecutable(candidatePath))
        return candidatePath;
    }
  }
  return null;
}
function resolveCodegraphCommand(options = {}) {
  const env = options.env ?? process.env;
  const configuredBin = env[CODEGRAPH_ENV_BIN]?.trim();
  if (configuredBin !== undefined && configuredBin.length > 0) {
    return { argsPrefix: [], command: configuredBin, exists: true, source: "env" };
  }
  const fileExists = options.fileExists ?? existsSync;
  const nodeRuntime = options.nodeRuntime ?? defaultNodeRuntime;
  const bundled = resolveBundledShim(options.requireResolve ?? defaultRequireResolve, fileExists);
  const runtime = nodeRuntime();
  if (bundled !== null && runtime !== null) {
    return { argsPrefix: [bundled], command: runtime, exists: true, source: "bundled" };
  }
  const provisioned = options.provisioned?.() ?? defaultProvisionedBin(options.homeDir ?? homedir2(), fileExists);
  if (provisioned !== null && fileExists(provisioned)) {
    return { argsPrefix: [], command: provisioned, exists: true, source: "provisioned" };
  }
  const pathCommand = (options.which ?? ((commandName) => findOnPath(commandName, env)))("codegraph");
  return {
    argsPrefix: [],
    command: pathCommand ?? "codegraph",
    exists: pathCommand !== null,
    source: "path"
  };
}

// components/codegraph/src/hook.ts
var CODEGRAPH_SESSION_START_NOTICE = "LazyCodex CodeGraph bootstrap scheduled in background";
var CODEGRAPH_VERSION = "1.0.1";
var COMMAND_TIMEOUT_MS = 60000;
var SESSION_START_CWD_ENV = "OMO_CODEGRAPH_SESSION_START_CWD";
var defaultDeps = {
  ensureGitignored,
  ensureProvisioned,
  prepareWorkspace,
  resolveCommand: resolveCodegraphCommand,
  runCommand: runCodegraphCommand
};
async function runCodegraphSessionStartHook(options = {}) {
  return (await executeCodegraphSessionStartHook(options)).exitCode;
}
async function executeCodegraphSessionStartHook(options = {}) {
  const env = options.env ?? processEnv;
  const input = await readHookInput(options.stdin ?? processStdin);
  const projectRoot = resolveProjectRoot(input, options.cwd ?? processCwd());
  const homeDir = resolveHomeDir(env);
  const config = options.config ?? getCodexOmoConfig({ cwd: projectRoot, env, homeDir });
  if (config.codegraph?.enabled === false) {
    writeHookJson(options.stdout ?? processStdout, "skipped-disabled");
    return { action: "skipped-disabled", exitCode: 0 };
  }
  (options.spawnWorker ?? spawnDetachedWorker)({
    args: [options.workerCliPath ?? defaultWorkerCliPath(), "hook", "session-start-worker"],
    command: process.execPath,
    env: { ...env, [SESSION_START_CWD_ENV]: projectRoot }
  });
  writeHookJson(options.stdout ?? processStdout, "spawned");
  return { action: "spawned", exitCode: 0 };
}
async function runCodegraphSessionStartWorker(options = {}) {
  const env = options.env ?? processEnv;
  const homeDir = resolveHomeDir(env);
  const projectRoot = options.cwd ?? env[SESSION_START_CWD_ENV] ?? processCwd();
  const config = options.config ?? getCodexOmoConfig({ cwd: projectRoot, env, homeDir });
  const logOutcome = options.logOutcome ?? ((outcome) => appendOutcome(homeDir, outcome));
  if (config.codegraph?.enabled === false) {
    return finish("skipped-disabled", { projectRoot }, logOutcome);
  }
  return runBootstrap(projectRoot, config.codegraph ?? {}, env, homeDir, { ...defaultDeps, ...options.deps }, logOutcome);
}
async function runBootstrap(projectRoot, config, env, homeDir, deps, logOutcome) {
  try {
    deps.prepareWorkspace(projectRoot, { homeDir });
    deps.ensureGitignored(projectRoot);
    const command = await resolveOrProvisionCommand(deps, config, env, homeDir);
    if (command.kind === "unavailable") {
      return finish("skipped-unavailable", { error: command.error, projectRoot, source: command.source }, logOutcome);
    }
    const codegraphEnv = config.install_dir === undefined ? buildCodegraphEnv({ homeDir }) : { ...buildCodegraphEnv({ homeDir }), CODEGRAPH_INSTALL_DIR: config.install_dir };
    const status = await deps.runCommand(projectRoot, command.resolution.command, [...command.resolution.argsPrefix, "status", "--json"], { env: codegraphEnv, timeoutMs: COMMAND_TIMEOUT_MS });
    const decision = decideStartupAction(status);
    if (decision.kind === "skip")
      return finish("skipped-status", { error: decision.reason, projectRoot }, logOutcome);
    const actionArgs = command.resolution.argsPrefix.concat(decision.kind === "init" ? ["init"] : ["sync"]);
    const action = await deps.runCommand(projectRoot, command.resolution.command, actionArgs, { env: codegraphEnv, timeoutMs: COMMAND_TIMEOUT_MS });
    return finish(decision.kind === "init" ? "initialized" : "synced", { exitCode: action.exitCode, projectRoot, source: command.resolution.source, timedOut: action.timedOut }, logOutcome);
  } catch (error) {
    return finish("failed", { error: error instanceof Error ? error.message : String(error), projectRoot }, logOutcome);
  }
}
function finish(action, detail, logOutcome) {
  safeLogOutcome(logOutcome, { ...detail, action });
  return { action };
}
async function resolveOrProvisionCommand(deps, config, env, homeDir) {
  const resolved = deps.resolveCommand({ env, homeDir, provisioned: () => provisionedBinFromInstallDir(config.install_dir) });
  if (resolved.exists)
    return { kind: "resolved", resolution: resolved };
  if (config.auto_provision === false)
    return { error: "codegraph binary unavailable and auto_provision is disabled", kind: "unavailable", source: resolved.source };
  const installDir = config.install_dir ?? join3(homeDir, ".omo", "codegraph");
  const provisioned = await deps.ensureProvisioned({ installDir, lockDir: join3(installDir, "locks"), version: CODEGRAPH_VERSION });
  if (!provisioned.provisioned || provisioned.binPath === undefined) {
    return { error: provisioned.error ?? "provisioning did not produce a binary", kind: "unavailable", source: resolved.source };
  }
  return { kind: "resolved", resolution: { argsPrefix: [], command: provisioned.binPath, exists: true, source: "provisioned" } };
}
function decideStartupAction(status) {
  if (status.timedOut)
    return { kind: "skip", reason: "status timed out" };
  const text = `${status.stdout}
${status.stderr ?? ""}`.toLowerCase();
  if (text.includes("not initialized") || text.includes("uninitialized"))
    return { kind: "init" };
  const initialized = jsonSaysInitialized(parseJson(status.stdout));
  if (initialized === false)
    return { kind: "init" };
  if (initialized === true)
    return { kind: "sync" };
  if (status.exitCode !== 0)
    return { kind: "skip", reason: `status exited ${status.exitCode}` };
  return { kind: "sync" };
}
function jsonSaysInitialized(value) {
  if (!isRecord(value))
    return;
  const initialized = value["initialized"] ?? value["isInitialized"] ?? value["ready"];
  if (typeof initialized === "boolean")
    return initialized;
  const status = value["status"];
  if (typeof status !== "string")
    return;
  const normalized = status.toLowerCase();
  if (normalized.includes("not initialized") || normalized.includes("uninitialized"))
    return false;
  if (normalized.includes("initialized") || normalized.includes("ready"))
    return true;
  return;
}
async function runCodegraphCommand(projectRoot, command, args, options) {
  return new Promise((resolvePromise) => {
    execFile(command, [...args], { cwd: projectRoot, encoding: "utf8", env: { ...process.env, ...options.env }, maxBuffer: 1024 * 1024, timeout: options.timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
      if (error === null) {
        resolvePromise({ exitCode: 0, stderr: toOutputText(stderr), stdout: toOutputText(stdout), timedOut: false });
        return;
      }
      resolvePromise({ exitCode: resolveExitCode(error), stderr: toOutputText(stderr), stdout: toOutputText(stdout), timedOut: error.killed === true });
    });
  });
}
function writeHookJson(stdout, action) {
  const output = action === "spawned" ? { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: CODEGRAPH_SESSION_START_NOTICE }, codegraph: { action } } : { hookSpecificOutput: { hookEventName: "SessionStart" }, codegraph: { action } };
  stdout.write(`${JSON.stringify(output)}
`);
}
function spawnDetachedWorker(invocation) {
  const child = spawn(invocation.command, [...invocation.args], { detached: true, env: invocation.env, stdio: "ignore" });
  child.unref();
}
function appendOutcome(homeDir, outcome) {
  const logDir = join3(homeDir, ".omo", "codegraph");
  mkdirSync(logDir, { recursive: true });
  appendFileSync(join3(logDir, "session-start.jsonl"), `${JSON.stringify({ ...outcome, timestamp: new Date().toISOString() })}
`);
}
function safeLogOutcome(logOutcome, outcome) {
  try {
    logOutcome(outcome);
  } catch (error) {
    if (error instanceof Error)
      processStderr.write(`[codegraph-session-start] failed to write outcome: ${error.message}
`);
    else
      throw error;
  }
}
function provisionedBinFromInstallDir(installDir) {
  if (installDir === undefined)
    return null;
  const candidate = join3(installDir, "bin", process.platform === "win32" ? "codegraph.exe" : "codegraph");
  return existsSync2(candidate) ? candidate : null;
}
function resolveExitCode(error) {
  if ("code" in error && typeof error.code === "number")
    return error.code;
  return 1;
}
function toOutputText(value) {
  return Buffer.isBuffer(value) ? value.toString("utf8") : value;
}
function getCodexOmoConfig(options) {
  const globalPath = join3(options.homeDir, ".omo", "config.jsonc");
  const sources = [];
  let codegraph = { auto_provision: true, enabled: true, telemetry: false };
  if (existsSync2(globalPath)) {
    const loaded = loadCodegraphConfig(globalPath);
    sources.push({ exists: true, loaded: loaded.loaded, path: globalPath, scope: "global" });
    codegraph = { ...codegraph, ...loaded.config.codegraph, ...loaded.config.codexCodegraph };
  } else {
    sources.push({ exists: false, loaded: false, path: globalPath, scope: "global" });
  }
  const envCodegraph = loadCodegraphEnv(options.env);
  return { codegraph: { ...codegraph, ...envCodegraph }, sources, warnings: [] };
}
function loadCodegraphConfig(path) {
  const parsed = parseJson(stripJsonComments(readFileSync(path, "utf8")));
  if (!isRecord(parsed))
    return { config: {}, loaded: false };
  const codegraph = readCodegraphSection(parsed["codegraph"]);
  const codexCodegraph = isRecord(parsed["[codex]"]) ? readCodegraphSection(parsed["[codex]"]["codegraph"]) : undefined;
  return {
    config: {
      ...codegraph === undefined ? {} : { codegraph },
      ...codexCodegraph === undefined ? {} : { codexCodegraph }
    },
    loaded: true
  };
}
function stripJsonComments(text) {
  let output = "";
  let inString = false;
  let escaped = false;
  for (let index = 0;index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === undefined)
      continue;
    if (inString) {
      output += char;
      escaped = char === "\\" && !escaped;
      if (char === '"' && !escaped)
        inString = false;
      if (char !== "\\")
        escaped = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }
    if (char === "/" && next === "/") {
      while (index < text.length && text[index] !== `
`)
        index += 1;
      output += `
`;
      continue;
    }
    if (char === "/" && next === "*") {
      index += 2;
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/"))
        index += 1;
      index += 1;
      continue;
    }
    output += char;
  }
  return output.replace(/,\s*([}\]])/g, "$1");
}
function readCodegraphSection(value) {
  if (!isRecord(value))
    return;
  const config = {};
  if (typeof value["auto_provision"] === "boolean")
    config.auto_provision = value["auto_provision"];
  if (typeof value["enabled"] === "boolean")
    config.enabled = value["enabled"];
  if (typeof value["install_dir"] === "string")
    config.install_dir = value["install_dir"];
  if (typeof value["telemetry"] === "boolean")
    config.telemetry = value["telemetry"];
  return Object.keys(config).length === 0 ? undefined : config;
}
function loadCodegraphEnv(env) {
  const config = {};
  const omoAutoProvision = readBooleanValue(env["OMO_CODEGRAPH_AUTO_PROVISION"]);
  const codexAutoProvision = readBooleanValue(env["CODEX_CODEGRAPH_AUTO_PROVISION"]);
  const omoEnabled = readBooleanValue(env["OMO_CODEGRAPH_ENABLED"]);
  const codexEnabled = readBooleanValue(env["CODEX_CODEGRAPH_ENABLED"]);
  const omoTelemetry = readBooleanValue(env["OMO_CODEGRAPH_TELEMETRY"]);
  const codexTelemetry = readBooleanValue(env["CODEX_CODEGRAPH_TELEMETRY"]);
  if (omoAutoProvision !== undefined)
    config.auto_provision = omoAutoProvision;
  if (codexAutoProvision !== undefined)
    config.auto_provision = codexAutoProvision;
  if (omoEnabled !== undefined)
    config.enabled = omoEnabled;
  if (codexEnabled !== undefined)
    config.enabled = codexEnabled;
  if (env["OMO_CODEGRAPH_INSTALL_DIR"] !== undefined)
    config.install_dir = env["OMO_CODEGRAPH_INSTALL_DIR"];
  if (env["CODEX_CODEGRAPH_INSTALL_DIR"] !== undefined)
    config.install_dir = env["CODEX_CODEGRAPH_INSTALL_DIR"];
  if (omoTelemetry !== undefined)
    config.telemetry = omoTelemetry;
  if (codexTelemetry !== undefined)
    config.telemetry = codexTelemetry;
  return config;
}
function readBooleanValue(value) {
  if (value === undefined)
    return;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized))
    return true;
  if (["0", "false", "no", "off"].includes(normalized))
    return false;
  return;
}
function resolveHomeDir(env) {
  return env["HOME"] ?? env["USERPROFILE"] ?? homedir3();
}
function resolveProjectRoot(input, fallback) {
  if (!isRecord(input))
    return fallback;
  const cwd = input["cwd"];
  return typeof cwd === "string" && cwd.trim().length > 0 ? cwd : fallback;
}
async function readHookInput(stdin) {
  if (stdin.isTTY === true)
    return;
  let text = "";
  for await (const chunk of stdin)
    text += typeof chunk === "string" ? chunk : String(chunk);
  if (text.trim().length === 0)
    return;
  return parseJson(text);
}
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError)
      return;
    throw error;
  }
}
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
function ensureGitignored(projectRoot) {
  const excludePath = join3(projectRoot, ".git", "info", "exclude");
  try {
    mkdirSync(dirname2(excludePath), { recursive: true });
    const existing = existsSync2(excludePath) ? readFileSync(excludePath, "utf8") : "";
    if (existing.split(/\r?\n/).includes(".codegraph"))
      return true;
    appendFileSync(excludePath, `${existing.length === 0 || existing.endsWith(`
`) ? "" : `
`}.codegraph
`);
    return true;
  } catch (error) {
    if (error instanceof Error)
      return false;
    throw error;
  }
}
function prepareWorkspace(projectRoot, options) {
  const resolvedRoot = resolve(projectRoot);
  const dataRoot = join3(options.homeDir, ".omo", "codegraph");
  const dataDir = join3(dataRoot, "projects", workspaceStorageName(resolvedRoot));
  const projectLink = join3(resolvedRoot, ".codegraph");
  try {
    mkdirSync(dataDir, { recursive: true });
    if (existsSync2(projectLink))
      return inspectExistingWorkspace(dataRoot, dataDir, projectLink);
    if (statSync(resolvedRoot).dev !== statSync(dataRoot).dev)
      return createInPlaceWorkspace(dataRoot, projectLink, "workspace and OMO store are on different filesystems");
    symlinkSync(dataDir, projectLink, process.platform === "win32" ? "junction" : "dir");
    return { dataDir, dataRoot, linked: true, mode: "global-linked", projectLink };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return createInPlaceWorkspace(dataRoot, projectLink, reason);
  }
}
function inspectExistingWorkspace(dataRoot, dataDir, projectLink) {
  const linkStat = lstatSync(projectLink);
  if (!linkStat.isSymbolicLink())
    return { dataDir: projectLink, dataRoot, linked: false, mode: "in-project", projectLink };
  if (realpathSync(projectLink) === realpathSync(dataDir))
    return { dataDir, dataRoot, linked: true, mode: "global-linked", projectLink };
  return createInPlaceWorkspace(dataRoot, projectLink, "existing .codegraph symlink points outside OMO store");
}
function createInPlaceWorkspace(dataRoot, projectLink, reason) {
  if (!existsSync2(projectLink))
    mkdirSync(projectLink, { recursive: true });
  return { dataDir: projectLink, dataRoot, linked: false, mode: "in-place-fallback", projectLink, reason };
}
function workspaceStorageName(projectRoot) {
  const name = basename(projectRoot).replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-") || "workspace";
  const hash = createHash("sha256").update(projectRoot).digest("hex").slice(0, 16);
  return `${name}-${hash}`;
}
async function ensureProvisioned(options) {
  const installDir = options.installDir ?? join3(homedir3(), ".omo", "codegraph");
  const existing = readProvisionMarker(installDir, options.version);
  if (existing !== null)
    return { binPath: existing, provisioned: true };
  const asset = codegraphAsset();
  if (asset === null)
    return { error: `no CodeGraph ${options.version} asset for ${process.platform}-${process.arch}`, provisioned: false };
  try {
    mkdirSync(options.lockDir, { recursive: true });
    const bytes = await downloadAsset(asset.url);
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== asset.sha256)
      return { error: `checksum mismatch for ${basename(asset.url)}: expected ${asset.sha256}, got ${actual}`, provisioned: false };
    const stagingDir = join3(installDir, ".staging", randomUUID());
    const archivePath = join3(stagingDir, basename(asset.url));
    const extractDir = join3(stagingDir, "extract");
    mkdirSync(extractDir, { recursive: true });
    try {
      writeFileSync(archivePath, bytes);
      await execFilePromise("tar", ["-xzf", archivePath, "-C", extractDir]);
      const binPath = installExtractedBundle(extractDir, installDir, asset.executableName, options.version);
      return { binPath, provisioned: true };
    } finally {
      rmSync(stagingDir, { force: true, recursive: true });
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), provisioned: false };
  }
}
function readProvisionMarker(installDir, version) {
  const marker = join3(installDir, ".provisioned", `codegraph-${version}.json`);
  if (!existsSync2(marker))
    return null;
  const parsed = parseJson(readFileSync(marker, "utf8"));
  if (!isRecord(parsed) || typeof parsed["binPath"] !== "string")
    return null;
  return existsSync2(parsed["binPath"]) ? parsed["binPath"] : null;
}
function codegraphAsset() {
  const key = `${process.platform}-${process.arch}`;
  const assets = {
    "darwin-arm64": { executableName: "codegraph", sha256: "95bb27bf6382b69659e158e0c04d71cc394778951e1317d582be7807e7866908", url: "https://github.com/colbymchenry/codegraph/releases/download/v1.0.1/codegraph-darwin-arm64.tar.gz" },
    "darwin-x64": { executableName: "codegraph", sha256: "3311cc1d1f0f0ad742709b6a43d8a9187b1ef0af0dd30e0b58008dc673e29478", url: "https://github.com/colbymchenry/codegraph/releases/download/v1.0.1/codegraph-darwin-x64.tar.gz" },
    "linux-arm64": { executableName: "codegraph", sha256: "e16f612bc96c2ebccd04574cbed500c9939147c80666ad6bb024398dff7992ae", url: "https://github.com/colbymchenry/codegraph/releases/download/v1.0.1/codegraph-linux-arm64.tar.gz" },
    "linux-x64": { executableName: "codegraph", sha256: "d45a068f44596a85c7ba7d0ef924eaf7103fbbf3cafbeb668127daff60a52228", url: "https://github.com/colbymchenry/codegraph/releases/download/v1.0.1/codegraph-linux-x64.tar.gz" }
  };
  return assets[key] ?? null;
}
async function downloadAsset(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(COMMAND_TIMEOUT_MS) });
  if (!response.ok)
    throw new Error(`download failed with HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}
function installExtractedBundle(extractDir, installDir, executableName, version) {
  const roots = readdirSync(extractDir);
  const bundleRoot = roots.length === 1 ? roots[0] : undefined;
  if (bundleRoot === undefined)
    throw new Error(`CodeGraph archive should contain one root directory, found ${roots.length}`);
  for (const entry of readdirSync(join3(extractDir, bundleRoot))) {
    rmSync(join3(installDir, entry), { force: true, recursive: true });
    renameSync(join3(extractDir, bundleRoot, entry), join3(installDir, entry));
  }
  const binPath = join3(installDir, "bin", executableName);
  if (!existsSync2(binPath))
    throw new Error(`CodeGraph archive did not contain bin/${executableName}`);
  chmodSync(binPath, 493);
  mkdirSync(join3(installDir, ".provisioned"), { recursive: true });
  writeFileSync(join3(installDir, ".provisioned", `codegraph-${version}.json`), `${JSON.stringify({ binPath, version })}
`);
  return binPath;
}
function execFilePromise(command, args) {
  return new Promise((resolvePromise, reject) => {
    execFile(command, [...args], (error) => {
      if (error === null)
        resolvePromise();
      else
        reject(error);
    });
  });
}
function defaultWorkerCliPath() {
  return fileURLToPath(import.meta.url);
}

// components/codegraph/src/serve.ts
import { spawn as spawn2 } from "node:child_process";
import { existsSync as existsSync3, realpathSync as realpathSync2 } from "node:fs";
import { homedir as homedir4 } from "node:os";
import { basename as basename2, resolve as resolve2 } from "node:path";
import { env as processEnv2, stderr as processStderr2 } from "node:process";
import { fileURLToPath as fileURLToPath2 } from "node:url";
var CODEGRAPH_SKIP_HINT = `CodeGraph MCP skipped: codegraph binary not found. Install CodeGraph or set OMO_CODEGRAPH_BIN.
`;
async function runCodegraphServe(options = {}) {
  const env = options.env ?? processEnv2;
  const homeDir = options.homeDir ?? homedir4();
  const resolution = options.resolve?.({ env, homeDir }) ?? resolveCodegraphCommand({ env, homeDir });
  if (!resolution.exists || shouldSkipResolvedCommand(resolution, options.commandExists ?? existsSync3)) {
    (options.stderr ?? processStderr2).write(CODEGRAPH_SKIP_HINT);
    return 1;
  }
  const runProcess = options.runProcess ?? runChildProcess;
  const codegraphEnv = options.buildEnv?.({ homeDir }) ?? buildCodegraphEnv({ homeDir });
  const mergedEnv = {
    ...env,
    ...codegraphEnv
  };
  return runProcess(resolution.command, [...resolution.argsPrefix, "serve", "--mcp"], {
    env: mergedEnv,
    stdio: "inherit"
  });
}
function shouldSkipResolvedCommand(resolution, commandExists) {
  if (resolution.source !== "env")
    return false;
  if (!looksLikePath(resolution.command))
    return false;
  return !commandExists(resolution.command);
}
function looksLikePath(command) {
  return command.includes("/") || command.includes("\\");
}
async function runCodegraphServeCli() {
  process.exitCode = await runCodegraphServe();
}
async function runChildProcess(command, args, options) {
  const child = spawn2(command, args, { env: options.env, stdio: options.stdio });
  return new Promise((resolve3, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code !== null) {
        resolve3(code);
        return;
      }
      resolve3(signal === null ? 0 : 1);
    });
  });
}
if (isDirectInvocation(process.argv[1])) {
  runCodegraphServeCli().catch((error) => {
    processStderr2.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}
`);
    process.exitCode = 1;
  });
}
function isDirectInvocation(argvPath) {
  if (argvPath === undefined)
    return false;
  const modulePath = fileURLToPath2(import.meta.url);
  const moduleName = basename2(modulePath);
  if (moduleName !== "serve.js" && moduleName !== "serve.ts")
    return false;
  return realpathSync2(resolve2(argvPath)) === realpathSync2(modulePath);
}

// components/codegraph/src/cli.ts
async function runCodegraphCli(options = {}) {
  const argv = options.argv ?? process.argv;
  const command = argv[2];
  const subcommand = argv[3];
  if (command === "hook" && subcommand === "session-start") {
    return runCodegraphSessionStartHook(options);
  }
  if (command === "hook" && subcommand === "session-start-worker") {
    const workerOptions = {
      ...options.workerOptions,
      ...options.workerOptions?.cwd === undefined && options.cwd !== undefined ? { cwd: options.cwd } : {},
      ...options.workerOptions?.env === undefined && options.env !== undefined ? { env: options.env } : {}
    };
    await runCodegraphSessionStartWorker(workerOptions);
    return 0;
  }
  await runCodegraphServeCli();
  return process.exitCode === undefined ? 0 : Number(process.exitCode);
}
if (isDirectInvocation2(process.argv[1])) {
  runCodegraphCli().catch((error) => {
    processStderr3.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}
`);
    process.exitCode = 1;
  });
}
function isDirectInvocation2(argvPath) {
  if (argvPath === undefined)
    return false;
  const modulePath = fileURLToPath3(import.meta.url);
  const moduleName = basename3(modulePath);
  if (moduleName !== "cli.js" && moduleName !== "cli.ts")
    return false;
  return realpathSync3(resolve3(argvPath)) === realpathSync3(modulePath);
}
export {
  runCodegraphCli
};
