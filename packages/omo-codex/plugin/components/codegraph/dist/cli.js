#!/usr/bin/env node

// components/codegraph/src/serve.ts
import { spawn } from "node:child_process";
import { existsSync as existsSync2, realpathSync } from "node:fs";
import { homedir as homedir3 } from "node:os";
import { resolve } from "node:path";
import { env as processEnv, stderr as processStderr } from "node:process";
import { fileURLToPath } from "node:url";

// ../../utils/src/codegraph/env.ts
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

// ../../utils/src/codegraph/resolve.ts
import { existsSync } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { dirname, join as join3 } from "node:path";
import { createRequire } from "node:module";

// ../../utils/src/runtime/which.ts
import { accessSync, constants } from "node:fs";
import { delimiter, join as join2 } from "node:path";
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
    return process.env.Path ?? process.env.PATH;
  return process.env.PATH;
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
      const candidatePath = join2(pathEntry, candidateName);
      if (isExecutable(candidatePath))
        return candidatePath;
    }
  }
  return null;
}

// ../../utils/src/codegraph/resolve.ts
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
    join3(homeDir, ".omo", "codegraph", "bin", binaryName),
    join3(homeDir, ".omo", "codegraph", "node-servers", "node_modules", ".bin", binaryName)
  ];
  return candidates.find((candidate) => fileExists(candidate)) ?? null;
}
function resolveBundledShim(requireResolve, fileExists) {
  try {
    const packageJson = requireResolve(`${CODEGRAPH_PACKAGE}/package.json`);
    const packageRoot = dirname(packageJson);
    const candidates = [join3(packageRoot, "bin", "codegraph.js"), join3(packageRoot, "npm-shim.js")];
    return candidates.find((candidate) => fileExists(candidate)) ?? null;
  } catch (error) {
    if (error instanceof Error)
      return null;
    if (error === null || error === undefined)
      return null;
    if (typeof error === "object" || typeof error === "string" || typeof error === "number")
      return null;
    if (typeof error === "boolean" || typeof error === "bigint" || typeof error === "symbol")
      return null;
    return null;
  }
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
  const runtime2 = nodeRuntime();
  if (bundled !== null && runtime2 !== null) {
    return { argsPrefix: [bundled], command: runtime2, exists: true, source: "bundled" };
  }
  const provisioned = options.provisioned?.() ?? defaultProvisionedBin(options.homeDir ?? homedir2(), fileExists);
  if (provisioned !== null && fileExists(provisioned)) {
    return { argsPrefix: [], command: provisioned, exists: true, source: "provisioned" };
  }
  const pathCommand = (options.which ?? bunWhich)("codegraph");
  return {
    argsPrefix: [],
    command: pathCommand ?? "codegraph",
    exists: pathCommand !== null,
    source: "path"
  };
}

// components/codegraph/src/serve.ts
var CODEGRAPH_SKIP_HINT = `CodeGraph MCP skipped: codegraph binary not found. Install CodeGraph or set OMO_CODEGRAPH_BIN.
`;
async function runCodegraphServe(options = {}) {
  const env = options.env ?? processEnv;
  const homeDir = options.homeDir ?? homedir3();
  const resolution = options.resolve?.({ env, homeDir }) ?? resolveCodegraphCommand({ env, homeDir });
  if (!resolution.exists || shouldSkipResolvedCommand(resolution, options.commandExists ?? existsSync2)) {
    (options.stderr ?? processStderr).write(CODEGRAPH_SKIP_HINT);
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
  const child = spawn(command, args, { env: options.env, stdio: options.stdio });
  return new Promise((resolve2, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code !== null) {
        resolve2(code);
        return;
      }
      resolve2(signal === null ? 0 : 1);
    });
  });
}
if (isDirectInvocation(process.argv[1])) {
  runCodegraphServeCli().catch((error) => {
    processStderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}
`);
    process.exitCode = 1;
  });
}
function isDirectInvocation(argvPath) {
  if (argvPath === undefined)
    return false;
  return realpathSync(resolve(argvPath)) === realpathSync(fileURLToPath(import.meta.url));
}

// components/codegraph/src/cli.ts
await runCodegraphServeCli();
