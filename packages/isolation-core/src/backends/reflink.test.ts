import { expect, test } from "bun:test"
import { once } from "node:events"
import { createServer } from "node:net"
import { readFileSync, writeFileSync } from "node:fs"
import { access, chmod, lstat, mkdir, readFile, readdir, readlink, stat, symlink, utimes, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fixture } from "../test-fixture"
import { IsolationUnavailableError } from "../backend"
import { ReflinkBackend } from "./reflink"
import { runtime } from "./runtime"

test("FICLONE walks fd pairs, preserves metadata/symlinks and isolates writes", async () => {
  const f = await fixture(), merged = join(f.root, "merged")
  await mkdir(join(f.repoRoot, "dir"))
  await writeFile(join(f.repoRoot, "dir", "data"), "original")
  await chmod(join(f.repoRoot, "dir", "data"), 0o751)
  await utimes(join(f.repoRoot, "dir", "data"), 1234567890, 1234567890)
  await symlink("dir/data", join(f.repoRoot, "link"))
  const requests: number[] = []
  const backend = new ReflinkBackend({ ...runtime, platform: "linux" }, async () => ({
    ioctl: (dst, request, src) => { requests.push(request); writeFileSync(dst, readFileSync(src)); return 0 }, errno: () => 0,
  }))
  expect((await backend.probe(f.repoRoot, { id: "probe", baseDir: f.root, crossDevice: false })).available).toBe(true)
  await backend.start(f.repoRoot, merged, { id: "walk", baseDir: f.root, crossDevice: false })
  expect(requests).toEqual([0x40049409, 0x40049409])
  expect((await readdir(merged)).sort()).toEqual(["dir", "link"])
  // The walk recreates the stored target verbatim; its textual form is the
  // platform's own (win32 readlink returns backslash-separated targets).
  expect(await readlink(join(merged, "link"))).toBe(join("dir", "data"))
  expect((await lstat(join(merged, "link"))).isSymbolicLink()).toBe(true)
  expect((await stat(join(merged, "dir", "data"))).mtimeMs).toBe(1234567890000)
  if (process.platform !== "win32") expect((await stat(join(merged, "dir", "data"))).mode & 0o777).toBe(0o751)
  await writeFile(join(merged, "dir", "data"), "changed")
  expect(await readFile(join(f.repoRoot, "dir", "data"), "utf8")).toBe("original")
  await backend.stop(merged)
  await expect(access(merged)).rejects.toThrow()
})

test("first mid-walk EOPNOTSUPP aborts and removes all partial output", async () => {
  const f = await fixture(), merged = join(f.root, "merged")
  await writeFile(join(f.repoRoot, "a"), "a")
  await writeFile(join(f.repoRoot, "b"), "b")
  let clones = 0
  const backend = new ReflinkBackend({ ...runtime, platform: "linux" }, async () => ({
    ioctl: (dst, _request, src) => { if (++clones === 3) return -1; writeFileSync(dst, readFileSync(src)); return 0 }, errno: () => 95,
  }))
  expect((await backend.probe(f.repoRoot, { id: "probe", baseDir: f.root, crossDevice: false })).available).toBe(true)
  await expect(backend.start(f.repoRoot, merged, { id: "walk", baseDir: f.root, crossDevice: false })).rejects.toBeInstanceOf(IsolationUnavailableError)
  expect(clones).toBe(3)
  await expect(access(merged)).rejects.toThrow()
})

test("probe rejects a different target device without loading ffi", async () => {
  const f = await fixture()
  let loads = 0
  const backend = new ReflinkBackend({ ...runtime, platform: "linux", device: async (path) => path === f.repoRoot ? 1 : 2 }, async () => { loads++; return undefined })
  const result = await backend.probe(f.repoRoot, { id: "probe", baseDir: f.homeDir, crossDevice: false })
  expect(result.available).toBe(false)
  expect(loads).toBe(0)
})

test("failed probe disables direct start rather than retrying an unsupported ioctl", async () => {
  const f = await fixture()
  let clones = 0
  const backend = new ReflinkBackend({ ...runtime, platform: "linux" }, async () => ({ ioctl: () => { clones++; return -1 }, errno: () => 95 }))
  expect((await backend.probe(f.repoRoot, { id: "probe", baseDir: f.root, crossDevice: false })).available).toBe(false)
  await expect(backend.start(f.repoRoot, join(f.root, "merged"), { id: "probe", baseDir: f.root, crossDevice: false })).rejects.toBeInstanceOf(IsolationUnavailableError)
  expect(clones).toBe(1)
})


test("reflink byte ceiling aborts before cloning oversized input", async () => {
  const f = await fixture(), merged = join(f.root, "merged")
  await writeFile(join(f.repoRoot, "data"), "123456")
  let clones = 0
  const backend = new ReflinkBackend({ ...runtime, platform: "linux" }, async () => ({ ioctl: () => { clones++; return 0 }, errno: () => 0 }))
  expect((await backend.probe(f.repoRoot, { id: "probe", baseDir: f.root, crossDevice: false })).available).toBe(true)
  await expect(backend.start(f.repoRoot, merged, { id: "cap", baseDir: f.root, crossDevice: false, maxCopyBytes: 5 })).rejects.toThrow("6 bytes exceeds maxCopyBytes 5")
  expect(clones).toBe(1)
  await expect(access(merged)).rejects.toThrow()
})


test.skipIf(process.platform === "win32")("reflink walk skips sockets and FIFOs rather than opening them", async () => {
  const f = await fixture(), merged = join(f.root, "merged")
  const fifo = await runtime.run(["mkfifo", join(f.repoRoot, "fifo")])
  expect(fifo.code).toBe(0)
  await writeFile(join(f.repoRoot, "data"), "source")
  const server = createServer()
  const listening = once(server, "listening", { signal: AbortSignal.timeout(5000) })
  server.listen(join(f.repoRoot, "sock"))
  await listening
  try {
    let clones = 0
    const backend = new ReflinkBackend({ ...runtime, platform: "linux" }, async () => ({
      ioctl: (dst, _request, src) => { clones++; writeFileSync(dst, readFileSync(src)); return 0 }, errno: () => 0,
    }))
    await backend.start(f.repoRoot, merged, { id: "special", baseDir: f.root, crossDevice: false })
    expect((await readdir(merged)).sort()).toEqual(["data"])
    expect(clones).toBe(2)
  } finally {
    const closed = once(server, "close", { signal: AbortSignal.timeout(5000) })
    server.close()
    await closed
  }
})
