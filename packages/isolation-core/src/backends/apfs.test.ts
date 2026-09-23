import { expect, test } from "bun:test"
import { lstat, mkdir, readdir, readFile, symlink, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { once } from "node:events"
import { join } from "node:path"
import { ptr } from "bun:ffi"
import { ApfsBackend, cloneWithSymbols } from "./apfs"
import { IsolationUnavailableError } from "../backend"
import { repo } from "./git-fixture"
import { ensureIsolation, cleanupIsolation } from "../ensure"

async function withPlatform<T>(platform: NodeJS.Platform, fn: () => Promise<T>): Promise<T> {
  const saved = process.platform
  Object.defineProperty(process, "platform", { value: platform })
  try { return await fn() } finally { Object.defineProperty(process, "platform", { value: saved }) }
}

const mac = process.platform === "darwin" ? test : test.skip
mac("APFS clones 5000 files COW, skips FIFO/socket, and never follows entry symlinks", async () => {
  const { repoRoot: lower, root } = await repo()
  await writeFile(join(lower, "staged"), "stage")
  const { git } = await import("./git-fixture")
  await git(lower, "add", "staged")
  await writeFile(join(lower, "untracked"), "untracked")
  await writeFile(join(lower, "ignored"), "ignored")
  await symlink("tracked", join(lower, "link"))
  await mkdir(join(lower, "node_modules/.bin"), { recursive: true })
  await symlink("../../tracked", join(lower, "node_modules/.bin/x"))
  await mkdir(join(lower, "many"))
  for (let i = 0; i < 5000; i++) await writeFile(join(lower, "many", String(i)), `file ${i}`)
  const fifo = Bun.spawn(["mkfifo", join(lower, "fifo")])
  expect(await fifo.exited).toBe(0)
  const socket = createServer()
  const listening = once(socket, "listening", { signal: AbortSignal.timeout(5000) })
  socket.listen(join(lower, ".git/fsmonitor--daemon.ipc"))
  await listening
  try {
    const b = new ApfsBackend()
    expect((await b.probe(lower)).available).toBe(true)
    const merged = join(root, "merged")
    const start = performance.now()
    const result = await b.start(lower, merged, { id: "test", baseDir: root, crossDevice: false })
    console.log(`APFS 5000-file wall time: ${performance.now() - start} ms`)
    expect(result.strategy_detail).toBe("clone_tree")
    expect((await readdir(join(merged, "many"))).sort()).toEqual(Array.from({ length: 5000 }, (_, i) => String(i)).sort())
    for (const name of ["tracked", "staged", "untracked", "ignored", "many/4999"]) {
      expect(await readFile(join(merged, name), "utf8")).toBe(await readFile(join(lower, name), "utf8"))
    }
    for (const name of ["link", "node_modules/.bin/x"]) expect((await lstat(join(merged, name))).isSymbolicLink()).toBe(true)
    for (const name of ["fifo", ".git/fsmonitor--daemon.ipc"]) await expect(lstat(join(merged, name))).rejects.toMatchObject({ code: "ENOENT" })
    await writeFile(join(merged, "tracked"), "changed")
    expect(await readFile(join(lower, "tracked"), "utf8")).toBe("base\n")
    await expect(b.start(lower, merged, { id: "test", baseDir: root, crossDevice: false })).rejects.not.toBeInstanceOf(IsolationUnavailableError)
    await expect(b.start(lower, join(root, "cross"), { id: "test", baseDir: root, crossDevice: true })).rejects.toBeInstanceOf(IsolationUnavailableError)
    await b.stop(merged)
  } finally {
    await new Promise<void>((resolve, reject) => socket.close(error => error ? reject(error) : resolve()))
  }
}, 30_000)

mac("clonefile errno is read before strerror and classifies EXDEV versus EEXIST", async () => {
  for (const errno of [18, 17]) {
    const memory = new Int32Array([errno])
    const calls: string[] = []
    const symbols = {
      clonefile: (_src: Uint8Array, _dst: Uint8Array, flags: number) => { expect(flags).toBe(1); calls.push("clonefile"); return -1 },
      __error: () => { calls.push("__error"); return ptr(memory) },
      strerror: (value: number) => { expect(value).toBe(errno); calls.push("strerror"); return `errno ${value}` },
    }
    let error: unknown
    try { await cloneWithSymbols(symbols, "source", "destination") } catch (e) { error = e }
    expect(error).toBeInstanceOf(Error)
    expect(error instanceof IsolationUnavailableError).toBe(errno === 18)
    expect((error as Error).message).toContain(`errno ${errno}`)
    expect(calls).toEqual(["clonefile", "__error", "strerror"])
  }
})

mac("ensure removes stale snapshot locks before the git consistency probe", async () => {
  const { repoRoot, homeDir } = await repo()
  await writeFile(join(repoRoot, ".git/index.lock"), "stale")
  const h = await ensureIsolation({ repoRoot, homeDir, id: "apfs-lock", backends: [new ApfsBackend()] })
  await expect(lstat(join(h.mergedDir, ".git/index.lock"))).rejects.toMatchObject({ code: "ENOENT" })
  const { git } = await import("./git-fixture")
  expect(await git(h.mergedDir, "status", "--porcelain")).toBe("")
  await cleanupIsolation(h)
})

test("apfs loader failures other than a missing module propagate", async () => {
  // The darwin guard returns before the loader runs; exercise the loader
  // classification on every platform by stubbing the platform for the probe.
  const backend = new ApfsBackend(async () => { throw new Error("dlopen exploded") })
  let failure: unknown
  await withPlatform("darwin", async () => {
    try { await backend.probe("unused") } catch (error) { failure = error }
  })
  expect(failure).toBeInstanceOf(Error)
  expect(failure instanceof IsolationUnavailableError).toBe(false)
})

test("apfs treats a missing bun:ffi module as unavailable", async () => {
  const backend = new ApfsBackend(async () => {
    throw Object.assign(new Error("Cannot find module 'bun:ffi'"), { code: "ERR_UNKNOWN_BUILTIN_MODULE" })
  })
  await withPlatform("darwin", async () => {
    await expect(backend.probe("unused")).rejects.toBeInstanceOf(IsolationUnavailableError)
  })
})
