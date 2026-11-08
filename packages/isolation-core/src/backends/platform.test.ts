test("btrfs snapshots a subvolume whose st_dev differs from the parent directory", async () => {
  const f = await paths()
  const { io, calls } = fake({ device: async (path) => (path === f.repoRoot ? 7 : 9) })
  const backend = new BtrfsBackend(io)
  await backend.start(f.repoRoot, f.merged, f.ctx)
  expect(calls).toContainEqual(["btrfs", "subvolume", "snapshot", f.repoRoot, f.merged])
})

import { afterEach, expect, test } from "bun:test"
import { randomBytes } from "node:crypto"
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { BACKEND_FILE, IsolationUnavailableError } from "../backend"
import { BtrfsBackend } from "./btrfs"
import { ZfsBackend } from "./zfs"
import { OverlayfsBackend } from "./overlayfs"
import { ReflinkBackend } from "./reflink"
import { BlockCloneBackend, duplicateExtents, type WindowsCloneApi } from "./block-clone"
import { runtime, type BackendRuntime } from "./runtime"

function fake(overrides: Partial<BackendRuntime> = {}) {
  const calls: string[][] = []
  const io: BackendRuntime = { ...runtime, platform: "linux", which: () => true,
    run: async (argv) => { calls.push(argv); return { code: 0, stdout: "", stderr: "" } },
    device: async () => 1, accessible: async () => true,
    mounted: async () => false, waitMounted: async () => {}, ...overrides }
  return { io, calls }
}
const posixRoots: string[] = []
afterEach(async () => {
  await Promise.all(posixRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function paths() {
  // The Linux-only CLI contracts in this file speak POSIX paths: a win32
  // temp root carries the drive colon and backslashes that overlayfs rejects
  // as option separators and the zfs dataset parse never matches. The fakes
  // run against a POSIX-form root instead; the real filesystem resolves it
  // drive-relative on win32, so marker and sentinel files are still real.
  const root = `/tmp/isolation-core-posix-${randomBytes(6).toString("hex")}`
  posixRoots.push(root)
  const baseDir = `${root}/creating`, repoRoot = `${root}/repo`
  await mkdir(baseDir, { recursive: true })
  await mkdir(repoRoot, { recursive: true })
  return { root, homeDir: `${root}/home`, repoRoot, baseDir, merged: `${baseDir}/m`, ctx: { id: "test", baseDir, crossDevice: false } }
}

test("btrfs checks binary and subvolume then snapshots/deletes with argv", async () => {
  const f = await paths(), { io, calls } = fake()
  const backend = new BtrfsBackend(io)
  expect((await backend.probe(f.repoRoot)).available).toBe(true)
  await backend.start(f.repoRoot, f.merged, f.ctx)
  await mkdir(f.merged)
  await backend.stop(f.merged)
  expect(calls).toEqual([
    ["btrfs", "subvolume", "show", f.repoRoot],
    ["btrfs", "subvolume", "show", f.repoRoot],
    ["btrfs", "subvolume", "snapshot", f.repoRoot, f.merged],
    ["btrfs", "subvolume", "delete", f.merged],
  ])
  expect(JSON.parse(await readFile(join(f.baseDir, BACKEND_FILE), "utf8"))).toEqual({ backend: "btrfs", started_at: expect.any(String) })
  for (const override of [{ platform: "darwin" as const }, { which: () => false }, { run: async () => ({ code: 1, stdout: "", stderr: "not a subvolume" }) }]) {
    expect((await new BtrfsBackend(fake(override).io).probe(f.repoRoot)).available).toBe(false)
  }
  await expect(backend.start(f.repoRoot, f.merged, { ...f.ctx, crossDevice: true })).rejects.toBeInstanceOf(IsolationUnavailableError)
  // A subvolume reports its own st_dev, so differing devices are not a
  // cross-device signal here; the CLI failure classifier owns that verdict.
  await new BtrfsBackend(fake({ device: async (p) => p === f.repoRoot ? 1 : 2 }).io).start(f.repoRoot, f.merged, f.ctx)
})

test("zfs dataset-root probe, snapshot/clone, relocation and restart-safe stop", async () => {
  const f = await paths(), calls: string[][] = []
  const { io } = fake({ run: async (argv) => {
    calls.push(argv)
    return { code: 0, stdout: argv[1] === "list" ? `pool/repo\t${f.repoRoot}\n` : "", stderr: "" }
  } })
  expect((await new ZfsBackend(io).probe(join(f.repoRoot, "subdir"))).available).toBe(false)
  expect((await new ZfsBackend(fake({ which: () => false }).io).probe(f.repoRoot)).available).toBe(false)
  const backend = new ZfsBackend(io)
  await backend.start(f.repoRoot, f.merged, f.ctx)
  await mkdir(f.merged)
  const final = join(f.root, "final")
  await backend.relocate(f.baseDir, final)
  await new ZfsBackend(io).stop(join(final, "m"))
  expect(calls.slice(-5)).toEqual([
    ["zfs", "snapshot", "pool/repo@omo-test"],
    ["zfs", "clone", "-o", `mountpoint=${f.merged}`, "pool/repo@omo-test", "pool/repo/omo-test"],
    ["zfs", "set", `mountpoint=${join(final, "m")}`, "pool/repo/omo-test"],
    ["zfs", "destroy", "-r", "pool/repo/omo-test"],
    ["zfs", "destroy", "pool/repo@omo-test"],
  ])
})

test("overlay relocates by unmount, parent rename, remount with new upper/work paths", async () => {
  const f = await paths(), { io, calls } = fake({ mounted: async () => true })
  const backend = new OverlayfsBackend(io)
  await backend.start(f.repoRoot, f.merged, f.ctx)
  // POSIX-literal relocation target: win32 join() would re-separate it and the
  // mount-option guard (correctly) rejects backslashes in overlay paths.
  const final = `${f.root}/final`
  await backend.relocate(f.baseDir, final)
  await backend.stop(join(final, "m"))
  expect(calls).toEqual([
    ["fuse-overlayfs", "-o", `lowerdir=${f.repoRoot},upperdir=${join(f.baseDir, "upper")},workdir=${join(f.baseDir, "work")}`, join(f.baseDir, "m")],
    ["fusermount3", "-u", join(f.baseDir, "m")],
    ["fuse-overlayfs", "-o", `lowerdir=${f.repoRoot},upperdir=${join(final, "upper")},workdir=${join(final, "work")}`, join(final, "m")],
    ["fusermount3", "-u", join(final, "m")],
  ])
  for (const override of [{ which: () => false }, { accessible: async () => false }, { platform: "darwin" as const }]) {
    expect((await new OverlayfsBackend(fake(override).io).probe(f.repoRoot)).available).toBe(false)
  }
})

test("overlay unmount failure retries three times and leaves source untouched", async () => {
  const f = await paths(), { io, calls } = fake({ mounted: async () => true,
    run: async (argv) => { calls.push(argv); return { code: argv[0] === "fusermount3" ? 1 : 0, stdout: "", stderr: "busy" } } })
  const backend = new OverlayfsBackend(io)
  await backend.start(f.repoRoot, f.merged, f.ctx)
  await writeFile(join(f.merged, "sentinel"), "untouched")
  await expect(backend.relocate(f.baseDir, `${f.root}/final`)).rejects.toThrow("busy")
  expect(calls.filter((argv) => argv[0] === "fusermount3")).toHaveLength(3)
  expect(await readFile(join(f.merged, "sentinel"), "utf8")).toBe("untouched")
  await expect(access(join(f.root, "final"))).rejects.toThrow()
})

test("reflink ffi unavailable selects cp argv and classifies only unsupported failures", async () => {
  const f = await paths(), { io, calls } = fake()
  const backend = new ReflinkBackend(io, async () => undefined)
  expect((await backend.probe(f.repoRoot, f.ctx)).available).toBe(true)
  await backend.start(f.repoRoot, f.merged, f.ctx)
  expect(calls.at(-1)).toEqual(["cp", "-a", "--reflink=always", f.repoRoot, f.merged])
  for (const stderr of ["failed to clone", "Operation not supported", "Invalid cross-device link", "permission denied"]) {
    const bad = new ReflinkBackend(fake({ run: async () => ({ code: 1, stdout: "", stderr }) }).io, async () => undefined)
    let failure: unknown
    try { await bad.start(f.repoRoot, f.merged, f.ctx) } catch (error) { failure = error }
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toContain(stderr)
    expect(failure instanceof IsolationUnavailableError).toBe(stderr !== "permission denied")
  }
})

test("reflink probe rejects EOPNOTSUPP and disables start", async () => {
  const f = await paths(), { io } = fake()
  const unsupported = new ReflinkBackend(io, async () => ({ ioctl: () => -1, errno: () => 95 }))
  expect((await unsupported.probe(f.repoRoot, f.ctx)).available).toBe(false)
  await writeFile(join(f.repoRoot, "data"), "source")
  await expect(unsupported.start(f.repoRoot, f.merged, f.ctx)).rejects.toBeInstanceOf(IsolationUnavailableError)
  await expect(access(f.merged)).rejects.toThrow()
})

test("ReFS probe rejects non-Windows, missing binary and wrong filesystem", async () => {
  const f = await paths()
  for (const overrides of [{}, { platform: "win32" as const, which: () => false }, { platform: "win32" as const }]) {
    expect((await new BlockCloneBackend(fake(overrides).io).probe(f.repoRoot)).available).toBe(false)
  }
})

test("ReFS duplicate extents uses aligned range, allocated EOF and closes native handles", async () => {
  const calls: unknown[][] = []
  const api: WindowsCloneApi = {
    open: (path, write) => { calls.push(["open", path, write]); return write ? 2 : 1 },
    resize: (handle, size) => { calls.push(["resize", handle, size]) },
    duplicate: (dst, src, bytes) => { calls.push(["ioctl", dst, src, 0x00098344, bytes]) },
    close: (handle) => { calls.push(["close", handle]) },
    clusterSize: () => 4096,
  }
  await duplicateExtents(api, "C:\\repo\\src", "C:\\out\\dst", 8192)
  expect(calls).toEqual([
    ["open", "\\\\?\\C:\\repo\\src", false], ["open", "\\\\?\\C:\\out\\dst", true],
    ["resize", 2, 8192], ["ioctl", 2, 1, 0x00098344, 8192], ["resize", 2, 8192], ["close", 2], ["close", 1],
  ])
})


test("zfs failed relocation restores the source parent and marker identity", async () => {
  const f = await paths(), calls: string[][] = []
  const { io } = fake({ run: async (argv) => {
    calls.push(argv)
    return { code: argv[1] === "set" ? 1 : 0, stdout: argv[1] === "list" ? `pool/repo\t${f.repoRoot}\n` : "", stderr: "mount busy" }
  } })
  const backend = new ZfsBackend(io)
  await backend.start(f.repoRoot, f.merged, f.ctx)
  await mkdir(f.merged)
  await writeFile(join(f.merged, "sentinel"), "untouched")
  const final = join(f.root, "final")
  await expect(backend.relocate(f.baseDir, final)).rejects.toThrow("mount busy")
  expect(await readFile(join(f.merged, "sentinel"), "utf8")).toBe("untouched")
  expect(JSON.parse(await readFile(join(f.baseDir, BACKEND_FILE), "utf8")).dataset).toBe("pool/repo/omo-test")
  await expect(access(final)).rejects.toThrow()
  expect(calls.at(-1)).toEqual(["zfs", "set", `mountpoint=${join(final, "m")}`, "pool/repo/omo-test"])
})

test("zfs clone failure leaves a snapshot marker that restart-safe stop reclaims", async () => {
  const f = await paths(), calls: string[][] = []
  const { io } = fake({ run: async (argv) => {
    calls.push(argv)
    return { code: argv[1] === "clone" ? 1 : 0, stdout: argv[1] === "list" ? `pool/repo\t${f.repoRoot}\n` : "", stderr: "clone failed" }
  } })
  await expect(new ZfsBackend(io).start(f.repoRoot, f.merged, f.ctx)).rejects.toThrow("clone failed")
  await new ZfsBackend(io).stop(f.merged)
  expect(calls.at(-1)).toEqual(["zfs", "destroy", "pool/repo@omo-test"])
  expect(calls.some((argv) => argv[1] === "destroy" && argv[2] === "-r")).toBe(false)
})

test("cp unsupported stderr with exit 2 remains a generic error", async () => {
  const f = await paths()
  const backend = new ReflinkBackend(fake({ run: async () => ({ code: 2, stdout: "", stderr: "failed to clone" }) }).io, async () => undefined)
  let failure: unknown
  try { await backend.start(f.repoRoot, f.merged, f.ctx) } catch (error) { failure = error }
  expect(failure).toBeInstanceOf(Error)
  expect(failure instanceof IsolationUnavailableError).toBe(false)
  expect((failure as Error).message).toContain("cp exited 2")
})


test("missing cp probe cannot leave the fallback tier enabled", async () => {
  const f = await paths(), { io, calls } = fake({ which: () => false })
  const backend = new ReflinkBackend(io, async () => undefined)
  expect((await backend.probe(f.repoRoot)).available).toBe(false)
  await expect(backend.start(f.repoRoot, f.merged, f.ctx)).rejects.toBeInstanceOf(IsolationUnavailableError)
  expect(calls).toEqual([])
})

test("btrfs probe propagates unexpected subvolume-show failures", async () => {
  const f = await paths()
  const backend = new BtrfsBackend(fake({ run: async () => ({ code: 1, stdout: "", stderr: "Input/output error" }) }).io)
  await expect(backend.probe(f.repoRoot)).rejects.toThrow("Input/output error")
})

test("btrfs probe still classifies not-a-subvolume as unavailable", async () => {
  const f = await paths()
  const backend = new BtrfsBackend(fake({ run: async () => ({ code: 1, stdout: "", stderr: "Not a Btrfs subvolume: /x" }) }).io)
  expect((await backend.probe(f.repoRoot)).available).toBe(false)
})

test("zfs list failures other than missing pools propagate from the probe", async () => {
  const f = await paths()
  const backend = new ZfsBackend(fake({ run: async () => ({ code: 1, stdout: "", stderr: "Input/output error" }) }).io)
  await expect(backend.probe(f.repoRoot)).rejects.toThrow("Input/output error")
})

test("zfs snapshot permission failures fall through as unavailable", async () => {
  const f = await paths()
  const io = fake({ run: async (argv) => argv[1] === "list"
    ? { code: 0, stdout: "pool/repo\t" + f.repoRoot + "\n", stderr: "" }
    : { code: 1, stdout: "", stderr: "cannot create snapshot: permission denied" } }).io
  await expect(new ZfsBackend(io).start(f.repoRoot, f.merged, f.ctx)).rejects.toBeInstanceOf(IsolationUnavailableError)
})

test("zfs unexpected snapshot failures remain hard errors", async () => {
  const f = await paths()
  const io = fake({ run: async (argv) => argv[1] === "list"
    ? { code: 0, stdout: "pool/repo\t" + f.repoRoot + "\n", stderr: "" }
    : { code: 1, stdout: "", stderr: "internal error: Input/output error" } }).io
  let failure: unknown
  try { await new ZfsBackend(io).start(f.repoRoot, f.merged, f.ctx) } catch (error) { failure = error }
  expect(failure).toBeInstanceOf(Error)
  expect(failure instanceof IsolationUnavailableError).toBe(false)
})

test("ReFS probe classifies fsutil failures as unavailable so the walk can fall through", async () => {
  const backend = new BlockCloneBackend(fake({ platform: "win32" as const, run: async () => ({ code: 1, stdout: "", stderr: "The volume does not exist" }) }).io)
  // A probe-time CLI failure is a capability gap (missing volume, privileges,
  // transient fsutil error), never an operational failure: ensure's candidate
  // walk must fall through to the next backend with the reason recorded.
  const result = await backend.probe("C:\\repo")
  expect(result.available).toBe(false)
  expect(result.reason).toContain("volume does not exist")
})

test("overlayfs mount capability failures fall through as unavailable", async () => {
  const f = await paths()
  const io = fake({ run: async (argv) => argv[0] === "fuse-overlayfs"
    ? { code: 1, stdout: "", stderr: "fusermount3: failed to access /dev/fuse: Permission denied" }
    : { code: 0, stdout: "", stderr: "" } }).io
  await expect(new OverlayfsBackend(io).start(f.repoRoot, f.merged, f.ctx)).rejects.toBeInstanceOf(IsolationUnavailableError)
})

test("overlayfs unexpected mount failures remain hard errors", async () => {
  const f = await paths()
  const io = fake({ run: async (argv) => argv[0] === "fuse-overlayfs"
    ? { code: 1, stdout: "", stderr: "Input/output error" }
    : { code: 0, stdout: "", stderr: "" } }).io
  let failure: unknown
  try { await new OverlayfsBackend(io).start(f.repoRoot, f.merged, f.ctx) } catch (error) { failure = error }
  expect(failure).toBeInstanceOf(Error)
  expect(failure instanceof IsolationUnavailableError).toBe(false)
})

test("btrfs probe treats unprivileged B-tree search as inconclusive and lets start snapshot", async () => {
  const f = await paths()
  const calls: string[][] = []
  const io = fake({ run: async (argv) => {
    calls.push(argv)
    return argv[2] === "show"
      ? { code: 1, stdout: "", stderr: "ERROR: Could not search B-tree: Operation not permitted" }
      : { code: 0, stdout: "", stderr: "" }
  } }).io
  const backend = new BtrfsBackend(io)
  // The CLI cannot inspect subvolumes unprivileged; only attempting the
  // snapshot can decide, exactly like upstream's CLI-presence probe.
  expect((await backend.probe(f.repoRoot)).available).toBe(true)
  await backend.start(f.repoRoot, f.merged, f.ctx)
  expect(calls).toContainEqual(["btrfs", "subvolume", "snapshot", f.repoRoot, f.merged])
})

test("btrfs probe trusts the filesystem UUID over subvolume st_dev", async () => {
  const f = await paths()
  const io = fake({
    device: async (path) => (path === f.repoRoot ? 7 : 9), // a subvolume reports its own device
    run: async (argv) => {
      if (argv[0] === "btrfs" && argv[2] === "show") return { code: 0, stdout: "", stderr: "" }
      if (argv[0] === "findmnt" && argv[2] === "FSTYPE") return { code: 0, stdout: "btrfs\n", stderr: "" }
      if (argv[0] === "findmnt" && argv[2] === "UUID") return { code: 0, stdout: "uuid-same\n", stderr: "" }
      return { code: 0, stdout: "", stderr: "" }
    },
  }).io
  const backend = new BtrfsBackend(io)
  expect((await backend.probe(f.repoRoot, f.ctx)).available).toBe(true)
})

test("btrfs probe rejects a base directory on a different btrfs filesystem", async () => {
  const f = await paths()
  const io = fake({
    device: async () => 1, // st_dev alone would say "same device"
    run: async (argv) => {
      if (argv[0] === "btrfs" && argv[2] === "show") return { code: 0, stdout: "", stderr: "" }
      if (argv[0] === "findmnt" && argv[2] === "FSTYPE") return { code: 0, stdout: "btrfs\n", stderr: "" }
      if (argv[0] === "findmnt" && argv[2] === "UUID") {
        return { code: 0, stdout: argv[4] === f.repoRoot ? "uuid-a\n" : "uuid-b\n", stderr: "" }
      }
      return { code: 0, stdout: "", stderr: "" }
    },
  }).io
  const backend = new BtrfsBackend(io)
  expect((await backend.probe(f.repoRoot, f.ctx)).available).toBe(false)
})
