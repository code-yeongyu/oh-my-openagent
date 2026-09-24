import { closeSync, lstatSync, openSync, readFileSync, readSync, realpathSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { delimiter, dirname, isAbsolute, join, win32 } from "node:path"
import { parseJsonc } from "./jsonc.js"
import { opencodeConfigSources } from "./setup-opencode-assets.js"

// Migration leftovers from the OpenCode edition, reported and never touched: another `omo` ahead of
// omo-ai's on PATH, the legacy package still installed globally, and the OpenCode plugin still
// registered. The owner rules mirror packages/omo-opencode/src/cli/install-native/legacy-omo-bin.ts,
// which this package cannot import.

const NATIVE_PACKAGE = "omo-ai"
const LEGACY_PACKAGES = ["oh-my-openagent", "oh-my-opencode"]
// The native installer repairs an `omo` owned by any of these, so the fix it names works for them.
const REPAIRABLE_BIN_OWNERS = [...LEGACY_PACKAGES, "lazycodex"]
const REPAIR_COMMAND = "bunx oh-my-openagent@beta install --platform=native"

const CODEX_LIGHT_WRAPPER_MARKER = "# OMO_GENERATED_RUNTIME_WRAPPER"
const CODEX_LIGHT_CACHE_VERSION = /[\\/]plugins[\\/]cache[\\/]sisyphuslabs[\\/]omo[\\/]([^\\/"'\s]+)[\\/]/
const WINDOWS_BIN_SUFFIXES = ["", ".cmd", ".ps1", ".exe"]
const OWNER_WALK_UP_LIMIT = 6
const SHIM_READ_LIMIT = 8192
// OpenCode's TUI plugins live beside its server config, in every user-scope config directory.
const TUI_CONFIG_FILES = ["tui.json", "tui.jsonc"]

/** Every location the checks read, derived only from the injected env, platform and home. */
export function resolveMigrationEnvironment({ env, platform, homeDir }) {
  const isWindows = platform === "win32"
  const pathValue = env.PATH ?? env.Path ?? ""
  // Only global bin dirs: a relative entry or a project's node_modules/.bin (which npx/bunx put on
  // PATH) holds a project dependency, not a global `omo`.
  const pathDirectories = pathValue
    .split(isWindows ? ";" : delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => (isWindows ? win32.isAbsolute(entry) : isAbsolute(entry)))
    .filter((entry) => !/(?:^|[\\/])node_modules[\\/]\.bin[\\/]?$/.test(entry))
  const npmPrefixes = [env.npm_config_prefix, env.NPM_CONFIG_PREFIX, npmrcPrefix(homeDir)]
    .filter((prefix) => typeof prefix === "string" && prefix !== "")
  // Global bins live in <prefix>/bin on POSIX and in <prefix> itself on Windows, so every global bin
  // dir on PATH also names a candidate prefix.
  for (const directory of pathDirectories) npmPrefixes.push(isWindows ? directory : dirname(directory))
  const bunRoot = env.BUN_INSTALL ? env.BUN_INSTALL : join(homeDir, ".bun")
  const opencode = opencodeConfigSources(homeDir, env)
  const opencodeConfigFiles = [
    ...opencode.files,
    ...opencode.directories.flatMap((directory) => TUI_CONFIG_FILES.map((name) => join(directory, name))),
  ]
  return { isWindows, pathDirectories, npmPrefixes, bunRoot, opencodeConfigFiles }
}

function npmrcPrefix(homeDir) {
  const npmrc = readWholeFile(join(homeDir, ".npmrc"))
  const value = npmrc?.match(/^\s*prefix\s*=\s*(.+?)\s*$/m)?.[1]
  if (value === undefined) return undefined
  return value.startsWith("~/") ? join(homeDir, value.slice(2)) : value
}

/** Every `omo` in the PATH dirs, in PATH order, classified by the package that owns it. */
export function scanOmoBins(environment) {
  const suffixes = environment.isWindows ? WINDOWS_BIN_SUFFIXES : [""]
  const seen = new Set()
  const entries = []
  for (const directory of environment.pathDirectories) {
    if (seen.has(directory)) continue
    seen.add(directory)
    const binPath = suffixes.map((suffix) => join(directory, `omo${suffix}`)).find(pathExists)
    if (binPath === undefined) continue
    const owner = resolveOwner(binPath)
    entries.push({ binPath, directory, owner, kind: classify(owner) })
  }
  return entries
}

/** The entries a typed `omo` reaches before omo-ai's own; all of them when omo-ai is not on PATH. */
export function shadowingOmoBins(entries) {
  const nativeIndex = entries.findIndex((entry) => entry.kind === "native")
  return (nativeIndex < 0 ? entries : entries.slice(0, nativeIndex)).filter((entry) => entry.kind !== "native")
}

function classify(owner) {
  if (owner === null) return "foreign"
  if (owner.name === NATIVE_PACKAGE) return "native"
  return REPAIRABLE_BIN_OWNERS.includes(owner.name) ? "legacy" : "foreign"
}

// A dangling symlink still occupies the name, so presence is lstat, not whether the target resolves.
// A directory, FIFO or socket named `omo` is not a command the shell would run.
function pathExists(path) {
  try {
    const stats = lstatSync(path)
    return stats.isFile() || stats.isSymbolicLink()
  } catch {
    return false
  }
}

function resolveOwner(binPath) {
  const real = realPathOf(binPath)
  const fromLink = isInsideNodeModules(real) ? ownerOfFile(real) : null
  if (fromLink !== null) return fromLink
  const shim = readFileHead(binPath, SHIM_READ_LIMIT)
  if (shim === undefined) return null
  if (shim.includes(CODEX_LIGHT_WRAPPER_MARKER)) {
    const version = shim.match(CODEX_LIGHT_CACHE_VERSION)?.[1]
    if (version !== undefined) return { name: "lazycodex", version }
  }
  // Ownership comes from an installed package the shim really launches, never from its text alone.
  for (const entry of shimEntryPaths(shim, dirname(binPath))) {
    if (!isInsideNodeModules(entry) || !pathExists(entry)) continue
    const owner = ownerOfFile(entry)
    if (owner !== null) return owner
  }
  return null
}

// A launcher names its entry absolutely (omo-ai's bun shim) or relative to itself (`%dp0%` in npm's
// `.cmd`, `$basedir` in the sh/.ps1 shims); any other relative path would resolve against the cwd.
function shimEntryPaths(shim, shimDirectory) {
  const paths = []
  for (const match of shim.matchAll(/(?<=["'])[^"'\n]*node_modules[\\/][^"'\n]*(?=["'])/g)) {
    const quoted = match[0]
    const relativeToShim = quoted.match(/^(?:%~?dp0%?|\$\{?basedir\}?)[\\/]?(.*)$/)?.[1]
    if (relativeToShim !== undefined) paths.push(join(shimDirectory, relativeToShim.replace(/\\/g, "/")))
    else if (isAbsolute(quoted)) paths.push(quoted)
  }
  return paths
}

function isInsideNodeModules(path) {
  return /(?:^|[\\/])node_modules[\\/]/.test(path)
}

function ownerOfFile(file) {
  let directory = dirname(file)
  for (let depth = 0; depth < OWNER_WALK_UP_LIMIT; depth += 1) {
    const owner = readManifest(join(directory, "package.json"))
    if (owner !== null) return owner
    const parent = dirname(directory)
    if (parent === directory) return null
    directory = parent
  }
  return null
}

function readManifest(path) {
  const text = readWholeFile(path)
  if (text === undefined) return null
  try {
    const parsed = JSON.parse(text)
    if (typeof parsed?.name !== "string" || parsed.name === "") return null
    return { name: parsed.name, version: typeof parsed.version === "string" ? parsed.version : null }
  } catch {
    return null
  }
}

function realPathOf(path) {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

// Only regular files: readFileSync on a FIFO blocks until a writer opens it, hanging the doctor.
function readWholeFile(path) {
  try {
    return statSync(path).isFile() ? readFileSync(path, "utf8") : undefined
  } catch {
    return undefined
  }
}

// A launcher's head is enough to classify it, and a compiled `omo` binary is tens of megabytes.
function readFileHead(path, limit) {
  let descriptor
  try {
    if (!statSync(path).isFile()) return undefined
    descriptor = openSync(path, "r")
    const buffer = Buffer.alloc(limit)
    return buffer.toString("utf8", 0, readSync(descriptor, buffer, 0, limit, 0))
  } catch {
    return undefined
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

/** oh-my-openagent / oh-my-opencode installs in any npm global prefix and in the bun global tree. */
export function findLegacyPackages(environment) {
  const npmModules = environment.isWindows ? ["node_modules"] : ["lib", "node_modules"]
  const roots = [
    ...environment.npmPrefixes.map((prefix) => ({ manager: "npm", modules: join(prefix, ...npmModules) })),
    { manager: "bun", modules: join(environment.bunRoot, "install", "global", "node_modules") },
  ]
  const seen = new Set()
  const found = []
  for (const { manager, modules } of roots) {
    for (const name of LEGACY_PACKAGES) {
      const packageDir = join(modules, name)
      const owner = readManifest(join(packageDir, "package.json"))
      if (owner?.name !== name) continue
      const key = realPathOf(packageDir)
      if (seen.has(key)) continue
      seen.add(key)
      found.push({ manager, name, version: owner.version, packageDir })
    }
  }
  return found
}

/** Which legacy plugin each OpenCode config file still registers, in string or tuple form. */
export function findOpenCodeRegistrations(configFiles) {
  const registrations = []
  for (const path of configFiles) {
    const text = readWholeFile(path)
    if (text === undefined) continue
    let config
    try {
      config = parseJsonc(text)
    } catch {
      continue // OpenCode reports its own unreadable config; guessing at it here would mislead.
    }
    const plugins = Array.isArray(config?.plugin) ? config.plugin : []
    for (const name of LEGACY_PACKAGES) {
      if (plugins.some((entry) => isPluginEntryFor(entry, name))) registrations.push({ name, path })
    }
  }
  return registrations
}

function isPluginEntryFor(entry, name) {
  const spec = Array.isArray(entry) ? entry[0] : entry
  if (typeof spec !== "string") return false
  return spec === name || spec.startsWith(`${name}@`) || spec.startsWith(`${name}/`)
}

function ownerLabel(owner) {
  if (owner === null) return "unknown owner"
  return owner.version === null ? owner.name : `${owner.name}@${owner.version}`
}

export function formatMigrationLines({ shadowing, nativeDirectory, legacyPackages, registrations, restoreCommand }) {
  const lines = []
  for (const entry of shadowing) {
    const fix = entry.kind === "legacy"
      ? `${REPAIR_COMMAND} (repairs it), or remove that file.`
      : nativeDirectory === null
        ? "remove that file, or put omo-ai's bin dir ahead of it on PATH."
        : `remove that file, or move ${nativeDirectory} ahead of ${entry.directory} on PATH.`
    lines.push(`WARN another omo precedes omo-ai on PATH: ${entry.binPath} (${ownerLabel(entry.owner)}). Fix: ${fix}`)
  }
  for (const found of legacyPackages) {
    const label = ownerLabel({ name: found.name, version: found.version })
    const remove = found.manager === "npm"
      ? `npm uninstall -g ${found.name}, then re-run ${restoreCommand} if omo disappears.`
      : `bun remove -g ${found.name}`
    lines.push(`WARN legacy package ${label} is still installed globally (${found.manager}: ${found.packageDir}). Remove: ${remove}`)
  }
  const byName = new Map()
  for (const { name, path } of registrations) byName.set(name, [...(byName.get(name) ?? []), path])
  for (const [name, paths] of byName) {
    lines.push(`INFO OpenCode still loads the ${name} plugin (${paths.join(", ")}). Keep it if you still use OpenCode; otherwise remove the plugin entry.`)
  }
  return lines
}

/** The doctor's migration section. `options.env` / `homeDir` / `platform` keep tests off the real machine. */
export function migrationReport(options, restoreCommand) {
  const environment = resolveMigrationEnvironment({
    env: options.env ?? process.env,
    platform: options.platform ?? process.platform,
    homeDir: options.homeDir ?? homedir(),
  })
  const bins = scanOmoBins(environment)
  return formatMigrationLines({
    shadowing: shadowingOmoBins(bins),
    nativeDirectory: bins.find((entry) => entry.kind === "native")?.directory ?? null,
    legacyPackages: findLegacyPackages(environment),
    registrations: findOpenCodeRegistrations(environment.opencodeConfigFiles),
    restoreCommand,
  })
}
