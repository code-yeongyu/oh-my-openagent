import { describe, expect, test } from "bun:test"

import { MEMORY_NOTICE_CUSTOM_TYPE } from "../../prompt"
import { RECALL_CUSTOM_TYPE } from "../../recall-session-read"
import { GATE_ENTRY_TYPE, NUDGED_ENTRY_TYPE } from "../notice"
import { createSessionBranchSnapshot, HIDDEN_SESSION_CUSTOM_TYPES, sessionEntriesSince } from "./session-read"
import { customEntry, customMessage, harness, jsonOf, memoryRepo, message, sessionContext, tempRoot } from "./test-support"

interface EntryRow {
  readonly cursor: number
  readonly type: string
  readonly role?: string
  readonly text?: string
}

describe("createSessionBranchSnapshot", () => {
  test("#given a hook ctx #when refreshed #then the snapshot is a plain copy of getBranch() read synchronously", () => {
    const snapshot = createSessionBranchSnapshot()
    const live: unknown[] = [message("user", "first", "e1")]
    snapshot.refresh(sessionContext(live))
    live.push(message("assistant", "second", "e2"))

    expect(snapshot.entries()).toHaveLength(1)
    snapshot.refresh(sessionContext(live))
    expect(snapshot.entries()).toHaveLength(2)
  })

  test("#given a ctx without a session manager #when refreshed #then the previous snapshot is kept", () => {
    const snapshot = createSessionBranchSnapshot()
    snapshot.refresh(sessionContext([message("user", "first", "e1")]))
    snapshot.refresh({})
    snapshot.refresh(undefined)
    expect(snapshot.entries()).toHaveLength(1)
  })
})

describe("sessionEntriesSince", () => {
  const caps = { sessionEntries: 30, sessionEntryChars: 600 }

  test("#given hidden memory channels #when listing #then every hidden type is omitted and counted", () => {
    const entries = [
      message("user", "visible user", "e0"),
      message("assistant", "recall hint", "e1", RECALL_CUSTOM_TYPE),
      message("assistant", "legacy hint", "e2", "omo-memorian:recall"),
      message("assistant", "notice", "e3", MEMORY_NOTICE_CUSTOM_TYPE),
      customEntry(NUDGED_ENTRY_TYPE, "e4", { version: 1, nudges: [{ path: "a.md", hint: "h" }] }),
      customEntry(GATE_ENTRY_TYPE, "e5", { version: 1, status: "skipped", candidateCount: 0 }),
      customMessage(RECALL_CUSTOM_TYPE, "e6", "injected"),
      message("assistant", "visible assistant", "e7"),
    ]
    expect(HIDDEN_SESSION_CUSTOM_TYPES.has(NUDGED_ENTRY_TYPE)).toBe(true)
    expect(HIDDEN_SESSION_CUSTOM_TYPES.has(GATE_ENTRY_TYPE)).toBe(true)
    expect(HIDDEN_SESSION_CUSTOM_TYPES.has(RECALL_CUSTOM_TYPE)).toBe(true)

    const page = sessionEntriesSince(entries, -1, caps)
    const rows = page.entries as EntryRow[]
    expect(rows.map((row) => row.text)).toEqual(["visible user", "visible assistant"])
    expect(rows.map((row) => row.cursor)).toEqual([0, 7])
    expect(page.hidden).toBe(6)
    expect(page.next_since).toBe(7)
  })

  test("#given a since cursor #when listing #then only entries after the cursor are returned", () => {
    const entries = [message("user", "a", "e0"), message("assistant", "b", "e1"), message("user", "c", "e2")]
    const page = sessionEntriesSince(entries, 1, caps)
    expect((page.entries as EntryRow[]).map((row) => row.text)).toEqual(["c"])
    expect(page.next_since).toBe(2)
    expect(sessionEntriesSince(entries, 2, caps).entries).toHaveLength(0)
    expect(sessionEntriesSince(entries, 2, caps).next_since).toBe(2)
  })

  test("#given more entries than the page cap #when listing #then the page is bounded and reports the continuation cursor", () => {
    const entries = Array.from({ length: 10 }, (_, i) => message("user", `m${i}`, `e${i}`))
    const page = sessionEntriesSince(entries, -1, { sessionEntries: 4, sessionEntryChars: 600 })
    expect(page.entries).toHaveLength(4)
    expect(page.next_since).toBe(3)
    expect(page.truncated).toBe(true)
  })

  test("#given a long entry with a secret #when listing #then the text is redacted before it is capped", () => {
    const secret = "token=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    const entries = [message("user", `${secret} ${"y".repeat(2000)}`, "e0")]
    const page = sessionEntriesSince(entries, -1, { sessionEntries: 30, sessionEntryChars: 100 })
    const [row] = page.entries as EntryRow[]
    expect(row?.text).not.toContain("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
    expect(row?.text?.length).toBeLessThanOrEqual(100 + 64)
    expect(row?.text).toContain("[truncated")
  })

  test("#given assistant tool calls and tool results #when listing #then they are summarized as bounded text", () => {
    const entries = [
      {
        type: "message", id: "e0", parentId: null, timestamp: "t",
        message: { role: "assistant", content: [{ type: "toolCall", id: "c1", name: "bash", arguments: { command: "ls" } }] },
      },
      {
        type: "message", id: "e1", parentId: null, timestamp: "t",
        message: { role: "toolResult", toolCallId: "c1", toolName: "bash", content: [{ type: "text", text: "a.txt" }] },
      },
    ]
    const rows = sessionEntriesSince(entries, -1, caps).entries as EntryRow[]
    expect(rows).toHaveLength(2)
    expect(rows[0]?.role).toBe("assistant")
    expect(rows[0]?.text).toContain("bash")
    expect(rows[0]?.text).toContain("ls")
    expect(rows[1]?.role).toBe("toolResult")
    expect(rows[1]?.text).toContain("a.txt")
  })
})

describe("session_entries tool", () => {
  test("#given a refreshed snapshot #when the tool is called #then it pages the snapshot from since", async () => {
    const root = await tempRoot()
    const repo = await memoryRepo()
    const h = harness({ workspaceRoot: root, repo })
    h.snapshot.refresh(sessionContext([
      message("user", "one", "e0"),
      customEntry(NUDGED_ENTRY_TYPE, "e1"),
      message("assistant", "two", "e2"),
    ]))

    const page = jsonOf(await h.call("session_entries", { since: 0 }))
    expect((page.entries as EntryRow[]).map((row) => row.text)).toEqual(["two"])
    expect(page.hidden).toBe(1)
    expect(page.next_since).toBe(2)
    expect(h.budget.used).toBe(1)
  })
})
