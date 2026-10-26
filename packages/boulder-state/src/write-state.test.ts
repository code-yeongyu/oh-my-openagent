/// <reference path="../../../bun-test.d.ts" />

import * as realFs from "node:fs"
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { describe, expect, mock, onTestFinished, test } from "bun:test"

const fault: { failWrites: boolean } = { failWrites: false }
const realModule = { ...realFs }
const realWriteFileSync = realFs.writeFileSync

mock.module("node:fs", () => ({
  ...realModule,
  writeFileSync: (...args: Parameters<typeof realWriteFileSync>) => {
    const [file, data] = args
    if (!fault.failWrites || typeof data !== "string" || String(file).endsWith(".gitignore")) {
      return realWriteFileSync(...args)
    }
    fault.failWrites = false
    realWriteFileSync(file, data.slice(0, Math.floor(data.length / 2)))
    throw Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" })
  },
}))

const { createBoulderState, writeBoulderState } = await import("./storage/write-state")
const { getBoulderFilePath } = await import("./storage/path")

function createTempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "boulder-write-state-"))
  onTestFinished(() => {
    fault.failWrites = false
    rmSync(directory, { recursive: true, force: true })
  })
  return directory
}

describe("writeBoulderState on a full disk", () => {
  test("#given a saved boulder #when a rewrite runs out of space part-way #then the previous file is byte-identical and the error reaches the caller", () => {
    const directory = createTempDirectory()
    const first = createBoulderState(join(directory, "plan-a.md"), "session-a")
    expect(writeBoulderState(directory, first)).toBeTruthy()
    const filePath = getBoulderFilePath(directory)
    const before = readFileSync(filePath, "utf-8")

    fault.failWrites = true
    const result = writeBoulderState(directory, createBoulderState(join(directory, "plan-b.md"), "session-b"))

    expect(readFileSync(filePath, "utf-8")).toBe(before)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.name).toBe("BoulderStateWriteError")
    expect(result.error).toMatchObject({ code: "ENOSPC", path: filePath })
    expect(result.error.message).toContain("Free disk space")
    expect(readdirSync(dirname(filePath)).filter((name) => name.endsWith(".tmp"))).toEqual([])
  })
})
