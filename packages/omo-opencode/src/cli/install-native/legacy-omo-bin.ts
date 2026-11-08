import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs"
import { dirname, isAbsolute, join, posix, win32 } from "node:path"

export const NATIVE_OMO_PACKAGE = "omo-ai"
export const LEGACY_OMO_BIN_PACKAGES: readonly string[] = ["oh-my-openagent", "oh-my-opencode", "lazycodex"]

// Pre-rename Codex Light installs wrote `omo` as a generated shell wrapper into ~/.local/bin, not as a
// package-manager link. The Light installer retires it by this marker; the cache path names the version.
const CODEX_LIGHT_WRAPPER_MARKER = "OMO_GENERATED_RUNTIME_WRAPPER"
const CODEX_LIGHT_CACHE_VERSION = /[\\/]plugins[\\/]cache[\\/]sisyphuslabs[\\/]omo[\\/]([^\\/"'\s]+)[\\/]/

const OMO_BIN_NAME = "omo"
// Windows filenames are case-insensitive, so one spelling per extension is enough.
const WINDOWS_BIN_SUFFIXES: readonly string[] = ["", ".cmd", ".ps1", ".exe"]
const OWNER_WALK_UP_LIMIT = 6
// Only the launcher shim is read for a path fragment, so it is capped. A package manifest is parsed
// as JSON and must be read whole: real manifests run well past any cap, and a truncated one parses
// as nothing, which used to make a legacy bin look unowned.
const SHIM_READ_LIMIT = 8192

export type OmoBinKind = "native" | "legacy" | "foreign"

export interface OmoBinEnvironment {
  readonly pathDirectories: readonly string[]
  readonly extraDirectories: readonly string[]
  readonly isWindows: boolean
}

export interface OmoBinEntry {
  readonly binPath: string
  readonly directory: string
  readonly onPath: boolean
  readonly kind: OmoBinKind
  readonly packageName: string | null
  readonly packageVersion: string | null
  /** Every file that carries this `omo` command, including the Windows `.cmd` / `.ps1` siblings. */
  readonly shimPaths: readonly string[]
}

interface OmoBinOwner {
  readonly name: string
  readonly version: string | null
}

export function resolveOmoBinEnvironment(input: {
  readonly env: Record<string, string | undefined>
  readonly platform: string
  readonly homeDir: string
}): OmoBinEnvironment {
  const isWindows = input.platform === "win32"
  // PATH is parsed with the rules of the platform being described, not the host running this:
  // `node:path`'s default delimiter/isAbsolute/join follow the host, so a POSIX environment
  // resolved on a Windows host would split on `;` and join with `\`.
  const pathRules = isWindows ? win32 : posix
  const pathValue = input.env["PATH"] ?? input.env["Path"] ?? ""
  // Only global bin dirs are in scope. A relative entry (`.`, `node_modules/.bin`) or a project's
  // `node_modules/.bin` (which `npx`/`bunx` put on PATH) holds a project dependency, not the global
  // `omo` the rename orphaned, and removing it would break that project.
  const pathDirectories = pathValue
    .split(pathRules.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => pathRules.isAbsolute(entry))
    .filter((entry) => !/(?:^|[\\/])node_modules[\\/]\.bin[\\/]?$/.test(entry))
  const bunInstall = input.env["BUN_INSTALL"]
  const bunBinDir = bunInstall ? pathRules.join(bunInstall, "bin") : pathRules.join(input.homeDir, ".bun", "bin")
  const extraDirectories = pathDirectories.includes(bunBinDir) ? [] : [bunBinDir]
  return { pathDirectories, extraDirectories, isWindows }
}

export function scanOmoBins(environment: OmoBinEnvironment): readonly OmoBinEntry[] {
  const visited = new Set<string>()
  const entries: OmoBinEntry[] = []

  const visit = (directory: string, onPath: boolean): void => {
    if (directory === "" || visited.has(directory)) return
    visited.add(directory)
    const shimPaths = omoShimPathsIn(directory, environment.isWindows)
    const binPath = shimPaths[0]
    if (binPath === undefined) return
    const owner = resolveOwner(binPath)
    entries.push({
      binPath,
      directory,
      onPath,
      kind: classify(owner),
      packageName: owner?.name ?? null,
      packageVersion: owner?.version ?? null,
      shimPaths,
    })
  }

  for (const directory of environment.pathDirectories) visit(directory, true)
  for (const directory of environment.extraDirectories) visit(directory, false)
  return entries
}

export function legacyOmoBins(entries: readonly OmoBinEntry[]): readonly OmoBinEntry[] {
  return entries.filter((entry) => entry.kind === "legacy")
}

export function nativeOmoBin(entries: readonly OmoBinEntry[]): OmoBinEntry | null {
  return entries.find((entry) => entry.kind === "native") ?? null
}

export function firstOmoBinOnPath(entries: readonly OmoBinEntry[]): OmoBinEntry | null {
  return entries.find((entry) => entry.onPath) ?? null
}

function classify(owner: OmoBinOwner | null): OmoBinKind {
  if (owner === null) return "foreign"
  if (owner.name === NATIVE_OMO_PACKAGE) return "native"
  return LEGACY_OMO_BIN_PACKAGES.includes(owner.name) ? "legacy" : "foreign"
}

function omoShimPathsIn(directory: string, isWindows: boolean): readonly string[] {
  const suffixes = isWindows ? WINDOWS_BIN_SUFFIXES : [""]
  return suffixes.map((suffix) => join(directory, `${OMO_BIN_NAME}${suffix}`)).filter(pathExists)
}

// A dangling symlink still occupies the bin name, and that is exactly what npm refuses to overwrite,
// so presence is decided by lstat rather than by whether the target resolves.
function pathExists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

function resolveOwner(binPath: string): OmoBinOwner | null {
  // Ownership means an installed package. A bin linked straight out of a source checkout resolves to
  // no package at all, so it stays foreign and is never removed, however its checkout is named.
  const real = realPathOf(binPath)
  const fromLink = isInsideNodeModules(real) ? ownerOfFile(real) : null
  if (fromLink !== null) return fromLink

  const shim = readShimText(binPath)
  const lightWrapper = shim === null ? null : codexLightWrapperOwner(shim)
  if (lightWrapper !== null) return lightWrapper
  // Ownership comes from the manifest of an installed package the shim or its Bun sidecar really
  // launches, never from the text alone: a script that merely mentions a legacy package path stays
  // foreign and is kept.
  const entries = [...(shim === null ? [] : shimEntryPaths(shim, dirname(binPath))), ...bunxEntryPaths(binPath)]
  for (const entry of entries) {
    if (!isInsideNodeModules(entry) || !pathExists(entry)) continue
    const owner = ownerOfFile(entry)
    if (owner !== null) return owner
  }
  return null
}

// A launcher names its entry file absolutely (omo-ai's bun shim) or relative to its own directory
// (`%dp0%` / `%~dp0` in npm's `.cmd`, `$basedir` in the sh and `.ps1` shims npm and pnpm write). A
// relative path without that prefix resolves against the caller's cwd, so it names nothing.
function shimEntryPaths(shim: string, shimDirectory: string): readonly string[] {
  const paths: string[] = []
  for (const match of shim.matchAll(/(?<=["'])[^"'\n]*node_modules[\\/][^"'\n]*(?=["'])/g)) {
    const quoted = match[0]
    const relativeToShim = quoted.match(/^(?:%~?dp0%?|\$\{?basedir\}?)[\\/]?(.*)$/)?.[1]
    if (relativeToShim !== undefined) paths.push(join(shimDirectory, relativeToShim.replace(/\\/g, "/")))
    else if (isAbsolute(quoted)) paths.push(quoted)
  }
  return paths
}

// Bun's Windows bin is a copied `omo.exe` plus an `omo.bunx` sidecar: UTF-16LE, the target path up to
// a `"` and a NUL. Bun writes that path relative to the bin dir's parent (`..\node_modules\...` or
// `install\global\node_modules\...` from `~/.bun`), and its shim resolves it against that same dir.
function bunxEntryPaths(binPath: string): readonly string[] {
  if (!/\.exe$/i.test(binPath)) return []
  const sidecar = `${binPath.slice(0, -4)}.bunx`
  let contents: string
  try {
    if (!statSync(sidecar).isFile()) return []
    contents = readFileSync(sidecar).toString("utf16le")
  } catch {
    return []
  }
  const end = contents.indexOf('"\0')
  if (end <= 0) return []
  return [join(dirname(dirname(binPath)), contents.slice(0, end).replace(/\\/g, "/"))]
}

function codexLightWrapperOwner(shim: string): OmoBinOwner | null {
  if (!shim.includes(CODEX_LIGHT_WRAPPER_MARKER)) return null
  const version = shim.match(CODEX_LIGHT_CACHE_VERSION)?.[1]
  return version === undefined ? null : { name: "lazycodex", version }
}

function isInsideNodeModules(path: string): boolean {
  return /(?:^|[\\/])node_modules[\\/]/.test(path)
}

function ownerOfFile(file: string): OmoBinOwner | null {
  let directory = dirname(file)
  for (let depth = 0; depth < OWNER_WALK_UP_LIMIT; depth += 1) {
    const manifest = readWholeFile(join(directory, "package.json"))
    if (manifest !== null) {
      const parsed = parseManifest(manifest)
      if (parsed !== null) return parsed
    }
    const parent = dirname(directory)
    if (parent === directory) return null
    directory = parent
  }
  return null
}

function parseManifest(manifest: string): OmoBinOwner | null {
  try {
    const parsed: unknown = JSON.parse(manifest)
    if (typeof parsed !== "object" || parsed === null) return null
    const record = parsed as { name?: unknown; version?: unknown }
    if (typeof record.name !== "string" || record.name === "") return null
    return { name: record.name, version: typeof record.version === "string" ? record.version : null }
  } catch {
    return null
  }
}

function realPathOf(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

function readShimText(path: string): string | null {
  return readWholeFile(path)?.slice(0, SHIM_READ_LIMIT) ?? null
}

function readWholeFile(path: string): string | null {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return null
  }
}
