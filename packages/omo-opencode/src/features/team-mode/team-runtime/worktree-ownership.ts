import { randomUUID } from "node:crypto"
import { lstat, mkdir, open, readFile, realpath, rm, writeFile } from "node:fs/promises"
import path from "node:path"

const OWNER_MARKER_SUFFIX = ".omo-team-owner.json"
const ROOT_MARKER_NAME = ".omo-team-owner.json"

export type WorktreeOwnership = {
  readonly ownedWorktreeRoot: string
  readonly worktreeOwnershipToken: string
  readonly worktreeCanonicalPath: string
}

type OwnershipMarker = {
  readonly version: 1
  readonly token: string
  readonly canonicalPath: string
}

export class WorktreeOwnershipConflictError extends Error {
  constructor(directory: string) {
    super(`Worktree '${directory}' already has an active Team Mode owner.`)
    this.name = "WorktreeOwnershipConflictError"
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code
}

function getOwnerMarkerPath(directory: string): string {
  return `${directory}${OWNER_MARKER_SUFFIX}`
}

function getRootMarkerPath(directory: string): string {
  return path.join(directory, ROOT_MARKER_NAME)
}

function serializeMarker(marker: OwnershipMarker): string {
  return `${JSON.stringify(marker)}\n`
}

function parseMarker(content: string): OwnershipMarker | undefined {
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch {
    return undefined
  }
  if (typeof value !== "object" || value === null) return undefined
  const record = value as Record<string, unknown>
  if (record.version !== 1 || typeof record.token !== "string" || typeof record.canonicalPath !== "string") {
    return undefined
  }
  return { version: 1, token: record.token, canonicalPath: record.canonicalPath }
}

async function hasRootMarker(directory: string): Promise<boolean> {
  try {
    await readFile(getRootMarkerPath(directory), "utf8")
    return true
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return false
    throw error
  }
}

export async function reserveOwnedWorktreeDirectory(
  worktreePath: string,
  projectRoot: string,
): Promise<{ readonly directory: string; readonly ownership?: WorktreeOwnership }> {
  const directory = path.isAbsolute(worktreePath) ? path.normalize(worktreePath) : path.resolve(projectRoot, worktreePath)
  const parentDirectory = path.dirname(directory)
  if (parentDirectory !== path.parse(directory).root) await mkdir(parentDirectory, { recursive: true })

  const ownerMarkerPath = getOwnerMarkerPath(directory)
  let ownerMarker
  try {
    ownerMarker = await open(ownerMarkerPath, "wx", 0o600)
  } catch (error) {
    if (hasErrorCode(error, "EEXIST")) throw new WorktreeOwnershipConflictError(directory)
    throw error
  }

  let createdDirectory = false
  try {
    try {
      await mkdir(directory)
      createdDirectory = true
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST")) throw error
      const metadata = await lstat(directory)
      if (metadata.isSymbolicLink()) throw new Error(`Worktree '${directory}' cannot be a symbolic link.`)
      if (!metadata.isDirectory()) throw error
      if (await hasRootMarker(directory)) throw new WorktreeOwnershipConflictError(directory)
      await ownerMarker.close()
      await rm(ownerMarkerPath, { force: true })
      return { directory }
    }

    const canonicalPath = await realpath(directory)
    const marker: OwnershipMarker = { version: 1, token: randomUUID(), canonicalPath }
    const markerContent = serializeMarker(marker)
    await ownerMarker.writeFile(markerContent)
    await ownerMarker.sync()
    await writeFile(getRootMarkerPath(directory), markerContent, { flag: "wx", mode: 0o600 })
    await ownerMarker.close()
    return {
      directory,
      ownership: {
        ownedWorktreeRoot: directory,
        worktreeOwnershipToken: marker.token,
        worktreeCanonicalPath: canonicalPath,
      },
    }
  } catch (error) {
    await ownerMarker.close().catch(() => undefined)
    if (createdDirectory) await rm(directory, { recursive: true, force: true }).catch(() => undefined)
    await rm(ownerMarkerPath, { force: true }).catch(() => undefined)
    throw error
  }
}

export async function removeOwnedWorktreeDirectory(
  ownership: Partial<WorktreeOwnership>,
): Promise<{ readonly removed: boolean; readonly error?: string }> {
  const { ownedWorktreeRoot, worktreeOwnershipToken, worktreeCanonicalPath } = ownership
  if (!ownedWorktreeRoot || !worktreeOwnershipToken || !worktreeCanonicalPath) {
    return { removed: false, error: "worktree ownership metadata is incomplete" }
  }

  try {
    const metadata = await lstat(ownedWorktreeRoot)
    if (metadata.isSymbolicLink()) return { removed: false, error: "owned worktree root is a symlink" }
    if (!metadata.isDirectory()) return { removed: false, error: "owned worktree root is not a directory" }
    const canonicalPath = await realpath(ownedWorktreeRoot)
    if (canonicalPath !== worktreeCanonicalPath) return { removed: false, error: "worktree canonical path does not match ownership metadata" }

    const expectedMarker = { version: 1, token: worktreeOwnershipToken, canonicalPath: worktreeCanonicalPath }
    const rootMarker = parseMarker(await readFile(getRootMarkerPath(ownedWorktreeRoot), "utf8"))
    const ownerMarker = parseMarker(await readFile(getOwnerMarkerPath(ownedWorktreeRoot), "utf8"))
    if (JSON.stringify(rootMarker) !== JSON.stringify(expectedMarker)
      || JSON.stringify(ownerMarker) !== JSON.stringify(expectedMarker)) {
      return { removed: false, error: "worktree ownership token marker does not match persisted metadata" }
    }

    await rm(ownedWorktreeRoot, { recursive: true })
    await rm(getOwnerMarkerPath(ownedWorktreeRoot))
    return { removed: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { removed: false, error: message }
  }
}

export async function removeOwnedWorktreeDirectories(
  ownershipRecords: ReadonlyArray<Partial<WorktreeOwnership>>,
): Promise<{ readonly removedWorktrees: string[]; readonly errors: string[] }> {
  const removedWorktrees: string[] = []
  const errors: string[] = []
  const seenRoots = new Set<string>()
  for (const ownership of ownershipRecords) {
    const root = ownership.ownedWorktreeRoot
    if (!root || seenRoots.has(root)) continue
    seenRoots.add(root)
    if (!ownership.worktreeOwnershipToken || !ownership.worktreeCanonicalPath) continue
    const result = await removeOwnedWorktreeDirectory(ownership)
    if (result.removed) removedWorktrees.push(root)
    if (result.error) errors.push(`worktree ${root}: ${result.error}`)
  }
  return { removedWorktrees, errors }
}
