import { afterEach, describe, expect, test } from "bun:test"
import { chmod, writeFile, readFile } from "node:fs/promises"
import { basename, join } from "node:path"
import { createRepo, removeTempDirs, run, tempDir } from "../memfs/hooks.test-support"
import { createMirrorRepo, initBareMirror } from "../sync/mirror.test-support"
import { gitRepo } from "../sync/engine/engine-harness.test-support"
import { initGitSyncTestRepo } from "../sync/engine/adapters/git-sync-repo.test-support"
import { ensureQaRepo } from "../sync/engine/adapters/qa-repo.test-support"

afterEach(removeTempDirs)

const normalizedPath = (path: string): string => path.replace(/\\/g, "/").toLowerCase()

const factories = [
  { name: "hooks", create: () => createRepo() },
  { name: "mirror", create: async () => {
    const dir = await tempDir("memory-mirror-trace-")
    await createMirrorRepo(dir)
    return dir
  } },
  { name: "sync engine", create: async () => {
    const dir = await tempDir("memory-engine-trace-")
    await gitRepo(dir)
    return dir
  } },
  { name: "git sync adapter", create: async () => {
    const dir = await tempDir("memory-adapter-trace-")
    await initGitSyncTestRepo(dir)
    return dir
  } },
  { name: "QA device", create: async () => {
    const dir = await tempDir("memory-qa-trace-")
    await ensureQaRepo(dir)
    return dir
  } },
]

describe("fixture repositories never spawn unowned git maintenance (#10945)", () => {
  test.each(factories)("$name: raw commit and bare push have traced children but no maintenance or gc", async ({ create }) => {
    // Given the actual fixture factory, a bare receiver, and a known child independent of maintenance.
    const dir = await create()
    const bare = await tempDir("memory-bare-trace-")
    await initBareMirror(bare)
    const hooks = await tempDir("memory-trace-hooks-")
    const hook = join(hooks, "pre-commit")
    await writeFile(hook, "#!/bin/sh\nexit 0\n")
    await chmod(hook, 0o755)
    expect((await run(["git", "config", "core.hooksPath", hooks], dir)).code).toBe(0)
    const trace = join(await tempDir("memory-fixture-trace-"), "trace2.json")
    const env = { GIT_TRACE2_EVENT: trace }

    // When raw git commits and pushes without production's NO_AUTO_MAINTENANCE flags.
    expect((await run(["git", "commit", "--allow-empty", "-m", "trace fixture"], dir, env)).code).toBe(0)
    expect((await run(["git", "push", bare, "HEAD:refs/heads/main"], dir, env)).code).toBe(0)

    // Then parse every event, and require the known hook plus receive-pack as positive controls.
    const events: { event: string; argv?: string[] }[] = (await readFile(trace, "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line))
    const children = events.filter((event) => event.event === "child_start").map((event) => event.argv ?? [])
    // Git on Windows passes the hook path with its own separators and drive spelling, so match the normalized tail.
    const hookTail = normalizedPath(`${basename(hooks)}/pre-commit`)
    expect(children.some((argv) => argv.some((arg) => normalizedPath(arg).endsWith(hookTail)))).toBe(true)
    expect(children.some((argv) => argv.some((arg) => arg.includes("receive-pack")))).toBe(true)
    expect(children.filter((argv) => argv.includes("maintenance") || argv.includes("gc"))).toEqual([])
  }, 30_000)
})
