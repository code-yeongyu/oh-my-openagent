import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rmSyncEfaultTolerant } from "./teardown.test-support"

import {
  buildIdentityPaths,
  REDACTED_REASONING_TEXT,
  type MemoryIdentityPaths,
} from "@oh-my-opencode/memory-core"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createMemoryJournalWiring } from "./journal-wiring"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSyncEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

function fixture(): { readonly paths: MemoryIdentityPaths } {
  const root = mkdtempSync(join(tmpdir(), "omo-memory-journal-wiring-"))
  roots.push(root)
  return { paths: buildIdentityPaths(root, "agent-test") }
}

type ToolCallSpec = {
  readonly id: string
  readonly name: string
  readonly args?: Record<string, unknown>
}

type AssistantSpec = {
  readonly texts?: readonly string[]
  readonly thinkings?: readonly (string | { readonly redacted: true })[]
  readonly toolCalls?: readonly ToolCallSpec[]
  readonly errorMessage?: string
}

function userEntry(id: string, content: string | readonly Record<string, unknown>[]): Record<string, unknown> {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-08-09T00:00:00.000Z",
    message: { role: "user", content, timestamp: 1 },
  }
}

function assistantEntry(id: string, spec: AssistantSpec): Record<string, unknown> {
  const content: Record<string, unknown>[] = []
  for (const text of spec.texts ?? []) content.push({ type: "text", text })
  for (const thinking of spec.thinkings ?? []) {
    content.push(
      typeof thinking === "string"
        ? { type: "thinking", thinking }
        : { type: "thinking", thinking: "", redacted: true },
    )
  }
  for (const call of spec.toolCalls ?? []) {
    content.push({ type: "toolCall", id: call.id, name: call.name, arguments: call.args ?? {} })
  }
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-08-09T00:00:01.000Z",
    message: {
      role: "assistant",
      content,
      stopReason: "stop",
      ...(spec.errorMessage === undefined ? {} : { errorMessage: spec.errorMessage }),
      timestamp: 2,
    },
  }
}

function toolResultEntry(
  id: string,
  toolCallId: string,
  text: string,
  isError = false,
): Record<string, unknown> {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-08-09T00:00:02.000Z",
    message: {
      role: "toolResult",
      toolCallId,
      toolName: "read",
      content: [{ type: "text", text }],
      isError,
      timestamp: 3,
    },
  }
}

function compactionEntry(id: string): Record<string, unknown> {
  return {
    type: "compaction",
    id,
    parentId: null,
    timestamp: "2026-08-09T00:00:03.000Z",
    summary: "summary",
    firstKeptEntryId: "u1",
    tokensBefore: 100,
  }
}

function sessionCtx(
  entries: readonly Record<string, unknown>[],
  sessionId = "session-alpha",
): Record<string, unknown> {
  return {
    sessionManager: {
      getBranch: () => entries,
      getSessionId: () => sessionId,
    },
  }
}

