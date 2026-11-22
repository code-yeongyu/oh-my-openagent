import { afterEach, describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { installHooks, migrateMemoryHooks, resolveHooksDir } from "./hooks"
import { createRepo, removeTempDirs, run, tempDir } from "./hooks.test-support"

const CHECKER = { execPath: "/opt/omo it's/bun", script: "/opt/omo/memory-run-supervisor.mjs" }
const FOREIGN = "#!/bin/sh\necho 'my own hook'\nexit 0\n"

afterEach(removeTempDirs)

const hook = (dir: string, name: string): Promise<string> => readFile(join(resolveHooksDir(dir), name), "utf8")

describe("migrateMemoryHooks: the one path that moves an older omo hook forward (#12221)", () => {
  it("#given an omo pre-commit from an older release with the engine checker #when migrated #then it holds this release's script and keeps that checker", async () => {
    const dir = await createRepo({ checker: CHECKER })
    const expected = await hook(dir, "pre-commit")
    await writeFile(join(resolveHooksDir(dir), "pre-commit"), expected.replace(/^ALL_KNOWN_KEYS=.*$/m, 'ALL_KNOWN_KEYS="description read_only limit kind aliases"'))

    const result = migrateMemoryHooks(dir)

    expect(await hook(dir, "pre-commit")).toBe(expected)
    expect(result.map(({ name, status }) => [name, status])).toEqual([["pre-commit", "written"], ["commit-msg", "current"], ["post-commit", "current"]])
  })

  it("#given a hook the user wrote #when migrated or installed #then it is reported foreign and its bytes are untouched", async () => {
    const dir = await createRepo()
    await writeFile(join(resolveHooksDir(dir), "commit-msg"), FOREIGN, { mode: 0o755 })

    expect(migrateMemoryHooks(dir).find(({ name }) => name === "commit-msg")?.status).toBe("foreign")
    expect(installHooks(dir).find(({ name }) => name === "commit-msg")?.status).toBe("foreign")
    expect(await hook(dir, "commit-msg")).toBe(FOREIGN)
  })

  it("#given a repository with no hooks at all #when migrated #then nothing is installed", async () => {
    const dir = await tempDir("memory-hooks-none-")
    await run(["git", "init", "--quiet", "--template="], dir)

    expect(migrateMemoryHooks(dir)).toEqual([])
    expect(existsSync(join(resolveHooksDir(dir), "pre-commit"))).toBe(false)
  })
})
