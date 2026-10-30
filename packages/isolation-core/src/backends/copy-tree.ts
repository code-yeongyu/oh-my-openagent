import { chmod, lstat, lutimes, mkdir, readdir, readlink, statfs, symlink, utimes } from "node:fs/promises"
import { isAbsolute, join, relative, resolve } from "node:path"
import { IsolationUnavailableError } from "../backend"

export async function copyBudget(base: string, max = 2 * 1024 ** 3,
  space: (path: string) => Promise<{ bavail: number; bsize: number }> = statfs,
): Promise<(size: number) => void> {
  const { bavail, bsize } = await space(base)
  const available = bavail * bsize
  let bytes = 0
  return (size) => {
    bytes += size
    if (bytes > max) throw new IsolationUnavailableError(`copy size ${bytes} bytes exceeds maxCopyBytes ${max}`)
    if (bytes + Math.ceil(bytes / 10) > available) throw new IsolationUnavailableError("insufficient free space")
  }
}

export async function copyTree(source: string, destination: string,
  clone: (source: string, destination: string, size: number) => Promise<void>,
  consume: (size: number) => void,
): Promise<void> {
  // The volume walk can place the destination inside the source (a subvolume
  // repository root reports its own st_dev). Never descend into the tree this
  // copy is itself producing, or the walk chases its own output forever.
  return copyTreeSkipping(source, destination, clone, consume, resolve(destination))
}

async function copyTreeSkipping(source: string, destination: string,
  clone: (source: string, destination: string, size: number) => Promise<void>,
  consume: (size: number) => void,
  skipRoot: string,
): Promise<void> {
  const info = await lstat(source)
  if (info.isSymbolicLink()) {
    await symlink(await readlink(source), destination)
    await lutimes(destination, info.atime, info.mtime)
    return
  }
  if (info.isDirectory()) {
    await mkdir(destination)
    for (const entry of await readdir(source)) {
      const child = join(source, entry)
      if (isAtOrBelow(child, skipRoot)) continue
      await copyTreeSkipping(child, join(destination, entry), clone, consume, skipRoot)
    }
  } else if (info.isFile()) {
    consume(info.size)
    await clone(source, destination, info.size)
  } else return // sockets, FIFOs and devices are not copyable state
  await chmod(destination, info.mode)
  await utimes(destination, info.atime, info.mtime)
}

export function isAtOrBelow(path: string, root: string): boolean {
  const resolved = resolve(path)
  const rel = relative(root, resolved)
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
}
