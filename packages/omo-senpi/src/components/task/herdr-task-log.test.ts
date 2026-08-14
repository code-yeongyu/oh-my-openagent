import { access, mkdtemp, readFile, rename, rm, stat, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { describe, expect, it } from "bun:test"

import { createHerdrTaskLogStore } from "./herdr-task-log"

describe("HerdrTaskLogStore", () => {
  it("keeps writes on one private handle and removes its private directory", async () => {
    const log = await createHerdrTaskLogStore((line) => line).create("st_child")
    const directory = dirname(log.path)
    try {
      await log.append("first")
      await log.append("second")

      expect(await readFile(log.path, "utf8")).toBe("first\nsecond\n")
      const viewer = await readFile(log.viewerPath, "utf8")
      expect(viewer).toContain("let nextChange = changes.next()")
      expect(viewer).toContain("nextChange = changes.next()")
    } finally {
      await log.remove()
    }

    await expect(access(directory)).rejects.toThrow()
  })

  it.skipIf(process.platform === "win32")("uses private directory and file permissions", async () => {
    const log = await createHerdrTaskLogStore((line) => line).create("st_child")
    try {
      expect((await stat(dirname(log.path))).mode & 0o777).toBe(0o700)
      expect((await stat(log.path)).mode & 0o777).toBe(0o600)
      expect((await stat(log.viewerPath)).mode & 0o777).toBe(0o600)
    } finally {
      await log.remove()
    }
  })

  it.skipIf(process.platform === "win32")("does not follow a replacement pathname after opening", async () => {
    const victimDirectory = await mkdtemp(join(tmpdir(), "omo-herdr-victim-"))
    const victim = join(victimDirectory, "victim.log")
    const log = await createHerdrTaskLogStore((line) => line).create("st_child")
    try {
      await writeFile(victim, "victim\n", "utf8")
      await rename(log.path, `${log.path}.moved`)
      await symlink(victim, log.path)

      await log.append("safe")

      expect(await readFile(victim, "utf8")).toBe("victim\n")
      expect(await readFile(`${log.path}.moved`, "utf8")).toBe("safe\n")
    } finally {
      await log.remove()
      await rm(victimDirectory, { force: true, recursive: true })
    }
  })
})
