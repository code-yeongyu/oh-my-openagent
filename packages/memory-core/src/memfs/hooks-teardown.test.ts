import { afterEach, describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { commit, createRepo, removeTempDirs, run, tempDir } from "./hooks.test-support"

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

afterEach(removeTempDirs)

describe("memfs hooks test support teardown (#10945)", () => {
  it("#given a spawned child still running when its test ends #when the temp dirs are removed #then the child is stopped first and no temp entry is left", async () => {
    const root = await tempDir("memory-hooks-teardown-")
    await writeFile(join(root, "marker"), "")
    const pending = run([process.execPath, "-e", LATE_WRITER, root], root)

    await removeTempDirs()
    await pending

    expect({ leftover: existsSync(root) }).toEqual({ leftover: false })
  }, 30_000)

  it("#given a fixture repository #when a commit lands #then git starts no detached maintenance or gc that could outlive the test", async () => {
    // git >= 2.47 follows a commit with `git maintenance run --auto --detach`: a process this support never spawned, so
    // teardown cannot reap it, and it can still write into the repository while the root is removed (#10945).
    const dir = await createRepo()
    const trace = join(await tempDir("memory-hooks-trace-"), "trace2.json")
    // The test preload turns auto maintenance off globally (#11742); this global config turns it back on, so only the
    // fixture's own repository config can keep the commit from starting it.
    const autoMaintenanceOn = join(dir, ".git", "auto-maintenance-on.gitconfig")
    await writeFile(autoMaintenanceOn, "[maintenance]\n\tauto = true\n")

    const result = await commit(dir, { "reference/note.md": "---\ndescription: Note\n---\n\nbody\n" }, "memory write", {
      GIT_TRACE2_EVENT: trace,
      GIT_CONFIG_GLOBAL: autoMaintenanceOn,
    })

    expect(result.code).toBe(0)
    const events: { event: string; argv?: string[] }[] = (await readFile(trace, "utf8"))
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line))
    const children = events.filter((event) => event.event === "child_start").map((event) => event.argv ?? [])
    expect(children.length).toBeGreaterThan(0)
    expect(children.some((argv) => argv.some((arg) => arg.endsWith("pre-commit")))).toBe(true)
    expect(children.filter((argv) => argv.includes("maintenance") || argv.includes("gc"))).toEqual([])
  }, 30_000)
})
