import { existsSync, readFileSync, realpathSync, statSync } from "node:fs"
import { createRequire } from "node:module"
import { delimiter, dirname, isAbsolute, join, resolve, sep } from "node:path"

import type { RpcSpawnRuntime } from "./spawn"

const require = createRequire(import.meta.url)

const SENPI_BIN_ENV = "SENPI_BIN"

type SenpiLauncher = {
  readonly command: string
  readonly prefixArgs: readonly string[]
}

export type { SenpiLauncher }

/**
 * Detect whether the current process is a Bun compiled binary, mirroring
 * senpi's own detection (import.meta.url carries a $bunfs / ~BUN marker).
 */
export function detectBunBinary(metaUrl: string): boolean {
  return metaUrl.includes("$bunfs") || metaUrl.includes("~BUN") || metaUrl.includes("%7EBUN")
}

/**
 * Whether this process is a Bun single-file executable that embeds the engine. Such a process IS
 * the engine: spawning `process.execPath` yields a child with the same version and the same shipped
 * assets, which no PATH or sibling lookup can promise. `import.meta.url` cannot answer this: omo's
 * plugin is loaded from a real file inside the compiled binary, so its URL is a plain `file:` path
 * and `detectBunBinary` reports false while PATH may hold a different senpi install entirely.
 */
export function detectCompiledEngine(): boolean {
  return typeof Bun !== "undefined" && Bun.embeddedFiles.length > 0
}

function senpiBinaryName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "senpi.exe" : "senpi"
}

function scanPathForExecutable(
  name: string,
  pathValue: string | undefined,
  isAcceptable?: (canonical: string) => boolean,
): string | null {
  for (const dir of (pathValue ?? "").split(delimiter)) {
    if (dir.length === 0) continue
    const candidate = canonicalExecutable(join(dir, name))
    if (candidate === null) continue
    if (isAcceptable !== undefined && !isAcceptable(candidate)) continue
    return candidate
  }
  return null
}

function canonicalExecutable(candidate: string): string | null {
  try {
    const canonical = realpathSync.native(resolve(candidate))
    return statSync(canonical).isFile() ? canonical : null
  } catch {
    return null
  }
}

const SENPI_PACKAGE_NAME = "@code-yeongyu/senpi"
const MANIFEST_WALK_MAX_LEVELS = 3

export function readEngineVersionFromResolvePaths(paths: readonly string[]): string | undefined {
  for (const dir of paths) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "@code-yeongyu", "senpi", "package.json"), "utf8")) as {
        name?: unknown
        version?: unknown
      }
      if (pkg.name === SENPI_PACKAGE_NAME && typeof pkg.version === "string" && pkg.version.length > 0) {
        return pkg.version
      }
    } catch {
      // Missing or invalid manifest at this resolution path; keep scanning.
    }
  }
  return undefined
}

export function readRunningEngineVersion(): string | undefined {
  const fromPaths = readEngineVersionFromResolvePaths(require.resolve.paths(SENPI_PACKAGE_NAME) ?? [])
  if (fromPaths !== undefined) return fromPaths
  try {
    return readCandidateSenpiVersion(require.resolve(SENPI_PACKAGE_NAME))
  } catch {
    return undefined
  }
}

function readCandidateSenpiVersion(executable: string): string | undefined {
  let dir = dirname(executable)
  for (let depth = 0; depth <= MANIFEST_WALK_MAX_LEVELS; depth += 1) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
        name?: unknown
        version?: unknown
      }
      if (pkg.name === SENPI_PACKAGE_NAME && typeof pkg.version === "string" && pkg.version.length > 0) {
        return pkg.version
      }
    } catch {
      // Missing or invalid manifest at this level; keep walking.
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}

function passesEngineParity(candidate: string, runtime: RpcSpawnRuntime): boolean {
  const engineVersion = runtime.engineVersion
  if (engineVersion === undefined || engineVersion.length === 0) return true
  const candidateVersion = readCandidateSenpiVersion(candidate)
  if (candidateVersion === undefined) return true
  if (candidateVersion === engineVersion) return true
  runtime.onWarning?.(
    `Skipping senpi executable ${candidate} version ${candidateVersion}; running engine is ${engineVersion}`,
  )
  return false
}

