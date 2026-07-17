#!/usr/bin/env bun
// @bun

// packages/omo-senpi/src/install/cli-local.ts
import { existsSync as existsSync2, readFileSync } from "fs";
import { dirname as dirname2, join as join2, resolve as resolve2 } from "path";
import { fileURLToPath as fileURLToPath2 } from "url";

// packages/omo-senpi/src/install/install-senpi.ts
import { execFile } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { access, copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
var execFileAsync = promisify(execFile);
var REQUIRED_PLUGIN_ARTIFACTS = [
  join("extensions", "omo.js"),
  join("skills", "ast-grep", "SKILL.md"),
  join("skills", "coding-agent-sessions", "SKILL.md"),
  join("skills", "debugging", "SKILL.md"),
  join("skills", "frontend", "SKILL.md"),
  join("skills", "git-master", "SKILL.md"),
  join("skills", "init-deep", "SKILL.md"),
  join("skills", "lsp-setup", "SKILL.md"),
  join("skills", "programming", "SKILL.md"),
  join("skills", "refactor", "SKILL.md"),
  join("skills", "remove-ai-slops", "SKILL.md"),
  join("skills", "review-work", "SKILL.md"),
  join("skills", "start-work", "SKILL.md"),
  join("skills", "ultimate-browsing", "SKILL.md"),
  join("skills", "ultrawork", "SKILL.md"),
  join("skills", "ulw-loop", "SKILL.md"),
  join("skills", "ulw-plan", "SKILL.md"),
  join("skills", "ulw-research", "SKILL.md"),
  join("skills", "visual-qa", "SKILL.md"),
  join("runtime", "lsp-daemon", "dist", "cli.js"),
  join("runtime", "lsp-daemon", "dist", "index.js"),
  join("runtime", "lsp-daemon", "dist", "index.d.ts"),
  join("runtime", "lsp-daemon", "dist", "daemon-client.js"),
  join("runtime", "lsp-daemon", "dist", "daemon-client.d.ts"),
  join("runtime", "lsp-daemon", "dist", "package.json"),
  join("runtime", "lsp-daemon", "dist", ".omo-runtime-manifest.json"),
  join("scripts", "install.mjs")
];
async function runSenpiInstaller(options = {}) {
  const context = resolveInstallContext(options);
  await ensurePluginArtifacts(context);
  const settings = await readSettings(context.settingsPath);
  const before = JSON.stringify(settings);
  const packages = dedupePackages(readPackages(settings));
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
  const repoRoot = resolve(options.repoRoot ?? (allowBuild ? findRepoRoot(dirname(fileURLToPath(import.meta.url))) : dirname(resolve(options.pluginPath))));
  const agentDir = resolve(options.agentDir ?? env.SENPI_CODING_AGENT_DIR ?? join(homedir(), ".senpi", "agent"));
  const pluginPath = resolve(options.pluginPath ?? join(repoRoot, "packages", "omo-senpi", "plugin"));
  return {
    env,
    repoRoot,
    agentDir,
    settingsPath: join(agentDir, "settings.json"),
    pluginPath,
    allowBuild,
    runCommand: options.runCommand ?? defaultRunCommand
  };
}
async function ensurePluginArtifacts(context) {
  const missing = await hasMissingPluginArtifact(context.pluginPath);
  if (!missing)
    return;
  if (!context.allowBuild) {
    throw new Error(`Packed omo-senpi plugin is missing required runtime artifacts at ${context.pluginPath}`);
  }
  await context.runCommand("node", [join(context.pluginPath, "scripts", "build-extension.mjs")], { cwd: context.repoRoot });
  await context.runCommand("node", [join("packages", "omo-codex", "plugin", "scripts", "materialize-shared-upstreams.mjs")], { cwd: context.repoRoot });
  await context.runCommand("node", [join(context.pluginPath, "scripts", "sync-skills.mjs")], { cwd: context.repoRoot });
  await context.runCommand("node", [join(context.pluginPath, "scripts", "build-install.mjs")], { cwd: context.repoRoot });
  await context.runCommand("node", [join(context.pluginPath, "scripts", "stage-lsp-daemon-runtime.mjs")], { cwd: context.repoRoot });
}
async function hasMissingPluginArtifact(pluginPath) {
  for (const artifact of REQUIRED_PLUGIN_ARTIFACTS) {
    if (!await fileExists(join(pluginPath, artifact)))
      return true;
  }
  return false;
}
async function defaultRunCommand(command, args, options) {
  const result = await execFileAsync(command, [...args], { cwd: options.cwd });
  if (result.stderr.trim().length > 0)
    process.stderr.write(result.stderr);
  if (result.stdout.trim().length > 0)
    process.stdout.write(result.stdout);
}
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
  if (!isPlainObject(parsed))
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
function findRepoRoot(importerDir) {
  let current = importerDir;
  for (let depth = 0;depth <= 7; depth += 1) {
    if (fileExistsSync(join(current, "packages", "omo-senpi", "plugin", "package.json")))
      return current;
    current = resolve(current, "..");
  }
  throw new Error("Unable to locate packages/omo-senpi/plugin/package.json from installer module");
}
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
function fileExistsSync(path) {
  return existsSync(path);
}
function isErrno(error, code) {
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
  const scriptDir = dirname2(fileURLToPath2(importerUrl));
  const candidate = resolve2(scriptDir, "..");
  const manifestPath = join2(candidate, "package.json");
  if (!existsSync2(manifestPath))
    return;
  const parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!isRecord(parsed) || parsed.name !== "@code-yeongyu/omo-senpi")
    return;
  if (!existsSync2(join2(candidate, "extensions", "omo.js")))
    return;
  return candidate;
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
process.exit(await main(process.argv));
