import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { realpathSync } from "node:fs"
import { rmEfaultTolerant } from "./teardown.test-support"

import {
  REFLECTION_STATE_SCHEMA_VERSION,
  type ReflectionTranscriptState,
  type TranscriptEntry,
} from "@oh-my-opencode/memory-core"

import {
  computeUnreflectedVolume,
  packDreamCandidates,
  rankDreamCandidates,
  scoreDreamCandidate,
  selectDreamConversations,
  selectRecentDreamConversations,
  type DreamScoredConversation,
} from "./dream-selector"

const NOW = new Date("2026-08-10T12:00:00.000Z")
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rmEfaultTolerant(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

function textEntry(
  conversationId: string,
  index: number,
  text: string,
  capturedAt: string,
): TranscriptEntry {
  return {
    kind: index % 2 === 0 ? "user" : "assistant",
    text,
    captured_at: capturedAt,
    source_line_id: `${conversationId}:line:${index}`,
    source_message_id: `${conversationId}:message:${index}`,
  }
}

function contextualEntry(
  conversationId: string,
  kind: "reasoning" | "error" | "tool_call",
  capturedAt: string,
): TranscriptEntry {
  return kind === "tool_call"
    ? {
        kind,
        name: "read",
        captured_at: capturedAt,
        source_line_id: `${conversationId}:tail:tool`,
        source_message_id: `${conversationId}:tail`,
      }
    : {
        kind,
        text: `${kind} tail`,
        captured_at: capturedAt,
        source_line_id: `${conversationId}:tail:${kind}`,
        source_message_id: `${conversationId}:tail`,
      }
}

function state(overrides: Partial<ReflectionTranscriptState> = {}): ReflectionTranscriptState {
  return {
    schema_version: REFLECTION_STATE_SCHEMA_VERSION,
    total_completed_steps: 0,
    reflected_completed_steps: 0,
    steps_since_last_successful_reflection: 0,
    ...overrides,
  }
}

async function writeJournal(
  transcriptsDir: string,
  conversationId: string,
  entries: readonly TranscriptEntry[],
  journalState = state(),
): Promise<void> {
  const dir = join(transcriptsDir, conversationId)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, "transcript.jsonl"), `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`)
  await writeFile(join(dir, "state.json"), `${JSON.stringify(journalState)}\n`)
}

function scored(
  conversationId: string,
  score: number,
  unreflectedSteps: number,
  lastActivityMs: number,
  totalBytes = 1,
): DreamScoredConversation {
  return {
    conversationId,
    totalBytes,
    lastActivityMs,
    operands: {
      searchHits: 0,
      unreflectedSteps,
      recency: 0,
      sourceCount: 0,
      sizeFit: 0,
      isCurrent: 0,
      penalty: 0,
    },
    score,
  }
}

describe("dream conversation scoring", () => {
  test("#given a fixed scoring vector #when scored #then every normalized operand and the exact total match", () => {
    // given
    const input = {
      searchMatchCount: 3,
      stepsSinceLastSuccessfulReflection: 25,
      lastActivity: "2026-08-03T12:00:00.000Z",
      distinctSourceCount: 100,
      totalBytes: 30,
      targetBytes: 20,
      isCurrent: true,
      newestMessageCovered: true,
      now: NOW,
    }

    // when
    const result = scoreDreamCandidate(input)

    // then
    expect(result.operands).toEqual({
      searchHits: 0.3,
      unreflectedSteps: 0.5,
      recency: Math.exp(-1),
      sourceCount: 0.5,
      sizeFit: 2 / 3,
      isCurrent: 1,
      penalty: 1,
    })
    expect(result.score).toBe(15 + 0.5 + Math.exp(-1) + 0.5 + 2 / 3)
  })

  test("#given three equal scores #when ranked #then unreflected steps recency and conversation id break ties in order", () => {
    // given
    const candidates = [
      scored("zeta", 7, 0.8, 1),
      scored("beta", 7, 0.7, 2),
      scored("alpha", 7, 0.7, 2),
    ]

    // when
    const ranked = rankDreamCandidates(candidates)

    // then
    expect(ranked.map((candidate) => candidate.conversationId)).toEqual(["zeta", "alpha", "beta"])
  })
})

describe("dream conversation packing", () => {
  test("#given an oversized middle candidate #when packed #then it is skipped and a later fitting candidate is selected", () => {
    // given
    const ranked = [scored("first", 10, 0, 0, 6), scored("oversized", 9, 0, 0, 11), scored("later", 8, 0, 0, 4)]

    // when
    const result = packDreamCandidates(ranked, { maxConversations: 3, maxBytes: 10 })
    const countCapped = packDreamCandidates(ranked, { maxConversations: 1, maxBytes: 10 })

    // then
    expect(result).toEqual({ conversationIds: ["first", "later"], totalBytes: 10 })
    expect(countCapped).toEqual({ conversationIds: ["first"], totalBytes: 6 })
  })
})

