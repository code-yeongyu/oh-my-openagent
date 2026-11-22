import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { rendererVisibleWidth } from "@oh-my-opencode/senpi-task/renderer-text"
import { buildIdentityPaths } from "@oh-my-opencode/memory-core"

import { createMemoryIdentityContext, type MemoryIdentityContext } from "./context"
import { MEMORY_STATUS_KEY, MEMORY_STATUS_MAX_WIDTH, readMemoryStatusSegments, formatMemoryStatusLine } from "./status"
import { createMemoryFooterStatusLive } from "./status-live-wiring"
import { readReflectionCompletion, writeCompletionRecord } from "./worker/completion"
import { finalizeRecordedOutcome } from "./worker/run-finalization"
import { cleanupFinalizationFixtures, finalizationFixture } from "./worker/run-finalization.test-support"

afterEach(cleanupFinalizationFixtures)

// #12330 review: the footer's cause must come from a real scratch merge through finalization, not a hand-made record.
describe("unintegrated reflection footer from a real merge conflict", () => {
  test.each([
    ["system/learned.md", "system/learned.md"],
    ["system/충돌메모.md", "system/충돌메모.md"],
    ["at notes.md", "merge conflict (at notes.md)"],
    ["system/learned  notes.md", "system/learned  notes.md"],
    ["system/learned  notes that are too long for the footer.md", "system/learned  notes that are..."],
  ])(
    "#given a conflict in %s #when finalized #then the footer shows the path within 60 cells",
    async (path, displayed) => {
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
      const context = createMemoryIdentityContext({
        identity: item.identity.id,
        identityPaths: item.identity.paths,
        binding: { identity: item.identity.id, repoPathHash: "hash", boundAt: 1 },
      })
      const calls = await readFooter(context)

      // then
      expect(result?.outcome).toBe("merge_conflict")
      expect(calls).toEqual([{ key: MEMORY_STATUS_KEY, text: `reflection not integrated: ${displayed}` }])
      expect(rendererVisibleWidth(calls[0]?.text ?? "")).toBeLessThanOrEqual(MEMORY_STATUS_MAX_WIDTH)
      const completion = await readReflectionCompletion(
        join(item.identity.paths.reflection, "completions"),
        item.ledger.runId,
      )
      expect(completion?.conflictPaths).toEqual([path])
    },
    60_000,
  )
})

test.each([
  {
    kind: "legacy child detail",
    fields: {
      detail: "\u009b31m    at fail (child.ts:1:2)\u009b0m\n\u001b[31mmanual edits\u0007 need attention\u001b[0m",
    },
    displayed: "manual edits need attention",
  },
  {
    kind: "typed path containing display controls",
    fields: { conflictPaths: ["notes\u0007\u007f\u0085\u001b[31m\n.md"] },
    displayed: "merge conflict (notes�.md)",
  },
])("#given $kind #when read #then the footer shows only the safe cause", async ({ fields, displayed }) => {
  const root = await mkdtemp(join(tmpdir(), "conflict-footer-"))
  try {
    const identity = "legacy-agent"
    const paths = buildIdentityPaths(root, identity)
    const context = createMemoryIdentityContext({
      identity,
      identityPaths: paths,
      binding: { identity, repoPathHash: "hash", boundAt: 1 },
    })
    const finishedAt = "2026-08-11T10:00:30.000Z"
    await writeCompletionRecord(join(paths.reflection, "completions"), {
      schemaVersion: 1,
      runId: "legacy-run",
      identity,
      category: "quick",
      conversationIds: [],
      trigger: "step-count",
      outcome: "merge_conflict",
      ...fields,
      startedAt: "2026-08-11T10:00:00.000Z",
      finishedAt,
      delivery: { status: "consumed" },
    })

    const segments = await readMemoryStatusSegments(
      {
        status: async () => "",
        head: async () => null,
        headCommitTimestamp: async () => null,
        lsTree: async () => [],
        show: async () => "",
      },
      context,
      undefined,
      undefined,
      () => Date.parse(finishedAt),
    )
    const text = formatMemoryStatusLine(identity, "just now", segments)

    expect(text).toBe(`reflection not integrated: ${displayed}`)
    expect(rendererVisibleWidth(text)).toBeLessThanOrEqual(MEMORY_STATUS_MAX_WIDTH)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

async function readFooter(context: MemoryIdentityContext) {
  const calls: Array<{ key: string; text: string | undefined }> = []
  const footer = createMemoryFooterStatusLive({
    resolveContext: () => context,
    isActive: () => false,
    now: () => Date.now(),
  })
  try {
    await footer.refresh("session", { setStatus: (key, text) => calls.push({ key, text }) })
    return calls
  } finally {
    footer.dispose()
  }
}
