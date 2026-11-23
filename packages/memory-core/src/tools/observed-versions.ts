import { createHash } from "node:crypto"
import { readFile, realpath } from "../fs/resilient"
import { validateMemoryPath } from "../memfs/paths"
import type { PatchOperation } from "./patch-parser"
import { MemoryStaleReadError } from "./tool-errors"

/** SHA-256 of the whole file, keyed by absolute path. Unobserved targets retain blind-write semantics. */
export type MemoryObservedVersions = ReadonlyMap<string, string>

export function memoryContentVersion(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex")
}

export async function staleRead(
  path: string,
  versions: MemoryObservedVersions | undefined,
): Promise<MemoryStaleReadError | undefined> {
  if (!versions?.size) return
  const expected = versions.get(path) ?? versions.get(await realpath(path).catch(() => path))
  if (expected === undefined) return
  let actual: string | null
  try {
    actual = memoryContentVersion(await readFile(path))
  } catch (error) {
    if (!(error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")))
      throw error
    actual = null
  }
  return actual === expected ? undefined : new MemoryStaleReadError(path, expected, actual)
}

export async function checkPatchVersions(
  root: string,
  operations: readonly PatchOperation[],
  versions: MemoryObservedVersions | undefined,
): Promise<void> {
  if (!versions?.size) return
  const paths = new Set<string>()
  for (const op of operations) {
    if (op.kind === "update") paths.add(validateMemoryPath(root, op.sourcePath))
    paths.add(validateMemoryPath(root, op.targetPath))
  }
  for (const path of paths) {
    const conflict = await staleRead(path, versions)
    if (conflict) throw conflict
  }
}
