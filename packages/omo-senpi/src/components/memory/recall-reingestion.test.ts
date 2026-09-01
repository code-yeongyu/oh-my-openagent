// Re-ingestion guard for injected recall hints (plan .omo/plans/memorian-recall-m1.md unit 4).
//
// The facts queue payload and the reflection/dream transcript payload are BOTH derived from the
// transcript journal, and the journal is written from projectSessionEntries over the senpi branch.
// That single seam is therefore the narrowest place where an injected omo-memorian:recall hint
// could re-enter memory, so it is pinned here for both consumers at once.

import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { TranscriptJournal, buildIdentityPaths } from "@oh-my-opencode/memory-core"

import { createMemoryJournalWiring, projectSessionEntries } from "./journal-wiring"
import { MEMORY_NOTICE_CUSTOM_TYPE } from "./prompt"
import { RECALL_CUSTOM_TYPE } from "./recall-wiring"
import { rmSyncEfaultTolerant } from "./teardown.test-support"

const RECALL_TEXT = "<recalled-memory>drain kubernetes nodes before a rollout</recalled-memory>"
const SESSION_ID = "session-reingestion"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSyncEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})

function branch(): readonly Record<string, unknown>[] {
  return [
    {
      type: "message",
      id: "u1",
      message: { role: "user", content: [{ type: "text", text: "how do we ship" }] },
    },
    // The shape senpi persists an injected before_agent_start message as.
    {
      type: "custom_message",
      id: "c1",
      customType: RECALL_CUSTOM_TYPE,
      content: RECALL_TEXT,
      display: false,
    },
    {
      type: "custom_message",
      id: "c2",
      customType: MEMORY_NOTICE_CUSTOM_TYPE,
      content: "<memory_notice>1 previous message</memory_notice>",
      display: false,
    },
    // The shape a fork or an older writer can leave behind for the same payload.
    {
      type: "message",
      id: "m1",
      message: {
        role: "custom",
        customType: RECALL_CUSTOM_TYPE,
        content: [{ type: "text", text: RECALL_TEXT }],
        display: false,
      },
    },
    {
      type: "message",
      id: "a1",
      message: { role: "assistant", content: [{ type: "text", text: "we ship on fridays" }] },
    },
  ]
}

function eventContext(entries: readonly unknown[]): unknown {
  return {
    sessionManager: {
      getSessionId: () => SESSION_ID,
      getBranch: () => entries,
    },
  }
}

describe("recall re-ingestion guard", () => {
  test("#given an injected recall hint in the branch #when session entries are projected #then only real conversation rows survive", () => {
    // when
    const projections = projectSessionEntries(branch())

    // then
    expect(projections.map((projection) => projection.messageId)).toEqual(["u1", "a1"])
    expect(JSON.stringify(projections)).not.toContain("recalled-memory")
    expect(JSON.stringify(projections)).not.toContain("memory_notice")
  })

  test("#given a reconciled session containing a recall hint #when the facts payload and the reflection snapshot read the journal #then neither carries the hint", async () => {
    // given
    const root = mkdtempSync(join(tmpdir(), "omo-memory-recall-reingestion-"))
    roots.push(root)
    const paths = buildIdentityPaths(root, "reingestion-agent")
    const wiring = createMemoryJournalWiring({ identityPaths: paths })

    // when
    await wiring.reconcileSession(eventContext(branch()))
    const journal = new TranscriptJournal({ journalDir: join(paths.transcripts, SESSION_ID) })
    // The facts queue publishes exactly these entries; the reflection/dream payload is built from
    // the cursor snapshot over the same rows.
    const factsEntries = await journal.readEntries()
    const snapshot = await journal.captureReflectionSnapshot()

    // then
    expect(factsEntries.map((entry) => entry.source_message_id)).toEqual(["u1", "a1"])
    expect(JSON.stringify(factsEntries)).not.toContain("recalled-memory")
    expect(JSON.stringify(snapshot)).not.toContain("recalled-memory")
  }, 30_000)
})
