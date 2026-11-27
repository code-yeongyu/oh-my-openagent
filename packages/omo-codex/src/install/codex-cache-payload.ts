import { lstatSync, readdirSync } from "node:fs"
import { cp, lstat, mkdtemp, rename, rm } from "node:fs/promises"
import { join, relative, sep } from "node:path"

// Codex fingerprints every plugin entry with symlink_metadata, including node_modules.
// Hooks use component CLIs directly; third-party regular npm shims must remain.
const NPM_BIN_PATH_SEGMENT = `${sep}node_modules${sep}.bin${sep}`

export async function finalizeCachedPluginPayload(pluginRoot: string): Promise<void> {
  await materializeDirectory(pluginRoot)
  const unsupported = unsupportedEntries(pluginRoot, pluginRoot)
  if (unsupported.length > 0) {
    throw new Error(`Codex plugin contains unsupported entry types: ${unsupported.sort().join(", ")}`)
  }
}

// The walks list directories synchronously: through Bun's async fs pool, a readdir plus an lstat per
// entry over the plugin tree cost seconds on a starved CPU (#14000); a dirent already carries the type.
async function materializeDirectory(directory: string): Promise<void> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (path.includes(NPM_BIN_PATH_SEGMENT) && !entry.isFile() && !entry.isDirectory()) {
      await rm(path, { recursive: true, force: true })
      continue
    }
    let isDirectory = entry.isDirectory()
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
      isDirectory = lstatSync(path).isDirectory()
    }
    if (isDirectory) await materializeDirectory(path)
  }
}

function unsupportedEntries(root: string, directory: string): string[] {
  const unsupported: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) unsupported.push(...unsupportedEntries(root, path))
    else if (!entry.isFile()) unsupported.push(relative(root, path))
  }
  return unsupported
}
