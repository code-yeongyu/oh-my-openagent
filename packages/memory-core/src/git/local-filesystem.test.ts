import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"

import { isLocalFilesystemType, isOnLocalFilesystem } from "./local-filesystem"

// omo #10604 review M2: on NFS, CIFS/SMB and FUSE, flock is emulated with process-scoped locks that a
// git child does not inherit, so an idle git-activity lock there proves nothing about an orphaned git.
describe("only a local filesystem lets the git-activity lock vouch (omo #10604)", () => {
  test.each([
    ["ext4", 0xef53, true],
    ["xfs", 0x58465342, true],
    ["btrfs", 0x9123683e, true],
    ["tmpfs", 0x01021994, true],
    ["overlayfs", 0x794c7630, true],
    ["NFS", 0x6969, false],
    ["CIFS", 0xff534d42, false],
    ["SMB2", 0xfe534d42, false],
    ["FUSE", 0x65735546, false],
    ["an unknown filesystem", 0x12345678, false],
  ] as const)("#given Linux on %s #then vouching is %p", (_name, type, local) => {
    expect(isLocalFilesystemType("linux", type, undefined)).toBe(local)
  })

  test("#given darwin #then only the boot volume's filesystem type vouches", () => {
    expect(isLocalFilesystemType("darwin", 26, 26)).toBe(true)
    expect(isLocalFilesystemType("darwin", 31, 26)).toBe(false)
    expect(isLocalFilesystemType("darwin", 26, undefined)).toBe(false)
  })

  test("#given windows #then nothing vouches", () => {
    expect(isLocalFilesystemType("win32", 0xef53, 0xef53)).toBe(false)
  })

  test.skipIf(process.platform === "win32")("#given this host's temp directory #then it is on a local filesystem", async () => {
    expect(await isOnLocalFilesystem(tmpdir())).toBe(true)
  })
})
