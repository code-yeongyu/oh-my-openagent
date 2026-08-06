import { lstat, readFile, readlink, rm } from "node:fs/promises"
import { join } from "node:path"
import { COMMAND_SHIM_MARKER } from "./codex-cache-command-shim"

type LinkPlatform = NodeJS.Platform

const LEGACY_CODEX_COMPONENT_BINS = [
  { name: "omo", component: "ulw-loop" },
  { name: "codex-comment-checker", component: "comment-checker" },
  { name: "codex-lsp", component: "lsp" },
  { name: "codex-rules", component: "rules" },
  { name: "codex-start-work-continuation", component: "start-work-continuation" },
  { name: "codex-telemetry", component: "telemetry" },
  { name: "codex-ultrawork", component: "ultrawork" },
] as const

type LegacyCodexComponent = (typeof LEGACY_CODEX_COMPONENT_BINS)[number]["component"]

export async function removeLegacyCodexComponentBins(binDir: string, platform: LinkPlatform): Promise<void> {
  for (const entry of LEGACY_CODEX_COMPONENT_BINS) {
    const linkPath = join(binDir, platform === "win32" ? `${entry.name}.cmd` : entry.name)
    await removeLegacyCodexComponentBin(linkPath, entry.component, platform)
  }
}

async function removeLegacyCodexComponentBin(linkPath: string, component: LegacyCodexComponent, platform: LinkPlatform): Promise<void> {
  try {
    const stat = await lstat(linkPath)
    if (platform !== "win32") {
      if (!stat.isSymbolicLink()) return
      const target = await readlink(linkPath)
      if (isManagedLegacyComponentTarget(target, component)) await rm(linkPath, { force: true })
      return
    }
    if (!stat.isFile()) return
    const content = await readFile(linkPath, "utf8")
    if (content.includes(COMMAND_SHIM_MARKER)) await rm(linkPath, { force: true })
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT") return
    throw error
  }
}

function isManagedLegacyComponentTarget(target: string, component: LegacyCodexComponent): boolean {
  const parts = target.split(/[\\/]+/)
  const suffixStart = parts.length - 4
  const suffix = parts.slice(-4)
  return (
    suffix[0] === "components" &&
    suffix[1] === component &&
    suffix[2] === "dist" &&
    suffix[3] === "cli.js" &&
    (hasPluginCachePrefix(parts, suffixStart) || hasOmoCodexPluginPrefix(parts, suffixStart))
  )
}

function hasPluginCachePrefix(parts: readonly string[], endExclusive: number): boolean {
  for (let index = 0; index < endExclusive - 1; index += 1) {
    if (parts[index] === "plugins" && parts[index + 1] === "cache") return true
  }
  return false
}

function hasOmoCodexPluginPrefix(parts: readonly string[], endExclusive: number): boolean {
  for (let index = 0; index <= endExclusive - 3; index += 1) {
    if (parts[index] === "packages" && parts[index + 1] === "omo-codex" && parts[index + 2] === "plugin") return true
  }
  return false
}

function isNodeErrorWithCode(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error
}
