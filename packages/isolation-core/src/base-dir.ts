import { createHash } from "node:crypto"
import { mkdir, mkdtemp, rmdir, stat } from "node:fs/promises"
import { dirname, join, resolve, sep } from "node:path"

export interface BaseDirIO {
  stat(path: string): Promise<{ readonly dev: number }>
  writable(path: string): Promise<boolean>
}

const filesystem: BaseDirIO = {
  stat,
  async writable(path) {
    try {
      await mkdir(path, { recursive: true })
      const probe = await mkdtemp(join(path, ".probe-"))
      await rmdir(probe)
      return true
    } catch (error) {
      if (error instanceof Error && "code" in error
        && (error.code === "EACCES" || error.code === "EPERM" || error.code === "EROFS")) return false
      throw error
    }
  },
}

export interface BaseDirSelection {
  readonly baseDir: string
  readonly crossDevice: boolean
}

export async function chooseBaseDir(
  repoRoot: string,
  homeDir: string,
  id = "",
  io: BaseDirIO = filesystem,
): Promise<BaseDirSelection> {
  const segment = `t${createHash("sha1").update(repoRoot + id).digest("hex").slice(0, 10)}`
  const homeBase = join(homeDir, ".omo", "wt", segment)
  const repoDevice = (await io.stat(repoRoot)).dev
  let homeParent = join(homeDir, ".omo")
  let homeDevice: number
  for (;;) {
    try {
      homeDevice = (await io.stat(homeParent)).dev
      break
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
      const parent = dirname(homeParent)
      if (parent === homeParent) throw error
      homeParent = parent
    }
  }
  if (repoDevice === homeDevice) return { baseDir: homeBase, crossDevice: false }
  let volumeRoot = resolve(repoRoot)
  let referenceDevice = repoDevice
  // A subvolume or bind-mount repository root reports its own st_dev, so the
  // same-device walk would stop AT the repository itself and place the sandbox
  // inside the very tree the backends clone. When the parent is writable, the
  // repository is nested inside the parent's filesystem (btrfs subvolume, zfs
  // dataset): adopt the parent's device and continue the walk from there.
  {
    const parent = dirname(volumeRoot)
    if (parent !== volumeRoot) {
      const parentStat = await io.stat(parent)
      if (parentStat.dev !== repoDevice && await io.writable(parent)) {
        volumeRoot = parent
        referenceDevice = parentStat.dev
      }
    }
  }
  while (dirname(volumeRoot) !== volumeRoot) {
    const parent = dirname(volumeRoot)
    if ((await io.stat(parent)).dev !== referenceDevice) break
    volumeRoot = parent
  }
  const volumeBase = join(volumeRoot, ".omo-wt")
  // Hard boundary: whatever the walk produced, the sandbox must never live
  // inside the repository being isolated.
  const repository = resolve(repoRoot)
  const insideRepository = volumeBase === repository || volumeBase.startsWith(repository + sep)
  if (!insideRepository && await io.writable(volumeBase)) return { baseDir: join(volumeBase, segment), crossDevice: false }
  return { baseDir: homeBase, crossDevice: true }
}
