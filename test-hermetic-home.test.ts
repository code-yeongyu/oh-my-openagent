import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runCheckThenTeardown, shardsCreatedBy } from "./test-hermetic-home"

describe("shardsCreatedBy (#9673)", () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  function shardsDirWith(createdBy: number, createdAt: Date): string {
    const dir = mkdtempSync(join(tmpdir(), "omo-shards-"))
    dirs.push(dir)
    writeFileSync(
      join(dir, "p-abc.meta.json"),
      JSON.stringify({ created_by_pid: createdBy, created_at: createdAt.toISOString() }),
    )
    return dir
  }

  const startedAt = Date.now() - 60_000

  test("ignores a shard naming this pid that was created before the process started", () => {
    const dir = shardsDirWith(process.pid, new Date(startedAt - 3 * 24 * 60 * 60 * 1000))
    expect(shardsCreatedBy(dir, process.pid, startedAt)).toEqual([])
  })

  test("reports a shard naming this pid that was created after the process started", () => {
    const dir = shardsDirWith(process.pid, new Date(startedAt + 1000))
    expect(shardsCreatedBy(dir, process.pid, startedAt)).toEqual([join(dir, "p-abc.meta.json")])
  })

  test("reports a shard naming this pid whose created_at cannot be parsed", () => {
    const dir = mkdtempSync(join(tmpdir(), "omo-shards-"))
    dirs.push(dir)
    writeFileSync(join(dir, "p-abc.meta.json"), JSON.stringify({ created_by_pid: process.pid, created_at: "not a date" }))
    expect(shardsCreatedBy(dir, process.pid, startedAt)).toEqual([join(dir, "p-abc.meta.json")])
  })

  test("ignores a shard created by another pid", () => {
    const dir = shardsDirWith(process.pid + 1, new Date(startedAt + 1000))
    expect(shardsCreatedBy(dir, process.pid, startedAt)).toEqual([])
  })
})

describe("runCheckThenTeardown (#9766)", () => {
  const fail = (message: string) => () => {
    throw new Error(message)
  }

  test("#given the check throws #when run #then the teardown still runs and the check error is thrown", async () => {
    let tornDown = false
    const run = runCheckThenTeardown(async () => fail("shards")(), () => {
      tornDown = true
    })

    await expect(run).rejects.toThrow("shards")
    expect(tornDown).toBe(true)
  })

  test("#given only the teardown throws #when run #then the teardown error is thrown", async () => {
    await expect(runCheckThenTeardown(async () => {}, fail("leftovers"))).rejects.toThrow("leftovers")
  })

  test("#given both throw #when run #then the thrown message carries both, since the runner prints only that", async () => {
    const error = await runCheckThenTeardown(async () => fail("shard p-1 leaked")(), fail("left omo-x-1")).catch(
      (caught: unknown) => caught,
    )

    if (!(error instanceof AggregateError)) throw new Error(`expected an AggregateError, got ${String(error)}`)
    expect(error.message).toContain("shard p-1 leaked")
    expect(error.message).toContain("left omo-x-1")
    expect(error.errors).toHaveLength(2)
  })

  test("#given an async teardown that rejects #when run #then the rejection is thrown", async () => {
    await expect(
      runCheckThenTeardown(async () => {}, async () => {
        throw new Error("async leftovers")
      }),
    ).rejects.toThrow("async leftovers")
  })
})
