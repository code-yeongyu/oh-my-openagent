import { expect, test } from "bun:test"
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { cleanupIsolation, ensureIsolation } from "../ensure"
import { BtrfsBackend } from "./btrfs"
import { ReflinkBackend } from "./reflink"
import { RcopyBackend } from "./rcopy"
import { OverlayfsBackend } from "./overlayfs"
import { ZfsBackend } from "./zfs"
import { BlockCloneBackend } from "./block-clone"
import { checked, runtime } from "./runtime"

const btrfsRoot = process.env.ISOLATION_TEST_BTRFS_ROOT
const dataset = process.env.ISOLATION_TEST_ZFS_DATASET
const ext4Root = process.env.ISOLATION_TEST_EXT4_ROOT
const refsRoot = process.env.ISOLATION_TEST_REFS_ROOT
const overlay = process.env.ISOLATION_TEST_OVERLAY === "1"
for (const [name, present] of [["btrfs/reflink/rcopy", btrfsRoot], ["zfs", dataset], ["overlayfs", overlay && btrfsRoot], ["ext4 unsupported probe", ext4Root], ["ReFS", refsRoot]]) {
  if (!present) console.log(`fs-integration ${name}: skipped (filesystem environment not configured)`)
}

async function roundtrip(root: string, kind: "btrfs" | "reflink" | "rcopy" | "overlayfs") {
  const base = await mkdtemp(join(root, "integration-")), lower = join(base, "repo"), homeDir = join(base, "home")
  await mkdir(homeDir)
  const btrfs = new BtrfsBackend()
  if (kind === "btrfs") await checked(runtime, ["btrfs", "subvolume", "create", lower])
  else await mkdir(lower)
  try {
    await mkdir(join(lower, "nested"))
    await writeFile(join(lower, "nested", "file"), "unchanged")
    const backends = [btrfs, new ReflinkBackend(), new OverlayfsBackend(), new RcopyBackend()]
    const handle = await ensureIsolation({ repoRoot: lower, homeDir, id: `integration-${kind}`, backends,
      preferred: kind === "btrfs" || kind === "reflink" ? "auto" : kind })
    try {
      expect(handle.backend).toBe(kind)
      expect(handle.baseDir).not.toContain(".creating-")
      // A subvolume may have its own st_dev, placing lifecycle metadata beneath
      // its root. Compare the entire fixture subtree, not changing PAL metadata.
      expect((await readdir(join(handle.mergedDir, "nested"), { recursive: true })).sort()).toEqual((await readdir(join(lower, "nested"), { recursive: true })).sort())
      expect(await readFile(join(handle.mergedDir, "nested", "file"), "utf8")).toBe("unchanged")
      await writeFile(join(handle.mergedDir, "nested", "file"), "sandbox")
      expect(await readFile(join(lower, "nested", "file"), "utf8")).toBe("unchanged")
    } finally { await cleanupIsolation(handle) }
    await expect(access(handle.baseDir)).rejects.toThrow()
    console.log(kind === "btrfs" ? "btrfs: start ok" : kind === "reflink" ? "reflink: FICLONE ok" : kind === "overlayfs" ? "overlayfs: mount ok" : "rcopy: ok")
  } finally {
    if (kind === "btrfs") await btrfs.stop(lower)
    await rm(base, { recursive: true, force: true })
  }
}
for (const kind of ["btrfs", "reflink", "rcopy"] as const) {
  test.skipIf(!btrfsRoot)(`fs-integration ${kind} publication, COW parity and teardown`, async () => roundtrip(btrfsRoot!, kind))
}
test.skipIf(!btrfsRoot || !overlay)("fs-integration overlayfs publication and teardown", async () => roundtrip(btrfsRoot!, "overlayfs"))

test.skipIf(!ext4Root)("fs-integration ext4 probe rejects EOPNOTSUPP", async () => {
  const lower = await mkdtemp(join(ext4Root!, "reflink-unsupported-"))
  try { expect((await new ReflinkBackend().probe(lower, { id: "ext4", baseDir: lower, crossDevice: false })).available).toBe(false) }
  finally { await rm(lower, { recursive: true, force: true }) }
})

test.skipIf(!dataset)("fs-integration zfs clone publication, COW and restart-safe teardown", async () => {
  const io = { ...runtime, run: (argv: string[]) => runtime.run(process.env.ISOLATION_TEST_ZFS_SUDO === "1" ? ["sudo", ...argv] : argv) }
  const result = await checked(io, ["zfs", "list", "-H", "-o", "mountpoint", dataset!])
  const lower = result.stdout.trim(), homeDir = join(lower, "home")
  await mkdir(homeDir, { recursive: true })
  await writeFile(join(lower, "content"), "lower")
  const handle = await ensureIsolation({ repoRoot: lower, homeDir, id: "integration-zfs", preferred: "zfs", backends: [new ZfsBackend(io)] })
  try {
    expect(handle.backend).toBe("zfs")
    expect(await readFile(join(handle.mergedDir, "content"), "utf8")).toBe("lower")
    await writeFile(join(handle.mergedDir, "content"), "merged")
    expect(await readFile(join(lower, "content"), "utf8")).toBe("lower")
    expect((await checked(io, ["zfs", "get", "-H", "-o", "value", "mountpoint", `${dataset}/omo-integration-zfs`])).stdout.trim()).toBe(handle.mergedDir)
  } finally {
    await new ZfsBackend(io).stop(handle.mergedDir)
    await rm(handle.baseDir, { recursive: true, force: true })
  }
  console.log("zfs: clone ok")
})


test.skipIf(!refsRoot)("fs-integration ReFS aligned extents, tails and publication", async () => {
  const root = await mkdtemp(join(refsRoot!, "refs-")), lower = join(root, "repo"), homeDir = join(root, "home")
  await mkdir(lower)
  await mkdir(homeDir)
  try {
    for (const size of [0, 5, 8192, 8195, 131075]) await writeFile(join(lower, String(size)), Buffer.alloc(size, 42))
    const handle = await ensureIsolation({ repoRoot: lower, homeDir, id: "refs", backends: [new BlockCloneBackend()], preferred: "block-clone" })
    try {
      expect(handle.backend).toBe("block-clone")
      expect((await readdir(handle.mergedDir)).sort()).toEqual((await readdir(lower)).sort())
      for (const size of [0, 5, 8192, 8195, 131075]) {
        const output = join(handle.mergedDir, String(size))
        expect(await readFile(output)).toEqual(Buffer.alloc(size, 42))
        await writeFile(output, "changed")
        expect(await readFile(join(lower, String(size)))).toEqual(Buffer.alloc(size, 42))
      }
    } finally { await cleanupIsolation(handle) }
    await expect(access(handle.baseDir)).rejects.toThrow()
    console.log("ReFS: block-clone ok")
  } finally { await rm(root, { recursive: true, force: true }) }
})
