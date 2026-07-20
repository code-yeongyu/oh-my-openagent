// allow: SIZE_OK - single-purpose package registration audit keeps workspace graph fixtures and invariant checks together.
import { existsSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import { join, relative } from "node:path"
import { describe, expect, test } from "bun:test"

const corePackagePaths: readonly string[] = [
  "packages/utils",
  "packages/model-core",
  "packages/omo-config-core",
  "packages/delegate-core",
  "packages/prompts-core",
  "packages/rules-engine",
  "packages/agents-md-core",
  "packages/lsp-core",
  "packages/mcp-stdio-core",
  "packages/mcp-client-core",
  "packages/comment-checker-core",
  "packages/hashline-core",
  "packages/tmux-core",
  "packages/team-core",
  "packages/openclaw-core",
  "packages/boulder-state",
  "packages/telemetry-core",
  "packages/claude-code-compat-core",
  "packages/skills-loader-core",
] as const

const mcpPackagePaths: readonly string[] = [
  "packages/git-bash-mcp",
  "packages/lsp-daemon",
  "packages/lsp-tools-mcp",
] as const
const adapterPackagePaths: readonly string[] = [
  "packages/omo-codex",
  "packages/omo-senpi",
  "packages/senpi-task",
  "packages/omo-opencode",
  "packages/pi-goal",
  "packages/pi-webfetch",
] as const
const skillPackagePaths: readonly string[] = ["packages/shared-skills"] as const
const shimSourceRoots: readonly string[] = ["packages/omo-opencode/src", "packages/omo-codex/src"] as const
const reExportShimFirstLinePattern = /^export (\*|\{).*from ["'](@oh-my-opencode\/[^/"']+)/

const layerRanks = {
  skill: 1,
  core: 2,
  mcp: 3,
  adapter: 4,
} as const

type PackageManifest = {
  readonly name: string
  readonly scripts: Record<string, string>
  readonly dependencies: Record<string, string>
  readonly devDependencies: Record<string, string>
  readonly peerDependencies: Record<string, string>
}

type RootManifest = PackageManifest & {
  readonly workspaces: readonly string[]
}

type ReExportShim = {
  readonly path: string
  readonly targetPackage: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readStringField(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== "string") throw new Error(`Expected ${key} to be a string`)
  return value
}

function readStringArrayField(record: Record<string, unknown>, key: string): readonly string[] {
  const value = record[key]
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new Error(`Expected ${key} to be a string array`)
  }
  return value
}

function readStringRecordField(record: Record<string, unknown>, key: string): Record<string, string> {
  const value = record[key]
  if (value === undefined) return {}
  if (!isRecord(value)) throw new Error(`Expected ${key} to be a string record`)

  const result: Record<string, string> = {}
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (typeof entryValue !== "string") throw new Error(`Expected ${key}.${entryKey} to be a string`)
    result[entryKey] = entryValue
  }
  return result
}

async function readManifest(packageJsonPath: string): Promise<PackageManifest> {
  const parsed: unknown = JSON.parse(await readFile(packageJsonPath, "utf8"))
  if (!isRecord(parsed)) throw new Error(`${packageJsonPath} is not a JSON object`)
  return {
    name: readStringField(parsed, "name"),
    scripts: readStringRecordField(parsed, "scripts"),
    dependencies: readStringRecordField(parsed, "dependencies"),
    devDependencies: readStringRecordField(parsed, "devDependencies"),
    peerDependencies: readStringRecordField(parsed, "peerDependencies"),
  }
}

async function readRootManifest(): Promise<RootManifest> {
  const parsed: unknown = JSON.parse(await readFile("package.json", "utf8"))
  if (!isRecord(parsed)) throw new Error("package.json is not a JSON object")
  return {
    name: readStringField(parsed, "name"),
    workspaces: readStringArrayField(parsed, "workspaces"),
    scripts: readStringRecordField(parsed, "scripts"),
    dependencies: readStringRecordField(parsed, "dependencies"),
    devDependencies: readStringRecordField(parsed, "devDependencies"),
    peerDependencies: readStringRecordField(parsed, "peerDependencies"),
  }
}

async function collectFiles(root: string, predicate: (path: string) => boolean): Promise<readonly string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "dist" || entry.name === "node_modules") continue
      files.push(...(await collectFiles(path, predicate)))
    } else if (entry.isFile() && predicate(path)) {
      files.push(path.replace(/\\/g, "/"))
    }
  }

  return files
}

