#!/usr/bin/env node

// components/bootstrap/src/cli.ts
import { realpathSync } from "node:fs";
import { fileURLToPath as fileURLToPath4 } from "node:url";

// components/bootstrap/src/download.ts
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

class DownloadError extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.name = "DownloadError";
    this.code = code;
  }
}

class ChecksumMismatchError extends DownloadError {
  expectedSha256;
  actualSha256;
  constructor(options) {
    super("checksum-mismatch", `Checksum mismatch for ${options.url}: expected sha256 ${options.expectedSha256} but downloaded sha256 ${options.actualSha256}; deleted the partial download.`);
    this.name = "ChecksumMismatchError";
    this.expectedSha256 = options.expectedSha256;
    this.actualSha256 = options.actualSha256;
  }
}

class UnsupportedPlatformError extends DownloadError {
  manifestName;
  platformKey;
  constructor(options) {
    super("unsupported-platform", `Manifest "${options.manifestName}" has no asset for unsupported platform "${options.platformKey}" (available: ${options.availablePlatforms.join(", ")}).`);
    this.name = "UnsupportedPlatformError";
    this.manifestName = options.manifestName;
    this.platformKey = options.platformKey;
  }
}
var PROXY_ENV_KEYS = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"];
function proxyLimitationNote(env) {
  const configuredKey = PROXY_ENV_KEYS.find((key) => (env[key] ?? "").trim().length > 0);
  if (configuredKey === undefined)
    return "";
  return ` Note: ${configuredKey} is set, but the bootstrap downloader does not tunnel through HTTP(S) proxies in v1; the download was attempted directly.`;
}
function describeFailure(error) {
  return error instanceof Error ? error.message : String(error);
}
async function writeBodyToFile(body, tempPath) {
  const hash = createHash("sha256");
  if (body === null) {
    await pipeline(Readable.from([]), createWriteStream(tempPath));
    return hash.digest("hex");
  }
  await pipeline(Readable.fromWeb(body), async function* hashChunks(source) {
    for await (const chunk of source) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      hash.update(buffer);
      yield buffer;
    }
  }, createWriteStream(tempPath));
  return hash.digest("hex");
}
async function downloadChecksummedAsset(options) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const env = options.env ?? process.env;
  const expectedSha256 = options.sha256.toLowerCase();
  await mkdir(dirname(options.destination), { recursive: true });
  const tempPath = `${options.destination}.${randomUUID().slice(0, 8)}.partial`;
  let response;
  try {
    response = await fetchImpl(options.url);
  } catch (error) {
    throw new DownloadError("download-failed", `Download failed for ${options.url}: ${describeFailure(error)}.${proxyLimitationNote(env)}`);
  }
  if (!response.ok) {
    throw new DownloadError("download-failed", `Download failed for ${options.url}: HTTP ${response.status}.${proxyLimitationNote(env)}`);
  }
  let actualSha256;
  try {
    actualSha256 = await writeBodyToFile(response.body, tempPath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw new DownloadError("download-failed", `Download failed for ${options.url} while writing the response body: ${describeFailure(error)}.${proxyLimitationNote(env)}`);
  }
  if (actualSha256 !== expectedSha256) {
    await rm(tempPath, { force: true });
    throw new ChecksumMismatchError({ actualSha256, expectedSha256, url: options.url });
  }
  await rename(tempPath, options.destination);
  return options.destination;
}
function resolveDefaultManifestsDir() {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "manifests");
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseManifestAsset(value, manifestName, platformKey) {
  if (!isRecord(value) || typeof value["url"] !== "string" || typeof value["sha256"] !== "string") {
    throw new Error(`Manifest "${manifestName}" platform "${platformKey}" must pin both url and sha256 strings.`);
  }
  return { sha256: value["sha256"], url: value["url"] };
}
function parseAssetManifest(raw, manifestName) {
  const data = JSON.parse(raw);
  if (!isRecord(data) || typeof data["name"] !== "string" || typeof data["version"] !== "string" || !isRecord(data["platforms"])) {
    throw new Error(`Manifest "${manifestName}" must declare name, version, and a platforms object.`);
  }
  const platforms = {};
  for (const [platformKey, asset] of Object.entries(data["platforms"])) {
    platforms[platformKey] = parseManifestAsset(asset, manifestName, platformKey);
  }
  return { name: data["name"], platforms, version: data["version"] };
}
async function loadAssetManifest(manifestName, manifestsDir) {
  const directory = manifestsDir ?? resolveDefaultManifestsDir();
  const raw = await readFile(join(directory, `${manifestName}.json`), "utf8");
  return parseAssetManifest(raw, manifestName);
}
async function downloadFromManifest(options) {
  const manifest = await loadAssetManifest(options.manifestName, options.manifestsDir);
  const asset = manifest.platforms[options.platformKey];
  if (asset === undefined) {
    throw new UnsupportedPlatformError({
      availablePlatforms: Object.keys(manifest.platforms),
      manifestName: options.manifestName,
      platformKey: options.platformKey
    });
  }
  const destination = join(options.destinationDir, basename(new URL(asset.url).pathname));
  return downloadChecksummedAsset({
    destination,
    sha256: asset.sha256,
    url: asset.url,
    ...options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl },
    ...options.env === undefined ? {} : { env: options.env }
  });
}

// components/bootstrap/src/hook.ts
import { spawn } from "node:child_process";
import { stat as stat6 } from "node:fs/promises";
import { fileURLToPath as fileURLToPath3 } from "node:url";

