#!/usr/bin/env bun
// @bun

// packages/omo-senpi/src/install/cli-local.ts
import { existsSync as existsSync2, readFileSync } from "fs";
import { dirname as dirname3, join as join3, resolve as resolve3 } from "path";
import { fileURLToPath as fileURLToPath2 } from "url";

// packages/omo-senpi/src/install/install-senpi.ts
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as constants2, existsSync } from "node:fs";
import { access as access2, readFile as readFile2, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname as dirname2, join as join2, resolve as resolve2 } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

// packages/omo-senpi/src/install/senpi-settings.ts
import { constants } from "node:fs";
import { access, copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
var OMO_SENPI_PACKAGE_NAME = "@code-yeongyu/omo-senpi";
var LEGACY_BUILTIN_SHADOW_PACKAGES = [
  join("packages", "pi-goal"),
  join("packages", "pi-webfetch")
];
async function readSettings(settingsPath) {
  let raw;
  try {
    raw = await readFile(settingsPath, "utf8");
  } catch (error) {
    if (isErrno(error, "ENOENT"))
      return {};
    throw error;
  }
  const parsed = JSON.parse(raw);
  if (!isRecord(parsed))
    throw new Error(`${settingsPath} must contain a JSON object`);
  return parsed;
}
function readPackages(settings) {
  const packages = settings.packages;
  if (packages === undefined)
    return [];
  if (!Array.isArray(packages) || !packages.every((entry) => typeof entry === "string")) {
    throw new Error("Senpi settings packages must be an array of strings");
  }
  return packages;
}
function dedupePackages(packages) {
  return [...new Set(packages)];
}
function removeLegacyBuiltinShadows(packages, repoRoot, agentDir) {
  const shadowPaths = new Set(LEGACY_BUILTIN_SHADOW_PACKAGES.map((path) => resolve(repoRoot, path)));
  return packages.filter((entry) => !shadowPaths.has(resolve(agentDir, entry)));
}
async function removeSupersededOmoPackages(packages, currentPluginPath, agentDir) {
  const currentPath = resolve(currentPluginPath);
  const entries = await Promise.all(packages.map(async (entry) => {
    const packagePath = resolve(agentDir, entry);
    if (packagePath === currentPath)
      return currentPath;
    return await readPackageName(packagePath) === OMO_SENPI_PACKAGE_NAME ? undefined : entry;
  }));
  return entries.filter((entry) => entry !== undefined);
}
async function writeSettingsAtomically(settingsPath, settings) {
  await mkdir(dirname(settingsPath), { recursive: true });
  const backupPath = await nextBackupPath(settingsPath);
  if (await fileExists(settingsPath)) {
    await copyFile(settingsPath, backupPath);
  } else {
    await writeFile(backupPath, `{}
`, "utf8");
  }
  const tempPath = `${settingsPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(settings, null, 2)}
`, "utf8");
  await rename(tempPath, settingsPath);
  return backupPath;
}
async function nextBackupPath(settingsPath) {
  for (let index = 0;index < 1000; index += 1) {
    const suffix = index === 0 ? "" : `-${index}`;
    const candidate = `${settingsPath}.${timestampForBackup()}${suffix}.backup`;
    if (!await fileExists(candidate))
      return candidate;
  }
  throw new Error(`Unable to allocate backup path for ${settingsPath}`);
}
function timestampForBackup() {
  return new Date().toISOString().replace(/[-:.]/g, "");
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
async function readPackageName(packagePath) {
  let raw;
  try {
    raw = await readFile(join(packagePath, "package.json"), "utf8");
  } catch (error) {
    if (isErrno(error, "ENOENT") || isErrno(error, "ENOTDIR"))
      return;
    throw error;
  }
  const parsed = JSON.parse(raw);
  return isRecord(parsed) && typeof parsed.name === "string" ? parsed.name : undefined;
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
function isErrno(error, code) {
  return error instanceof Error && "code" in error && error.code === code;
}

// packages/omo-senpi/src/install/install-senpi.ts
var execFileAsync = promisify(execFile);
var REQUIRED_PLUGIN_ARTIFACTS = [
  join2("extensions", "omo.js"),
  join2("skills", "ast-grep", "SKILL.md"),
  join2("skills", "coding-agent-sessions", "SKILL.md"),
  join2("skills", "debugging", "SKILL.md"),
  join2("skills", "frontend", "SKILL.md"),
  join2("skills", "git-master", "SKILL.md"),
  join2("skills", "init-deep", "SKILL.md"),
  join2("skills", "lsp-setup", "SKILL.md"),
  join2("skills", "programming", "SKILL.md"),
  join2("skills", "refactor", "SKILL.md"),
  join2("skills", "remove-ai-slops", "SKILL.md"),
  join2("skills", "review-work", "SKILL.md"),
  join2("skills", "start-work", "SKILL.md"),
  join2("skills", "ultimate-browsing", "SKILL.md"),
  join2("skills", "ultrawork", "SKILL.md"),
  join2("skills", "ulw-loop", "SKILL.md"),
  join2("skills", "ulw-plan", "SKILL.md"),
  join2("skills", "ulw-research", "SKILL.md"),
  join2("skills", "visual-qa", "SKILL.md"),
  join2("runtime", "ast-grep-mcp", "cli.js"),
  join2("runtime", "agent-toolkit", "cli.js"),
  join2("runtime", "agent-toolkit", "ulw-loop", "cli.js"),
  join2("runtime", "agent-toolkit", "omo-agent-toolkit"),
  join2("runtime", "agent-toolkit", "omo-agent-toolkit.cmd"),
  join2("runtime", "lsp-daemon", "dist", "cli.js"),
  join2("runtime", "lsp-daemon", "dist", "index.js"),
  join2("runtime", "lsp-daemon", "dist", "index.d.ts"),
  join2("runtime", "lsp-daemon", "dist", "daemon-client.js"),
  join2("runtime", "lsp-daemon", "dist", "daemon-client.d.ts"),
  join2("runtime", "lsp-daemon", "dist", "package.json"),
  join2("runtime", "lsp-daemon", "dist", ".omo-runtime-manifest.json"),
  join2("scripts", "install.mjs")
];
async function runSenpiInstaller(options = {}) {
  const context = resolveInstallContext(options);
  await ensurePluginArtifacts(context);
  const settings = await readSettings(context.settingsPath);
  const before = JSON.stringify(settings);
  const packages = dedupePackages(await removeSupersededOmoPackages(removeLegacyBuiltinShadows(dedupePackages(readPackages(settings)), context.repoRoot, context.agentDir), context.pluginPath, context.agentDir));
  if (!packages.includes(context.pluginPath))
    packages.push(context.pluginPath);
  settings.packages = packages;
  const backupPath = await writeSettingsAtomically(context.settingsPath, settings);
  return {
    ok: true,
    action: "install",
    agentDir: context.agentDir,
    settingsPath: context.settingsPath,
    pluginPath: context.pluginPath,
    changed: JSON.stringify(settings) !== before,
    backupPath
  };
}
async function runSenpiUninstaller(options = {}) {
  const context = resolveInstallContext(options);
  const settings = await readSettings(context.settingsPath);
  const before = JSON.stringify(settings);
  const packages = dedupePackages(readPackages(settings));
  const nextPackages = packages.filter((entry) => entry !== context.pluginPath);
  settings.packages = nextPackages;
  const backupPath = await writeSettingsAtomically(context.settingsPath, settings);
  return {
    ok: true,
    action: "uninstall",
    agentDir: context.agentDir,
    settingsPath: context.settingsPath,
    pluginPath: context.pluginPath,
    changed: JSON.stringify(settings) !== before,
    backupPath,
    removed: nextPackages.length !== packages.length
  };
}
function resolveInstallContext(options) {
  const env = options.env ?? process.env;
  const allowBuild = options.pluginPath === undefined;
  const repoRoot = resolve2(options.repoRoot ?? (allowBuild ? findRepoRoot(dirname2(fileURLToPath(import.meta.url))) : dirname2(resolve2(options.pluginPath))));
  const agentDir = resolve2(options.agentDir ?? env.SENPI_CODING_AGENT_DIR ?? join2(homedir(), ".senpi", "agent"));
  const pluginPath = resolve2(options.pluginPath ?? join2(repoRoot, "packages", "omo-senpi", "plugin"));
  return {
    env,
    repoRoot,
    agentDir,
    settingsPath: join2(agentDir, "settings.json"),
    pluginPath,
    platform: options.platform ?? process.platform,
    allowBuild,
    runCommand: options.runCommand ?? defaultRunCommand
  };
}
async function ensurePluginArtifacts(context) {
  if (context.allowBuild) {
    await context.runCommand("node", [join2(context.pluginPath, "scripts", "build-extension.mjs")], { cwd: context.repoRoot });
    await context.runCommand("node", [join2("packages", "omo-codex", "plugin", "scripts", "materialize-shared-upstreams.mjs")], { cwd: context.repoRoot });
    await context.runCommand("node", [join2(context.pluginPath, "scripts", "sync-skills.mjs")], { cwd: context.repoRoot });
    await context.runCommand("node", [join2(context.pluginPath, "scripts", "build-install.mjs")], { cwd: context.repoRoot });
    await context.runCommand("node", [join2(context.pluginPath, "scripts", "stage-lsp-daemon-runtime.mjs")], { cwd: context.repoRoot });
    await context.runCommand("node", [join2(context.pluginPath, "scripts", "stage-ast-grep-mcp-runtime.mjs")], { cwd: context.repoRoot });
    await context.runCommand("node", [join2(context.pluginPath, "scripts", "stage-agent-toolkit.mjs")], { cwd: context.repoRoot });
  }
  if (await hasMissingPluginArtifact(context.pluginPath)) {
    throw new Error(`Packed omo-senpi plugin is missing required runtime artifacts at ${context.pluginPath}`);
  }
  await verifyAstGrepRuntimeIntegrity(context.pluginPath, context.platform);
}
async function hasMissingPluginArtifact(pluginPath) {
  for (const artifact of REQUIRED_PLUGIN_ARTIFACTS) {
    if (!await fileExists2(join2(pluginPath, artifact)))
      return true;
  }
  return false;
}
async function verifyAstGrepRuntimeIntegrity(pluginPath, platform) {
  const runtimeEntry = join2(pluginPath, "runtime", "ast-grep-mcp", "cli.js");
  const manifestPath = join2(dirname2(runtimeEntry), "manifest.json");
  let runtimeStat;
  try {
    runtimeStat = await stat(runtimeEntry);
    if (!runtimeStat.isFile())
      throw new Error("runtime is not a file");
    await access2(runtimeEntry, constants2.R_OK | constants2.X_OK);
  } catch (error) {
    throw astGrepIntegrityError(runtimeEntry, `runtime is unreadable or non-executable: ${messageOf(error)}`);
  }
  if (!await fileExists2(manifestPath)) {
    throw astGrepIntegrityError(runtimeEntry, `manifest is missing: ${manifestPath}`);
  }
  let manifest;
  try {
    manifest = JSON.parse(await readFile2(manifestPath, "utf8"));
  } catch (error) {
    throw astGrepIntegrityError(runtimeEntry, `manifest is unreadable or invalid JSON: ${messageOf(error)}`);
  }
  if (!isAstGrepRuntimeManifest(manifest)) {
    throw astGrepIntegrityError(runtimeEntry, `manifest is malformed: ${manifestPath}`);
  }
  let actualSha256;
  try {
    actualSha256 = createHash("sha256").update(await readFile2(runtimeEntry)).digest("hex");
  } catch (error) {
    throw astGrepIntegrityError(runtimeEntry, `runtime hash could not be computed: ${messageOf(error)}`);
  }
  if (actualSha256 !== manifest.sha256) {
    throw astGrepIntegrityError(runtimeEntry, `sha256 mismatch: manifest=${manifest.sha256} actual=${actualSha256}`);
  }
  const actualMode = runtimeStat.mode & 511;
  if (platform !== "win32" && actualMode !== manifest.mode) {
    throw astGrepIntegrityError(runtimeEntry, `mode mismatch: manifest=${manifest.mode} actual=${actualMode}`);
  }
}
function isAstGrepRuntimeManifest(value) {
  if (!isRecord(value))
    return false;
  return typeof value.sha256 === "string" && /^[a-f0-9]{64}$/.test(value.sha256) && typeof value.mode === "number" && Number.isInteger(value.mode) && typeof value.stagedAtUtc === "string" && !Number.isNaN(Date.parse(value.stagedAtUtc));
}
function astGrepIntegrityError(runtimeEntry, reason) {
  return new Error(`Packed omo-senpi plugin ast-grep MCP runtime integrity error at ${runtimeEntry}: ${reason}`);
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
    if (fileExistsSync(join2(current, "packages", "omo-senpi", "plugin", "package.json")))
      return current;
    current = resolve2(current, "..");
  }
  throw new Error("Unable to locate packages/omo-senpi/plugin/package.json from installer module");
}
async function fileExists2(path) {
  try {
    await access2(path, constants2.F_OK);
    return true;
  } catch (error) {
    if (isErrno2(error, "ENOENT"))
      return false;
    throw error;
  }
}
function fileExistsSync(path) {
  return existsSync(path);
}
function isErrno2(error, code) {
  return error instanceof Error && "code" in error && error.code === code;
}

// packages/omo-senpi/src/install/cli-local.ts
async function main(argv) {
  const action = argv[2];
  const packagedPluginPath = resolvePackagedPluginPath(import.meta.url);
  try {
    if (action === "install") {
      printJson(await runSenpiInstaller(packagedPluginPath === undefined ? {} : { pluginPath: packagedPluginPath }));
      return 0;
    }
    if (action === "uninstall") {
      printJson(await runSenpiUninstaller(packagedPluginPath === undefined ? {} : { pluginPath: packagedPluginPath }));
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
  const scriptDir = dirname3(fileURLToPath2(importerUrl));
  const candidate = resolve3(scriptDir, "..");
  const manifestPath = join3(candidate, "package.json");
  if (!existsSync2(manifestPath))
    return;
  const parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!isRecord2(parsed) || parsed.name !== "@code-yeongyu/omo-senpi")
    return;
  if (!existsSync2(join3(candidate, "extensions", "omo.js")))
    return;
  return candidate;
}
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
process.exit(await main(process.argv));
