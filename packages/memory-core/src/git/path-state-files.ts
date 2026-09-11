import { randomUUID } from "node:crypto"
import { chmod, link, lstat, mkdir, open, readFile, rename, rm, rmdir, writeFile, writeHandleAll } from "../fs/resilient"
import { basename, dirname, join } from "node:path"
import { GitPathStateError } from "./path-state"

export async function writeWorktreeFile(
  root: string,
  path: string,
  content: string,
  mode: number,
  exclusive: boolean,
): Promise<boolean> {
  const target = join(root, path)
  await assertSafeParents(root, path)
  if (!exclusive) await assertReplaceableTarget(target)
  await mkdir(dirname(target), { recursive: true })
  await assertSafeParents(root, path)
  const temporary = join(dirname(target), `.${basename(target)}.omo-${process.pid}-${randomUUID()}`)
  const file = await open(temporary, "wx", mode)
  try {
    await writeHandleAll(file, content, "utf8")
    await chmod(temporary, mode)
    await file.sync()
  } catch (error) {
    await file.close()
    await rm(temporary, { force: true })
    throw error
  }
  await file.close()
  if (exclusive) {
    try {
      await link(temporary, target)
    } catch (error) {
      await rm(temporary, { force: true })
      if (errorCode(error) === "EEXIST") return false
      throw error
    }
    await rm(temporary)
  } else {
    await rename(temporary, target)
  }
  await syncDirectory(dirname(target))
  return true
}

export async function moveWorktreeFile(root: string, path: string): Promise<string | undefined> {
  const target = join(root, path)
  await assertSafeParents(root, path)
  try {
    const stat = await lstat(target)
    if (!stat.isFile()) throw unsupportedWorktree(path, stat.isSymbolicLink() ? "symlink" : "non-file")
    const moved = join(dirname(target), `.${basename(target)}.omo-moved-${process.pid}-${randomUUID()}`)
    await rename(target, moved)
    return moved
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined
    throw error
  }
}

export async function restoreMovedWorktreeFile(root: string, path: string, moved: string): Promise<boolean> {
  const target = join(root, path)
  try {
    await link(moved, target)
  } catch (error) {
    if (errorCode(error) === "EEXIST") return false
    throw error
  }
  await rm(moved)
  await syncDirectory(dirname(target))
  return true
}

export type WorktreeConditionalResult = boolean | string

export interface WorktreeDeletionFinalizer {
  readonly finish: () => Promise<WorktreeConditionalResult>
}

export interface WorktreeDeletionReservation {
  readonly verify: () => Promise<WorktreeDeletionFinalizer | undefined>
}

export async function reserveMovedWorktreeDeletion(
  root: string,
  path: string,
  moved: string,
  restoreClaimed: (claimed: string) => Promise<true | string>,
): Promise<WorktreeDeletionReservation | undefined> {
  const target = join(root, path)
  const marker = randomUUID()
  try {
    await mkdir(target, { mode: 0o700 })
    await writeFile(join(target, ".omo-reservation"), marker, "utf8")
  } catch (error) {
    if (errorCode(error) === "EEXIST") return undefined
    throw error
  }
  const reserved = await lstat(target)
  return {
    verify: async () => {
      let current
      try {
        current = await lstat(target)
      } catch (error) {
        if (errorCode(error) === "ENOENT") return undefined
        throw error
      }
      if (!current.isDirectory() || current.dev !== reserved.dev || current.ino !== reserved.ino) return undefined
      try {
        if (await readFile(join(target, ".omo-reservation"), "utf8") !== marker) return undefined
      } catch (error) {
        if (errorCode(error) === "ENOENT") return undefined
        throw error
      }
      return {
        finish: async () => {
          const claimed = join(dirname(target), `.${basename(target)}.omo-reserved-${process.pid}-${randomUUID()}`)
          try {
            await rename(target, claimed)
          } catch (error) {
            if (errorCode(error) === "ENOENT") return false
            throw error
          }
          const owned = await lstat(claimed)
          let ownedMarker: string | undefined
          if (owned.isDirectory()) {
            try {
              ownedMarker = await readFile(join(claimed, ".omo-reservation"), "utf8")
            } catch (error) {
              if (errorCode(error) !== "ENOENT") throw error
            }
          }
          if (!owned.isDirectory() || owned.dev !== reserved.dev || owned.ino !== reserved.ino || ownedMarker !== marker) {
            const restored = await restoreClaimed(claimed)
            return restored === true ? false : restored
          }
          await rm(moved)
          await rm(claimed, { recursive: true })
          await syncDirectory(dirname(target))
          try {
            await lstat(target)
            return false
          } catch (error) {
            if (errorCode(error) === "ENOENT") return true
            throw error
          }
        },
      }
    },
  }
}

export async function restoreClaimedWorktreeFile(
  root: string,
  path: string,
  claimed: string,
): Promise<true | string> {
  const stat = await lstat(claimed)
  if (!stat.isFile()) return claimed
  try {
    await link(claimed, join(root, path))
  } catch (error) {
    if (errorCode(error) === "EEXIST") return claimed
    throw error
  }
  await rm(claimed)
  return true
}

export async function discardMovedWorktreeFile(moved: string): Promise<void> {
  await rm(moved, { force: true })
}

export async function removeWorktreeFile(root: string, path: string): Promise<void> {
  const target = join(root, path)
  await assertSafeParents(root, path)
  let stat
  try {
    stat = await lstat(target)
  } catch (error) {
    if (errorCode(error) === "ENOENT") return
    throw error
  }
  if (!stat.isFile()) throw unsupportedWorktree(path, stat.isSymbolicLink() ? "symlink" : "non-file")
  await rm(target)
  await syncDirectory(dirname(target))
}

export async function assertSafeParents(root: string, path: string): Promise<void> {
  const parts = path.split("/").slice(0, -1)
  let current = root
  for (const part of parts) {
    current = join(current, part)
    try {
      const stat = await lstat(current)
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw unsupportedWorktree(path, "unsafe parent")
    } catch (error) {
      if (errorCode(error) === "ENOENT") return
      throw error
    }
  }
}

export function unsupportedWorktree(path: string, kind: string): GitPathStateError {
  return new GitPathStateError(`Unsupported worktree ${kind} at path: ${path}`)
}

export function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined
}

async function assertReplaceableTarget(path: string): Promise<void> {
  try {
    const stat = await lstat(path)
    if (!stat.isFile()) throw unsupportedWorktree(path, stat.isSymbolicLink() ? "symlink" : "non-file")
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error
  }
}

async function syncDirectory(path: string): Promise<void> {
  try {
    const directory = await open(path, "r")
    try {
      await directory.sync()
    } finally {
      await directory.close()
    }
  } catch (error) {
    if (process.platform !== "win32" || !["EISDIR", "EPERM", "EACCES", "EINVAL"].includes(errorCode(error) ?? "")) throw error
  }
}
