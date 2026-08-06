import { cp, mkdir, readdir, readFile, stat } from "node:fs/promises"
import { dirname, join } from "node:path"

import { isPlainRecord } from "@oh-my-opencode/utils"

interface RuntimeDist {
  readonly label: string
  readonly sourcePath: string
  readonly destinationPath: string
}

export interface CopyLazycodexRuntimeDistsInput {
  readonly sourceRoot: string
  readonly lazycodexRoot: string
  readonly skipMissing: boolean
}

const RUNTIME_DISTS: readonly RuntimeDist[] = [
  {
    label: "git-bash MCP",
    sourcePath: join("packages", "git-bash-mcp", "dist"),
    destinationPath: join("plugins", "omo", "components", "git-bash-mcp", "dist"),
  },
  {
    label: "LSP MCP",
    sourcePath: join("packages", "lsp-tools-mcp", "dist"),
    destinationPath: join("plugins", "omo", "components", "lsp-tools-mcp", "dist"),
  },
  {
    label: "LSP daemon dist",
    sourcePath: join("packages", "lsp-daemon", "dist"),
    destinationPath: join("plugins", "omo", "components", "lsp-daemon", "dist"),
  },
  {
    label: "OMO root CLI dist",
    sourcePath: join("dist", "cli"),
    destinationPath: join("plugins", "omo", "dist", "cli"),
  },
  {
    label: "OMO node fallback CLI dist",
    sourcePath: join("dist", "cli-node"),
    destinationPath: join("plugins", "omo", "dist", "cli-node"),
  },
] as const

const PLUGIN_COMPONENTS_SOURCE_PATH = join("packages", "omo-codex", "plugin", "components")
const PLUGIN_COMPONENTS_DESTINATION_PATH = join("plugins", "omo", "components")

export async function copyLazycodexRuntimeDists(input: CopyLazycodexRuntimeDistsInput): Promise<void> {
  for (const dist of RUNTIME_DISTS) {
    await copyRuntimeDist(input, dist)
  }
  for (const dist of await collectComponentBinDists(input.sourceRoot)) {
    await copyRuntimeDist(input, dist)
  }
}

// Every component package.json "bin" becomes a Codex managed bin; when the component's gitignored
// dist/ never reaches the marketplace payload the installer keeps repairing a dangling bin
// (lazycodex#108). Bundle each bin-referenced component dist explicitly, the same way the MCP
// runtime dists are bundled, so an unbuilt component fails the sync instead of silently shipping
// a broken plugin.
async function collectComponentBinDists(sourceRoot: string): Promise<RuntimeDist[]> {
  const componentsRoot = join(sourceRoot, PLUGIN_COMPONENTS_SOURCE_PATH)
  const dists: RuntimeDist[] = []
  for (const componentName of await listComponentNames(componentsRoot)) {
    if (!(await declaresDistBin(join(componentsRoot, componentName, "package.json")))) continue
    dists.push({
      label: `${componentName} component dist`,
      sourcePath: join(PLUGIN_COMPONENTS_SOURCE_PATH, componentName, "dist"),
      destinationPath: join(PLUGIN_COMPONENTS_DESTINATION_PATH, componentName, "dist"),
    })
  }
  return dists
}

async function listComponentNames(componentsRoot: string): Promise<string[]> {
  try {
    const entries = await readdir(componentsRoot, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  } catch (error) {
    if (error instanceof Error) return []
    return []
  }
}

async function declaresDistBin(manifestPath: string): Promise<boolean> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(manifestPath, "utf8"))
  } catch (error) {
    if (error instanceof Error) return false
    return false
  }
  if (!isPlainRecord(parsed) || !isPlainRecord(parsed.bin)) return false
  return Object.values(parsed.bin).some((target) => typeof target === "string" && isDistTarget(target))
}

function isDistTarget(target: string): boolean {
  const normalized = target.split("\\").join("/").replace(/^\.\//, "")
  return normalized === "dist" || normalized.startsWith("dist/")
}

async function copyRuntimeDist(input: CopyLazycodexRuntimeDistsInput, dist: RuntimeDist): Promise<void> {
  const sourcePath = join(input.sourceRoot, dist.sourcePath)
  if (!(await isDirectory(sourcePath))) {
    if (input.skipMissing) {
      console.warn(`[sync-lazycodex-marketplace] previous-payload reconstruction: skipping missing ${dist.label} at ${sourcePath}`)
      return
    }
    throw new Error(`missing built ${dist.label} at ${sourcePath}`)
  }
  const destinationPath = join(input.lazycodexRoot, dist.destinationPath)
  await mkdir(dirname(destinationPath), { recursive: true })
  await cp(sourcePath, destinationPath, { recursive: true })
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch (error) {
    if (error instanceof Error) return false
    return false
  }
}