describe("memory journal wiring", () => {
  test("#given a 3-turn session with a tool call #when agent_settled fires #then rows are projected and steps equal 3", async () => {
    const { paths } = fixture()
    const pi = new FakeExtensionAPI()
    const wiring = createMemoryJournalWiring({ identityPaths: paths })
    wiring.register(pi)
    const entries = [
      userEntry("u1", "first question"),
      assistantEntry("a1", { texts: ["answer one"] }),
      compactionEntry("c0"),
      userEntry("u2", "second question"),
      assistantEntry("a2", {
        texts: ["answer two"],
        toolCalls: [{ id: "c1", name: "read", args: { path: "/tmp/x" } }],
      }),
      toolResultEntry("tr1", "c1", "file body"),
      userEntry("u3", "third question"),
      assistantEntry("a3", { texts: ["answer three"] }),
    ]

    const results = await pi.dispatch("agent_settled", {}, sessionCtx(entries))

    expect(results).toEqual([{ appended: 7, skipped: 0 }])
    const journal = wiring.journalFor("session-alpha")
    const rows = await journal.readEntries()
    expect(rows.map((row) => row.kind)).toEqual([
      "user", "assistant", "user", "assistant", "tool_call", "user", "assistant",
    ])
    expect(rows.map((row) => row.source_line_id)).toEqual([
      "u1:user", "a1:assistant", "u2:user", "a2:assistant", "a2:tool:c1", "u3:user", "a3:assistant",
    ])
    expect(rows[4]).toMatchObject({
      kind: "tool_call",
      name: "read",
      argsText: "{\"path\":\"/tmp/x\"}",
      resultText: "file body",
      resultOk: true,
    })
    const state = await journal.getState()
    expect(state.total_completed_steps).toBe(3)
    expect(state.steps_since_last_successful_reflection).toBe(3)
    expect(existsSync(join(paths.transcripts, "session-alpha", "transcript.jsonl"))).toBe(true)
  })

  test("#given turn 1 journaled before a crash #when session_start reconciles the full branch #then only missing rows are appended", async () => {
    const { paths } = fixture()
    const turn1 = [userEntry("u1", "first question"), assistantEntry("a1", { texts: ["answer one"] })]
    const turn2 = [userEntry("u2", "second question"), assistantEntry("a2", { texts: ["answer two"] })]
    const beforeCrash = createMemoryJournalWiring({ identityPaths: paths })
    const pi1 = new FakeExtensionAPI()
    beforeCrash.register(pi1)
    await pi1.dispatch("agent_settled", {}, sessionCtx(turn1))

    const afterRestart = createMemoryJournalWiring({ identityPaths: paths })
    const pi2 = new FakeExtensionAPI()
    afterRestart.register(pi2)
    const recovered = await pi2.dispatch("session_start", {}, sessionCtx([...turn1, ...turn2]))

    expect(recovered).toEqual([{ appended: 2, skipped: 2 }])
    const rows = await afterRestart.journalFor("session-alpha").readEntries()
    expect(rows).toHaveLength(4)
    expect(new Set(rows.map((row) => row.source_line_id)).size).toBe(4)
    const settledAgain = await pi2.dispatch("agent_settled", {}, sessionCtx([...turn1, ...turn2]))
    expect(settledAgain).toEqual([{ appended: 0, skipped: 4 }])
    const state = await afterRestart.journalFor("session-alpha").getState()
    expect(state.total_completed_steps).toBe(2)
  })

  test("#given a tool-only assistant message #when settled #then no assistant row and no step increment", async () => {
    const { paths } = fixture()
    const pi = new FakeExtensionAPI()
    const wiring = createMemoryJournalWiring({ identityPaths: paths })
    wiring.register(pi)
    const entries = [
      userEntry("u1", "run ls"),
      assistantEntry("a1", { toolCalls: [{ id: "c1", name: "bash", args: { command: "ls" } }] }),
      toolResultEntry("tr1", "c1", "total 0"),
    ]

    const results = await pi.dispatch("agent_settled", {}, sessionCtx(entries))

    expect(results).toEqual([{ appended: 2, skipped: 0 }])
    const rows = await wiring.journalFor("session-alpha").readEntries()
    expect(rows.map((row) => row.kind)).toEqual(["user", "tool_call"])
    expect(rows[1]).toMatchObject({
      source_line_id: "a1:tool:c1",
      resultText: "total 0",
      resultOk: true,
    })
    const state = await wiring.journalFor("session-alpha").getState()
    expect(state.total_completed_steps).toBe(0)
  })

  test("#given redacted and visible thinking blocks #when settled #then reasoning rows use the placeholder and source index", async () => {
    const { paths } = fixture()
    const pi = new FakeExtensionAPI()
    const wiring = createMemoryJournalWiring({ identityPaths: paths })
    wiring.register(pi)
    const entries = [
      userEntry("u1", "think"),
      assistantEntry("a1", { texts: ["done"], thinkings: [{ redacted: true }, "visible thought"] }),
    ]

    await pi.dispatch("agent_settled", {}, sessionCtx(entries))

    const rows = await wiring.journalFor("session-alpha").readEntries()
    expect(rows.map((row) => row.kind)).toEqual(["user", "assistant", "reasoning", "reasoning"])
    expect(rows[2]).toMatchObject({ text: REDACTED_REASONING_TEXT, source_line_id: "a1:reasoning:0" })
    expect(rows[3]).toMatchObject({ text: "visible thought", source_line_id: "a1:reasoning:1" })
  })

  test("#given an aborted run with an error message #when settled #then rows still journal including an error row", async () => {
    const { paths } = fixture()
    const pi = new FakeExtensionAPI()
    const wiring = createMemoryJournalWiring({ identityPaths: paths })
    wiring.register(pi)
    const entries = [
      userEntry("u1", "go"),
      assistantEntry("a1", { texts: ["partial answer"], errorMessage: "request aborted" }),
    ]

    const results = await pi.dispatch("agent_settled", {}, sessionCtx(entries))

    expect(results).toEqual([{ appended: 3, skipped: 0 }])
    const rows = await wiring.journalFor("session-alpha").readEntries()
    expect(rows.map((row) => row.kind)).toEqual(["user", "assistant", "error"])
    expect(rows[2]).toMatchObject({ text: "request aborted", source_line_id: "a1:error" })
    const state = await wiring.journalFor("session-alpha").getState()
    expect(state.total_completed_steps).toBe(1)
  })

  test("#given message_end and turn_end #when dispatched #then nothing is written and only settle/start handlers exist", async () => {
    const { paths } = fixture()
    const pi = new FakeExtensionAPI()
    const wiring = createMemoryJournalWiring({ identityPaths: paths })
    wiring.register(pi)
    const entries = [userEntry("u1", "hi"), assistantEntry("a1", { texts: ["hello"] })]

    expect(pi.handlers.map((handler) => handler.event)).toEqual(["session_start", "agent_settled"])
    expect(await pi.dispatch("message_end", {}, sessionCtx(entries))).toEqual([])
    expect(await pi.dispatch("turn_end", {}, sessionCtx(entries))).toEqual([])
    expect(await wiring.journalFor("session-alpha").readEntries()).toEqual([])
  })

  test("#given block-structured user content and split assistant texts #when settled #then texts concatenate canonically", async () => {
    const { paths } = fixture()
    const pi = new FakeExtensionAPI()
    const wiring = createMemoryJournalWiring({ identityPaths: paths })
    wiring.register(pi)
    const entries = [
      userEntry("u1", [
        { type: "text", text: "hi" },
        { type: "image", data: "Zm9v", mimeType: "image/png" },
        { type: "text", text: "there" },
      ]),
      assistantEntry("a1", { texts: ["Hello", "", "world"] }),
    ]

    await pi.dispatch("agent_settled", {}, sessionCtx(entries))

    const rows = await wiring.journalFor("session-alpha").readEntries()
    expect(rows.map((row) => row.kind)).toEqual(["user", "assistant"])
    expect(rows[0]).toMatchObject({ text: "hi\nthere" })
    expect(rows[1]).toMatchObject({ text: "Hello\nworld" })
  })

  test("#given a fresh session #when session_start fires #then the branch reconciles like a settle", async () => {
    const { paths } = fixture()
    const pi = new FakeExtensionAPI()
    const wiring = createMemoryJournalWiring({ identityPaths: paths })
    wiring.register(pi)
    const entries = [userEntry("u1", "hi"), assistantEntry("a1", { texts: ["hello"] })]

    const results = await pi.dispatch("session_start", {}, sessionCtx(entries))

    expect(results).toEqual([{ appended: 2, skipped: 0 }])
    const state = await wiring.journalFor("session-alpha").getState()
    expect(state.total_completed_steps).toBe(1)
  })

  test("#given an errored tool result #when settled #then the tool_call row joins resultOk false", async () => {
    const { paths } = fixture()
    const pi = new FakeExtensionAPI()
    const wiring = createMemoryJournalWiring({ identityPaths: paths })
    wiring.register(pi)
    const entries = [
      userEntry("u1", "read it"),
      assistantEntry("a1", { toolCalls: [{ id: "c1", name: "read", args: { path: "/missing" } }] }),
      toolResultEntry("tr1", "c1", "ENOENT: no such file", true),
    ]

    await pi.dispatch("agent_settled", {}, sessionCtx(entries))

    const rows = await wiring.journalFor("session-alpha").readEntries()
    expect(rows[1]).toMatchObject({
      kind: "tool_call",
      resultText: "ENOENT: no such file",
      resultOk: false,
    })
  })

  test("#given a malformed event context #when handlers fire #then the reconcile is a no-op", async () => {
    const { paths } = fixture()
    const pi = new FakeExtensionAPI()
    const wiring = createMemoryJournalWiring({ identityPaths: paths })
    wiring.register(pi)

    expect(await pi.dispatch("agent_settled", {}, undefined)).toEqual([{ appended: 0, skipped: 0 }])
    expect(await pi.dispatch("agent_settled", {}, { sessionManager: {} })).toEqual([{ appended: 0, skipped: 0 }])
  })

  test("#given the journal lock is contended by a live foreign owner #when agent_settled fires #then the handler degrades to a no-op and warns instead of rejecting", async () => {
    // given: a transcript dir whose state.lock is held by a live foreign process
    const { paths } = fixture()
    const journalDir = join(paths.transcripts, "session-contended")
    mkdirSync(journalDir, { recursive: true })
    const foreign = Bun.spawn({
      cmd: [process.execPath, "-e", "setTimeout(() => undefined, 60_000)"],
      stdout: "ignore",
      stderr: "ignore",
    })
    const warnings: Array<{ message: string; details?: unknown }> = []
    try {
      writeFileSync(join(journalDir, "state.lock"), `${foreign.pid}\n`, { encoding: "utf8", mode: 0o600 })
      const pi = new FakeExtensionAPI()
      const wiring = createMemoryJournalWiring({
        identityPaths: paths,
        logger: { info: () => {}, warn: (message, details) => warnings.push({ message, details }), error: () => {} },
      })
      wiring.register(pi)
      const entries = [userEntry("u1", "question"), assistantEntry("a1", { texts: ["answer"] })]

      // when: the settled handler runs against the contended journal
      const result = await pi.dispatch("agent_settled", {}, sessionCtx(entries, "session-contended"))

      // then: the handler resolved to a no-op append (no EEXIST escaped), and the lock contention was warned
      expect(result).toEqual([{ appended: 0, skipped: 0 }])
      expect(warnings.length).toBe(1)
      expect(warnings[0]?.message).toMatch(/lock contention|journal/)
    } finally {
      foreign.kill()
      await foreign.exited
    }
  }, 30_000)
})
