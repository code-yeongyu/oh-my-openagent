import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { rendererVisibleWidth } from "@oh-my-opencode/senpi-task/renderer-text"

import { createMemoryIdentityContext } from "./context"
import { MEMORY_STATUS_KEY, MEMORY_STATUS_MAX_WIDTH } from "./status"
import { createMemoryFooterStatusLive } from "./status-live-wiring"
import { finalizeRecordedOutcome } from "./worker/run-finalization"
import { cleanupFinalizationFixtures, finalizationFixture } from "./worker/run-finalization.test-support"

afterEach(cleanupFinalizationFixtures)

// #12330 review: the footer's cause must come from a real scratch merge through finalization, not a hand-made record.
describe("unintegrated reflection footer from a real merge conflict", () => {
  test.each(["system/learned.md", "system/충돌메모.md"])(
    "#given a conflict in %s #when finalized #then the footer shows the path within 60 cells",
    async (path) => {
      // given
      const item = await finalizationFixture(false, undefined, path)
      await mkdir(join(item.repo.dir, "system"), { recursive: true })
      await writeFile(join(item.repo.dir, path), "---\ndescription: Mine\n---\nmine\n")
      await item.repo.commitWrite([path], "person edit", { agentId: item.identity.id, authorName: "Person" })

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
      try {
        await footer.refresh("session", { setStatus: (key, text) => calls.push({ key, text }) })
      } finally {
        footer.dispose()
      }

      // then
      expect(result?.outcome).toBe("merge_conflict")
      expect(calls).toEqual([{ key: MEMORY_STATUS_KEY, text: `reflection not integrated: ${path}` }])
      expect(rendererVisibleWidth(calls[0]?.text ?? "")).toBeLessThanOrEqual(MEMORY_STATUS_MAX_WIDTH)
    },
    60_000,
  )
})
