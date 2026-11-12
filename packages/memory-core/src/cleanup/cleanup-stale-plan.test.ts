import { describe, expect, it } from "bun:test"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { memory, repoWith } from "../compile/compile.test-support"
import { applyMemoryCleanup, MemoryCleanupStaleError } from "./apply"
import { author, exists, lock, NOW, read } from "./cleanup.test-support"
import { planMemoryCleanup } from "./plan"

describe("memory cleanup stale plan", () => {
  it("#given notes that gain a link to an archived note after the report #when applied #then the plan is refused as stale and nothing is rewritten", async () => {
    // given
    const { dir, repo } = await repoWith([
      { relativePath: "reference/old-LIFTED.md", content: memory("Old", "A hold that was lifted on the sixth.") },
      { relativePath: "system/human.md", content: memory("Human", "Standing rules live here.") },
    ])
    const plan = await planMemoryCleanup(dir, { now: NOW })
    const human = memory("Human", "Standing rules live here. Older rule: [[reference/old-LIFTED]].")
    await writeFile(join(dir, "system/human.md"), human)
    await writeFile(join(dir, "reference/fresh.md"), memory("Fresh", "Written later: [old](old-LIFTED.md)."))
    await repo.commitWrite(["system/human.md", "reference/fresh.md"], "link the old hold", author)
    const head = await repo.head()

    // when
    const refusal = await applyMemoryCleanup({ repo, lock, plan, author }).then(
      () => undefined,
      (error: unknown) => error,
    )

    // then
    expect(plan.findings.map((finding) => finding.subject)).toStrictEqual(["reference/old-LIFTED.md"])
    expect(refusal).toBeInstanceOf(MemoryCleanupStaleError)
    if (refusal instanceof MemoryCleanupStaleError)
      expect(refusal.changed).toStrictEqual(["reference/fresh.md", "system/human.md"])
    expect(await read(dir, "system/human.md")).toBe(human)
    expect(await exists(dir, "reference/old-LIFTED.md")).toBe(true)
    expect(await repo.head()).toBe(head)
  })
})
