import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { rm, utimes, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { TranscriptJournal, type TranscriptEntry } from "@oh-my-opencode/memory-core"

import { MemoryFakeExtensionAPI } from "../memory.test-support"
import { scoreDreamCandidate } from "../dream-selector"
import { fakeCommandContext, fakeDeps, invoke, seededRepo, tempIdentity } from "./commands.test-support"
import { registerDreamCommand } from "./dream"
import { stageDreamTranscript } from "./dream-staging"
import type { ManualDreamCommandRequest } from "./types"

const NOW = new Date("2026-08-10T12:00:00.000Z")
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

async function harness() {
  const { root, identity } = await tempIdentity()
  tempDirs.push(root)
  const requests: ManualDreamCommandRequest[] = []
  const deps = fakeDeps(identity, {
    dreamSink: {
      request: (request) => {
        requests.push(request)
        return Promise.resolve({ fired: true, runId: "dream-run-1", status: "active" })
      },
    },
    now: () => NOW.getTime(),
  })
  const pi = new MemoryFakeExtensionAPI()
  registerDreamCommand(pi, deps)
  return { identity, requests, pi, ctx: fakeCommandContext({ agentDir: root }) }
}

function entry(conversationId: string, text: string, capturedAt: string): TranscriptEntry {
  return {
    kind: "user",
    text,
    captured_at: capturedAt,
    source_line_id: `${conversationId}:line`,
    source_message_id: `${conversationId}:message`,
  }
}

async function writeConversation(
  transcriptsDir: string,
  conversationId: string,
  text: string,
  capturedAt: string,
): Promise<void> {
  const journal = new TranscriptJournal({ journalDir: join(transcriptsDir, conversationId), now: () => NOW })
  await journal.append([entry(conversationId, text, capturedAt)])
}

describe("/dream scoring and selection", () => {
  test("#given the fixed letta-parity scoring vector #when scored #then the exact operands and total are reproduced", () => {
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

  test("#given --auto and focus #when invoked #then manual dream selection is delegated without explicit ids", async () => {
    // given
    const { requests, pi, ctx } = await harness()

    // when
    const output = await invoke(pi, "dream", "--auto commit discipline", ctx)

    // then
    expect(requests).toEqual([{ focus: "commit discipline" }])
    expect(output).toContain("dream-run-1")
  })

  test("#given three conversations #when --recent 2 is invoked #then two conversations are chosen by last activity", async () => {
    // given
    const { identity, requests, pi, ctx } = await harness()
    await writeConversation(identity.identityPaths.transcripts, "older", "old", "2026-08-08T12:00:00.000Z")
    await writeConversation(identity.identityPaths.transcripts, "newest", "new", "2026-08-10T11:00:00.000Z")
    await writeConversation(identity.identityPaths.transcripts, "middle", "mid", "2026-08-09T12:00:00.000Z")

    // when
    await invoke(pi, "dream", "--recent 2", ctx)

    // then
    expect(requests[0]?.conversationIds).toEqual(["newest", "middle"])
  })

  test("#given explicit conversation ids #when invoked #then their parsed selection is submitted unchanged", async () => {
    // given
    const { requests, pi, ctx } = await harness()

    // when
    await invoke(pi, "dream", "--conversation sess-a,sess-b", ctx)

    // then
    expect(requests[0]?.conversationIds).toEqual(["sess-a", "sess-b"])
  })
})

describe("/dream external transcript staging and target validation", () => {
  test("#given a senpi JSONL transcript with a malformed line #when imported twice #then message ids are staged once", async () => {
    // given
    const { identity, requests, pi, ctx } = await harness()
    const transcript = join(ctx.agentDir ?? "", "source.jsonl")
    await writeFile(transcript, [
      JSON.stringify({ type: "session", id: "source-session", timestamp: "2026-08-10T10:00:00.000Z" }),
      JSON.stringify({
        type: "message",
        id: "message-1",
        timestamp: "2026-08-10T10:01:00.000Z",
        message: { role: "user", content: [{ type: "text", text: "remember tabs" }] },
      }),
      "{ malformed",
      JSON.stringify({
        type: "message",
        message: { role: "assistant", content: [{ type: "text", text: "tabs are preferred" }] },
      }),
    ].join("\n"), "utf8")
    const fileMtime = new Date("2026-08-10T10:02:00.000Z")
    await utimes(transcript, fileMtime, fileMtime)

    // when
    const first = await stageDreamTranscript(transcript, identity.identityPaths.transcripts, ctx.agentDir ?? "")
    const second = await stageDreamTranscript(transcript, identity.identityPaths.transcripts, ctx.agentDir ?? "")
    await invoke(pi, "dream", `--from transcript:${transcript}`, ctx)
    const rows = await new TranscriptJournal({
      journalDir: join(identity.identityPaths.transcripts, first.conversationId),
    }).readEntries()

    // then
    const firstDerivedId = createHash("sha1")
      .update(`${transcript}:1:remember tabs`)
      .digest("hex")
      .slice(0, 16)
    const secondDerivedId = createHash("sha1")
      .update(`${transcript}:3:tabs are preferred`)
      .digest("hex")
      .slice(0, 16)
    expect(new Set(first.stagedMessageIds)).toEqual(new Set([firstDerivedId, secondDerivedId]))
    expect(second.stagedMessageIds).toEqual([])
    expect(new Set(second.skippedMessageIds)).toEqual(new Set(first.stagedMessageIds))
    expect(requests[0]?.conversationIds).toEqual([first.conversationId])
    expect(new Set(rows.map((row) => row.source_message_id)).size).toBe(2)
    const textRows = rows.filter((row) => row.kind !== "tool_call")
    expect(textRows.map((row) => row.text).sort()).toEqual(["remember tabs", "tabs are preferred"])
    expect(textRows.find((row) => row.source_message_id === firstDerivedId)?.captured_at).toBe(fileMtime.toISOString())
    expect(textRows.find((row) => row.source_message_id === secondDerivedId)?.captured_at).toBe(fileMtime.toISOString())
  })

  test("#given non-session JSONL #when imported #then it is rejected without submitting a dream", async () => {
    // given
    const { identity, requests, pi, ctx } = await harness()
    const transcript = join(ctx.agentDir ?? "", "not-session.jsonl")
    await writeFile(transcript, `${JSON.stringify({ kind: "user", text: "not senpi" })}\n`, "utf8")

    // when
    let stagingError: unknown
    try {
      await stageDreamTranscript(transcript, identity.identityPaths.transcripts, ctx.agentDir ?? "")
    } catch (error) {
      stagingError = error
    }
    const output = await invoke(pi, "dream", `--from transcript:${transcript}`, ctx)

    // then
    expect(stagingError).toBeInstanceOf(TypeError)
    expect(requests).toEqual([])
    expect(ctx.ui.notifications).toEqual([{ message: output, level: "error" }])
    expect(output).toBe((stagingError as Error).message)
  })

  test("#given valid and escaping --to paths #when invoked #then only the memory-relative document is accepted", async () => {
    // given
    const { identity, requests, pi, ctx } = await harness()
    await seededRepo(identity, [
      { relativePath: "reference/style.md", content: "---\ndescription: Style\n---\nOriginal.\n" },
    ])

    // when
    await invoke(pi, "dream", "--conversation sess-a --to reference/style.md", ctx)
    const traversal = await invoke(pi, "dream", "--conversation sess-a --to ../escape", ctx)
    const absolute = await invoke(pi, "dream", "--conversation sess-a --to /abs", ctx)

    // then
    expect(requests).toEqual([{ conversationIds: ["sess-a"], targetDoc: "reference/style.md" }])
    expect(traversal).toContain("memory-repo-relative")
    expect(absolute).toContain("memory-repo-relative")
  })
})