// scripts/auto-update-state.mjs
import { appendFile, mkdir as mkdir2, open, readFile as readFile2, rm as rm2, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname as dirname2, join as join2 } from "node:path";
var DEFAULT_LOCK_STALE_MS = 10 * 60 * 1000;
function resolveStatePath(env) {
  if (env.LAZYCODEX_AUTO_UPDATE_STATE_PATH?.trim())
    return env.LAZYCODEX_AUTO_UPDATE_STATE_PATH;
  const dataRoot = env.PLUGIN_DATA?.trim() || join2(homedir(), ".local", "share", "lazycodex");
  return join2(dataRoot, "auto-update.json");
}
function resolveLockPath(env, statePath) {
  if (env.LAZYCODEX_AUTO_UPDATE_LOCK_PATH?.trim())
    return env.LAZYCODEX_AUTO_UPDATE_LOCK_PATH;
  return `${statePath}.lock`;
}
async function acquireLock(lockPath, now, staleMs = DEFAULT_LOCK_STALE_MS) {
  await mkdir2(dirname2(lockPath), { recursive: true });
  try {
    const handle = await open(lockPath, "wx");
    await handle.writeFile(`${now}
`);
    await handle.close();
    return {
      release: () => rm2(lockPath, { force: true })
    };
  } catch (error) {
    if (!(error instanceof Error && ("code" in error) && error.code === "EEXIST"))
      throw error;
    if (!await removeStaleLock(lockPath, now, staleMs))
      return null;
    return acquireLock(lockPath, now, 0);
  }
}
async function readState(statePath) {
  try {
    const raw = await readFile2(statePath, "utf8");
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return {};
    return {};
  }
}
async function writeState(statePath, state) {
  await mkdir2(dirname2(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}
`);
}
async function removeStaleLock(lockPath, now, staleMs) {
  if (staleMs <= 0)
    return false;
  try {
    const lockStat = await stat(lockPath);
    if (now - lockStat.mtimeMs < staleMs)
      return false;
    await rm2(lockPath, { force: true });
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return true;
    throw error;
  }
}

// components/bootstrap/src/environment.ts
import { stat as stat2 } from "node:fs/promises";
import { readFile as readFile3 } from "node:fs/promises";
import { homedir as homedir2 } from "node:os";
import { dirname as dirname3, join as join3, resolve } from "node:path";
var INSTALL_SNAPSHOT_FILENAME = "lazycodex-install.json";
var DEFAULT_MARKETPLACE_NAME = "sisyphuslabs";
var MAX_CODEX_HOME_WALK_UP_LEVELS = 6;
async function detectInstallFlowDetailed(options) {
  const marketplaceName = options.marketplaceName ?? DEFAULT_MARKETPLACE_NAME;
  const snapshotPresent = await isFile(join3(options.pluginRoot, INSTALL_SNAPSHOT_FILENAME));
  const snapshotSignal = snapshotPresent ? "npx-local" : "marketplace";
  const snapshotReason = snapshotPresent ? `${INSTALL_SNAPSHOT_FILENAME} present at plugin root (written only by the npx installer)` : `${INSTALL_SNAPSHOT_FILENAME} absent from plugin root`;
  const scan = options.configToml === undefined ? { kind: "absent" } : scanMarketplaceSource(options.configToml, marketplaceName);
  if (scan.kind === "absent") {
    return {
      configSignal: undefined,
      configSource: undefined,
      flow: snapshotSignal,
      reason: `${snapshotReason}; no [marketplaces.${marketplaceName}] source to cross-check`,
      snapshotPresent
    };
  }
  if (scan.kind === "unparsable") {
    return {
      configSignal: "unparsable",
      configSource: undefined,
      flow: "unknown",
      reason: `${snapshotReason}; [marketplaces.${marketplaceName}] source value is unparsable`,
      snapshotPresent
    };
  }
  const configSignal = classifyMarketplaceSource(scan.source);
  if (configSignal === "unparsable") {
    return {
      configSignal,
      configSource: scan.source,
      flow: "unknown",
      reason: `${snapshotReason}; marketplace source ${JSON.stringify(scan.source)} is neither a local absolute path nor a git URL`,
      snapshotPresent
    };
  }
  if (configSignal !== snapshotSignal) {
    return {
      configSignal,
      configSource: scan.source,
      flow: "unknown",
      reason: `${snapshotReason}, but marketplace source ${JSON.stringify(scan.source)} indicates ${configSignal}; signals disagree`,
      snapshotPresent
    };
  }
  return {
    configSignal,
    configSource: scan.source,
    flow: snapshotSignal,
    reason: `${snapshotReason}; marketplace source ${JSON.stringify(scan.source)} agrees`,
    snapshotPresent
  };
}
async function detectInstallFlow(options) {
  return (await detectInstallFlowDetailed(options)).flow;
}
async function detectInstallFlowFromEnvironment(options) {
  const home = await resolveCodexHome({ env: options.env, pluginRoot: options.pluginRoot });
  const configToml = await readOptionalFile(join3(home.path, "config.toml"));
  return detectInstallFlowDetailed({
    pluginRoot: options.pluginRoot,
    ...configToml === undefined ? {} : { configToml },
    ...options.marketplaceName === undefined ? {} : { marketplaceName: options.marketplaceName }
  });
}
async function detectInstallFlowForTest(pluginRoot) {
  const home = await resolveCodexHome({ env: {}, pluginRoot });
  const configToml = home.source === "walk-up" ? await readOptionalFile(join3(home.path, "config.toml")) : undefined;
  return detectInstallFlow({ pluginRoot, ...configToml === undefined ? {} : { configToml } });
}
async function resolveCodexHome(options) {
  const envHome = options.env["CODEX_HOME"]?.trim();
  if (envHome !== undefined && envHome.length > 0) {
    return { path: resolve(envHome), source: "env" };
  }
  if (options.pluginRoot !== undefined) {
    let current = resolve(options.pluginRoot);
    for (let level = 0;level < MAX_CODEX_HOME_WALK_UP_LEVELS; level += 1) {
      const parent = dirname3(current);
      if (parent === current)
        break;
      current = parent;
      if (await isFile(join3(current, "config.toml"))) {
        return { path: current, source: "walk-up" };
      }
    }
  }
  return { path: join3(homedir2(), ".codex"), source: "default" };
}
function resolveBootstrapStatePath(pluginData) {
  return join3(pluginData, "bootstrap", "state.json");
}
function resolveBootstrapLockPath(pluginData) {
  return `${resolveBootstrapStatePath(pluginData)}.lock`;
}
async function bootstrapLocks(options) {
  const now = options.now ?? Date.now();
  const staleMs = options.staleMs ?? DEFAULT_LOCK_STALE_MS;
  const statePath = resolveBootstrapStatePath(options.pluginData);
  const bootstrapLockPath = resolveBootstrapLockPath(options.pluginData);
  const autoUpdateLockPath = resolveLockPath(options.env, resolveStatePath(options.env));
  const bootstrapLock = await acquireLock(bootstrapLockPath, now, staleMs);
  if (bootstrapLock === null)
    return null;
  if (autoUpdateLockPath === bootstrapLockPath) {
    return { autoUpdateLockPath, bootstrapLockPath, release: () => bootstrapLock.release(), statePath };
  }
  const autoUpdateLock = await acquireLock(autoUpdateLockPath, now, staleMs);
  if (autoUpdateLock === null) {
    await bootstrapLock.release();
    return null;
  }
  return {
    autoUpdateLockPath,
    bootstrapLockPath,
    release: async () => {
      await autoUpdateLock.release();
      await bootstrapLock.release();
    },
    statePath
  };
}
function scanMarketplaceSource(configToml, marketplaceName) {
  const expectedHeaders = new Set([`marketplaces.${marketplaceName}`, `marketplaces.${JSON.stringify(marketplaceName)}`]);
  let inMarketplaceSection = false;
  for (const line of configToml.split(`
`)) {
    const header = parseTomlHeader(line);
    if (header !== null) {
      inMarketplaceSection = expectedHeaders.has(header);
      continue;
    }
    if (!inMarketplaceSection)
      continue;
    const valueText = parseSourceAssignment(line);
    if (valueText === null)
      continue;
    const source = parseTomlStringValue(valueText);
    return source === undefined ? { kind: "unparsable" } : { kind: "source", source };
  }
  return { kind: "absent" };
}
function parseTomlHeader(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]"))
    return null;
  if (trimmed.startsWith("[["))
    return null;
  return trimmed.slice(1, -1).trim();
}
function parseSourceAssignment(line) {
  const match = /^\s*source\s*=\s*(.+)$/.exec(line);
  return match === null ? null : match[1] ?? null;
}
function parseTomlStringValue(valueText) {
  const trimmed = valueText.trim();
  if (trimmed.startsWith('"'))
    return parseLeadingJsonString(trimmed);
  if (trimmed.startsWith("'")) {
    const closingIndex = trimmed.indexOf("'", 1);
    return closingIndex === -1 ? undefined : trimmed.slice(1, closingIndex);
  }
  return;
}
function parseLeadingJsonString(value) {
  let escaped = false;
  for (let index = 1;index < value.length; index += 1) {
    if (escaped) {
      escaped = false;
      continue;
    }
    const char = value[index];
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      try {
        const parsed = JSON.parse(value.slice(0, index + 1));
        return typeof parsed === "string" ? parsed : undefined;
      } catch {
        return;
      }
    }
  }
  return;
}
function classifyMarketplaceSource(source) {
  const trimmed = source.trim();
  if (trimmed.length === 0)
    return "unparsable";
  if (/^(https?|ssh|git):\/\//i.test(trimmed) || trimmed.startsWith("git@"))
    return "marketplace";
  if (trimmed.startsWith("/") || trimmed.startsWith("~") || trimmed.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(trimmed)) {
    return "npx-local";
  }
  if (trimmed.toLowerCase().endsWith(".git"))
    return "marketplace";
  return "unparsable";
}
async function isFile(path) {
  try {
    return (await stat2(path)).isFile();
  } catch {
    return false;
  }
}
async function readOptionalFile(path) {
  try {
    return await readFile3(path, "utf8");
  } catch {
    return;
  }
}

// components/bootstrap/src/worker.ts
import { appendFile as appendFile2, mkdir as mkdir8, readFile as readFile14 } from "node:fs/promises";
import { homedir as homedir5 } from "node:os";
import { dirname as dirname9, join as join22, resolve as resolve7 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// components/bootstrap/src/provision.ts
import { execFile } from "node:child_process";
import { rm as rm4 } from "node:fs/promises";
import { dirname as dirname4, join as join7 } from "node:path";
import { promisify } from "node:util";

// ../../utils/src/ast-grep/sg-candidates.ts
import { homedir as homedir3 } from "node:os";
import { join as join4 } from "node:path";

// ../../utils/src/ast-grep/sg-manifest.ts
var SG_PINNED_VERSION = "0.43.0";
var SG_RELEASE_ASSETS = {
  "darwin-arm64": {
    sha256: "8c847d0a29aa4b3101b3361e0b3ee7fb53c7e497adc9ed1afc9615538cd40782",
    url: "https://github.com/ast-grep/ast-grep/releases/download/0.43.0/app-aarch64-apple-darwin.zip"
  },
  "darwin-x64": {
    sha256: "6d703090b106747b2f56086b6ccc7e798fe78bcae70257aa20519b220153555b",
    url: "https://github.com/ast-grep/ast-grep/releases/download/0.43.0/app-x86_64-apple-darwin.zip"
  },
  "linux-arm64": {
    sha256: "e706846148493967f3ab8011334817edd86ce5acbec10718b2a7b40799c640ff",
    url: "https://github.com/ast-grep/ast-grep/releases/download/0.43.0/app-aarch64-unknown-linux-gnu.zip"
  },
  "linux-x64": {
    sha256: "a26253a9c821d935f7e383e40f0de7c2ca62a4121de1f73a6d81ec32eae631e0",
    url: "https://github.com/ast-grep/ast-grep/releases/download/0.43.0/app-x86_64-unknown-linux-gnu.zip"
  },
  "win32-arm64": {
    sha256: "a519fdd90324bf6858fde2d3feb2b862d67b834dc11af8f5b6c2c8143ab6a6c5",
    url: "https://github.com/ast-grep/ast-grep/releases/download/0.43.0/app-aarch64-pc-windows-msvc.zip"
  },
  "win32-x64": {
    sha256: "a4febbc8c48671e5729d85e29e4ebe5a051b7250d19545bca18e725ccf40ef61",
    url: "https://github.com/ast-grep/ast-grep/releases/download/0.43.0/app-x86_64-pc-windows-msvc.zip"
  }
};
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

// ../../utils/src/ast-grep/install-script.ts
var AST_GREP_BIN_DIR_ENV_KEY = "OMO_AST_GREP_BIN_DIR";

// ../../utils/src/ast-grep/types.ts
var SG_PATH_ENV_KEY = "OMO_AST_GREP_SG_PATH";
var SG_BINARY_NOT_FOUND = "BINARY_NOT_FOUND";

// ../../utils/src/ast-grep/sg-candidates.ts
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
    paths.push(join4(options.runtimeDir, binaryName));
  const codexHome = nonEmptyValue(options.env["CODEX_HOME"]);
  if (codexHome !== null)
    paths.push(join4(codexHome, "runtime", "ast-grep", slug, binaryName));
  paths.push(join4(options.homeDir, ".omo", "runtime", "ast-grep", slug, binaryName));
  return paths.map((path) => candidate("omo-runtime", path));
}
function skillBinCandidates(options) {
  const names = [astGrepBinaryName(options.platform), sgBinaryName(options.platform)];
  const directories = [];
  const cacheDir = nonEmptyValue(options.env[AST_GREP_BIN_DIR_ENV_KEY]);
  if (cacheDir !== null)
    directories.push(cacheDir);
  if (options.packageDir !== undefined)
    directories.push(join4(options.packageDir, "bin"));
  return directories.flatMap((directory) => names.map((name) => candidate("skill-bin", join4(directory, name))));
}
function homebrewCandidates(platform) {
  const prefixes = platform === "darwin" || platform === "linux" || platform === "win32" ? HOMEBREW_PREFIXES[platform] : [];
  const names = [astGrepBinaryName(platform), sgBinaryName(platform)];
  return prefixes.flatMap((prefix) => names.map((name) => candidate("homebrew", join4(prefix, name))));
}
function planSgCandidates(options) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const homeDir = options.homeDir ?? homedir3();
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

// ../../utils/src/ast-grep/sg-install-hints.ts
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

// ../../utils/src/ast-grep/sg-provisioner.ts
import { createHash as createHash2, randomUUID as randomUUID2 } from "node:crypto";
import { chmod, mkdir as mkdir3, rename as rename2, rm as rm3, writeFile as writeFile2 } from "node:fs/promises";
import { basename as basename2, isAbsolute, join as join5, relative, resolve as resolve2 } from "node:path";
import { inflateRawSync } from "node:zlib";
var DEFAULT_DOWNLOAD_TIMEOUT_MS = 60000;
var EOCD_SIGNATURE = 101010256;
var CENTRAL_SIGNATURE = 33639248;
var LOCAL_SIGNATURE = 67324752;
var ZIP64_SENTINEL = 4294967295;

class SgProvisionError extends Error {
  code;
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "SgProvisionError";
    this.code = code;
  }
}
function describeFailure2(error) {
  return error instanceof Error ? error.message : String(error);
}
function sha256(bytes) {
  return createHash2("sha256").update(bytes).digest("hex");
}
function timeoutSignal(signal) {
  const timeout = AbortSignal.timeout(DEFAULT_DOWNLOAD_TIMEOUT_MS);
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}
async function downloadAsset(url, fetchImpl, signal) {
  const activeFetch = fetchImpl ?? globalThis.fetch;
  let response;
  try {
    response = await activeFetch(url, { signal });
  } catch (error) {
    throw new SgProvisionError("download_failed", `failed to download ast-grep ${SG_PINNED_VERSION} from ${url}: ${describeFailure2(error)}`, { cause: error });
  }
  if (!response.ok) {
    throw new SgProvisionError("download_failed", `failed to download ast-grep ${SG_PINNED_VERSION} from ${url}: HTTP ${response.status}`);
  }
  try {
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    throw new SgProvisionError("download_failed", `failed to read ast-grep ${SG_PINNED_VERSION} download from ${url}: ${describeFailure2(error)}`, { cause: error });
  }
}
function zipEntryBaseName(entryName) {
  const segments = entryName.split("/");
  return segments[segments.length - 1] ?? entryName;
}
function findEndOfCentralDirectory(zip) {
  const lowestOffset = Math.max(0, zip.length - 22 - 65535);
  for (let offset = zip.length - 22;offset >= lowestOffset; offset -= 1) {
    if (zip.readUInt32LE(offset) === EOCD_SIGNATURE)
      return offset;
  }
  throw new SgProvisionError("extract_failed", "downloaded ast-grep asset is not a zip archive");
}
function listZipEntries(zip) {
  const eocdOffset = findEndOfCentralDirectory(zip);
  const entryCount = zip.readUInt16LE(eocdOffset + 10);
  let cursor = zip.readUInt32LE(eocdOffset + 16);
  const entries = [];
  for (let index = 0;index < entryCount; index += 1) {
    if (cursor + 46 > zip.length || zip.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw new SgProvisionError("extract_failed", "downloaded ast-grep zip central directory is corrupt");
    }
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    entries.push({
      compressedSize: zip.readUInt32LE(cursor + 20),
      localHeaderOffset: zip.readUInt32LE(cursor + 42),
      method: zip.readUInt16LE(cursor + 10),
      name: zip.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8"),
      uncompressedSize: zip.readUInt32LE(cursor + 24)
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
function decompressZipEntry(raw, entry) {
  if (entry.method === 0)
    return Buffer.from(raw);
  if (entry.method === 8)
    return inflateRawSync(raw);
  throw new SgProvisionError("extract_failed", `ast-grep zip entry ${entry.name} uses unsupported compression method ${entry.method}`);
}
function readZipEntryBytes(zip, entry) {
  if (entry.compressedSize === ZIP64_SENTINEL || entry.uncompressedSize === ZIP64_SENTINEL || entry.localHeaderOffset === ZIP64_SENTINEL) {
    throw new SgProvisionError("extract_failed", `ast-grep zip entry ${entry.name} uses unsupported zip64 extensions`);
  }
  if (zip.readUInt32LE(entry.localHeaderOffset) !== LOCAL_SIGNATURE) {
    throw new SgProvisionError("extract_failed", `ast-grep zip entry ${entry.name} has a corrupt local header`);
  }
  const nameLength = zip.readUInt16LE(entry.localHeaderOffset + 26);
  const extraLength = zip.readUInt16LE(entry.localHeaderOffset + 28);
  const dataStart = entry.localHeaderOffset + 30 + nameLength + extraLength;
  const bytes = decompressZipEntry(zip.subarray(dataStart, dataStart + entry.compressedSize), entry);
  if (bytes.length !== entry.uncompressedSize) {
    throw new SgProvisionError("extract_failed", `ast-grep zip entry ${entry.name} inflated to ${bytes.length} bytes, expected ${entry.uncompressedSize}`);
  }
  return bytes;
}
function extractStandaloneSgBinary(zip, platform) {
  const suffix = platform === "win32" ? ".exe" : "";
  const entries = listZipEntries(zip);
  const preferredNames = [`ast-grep${suffix}`, `sg${suffix}`];
  for (const preferred of preferredNames) {
    const entry = entries.find((candidate2) => zipEntryBaseName(candidate2.name) === preferred);
    if (entry !== undefined)
      return readZipEntryBytes(zip, entry);
  }
  throw new SgProvisionError("extract_failed", `ast-grep release zip has no standalone ${preferredNames.join(" or ")} binary`);
}
function assertInsideTarget(targetDir, filePath) {
  const relativePath = relative(targetDir, filePath);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new SgProvisionError("write_failed", `refusing to write ast-grep binary outside targetDir: ${filePath}`);
  }
}
async function provisionSgBinary(options) {
  const platform = options.platform ?? process.platform;
  const slug = runtimeSlug(platform, options.arch ?? process.arch);
  const asset = options.releaseAssets?.[slug] ?? SG_RELEASE_ASSETS[slug];
  if (asset === undefined) {
    throw new SgProvisionError("unsupported_platform", `ast-grep ${SG_PINNED_VERSION} has no asset for ${slug}`);
  }
  const targetDir = resolve2(options.targetDir);
  const destination = join5(targetDir, sgBinaryName(platform));
  const tempPath = join5(targetDir, `.sg-${randomUUID2().slice(0, 8)}.partial`);
  assertInsideTarget(targetDir, destination);
  assertInsideTarget(targetDir, tempPath);
  try {
    await mkdir3(targetDir, { recursive: true });
    const archive = await downloadAsset(asset.url, options.fetchImpl, timeoutSignal(options.signal));
    const actualSha256 = sha256(archive);
    if (actualSha256 !== asset.sha256) {
      throw new SgProvisionError("bad_checksum", `checksum mismatch for ${basename2(asset.url)}: expected ${asset.sha256}, got ${actualSha256}`);
    }
    await writeFile2(tempPath, extractStandaloneSgBinary(archive, platform));
    await chmod(tempPath, 493);
    await rename2(tempPath, destination);
    return destination;
  } catch (error) {
    await rm3(tempPath, { force: true });
    if (error instanceof SgProvisionError)
      throw error;
    throw new SgProvisionError("write_failed", `failed to provision ast-grep ${SG_PINNED_VERSION} into ${targetDir}: ${describeFailure2(error)}`, { cause: error });
  }
}

// ../../utils/src/ast-grep/sg-resolver.ts
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";

// ../../utils/src/runtime/which.ts
import { accessSync, constants } from "node:fs";
import { delimiter, join as join6 } from "node:path";
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
      const candidatePath = join6(pathEntry, candidateName);
      if (isExecutable(candidatePath))
        return candidatePath;
    }
  }
  return null;
}

// ../../utils/src/ast-grep/sg-resolver.ts
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
function findSgBinarySync(options = {}) {
  const resolution = resolveSgBinarySync(options);
  return resolution.found ? resolution.path : null;
}

// components/bootstrap/src/provision.ts
var SG_PROVISION_COMPONENT = "ast_grep";
var SG_FORCE_PROVISION_ENV_KEY = "OMO_BOOTSTRAP_FORCE_PROVISION";
function sgProvisionDestination(context, arch) {
  return join7(sgRuntimeDir(context.codexHome, context.platform, arch), sgBinaryName(context.platform));
}
function sgRuntimeDir(codexHome, platform, arch) {
  return join7(codexHome, "runtime", "ast-grep", runtimeSlug(platform, arch));
}
async function runSgProvision(context, seams = {}) {
  const arch = seams.arch ?? process.arch;
  const destination = sgProvisionDestination(context, arch);
  if (context.env[SG_FORCE_PROVISION_ENV_KEY] !== "1") {
    const preexisting = (seams.resolvePreexistingSg ?? defaultResolvePreexistingSg)({
      arch,
      codexHome: context.codexHome,
      env: context.env,
      platform: context.platform
    });
    if (preexisting !== null) {
      await appendBootstrapLog(context.pluginData, context.now, "sg-provision", { sg: `preexisting:${preexisting}` });
      return { degraded: [] };
    }
  }
  try {
    const version = await provisionFromSharedManifest(context, seams, { arch, destination });
    await appendBootstrapLog(context.pluginData, context.now, "sg-provision", {
      sg: `provisioned:${destination}`,
      version
    });
    return { degraded: [] };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await appendBootstrapLog(context.pluginData, context.now, "sg-provision-failed", { reason });
    return { degraded: [{ component: SG_PROVISION_COMPONENT, hint: BOOTSTRAP_DOCTOR_HINT, reason }] };
  }
}
async function provisionFromSharedManifest(context, seams, layout) {
  const provisionedPath = await provisionSgBinary({
    arch: layout.arch,
    platform: context.platform,
    targetDir: dirname4(layout.destination),
    ...seams.fetchImpl === undefined ? {} : { fetchImpl: seams.fetchImpl },
    ...seams.releaseAssets === undefined ? {} : { releaseAssets: seams.releaseAssets }
  });
  if (provisionedPath !== layout.destination) {
    await rm4(provisionedPath, { force: true });
    throw new Error(`provisioned sg at ${provisionedPath} but expected ${layout.destination}; removed the binary.`);
  }
  await verifyProvisionedVersion(layout.destination, SG_PINNED_VERSION, seams);
  return SG_PINNED_VERSION;
}
async function verifyProvisionedVersion(destination, pinnedVersion, seams) {
  let reported;
  try {
    reported = (await (seams.runVersionProbe ?? defaultVersionProbe2)(destination)).trim();
  } catch (error) {
    await rm4(destination, { force: true });
    throw new Error(`provisioned sg at ${destination} failed its --version probe: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!reported.includes(pinnedVersion)) {
    await rm4(destination, { force: true });
    throw new Error(`provisioned sg at ${destination} reported "${reported}" but the manifest pins version ${pinnedVersion}; removed the binary.`);
  }
}
function defaultResolvePreexistingSg(options) {
  return findSgBinarySync({
    arch: options.arch,
    env: { ...options.env, CODEX_HOME: options.codexHome },
    platform: options.platform,
    runtimeDir: sgRuntimeDir(options.codexHome, options.platform, options.arch)
  });
}
var execFileAsync = promisify(execFile);
async function defaultVersionProbe2(binaryPath) {
  const { stdout } = await execFileAsync(binaryPath, ["--version"]);
  return String(stdout);
}

