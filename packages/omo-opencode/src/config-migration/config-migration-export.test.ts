import { describe, expect, test } from "bun:test"
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs"
import { dirname, join, resolve, sep } from "node:path"

const PACKAGE_PATH = join(import.meta.dir, "..", "..", "package.json")
const ENTRY_POINT = join(import.meta.dir, "index.ts")
const PACKAGES_PATH = join(import.meta.dir, "..", "..", "..", "..", "packages")
const CONFIG_CORE_ENTRY_POINT = join(PACKAGES_PATH, "omo-config-core", "src", "index.ts")
const UTILS_MIGRATION_MODULES = [
  join(PACKAGES_PATH, "utils", "src", "migration", "agent-names.ts"),
  join(PACKAGES_PATH, "utils", "src", "migration", "hook-names.ts"),
  join(PACKAGES_PATH, "utils", "src", "migration", "model-versions.ts"),
]
const NEGATIVE_FIXTURE_ENTRY_POINT = join(import.meta.dir, "..", "..", "test", "fixtures", "config-migration", "opencode-side-effect-import.ts")
const OPENCODE_IMPORT = /^@opencode-ai\//
const PLUGIN_RUNTIME_DIRECTORY = `${sep}plugin${sep}`
const PLUGIN_CONFIG_DIRECTORY = `${sep}plugin-config${sep}`

function importSpecifiers(source: string): readonly string[] {
  const specifiers: string[] = []
  const expression = /\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|(?:^|[;\n])\s*import\s*["']([^"']+)["']/gm
  for (const match of source.matchAll(expression)) {
    const specifier = match[1] ?? match[2] ?? match[3]
    if (specifier !== undefined) specifiers.push(specifier)
  }
  return specifiers
}

function workspacePackageName(manifest: unknown): string | undefined {
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) return undefined
  const name = Reflect.get(manifest, "name")
  return typeof name === "string" ? name : undefined
}

function workspacePackages(): ReadonlyMap<string, string> {
  const packages = new Map<string, string>()
  for (const entry of readdirSync(PACKAGES_PATH, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const packagePath = join(PACKAGES_PATH, entry.name)
    const manifestPath = join(packagePath, "package.json")
    if (!existsSync(manifestPath)) continue
    const name = workspacePackageName(JSON.parse(readFileSync(manifestPath, "utf-8")))
    if (name !== undefined) packages.set(name, join(packagePath, "src"))
  }
  return packages
}

const WORKSPACE_PACKAGES = workspacePackages()

function resolveModule(base: string, specifier: string, sourcePath: string): string {
  const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]
  const resolved = candidates.find((candidate) => existsSync(candidate) && lstatSync(candidate).isFile())
  if (resolved === undefined) throw new Error(`Cannot resolve ${specifier} from ${sourcePath}`)
  return resolved
}

function resolveRelativeImport(sourcePath: string, specifier: string): string {
  return resolveModule(resolve(dirname(sourcePath), specifier), specifier, sourcePath)
}

function resolveWorkspaceImport(sourcePath: string, specifier: string): string | undefined {
  for (const [packageName, packageSourcePath] of WORKSPACE_PACKAGES) {
    if (specifier === packageName) return resolveModule(packageSourcePath, specifier, sourcePath)
    const prefix = `${packageName}/`
    if (specifier.startsWith(prefix)) return resolveModule(join(packageSourcePath, specifier.slice(prefix.length)), specifier, sourcePath)
  }
  return undefined
}

function moduleGraph(entryPoint: string): readonly string[] {
  const pending = [entryPoint]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined || visited.has(current)) continue
    visited.add(current)
    for (const specifier of importSpecifiers(readFileSync(current, "utf-8"))) {
      if (specifier.startsWith(".")) pending.push(resolveRelativeImport(current, specifier))
      else {
        const workspaceImport = resolveWorkspaceImport(current, specifier)
        if (workspaceImport !== undefined) pending.push(workspaceImport)
      }
    }
  }
  return [...visited]
}

describe("config-migration public subpath", () => {
  test("#given the package manifest #when resolving config-migration #then its dedicated public subpath points only at the dependency-clean module", () => {
    // given
    const packageJson = JSON.parse(readFileSync(PACKAGE_PATH, "utf-8")) as Record<string, unknown>

    // when
    const exports = packageJson.exports

    // then
    expect(exports).toEqual({
      "./config-migration": {
        import: "./src/config-migration/index.ts",
        types: "./src/config-migration/index.ts",
      },
    })
  })

  test("#given the config-migration entry point #when its local module graph is audited #then it imports neither OpenCode SDK modules nor plugin runtime code", () => {
    // given
    const modules = moduleGraph(ENTRY_POINT)
    const offenders: string[] = []

    // when
    for (const modulePath of modules) {
      const source = readFileSync(modulePath, "utf-8")
      for (const specifier of importSpecifiers(source)) {
        if (OPENCODE_IMPORT.test(specifier)) offenders.push(`${modulePath} imports ${specifier}`)
      }
      if (modulePath.includes(PLUGIN_RUNTIME_DIRECTORY) || modulePath.includes(PLUGIN_CONFIG_DIRECTORY)) {
        offenders.push(`${modulePath} is plugin runtime code`)
      }
    }

    // then
    expect(modules).toEqual(expect.arrayContaining([
      CONFIG_CORE_ENTRY_POINT,
      ...UTILS_MIGRATION_MODULES,
    ]))
    expect(offenders).toEqual([])
  })

  test("#given a fixture with a side-effect OpenCode SDK import #when auditing its module graph #then reports the forbidden import", () => {
    // given
    const modules = moduleGraph(NEGATIVE_FIXTURE_ENTRY_POINT)
    const offenders: string[] = []

    // when
    for (const modulePath of modules) {
      for (const specifier of importSpecifiers(readFileSync(modulePath, "utf-8"))) {
        if (OPENCODE_IMPORT.test(specifier)) offenders.push(`${modulePath} imports ${specifier}`)
      }
    }

    // then
    expect(offenders).toEqual([
      `${NEGATIVE_FIXTURE_ENTRY_POINT} imports @opencode-ai/sdk`,
    ])
  })
})
