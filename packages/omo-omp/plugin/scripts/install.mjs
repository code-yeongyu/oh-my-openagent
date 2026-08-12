#!/usr/bin/env bun
// @bun
import { createRequire } from "node:module";
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// packages/omo-omp/src/install/cli-local.ts
import { existsSync as fileExistsSync2, readFileSync } from "fs";
import { dirname as dirname2, join as join2, resolve as resolve2 } from "path";
import { fileURLToPath as fileURLToPath2 } from "url";

// packages/omo-omp/src/install/install-omp.ts
import { execFile } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
var execFileAsync = promisify(execFile);
var OMO_OMP_PACKAGE_NAME = "@code-yeongyu/omo-omp";
var BUNDLED_AGENTS_TO_DISABLE = [
  "designer",
  "reviewer",
  "scout",
  "security-reviewer",
  "sonic"
];
var REQUIRED_PLUGIN_ARTIFACTS = [
  join("extensions", "omo.js"),
  join("runtime", "lsp-daemon", "dist", "cli.js"),
  join("runtime", "ast-grep-mcp", "cli.js"),
  join("skills", "ultrawork", "SKILL.md"),
  join("agents", "sisyphus.md"),
  join("scripts", "install.mjs")
];
function resolveInstallContext(options) {
  const env = options.env ?? process.env;
  const allowBuild = options.allowBuild ?? options.pluginPath === undefined;
  const explicitRepoRoot = options.repoRoot;
  const explicitPluginPath = options.pluginPath;
  let repoRoot;
  if (explicitRepoRoot !== undefined) {
    repoRoot = resolve(explicitRepoRoot);
  } else if (explicitPluginPath !== undefined) {
    repoRoot = dirname(dirname(resolve(explicitPluginPath)));
  } else {
    repoRoot = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
  }
  const agentDir = resolve(options.agentDir ?? env.OMP_CODING_AGENT_DIR ?? join(homedir(), ".omp", "agent"));
  const pluginPath = resolve(options.pluginPath ?? join(repoRoot, "packages", "omo-omp", "plugin"));
  return {
    env,
    repoRoot,
    agentDir,
    pluginPath,
    ompBin: options.ompBin ?? env.OMP_BIN ?? "omp",
    platform: options.platform ?? process.platform,
    allowBuild,
    runCommand: options.runCommand ?? defaultRunCommand
  };
}
async function ensurePluginArtifacts(context) {
  if (context.allowBuild) {
    await context.runCommand("bun", [join(context.pluginPath, "scripts", "build-extension.mjs")], { cwd: context.repoRoot });
    await context.runCommand("node", [join(context.pluginPath, "scripts", "sync-skills.mjs")], { cwd: context.repoRoot });
    await context.runCommand("node", [join(context.pluginPath, "scripts", "build-install.mjs")], { cwd: context.repoRoot });
    await context.runCommand("node", [join(context.pluginPath, "scripts", "stage-lsp-daemon-runtime.mjs")], { cwd: context.repoRoot });
    await context.runCommand("node", [join(context.pluginPath, "scripts", "stage-ast-grep-mcp-runtime.mjs")], { cwd: context.repoRoot });
    await context.runCommand("node", [join(context.pluginPath, "scripts", "stage-agent-toolkit.mjs")], { cwd: context.repoRoot });
    await context.runCommand("node", [join(context.pluginPath, "scripts", "stage-agents.mjs")], { cwd: context.repoRoot });
  }
  if (await hasMissingPluginArtifact(context.pluginPath)) {
    throw new Error(`Packed omo-omp plugin is missing required runtime artifacts at ${context.pluginPath}`);
  }
  await verifyAstGrepRuntimeIntegrity(context.pluginPath, context.platform);
}
async function hasMissingPluginArtifact(pluginPath) {
  for (const artifact of REQUIRED_PLUGIN_ARTIFACTS) {
    if (!await fileExists(join(pluginPath, artifact)))
      return true;
  }
  return false;
}
async function runOmpInstaller(options = {}) {
  const context = resolveInstallContext(options);
  try {
    await ensurePluginArtifacts(context);
    const registration = await registerWithOmp(context);
    await applyBundledAgentDisable(context);
    return {
      ok: true,
      action: "install",
      agentDir: context.agentDir,
      pluginPath: context.pluginPath,
      registration,
      changed: true
    };
  } catch (error) {
    return {
      ok: false,
      action: "install",
      agentDir: context.agentDir,
      pluginPath: context.pluginPath,
      registration: null,
      changed: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
async function runOmpUninstaller(options = {}) {
  const context = resolveInstallContext(options);
  try {
    const registration = await unregisterFromOmp(context);
    return {
      ok: true,
      action: "uninstall",
      agentDir: context.agentDir,
      pluginPath: context.pluginPath,
      registration,
      changed: true
    };
  } catch (error) {
    return {
      ok: false,
      action: "uninstall",
      agentDir: context.agentDir,
      pluginPath: context.pluginPath,
      registration: null,
      changed: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
async function registerWithOmp(context) {
  if (await commandExists(context.ompBin)) {
    await context.runCommand(context.ompBin, ["plugin", "install", context.pluginPath], { cwd: context.agentDir });
    return "omp-cli";
  }
  await appendConfigExtension(context, context.pluginPath);
  return "config-yml";
}
async function unregisterFromOmp(context) {
  if (await commandExists(context.ompBin)) {
    await context.runCommand(context.ompBin, ["plugin", "uninstall", OMO_OMP_PACKAGE_NAME], { cwd: context.agentDir });
    return "omp-cli";
  }
  await removeConfigExtension(context, context.pluginPath);
  return "config-yml";
}
async function appendConfigExtension(context, pluginPath) {
  await mkdir(context.agentDir, { recursive: true });
  const configPath = join(context.agentDir, "config.yml");
  const existing = await readIfPresent(configPath);
  const state = parseConfigState(existing);
  const extensionEntry = toConfigExtensionEntry(pluginPath, context.platform);
  const next = state.hasExtensionsKey ? insertExtension(existing, extensionEntry) : `${existing}
extensions:
  - ${extensionEntry}
`;
  await backupAndWrite(configPath, next);
}
async function removeConfigExtension(context, pluginPath) {
  const configPath = join(context.agentDir, "config.yml");
  const existing = await readIfPresent(configPath);
  if (!parseConfigState(existing).hasExtensionsKey)
    return;
  const extensionEntry = toConfigExtensionEntry(pluginPath, context.platform);
  const next = existing.split(`
`).filter((line) => line.trim() !== `- ${extensionEntry}` && !line.includes(pluginPath)).join(`
`);
  await backupAndWrite(configPath, next);
}
function parseConfigState(content) {
  return {
    path: "",
    hasExtensionsKey: /^\s*extensions:/m.test(content)
  };
}
async function applyBundledAgentDisable(context) {
  const configPath = join(context.agentDir, "config.yml");
  const existing = await readIfPresent(configPath);
  const next = mergeTaskDisabledAgents(existing, BUNDLED_AGENTS_TO_DISABLE);
  if (next === existing)
    return;
  await backupAndWrite(configPath, next);
}
function mergeTaskDisabledAgents(content, names) {
  const listBlock = names.map((name) => `    - ${name}`).join(`
`);
  const keyOnlyTaskLine = /^task:[ \t]*(?:#.*)?$/m;
  const match = keyOnlyTaskLine.exec(content);
  if (match === null) {
    if (/^task:/m.test(content))
      return content;
    const separator = content.length === 0 || content.endsWith(`
`) ? "" : `
`;
    return `${content}${separator}task:
  disabledAgents:
${listBlock}
`;
  }
  const lines = content.split(`
`);
  const keyLine = content.slice(0, match.index).split(`
`).length - 1;
  let blockEnd = lines.length;
  for (let index = keyLine + 1;index < lines.length; index += 1) {
    if (/^\S/.test(lines[index])) {
      blockEnd = index;
      break;
    }
  }
  const withoutExisting = [...lines];
  const existingKey = withoutExisting.findIndex((line, index) => index > keyLine && index < blockEnd && /^  disabledAgents:/.test(line));
  if (existingKey !== -1) {
    let listEnd = existingKey + 1;
    while (listEnd < blockEnd && /^    - /.test(withoutExisting[listEnd]))
      listEnd += 1;
    withoutExisting.splice(existingKey, listEnd - existingKey);
  }
  const insertion = ["  disabledAgents:", ...names.map((name) => `    - ${name}`)];
  withoutExisting.splice(keyLine + 1, 0, ...insertion);
  return `${withoutExisting.join(`
`)}
`;
}
function insertExtension(content, entry) {
  const lines = content.split(`
`);
  const index = lines.findIndex((line) => /^\s*extensions:/m.test(line));
  const indent = /^(\s*)extensions:/.exec(lines[index] ?? "")?.[1] ?? "";
  if (index < 0)
    return content;
  const nextIndent = index + 1 < lines.length && lines[index + 1].trim().length > 0 ? /^(\s*)/.exec(lines[index + 1])?.[1] ?? "  " : indent === "" ? "  " : indent;
  lines.splice(index + 1, 0, `${nextIndent}- ${entry}`);
  return lines.join(`
`);
}
function toConfigExtensionEntry(pluginPath, platform) {
  return platform === "win32" ? pluginPath.replaceAll("\\", "/") : pluginPath;
}
async function readIfPresent(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isErrno(error, "ENOENT"))
      return "";
    throw error;
  }
}
async function backupAndWrite(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const backupPath = `${path}.omo-omp-${Date.now()}.bak`;
  const existing = await readIfPresent(path);
  if (existing !== "") {
    await writeFile(backupPath, existing);
  }
  await writeFile(path, content);
  return backupPath;
}
async function fileExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch (error) {
    if (isErrno(error, "ENOENT"))
      return false;
    throw error;
  }
}
async function commandExists(command) {
  if (command.includes("/") || command.includes("\\")) {
    return existsSync(command);
  }
  try {
    await execFileAsync(process.platform === "win32" ? "where" : "which", [command]);
    return true;
  } catch {
    return false;
  }
}
async function verifyAstGrepRuntimeIntegrity(pluginPath, platform) {
  const runtimeEntry = join(pluginPath, "runtime", "ast-grep-mcp", "cli.js");
  const manifestPath = join(dirname(runtimeEntry), "manifest.json");
  let runtimeStat;
  try {
    runtimeStat = await stat(runtimeEntry);
    if (!runtimeStat.isFile())
      throw new Error("runtime is not a file");
    await access(runtimeEntry, constants.R_OK | constants.X_OK);
  } catch (error) {
    throw astGrepIntegrityError(runtimeEntry, `runtime is unreadable or non-executable: ${messageOf(error)}`);
  }
  if (!await fileExists(manifestPath)) {
    throw astGrepIntegrityError(runtimeEntry, `manifest is missing: ${manifestPath}`);
  }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!isAstGrepRuntimeManifest(manifest)) {
    throw astGrepIntegrityError(runtimeEntry, `manifest is malformed: ${manifestPath}`);
  }
  const { createHash } = await import("node:crypto");
  const actualSha256 = createHash("sha256").update(await readFile(runtimeEntry)).digest("hex");
  if (actualSha256 !== manifest.sha256) {
    throw astGrepIntegrityError(runtimeEntry, `sha256 mismatch: manifest=${manifest.sha256} actual=${actualSha256}`);
  }
  const actualMode = runtimeStat.mode & 511;
  if (platform !== "win32" && actualMode !== manifest.mode) {
    throw astGrepIntegrityError(runtimeEntry, `mode mismatch: manifest=${manifest.mode} actual=${actualMode}`);
  }
}
function isAstGrepRuntimeManifest(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const record = value;
  return typeof record.sha256 === "string" && /^[a-f0-9]{64}$/.test(record.sha256) && typeof record.mode === "number" && Number.isInteger(record.mode) && typeof record.stagedAtUtc === "string" && !Number.isNaN(Date.parse(record.stagedAtUtc));
}
function astGrepIntegrityError(runtimeEntry, reason) {
  return new Error(`Packed omo-omp plugin ast-grep MCP runtime integrity error at ${runtimeEntry}: ${reason}`);
}
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
async function defaultRunCommand(command, args, options) {
  const result = await execFileAsync(command, [...args], { cwd: options.cwd });
  if (result.stderr.trim().length > 0)
    process.stderr.write(result.stderr);
  if (result.stdout.trim().length > 0)
    process.stdout.write(result.stdout);
}
function findRepoRoot(importerDir) {
  let current = importerDir;
  for (let depth = 0;depth <= 7; depth += 1) {
    if (fileExistsSync(join(current, "packages", "omo-omp", "plugin", "package.json")))
      return current;
    current = resolve(current, "..");
  }
  throw new Error("Unable to locate packages/omo-omp/plugin/package.json from installer module");
}
function fileExistsSync(path) {
  return existsSync(path);
}
function isErrno(error, code) {
  return error instanceof Error && "code" in error && error.code === code;
}

// packages/omo-omp/src/install/cli-local.ts
async function main(argv) {
  const action = argv[2];
  const packagedPluginPath = resolvePackagedPluginPath(import.meta.url);
  const options = packagedPluginPath === undefined ? {} : { pluginPath: packagedPluginPath };
  try {
    if (action === "install") {
      printJson(await runOmpInstaller(options));
      return 0;
    }
    if (action === "uninstall") {
      printJson(await runOmpUninstaller(options));
      return 0;
    }
    throw new Error("Expected positional action install|uninstall");
  } catch (error) {
    printJson({ ok: false, error: error instanceof Error ? error.message : String(error) });
    return 1;
  }
}
function printJson(result) {
  process.stdout.write(`${JSON.stringify(result)}
`);
}
function resolvePackagedPluginPath(importerUrl) {
  const scriptDir = dirname2(fileURLToPath2(importerUrl));
  const candidate = resolve2(scriptDir, "..");
  const manifestPath = join2(candidate, "package.json");
  if (!fileExistsSync2(manifestPath))
    return;
  const parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!isRecord(parsed) || parsed.name !== OMO_OMP_PACKAGE_NAME)
    return;
  if (!fileExistsSync2(join2(candidate, "extensions", "omo.js")))
    return;
  return candidate;
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
process.exit(await main(process.argv));