// components/bootstrap/src/setup.ts
import { copyFile as copyFile2, mkdir as mkdir7, readFile as readFile13, readdir as readdir5, rm as rm10, stat as stat5 } from "node:fs/promises";
import { join as join21 } from "node:path";

// ../src/install/link-cached-plugin-agents.ts
import { copyFile, lstat as lstat3, mkdir as mkdir4, readdir as readdir2, rm as rm6, writeFile as writeFile4 } from "node:fs/promises";
import { basename as basename3, join as join10 } from "node:path";

// ../src/install/preserved-agent-settings.ts
import { lstat, readFile as readFile4, readdir, writeFile as writeFile3 } from "node:fs/promises";
import { join as join8 } from "node:path";

// ../src/install/toml-section-editor.ts
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
function tomlPathMatches(candidate2, target) {
  return candidate2.length === target.length && candidate2.every((part, index) => part === target[index]);
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

// ../src/install/codex-config-toml-sections.ts
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
    const header = parseTomlHeader2(line);
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
function parseTomlHeader2(line) {
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

// ../src/install/managed-agent-reasoning-defaults.ts
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

// ../src/install/preserved-agent-settings.ts
async function capturePreservedAgentReasoning(input) {
  const agentsDir = join8(input.codexHome, "agents");
  if (!await exists(agentsDir))
    return new Map;
  const preserved = new Map;
  const agentEntries = await readdir(agentsDir, { withFileTypes: true });
  for (const entry of agentEntries) {
    if (!entry.name.endsWith(".toml"))
      continue;
    const content = await readTextIfExists(join8(agentsDir, entry.name));
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
  const agentsDir = join8(input.codexHome, "agents");
  if (!await exists(agentsDir))
    return new Map;
  const preserved = new Map;
  const agentEntries = await readdir(agentsDir, { withFileTypes: true });
  for (const entry of agentEntries) {
    if (!entry.name.endsWith(".toml"))
      continue;
    const content = await readTextIfExists(join8(agentsDir, entry.name));
    if (content === null)
      continue;
    preserved.set(agentNameFromToml(entry.name), extractServiceTier(content));
  }
  return preserved;
}
async function restorePreservedReasoning(input) {
  if (input.value === undefined)
    return;
  const content = await readFile4(input.target, "utf8");
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
  await writeFile3(input.linkPath, replacement.content);
}
async function restorePreservedServiceTier(input) {
  if (!input.preserved)
    return;
  const content = await readFile4(input.linkPath, "utf8");
  if (extractServiceTier(content) === input.value)
    return;
  const replacement = replaceTopLevelStringSetting(content, "service_tier", input.value, { insertIfMissing: true });
  if (!replacement.replaced)
    return;
  await writeFile3(input.linkPath, replacement.content);
}
async function readTextIfExists(path) {
  try {
    return await readFile4(path, "utf8");
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
    if (isSectionHeader(line))
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
    if (line === undefined || isSectionHeader(line))
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
  const sectionIndex = lines.findIndex((line) => isSectionHeader(line));
  const topLevelEnd = sectionIndex === -1 ? lines.length : sectionIndex;
  let insertionIndex = topLevelEnd;
  while (insertionIndex > 0 && lines[insertionIndex - 1] === "") {
    insertionIndex -= 1;
  }
  return insertionIndex;
}
function isSectionHeader(line) {
  const trimmed = line.trim();
  return trimmed.startsWith("[") && trimmed.endsWith("]");
}
function agentNameFromToml(fileName) {
  return fileName.endsWith(".toml") ? fileName.slice(0, -".toml".length) : fileName;
}
async function exists(path) {
  try {
    await lstat(path);
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

// ../src/install/retired-managed-agent-purge.ts
import { lstat as lstat2, readFile as readFile5, rm as rm5 } from "node:fs/promises";
import { join as join9 } from "node:path";
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
  const agentsDir = join9(input.codexHome, "agents");
  if (!await exists2(agentsDir))
    return;
  for (const retiredAgent of RETIRED_MANAGED_AGENT_FILES) {
    const agentPath = join9(agentsDir, retiredAgent.fileName);
    if (!await exists2(agentPath))
      continue;
    const agentStat = await lstat2(agentPath);
    if (agentStat.isDirectory() && !agentStat.isSymbolicLink())
      continue;
    const content = await readTextIfExists2(agentPath);
    if (content === null || !hasRequiredMarkers(content, retiredAgent.requiredMarkers))
      continue;
    await rm5(agentPath, { force: true });
  }
}
function hasRequiredMarkers(content, markers) {
  return markers.every((marker) => content.includes(marker));
}
async function readTextIfExists2(path) {
  try {
    return await readFile5(path, "utf8");
  } catch (error) {
    if (nodeErrorCode2(error) === "ENOENT")
      return null;
    throw error;
  }
}
async function exists2(path) {
  try {
    await lstat2(path);
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

// ../src/install/link-cached-plugin-agents.ts
var MANIFEST_FILE = ".installed-agents.json";
async function linkCachedPluginAgents(input) {
  const bundledAgents = await discoverBundledAgents(input.pluginRoot);
  await purgeRetiredManagedAgentFiles({ codexHome: input.codexHome });
  if (bundledAgents.length === 0) {
    await writeManifest(input.pluginRoot, []);
    return [];
  }
  const agentsDir = join10(input.codexHome, "agents");
  await mkdir4(agentsDir, { recursive: true });
  const linked = [];
  for (const agentPath of bundledAgents) {
    const agentFileName = basename3(agentPath);
    const agentName = agentNameFromToml2(agentFileName);
    const linkPath = join10(agentsDir, agentFileName);
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
  const componentsRoot = join10(pluginRoot, "components");
  if (!await exists3(componentsRoot))
    return [];
  const componentEntries = await readdir2(componentsRoot, { withFileTypes: true });
  const agents = [];
  for (const entry of componentEntries) {
    if (!entry.isDirectory())
      continue;
    const agentsRoot = join10(componentsRoot, entry.name, "agents");
    if (!await exists3(agentsRoot))
      continue;
    const agentEntries = await readdir2(agentsRoot, { withFileTypes: true });
    for (const file of agentEntries) {
      if (!file.isFile() || !file.name.endsWith(".toml"))
        continue;
      agents.push(join10(agentsRoot, file.name));
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
  if (!await exists3(linkPath))
    return;
  const entryStat = await lstat3(linkPath);
  if (entryStat.isDirectory() && !entryStat.isSymbolicLink()) {
    throw new Error(`${linkPath} already exists and is a directory; refusing to replace`);
  }
  await rm6(linkPath, { force: true });
}
async function writeManifest(pluginRoot, agentPaths) {
  const manifestPath = join10(pluginRoot, MANIFEST_FILE);
  const payload = { agents: [...agentPaths].sort() };
  await writeFile4(manifestPath, `${JSON.stringify(payload, null, "\t")}
`);
}
function agentNameFromToml2(fileName) {
  return fileName.endsWith(".toml") ? fileName.slice(0, -".toml".length) : fileName;
}
async function exists3(path) {
  try {
    await lstat3(path);
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

// ../src/install/codex-cache-bins.ts
import { chmod as chmod2, lstat as lstat7, mkdir as mkdir5, readFile as readFile8, readdir as readdir4, readlink as readlink3, rm as rm9, stat as stat4, symlink, writeFile as writeFile5 } from "node:fs/promises";
import { basename as basename4, isAbsolute as isAbsolute3, join as join14, relative as relative2, resolve as resolve4, sep } from "node:path";

// ../src/install/codex-cache-command-shim.ts
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

// ../src/install/codex-cache-dangling-bins.ts
import { lstat as lstat5, readFile as readFile6, readdir as readdir3, readlink, rm as rm7, stat as stat3 } from "node:fs/promises";
import { dirname as dirname5, isAbsolute as isAbsolute2, join as join11, resolve as resolve3 } from "node:path";

// ../src/install/codex-cache-fs.ts
import { lstat as lstat4 } from "node:fs/promises";
async function fileExistsStrict(path) {
  try {
    await lstat4(path);
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

// ../src/install/codex-cache-dangling-bins.ts
async function removeDanglingManagedComponentBins(binDir, platform, managedBinNames) {
  const entries = await readdir3(binDir, { withFileTypes: true });
  for (const entry of entries) {
    const binName = managedBinNameForEntry(entry.name, platform);
    if (binName === null || !managedBinNames.has(binName))
      continue;
    const linkPath = join11(binDir, entry.name);
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
    const linkStat = await lstat5(linkPath);
    if (!linkStat.isSymbolicLink())
      return;
    const linkTarget = await readlink(linkPath);
    const target = isAbsolute2(linkTarget) ? linkTarget : resolve3(dirname5(linkPath), linkTarget);
    if (!await isFileSystemEntry(target) && isManagedComponentBinTarget(target))
      await rm7(linkPath, { force: true });
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT")
      return;
    throw error;
  }
}
async function removeDanglingGeneratedCommandShim(linkPath) {
  try {
    const linkStat = await lstat5(linkPath);
    if (!linkStat.isFile())
      return;
    const content = await readFile6(linkPath, "utf8");
    if (!content.includes(COMMAND_SHIM_MARKER))
      return;
    const target = extractCommandShimTarget(content);
    if (target !== null && !await isFileSystemEntry(target) && isManagedComponentBinTarget(target))
      await rm7(linkPath, { force: true });
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT")
      return;
    throw error;
  }
}
async function isFileSystemEntry(path) {
  try {
    await stat3(path);
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

// ../src/install/codex-cache-legacy-bins.ts
import { lstat as lstat6, readFile as readFile7, readlink as readlink2, rm as rm8 } from "node:fs/promises";
import { join as join12 } from "node:path";
var LEGACY_CODEX_COMPONENT_BINS = [
  { name: "omo", component: "ulw-loop" },
  { name: "codex-comment-checker", component: "comment-checker" },
  { name: "codex-lsp", component: "lsp" },
  { name: "codex-rules", component: "rules" },
  { name: "codex-telemetry", component: "telemetry" },
  { name: "codex-ultrawork", component: "ultrawork" },
  { name: "codex-ulw-execute-continuation", component: "ulw-execute-continuation" }
];
var LEGACY_CODEX_COMPONENT_BIN_NAMES = LEGACY_CODEX_COMPONENT_BINS.map((entry) => entry.name);
async function removeLegacyCodexComponentBins(binDir, platform) {
  for (const entry of LEGACY_CODEX_COMPONENT_BINS) {
    const linkPath = join12(binDir, platform === "win32" ? `${entry.name}.cmd` : entry.name);
    await removeLegacyCodexComponentBin(linkPath, entry.component, platform);
  }
}
async function removeLegacyCodexComponentBin(linkPath, component, platform) {
  try {
    const stat4 = await lstat6(linkPath);
    if (platform !== "win32") {
      if (!stat4.isSymbolicLink())
        return;
      const target = await readlink2(linkPath);
      if (isManagedLegacyComponentTarget(target, component))
        await rm8(linkPath, { force: true });
      return;
    }
    if (!stat4.isFile())
      return;
    const content = await readFile7(linkPath, "utf8");
    if (content.includes(COMMAND_SHIM_MARKER))
      await rm8(linkPath, { force: true });
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

// ../src/install/codex-cache-runtime-wrapper.ts
import { join as join13 } from "node:path";
var RUNTIME_WRAPPER_MARKER = "OMO_GENERATED_RUNTIME_WRAPPER";
function posixRuntimeWrapper(binName, cliPath, codexHome, binDir, nodeCliPath) {
  const ulwLoopBin = toPosixPath(join13(binDir, "omo-ulw-loop"));
  const nodeCli = escapePosixDoubleQuoted(toPosixPath(nodeCliPath));
  const escapedCliPath = escapePosixDoubleQuoted(toPosixPath(cliPath));
  const escapedCodexHome = escapePosixDoubleQuoted(toPosixPath(codexHome));
  const escapedUlwLoopBin = escapePosixDoubleQuoted(ulwLoopBin);
  return [
    "#!/bin/sh",
    `# ${RUNTIME_WRAPPER_MARKER}`,
    `export CODEX_HOME="\${CODEX_HOME:-${escapedCodexHome}}"`,
    `export OMO_INVOCATION_NAME=${binName}`,
    "export OMO_EDITION=codex",
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
    `  echo "${binName}: bun runtime not found (checked PATH, ~/.bun/bin, /opt/homebrew/bin, /usr/local/bin) and the node fallback CLI is missing at ${nodeCli}; install bun from https://bun.sh, or reinstall ${binName} and force the fallback with OMO_RUNTIME=node" >&2`,
    "  exit 127",
    "fi",
    `if [ ! -f "${escapedCliPath}" ]; then`,
    `  echo "${binName}: runtime target missing at ${escapedCliPath}; reinstall with: npx --yes lazycodex-ai@latest install --no-tui" >&2`,
    "  exit 1",
    "fi",
    `exec "$BUN_BINARY" "${escapedCliPath}" "$@"`,
    ""
  ].join(`
`);
}
function windowsRuntimeWrapper(binName, cliPath, codexHome, binDir, nodeCliPath) {
  const ulwLoopBin = join13(binDir, "omo-ulw-loop.cmd");
  return [
    "@echo off",
    `rem ${RUNTIME_WRAPPER_MARKER}`,
    `if not defined CODEX_HOME set "CODEX_HOME=${codexHome}"`,
    `set "OMO_INVOCATION_NAME=${binName}"`,
    'set "OMO_EDITION=codex"',
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
    `  echo ${binName}: bun runtime not found, no Node runtime was discovered from NODE_REPL_NODE_PATH or PATH, or the node fallback CLI is missing at ${nodeCliPath}; install bun from https://bun.sh or rerun LazyCodex install from Codex Desktop 1>&2`,
    "  exit /b 127",
    ")",
    `if not exist "${cliPath}" (`,
    `  echo ${binName}: runtime target missing at ${cliPath}; reinstall with: npx --yes lazycodex-ai@latest install --no-tui 1>&2`,
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

// ../src/install/codex-cache-bins.ts
var RESERVED_NESTED_BIN_NAMES = new Set([
  "omo",
  "omo-agent-toolkit",
  "lazycodex",
  "lazycodex-ai",
  "oh-my-opencode",
  "oh-my-openagent"
]);
async function linkCachedPluginBins(input) {
  const binLinks = await discoverPackageBins(input.pluginRoot);
  const platform = input.platform ?? process.platform;
  await mkdir5(input.binDir, { recursive: true });
  await removeLegacyCodexComponentBins(input.binDir, platform);
  await removeDanglingManagedComponentBins(input.binDir, platform, new Set(binLinks.map((link) => link.name)));
  const linked = [];
  for (const link of binLinks) {
    const linkPath = await linkCachedPluginBin(input.binDir, link, platform);
    linked.push({ name: link.name, path: linkPath, target: link.target });
  }
  return linked;
}
async function linkRootRuntimeBin(input) {
  const cliPath = join14(input.repoRoot, "dist", "cli", "index.js");
  const platform = input.platform ?? process.platform;
  const legacyPath = join14(input.binDir, platform === "win32" ? "omo.cmd" : "omo");
  if (!await isFile2(cliPath)) {
    await removeGeneratedRuntimeWrapper(legacyPath);
    return null;
  }
  const binName = "omo-agent-toolkit";
  const nodeCliPath = join14(input.repoRoot, "dist", "cli-node", "index.js");
  await mkdir5(input.binDir, { recursive: true });
  if (platform === "win32") {
    const linkPath2 = join14(input.binDir, `${binName}.cmd`);
    await replaceRuntimeWrapper(linkPath2, windowsRuntimeWrapper(binName, cliPath, input.codexHome, input.binDir, nodeCliPath));
    await removeGeneratedRuntimeWrapper(legacyPath);
    return { name: binName, path: linkPath2, target: cliPath };
  }
  const linkPath = join14(input.binDir, binName);
  await replaceRuntimeWrapper(linkPath, posixRuntimeWrapper(binName, cliPath, input.codexHome, input.binDir, nodeCliPath));
  await chmod2(linkPath, 493);
  await removeGeneratedRuntimeWrapper(legacyPath);
  return { name: binName, path: linkPath, target: cliPath };
}
async function linkCachedPluginBin(binDir, link, platform) {
  if (platform === "win32") {
    const linkPath2 = join14(binDir, `${link.name}.cmd`);
    await replaceCommandShim(linkPath2, link.target);
    return linkPath2;
  }
  const linkPath = join14(binDir, link.name);
  await replaceSymlink(linkPath, link.target);
  return linkPath;
}
async function isFile2(path) {
  try {
    return (await stat4(path)).isFile();
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
  const entries = await readdir4(directory, { withFileTypes: true });
  if (entries.some((entry) => entry.isFile() && entry.name === "package.json")) {
    await appendPackageBinLinks(join14(directory, "package.json"), directory, root, links);
  }
  for (const entry of entries) {
    if (!entry.isDirectory())
      continue;
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist")
      continue;
    const childPath = join14(directory, entry.name);
    if (!childPath.startsWith(root))
      continue;
    await collectPackageBins(childPath, root, links);
  }
}
async function appendPackageBinLinks(packageJsonPath, packageRoot, root, links) {
  const packageJson = JSON.parse(await readFile8(packageJsonPath, "utf8"));
  if (!isPlainRecord(packageJson))
    return;
  const packageName = packageJson.name;
  const packageBin = packageJson.bin;
  if (typeof packageBin === "string" && typeof packageName === "string") {
    const name = assertSafeCommandName(basename4(packageName));
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
  const root = resolve4(packageRoot);
  const resolvedTarget = resolve4(root, target);
  const relativeTarget = relative2(root, resolvedTarget);
  if (relativeTarget === "" || relativeTarget !== ".." && !relativeTarget.startsWith(`..${sep}`) && !isAbsolute3(relativeTarget)) {
    return resolvedTarget;
  }
  throw new Error("Package bin target must stay inside package root");
}
async function replaceSymlink(linkPath, targetPath) {
  if (await existingNonSymlink(linkPath))
    throw new Error(`${linkPath} already exists and is not a symlink`);
  await rm9(linkPath, { force: true });
  await symlink(targetPath, linkPath);
}
async function replaceCommandShim(linkPath, targetPath) {
  if (await existingNonShim(linkPath))
    throw new Error(`${linkPath} already exists and is not a command shim`);
  await writeFile5(linkPath, windowsCommandShim(targetPath));
}
async function replaceRuntimeWrapper(linkPath, content) {
  if (await existingNonRuntimeWrapper(linkPath))
    throw new Error(`${linkPath} already exists and is not a generated OMO runtime wrapper`);
  await rm9(linkPath, { force: true });
  await writeFile5(linkPath, content);
}
async function removeGeneratedRuntimeWrapper(path) {
  try {
    const entry = await lstat7(path);
    if (!entry.isFile() && !entry.isSymbolicLink())
      return;
    const content = await readGeneratedWrapperContent(path);
    if (content.includes(RUNTIME_WRAPPER_MARKER))
      await rm9(path, { force: true });
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT")
      return;
    throw error;
  }
}
async function readGeneratedWrapperContent(path) {
  try {
    return await readFile8(path, "utf8");
  } catch (error) {
    if (isNodeErrorWithCode(error) && (error.code === "ENOENT" || error.code === "EISDIR"))
      return "";
    throw error;
  }
}
async function existingNonRuntimeWrapper(path) {
  try {
    const stat5 = await lstat7(path);
    if (stat5.isSymbolicLink())
      return false;
    if (!stat5.isFile())
      return true;
    const content = await readFile8(path, "utf8");
    return !content.includes(RUNTIME_WRAPPER_MARKER);
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT")
      return false;
    throw error;
  }
}
async function existingNonShim(path) {
  try {
    const stat5 = await lstat7(path);
    if (!stat5.isFile())
      return true;
    const content = await readFile8(path, "utf8");
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
    const stat5 = await lstat7(path);
    if (!stat5.isSymbolicLink())
      return true;
    await readlink3(path);
    return false;
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT")
      return false;
    throw error;
  }
}

// ../src/install/codex-config-agents.ts
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
function hasForeignAgentRegistration(config, agentConfig) {
  const section = findTomlSection(config, `agents.${tomlKeySegment(agentConfig.name)}`);
  if (!section)
    return false;
  return !section.text.includes(`config_file = ${JSON.stringify(agentConfig.configFile)}`);
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

// ../src/install/codex-config-toml.ts
import { mkdir as mkdir6, readFile as readFile10 } from "node:fs/promises";
import { dirname as dirname8 } from "node:path";

// ../src/install/codex-config-atomic-write.ts
import { lstat as lstat8, readlink as readlink4, realpath, rename as rename3, unlink, writeFile as writeFile6 } from "node:fs/promises";
import { basename as basename5, dirname as dirname6, isAbsolute as isAbsolute4, join as join15, resolve as resolve5 } from "node:path";
var RENAME_RETRY_DELAYS_MS = [10, 25, 50];
var RETRIABLE_RENAME_CODES = new Set(["EPERM", "EBUSY"]);
async function writeFileAtomic(targetPath, data) {
  const writeTarget = await resolveSymlinkTarget(targetPath);
  const temporaryPath = join15(dirname6(writeTarget), `.tmp-${basename5(writeTarget)}-${process.pid}-${Date.now()}`);
  await writeFile6(temporaryPath, data);
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
    const linkStats = await lstat8(targetPath);
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
    return isAbsolute4(linkValue) ? linkValue : resolve5(dirname6(targetPath), linkValue);
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

// ../src/install/toml-setting-reader.ts
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

// ../src/install/codex-config-features.ts
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

// ../src/install/codex-config-marketplaces.ts
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

// ../src/install/codex-config-permissions.ts
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

// ../src/install/codex-config-plugins.ts
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

// ../src/install/codex-config-reasoning.ts
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
    if (isSectionHeader2(line))
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
function isSectionHeader2(line) {
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

// ../src/install/codex-model-catalog.ts
import { readFile as readFile9 } from "node:fs/promises";
import { join as join16 } from "node:path";
var FALLBACK_CODEX_MODEL_CATALOG = {
  current: {
    model: "gpt-5.6-sol",
    modelContextWindow: 650000,
    modelReasoningEffort: "high",
    planModeReasoningEffort: "xhigh"
  },
  managedProfiles: [
    {
      model: "gpt-5.5",
      modelContextWindow: 650000,
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
  const catalogPath = join16(codexPackageRoot, "plugin", "model-catalog.json");
  try {
    const parsed = JSON.parse(await readFile9(catalogPath, "utf8"));
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

// ../src/install/codex-multi-agent-mode-config.ts
var CODEX_MULTI_AGENT_MODE_KEY = "multi_agent_mode";
function removeUnsupportedCodexMultiAgentModeConfig(config) {
  const lines = config.split(/\n/);
  const output = [];
  let inRoot = true;
  let changed = false;
  for (const line of lines) {
    const sectionHeader = isSectionHeader3(line);
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
function isSectionHeader3(line) {
  return isTomlTableHeaderLine(line);
}
function isRootSetting2(line, key) {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("#") || trimmed.startsWith("["))
    return false;
  const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/);
  return match?.[1] === key;
}

// ../src/install/codex-multi-agent-v2-config.ts
import { readFileSync } from "node:fs";
import { dirname as dirname7, isAbsolute as isAbsolute5, join as join17 } from "node:path";
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
    return join17(dirname7(configPath), "models_cache.json");
  return isAbsolute5(configuredPath) ? configuredPath : join17(dirname7(configPath), configuredPath);
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
  if (!isRecord2(cache) || !Array.isArray(cache.models))
    return null;
  for (const entry of cache.models) {
    if (!isRecord2(entry))
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
function isRecord2(value) {
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

// ../src/install/codex-config-toml.ts
async function updateCodexConfig(input) {
  await mkdir6(dirname8(input.configPath), { recursive: true });
  let config;
  try {
    config = await readFile10(input.configPath, "utf8");
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

// ../src/install/codex-git-bash-mcp-env.ts
import { readFile as readFile11, writeFile as writeFile7 } from "node:fs/promises";
import { join as join18 } from "node:path";
var GIT_BASH_ENV_KEY = "OMO_CODEX_GIT_BASH_PATH";
var CODEGRAPH_RELATIVE_ARGS = new Set(["components/codegraph/dist/serve.js", "./components/codegraph/dist/serve.js"]);
async function stampGitBashMcpEnv(input) {
  const manifestPath = join18(input.pluginRoot, ".mcp.json");
  if (!await fileExistsStrict(manifestPath))
    return false;
  const parsed = JSON.parse(await readFile11(manifestPath, "utf8"));
  if (!isPlainRecord(parsed) || !isPlainRecord(parsed["mcpServers"]))
    return false;
  let changed = stampCodegraphMcpPath(parsed["mcpServers"], input.pluginRoot);
  if (input.platform === "win32") {
    const rawOverride = input.env?.[GIT_BASH_ENV_KEY];
    const override = typeof rawOverride === "string" ? rawOverride.trim() : "";
    const gitBashServer = parsed["mcpServers"]["git_bash"];
    if (override !== "" && isPlainRecord(gitBashServer)) {
      const serverEnv = isPlainRecord(gitBashServer["env"]) ? gitBashServer["env"] : {};
      if (serverEnv[GIT_BASH_ENV_KEY] !== override) {
        gitBashServer["env"] = { ...serverEnv, [GIT_BASH_ENV_KEY]: override };
        changed = true;
      }
    }
  }
  if (!changed)
    return false;
  await writeFile7(manifestPath, `${JSON.stringify(parsed, null, "\t")}
`);
  return true;
}
function stampCodegraphMcpPath(mcpServers, pluginRoot) {
  const codegraphServer = mcpServers["codegraph"];
  if (!isPlainRecord(codegraphServer) || !Array.isArray(codegraphServer["args"]))
    return false;
  const args = codegraphServer["args"];
  const entrypoint = args[0];
  if (typeof entrypoint !== "string" || !CODEGRAPH_RELATIVE_ARGS.has(entrypoint))
    return false;
  codegraphServer["args"] = [join18(pluginRoot, "components", "codegraph", "dist", "serve.js"), ...args.slice(1)];
  return true;
}

// ../src/install/codex-hook-trust.ts
import { createHash as createHash3 } from "node:crypto";
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
  if (!await exists4(manifestPath))
    return [];
  const manifest = JSON.parse(await readFile12(manifestPath, "utf8"));
  if (!isPlainRecord(manifest))
    return [];
  const states = [];
  for (const hookPath of hookManifestPaths(manifest.hooks)) {
    const hooksPath = join19(input.pluginRoot, hookPath);
    if (!await exists4(hooksPath))
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
function hookManifestPaths(value) {
  if (typeof value === "string" && value.trim() !== "")
    return [stripDotSlash(value)];
  if (!Array.isArray(value))
    return [];
  return value.filter((item) => typeof item === "string" && item.trim() !== "").map(stripDotSlash);
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
  return `sha256:${createHash3("sha256").update(canonical).digest("hex")}`;
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
function stripDotSlash(value) {
  return value.startsWith("./") ? value.slice(2) : value;
}
async function exists4(path) {
  try {
    await readFile12(path, "utf8");
    return true;
  } catch (error) {
    if (error instanceof Error)
      return false;
    return false;
  }
}

// ../src/install/codex-installer-bin-dir.ts
import { homedir as homedir4 } from "node:os";
import { join as join20, resolve as resolve6 } from "node:path";
function resolveCodexInstallerBinDir(input) {
  const explicitBinDir = input.binDir ?? input.env?.CODEX_LOCAL_BIN_DIR;
  if (explicitBinDir !== undefined && explicitBinDir.trim().length > 0)
    return resolve6(explicitBinDir.trim());
  const homeDir = input.homeDir ?? homedir4();
  const defaultCodexHome = resolve6(homeDir, ".codex");
  const resolvedCodexHome = resolve6(input.codexHome);
  if (resolvedCodexHome !== defaultCodexHome)
    return join20(resolvedCodexHome, "bin");
  return resolve6(homeDir, ".local", "bin");
}

// ../../utils/src/runtime/git-bash.ts
import { execFileSync as execFileSync2 } from "node:child_process";
import { existsSync as existsSync2 } from "node:fs";
var GIT_BASH_ENV_KEY2 = "OMO_CODEX_GIT_BASH_PATH";
var PROGRAM_FILES_GIT_BASH = "C:\\Program Files\\Git\\bin\\bash.exe";
var PROGRAM_FILES_X86_GIT_BASH = "C:\\Program Files (x86)\\Git\\bin\\bash.exe";
var NON_GIT_BASH_LAUNCHER_DIR_SEGMENTS = ["\\windows\\system32\\", "\\microsoft\\windowsapps\\"];
function resolveGitBash(input) {
  if (input.platform !== "win32")
    return { found: true, path: null, source: "not-required", checkedPaths: [] };
  const checkedPaths = [];
  const envPath = nonEmptyEnvValue(input.env, GIT_BASH_ENV_KEY2);
  if (envPath !== undefined) {
    checkedPaths.push(envPath);
    if (isBashExePath(envPath) && input.exists(envPath)) {
      return { found: true, path: envPath, source: "env", checkedPaths };
    }
    return missingGitBash(checkedPaths);
  }
  for (const candidate2 of [
    { path: PROGRAM_FILES_GIT_BASH, source: "program-files" },
    { path: PROGRAM_FILES_X86_GIT_BASH, source: "program-files-x86" }
  ]) {
    checkedPaths.push(candidate2.path);
    if (input.exists(candidate2.path))
      return { found: true, path: candidate2.path, source: candidate2.source, checkedPaths };
  }
  for (const pathCandidate of input.where("bash")) {
    const candidate2 = pathCandidate.trim();
    if (candidate2.length === 0)
      continue;
    checkedPaths.push(candidate2);
    if (isKnownNonGitBashLauncher(candidate2))
      continue;
    if (isBashExePath(candidate2) && input.exists(candidate2))
      return { found: true, path: candidate2, source: "path", checkedPaths };
  }
  return missingGitBash(checkedPaths);
}
var resolveGitBashForCurrentProcess = (input = {}) => {
  return resolveGitBash({
    platform: input.platform ?? process.platform,
    env: input.env ?? process.env,
    exists: existsSync2,
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
      `For a custom install, set ${GIT_BASH_ENV_KEY2}=C:\\path\\to\\bash.exe`
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
    return execFileSync2("where", [command], { encoding: "utf8" }).split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  } catch (error) {
    if (error instanceof Error)
      return [];
    throw error;
  }
}

// ../src/install/git-bash.ts
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
      `For a custom install, set ${GIT_BASH_ENV_KEY2}=C:\\path\\to\\bash.exe`,
      "Then rerun `npx lazycodex-ai install`."
    ].join(`
`)
  };
}

// components/bootstrap/src/setup.ts
var SETUP_MARKETPLACE_NAME = "sisyphuslabs";
var SETUP_PLUGIN_NAME = "omo";
var GIT_BASH_INSTALL_HINT = "winget install --id Git.Git -e --source winget";
async function runWorkerSetup(options) {
  const degraded = [];
  const gitBashEnabled = await resolveGitBashStep(options, degraded);
  const agents = await linkBundledAgentsStep(options);
  degraded.push(...agents.degraded);
  await updateConfigStep(options, { agentConfigs: agents.agentConfigs, gitBashEnabled }, degraded);
  await stampGitBashEnvStep(options, degraded);
  await linkComponentBinsStep(options, degraded);
  return { degraded };
}
async function resolveGitBashStep(options, degraded) {
  if (options.platform !== "win32")
    return false;
  try {
    const resolution = await prepareGitBashForInstall({
      env: options.env,
      platform: options.platform,
      ...options.resolveGitBash === undefined ? {} : { resolveGitBash: options.resolveGitBash }
    });
    if (resolution.found)
      return true;
    degraded.push({
      component: "git-bash",
      hint: GIT_BASH_INSTALL_HINT,
      reason: "Git Bash was not found on this Windows machine; the omo git_bash MCP server stays disabled"
    });
  } catch (error) {
    degraded.push({
      component: "git-bash",
      hint: GIT_BASH_INSTALL_HINT,
      reason: `Git Bash preflight failed: ${errorMessage(error)}`
    });
  }
  return false;
}
async function linkBundledAgentsStep(options) {
  const agentsTarget = join21(options.codexHome, "agents");
  try {
    const stageRoot = join21(options.pluginData, "bootstrap", "agents-stage");
    await stageBundledAgents(options.pluginRoot, stageRoot);
    const preservedReasoning = await capturePreservedAgentReasoning({ codexHome: options.codexHome });
    const preservedServiceTier = await capturePreservedAgentServiceTier({ codexHome: options.codexHome });
    const linked = await linkCachedPluginAgents({
      codexHome: options.codexHome,
      pluginRoot: stageRoot,
      preservedReasoning,
      preservedServiceTier
    });
    const agentConfigs = linked.map((link) => ({ configFile: `./agents/${link.name}`, name: agentNameFromToml3(link.name) })).sort((left, right) => left.name.localeCompare(right.name));
    return { agentConfigs, degraded: [] };
  } catch (error) {
    return {
      agentConfigs: [],
      degraded: [
        {
          component: "agents",
          hint: BOOTSTRAP_DOCTOR_HINT,
          reason: `failed to link bundled agents into ${agentsTarget}: ${errorMessage(error)}`
        }
      ]
    };
  }
}
async function stageBundledAgents(pluginRoot, stageRoot) {
  await rm10(stageRoot, { force: true, recursive: true });
  await mkdir7(stageRoot, { recursive: true });
  const componentsRoot = join21(pluginRoot, "components");
  for (const componentName of await directoryNames(componentsRoot)) {
    const agentsDir = join21(componentsRoot, componentName, "agents");
    const agentFiles = (await fileNames(agentsDir)).filter((name) => name.endsWith(".toml"));
    if (agentFiles.length === 0)
      continue;
    const stagedAgentsDir = join21(stageRoot, "components", componentName, "agents");
    await mkdir7(stagedAgentsDir, { recursive: true });
    for (const agentFile of agentFiles) {
      await copyFile2(join21(agentsDir, agentFile), join21(stagedAgentsDir, agentFile));
    }
  }
}
async function updateConfigStep(options, inputs, degraded) {
  const configPath = join21(options.codexHome, "config.toml");
  try {
    await assertWritableConfigIfPresent(configPath);
    const existingConfig = await readConfigIfPresent(configPath);
    const agentConfigs = inputs.agentConfigs.filter((agentConfig) => !hasForeignAgentRegistration(existingConfig, agentConfig));
    const trustedHookStates = await trustedHookStatesForPlugin({
      marketplaceName: SETUP_MARKETPLACE_NAME,
      pluginName: SETUP_PLUGIN_NAME,
      pluginRoot: options.pluginRoot
    });
    await updateCodexConfig({
      agentConfigs,
      autonomousPermissions: false,
      configPath,
      gitBashEnabled: inputs.gitBashEnabled,
      marketplaceName: SETUP_MARKETPLACE_NAME,
      marketplaceSource: { sourceType: "local", source: options.pluginRoot },
      platform: options.platform,
      pluginNames: [SETUP_PLUGIN_NAME],
      preserveMarketplaceSource: true,
      repoRoot: options.pluginRoot,
      trustedHookStates
    });
  } catch (error) {
    degraded.push({
      component: "config",
      hint: BOOTSTRAP_DOCTOR_HINT,
      reason: `failed to update ${configPath}: ${errorMessage(error)}`
    });
  }
}
async function assertWritableConfigIfPresent(configPath) {
  try {
    if (((await stat5(configPath)).mode & 146) === 0)
      throw new Error(`${configPath} has no write permission bits set`);
  } catch (error) {
    if (errorCode(error) === "ENOENT")
      return;
    throw error;
  }
}
function errorCode(error) {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}
async function readConfigIfPresent(configPath) {
  try {
    return await readFile13(configPath, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT")
      return "";
    throw error;
  }
}
async function linkComponentBinsStep(options, degraded) {
  const binDir = resolveCodexInstallerBinDir({ codexHome: options.codexHome, env: options.env });
  try {
    await linkCachedPluginBins({ binDir, pluginRoot: options.pluginRoot, platform: options.platform });
  } catch (error) {
    degraded.push({
      component: "bin-links",
      hint: BOOTSTRAP_DOCTOR_HINT,
      reason: `failed to link component bins into ${binDir}: ${errorMessage(error)}`
    });
  }
  await linkRuntimeWrapperStep(options, binDir, degraded);
}
async function linkRuntimeWrapperStep(options, binDir, degraded) {
  const cliPath = join21(options.pluginRoot, "dist", "cli", "index.js");
  try {
    const linked = await linkRootRuntimeBin({
      binDir,
      codexHome: options.codexHome,
      platform: options.platform,
      repoRoot: options.pluginRoot
    });
    if (linked !== null)
      return;
    degraded.push({
      component: "omo-agent-toolkit",
      hint: "use npx lazycodex-ai for the omo-agent-toolkit CLI",
      reason: "marketplace payload has no dist/cli"
    });
    await appendBootstrapLog(options.pluginData, options.now ?? Date.now(), "omo-agent-toolkit-degraded", {
      warning: `Warning: skipped the omo-agent-toolkit runtime wrapper because ${cliPath} is missing; omo-agent-toolkit ulw-loop commands will be unavailable until a package shipping dist/cli is installed`
    });
  } catch (error) {
    degraded.push({
      component: "omo-agent-toolkit",
      hint: BOOTSTRAP_DOCTOR_HINT,
      reason: `failed to link the omo-agent-toolkit runtime wrapper into ${binDir}: ${errorMessage(error)}`
    });
  }
}
async function stampGitBashEnvStep(options, degraded) {
  try {
    await stampGitBashMcpEnv({ env: options.env, platform: options.platform, pluginRoot: options.pluginRoot });
  } catch (error) {
    degraded.push({
      component: "git-bash-env",
      hint: BOOTSTRAP_DOCTOR_HINT,
      reason: `failed to stamp ${join21(options.pluginRoot, ".mcp.json")}: ${errorMessage(error)}`
    });
  }
}
async function directoryNames(root) {
  return entryNames(root, (entry) => entry.isDirectory());
}
async function fileNames(root) {
  return entryNames(root, (entry) => entry.isFile());
}
async function entryNames(root, keep) {
  try {
    const entries = await readdir5(root, { withFileTypes: true });
    return entries.filter((entry) => keep(entry)).map((entry) => entry.name).sort();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return [];
    throw error;
  }
}
function agentNameFromToml3(fileName) {
  return fileName.endsWith(".toml") ? fileName.slice(0, -".toml".length) : fileName;
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

// components/bootstrap/src/worker.ts
var BOOTSTRAP_DOCTOR_HINT = "npx lazycodex-ai doctor";
function parseWorkerFlags(argv) {
  let codexHome;
  let manifestDir;
  let once = false;
  let only;
  for (let index = 0;index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--once") {
      once = true;
      continue;
    }
    if (flag === "--codex-home") {
      codexHome = requireFlagValue(argv, index, flag);
      index += 1;
      continue;
    }
    if (flag === "--only") {
      only = requireFlagValue(argv, index, flag);
      index += 1;
      continue;
    }
    if (flag === "--manifest-dir") {
      manifestDir = requireFlagValue(argv, index, flag);
      index += 1;
      continue;
    }
    throw new Error(`unknown worker flag: ${flag}`);
  }
  return {
    once,
    ...codexHome === undefined ? {} : { codexHome },
    ...manifestDir === undefined ? {} : { manifestDir },
    ...only === undefined ? {} : { only }
  };
}
function resolvePluginDataRoot(env) {
  const fromEnv = env["PLUGIN_DATA"]?.trim();
  if (fromEnv !== undefined && fromEnv.length > 0)
    return fromEnv;
  return join22(homedir5(), ".local", "share", "lazycodex");
}
async function readPluginVersion(pluginRoot) {
  try {
    const parsed = JSON.parse(await readFile14(join22(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
    if (typeof parsed !== "object" || parsed === null)
      return;
    const version = parsed["version"];
    if (typeof version !== "string")
      return;
    const trimmed = version.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return;
  }
}
async function readBootstrapState(statePath) {
  return parseBootstrapState(await readState(statePath));
}
function parseBootstrapState(raw) {
  const completedForVersion = typeof raw["completedForVersion"] === "string" ? raw["completedForVersion"] : undefined;
  const lastAttemptAt = typeof raw["lastAttemptAt"] === "number" ? raw["lastAttemptAt"] : undefined;
  const lastStatus = raw["lastStatus"] === "success" || raw["lastStatus"] === "degraded" ? raw["lastStatus"] : undefined;
  const degraded = parseDegradedEntries(raw["degraded"]);
  return {
    ...completedForVersion === undefined ? {} : { completedForVersion },
    ...lastAttemptAt === undefined ? {} : { lastAttemptAt },
    ...lastStatus === undefined ? {} : { lastStatus },
    ...degraded === undefined ? {} : { degraded }
  };
}
function defaultWorkerSteps(seams = {}) {
  return [
    {
      name: "setup",
      run: (context) => runWorkerSetup(context)
    },
    {
      name: "sg",
      run: (context) => runSgProvision(context, seams.sg)
    }
  ];
}
async function runBootstrapWorker(options = {}) {
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now();
  const platform = options.platform ?? process.platform;
  const flags = parseWorkerFlags(options.argv ?? []);
  const steps = options.steps ?? defaultWorkerSteps();
  if (flags.only !== undefined && !steps.some((step) => step.name === flags.only)) {
    throw new Error(`unknown --only flag value: ${flags.only}`);
  }
  const pluginRoot = resolvePluginRoot(env);
  const pluginData = resolvePluginDataRoot(env);
  const statePath = resolveBootstrapStatePath(pluginData);
  const lockEnv = { ...env, PLUGIN_DATA: pluginData };
  const locks = await bootstrapLocks({ env: lockEnv, now, pluginData });
  if (locks === null)
    return { ran: false, reason: "locked" };
  try {
    const pluginVersion = await readPluginVersion(pluginRoot);
    const marker = await readBootstrapState(statePath);
    if (!flags.once && pluginVersion !== undefined && marker.completedForVersion === pluginVersion) {
      await appendBootstrapLog(pluginData, now, "worker-skipped", { reason: "already-completed", version: pluginVersion });
      return { ran: false, reason: "already-completed" };
    }
    const codexHome = flags.codexHome ?? (await resolveCodexHome({ env, pluginRoot })).path;
    const context = { codexHome, env, flags, now, platform, pluginData, pluginRoot, pluginVersion };
    await appendBootstrapLog(pluginData, now, "worker-started", { version: pluginVersion ?? "unknown" });
    const degraded = [];
    if (pluginVersion === undefined) {
      degraded.push({
        component: "bootstrap",
        hint: BOOTSTRAP_DOCTOR_HINT,
        reason: `plugin version unresolved from ${join22(pluginRoot, ".codex-plugin", "plugin.json")}`
      });
    }
    for (const step of steps) {
      if (flags.only !== undefined && step.name !== flags.only)
        continue;
      degraded.push(...await runStep(step, context));
    }
    const status = degraded.length === 0 ? "success" : "degraded";
    const state = {
      ...pluginVersion === undefined ? {} : { completedForVersion: pluginVersion },
      degraded,
      lastAttemptAt: now,
      lastStatus: status
    };
    await writeState(statePath, state);
    await appendBootstrapLog(pluginData, now, "worker-finished", { degradedCount: degraded.length, status });
    return { degraded, ran: true, statePath, status };
  } finally {
    await locks.release();
  }
}
async function runStep(step, context) {
  try {
    return (await step.run(context)).degraded;
  } catch (error) {
    return [
      {
        component: step.name,
        hint: BOOTSTRAP_DOCTOR_HINT,
        reason: error instanceof Error ? error.message : String(error)
      }
    ];
  }
}
function resolvePluginRoot(env) {
  const fromEnv = env["PLUGIN_ROOT"]?.trim();
  if (fromEnv !== undefined && fromEnv.length > 0)
    return fromEnv;
  return resolve7(dirname9(fileURLToPath2(import.meta.url)), "..", "..", "..");
}
async function appendBootstrapLog(pluginData, now, event, details) {
  try {
    const logPath = join22(pluginData, "bootstrap", "bootstrap.log");
    await mkdir8(dirname9(logPath), { recursive: true });
    await appendFile2(logPath, `${JSON.stringify({ timestamp: new Date(now).toISOString(), event, ...details })}
`);
  } catch {}
}
function parseDegradedEntries(raw) {
  if (!Array.isArray(raw))
    return;
  const entries = [];
  for (const candidate2 of raw) {
    if (typeof candidate2 !== "object" || candidate2 === null)
      continue;
    const record = candidate2;
    if (typeof record["component"] !== "string" || typeof record["reason"] !== "string")
      continue;
    entries.push({
      component: record["component"],
      reason: record["reason"],
      ...typeof record["hint"] === "string" ? { hint: record["hint"] } : {}
    });
  }
  return entries;
}
function requireFlagValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

// components/bootstrap/src/hook.ts
var BOOTSTRAP_RESTART_NOTICE = "LazyCodex bootstrap running in background — restart the session when it completes";
async function runSessionStartHook(options) {
  return (await executeSessionStartHook(options)).exitCode;
}
async function executeSessionStartHook(options) {
  if (options.stdin !== undefined)
    await drainStdin(options.stdin);
  const now = options.now ?? Date.now();
  const pluginRoot = options.env["PLUGIN_ROOT"]?.trim();
  const pluginData = options.env["PLUGIN_DATA"]?.trim();
  if (pluginRoot === undefined || pluginRoot.length === 0 || pluginData === undefined || pluginData.length === 0) {
    return { action: "skip-missing-env", exitCode: 0 };
  }
  const pluginVersion = await readPluginVersion(pluginRoot);
  if (pluginVersion === undefined)
    return { action: "skip-version-unresolved", exitCode: 0 };
  const state = await readBootstrapState(resolveBootstrapStatePath(pluginData));
  if (state.completedForVersion === pluginVersion)
    return { action: "skip-completed", exitCode: 0 };
  if (await isLockFresh(resolveBootstrapLockPath(pluginData), now))
    return { action: "skip-locked", exitCode: 0 };
  const spawnWorker = options.spawnWorker ?? spawnDetachedWorker;
  spawnWorker({
    args: [options.workerCliPath ?? defaultWorkerCliPath(), "worker"],
    command: process.execPath,
    env: options.env
  });
  const writeNotice = options.writeNotice ?? ((line) => process.stdout.write(`${line}
`));
  writeNotice(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: BOOTSTRAP_RESTART_NOTICE
    }
  }));
  return { action: "spawned", exitCode: 0 };
}
function spawnDetachedWorker(invocation) {
  const child = spawn(invocation.command, [...invocation.args], {
    detached: true,
    env: invocation.env,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
}
function defaultWorkerCliPath() {
  return fileURLToPath3(import.meta.url);
}
async function isLockFresh(lockPath, now) {
  try {
    const lockStat = await stat6(lockPath);
    return now - lockStat.mtimeMs < DEFAULT_LOCK_STALE_MS;
  } catch {
    return false;
  }
}
async function drainStdin(stdin) {
  if (stdin.isTTY === true)
    return;
  for await (const chunk of stdin) {}
}

// components/bootstrap/src/cli.ts
var TOP_LEVEL_HELP = `Usage:
  omo-bootstrap hook session-start
  omo-bootstrap worker [--codex-home <dir>] [--once] [--only <step>] [--manifest-dir <dir>]
  omo-bootstrap download <manifest> <platform> <destination-dir>
  omo-bootstrap help | --help | -h
`;
async function runDownloadCommand(args) {
  const [manifestName, platformKey, destinationDir] = args;
  if (manifestName === undefined || platformKey === undefined || destinationDir === undefined) {
    process.stderr.write(`[omo-bootstrap] download requires <manifest> <platform> <destination-dir>
${TOP_LEVEL_HELP}`);
    return 1;
  }
  try {
    const destination = await downloadFromManifest({ destinationDir, manifestName, platformKey });
    process.stdout.write(`OK:${destination}
`);
    return 0;
  } catch (error) {
    process.stderr.write(`[omo-bootstrap] download failed: ${error instanceof Error ? error.message : String(error)}
`);
    return 1;
  }
}
async function runWorkerCommand(args) {
  let result;
  try {
    result = await runBootstrapWorker({ argv: args, env: process.env });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/flag/.test(message)) {
      process.stderr.write(`[omo-bootstrap] ${message}
${TOP_LEVEL_HELP}`);
      return 1;
    }
    process.stderr.write(`[omo-bootstrap] worker error: ${message}
`);
    return 0;
  }
  process.stdout.write(result.ran ? `[omo-bootstrap] worker finished: ${result.status}
` : `[omo-bootstrap] worker skipped: ${result.reason}
`);
  return 0;
}
async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(TOP_LEVEL_HELP);
    return 0;
  }
  if (command === "hook" && argv[1] === "session-start") {
    return runSessionStartHook({ env: process.env, stdin: process.stdin });
  }
  if (command === "worker") {
    return runWorkerCommand(argv.slice(1));
  }
  if (command === "download") {
    return runDownloadCommand(argv.slice(1));
  }
  process.stderr.write(`[omo-bootstrap] unknown command: ${argv.join(" ")}
${TOP_LEVEL_HELP}`);
  return 1;
}
function isProcessEntry() {
  const entry = process.argv[1];
  if (entry === undefined)
    return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath4(import.meta.url));
  } catch {
    return false;
  }
}
if (isProcessEntry()) {
  main().then((code) => {
    process.exit(code);
  }).catch((error) => {
    process.stderr.write(`[omo-bootstrap] ${error instanceof Error ? error.message : String(error)}
`);
    process.exit(0);
  });
}
export {
  sgProvisionDestination,
  runWorkerSetup,
  runSgProvision,
  runSessionStartHook,
  runBootstrapWorker,
  resolvePluginDataRoot,
  resolveCodexHome,
  resolveBootstrapStatePath,
  resolveBootstrapLockPath,
  readPluginVersion,
  readBootstrapState,
  parseWorkerFlags,
  parseBootstrapState,
  executeSessionStartHook,
  detectInstallFlowFromEnvironment,
  detectInstallFlowForTest,
  detectInstallFlowDetailed,
  detectInstallFlow,
  defaultWorkerSteps,
  bootstrapLocks,
  appendBootstrapLog,
  SG_PROVISION_COMPONENT,
  SG_FORCE_PROVISION_ENV_KEY,
  SETUP_PLUGIN_NAME,
  SETUP_MARKETPLACE_NAME,
  INSTALL_SNAPSHOT_FILENAME,
  GIT_BASH_INSTALL_HINT,
  BOOTSTRAP_RESTART_NOTICE,
  BOOTSTRAP_DOCTOR_HINT
};
