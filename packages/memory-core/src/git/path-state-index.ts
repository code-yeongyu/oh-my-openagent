import { randomUUID } from "node:crypto"
import { copyFile, open, readFile, rename, rm } from "node:fs/promises"
import { isAbsolute, resolve } from "node:path"
import type { GitExec, GitExecResult } from "./exec"
import type { GitIndexIdentity } from "./path-state"
import { errorCode } from "./path-state-files"
import { commandError } from "./repo-arguments"

const GIT_TIMEOUT_MS = 30_000

export async function writeIndexIfIdentity(options: {
  readonly dir: string
  readonly exec: GitExec
  readonly path: string
  readonly expected: GitIndexIdentity | null
  readonly next: GitIndexIdentity | null
  readonly capture: () => Promise<GitIndexIdentity | null>
}): Promise<boolean> {
  const rawIndexPath = (await git(options, ["rev-parse", "--git-path", "index"])).stdout.trim()
  const indexPath = isAbsolute(rawIndexPath) ? rawIndexPath : resolve(options.dir, rawIndexPath)
  const lockPath = `${indexPath}.lock`
  const temporary = `${indexPath}.omo-${process.pid}-${randomUUID()}`
  let lock
  try {
    lock = await open(lockPath, "wx")
  } catch (error) {
    if (errorCode(error) === "EEXIST") return false
    throw error
  }
  let published = false
  try {
    if (!sameIdentity(await options.capture(), options.expected)) return false
    await copyFile(indexPath, temporary)
    const argv = options.next === null
      ? ["update-index", "--force-remove", "--", options.path]
      : ["update-index", "--add", "--cacheinfo", options.next.mode, options.next.oid, options.path]
    await git(options, argv, { GIT_INDEX_FILE: temporary })
    await lock.writeFile(await readFile(temporary))
    await lock.sync()
    await lock.close()
    await rename(lockPath, indexPath)
    published = true
    return true
  } finally {
    if (!published) await lock.close().catch(() => undefined)
    await rm(temporary, { force: true })
    if (!published) await rm(lockPath, { force: true })
  }
}

async function git(
  options: { readonly dir: string; readonly exec: GitExec },
  argv: readonly string[],
  env: Readonly<Record<string, string>> = {},
): Promise<GitExecResult> {
  const result = await options.exec.run(argv, {
    cwd: options.dir,
    timeoutMs: GIT_TIMEOUT_MS,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...env },
  })
  if (result.code !== 0) throw commandError(argv, result)
  return result
}

function sameIdentity(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
