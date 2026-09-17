import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import { join } from "node:path"

describe("resolveOutDir", () => {
  test("returns default when no args", async () => {
    const origArgv = process.argv
    process.argv = ["bun", "script.ts"]
    const { resolveOutDir } = await import("./resolve-out-dir")
    expect(resolveOutDir("test-qa")).toBe(join(tmpdir(), "test-qa"))
    process.argv = origArgv
  })

  test("accepts bare positional dir", async () => {
    const origArgv = process.argv
    process.argv = ["bun", "script.ts", "/tmp/my-output"]
    const { resolveOutDir } = await import("./resolve-out-dir")
    expect(resolveOutDir("test-qa")).toBe("/tmp/my-output")
    process.argv = origArgv
  })

  test("accepts --out-dir flag", async () => {
    const origArgv = process.argv
    process.argv = ["bun", "script.ts", "--out-dir", "/tmp/my-output"]
    const { resolveOutDir } = await import("./resolve-out-dir")
    expect(resolveOutDir("test-qa")).toBe("/tmp/my-output")
    process.argv = origArgv
  })

  test("rejects bare --out-dir without value", async () => {
    const origArgv = process.argv
    process.argv = ["bun", "script.ts", "--out-dir"]
    const { resolveOutDir } = await import("./resolve-out-dir")
    expect(() => resolveOutDir("test-qa")).toThrow()
    process.argv = origArgv
  })

  test("rejects unknown flags", async () => {
    const origArgv = process.argv
    process.argv = ["bun", "script.ts", "--verbose"]
    const { resolveOutDir } = await import("./resolve-out-dir")
    expect(() => resolveOutDir("test-qa")).toThrow()
    process.argv = origArgv
  })

  test("rejects extra positionals", async () => {
    const origArgv = process.argv
    process.argv = ["bun", "script.ts", "dir1", "dir2"]
    const { resolveOutDir } = await import("./resolve-out-dir")
    expect(() => resolveOutDir("test-qa")).toThrow()
    process.argv = origArgv
  })

  test("rejects --out-dir with flag-like value", async () => {
    const origArgv = process.argv
    process.argv = ["bun", "script.ts", "--out-dir", "--verbose"]
    const { resolveOutDir } = await import("./resolve-out-dir")
    expect(() => resolveOutDir("test-qa")).toThrow()
    process.argv = origArgv
  })
})
