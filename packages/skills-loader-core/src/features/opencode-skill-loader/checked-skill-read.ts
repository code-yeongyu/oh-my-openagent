import * as fs from "node:fs"
import { checkSkillPath, SkillLinkBlockedError, type SkillProvenance } from "./skill-provenance"

/**
 * Containment assumes the filesystem is stable during loading. Descriptor identity
 * detects some concurrent replacements, not ancestor-directory swaps.
 */
export function readSkillFileChecked(path: string, provenance: SkillProvenance): string {
  if (provenance.kind !== "project-auto") return fs.readFileSync(path, "utf8")
  const canonical = checkSkillPath(path, provenance)
  let descriptor: number | undefined
  try {
    // Pin the authorized file without following links before opening it. Windows has no O_NOFOLLOW and a
    // post-open stat follows a swapped-in link to the descriptor's own target, so only this catches a swap (#10693).
    const expected = fs.lstatSync(canonical)
    if (!expected.isFile()) {
      const code = expected.isDirectory() ? "EISDIR" : "EINVAL"
      throw Object.assign(new Error(`${code}: expected a skill file, '${path}'`), { code, path })
    }
    descriptor = fs.openSync(canonical, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
    const opened = fs.fstatSync(descriptor)
    if (!opened.isFile() || opened.dev !== expected.dev || opened.ino !== expected.ino || fs.lstatSync(canonical).isSymbolicLink()) {
      checkSkillPath(path, provenance)
      throw Object.assign(new Error(`ESTALE: skill file changed during read, '${path}'`), { code: "ESTALE", path })
    }
    return fs.readFileSync(descriptor, "utf8")
  } catch (error) {
    if (error instanceof SkillLinkBlockedError) throw error
    // An O_NOFOLLOW failure may be a real escape after replacement; ordinary I/O
    // errors keep their original errno instead of becoming a security warning.
    try { checkSkillPath(path, provenance) } catch (current) {
      if (current instanceof SkillLinkBlockedError) throw current
    }
    throw error
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
  }
}
