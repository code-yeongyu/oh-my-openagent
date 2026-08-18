import { readFile, readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { isPlainRecord } from "./codex-cache-fs"

// Records where the installer actually placed its bin links. `CODEX_LOCAL_BIN_DIR` is commonly
// a one-shot override, so a later uninstall run cannot recompute the same directory from the
// environment: it would sweep the default location and leave every wrapper behind in the custom
// one (issue raised in review of #6569). The wrapper embeds CODEX_HOME but not the bin dir, so
// the record lives next to the plugin cache, which uninstall already knows how to find.
const INSTALLED_BIN_DIR_MANIFEST = ".installed-bin-dir.json"

export async function writeInstalledCodexBinDir(input: {
  readonly pluginRoot: string
  readonly binDir: string
}): Promise<void> {
  await writeFile(
    join(input.pluginRoot, INSTALLED_BIN_DIR_MANIFEST),
    `${JSON.stringify({ binDir: input.binDir }, null, 2)}\n`,
  )
}

// Read before any managed state is removed: cleanup deletes the very trees these manifests live
// in. Returns null when nothing was recorded, so callers fall back to the usual resolution.
export async function readInstalledCodexBinDir(codexHome: string): Promise<string | null> {
  for (const manifestPath of await installedBinDirManifestPaths(codexHome)) {
    const binDir = await readBinDirFromManifest(manifestPath)
    if (binDir !== null) return binDir
  }
  return null
}

async function installedBinDirManifestPaths(codexHome: string): Promise<readonly string[]> {
  const paths: string[] = [
    join(codexHome, ".tmp", "marketplaces", "sisyphuslabs", "plugins", "omo", INSTALLED_BIN_DIR_MANIFEST),
  ]
  const versionRoot = join(codexHome, "plugins", "cache", "sisyphuslabs", "omo")
  const entries = await readdir(versionRoot, { withFileTypes: true }).catch(() => null)
  if (entries !== null) {
    for (const entry of entries) {
      if (entry.isDirectory()) paths.push(join(versionRoot, entry.name, INSTALLED_BIN_DIR_MANIFEST))
    }
  }
  return paths
}

async function readBinDirFromManifest(manifestPath: string): Promise<string | null> {
  const raw = await readFile(manifestPath, "utf8").catch(() => null)
  if (raw === null) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isPlainRecord(parsed)) return null

  const binDir = parsed.binDir
  if (typeof binDir !== "string" || binDir.trim().length === 0) return null
  return binDir.trim()
}