describe("dream journal selection", () => {
  for (const kind of ["reasoning", "error", "tool_call"] as const) {
    test(`#given a stale conversation with a newer ${kind} tail #when recent selection runs #then canonical activity wins`, async () => {
      // given
      const root = realpathSync.native(await mkdtemp(join(tmpdir(), "dream-selector-recency-")))
      tempDirs.push(root)
      const transcriptsDir = join(root, "transcripts")
      await writeJournal(transcriptsDir, "stale-with-tail", [
        textEntry("stale-with-tail", 0, "stale", "2026-08-10T09:00:00.000Z"),
        contextualEntry("stale-with-tail", kind, "2026-08-10T11:30:00.000Z"),
      ])
      await writeJournal(transcriptsDir, "actually-recent", [
        textEntry("actually-recent", 0, "recent", "2026-08-10T10:00:00.000Z"),
      ])

      // when
      const result = await selectRecentDreamConversations({
        transcriptsDir,
        autoSelectMax: 1,
        autoSelectMaxBytes: 10_000,
        now: () => NOW,
      }, 1)

      // then
      expect(result.conversationIds).toEqual(["actually-recent"])
    })
  }

  test("#given a stale conversation with a newer contextual tail #when automatic selection is capped #then canonical activity wins", async () => {
    // given
    const root = realpathSync.native(await mkdtemp(join(tmpdir(), "dream-selector-auto-recency-")))
    tempDirs.push(root)
    const transcriptsDir = join(root, "transcripts")
    await writeJournal(transcriptsDir, "stale-with-tail", [
      textEntry("stale-with-tail", 0, "same", "2026-08-10T09:00:00.000Z"),
      contextualEntry("stale-with-tail", "reasoning", "2026-08-10T11:30:00.000Z"),
    ])
    await writeJournal(transcriptsDir, "actually-recent", [
      textEntry("actually-recent", 0, "same", "2026-08-10T10:00:00.000Z"),
    ])

    // when
    const result = await selectDreamConversations({
      transcriptsDir,
      autoSelectMax: 1,
      autoSelectMaxBytes: 10_000,
      now: () => NOW,
    })

    // then
    expect(result.conversationIds).toEqual(["actually-recent"])
  })

  test("#given UTF-8 journals with one fully reflected conversation #when volume and selection run twice #then bytes snapshots ranking and output stay deterministic", async () => {
    // given
    const root = realpathSync.native(await mkdtemp(join(tmpdir(), "dream-selector-")))
    tempDirs.push(root)
    const transcriptsDir = join(root, "transcripts")
    const alpha = [
      textEntry("alpha", 0, "focus 😀", "2026-08-10T11:00:00.000Z"),
      {
        kind: "tool_call" as const,
        argsText: "x",
        resultText: "結果",
        captured_at: "2026-08-10T11:30:00.000Z",
        source_line_id: "alpha:line:1",
        source_message_id: "alpha:message:1",
      },
    ]
    const beta = [textEntry("beta", 0, "already reflected", "2026-08-10T10:00:00.000Z")]
    const gamma = [textEntry("gamma", 0, "focus later", "2026-08-10T09:00:00.000Z")]
    await writeJournal(transcriptsDir, "gamma", gamma, state({ steps_since_last_successful_reflection: 10 }))
    await writeJournal(transcriptsDir, "alpha", alpha, state({ steps_since_last_successful_reflection: 20 }))
    await writeJournal(
      transcriptsDir,
      "beta",
      beta,
      state({ reflected_through_message_id: "beta:message:0" }),
    )
    const options = {
      transcriptsDir,
      currentConversationId: "gamma",
      autoSelectMax: 5,
      autoSelectMaxBytes: 10_000,
      now: () => NOW,
    }

    // when
    const volume = await computeUnreflectedVolume(options)
    const first = await selectDreamConversations(options, { focus: "focus" })
    const second = await selectDreamConversations(options, { focus: "focus" })

    // then
    const alphaBytes = Buffer.byteLength("focus 😀\nx\n結果", "utf8")
    const gammaBytes = Buffer.byteLength("focus later", "utf8")
    expect(volume).toBe(alphaBytes + gammaBytes)
    expect(first).toEqual({ conversationIds: ["gamma", "alpha"], totalBytes: alphaBytes + gammaBytes })
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })
})
