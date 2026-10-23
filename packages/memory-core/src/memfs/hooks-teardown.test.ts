import { describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"

import { removeTempDirs, run, tempDir } from "./hooks.test-support"

// A child that outlives its test (a git commit whose test timed out under load) keeps writing into the temp root.
// This one waits until the teardown has removed the root's marker and then recreates the root, which is exactly the
// leftover the hermetic temp-root check reports (#10945).
const LATE_WRITER = `
const { existsSync, mkdirSync, writeFileSync } = require("node:fs")
const [root] = process.argv.slice(1)
const marker = root + "/marker"
const timer = setInterval(() => {
  if (existsSync(marker)) return
  clearInterval(timer)
  mkdirSync(root + "/late", { recursive: true })
  writeFileSync(root + "/late/file", "written after the test ended")
}, 10)
`

describe("memfs hooks test support teardown (#10945)", () => {
  it("#given a spawned child still running when its test ends #when the temp dirs are removed #then the child is stopped first and no temp entry is left", async () => {
    const root = await tempDir("memory-hooks-teardown-")
    await writeFile(join(root, "marker"), "")
    const pending = run([process.execPath, "-e", LATE_WRITER, root], root)

    await removeTempDirs()
    await pending

    expect({ leftover: existsSync(root) }).toEqual({ leftover: false })
  }, 30_000)
})
