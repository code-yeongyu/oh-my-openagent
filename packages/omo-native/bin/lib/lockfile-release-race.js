import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { engineDependencyDir } from "./engine-dependency.js"

// proper-lockfile 4.1.2 checks released in its utimes callback, but not in the
// preceding stat callback. A normal unlock while stat is pending can therefore
// throw ECOMPROMISED outside the writer's promise, or refresh a new owner's lock.
const heartbeat = /(\b\w+\.fs\.stat\((\w+)\.lockfilePath,\s*\(\w+,\s*\w+\)\s*=>\s*\{)/

function prepareFile(path) {
  const source = readFileSync(path, "utf8")
  if (!source.includes("function updateLock(")) return
  const match = heartbeat.exec(source)
  if (!match) throw new Error(`omo-ai: unsupported proper-lockfile heartbeat: ${path}`)
  const guard = `if(${match[2]}.released)return;`
  if (source.slice(match.index + match[0].length).startsWith(guard)) return
  writeFileSync(path, source.replace(heartbeat, `$1${guard}`))
}

/** Prepare both the library entry and the copies actually executed by bundled CLI/workers. */
export function prepareLockfileReleaseRace(senpiRoot) {
  const library = engineDependencyDir(senpiRoot, "proper-lockfile")
  if (library) prepareFile(join(library, "lib", "lockfile.js"))
  const bundle = join(senpiRoot, "dist", "bundle")
  if (!existsSync(bundle)) return
  for (const entry of readdirSync(bundle, { recursive: true, withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".js")) prepareFile(join(entry.parentPath, entry.name))
  }
}
