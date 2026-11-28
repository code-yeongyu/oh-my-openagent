import { cp, lstat, mkdtemp, readdir, rename, rm, stat } from "node:fs/promises"
import { join, relative, sep } from "node:path"

// Codex fingerprints every plugin entry with symlink_metadata, including node_modules.
// Hooks use component CLIs directly; third-party regular npm shims must remain.
const NPM_BIN_PATH_SEGMENT = `${sep}node_modules${sep}.bin${sep}`

// Classified by the path under the plugin root, so a CODEX_HOME that itself sits under node_modules/.bin keeps its payload.
const isNpmBinEntry = (pluginRoot: string, path: string): boolean =>
  `${sep}${relative(pluginRoot, path)}`.includes(NPM_BIN_PATH_SEGMENT)

export async function finalizeCachedPluginPayload(pluginRoot: string): Promise<void> {
  await materializeDirectory(pluginRoot, pluginRoot)
  const unsupported = await unsupportedEntries(pluginRoot, pluginRoot)
  if (unsupported.length > 0) throw unsupportedEntryError(unsupported)
}

const unsupportedEntryError = (paths: readonly string[]): Error =>
  new Error(`Codex plugin contains unsupported entry types: ${[...paths].sort().join(", ")}`)

async function materializeDirectory(pluginRoot: string, directory: string): Promise<void> {
  for (const name of await readdir(directory)) {
    const path = join(directory, name)
    let entry = await lstat(path)
    if (isNpmBinEntry(pluginRoot, path) && !entry.isFile() && !entry.isDirectory()) {
      await rm(path, { recursive: true, force: true })
      continue
    }
    if (entry.isSymbolicLink()) {
      if ((await stat(path).catch(() => undefined)) === undefined)
        throw unsupportedEntryError([relative(pluginRoot, path)])
      const staging = await mkdtemp(join(directory, ".omo-materialize-"))
      try {
        const copyPath = join(staging, "entry")
        await cp(path, copyPath, {
          recursive: true,
          dereference: true,
          filter: async (source) => {
            if (!isNpmBinEntry(pluginRoot, source)) return true
            const sourceEntry = await lstat(source)
            return sourceEntry.isFile() || sourceEntry.isDirectory()
          },
        })
        await rm(path, { force: true, recursive: true })
        await rename(copyPath, path)
      } finally {
        await rm(staging, { recursive: true, force: true })
      }
      entry = await lstat(path)
    }
    if (entry.isDirectory()) await materializeDirectory(pluginRoot, path)
  }
}

async function unsupportedEntries(root: string, directory: string): Promise<string[]> {
  const unsupported: string[] = []
  for (const name of await readdir(directory)) {
    const path = join(directory, name)
    const entry = await lstat(path)
    if (entry.isDirectory()) unsupported.push(...(await unsupportedEntries(root, path)))
    else if (!entry.isFile()) unsupported.push(relative(root, path))
  }
  return unsupported
}
