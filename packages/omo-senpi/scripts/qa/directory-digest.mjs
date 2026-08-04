import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs"
import { join, relative } from "node:path"

const defaultOperations = { readdirSync, realpathSync: realpathSync.native }

export function digestDirectory(root, options = {}) {
  if (!existsSync(root)) return "absent"
  const ignored = new Set((options.ignore ?? []).map(normalizeRelativePath))
  const hash = createHash("sha256")
  const include = (path) => !ignored.has(normalizeRelativePath(relative(root, path)))
  for (const file of listFiles(root, defaultOperations, include).sort()) {
    hash.update(relative(root, file))
    hash.update("\0")
    hash.update(createHash("sha256").update(readFileSync(file)).digest("hex"))
    hash.update("\0")
  }
  return hash.digest("hex")
}

export function listFiles(root, operations = defaultOperations, include = () => true) {
  const files = []
  const directories = [root]
  const visitedDirectories = new Set()
  for (let index = 0; index < directories.length; index += 1) {
    const directory = directories[index]
    const identity = operations.realpathSync?.(directory) ?? directory
    const identityKey = process.platform === "win32" ? identity.toLowerCase() : identity
    if (visitedDirectories.has(identityKey)) continue
    visitedDirectories.add(identityKey)
    for (const entry of operations.readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (!include(path, entry)) continue
      if (entry.isDirectory()) directories.push(path)
      else if (entry.isFile()) files.push(path)
    }
  }
  return files
}

function normalizeRelativePath(path) {
  return path.replaceAll("\\", "/")
}
