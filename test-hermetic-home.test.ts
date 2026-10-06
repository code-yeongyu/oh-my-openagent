import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { shardsCreatedBy } from "./test-hermetic-home"

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
