import { join } from "node:path"

import { readFile, stat } from "../fs/resilient"

const REF_NAME = /^refs\/[A-Za-z0-9._\-/]+$/

/**
 * Filesystem fingerprint of what `git rev-parse --verify HEAD` would read: the HEAD file's content
 * plus (mtimeMs,size) of HEAD, of the branch ref HEAD points at, and of packed-refs. Absent ref
 * files are recorded as absent, so packing or unpacking a ref changes the fingerprint too.
 * `undefined` means "cannot be fingerprinted" and always falls open to the git call.
 */
export async function headSignature(dir: string): Promise<string | undefined> {
  try {
    const gitDir = join(dir, ".git")
    // A worktree or submodule checkout has a `.git` FILE pointing elsewhere: not fingerprinted here.
    if (!(await stat(gitDir)).isDirectory()) return undefined
    const headPath = join(gitDir, "HEAD")
    const headStat = await stat(headPath)
    const head = (await readFile(headPath, "utf8")).trim()
    const parts = [`head=${head}`, `head-stat=${headStat.mtimeMs}:${headStat.size}`]
    if (head.startsWith("ref:")) {
      const ref = head.slice("ref:".length).trim()
      if (!REF_NAME.test(ref)) return undefined
      parts.push(`ref=${await fileSignature(join(gitDir, ...ref.split("/")))}`)
      parts.push(`packed=${await fileSignature(join(gitDir, "packed-refs"))}`)
    }
    return parts.join("|")
  } catch {
    return undefined
  }
}

async function fileSignature(path: string): Promise<string> {
  try {
    const info = await stat(path)
    return `${info.mtimeMs}:${info.size}`
  } catch {
    return "absent"
  }
}
