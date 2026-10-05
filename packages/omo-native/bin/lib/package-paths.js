import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, join, parse } from "node:path"
import { fileURLToPath } from "node:url"
import { canonicalAgentDir } from "./agent-dir.js"
import { resolvePluginRoot } from "./plugin-root.js"

export const packageRoot = fileURLToPath(new URL("../..", import.meta.url))

export function nativePluginRoot(env = process.env) {
  return resolvePluginRoot(join(packageRoot, "plugin"), join(canonicalAgentDir(env), "native-plugin"))
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}

export function packageManifest() {
  return readJson(join(packageRoot, "package.json"))
}

const BUN_GLOBAL_PACKAGE_SUFFIX = "/install/global/node_modules/omo-ai"

/** The npm dist-tag this build ships on: a prerelease version is on beta, a stable one on latest. */
export function releaseChannel(version = packageManifest().version) {
  return typeof version === "string" && version.includes("-") ? "beta" : "latest"
}

/** The version the npm dist-tag of `version`'s channel names, or undefined when the tags lack it. */
export function channelDistTagVersion(distTags, version = packageManifest().version) {
  if (distTags === null || distTags === undefined || typeof distTags !== "object") return undefined
  const value = distTags[releaseChannel(version)]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

/** The startup banner line: a prerelease names its beta channel, a stable release does not. */
export function releaseBanner(version = packageManifest().version) {
  return releaseChannel(version) === "beta" ? `omo (omo-ai beta ${version})` : `omo (omo-ai ${version})`
}

/** The package spec that installs this build's channel: `omo-ai@beta` or the bare `omo-ai`. */
export function channelPackageSpec(version = packageManifest().version) {
  return releaseChannel(version) === "beta" ? "omo-ai@beta" : "omo-ai"
}

function installedVersion(root) {
  try {
    return readJson(join(root, "package.json")).version
  } catch {
    return packageManifest().version
  }
}

/**
 * The package-manager command that updates the install at `root`. `targetVersion` pins the exact
 * `omo-ai@<version>` spec; without it the channel spec is installed.
 *
 * @param {string} [root]
 * @param {NodeJS.Platform} [platform]
 * @param {string} [version]
 * @param {string} [homeDir]
 * @param {(path: string) => boolean} [exists]
 * @param {string} [targetVersion]
 */
export function updateTarget(
  root = packageRoot,
  platform = process.platform,
  version = installedVersion(root),
  homeDir = process.env.HOME || process.env.USERPROFILE || homedir(),
  exists = existsSync,
  targetVersion = undefined,
) {
  // A resolved target installs that exact version; without one the channel spec is the only answer.
  const spec = targetVersion === undefined ? channelPackageSpec(version) : `omo-ai@${targetVersion}`
  const updateCwd = dirname(join(root, "package.json"))
  const normalizedRoot = updateCwd.replaceAll("\\", "/")
  const normalizedHome = homeDir.replaceAll("\\", "/").replace(/\/+$/, "")
  const bunInstall = normalizedRoot.endsWith(BUN_GLOBAL_PACKAGE_SUFFIX)
    ? normalizedRoot.slice(0, -BUN_GLOBAL_PACKAGE_SUFFIX.length)
    : undefined
  const isLegacyBunGlobal = normalizedRoot === `${normalizedHome}/node_modules/omo-ai`
    && (exists(join(homeDir, "bun.lock")) || exists(join(homeDir, "bun.lockb")))
  if (bunInstall !== undefined || isLegacyBunGlobal) {
    // `--cwd` into this package dir does not retarget `bun add -g`; bun still installs into
    // `$BUN_INSTALL/install/global` (or `~/.bun` when that env is unset). The prefix is the
    // ancestor of `/install/global/`, and the spawn overlays it so this install is the one that
    // moves. A legacy Bun home-root install must carry Bun's lockfile and keeps its ambient configuration.
    return {
      manager: "bun",
      command: `bun add -g ${spec}`,
      argv: ["bun", "add", "-g", spec],
      ...(bunInstall === undefined ? {} : { env: { BUN_INSTALL: bunInstall } }),
    }
  }
  return {
    manager: "npm",
    command: `npm i -g ${spec}`,
    argv: ["npm", "i", "-g", spec],
  }
}

export function resolveSenpi(options = {}) {
  const {
    resolveIndex = () => fileURLToPath(import.meta.resolve("@code-yeongyu/senpi")),
    platform = process.platform,
  } = options
  let indexPath
  try {
    indexPath = resolveIndex()
  } catch (error) {
    throw new Error(`could not resolve @code-yeongyu/senpi; reinstall with: ${updateTarget().command} (${error.message})`)
  }

  const distDir = dirname(indexPath)
  // A senpi that ships `dist/bundle/cli.js` hands the launcher one pre-linked esbuild bundle in
  // place of the module graph `dist/cli.js` pulls in, so the engine boot skips every one of those
  // resolutions. It is the engine's artifact, not this launcher's: an installed engine without it
  // resolves exactly as it always did, and the pin can move in either direction without a
  // launcher change.
  const bundlePath = join(distDir, "bundle", "cli.js")
  const unbundledPath = join(distDir, "cli.js")
  const cliPath = existsSync(bundlePath) ? bundlePath : unbundledPath
  if (!existsSync(cliPath)) {
    throw new Error(`senpi CLI is missing at ${cliPath}; reinstall with: ${updateTarget().command}`)
  }
  // The engine imports this module on every boot, and it is the file interrupted upgrades lose in
  // the wild (npm reify dies on a Windows-locked native module and leaves a partial tree), so
  // checking it here turns the engine's raw ERR_MODULE_NOT_FOUND stack into one actionable line.
  const brandPath = join(distDir, "core", "brand.js")
  if (!existsSync(brandPath)) {
    const windowsHint = platform === "win32"
      ? " (close every running omo/senpi process first: Windows locks loaded native modules, so npm fails with EBUSY mid-upgrade and leaves exactly this partial state)"
      : ""
    throw new Error(
      `senpi engine files are incomplete: ${brandPath} is missing, which usually means an interrupted or failed omo-ai upgrade; reinstall with: ${updateTarget().command}${windowsHint}`,
    )
  }
  return { cliPath, packageRoot: dirname(dirname(indexPath)) }
}

export function nearestNodeBin(startPath) {
  // Hoisted layouts place the engine package inside a shared node_modules (…/node_modules/senpi),
  // whose .bin is a sibling, not a child - starting the climb inside node_modules would walk to the
  // filesystem root and never find it. For unscoped packages begin at the package's parent; for
  // scoped packages (…/node_modules/@scope/package), begin at the parent of node_modules instead.
  let current = basename(startPath) === "node_modules" ? dirname(startPath)
    : basename(dirname(startPath)) === "node_modules" ? dirname(dirname(startPath))
    : basename(dirname(dirname(startPath))) === "node_modules" ? dirname(dirname(dirname(startPath)))
    : startPath
  const root = parse(current).root
  while (true) {
    const candidate = join(current, "node_modules", ".bin")
    if (existsSync(candidate)) return candidate
    if (current === root) return undefined
    current = dirname(current)
  }
}
