#!/usr/bin/env bun
// @bun

// packages/omo-senpi/src/install/cli-local.ts
import { existsSync as existsSync4, readFileSync as readFileSync2 } from "fs";
import { dirname as dirname5, join as join6, resolve as resolve5 } from "path";
import { fileURLToPath as fileURLToPath2 } from "url";

// packages/omo-senpi/src/install/install-senpi.ts
import { execFile } from "node:child_process";
import { existsSync as existsSync3 } from "node:fs";
import { homedir as homedir3 } from "node:os";
import { dirname as dirname4, join as join5, resolve as resolve4 } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

// packages/senpi-task/src/agent-home.ts
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
var AGENT_DIR_ENV_NAMES = [
  "OMO_CODING_AGENT_DIR",
  "SENPI_CODING_AGENT_DIR",
  "PI_CODING_AGENT_DIR"
];
var AGENT_HOME_SENTINEL = "settings.json";
function resolveAgentHome(options) {
  const { env, homeDir = homedir(), exists = existsSync } = options;
  for (const name of AGENT_DIR_ENV_NAMES) {
    const configured = env[name]?.trim();
    if (configured)
      return resolve(configured);
  }
  const brandedHome = join(homeDir, ".omo");
  const canonical = join(brandedHome, "agent");
  if (exists(join(canonical, AGENT_HOME_SENTINEL)))
    return canonical;
  if (exists(join(brandedHome, AGENT_HOME_SENTINEL)))
    return brandedHome;
  return join(homeDir, ".senpi", "agent");
}
// packages/omo-senpi/src/install/local-launcher.ts
import { chmodSync, existsSync as existsSync2, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { dirname, join as join2, resolve as resolve2 } from "node:path";

// packages/omo-native/bin/lib/brand-logo.generated.js
var OMO_BRAND_LOGO = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDI0IDEwMjQiPgogIDxwYXRoIGZpbGw9IiNGNEY0RjQiIGQ9Ik01MTIuMDAgMTAwLjUwIEM1OTEuMTMgMTAwLjUwIDY5Ny42NiAxMDIuMzcgNzQ5LjM5IDEwNi4yNyBDODAxLjExIDExMC4xNyA4MDIuMzUgMTE1Ljg0IDgyMi4zNSAxMjMuOTAgQzg0Mi4zNCAxMzEuOTYgODU2LjQwIDE0MS42OCA4NjkuMzYgMTU0LjY0IEM4ODIuMzIgMTY3LjYwIDg5Mi4wNCAxODEuNjYgOTAwLjEwIDIwMS42NSBDOTA4LjE2IDIyMS42NSA5MTMuODMgMjIyLjg5IDkxNy43MyAyNzQuNjEgQzkyMS42MyAzMjYuMzQgOTIzLjUwIDQzMi44NyA5MjMuNTAgNTEyLjAwIEM5MjMuNTAgNTkxLjEzIDkyMS42MyA2OTcuNjYgOTE3LjczIDc0OS4zOSBDOTEzLjgzIDgwMS4xMSA5MDguMTYgODAyLjM1IDkwMC4xMCA4MjIuMzUgQzg5Mi4wNCA4NDIuMzQgODgyLjMyIDg1Ni40MCA4NjkuMzYgODY5LjM2IEM4NTYuNDAgODgyLjMyIDg0Mi4zNCA4OTIuMDQgODIyLjM1IDkwMC4xMCBDODAyLjM1IDkwOC4xNiA4MDEuMTEgOTEzLjgzIDc0OS4zOSA5MTcuNzMgQzY5Ny42NiA5MjEuNjMgNTkxLjEzIDkyMy41MCA1MTIuMDAgOTIzLjUwIEM0MzIuODcgOTIzLjUwIDMyNi4zNCA5MjEuNjMgMjc0LjYxIDkxNy43MyBDMjIyLjg5IDkxMy44MyAyMjEuNjUgOTA4LjE2IDIwMS42NSA5MDAuMTAgQzE4MS42NiA4OTIuMDQgMTY3LjYwIDg4Mi4zMiAxNTQuNjQgODY5LjM2IEMxNDEuNjggODU2LjQwIDEzMS45NiA4NDIuMzQgMTIzLjkwIDgyMi4zNSBDMTE1Ljg0IDgwMi4zNSAxMTAuMTcgODAxLjExIDEwNi4yNyA3NDkuMzkgQzEwMi4zNyA2OTcuNjYgMTAwLjUwIDU5MS4xMyAxMDAuNTAgNTEyLjAwIEMxMDAuNTAgNDMyLjg3IDEwMi4zNyAzMjYuMzQgMTA2LjI3IDI3NC42MSBDMTEwLjE3IDIyMi44OSAxMTUuODQgMjIxLjY1IDEyMy45MCAyMDEuNjUgQzEzMS45NiAxODEuNjYgMTQxLjY4IDE2Ny42MCAxNTQuNjQgMTU0LjY0IEMxNjcuNjAgMTQxLjY4IDE4MS42NiAxMzEuOTYgMjAxLjY1IDEyMy45MCBDMjIxLjY1IDExNS44NCAyMjIuODkgMTEwLjE3IDI3NC42MSAxMDYuMjcgQzMyNi4zNCAxMDIuMzcgNDMyLjg3IDEwMC41MCA1MTIuMDAgMTAwLjUwWiIvPgogIDxnIHRyYW5zZm9ybT0ic2NhbGUoMC41KSI+CiAgICA8ZyB0cmFuc2Zvcm09InRyYW5zbGF0ZSgwLjAwMDAwMCwyMDQ4LjAwMDAwMCkgc2NhbGUoMC4wNTAwMDAsLTAuMDUwMDAwKSI+CiAgICAgIDxwYXRoIGZpbGw9IiMwNDE2MTciIGZpbGwtcnVsZT0iZXZlbm9kZCIgZD0iTTkyNzAgMzIxNjcgYy0zMDkgLTY0IC00NTYgLTE1MiAtNjIxIC0zNzMgLTU2MiAtNzQ4IC03NzYgLTI2ODkKLTU0NyAtNDk4NCAxMTggLTExODcgMzI1IC0yNjAwIDU3MCAtMzg5MCAxNDMgLTc1MyAxNTIgLTY1MyAtMTI4IC0xMzgwIC00MDMKLTEwNDUgLTY0MyAtMTg3MyAtODEyIC0yODAwIC04NTMgLTQ2ODkgMTk3OSAtNzk4NiA3ODU4IC05MTQ4IDExNDAgLTIyNSAyNTE0Ci0zOTcgMzIwMiAtNDAwIGwzNjEgLTIgNzkgNTUgYzI2NCAxODIgMjEwIDY0MiAtMTExIDk0MiAtMzg3IDM2MiAtOTUwIDUzMgotMjgwMSA4NDUgLTMwMDQgNTA3IC00MjQ5IDk2NSAtNTUyMCAyMDMwIC0xMzU4IDExMzggLTIwMTIgMjg3OCAtMTgwOSA0ODEwCjU0NSA1MTk1IDY2MTcgODcyNiAxMzUyOSA3ODY2IDU1MDYgLTY4NCA5NDgwIC00MjU1IDk0ODAgLTg1MTggMCAtMjYwNyAtMTQ2MgotNDUyMiAtNDE1NyAtNTQ0OCAtOTI3IC0zMTggLTE1MzQgLTQ1OSAtMzIwMyAtNzQwIC0xODUxIC0zMTMgLTI0MTQgLTQ4MwotMjgwMSAtODQ1IC0zMjEgLTMwMCAtMzc1IC03NjAgLTExMSAtOTQyIGw3OSAtNTUgMzYxIDIgYzY4OCAzIDIwNjIgMTc1IDMyMDIKNDAwIDU4NzkgMTE2MiA4NzExIDQ0NTkgNzg1OCA5MTQ4IC0xNjkgOTI3IC00MDkgMTc1NSAtODEyIDI4MDAgLTI4MCA3MjcKLTI3MSA2MjcgLTEyOCAxMzgwIDI0NSAxMjkwIDQ1MiAyNzAzIDU3MCAzODkwIDI3MSAyNzIwIC03NyA0ODYxIC04NTUgNTI1OQotNzU4IDM4OCAtMjMxMCAtMjM4IC01MDIxIC0yMDI0IC04NjggLTU3MSAtNzY0IC01NTcgLTE0ODkgLTIxMSAtMzI3MSAxNTU4Ci02NzU1IDE1NTggLTEwMDI2IDAgLTcyNSAtMzQ2IC02MjEgLTM2MCAtMTQ4OSAyMTEgLTIzNzEgMTU2MiAtMzk1OSAyMjc4Ci00NzA4IDIxMjJ6IG00MTMyIC0zMzQ1IGMxNzUgLTE3NSAxMjQgLTI2OCAtNDA5IC03MzkgLTEwMjggLTkxMCAtMTk5NSAtMjA1MwotMjcxMyAtMzIwOSAtOTcgLTE1NiAtMjAwIC0zMTggLTIyOCAtMzU5IC0yMjEgLTMyMSAtNjQ2IC03NiAtNDY5IDI3MCAxNTMKMzAxIDg4MyAxMzM0IDEzODggMTk2NSA1NzggNzIzIDE0NjYgMTYxNCAyMDI5IDIwMzUgMTkxIDE0MiAyODggMTUxIDQwMiAzN3oKbTE0NTA3IC0xIGM0OTYgLTM0MSAxNDgyIC0xMzIzIDIwODAgLTIwNzEgNTA1IC02MzEgMTIzNSAtMTY2NCAxMzg4IC0xOTY1CjE3NyAtMzQ2IC0yNDggLTU5MSAtNDY5IC0yNzAgLTI4IDQxIC0xMzEgMjAzIC0yMjggMzU5IC03MTggMTE1NiAtMTY4NSAyMjk5Ci0yNzEzIDMyMDkgLTUzNSA0NzMgLTU4NSA1NjQgLTQwNyA3NDIgMTAwIDEwMCAxOTkgOTkgMzQ5IC00eiBNMTk5MTAgMjUzMDggYy00MDM5IC0yMDUgLTcyMTIgLTE2NjYgLTkwODYgLTQxODQgLTE4NDAgLTI0NzMgLTE3NTMKLTU3OTQgMTk2IC03NTQwIDExNjEgLTEwNDAgMjQ0NyAtMTUxOCA1NDIwIC0yMDE1IDEzNzQgLTIyOSAxOTk4IC0zODAgMjQ1NgotNTkxIDc1NCAtMzQ4IDExNjMgLTEwMDAgMTAzMyAtMTY1MCAtMTAgLTQ5IC0xIC03MiA0NyAtMTI0IGw2MCAtNjQgNDQ0IDAKNDQ0IDAgNjAgNjQgYzQ4IDUyIDU3IDc1IDQ3IDEyNCAtMTMwIDY1MCAyNzkgMTMwMiAxMDMzIDE2NTAgNDU4IDIxMSAxMDgyCjM2MiAyNDU2IDU5MSAyOTczIDQ5NyA0MjU5IDk3NSA1NDIwIDIwMTUgMjA4NCAxODY2IDIwMjYgNTM3NCAtMTMxIDc5NTYKLTIwNjMgMjQ2OSAtNTk5NSAzOTY2IC05ODk5IDM3Njh6IG0tNDY0NCAtNDM3NCBjMTM1NiAtMzYwIDIyNzIgLTE5MDkgMTk5OAotMzM3OCAtNDI2IC0yMjc4IC0yODU2IC0zMTQ0IC00NDI0IC0xNTc2IC0xNDk3IDE0OTYgLTkyNCA0MjE4IDEwMzEgNDg5OSAzOTMKMTM3IDk5NiAxNjEgMTM5NSA1NXogbTExNDgwIDM1IGMxNDkxIC0yNjEgMjUwNCAtMTkyMSAyMTU0IC0zNTMyIC00ODcgLTIyNDcKLTMxMDggLTMwMjQgLTQ1MjUgLTEzNDEgLTE3MTkgMjA0MiAtMTI5IDUzMTAgMjM3MSA0ODczeiBtLTY5NDggLTI5ODAgYzE3MgotNDAgMzQxIC0xMzMgNDk1IC0yNzMgOTUgLTg2IDE0MyAtMTE2IDE4NyAtMTE2IDQ0IDAgOTIgMzAgMTg3IDExNiA3MTggNjUwCjE3MTYgMTg4IDE4NTQgLTg2MCAzNSAtMjY3IDE4IC05NjggLTI1IC0xMDQ4IC0xMTkgLTIxOSAtMzUwIC0yNTEgLTQ5MSAtNjgKLTY4IDg5IC03MyAxMjQgLTg1IDY3MCAtMTMgNjIzIC0yNSA2NzUgLTIwMCA4MzggLTIxMiAxOTggLTUxNiAxOTkgLTczNSAyCi0xODAgLTE2MSAtMTkyIC0yMTIgLTIwNSAtODQwIC0xMiAtNTQ2IC0xNyAtNTgxIC04NSAtNjcwIC0xMjIgLTE1OSAtMzA4Ci0xNTkgLTQzMCAwIC02OCA4OSAtNzMgMTI0IC04NSA2NzAgLTEzIDYyOCAtMjUgNjc5IC0yMDUgODQwIC0yMTkgMTk3IC01MjMKMTk2IC03MzUgLTIgLTE3NSAtMTYzIC0xODcgLTIxNSAtMjAwIC04MzggLTEyIC01NDYgLTE3IC01ODEgLTg1IC02NzAgLTE0MQotMTgzIC0zNzIgLTE1MSAtNDkxIDY4IC03NCAxMzYgLTU0IDEwMzkgMzAgMTMzMiAxNzAgNTk0IDc1OCA5NzggMTMwNCA4NDl6IE0xNDM0MCAyMDI5MCBjLTE4NTggLTM3MiAtMjIzMCAtMzIyOCAtNTQ2IC00MTkxIDEyODAgLTczMiAyNzg2IDMzOAoyNzg2IDE5ODEgMCAxMzkxIC0xMDY4IDI0NDUgLTIyNDAgMjIxMHogTTI1OTkwIDIwMjkxIGMtMTczMyAtMzQzIC0yMjA4IC0yOTgxIC03MzIgLTQwNjkgMTI4NyAtOTQ5IDI5ODEgMTA4CjI5ODIgMTg2MCAwIDEzOTIgLTEwNzAgMjQ0MyAtMjI1MCAyMjA5eiIvPgogICAgPC9nPgogIDwvZz4KPC9zdmc+Cg==";

// packages/omo-senpi/src/install/local-launcher.ts
var MARKER = "omo-local-launcher";
function localLauncherPath(homeDir = homedir2()) {
  return join2(homeDir, ".local", "bin", "omo");
}
function localLauncherCmdPath(homeDir = homedir2()) {
  return join2(homeDir, ".local", "bin", "omo.cmd");
}
function releaseChannel(version) {
  return version !== undefined && version.includes("-") ? "beta" : "latest";
}
function renderLocalLauncher(options) {
  const channel = releaseChannel(options.version);
  const updateCommand = channel === "beta" ? "bun add -g omo-ai@beta" : "bun add -g omo-ai";
  const brand = {
    name: "OmO",
    logo: OMO_BRAND_LOGO,
    command: "omo",
    displayVersion: options.version ?? "local",
    configDir: ".omo",
    flatLayout: false,
    envPrefix: "OMO",
    userAgent: "omo",
    originator: "omo",
    changelog: {
      path: join2(options.pluginPath, "CHANGELOG.md").replaceAll("\\", "/")
    },
    update: {
      packageName: "omo-ai",
      distTag: channel,
      command: updateCommand,
      changelogUrl: "https://github.com/code-yeongyu/oh-my-openagent/releases"
    }
  };
  return `#!/usr/bin/env node
// ${MARKER}: generated by the omo-senpi installer. Delete this file to remove the local launcher.
import { spawn } from "node:child_process"
import { homedir } from "node:os"
import { join } from "node:path"

const brand = ${JSON.stringify(brand)}
const cli = process.env.OMO_SENPI_CLI_PATH ?? ${JSON.stringify(options.senpiCliPath)}
const plugin = process.env.OMO_PLUGIN_ROOT ?? ${JSON.stringify(options.pluginPath)}
// The same directory the published launcher pins, so a local install shares one state location
// with the published one and with anything either of them spawns.
const agentDir = process.env.OMO_CODING_AGENT_DIR ?? process.env.SENPI_CODING_AGENT_DIR
  ?? process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".omo", "agent")
const env = {
  ...process.env,
  SENPI_BRAND: JSON.stringify(brand),
  OMO_NATIVE: "1",
  OMO_CODING_AGENT_DIR: agentDir,
  SENPI_CODING_AGENT_DIR: agentDir,
}
// Anything resolving the product by name must re-enter through this launcher, never the engine.
env.OMO_BIN = process.argv[1]
const selfUpdate = process.argv[2] === "update"
  && process.argv.slice(3).every((arg) => arg.startsWith("-") || ["self", "senpi", "omo"].includes(arg))
  && !process.argv.slice(3).some((arg) => arg === "--extensions" || arg === "--models")
if (selfUpdate) {
  console.log(${JSON.stringify(`omo is updated via bun: ${updateCommand}`)})
  process.exit(0)
}
// windowsHide-exempt: this is the interactive foreground CLI, spawned with inherited stdio.
// CREATE_NO_WINDOW would suppress the console a console-less launch needs to render the TUI,
// so the launcher keeps the user's console instead of hiding it (#8501).
const child = spawn(process.execPath, [cli, "--extension", plugin, ...process.argv.slice(2)], {
  env,
  stdio: "inherit",
})
child.on("close", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exitCode = code ?? 1
})
`;
}
function installLocalLauncher(options) {
  const path = localLauncherPath(options.homeDir);
  if (existsSync2(path) && !readFileSync(path, "utf8").includes(MARKER))
    return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, renderLocalLauncher(options));
  chmodSync(path, 493);
  if ((options.platform ?? process.platform) === "win32") {
    writeFileSync(localLauncherCmdPath(options.homeDir), `@echo off\r
node "%~dp0omo" %*\r
`);
  }
  return path;
}
function uninstallLocalLauncher(homeDir = homedir2()) {
  const path = resolve2(localLauncherPath(homeDir));
  if (!existsSync2(path))
    return false;
  if (!readFileSync(path, "utf8").includes(MARKER))
    return false;
  rmSync(path);
  const cmd = localLauncherCmdPath(homeDir);
  if (existsSync2(cmd))
    rmSync(cmd);
  return true;
}

