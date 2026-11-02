import { describe, expect, test } from "bun:test"

import { compileMemoryBlockAtRevision } from "./compile"
import { memory, parseCompiledBlock, repoWith } from "./compile.test-support"

const EXPIRES_AT = Date.UTC(2026, 9, 27, 6, 33)

function expiring(description: string, expires: string, body: string): string {
  return `---\ndescription: ${description}\nexpires: ${expires}\n---\n${body}`
}

describe("compiled memory block expiry", () => {
  const cases: ReadonlyArray<readonly [string, string, number, boolean]> = [
    ["a block whose instant has passed", "2026-10-27T06:33Z", EXPIRES_AT + 1, false],
    ["a block evaluated exactly at its instant", "2026-10-27T06:33Z", EXPIRES_AT, false],
    ["a block whose instant is still ahead", "2026-10-27T06:33Z", EXPIRES_AT - 1, true],
    ["a block whose date has started", "2026-10-27", Date.UTC(2026, 9, 27), false],
    ["a block the day before its date", "2026-10-27", Date.UTC(2026, 9, 27) - 1, true],
    ["a block with an offset-less datetime", "2026-10-27T06:33", EXPIRES_AT + 86_400_000, true],
    ["a block with an unreadable expiry", "soon", EXPIRES_AT + 86_400_000, true],
  ]

  test.each(cases)("#given %s #when compiled #then it is projected only while unexpired", async (_name, expires, asOfMs, projected) => {
    // given
    const { repo } = await repoWith([
      { relativePath: "system/persona.md", content: memory("Persona", "steady") },
      { relativePath: "system/temporary.md", content: expiring("Temporary outage note", expires, "provider X is down") },
    ])

    // when
    const block = await compileMemoryBlockAtRevision(repo, await repo.head(), { agentId: "expiry-agent" }, asOfMs)

    // then
    expect(parseCompiledBlock(block).projectionPaths.includes("system/temporary.md")).toBe(projected)
    expect(block.includes("provider X is down")).toBe(projected)
    expect(parseCompiledBlock(block).projectionPaths).toContain("system/persona.md")
  })

  test("#given an expired persona #when compiled #then <self> is left out like any other expired system file and the file is untouched", async () => {
    // given
    const { repo } = await repoWith([
      { relativePath: "system/persona.md", content: expiring("Persona", "2026-10-01", "old self") },
      { relativePath: "system/human.md", content: memory("Human", "prefers short answers") },
    ])
    const head = await repo.head()

    // when
    const block = await compileMemoryBlockAtRevision(repo, head, { agentId: "expiry-agent" }, EXPIRES_AT)

    // then
    expect(parseCompiledBlock(block).sections).toEqual(["memory", "memory_metadata"])
    expect(await repo.show(head ?? "", "system/persona.md")).toContain("old self")
  })
})
