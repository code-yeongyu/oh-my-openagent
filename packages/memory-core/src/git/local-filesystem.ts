import { statfs } from "../fs/resilient"

// omo #10604 review M2: an idle git-activity lock stands in for an unanswerable /proc scan only where
// flock is an open-file-description lock that git inherits. NFS, CIFS/SMB and FUSE emulate flock
// with process-scoped fcntl locks (or not at all): a SIGKILLed writer releases the lock while its
// orphaned git still runs. Linux reports the filesystem by magic number, so only known local ones
// qualify (an allowlist: an unknown filesystem never vouches).
const LINUX_LOCAL_FILESYSTEMS: ReadonlySet<number> = new Set([
  0xef53, // ext2/ext3/ext4
  0x58465342, // xfs
  0x9123683e, // btrfs
  0x01021994, // tmpfs
  0xf2f52010, // f2fs
  0x2fc12fc1, // zfs
  0x794c7630, // overlayfs
  0xca451a4e, // bcachefs
])

// darwin numbers filesystem types at registration, so the numbers are not stable across releases;
// the boot volume is always local, and a network or FUSE mount reports a different type.
export function isLocalFilesystemType(platform: NodeJS.Platform, type: number, rootType: number | undefined): boolean {
  if (platform === "linux") return LINUX_LOCAL_FILESYSTEMS.has(type)
  if (platform === "darwin") return rootType !== undefined && type === rootType
  return false
}

export async function isOnLocalFilesystem(path: string): Promise<boolean> {
  try {
    const { type } = await statfs(path)
    const rootType = process.platform === "darwin" ? (await statfs("/")).type : undefined
    return isLocalFilesystemType(process.platform, type, rootType)
  } catch {
    return false
  }
}
