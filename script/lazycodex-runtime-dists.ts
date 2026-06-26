import { cp, mkdir, stat } from "node:fs/promises"
import { dirname, join } from "node:path"

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

export async function copyLazycodexRuntimeDists(input: CopyLazycodexRuntimeDistsInput): Promise<void> {
  for (const dist of RUNTIME_DISTS) {
    await copyRuntimeDist(input, dist)
  }
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
