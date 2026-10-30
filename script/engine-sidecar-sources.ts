// script/engine-sidecar-sources.ts
// The engine half of the compiled binary's sidecar parity set: which files of the
// installed @code-yeongyu/senpi package (and of the packages it resolves) are embedded
// next to the executable, mapped from the npm layout onto the flattened binary layout.

import { createRequire } from "node:module"
import { dirname, join, relative, resolve, sep } from "node:path"
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs"
import { fileURLToPath } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "..")
export const senpiPackageDir = join(repoRoot, "node_modules", "@code-yeongyu", "senpi")
// Resolve from senpi's REAL path: bun's isolated store links senpi's dependencies beside that
// path (`.bun/<key>/node_modules`), not beside the `node_modules/@code-yeongyu/senpi` symlink,
// so a require rooted at the symlink finds nothing once senpi stops bundling its dependencies.
const senpiRequire = createRequire(
  join(existsSync(senpiPackageDir) ? realpathSync(senpiPackageDir) : senpiPackageDir, "package.json"),
)

export interface SidecarSource {
  /** Absolute source path (file or directory). */
  readonly from: string
  /** Payload-relative destination path. */
  readonly to: string
  /** When true a missing source aborts the build. */
  readonly required: boolean
}

/**
 * Node's two "this package is not resolvable from here" outcomes. Anything else the
 * resolver throws (a malformed package.json, a permission error) is a real failure and
 * must surface instead of being read as "not installed".
 */
function isUnresolvable(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const code: unknown = Reflect.get(error, "code")
  return code === "MODULE_NOT_FOUND" || code === "ERR_PACKAGE_PATH_NOT_EXPORTED"
}

function resolveFromSenpi(specifier: string): string | undefined {
  try {
    return senpiRequire.resolve(specifier)
  } catch (error) {
    if (isUnresolvable(error)) return undefined
    throw error
  }
}

export function resolvePackageDir(packageName: string): string | undefined {
  const packageJsonPath = resolveFromSenpi(`${packageName}/package.json`)
  return packageJsonPath === undefined ? undefined : dirname(packageJsonPath)
}

function readPackageDependencies(packageDir: string): readonly string[] {
  const manifest: unknown = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"))
  if (typeof manifest !== "object" || manifest === null) {
    throw new Error(`package manifest is not an object: ${join(packageDir, "package.json")}`)
  }
  const dependencies = Reflect.get(manifest, "dependencies")
  if (dependencies === undefined) return []
  if (typeof dependencies !== "object" || dependencies === null || Array.isArray(dependencies)) {
    throw new Error(`package manifest dependencies are not an object: ${join(packageDir, "package.json")}`)
  }
  return Object.keys(dependencies).sort()
}

interface PackageIdentity {
  readonly name: string
  readonly version: string
}

function dependencyManifestPath(packageDir: string, dependencyName: string): string {
  const packageRequire = createRequire(join(realpathSync(packageDir), "package.json"))
  return packageRequire.resolve(`${dependencyName}/package.json`)
}

function readPackageIdentity(manifestPath: string): PackageIdentity {
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"))
  if (typeof manifest !== "object" || manifest === null) {
    throw new Error(`package manifest is not an object: ${manifestPath}`)
  }
  const name = Reflect.get(manifest, "name")
  const version = Reflect.get(manifest, "version")
  if (typeof name !== "string" || typeof version !== "string") {
    throw new Error(`package manifest has no string name and version: ${manifestPath}`)
  }
  return { name, version }
}

function resolveDependencyIdentity(
  packageDir: string,
  dependencyName: string,
): PackageIdentity | undefined {
  try {
    return readPackageIdentity(dependencyManifestPath(packageDir, dependencyName))
  } catch (error) {
    if (isUnresolvable(error)) return undefined
    throw error
  }
}

function packageDependencySources(
  packageDir: string,
  targetRoot: string,
  dependencyNames: readonly string[],
  ancestors: ReadonlySet<string>,
): SidecarSource[] {
  const sources: SidecarSource[] = []
  for (const dependencyName of dependencyNames) {
    const dependencyManifest = dependencyManifestPath(packageDir, dependencyName)
    const dependencyDir = dirname(dependencyManifest)
    const realDependencyDir = realpathSync(dependencyDir)
    if (ancestors.has(realDependencyDir)) continue
    const dependencyTarget = `${targetRoot}/node_modules/${dependencyName}`
    sources.push({ from: dependencyDir, to: dependencyTarget, required: true })
    for (const entry of readdirSync(dependencyDir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".wasm")) continue
      const from = join(entry.parentPath, entry.name)
      const assetPath = relative(dependencyDir, from).split(sep).join("/")
      sources.push({ from, to: `${dependencyTarget}/${assetPath}`, required: true })
    }
    sources.push(...packageDependencySources(
      dependencyDir,
      dependencyTarget,
      readPackageDependencies(dependencyDir),
      new Set([...ancestors, realDependencyDir]),
    ))
  }
  return sources
}