// packages/omo-senpi/src/install/plugin-artifacts.ts
import { createHash } from "node:crypto";
import { constants as constants2 } from "node:fs";
import { access as access2, readFile as readFile2, stat } from "node:fs/promises";
import { dirname as dirname3, join as join4 } from "node:path";

// packages/memory-core/src/personas/manifest.ts
var PERSONA_ASSET_FILENAMES = {
  reflection: "reflection-persona.md",
  dream: "dream-persona.md",
  facts: "facts-persona.md",
  kibitzer: "kibitzer-persona.md"
};
var PERSONA_ASSET_FILES = [
  PERSONA_ASSET_FILENAMES.reflection,
  PERSONA_ASSET_FILENAMES.dream,
  PERSONA_ASSET_FILENAMES.facts,
  PERSONA_ASSET_FILENAMES.kibitzer
];

// packages/omo-senpi/src/install/senpi-settings.ts
import { constants } from "node:fs";
import { access, copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname as dirname2, join as join3, resolve as resolve3 } from "node:path";
var OMO_SENPI_PACKAGE_NAME = "@code-yeongyu/omo-senpi";
var GENERATED_PLUGIN_BASENAME = /^omo-senpi-cli-plugin-[A-Za-z0-9]{6}$/;
var LEGACY_BUILTIN_SHADOW_PACKAGES = [
  join3("packages", "pi-goal"),
  join3("packages", "pi-webfetch")
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
  const shadowPaths = new Set(LEGACY_BUILTIN_SHADOW_PACKAGES.map((path) => resolve3(repoRoot, path)));
  return packages.filter((entry) => !shadowPaths.has(resolve3(agentDir, entry)));
}
async function removeSupersededOmoPackages(packages, currentPluginPath, agentDir) {
  const currentPath = resolve3(currentPluginPath);
  const entries = await Promise.all(packages.map(async (entry) => {
    const packagePath = resolve3(agentDir, entry);
    if (packagePath === currentPath)
      return currentPath;
    if (await readPackageName(packagePath) === OMO_SENPI_PACKAGE_NAME)
      return;
    if (GENERATED_PLUGIN_BASENAME.test(basename(entry)) && !await fileExists(packagePath))
      return;
    return entry;
  }));
  return entries.filter((entry) => entry !== undefined);
}
async function writeSettingsAtomically(settingsPath, settings) {
  await mkdir(dirname2(settingsPath), { recursive: true });
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
    raw = await readFile(join3(packagePath, "package.json"), "utf8");
  } catch (error) {
    if (isErrno(error, "ENOENT") || isErrno(error, "ENOTDIR"))
      return;
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    if (error instanceof SyntaxError)
      return;
    throw error;
  }
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

