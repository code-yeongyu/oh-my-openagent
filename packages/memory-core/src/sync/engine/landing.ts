// Whether a received key can land in this device's working tree, decided before its render record
// is written (#12147, apply.ts invariants 2-4). A key the grammar accepts can still be unusable
// here: it names an existing directory, sits under a file, is longer than any path this OS opens,
// has two on-disk spellings here, or its path goes through or names a symlink (inside the root or
// not, dangling or not: git refuses to stage a path beyond one, so landing it would wedge). Such a key is
// refused for this device with the file-system reason, never thrown, because a throw inside the
// render would leave the durable cycle record failing on every resume.

import { dirname, isAbsolute, join, relative, sep } from "node:path"

import { existsSync, lstat, mkdir, readFile, realpath } from "../../fs/resilient"
import { caseFold } from "../item/casefold"

const FS_REFUSALS = new Set(["EISDIR", "ENOTDIR", "ENAMETOOLONG", "EACCES", "EPERM", "ELOOP", "EEXIST", "EINVAL"])

/** The error code when `error` says a path cannot be used on this device, else null. */
export function fsRefusal(error: unknown): string | null {
  if (!(error instanceof Error) || !("code" in error) || typeof error.code !== "string") return null
  return FS_REFUSALS.has(error.code) ? error.code : null
}

export const readWorking = (root: string, path: string): Promise<string | null> =>
  readFile(join(root, path), "utf8").catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null
    throw error
  })

type Landing = { readonly path: string; readonly working: string | null } | { readonly refused: string }

const missing = (error: unknown): boolean =>
  error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")

/** Whether a component of `path` that exists under `root`, the last one included, is a symlink. */
export async function throughSymlink(root: string, path: string): Promise<boolean> {
  let at = root
  for (const segment of path.split("/")) {
    at = join(at, segment)
    const entry = await lstat(at).catch((error: unknown) => {
      if (missing(error)) return null
      throw error
    })
    if (entry === null) return false
    if (entry.isSymbolicLink()) return true
  }
  return false
}

const nearestExisting = (root: string, dir: string): string => {
  let at = dir
  while (at !== root && !existsSync(at)) at = dirname(at)
  return at
}

const staysInside = (root: string, target: string): boolean => {
  const rel = relative(root, target)
  if (rel === "") return true
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return false
  return caseFold(rel.split(sep)[0] ?? "").replace(/[. ]+$/, "") !== ".git"
}

/** The working text at a key's on-disk `path` (null: ambiguous), after its parent directory exists inside the root. */
export async function prepareLanding(root: string, path: string | null): Promise<Landing> {
  if (path === null) return { refused: "ambiguous-normalization" }
  const target = join(root, path)
  try {
    if (await throughSymlink(root, path)) return { refused: "symlink" }
    const realRoot = await realpath(root)
    const parent = await realpath(nearestExisting(root, dirname(target)))
    if (!staysInside(realRoot, parent)) return { refused: "outside-root" }
    const working = await readWorking(root, path)
    await mkdir(dirname(target), { recursive: true })
    return { path, working }
  } catch (error) {
    const code = fsRefusal(error)
    if (code === null) throw error
    return { refused: code.toLowerCase() }
  }
}
