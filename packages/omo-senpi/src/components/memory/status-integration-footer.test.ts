import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { createMemoryIdentityContext } from "./context"
import { MEMORY_STATUS_KEY } from "./status"
import { createMemoryFooterStatusLive } from "./status-live-wiring"
import { finalizeRecordedOutcome } from "./worker/run-finalization"
import { cleanupFinalizationFixtures, finalizationFixture } from "./worker/run-finalization.test-support"

afterEach(cleanupFinalizationFixtures)

// #12330 review: the footer's cause must come from a real scratch merge through finalization, not a hand-made record.
describe("unintegrated reflection footer from a real merge conflict", () => {
  test("#given a person's edit that conflicts with the reflection #when the run finalizes #then the footer names the conflicting file", async () => {
    // given: the reflection wrote system/learned.md; the person committed a different system/learned.md meanwhile.
    const item = await finalizationFixture(false)
    await mkdir(join(item.repo.dir, "system"), { recursive: true })
    await writeFile(join(item.repo.dir, "system", "learned.md"), "---\ndescription: Mine\n---\nmine\n")
    await item.repo.commitWrite(["system/learned.md"], "person edit", { agentId: item.identity.id, authorName: "Person" })

    // when
    const result = await finalizeRecordedOutcome(
      {
        identity: item.identity,
        reservation: {
          readState: async () => await item.store.readState(),
          complete: async (runId, outcome) => await item.store.complete(runId, outcome),
        },
        now: () => Date.now(),
        withWriterLock: async (operation) => operation(),
      },
      item.runDir,
      item.ledger,
    )
    const calls: Array<{ key: string; text: string | undefined }> = []
    const context = createMemoryIdentityContext({
      identity: item.identity.id,
      identityPaths: item.identity.paths,
      binding: { identity: item.identity.id, repoPathHash: "hash", boundAt: 1 },
    })
    const footer = createMemoryFooterStatusLive({
      resolveContext: () => context,
      isActive: () => false,
      now: () => Date.now(),
    })
    await footer.refresh("session", { setStatus: (key, text) => calls.push({ key, text }) })
    footer.dispose()

    // then
    expect(result?.outcome).toBe("merge_conflict")
    expect(calls).toEqual([
      { key: MEMORY_STATUS_KEY, text: "reflection not integrated: system/learned.md" },
    ])
  }, 60_000)
})