export function codemodeRuntimeDependencySources(
  codemodeDir: string,
  hostPackageDir = senpiPackageDir,
): SidecarSource[] {
  const hostDependencies = new Set(readPackageDependencies(hostPackageDir))
  const externalDependencies = readPackageDependencies(codemodeDir)
    .filter((dependencyName) => {
      if (!hostDependencies.has(dependencyName)) return true
      const codemodeIdentity = resolveDependencyIdentity(codemodeDir, dependencyName)
      if (codemodeIdentity === undefined) {
        throw new Error(`codemode dependency is not installed: ${dependencyName}`)
      }
      const hostIdentity = resolveDependencyIdentity(hostPackageDir, dependencyName)
      if (hostIdentity === undefined) return true
      return codemodeIdentity.name !== hostIdentity.name || codemodeIdentity.version !== hostIdentity.version
    })
  const targetRoot = "node_modules/@code-yeongyu/senpi-codemode"
  return packageDependencySources(
    codemodeDir,
    targetRoot,
    externalDependencies,
    new Set([realpathSync(codemodeDir)]),
  )
}

/**
 * The jsdom-era engine (senpi <= 2026.9.13) pulls css-tree in through jsdom; a
 * linkedom-era engine (senpi#1666) ships none of the trio. The sidecar set follows
 * the installed engine: whichever of these it carries is embedded, none is required.
 */
export const ENGINE_OPTIONAL_SIDECAR_PACKAGES = ["css-tree", "mdn-data", "source-map-js"] as const

/**
 * Sidecar parity set = senpi's own copy-binary-assets manifest (re-read from
 * node_modules/@code-yeongyu/senpi/package.json scripts.copy-binary-assets)
 * mapped from the published npm layout onto the flattened binary layout the
 * engine resolves next to process.execPath.
 */
export function engineSidecarSources(): SidecarSource[] {
  const dist = join(senpiPackageDir, "dist")
  const sources: SidecarSource[] = [
    { from: join(senpiPackageDir, "README.md"), to: "README.md", required: true },
    { from: join(senpiPackageDir, "CHANGELOG.md"), to: "CHANGELOG.md", required: true },
    { from: join(dist, "modes", "interactive", "theme"), to: "theme", required: true },
    { from: join(dist, "modes", "interactive", "assets"), to: "assets", required: true },
    { from: join(dist, "core", "export-html"), to: "export-html", required: true },
    { from: join(senpiPackageDir, "docs"), to: "docs", required: true },
    { from: join(senpiPackageDir, "examples"), to: "examples", required: true },
    { from: join(senpiPackageDir, "vendor"), to: "vendor", required: true },
  ]
  for (const packageName of ENGINE_OPTIONAL_SIDECAR_PACKAGES) {
    const packageDir = resolvePackageDir(packageName)
    if (packageDir === undefined) continue
    sources.push({ from: packageDir, to: `node_modules/${packageName}`, required: true })
  }
  const codemodeDir = resolvePackageDir("@code-yeongyu/senpi-codemode")
  if (codemodeDir === undefined) {
    throw new Error("codemode sidecar @code-yeongyu/senpi-codemode is not installed")
  }
  sources.push({
    from: codemodeDir,
    to: "node_modules/@code-yeongyu/senpi-codemode",
    required: true,
  })
  sources.push(...codemodeRuntimeDependencySources(codemodeDir))
  const photonDir = resolvePackageDir("@silvia-odwyer/photon-node")
  if (photonDir === undefined) {
    throw new Error("@silvia-odwyer/photon-node is not installed under the senpi package")
  }
  sources.push({
    from: join(photonDir, "photon_rs_bg.wasm"),
    to: "photon_rs_bg.wasm",
    required: true,
  })
  const tuiDir = resolvePackageDir("@earendil-works/pi-tui")
  if (tuiDir !== undefined) {
    for (const platform of ["darwin", "win32"]) {
      const prebuilds = join(tuiDir, "native", platform, "prebuilds")
      if (existsSync(prebuilds)) {
        sources.push({ from: prebuilds, to: `native/${platform}/prebuilds`, required: false })
      }
    }
  }
  return sources
}
