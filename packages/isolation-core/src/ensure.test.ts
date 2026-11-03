import { expect, test } from "bun:test"
import { access, cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { IsolationUnavailableError } from "./backend"
import { chooseBaseDir } from "./base-dir"
import { cleanupIsolation, ensureIsolation, retainIsolation } from "./ensure"
import { backend, fixture } from "./test-fixture"
import { repo } from "./backends/git-fixture"

test("writes marker before start and publishes only a complete directory", async () => {
  const f = await fixture()
  const before = Date.now()
  const { baseDir } = await chooseBaseDir(f.repoRoot, f.homeDir, "one")
  const handle = await ensureIsolation({ ...f, id: "one", preferred: "rcopy", backends: [backend({
    start: async (_lower, merged) => {
      const marker = JSON.parse(await readFile(join(dirname(merged), ".omo-isolation-owner.json"), "utf8"))
      expect(marker.id).toBe("one")
      expect(await access(baseDir).then(() => true, () => false)).toBe(false)
      await mkdir(merged)
      await writeFile(join(merged, "result"), "ready")
    },
  })] })
  expect(handle.baseDir).toBe(baseDir)
  expect(handle.mergedDir).toBe(join(baseDir, "m"))
  expect(handle.baseDir).not.toContain(".creating-")
  expect(await readFile(join(handle.mergedDir, "result"), "utf8")).toBe("ready")
  const marker = JSON.parse(await readFile(join(baseDir, ".omo-isolation-backend.json"), "utf8"))
  expect(marker).toEqual({ backend: "rcopy", started_at: expect.any(String) })
  const started = Date.parse(marker.started_at)
  expect(Number.isFinite(started)).toBe(true)
  expect(started).toBeGreaterThanOrEqual(before)
  expect(started).toBeLessThanOrEqual(Date.now())
})
test("unavailable start falls through and preserves the reason", async () => {
  const f = await fixture()
  const handle = await ensureIsolation({ ...f, id: "one", platform: "darwin", backends: [
    backend({ kind: "apfs", start: async () => { throw new IsolationUnavailableError("no clone support") } }),
    backend(),
  ] })
  expect(handle.backend).toBe("rcopy")
  expect(handle.fellBack).toBe(true)
  expect(handle.fallbackReason).toContain("no clone support")
  expect(await readdir(dirname(handle.baseDir))).toEqual([basename(handle.baseDir)])
})
test("unavailable probe skips start and falls through", async () => {
  const handle = await ensureIsolation({ ...await fixture(), id: "one", platform: "darwin", backends: [
    backend({ kind: "apfs", probe: async () => ({ available: false, reason: "wrong filesystem" }),
      start: async () => { throw new Error("must not start") } }),
    backend(),
  ] })
  expect(handle.backend).toBe("rcopy")
  expect(handle.fallbackReason).toContain("wrong filesystem")
})
test("generic start error propagates and removes the creating directory", async () => {
  const f = await fixture()
  const failure = new Error("disk failure")
  await expect(ensureIsolation({ ...f, id: "one", preferred: "rcopy", backends: [backend({
    start: async () => { throw failure },
  })] })).rejects.toBe(failure)
  expect(await readdir(join(f.homeDir, ".omo/wt"))).toEqual([])
})
test("generic probe error propagates without falling through", async () => {
  const failure = new Error("probe I/O failure")
  await expect(ensureIsolation({ ...await fixture(), id: "one", preferred: "apfs", backends: [
    backend({ kind: "apfs", probe: async () => { throw failure } }), backend(),
  ] })).rejects.toBe(failure)
})
test("a probing backend whose CLI fails falls through instead of aborting the walk", async () => {
  const f = await fixture()
  // ReFS on a hosted runner: fsutil exits non-zero. The candidate walk must
  // record the reason and use the next backend, never surface the CLI failure.
  const handle = await ensureIsolation({ ...f, id: "one", platform: "win32", backends: [
    backend({ kind: "block-clone", probe: async () => ({ available: false, reason: "fsutil volumeinfo failed (1): The volume does not exist" }) }),
    backend(),
  ] })
  expect(handle.backend).toBe("rcopy")
  expect(handle.fellBack).toBe(true)
  expect(handle.fallbackReason).toContain("volume does not exist")
})
test("all unavailable yields a typed error", async () => {
  await expect(ensureIsolation({ ...await fixture(), id: "one", backends: [] })).rejects.toBeInstanceOf(IsolationUnavailableError)
})
test("cleanup stops before removing the tree", async () => {
  let stopped = false
  const handle = await ensureIsolation({ ...await fixture(), id: "one", preferred: "rcopy", backends: [backend({
    stop: async (merged) => { await access(merged); stopped = true },
  })] })
  await cleanupIsolation(handle)
  expect(stopped).toBe(true)
  expect(await access(handle.baseDir).then(() => true, () => false)).toBe(false)
})
test("stop failure preserves the tree instead of recursively removing a mount", async () => {
  const failure = new Error("cannot unmount")
  const handle = await ensureIsolation({ ...await fixture(), id: "one", preferred: "rcopy", backends: [backend({
    stop: async () => { throw failure },
  })] })
  await expect(cleanupIsolation(handle)).rejects.toBe(failure)
  await access(handle.mergedDir)
})
test("retention renames the complete tree and stores the reason", async () => {
  const handle = await ensureIsolation({ ...await fixture(), id: "one", preferred: "rcopy", backends: [backend()] })
  const retained = await retainIsolation(handle, "merge conflict")
  expect(retained).toContain(`${handle.baseDir}.retained-`)
  await access(join(retained, "m"))
  expect(await access(handle.baseDir).then(() => true, () => false)).toBe(false)
  expect(JSON.parse(await readFile(join(retained, ".omo-isolation-retained.json"), "utf8")).reason).toBe("merge conflict")
})
test("another ensure cannot remove an in-flight creating directory", async () => {
  const f = await fixture()
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const options = { ...f, id: "one", preferred: "rcopy" as const, backends: [backend({
    start: async (_lower, merged) => {
      entered.resolve()
      await release.promise
      await mkdir(merged)
    },
  })] }
  const first = ensureIsolation(options)
  await entered.promise
  try {
    await expect(ensureIsolation(options)).rejects.toThrow()
  } finally {
    release.resolve()
  }
  const handle = await first
  await access(join(handle.baseDir, ".omo-isolation-owner.json"))
})

test("fall-through leaves no creating directory behind", async () => {
  const f = await fixture()
  const handle = await ensureIsolation({ ...f, id: "one", platform: "darwin", backends: [
    backend({ kind: "apfs", start: async () => { throw new IsolationUnavailableError("no clone support") } }),
    backend(),
  ] })
  expect((await readdir(dirname(handle.baseDir))).filter((entry) => entry.includes(".creating-"))).toEqual([])
})


test("publication and retention route through the backend relocation hook", async () => {
  const calls: [string, string][] = []
  const instance = backend({ relocate: async (from, to) => {
    calls.push([from, to])
    await rename(from, to)
  } })
  const handle = await ensureIsolation({ ...await fixture(), id: "relocate", backends: [instance], preferred: "rcopy" })
  expect(calls).toEqual([[`${handle.baseDir}.creating-${process.pid}`, handle.baseDir]])
  const retained = await retainIsolation(handle, "conflict")
  expect(calls).toEqual([[`${handle.baseDir}.creating-${process.pid}`, handle.baseDir], [handle.baseDir, retained]])
  await access(join(retained, "m"))
})


test("retry restores ownership after a mount backend removes its whole base", async () => {
  const f = await repo()
  let starts = 0
  const handle = await ensureIsolation({ ...f, id: "retry-owner", preferred: "rcopy", backends: [backend({
    start: async (lower, merged) => {
      await mkdir(dirname(merged), { recursive: true })
      await cp(lower, merged, { recursive: true })
      if (++starts === 1) await writeFile(join(merged, ".git", "index"), "broken index")
    },
    stop: async (merged) => { await rm(dirname(merged), { recursive: true, force: true }) },
  })] })
  expect(starts).toBe(2)
  expect(JSON.parse(await readFile(join(handle.baseDir, ".omo-isolation-owner.json"), "utf8")).id).toBe("retry-owner")
})

test("git snapshot inconsistency after retry is a hard failure, not a fallback signal", async () => {
  const f = await fixture()
  // A start that materializes a git directory too broken for status: retry cannot fix it.
  const broken = backend({ start: async (_lower, merged) => { await mkdir(join(merged, ".git"), { recursive: true }) } })
  let failure: unknown
  try { await ensureIsolation({ repoRoot: f.repoRoot, homeDir: f.homeDir, id: "broken", backends: [broken] }) } catch (error) { failure = error }
  expect(failure).toBeInstanceOf(Error)
  expect(failure instanceof IsolationUnavailableError).toBe(false)
  expect((failure as Error).message).toContain("snapshot")
})
