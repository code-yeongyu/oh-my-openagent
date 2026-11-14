// script/engine-sidecar-sources.ts
// The engine half of the compiled binary's sidecar parity set: which files of the
// installed @code-yeongyu/senpi package (and of the packages it resolves) are embedded
// next to the executable, mapped from the npm layout onto the flattened binary layout.

import { createRequire } from "node:module"
import { dirname, join, relative, resolve, sep } from "node:path"
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { parseSync } from "oxc-parser"

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

interface PackageDependency {
  readonly name: string
  readonly optional: boolean
}

function readDependencyMap(manifest: object, field: string, manifestPath: string): readonly string[] {
  const dependencies = Reflect.get(manifest, field)
  if (dependencies === undefined || dependencies === null) return []
  if (typeof dependencies !== "object" || Array.isArray(dependencies)) {
    throw new Error(`package manifest ${field} are not an object: ${manifestPath}`)
  }
  return Object.keys(dependencies)
}

/** `dependencies` and `optionalDependencies`, as senpi's own codemode sidecar copier walks them. */
function readPackageDependencies(packageDir: string): readonly PackageDependency[] {
  const manifestPath = join(packageDir, "package.json")
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"))
  if (typeof manifest !== "object" || manifest === null) {
    throw new Error(`package manifest is not an object: ${manifestPath}`)
  }
  const optional = new Set(readDependencyMap(manifest, "optionalDependencies", manifestPath))
  const names = new Set([...readDependencyMap(manifest, "dependencies", manifestPath), ...optional])
  return [...names].sort().map((name) => ({ name, optional: optional.has(name) }))
}

function dependencyManifestPath(packageDir: string, dependencyName: string): string {
  const packageRequire = createRequire(join(realpathSync(packageDir), "package.json"))
  return packageRequire.resolve(`${dependencyName}/package.json`)
}

const EXTENSION_LOADER = join("dist", "core", "extensions", "loader.js")
const EXTENSION_IMPORTER = "createBunExtensionImporter"

interface AstNode {
  readonly type: string
  readonly [field: string]: unknown
}

function isAstNode(value: unknown): value is AstNode {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "type") === "string"
}

function collectNodes(node: unknown, match: (candidate: AstNode) => boolean, found: AstNode[] = []): AstNode[] {
  if (Array.isArray(node)) {
    for (const child of node) collectNodes(child, match, found)
    return found
  }
  if (!isAstNode(node)) return found
  if (match(node)) found.push(node)
  for (const [field, child] of Object.entries(node)) {
    if (field !== "type" && typeof child === "object") collectNodes(child, match, found)
  }
  return found
}

function propertyKey(property: AstNode, fail: (reason: string) => never): string {
  if (property.type !== "Property" || property["computed"] === true || property["kind"] !== "init") {
    return fail(`its table has a ${property.type === "SpreadElement" ? "spread" : "computed or non-plain"} entry`)
  }
  const key = property["key"]
  if (isAstNode(key) && key.type === "Identifier" && typeof key["name"] === "string") return key["name"]
  if (isAstNode(key) && key.type === "Literal" && typeof key["value"] === "string") return key["value"]
  return fail("its table has a key that is neither an identifier nor a string")
}

/**
 * The specifiers the installed engine's extension loader serves to extensions: the keys of the object its loader
 * passes to createBunExtensionImporter, read structurally from the installed loader module. This is the table
 * senpi's own codemode sidecar copier reads. Anything the parse cannot read exactly fails the build.
 */
export function engineServedSpecifiers(hostPackageDir = senpiPackageDir): ReadonlySet<string> {
  const loaderPath = join(hostPackageDir, EXTENSION_LOADER)
  const fail = (reason: string): never => {
    throw new Error(`cannot read the engine's extension module table from ${loaderPath}: ${reason}`)
  }
  if (!existsSync(loaderPath)) return fail("the loader module does not exist")
  const parsed = parseSync(loaderPath, readFileSync(loaderPath, "utf8"))
  if (parsed.errors.length > 0) return fail(`it does not parse (${parsed.errors[0]?.message ?? "unknown error"})`)
  const calls = collectNodes(parsed.program, (node) => {
    const callee = node["callee"]
    return (
      node.type === "CallExpression" &&
      isAstNode(callee) &&
      callee.type === "Identifier" &&
      callee["name"] === EXTENSION_IMPORTER
    )
  })
  const tableNames = new Set(
    calls.map((call) => {
      const [first] = Array.isArray(call["arguments"]) ? call["arguments"] : []
      return isAstNode(first) && first.type === "Identifier" && typeof first["name"] === "string" ? first["name"] : ""
    }),
  )
  const [tableName] = tableNames
  if (tableName === undefined) return fail(`it never calls ${EXTENSION_IMPORTER}`)
  if (tableNames.size !== 1 || tableName === "") return fail(`${EXTENSION_IMPORTER} is not passed one named table`)
  const declarations = collectNodes(parsed.program["body"], (node) => {
    const id = node["id"]
    return node.type === "VariableDeclarator" && isAstNode(id) && id.type === "Identifier" && id["name"] === tableName
  })
  const table = declarations.length === 1 ? declarations[0]?.["init"] : undefined
  if (!isAstNode(table) || table.type !== "ObjectExpression" || !Array.isArray(table["properties"])) {
    return fail(`${tableName} is not declared once as an object literal`)
  }
  const specifiers = table["properties"].map((property: unknown) =>
    isAstNode(property) ? propertyKey(property, fail) : fail("its table has an unreadable entry"),
  )
  if (specifiers.length === 0) return fail(`${tableName} is empty`)
  return new Set(specifiers)
}

function packageRoot(specifier: string): string {
  return specifier
    .split("/")
    .slice(0, specifier.startsWith("@") ? 2 : 1)
    .join("/")
}

/** The packages the engine serves whole: a served subpath alone (typebox/value) does not provide the package. */
export function engineServedPackages(hostPackageDir = senpiPackageDir): ReadonlySet<string> {
  return new Set(
    [...engineServedSpecifiers(hostPackageDir)].filter((specifier) => packageRoot(specifier) === specifier),
  )
}

function packageDependencySources(
  packageDir: string,
  targetRoot: string,
  dependencies: readonly PackageDependency[],
  served: ReadonlySet<string>,
  ancestors: ReadonlySet<string>,
): SidecarSource[] {
  const sources: SidecarSource[] = []
  for (const { name: dependencyName, optional } of dependencies) {
    if (served.has(dependencyName)) continue
    let dependencyManifest: string
    try {
      dependencyManifest = dependencyManifestPath(packageDir, dependencyName)
    } catch (error) {
      if (optional && isUnresolvable(error)) continue
      throw error
    }
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
    sources.push(
      ...packageDependencySources(
        dependencyDir,
        dependencyTarget,
        readPackageDependencies(dependencyDir),
        served,
        new Set([...ancestors, realDependencyDir]),
      ),
    )
  }
  return sources
}

/**
 * codemode's runtime dependency closure, staged beside it in the binary. A dependency is skipped only when the engine's
 * extension loader serves it (engineServedPackages); an optional dependency that is not installed is skipped too.
 */
export function codemodeRuntimeDependencySources(
  codemodeDir: string,
  hostPackageDir = senpiPackageDir,
): SidecarSource[] {
  const targetRoot = "node_modules/@code-yeongyu/senpi-codemode"
  return packageDependencySources(
    codemodeDir,
    targetRoot,
    readPackageDependencies(codemodeDir),
    engineServedPackages(hostPackageDir),
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