// packages/omo-senpi/src/install/plugin-artifacts.ts
var REQUIRED_PLUGIN_ARTIFACTS = [
  join4("extensions", "omo.js"),
  join4("extensions", "omo-task.js"),
  join4("extensions", "omo-computer-use.js"),
  join4("extensions", "omo-memory-doctor.js"),
  join4("extensions", "omo-memory-memfs.js"),
  join4("extensions", "omo-memory-palace.js"),
  join4("extensions", "omo-device-account.js"),
  join4("extensions", "omo-memory-commands.js"),
  join4("extensions", "omo-session-history.js"),
  join4("extensions", "omo-recall-store.js"),
  join4("extensions", "omo-telemetry-posthog.js"),
  join4("extensions", "omo-telemetry-otlp.js"),
  join4("extensions", "omo-memory-sync.js"),
  join4("extensions", "loro_wasm_bg.wasm"),
  join4("extensions", "CaseFolding.txt"),
  join4("extensions", "omo-thread-client.js"),
  join4("extensions", "omo-telemetry-recovery.js"),
  join4("extensions", "omo-feedback.js"),
  join4("extensions", "omo-desktop-toolkit.js"),
  join4("extensions", "omo-claim-receipt.js"),
  join4("extensions", "assets.generated.json"),
  join4("extensions", "omo-member.js"),
  join4("extensions", "memory-run-supervisor.mjs"),
  join4("extensions", "gateway-store-worker.mjs"),
  ...PERSONA_ASSET_FILES.map((filename) => join4("extensions", filename)),
  join4("skills", "ast-grep", "SKILL.md"),
  join4("skills", "browser", "SKILL.md"),
  join4("skills", "browser", "runtime", "omowright", "index.js"),
  join4("skills", "browser", "runtime", "omowright", "page-bundle.js"),
  join4("skills", "coding-agent-sessions", "SKILL.md"),
  join4("skills", "debugging", "SKILL.md"),
  join4("skills", "frontend", "SKILL.md"),
  join4("skills", "git-master", "SKILL.md"),
  join4("skills", "init-deep", "SKILL.md"),
  join4("skills", "lsp-setup", "SKILL.md"),
  join4("skills", "programming", "SKILL.md"),
  join4("skills", "refactor", "SKILL.md"),
  join4("skills", "remove-ai-slops", "SKILL.md"),
  join4("skills", "review-work", "SKILL.md"),
  join4("skills", "ultimate-browsing", "SKILL.md"),
  join4("skills", "ultrawork", "SKILL.md"),
  join4("skills", "ulw-execute", "SKILL.md"),
  join4("skills", "ulw-loop", "SKILL.md"),
  join4("skills", "ulw-plan", "SKILL.md"),
  join4("skills", "ulw-research", "SKILL.md"),
  join4("skills", "visual-qa", "SKILL.md"),
  join4("skills-conditional", "x-search", "SKILL.md"),
  join4("runtime", "agent-toolkit-sdk", "sdk.js"),
  join4("runtime", "thread-sdk", "sdk.js"),
  join4("runtime", "ast-grep-mcp", "cli.js"),
  join4("runtime", "lsp-daemon", "dist", "cli.js"),
  join4("runtime", "lsp-daemon", "dist", "index.js"),
  join4("runtime", "lsp-daemon", "dist", "index.d.ts"),
  join4("runtime", "lsp-daemon", "dist", "daemon-client.js"),
  join4("runtime", "lsp-daemon", "dist", "daemon-client.d.ts"),
  join4("runtime", "lsp-daemon", "dist", "package.json"),
  join4("runtime", "lsp-daemon", "dist", ".omo-runtime-manifest.json"),
  join4("scripts", "install.mjs"),
  "daemon-launch-spec.json"
];
async function ensurePluginArtifacts(context) {
  if (context.allowBuild) {
    await context.runCommand("node", [join4(context.pluginPath, "scripts", "build-extension.mjs")], { cwd: context.repoRoot });
    await context.runCommand("node", [join4("packages", "omo-codex", "plugin", "scripts", "materialize-shared-upstreams.mjs")], { cwd: context.repoRoot });
    await context.runCommand("node", [join4(context.pluginPath, "scripts", "sync-skills.mjs")], { cwd: context.repoRoot });
    await context.runCommand("node", [join4(context.pluginPath, "scripts", "build-install.mjs")], { cwd: context.repoRoot });
    await context.runCommand("node", [join4(context.pluginPath, "scripts", "stage-lsp-daemon-runtime.mjs")], { cwd: context.repoRoot });
    await context.runCommand("node", [join4(context.pluginPath, "scripts", "stage-ast-grep-mcp-runtime.mjs")], { cwd: context.repoRoot });
    await context.runCommand("node", [join4(context.pluginPath, "scripts", "stage-x-search-skill.mjs")], { cwd: context.repoRoot });
  }
  if (await hasMissingPluginArtifact(context.pluginPath)) {
    throw new Error(`Packed omo-senpi plugin is missing required runtime artifacts at ${context.pluginPath}`);
  }
  await verifyAstGrepRuntimeIntegrity(context.pluginPath, context.platform);
}
async function hasMissingPluginArtifact(pluginPath) {
  for (const artifact of REQUIRED_PLUGIN_ARTIFACTS) {
    if (!await fileExists2(join4(pluginPath, artifact)))
      return true;
  }
  return false;
}
async function verifyAstGrepRuntimeIntegrity(pluginPath, platform) {
  const runtimeEntry = join4(pluginPath, "runtime", "ast-grep-mcp", "cli.js");
  const manifestPath = join4(dirname3(runtimeEntry), "manifest.json");
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
function isErrno2(error, code) {
  return error instanceof Error && "code" in error && error.code === code;
}

// packages/omo-senpi/src/install/install-senpi.ts
var execFileAsync = promisify(execFile);
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
  const launcherPath = installLocalLauncher({
    pluginPath: context.pluginPath,
    senpiCliPath: join5(context.repoRoot, "packages", "coding-agent", "dist", "cli.js"),
    homeDir: context.homeDir
  });
  return {
    ok: true,
    action: "install",
    agentDir: context.agentDir,
    settingsPath: context.settingsPath,
    pluginPath: context.pluginPath,
    launcherPath,
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
  uninstallLocalLauncher(context.homeDir);
  return {
    ok: true,
    action: "uninstall",
    agentDir: context.agentDir,
    settingsPath: context.settingsPath,
    pluginPath: context.pluginPath,
    launcherPath: undefined,
    changed: JSON.stringify(settings) !== before,
    backupPath,
    removed: nextPackages.length !== packages.length
  };
}
function resolveInstallContext(options) {
  const env = options.env ?? process.env;
  const allowBuild = options.pluginPath === undefined;
  const repoRoot = resolve4(options.repoRoot ?? (allowBuild ? findRepoRoot(dirname4(fileURLToPath(import.meta.url))) : dirname4(resolve4(options.pluginPath))));
  const homeDir = options.homeDir ?? env.HOME ?? homedir3();
  const agentDir = resolve4(options.agentDir ?? resolveAgentHome({ env, homeDir }));
  const pluginPath = resolve4(options.pluginPath ?? join5(repoRoot, "packages", "omo-senpi", "plugin"));
  return {
    env,
    repoRoot,
    agentDir,
    homeDir,
    settingsPath: join5(agentDir, "settings.json"),
    pluginPath,
    platform: options.platform ?? process.platform,
    allowBuild,
    runCommand: options.runCommand ?? defaultRunCommand
  };
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
    if (fileExistsSync(join5(current, "packages", "omo-senpi", "plugin", "package.json")))
      return current;
    current = resolve4(current, "..");
  }
  throw new Error("Unable to locate packages/omo-senpi/plugin/package.json from installer module");
}
function fileExistsSync(path) {
  return existsSync3(path);
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
  const scriptDir = dirname5(fileURLToPath2(importerUrl));
  const candidate = resolve5(scriptDir, "..");
  const manifestPath = join6(candidate, "package.json");
  if (!existsSync4(manifestPath))
    return;
  const parsed = JSON.parse(readFileSync2(manifestPath, "utf8"));
  if (!isRecord2(parsed) || parsed.name !== "@code-yeongyu/omo-senpi")
    return;
  if (!existsSync4(join6(candidate, "extensions", "omo.js")))
    return;
  return candidate;
}
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
process.exit(await main(process.argv));
