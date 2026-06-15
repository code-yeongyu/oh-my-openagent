import { isPlainRecord } from "./codex-cache-fs"
import { readdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

export interface DistributionManifest {
  readonly name: string
  readonly version: string
}

export async function readDistributionManifest(repoRoot: string): Promise<DistributionManifest | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"))
    if (!isPlainRecord(parsed) || typeof parsed.version !== "string" || parsed.version.trim().length === 0) return undefined
    return {
      name: typeof parsed.name === "string" && parsed.name.trim().length > 0 ? parsed.name.trim() : "lazycodex-ai",
      version: parsed.version.trim(),
    }
  } catch (error) {
    if (error instanceof Error) return undefined
    throw error
  }
}

export function resolveLazyCodexPluginVersion(input: {
  readonly manifestVersion?: string
  readonly marketplaceName: string
  readonly pluginName: string
  readonly distributionManifest?: DistributionManifest
}): string {
  if (input.marketplaceName === "sisyphuslabs" && input.pluginName === "omo" && input.distributionManifest !== undefined) {
    return input.distributionManifest.version
  }
  return input.manifestVersion ?? "local"
}

export async function stampLazyCodexPluginVersion(input: { readonly pluginRoot: string; readonly version: string }): Promise<void> {
  await stampJsonVersion(join(input.pluginRoot, ".codex-plugin", "plugin.json"), input.version)
  await stampJsonVersion(join(input.pluginRoot, "package.json"), input.version)
  await stampHookStatusMessages(join(input.pluginRoot, "hooks", "hooks.json"), input.version)
  await stampComponentVersions(input)
}

export async function writeLazyCodexInstallSnapshot(input: {
  readonly pluginRoot: string
  readonly distributionManifest?: DistributionManifest
}): Promise<void> {
  if (input.distributionManifest === undefined) return
  await writeFile(
    join(input.pluginRoot, "lazycodex-install.json"),
    `${JSON.stringify(
      {
        packageName: input.distributionManifest.name,
        version: input.distributionManifest.version,
      },
      null,
      "\t",
    )}\n`,
  )
}

async function stampJsonVersion(path: string, version: string): Promise<void> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"))
    if (!isPlainRecord(parsed)) return
    parsed.version = version
    await writeFile(path, `${JSON.stringify(parsed, null, "\t")}\n`)
  } catch (error) {
    if (error instanceof Error) return
    throw error
  }
}

async function stampHookStatusMessages(path: string, version: string): Promise<void> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"))
    if (!isPlainRecord(parsed)) return
    stampHookGroups(parsed.hooks, version)
    await writeFile(path, `${JSON.stringify(parsed, null, "\t")}\n`)
  } catch (error) {
    if (error instanceof Error) return
    throw error
  }
}

async function stampComponentVersions(input: { readonly pluginRoot: string; readonly version: string }): Promise<void> {
  let entries: readonly string[]
  try {
    entries = await readdir(join(input.pluginRoot, "components"))
  } catch (error) {
    if (error instanceof Error) return
    throw error
  }
  for (const entry of entries) {
    const componentRoot = join(input.pluginRoot, "components", entry)
    await stampJsonVersion(join(componentRoot, "package.json"), input.version)
    await stampHookStatusMessages(join(componentRoot, "hooks", "hooks.json"), input.version)
  }
}

function stampHookGroups(hooks: unknown, version: string): void {
  if (!isPlainRecord(hooks)) return
  for (const groups of Object.values(hooks)) {
    if (!Array.isArray(groups)) continue
    for (const group of groups) {
      if (!isPlainRecord(group) || !Array.isArray(group.hooks)) continue
      for (const hook of group.hooks) {
        stampHookStatusMessage(hook, version)
      }
    }
  }
}

function stampHookStatusMessage(hook: unknown, version: string): void {
  if (!isPlainRecord(hook) || typeof hook.statusMessage !== "string") return
  hook.statusMessage = hook.statusMessage.replace(/^LazyCodex\([^)]+\):/, `LazyCodex(${version}):`)
}