async function collectTrackedFiles(roots: readonly string[], predicate: (path: string) => boolean): Promise<readonly string[]> {
  return (await Promise.all(roots.map((root) => collectFiles(root, predicate)))).flat().toSorted()
}

async function discoverPackagePaths(): Promise<readonly string[]> {
  const packageNames = await readdir("packages")
  return packageNames
    .map((name) => `packages/${name}`)
    .filter((path) => existsSync(join(path, "package.json")))
    .toSorted()
}

async function collectReExportShims(): Promise<readonly ReExportShim[]> {
  const files = await collectTrackedFiles(shimSourceRoots, (path) => path.endsWith(".ts"))

  const shims: ReExportShim[] = []
  for (const path of files) {
    const source = await readFile(path, "utf8")
    const firstLine = source.split(/\r?\n/, 1)[0] ?? ""
    const targetPackage = reExportShimFirstLinePattern.exec(firstLine)?.[2]
    if (targetPackage === undefined) continue
    shims.push({ path, targetPackage })
  }

  return shims
}

function isManagedWorkspacePackage(path: string): boolean {
  return (
    corePackagePaths.includes(path) ||
    mcpPackagePaths.includes(path) ||
    adapterPackagePaths.includes(path) ||
    skillPackagePaths.includes(path)
  )
}

function unclassifiedRootPackageWorkspaces(workspaces: readonly string[]): readonly string[] {
  return workspaces.filter((path) => path.startsWith("packages/") && !isManagedWorkspacePackage(path)).toSorted()
}

function isNestedCodexPluginPackage(path: string): boolean {
  return path.startsWith("packages/omo-codex/plugin/")
}

function isRootManagedTypecheckPackage(path: string): boolean {
  return !isNestedCodexPluginPackage(path)
}

function packageLayer(path: string): keyof typeof layerRanks | undefined {
  if (corePackagePaths.includes(path)) return "core"
  if (mcpPackagePaths.includes(path)) return "mcp"
  if (adapterPackagePaths.includes(path)) return "adapter"
  if (skillPackagePaths.includes(path)) return "skill"
  return undefined
}

function extractTypecheckPackagePaths(command: string): readonly string[] {
  return [...command.matchAll(/tsgo --noEmit -p (packages\/[^ ]+\/tsconfig\.json)/g)]
    .map((match) => match[1])
    .filter((path): path is string => path !== undefined)
    .map((path) => path.slice(0, -"/tsconfig.json".length))
    .toSorted()
}

function extractSharedCoreGuardPackagePaths(source: string): readonly string[] {
  const match = /const corePackages = \[([\s\S]*?)\] as const/.exec(source)
  const body = match?.[1]
  if (body === undefined) throw new Error("Could not find corePackages in shared-core-extraction-guard.test.ts")

  return [...body.matchAll(/"([^"]+)"/g)]
    .map((entry) => entry[1])
    .filter((path): path is string => path !== undefined)
    .toSorted()
}

