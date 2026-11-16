import { renameSync, rmSync, statSync, writeFileSync } from "node:fs"

/**
 * Writes `contents` to `path` through a sibling file renamed over it. Package managers may hardlink installed
 * engine files to their shared cache, so writing in place would change the cache entry and every later install
 * from it (#13819); the rename replaces only this install's directory entry. The file keeps its permission bits.
 */
export function replaceFile(path, contents) {
  let mode
  try {
    mode = statSync(path).mode & 0o777
  } catch {
    mode = undefined
  }
  const temporary = `${path}.omo-${process.pid}.tmp`
  try {
    writeFileSync(temporary, contents, mode === undefined ? undefined : { mode })
    renameSync(temporary, path)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}
