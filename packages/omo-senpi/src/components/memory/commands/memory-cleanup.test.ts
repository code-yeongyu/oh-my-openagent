import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { MemoryFakeExtensionAPI } from "../memory.test-support"
import { fakeCommandContext, fakeDeps, invoke, seededRepo, tempIdentity } from "./commands.test-support"
import { registerMemoryCommand } from "./memory"

setDefaultTimeout(60_000)

const LESSON = [
  "Read the host's order-line depth before placing a job; load average is not an idleness oracle.",
  "A grant's success line is not its effect: read the order line back in the same cell.",
  "An empty reply from the grant tool is the host not answering, never a slow grant.",
].join("\n\n")

const SEEDS = [
  { relativePath: "system/persona.md", content: "---\ndescription: Persona\n---\nI am the test persona.\n" },
  { relativePath: "reference/self/lesson-a.md", content: `---\ndescription: Lesson A\n---\n${LESSON}\n` },
  { relativePath: "reference/self/lesson-b.md", content: `---\ndescription: Lesson B\n---\n${LESSON}\n` },
]

describe("/memory cleanup", () => {
  test("#given two identical lessons #when invoked without --apply #then the report names the duplicate and the repository is untouched", async () => {
    // given
    const { identity } = await tempIdentity()
    const repo = await seededRepo(identity, SEEDS)
    const head = await repo.head()
    const pi = new MemoryFakeExtensionAPI()
    const deps = fakeDeps(identity)
    registerMemoryCommand(pi, deps)

    // when
    const output = await invoke(pi, "memory", "cleanup", fakeCommandContext())

    // then
    expect(output).toContain("# Memory cleanup (dry run)")
    expect(output).toContain("reference/self/lesson-b.md -> reference/self/lesson-a.md")
    expect(output).toContain("of 30000")
    expect(await repo.head()).toBe(head)
    expect(deps.busts).toEqual([])
  })

  test("#given the same repository #when invoked with --apply #then one commit archives the copy and the prompt cache is busted", async () => {
    // given
    const { identity } = await tempIdentity()
    const repo = await seededRepo(identity, SEEDS)
    const head = await repo.head()
    const pi = new MemoryFakeExtensionAPI()
    const deps = fakeDeps(identity)
    registerMemoryCommand(pi, deps)

    // when
    const output = await invoke(pi, "memory", "cleanup --apply", fakeCommandContext())
    const again = await invoke(pi, "memory", "cleanup --apply", fakeCommandContext())

    // then
    expect(output).toContain("# Memory cleanup (applied)")
    expect(output).toContain("memory cleanup committed locally")
    expect(await repo.head()).not.toBe(head)
    expect(await repo.status()).toBe("")
    expect(await readFile(join(repo.dir, "ARCHIVE.md"), "utf8")).toContain("## Archived reference/self/lesson-b.md")
    expect(deps.busts).toEqual(["bust"])
    expect(again).toContain("# Memory cleanup (nothing to apply)")
  })

  test("#given an unknown class #when invoked with --only #then the usage line is returned and nothing runs", async () => {
    // given
    const { identity } = await tempIdentity()
    const repo = await seededRepo(identity, SEEDS)
    const head = await repo.head()
    const pi = new MemoryFakeExtensionAPI()
    registerMemoryCommand(pi, fakeDeps(identity))

    // when
    const output = await invoke(pi, "memory", "cleanup --only duplicate,bogus --apply", fakeCommandContext())

    // then
    expect(output).toContain('unknown cleanup class "bogus"')
    expect(output).toContain("usage: /memory cleanup")
    expect(await repo.head()).toBe(head)
  })
})