describe("package registration audit", () => {
  test("#given managed packages #when root registration is audited #then workspaces typecheck and dev deps stay aligned", async () => {
    // given
    const root = await readRootManifest()
    const managedPackagePaths = (await discoverPackagePaths()).filter(isManagedWorkspacePackage)
    const managedWorkspacePaths = managedPackagePaths.filter((path) => !mcpPackagePaths.includes(path) || root.workspaces.includes(path))
    const expectedTypecheckPaths = managedWorkspacePaths.filter((path) => existsSync(join(path, "tsconfig.json")))
    const expectedDevDependencyNames = (
      await Promise.all(
        managedWorkspacePaths
          .filter((path) => path !== "packages/omo-opencode")
          .map((path) => readManifest(join(path, "package.json")).then((manifest) => manifest.name)),
      )
    ).toSorted()

    // when
    const unknownWorkspacePaths = unclassifiedRootPackageWorkspaces(root.workspaces)
    const actualWorkspacePaths = root.workspaces.filter(isManagedWorkspacePackage).toSorted()
    const actualTypecheckPaths = extractTypecheckPackagePaths(root.scripts["typecheck:packages"] ?? "").filter(
      isRootManagedTypecheckPackage,
    )
    const actualDevDependencyNames = Object.entries(root.devDependencies)
      .filter((entry) => entry[1] === "workspace:*" && entry[0].startsWith("@oh-my-opencode/"))
      .map((entry) => entry[0])
      .toSorted()

    // then
    expect(unknownWorkspacePaths).toEqual([])
    expect(actualWorkspacePaths).toEqual(managedWorkspacePaths.toSorted())
    expect(actualTypecheckPaths).toEqual(expectedTypecheckPaths.toSorted())
    expect(actualDevDependencyNames).toEqual(expectedDevDependencyNames)
  })

  test("#given an unknown packages workspace #when audited #then classification rejects it by path", () => {
    // given
    const workspaces = ["packages/zz-qa-unregistered-probe"]

    // when
    const unknownWorkspacePaths = unclassifiedRootPackageWorkspaces(workspaces)

    // then
    expect(unknownWorkspacePaths).toEqual(["packages/zz-qa-unregistered-probe"])
  })

  test("#given shared extraction guard #when audited #then every core package is covered", async () => {
    // given
    const guardSource = await readFile("script/shared-core-extraction-guard.test.ts", "utf8")

    // when
    const guardPackagePaths = extractSharedCoreGuardPackagePaths(guardSource)

    // then
    expect(guardPackagePaths).toEqual([...corePackagePaths].toSorted())
  })

  test("#given package test scripts #when nested tests exist #then recursive globs are registered", async () => {
    // given
    const packagePaths = (await discoverPackagePaths()).filter(isManagedWorkspacePackage)

    // when
    const offenders: string[] = []
    for (const packagePath of packagePaths) {
      const manifest = await readManifest(join(packagePath, "package.json"))
      const testScript = manifest.scripts["test"] ?? ""
      if (!testScript.startsWith("bun test") || !existsSync(join(packagePath, "src"))) continue

      const tests = await collectFiles(join(packagePath, "src"), (path) => path.endsWith(".test.ts"))
      const hasNestedTests = tests.some((path) => relative(join(packagePath, "src"), path).includes("/"))
      if (hasNestedTests && testScript.includes("src/*.test.ts") && !testScript.includes("src/**/*.test.ts")) {
        offenders.push(`${packagePath}: ${testScript}`)
      }
    }

    // then
    expect(offenders).toEqual([])
  })

  test("#given package dependencies #when ROADMAP layers are checked #then reverse edges stay at zero", async () => {
    // given
    const packagePaths = await discoverPackagePaths()
    const manifests = await Promise.all(packagePaths.map((path) => readManifest(join(path, "package.json"))))
    const packagePathByName = new Map(manifests.map((manifest, index) => [manifest.name, packagePaths[index]]))

    // when
    const reverseEdges: string[] = []
    for (const [index, manifest] of manifests.entries()) {
      const sourcePath = packagePaths[index]
      const sourceLayer = sourcePath === undefined ? undefined : packageLayer(sourcePath)
      if (sourceLayer === undefined) continue

      const dependencies = { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies }
      for (const dependencyName of Object.keys(dependencies)) {
        const targetPath = packagePathByName.get(dependencyName)
        const targetLayer = targetPath === undefined ? undefined : packageLayer(targetPath)
        if (targetLayer === undefined) continue
        if (layerRanks[sourceLayer] < layerRanks[targetLayer]) {
          reverseEdges.push(`${sourcePath} -> ${targetPath}`)
        }
      }
    }

    // then
    expect(reverseEdges).toEqual([])
  })

  test("#given exact re-export shim scan #when inventory docs are checked #then total targets and every path are present", async () => {
    // given
    const docPath = "docs/reference/re-export-shim-inventory.md"
    const [doc, shims] = await Promise.all([readFile(docPath, "utf8"), collectReExportShims()])

    // when
    const totalMatch = /Total shim exports found: (\d+)\./.exec(doc)
    if (totalMatch?.[1] === undefined) throw new Error(`${docPath} is missing the total shim count`)

    const documentedTotal = Number.parseInt(totalMatch[1], 10)
    const targetPackages = [...new Set(shims.map((shim) => shim.targetPackage))].toSorted()
    const missingTargetPackages = targetPackages.filter((targetPackage) => !doc.includes(`\`${targetPackage}\``))
    const missingPaths = shims.map((shim) => shim.path).filter((path) => !doc.includes(`\`${path}\``))

    // then
    expect(doc).toContain("Re-export Shim Inventory")
    expect(documentedTotal).toBe(shims.length)
    expect(missingTargetPackages).toEqual([])
    expect(missingPaths).toEqual([])
  }, { timeout: 20_000 })
})
