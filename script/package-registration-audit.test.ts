import { existsSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import { join, relative } from "node:path"
import { describe, expect, test } from "bun:test"

const corePackagePaths: readonly string[] = [
  "packages/utils",
  "packages/model-core",
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
  "packages/codegraph-mcp",
  "packages/git-bash-mcp",
  "packages/lsp-daemon",
  "packages/lsp-tools-mcp",
] as const
const adapterPackagePaths: readonly string[] = ["packages/omo-codex", "packages/omo-opencode"] as const
const skillPackagePaths: readonly string[] = ["packages/shared-skills"] as const

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readStringField(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== "string") throw new Error(`Expected ${key} to be a string`)
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

async function discoverPackagePaths(): Promise<readonly string[]> {
  const packageNames = await readdir("packages")
  return packageNames
    .map((name) => `packages/${name}`)
    .filter((path) => existsSync(join(path, "package.json")))
    .toSorted()
}

function isManagedWorkspacePackage(path: string): boolean {
  return (
    corePackagePaths.includes(path) ||
    mcpPackagePaths.includes(path) ||
    adapterPackagePaths.includes(path) ||
    skillPackagePaths.includes(path)
  )
}

function packageLayer(path: string): keyof typeof layerRanks | undefined {
  if (corePackagePaths.includes(path)) return "core"
  if (mcpPackagePaths.includes(path)) return "mcp"
  if (adapterPackagePaths.includes(path)) return "adapter"
  if (skillPackagePaths.includes(path)) return "skill"
  return undefined
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

})
