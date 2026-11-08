import { afterEach, describe, expect, test } from "bun:test"
import { lstatSync } from "node:fs"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { measureRuntimeSize } from "./size"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function root(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "memory-runtime-size-"))
  roots.push(dir)
  return dir
}

/** What `du` charges for one entry: allocated blocks when the platform reports them, else the size. */
function charged(path: string): number {
  const stats = lstatSync(path)
  return typeof stats.blocks === "number" && (stats.blocks > 0 || stats.size === 0) ? stats.blocks * 512 : stats.size
}

describe("measureRuntimeSize (B09)", () => {
  test("#given a runtime holding a symlink to a large external dir #when measured #then the link counts as itself and is never followed", async () => {
    const base = await root()
    const external = join(base, "external")
    await mkdir(external, { recursive: true })
    await writeFile(join(external, "big.bin"), Buffer.alloc(4 * 1024 * 1024, 1))
    const runtime = join(base, "runtime")
    await mkdir(join(runtime, "reflection", "runs"), { recursive: true })
    const link = join(runtime, "reflection", "runs", "linked")
    await symlink(external, link, "dir")

    const size = await measureRuntimeSize(runtime)

    const expected = [runtime, join(runtime, "reflection"), join(runtime, "reflection", "runs"), link].reduce((sum, path) => sum + charged(path), 0)
    expect(size.bytes).toBe(expected)
    expect(size.bytes).toBeLessThan(4 * 1024 * 1024)
  })

  test("#given a regular file #when measured #then it is charged by allocated blocks the way du is", async () => {
    const runtime = join(await root(), "runtime")
    await mkdir(join(runtime, "transcripts", "s1"), { recursive: true })
    const file = join(runtime, "transcripts", "s1", "transcript.jsonl")
    await writeFile(file, Buffer.alloc(10_001, 7))

    const size = await measureRuntimeSize(runtime)

    const directories = [runtime, join(runtime, "transcripts"), join(runtime, "transcripts", "s1")].reduce((sum, path) => sum + charged(path), 0)
    expect(size.bytes).toBe(directories + charged(file))
    expect(charged(file)).toBeGreaterThanOrEqual(10_001)
  })

  test("#given several stores #when measured #then each store is reported largest first and they sum to the total", async () => {
    const runtime = join(await root(), "runtime")
    await mkdir(join(runtime, "reflection", "runs", "reflection-run-1"), { recursive: true })
    await writeFile(join(runtime, "reflection", "runs", "reflection-run-1", "child-1.log"), Buffer.alloc(300_000, 1))
    await mkdir(join(runtime, "recall", "sidecars", "abc"), { recursive: true })
    await writeFile(join(runtime, "recall", "sidecars", "abc", "wakes.ndjson"), Buffer.alloc(120_000, 1))
    await mkdir(join(runtime, "transcripts", "s1"), { recursive: true })
    await writeFile(join(runtime, "transcripts", "s1", "transcript.jsonl"), Buffer.alloc(40_000, 1))
    await writeFile(join(runtime, "receipts.jsonl"), "{}\n")

    const size = await measureRuntimeSize(runtime)

    expect(size.stores.slice(0, 3).map((store) => store.store)).toEqual(["reflection/runs", "recall/sidecars", "transcripts"])
    expect(size.stores.reduce((sum, store) => sum + store.bytes, charged(runtime) + charged(join(runtime, "reflection")) + charged(join(runtime, "recall")))).toBe(size.bytes)
    expect(size.stores.find((store) => store.store === "receipts.jsonl")?.bytes).toBe(charged(join(runtime, "receipts.jsonl")))
  })

  test("#given a deadline signal that has fired #when measured #then the walk aborts instead of finishing (r4 R5)", async () => {
    const runtime = join(await root(), "runtime")
    await mkdir(join(runtime, "transcripts", "s1"), { recursive: true })
    await writeFile(join(runtime, "transcripts", "s1", "transcript.jsonl"), "{}\n")

    await expect(measureRuntimeSize(runtime, { signal: AbortSignal.abort() })).rejects.toThrow()
  })

  test("#given no runtime directory yet #when measured #then the size is zero", async () => {
    const size = await measureRuntimeSize(join(await root(), "missing"))
    expect(size).toEqual({ bytes: 0, stores: [] })
  })
})