/**
 * Resolve the senpi EXECUTABLE to spawn the rpc child with (`<exe> --mode rpc`). Spawning the binary
 * directly bypasses module resolution, which senpi's own loader alias HIJACKS when omo runs as a senpi
 * extension: `require.resolve("@code-yeongyu/senpi/rpc-entry")` then resolves to the running dist entry
 * instead of the child rpc entry and the child never boots. Preference order: an explicit `SENPI_BIN`
 * override (used even when its package version differs), the running executable when it embeds the
 * engine (`isCompiledEngine`), the sibling binary next to a Bun-compiled senpi, then a PATH scan. Sibling and PATH candidates whose @code-yeongyu/senpi manifest version differs from
 * the running engine are skipped; a candidate with no readable manifest is kept. Returns null when no
 * executable is found so buildRpcSpawn can fall back to the documented `execPath + rpc-entry` path.
 */
export function resolveSenpiExecutable(runtime: RpcSpawnRuntime): string | null {
  const binaryName = senpiBinaryName(runtime.platform)
  const override = runtime.parentEnv[SENPI_BIN_ENV]?.trim()
  if (override !== undefined && override.length > 0) {
    if (override.includes("/") || override.includes(sep) || isAbsolute(override)) {
      return canonicalExecutable(override)
    }
    return scanPathForExecutable(override, runtime.parentEnv.PATH)
  }
  if (runtime.isCompiledEngine === true) return canonicalExecutable(runtime.execPath)
  const acceptParity = (candidate: string) => passesEngineParity(candidate, runtime)
  if (runtime.isBunBinary) {
    const sibling = canonicalExecutable(join(dirname(runtime.execPath), binaryName))
    return sibling !== null && acceptParity(sibling) ? sibling : null
  }
  return scanPathForExecutable(binaryName, runtime.parentEnv.PATH, acceptParity)
}

function normalizeSenpiLauncher(executable: string, runtime: RpcSpawnRuntime): SenpiLauncher | null {
  if (runtime.platform !== "win32" || executable.toLowerCase().endsWith(".exe")) {
    return { command: executable, prefixArgs: [] }
  }
  const shimDir = dirname(executable)
  const cliCandidates = [
    join(shimDir, "node_modules", "@code-yeongyu", "senpi", "dist", "cli.js"),
    join(shimDir, "..", "@code-yeongyu", "senpi", "dist", "cli.js"),
  ]
  const cliPath = cliCandidates.find((candidate) => existsSync(candidate))
  return cliPath === undefined ? null : { command: runtime.execPath, prefixArgs: [cliPath] }
}

/**
 * Whether the resolved executable IS this running process. `normalizeSenpiLauncher` reads a Windows
 * candidate without an `.exe` suffix as an npm shim, which is the right guess for a PATH or sibling
 * hit but wrong for the compiled engine: a single-file executable may be named anything (`omo`,
 * `omo-dev`) and still be the engine. Re-interpreting it looked for an adjacent `dist/cli.js`, found
 * none, discarded the one candidate guaranteed to match the running version and its embedded assets,
 * and fell through to the PATH shim scans and finally the `argv[1]` entry-script guess.
 */
function isRunningCompiledEngine(executable: string, runtime: RpcSpawnRuntime): boolean {
  if (runtime.isCompiledEngine !== true) return false
  return canonicalExecutable(runtime.execPath) === executable
}

export function resolveSenpiLauncher(runtime: RpcSpawnRuntime): SenpiLauncher | null {
  const executable = (runtime.resolveSenpiExecutable ?? resolveSenpiExecutable)(runtime)
  if (executable !== null) {
    if (isRunningCompiledEngine(executable, runtime)) return { command: executable, prefixArgs: [] }
    const normalized = normalizeSenpiLauncher(executable, runtime)
    if (normalized !== null) return normalized
  }
  if (runtime.platform !== "win32") return null
  for (const name of ["senpi.cmd", "senpi"]) {
    const npmShim = scanPathForExecutable(name, runtime.parentEnv.PATH)
    if (npmShim === null) continue
    const normalized = normalizeSenpiLauncher(npmShim, runtime)
    if (normalized !== null) return normalized
  }
  return null
}
