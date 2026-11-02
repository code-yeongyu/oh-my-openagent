import { cp, lstat, mkdtemp, readdir, rename, rm } from "node:fs/promises"
import { join, relative, sep } from "node:path"

// Codex fingerprints every plugin entry with symlink_metadata, including node_modules.
// Hooks use component CLIs directly; third-party regular npm shims must remain.
const NPM_BIN_PATH_SEGMENT = `${sep}node_modules${sep}.bin${sep}`

export async function finalizeCachedPluginPayload(pluginRoot: string): Promise<void> {
  await materializeDirectory(pluginRoot)
  const unsupported = await unsupportedEntries(pluginRoot, pluginRoot)
  if (unsupported.length > 0) {
    throw new Error(`Codex plugin contains unsupported entry types: ${unsupported.sort().join(", ")}`)
  }
}

async function materializeDirectory(directory: string): Promise<void> {
  for (const name of await readdir(directory)) {
    const path = join(directory, name)
    let entry = await lstat(path)
    if (path.includes(NPM_BIN_PATH_SEGMENT) && !entry.isFile() && !entry.isDirectory()) {
      await rm(path, { recursive: true, force: true })
      continue
    }
    if (entry.isSymbolicLink()) {
      const staging = await mkdtemp(join(directory, ".omo-materialize-"))
      try {
        const copyPath = join(staging, "entry")
        await cp(path, copyPath, {
          recursive: true,
          dereference: true,
          filter: async (source) => {
            if (!source.includes(NPM_BIN_PATH_SEGMENT)) return true
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
    if (entry.isDirectory()) await materializeDirectory(path)
  }
}

async function unsupportedEntries(root: string, directory: string): Promise<string[]> {
  const unsupported: string[] = []
  for (const name of await readdir(directory)) {
    const path = join(directory, name)
    const entry = await lstat(path)
    if (entry.isDirectory()) unsupported.push(...await unsupportedEntries(root, path))
    else if (!entry.isFile()) unsupported.push(relative(root, path))
  }
  return unsupported
}
