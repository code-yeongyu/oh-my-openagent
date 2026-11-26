import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, sep } from "node:path"

// Resolves an import specifier the way the workspace does (relative paths, `#` aliases from the nearest package.json
// `imports`, workspace package names through their `exports`) to a repo-relative posix path. Anything else (npm packages,
// node builtins) answers undefined: the guard only reasons about files in this repository.
export type Resolver = (fromFile: string, specifier: string) => string | undefined

/** The file reads the resolver makes, by absolute path: the disk by default, a git tree for a revision's resolution. */
export type ResolverFiles = {
  readonly isFile: (path: string) => boolean
  readonly readText: (path: string) => string
  readonly directories: (path: string) => readonly string[]
}

const DISK: ResolverFiles = {
  isFile: (path) => existsSync(path) && statSync(path).isFile(),
  readText: (path) => readFileSync(path, "utf8"),
  directories: (path) =>
    readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
}

type PackageManifest = {
  readonly dir: string
  readonly name: string | undefined
  readonly exports: unknown
  readonly imports: unknown
}

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", ".d.ts"]
const JS_TO_TS: Readonly<Record<string, readonly string[]>> = {
  ".js": [".ts", ".tsx"],
  ".mjs": [".mts"],
  ".cjs": [".cts"],
}
const CONDITIONS = ["bun", "import", "default", "require", "types"]

const toPosix = (path: string): string => path.split(sep).join("/")

function probe(files: ResolverFiles, base: string): string | undefined {
  const isFile = files.isFile
  if (isFile(base)) return base
  for (const extension of SOURCE_EXTENSIONS) if (isFile(base + extension)) return base + extension
  for (const [js, tsExtensions] of Object.entries(JS_TO_TS)) {
    if (!base.endsWith(js)) continue
    for (const extension of tsExtensions) {
      const swapped = base.slice(0, -js.length) + extension
      if (isFile(swapped)) return swapped
    }
  }
  for (const extension of SOURCE_EXTENSIONS)
    if (isFile(join(base, `index${extension}`))) return join(base, `index${extension}`)
  return undefined
}

function conditionTarget(value: unknown): string | undefined {
  if (typeof value === "string") return value
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  for (const condition of CONDITIONS) {
    const target = conditionTarget(record[condition])
    if (target !== undefined) return target
  }
  return undefined
}

function mapTarget(map: unknown, key: string): string | undefined {
  if (map === null || typeof map !== "object" || Array.isArray(map))
    return key === "." ? conditionTarget(map) : undefined
  const record = map as Record<string, unknown>
  const subpathKeys = Object.keys(record).filter((entry) => entry.startsWith(".") || entry.startsWith("#"))
  if (subpathKeys.length === 0) return key === "." ? conditionTarget(record) : undefined
  if (key in record) return conditionTarget(record[key])
  for (const pattern of subpathKeys) {
    const star = pattern.indexOf("*")
    if (star < 0) continue
    const prefix = pattern.slice(0, star)
    const suffix = pattern.slice(star + 1)
    if (!key.startsWith(prefix) || !key.endsWith(suffix) || key.length < prefix.length + suffix.length) continue
    const target = conditionTarget(record[pattern])
    if (target !== undefined) return target.replaceAll("*", key.slice(prefix.length, key.length - suffix.length))
  }
  return undefined
}

function readManifest(files: ResolverFiles, dir: string): PackageManifest | undefined {
  const path = join(dir, "package.json")
  if (!files.isFile(path)) return undefined
  const json = JSON.parse(files.readText(path)) as Record<string, unknown>
  return {
    dir,
    name: typeof json.name === "string" ? json.name : undefined,
    exports: json.exports,
    imports: json.imports,
  }
}

export function createResolver(repoRoot: string, files: ResolverFiles = DISK): Resolver {
  const packagesRoot = join(repoRoot, "packages")
  const workspace = new Map<string, PackageManifest>()
  for (const name of files.directories(packagesRoot)) {
    const manifest = readManifest(files, join(packagesRoot, name))
    if (manifest?.name !== undefined) workspace.set(manifest.name, manifest)
  }
  const nearest = new Map<string, PackageManifest | undefined>()
  const nearestManifest = (dir: string): PackageManifest | undefined => {
    if (nearest.has(dir)) return nearest.get(dir)
    const own = readManifest(files, dir)
    const parent = dirname(dir)
    const found = own ?? (dir === repoRoot || parent === dir ? undefined : nearestManifest(parent))
    nearest.set(dir, found)
    return found
  }
  const inRepo = (absolute: string | undefined): string | undefined =>
    absolute === undefined ? undefined : toPosix(relative(repoRoot, absolute))

  return (fromFile, specifier) => {
    const fromDir = dirname(join(repoRoot, fromFile))
    if (specifier.startsWith("./") || specifier.startsWith("../") || specifier === "." || specifier === "..") {
      return inRepo(probe(files, join(fromDir, specifier)))
    }
    if (specifier.startsWith("#")) {
      const manifest = nearestManifest(fromDir)
      const target = manifest === undefined ? undefined : mapTarget(manifest.imports, specifier)
      return manifest === undefined || target === undefined
        ? undefined
        : inRepo(probe(files, join(manifest.dir, target)))
    }
    const parts = specifier.split("/")
    const nameLength = specifier.startsWith("@") ? 2 : 1
    const manifest = workspace.get(parts.slice(0, nameLength).join("/"))
    if (manifest === undefined) return undefined
    const subpath = parts.length > nameLength ? `./${parts.slice(nameLength).join("/")}` : "."
    const target = mapTarget(manifest.exports, subpath)
    return inRepo(probe(files, join(manifest.dir, target ?? subpath)))
  }
}
