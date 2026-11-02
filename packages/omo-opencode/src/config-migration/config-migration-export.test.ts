import { describe, expect, test } from "bun:test"
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve, sep } from "node:path"

const PACKAGE_PATH = join(import.meta.dir, "..", "..", "package.json")
const ENTRY_POINT = join(import.meta.dir, "index.ts")
// omo#8247: the Senpi adapter reuses the release-download primitives through this second public subpath.
const BINARY_DOWNLOADER_ENTRY_POINT = join(import.meta.dir, "..", "shared", "binary-downloader.ts")
// omo#10630: the Senpi memory sync resolver reads the CLI sign-in through this third public subpath.
const SERVICE_AUTH_ENTRY_POINT = join(import.meta.dir, "..", "cli", "service-auth", "index.ts")
const PACKAGES_PATH = join(import.meta.dir, "..", "..", "..", "..", "packages")
const CONFIG_CORE_ENTRY_POINT = join(PACKAGES_PATH, "omo-config-core", "src", "index.ts")
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

type WorkspacePackage = { directory: string; exports: unknown }

function workspacePackages(packagesPath = PACKAGES_PATH): ReadonlyMap<string, WorkspacePackage> {
  const packages = new Map<string, WorkspacePackage>()
  for (const entry of readdirSync(packagesPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const packagePath = join(packagesPath, entry.name)
    const manifestPath = join(packagePath, "package.json")
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as Record<string, unknown>
    const name = workspacePackageName(manifest)
    if (name !== undefined) packages.set(name, { directory: packagePath, exports: manifest.exports })
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

function resolveWorkspaceImport(sourcePath: string, specifier: string, packages = WORKSPACE_PACKAGES): string | undefined {
  for (const [packageName, workspace] of packages) {
    const prefix = `${packageName}/`
    if (specifier !== packageName && !specifier.startsWith(prefix)) continue
    const subpath = specifier === packageName ? "." : `./${specifier.slice(prefix.length)}`
    if (workspace.exports === undefined) {
      return resolveModule(join(workspace.directory, "src", subpath), specifier, sourcePath)
    }
    let entry: unknown = typeof workspace.exports === "object" && workspace.exports !== null
      ? Reflect.get(workspace.exports, subpath)
      : subpath === "." ? workspace.exports : undefined
    let capture: string | undefined
    if (entry === undefined && typeof workspace.exports === "object" && workspace.exports !== null) {
      const patterns = Object.keys(workspace.exports).filter((key) => key.includes("*"))
        .sort((a, b) => b.indexOf("*") - a.indexOf("*") || b.length - a.length)
      for (const pattern of patterns) {
        const [prefix = "", suffix = ""] = pattern.split("*")
        if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix) || subpath.length < prefix.length + suffix.length) continue
        capture = subpath.slice(prefix.length, subpath.length - suffix.length)
        entry = Reflect.get(workspace.exports, pattern)
        break
      }
    }
    const target: unknown = typeof entry === "object" && entry !== null
      ? Reflect.get(entry, "import") ?? Reflect.get(entry, "default")
      : entry
    if (typeof target !== "string") throw new Error(`Cannot resolve exported ${specifier} from ${sourcePath}`)
    return resolveModule(resolve(workspace.directory, capture === undefined ? target : target.replaceAll("*", capture)), specifier, sourcePath)
  }
  return undefined
}

function moduleGraph(entryPoint: string, packages = WORKSPACE_PACKAGES): readonly string[] {
  const pending = [entryPoint]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined || visited.has(current)) continue
    visited.add(current)
    for (const specifier of importSpecifiers(readFileSync(current, "utf-8"))) {
      if (specifier.startsWith(".")) pending.push(resolveRelativeImport(current, specifier))
      else {
        const workspaceImport = resolveWorkspaceImport(current, specifier, packages)
        if (workspaceImport !== undefined) pending.push(workspaceImport)
      }
    }
  }
  return [...visited]
}

describe("config-migration public subpath", () => {
  test("an exports alias resolves to its real file and remains in the audited graph", () => {
    const entryPoint = join(PACKAGES_PATH, "team-core", "src", "team-state-store", "lock-record.ts")
    const aliasTarget = join(PACKAGES_PATH, "memory-core", "src", "locks", "process-identity.ts")

    expect(resolveWorkspaceImport(entryPoint, "@oh-my-opencode/memory-core/process-identity")).toBe(aliasTarget)
    expect(moduleGraph(entryPoint)).toEqual(expect.arrayContaining([
      aliasTarget,
      join(PACKAGES_PATH, "memory-core", "src", "locks", "process-start-time.ts"),
    ]))
  })

  test("an exports alias targeting a forbidden graph still fails the audit", () => {
    const root = mkdtempSync(join(tmpdir(), "config-migration-exports-"))
    try {
      const packagePath = join(root, "fixture")
      mkdirSync(join(packagePath, "src"), { recursive: true })
      writeFileSync(join(packagePath, "package.json"), JSON.stringify({
        name: "@audit/fixture",
        exports: {
          "./*": { import: "./src/*.ts" },
          "./alias": {
            import: relative(packagePath, NEGATIVE_FIXTURE_ENTRY_POINT),
            default: "./src/alias.ts",
          },
        },
      }))
      writeFileSync(join(packagePath, "src", "alias.ts"), "export {}\n")
      const entryPoint = join(root, "entry.ts")
      writeFileSync(entryPoint, 'import "@audit/fixture/alias"\n')

      const modules = moduleGraph(entryPoint, workspacePackages(root))
      const offenders = modules.flatMap((modulePath) =>
        importSpecifiers(readFileSync(modulePath, "utf-8"))
          .filter((specifier) => OPENCODE_IMPORT.test(specifier))
          .map((specifier) => `${modulePath} imports ${specifier}`))

      expect(modules).toContain(NEGATIVE_FIXTURE_ENTRY_POINT)
      expect(offenders).toEqual([`${NEGATIVE_FIXTURE_ENTRY_POINT} imports @opencode-ai/sdk`])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

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
      "./binary-downloader": {
        import: "./src/shared/binary-downloader.ts",
        types: "./src/shared/binary-downloader.ts",
      },
      "./service-auth": {
        import: "./src/cli/service-auth/index.ts",
        types: "./src/cli/service-auth/index.ts",
      },
    })
  })

  test.each([
    ["binary-downloader", BINARY_DOWNLOADER_ENTRY_POINT],
    ["service-auth", SERVICE_AUTH_ENTRY_POINT],
  ])("#given the %s entry point #when its local module graph is audited #then it imports neither OpenCode SDK modules nor plugin runtime code", (_name, entryPoint) => {
    // given
    const modules = moduleGraph(entryPoint)
    const offenders: string[] = []

    // when
    for (const modulePath of modules) {
      for (const specifier of importSpecifiers(readFileSync(modulePath, "utf-8"))) {
        if (OPENCODE_IMPORT.test(specifier)) offenders.push(`${modulePath} imports ${specifier}`)
      }
      if (modulePath.includes(PLUGIN_RUNTIME_DIRECTORY) || modulePath.includes(PLUGIN_CONFIG_DIRECTORY)) {
        offenders.push(`${modulePath} is plugin runtime code`)
      }
    }

    // then
    expect(modules.length).toBeGreaterThan(1)
    expect(offenders).toEqual([])
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
    expect(modules).toEqual(expect.arrayContaining([CONFIG_CORE_ENTRY_POINT]))
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
