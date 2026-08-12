import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SenpiSessionProvider, searchTranscripts } from "./index"

// Fixtures mirror the on-disk senpi format verified against
// senpi packages/coding-agent/src/core/session-manager.ts (SessionHeader / SessionEntryBase /
// SessionMessageEntry) and a real ~/.senpi/agent/sessions/*.jsonl transcript.

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

function sessionsRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "senpi-sessions-"))
  roots.push(root)
  return root
}

function header(id: string, cwd = "/tmp/project"): string {
  return JSON.stringify({ type: "session", version: 3, id, timestamp: "2026-08-05T17:09:02.186Z", cwd })
}

function userEntry(id: string, parentId: string | null, text: string, timestamp = "2026-08-05T17:09:02.340Z"): string {
  return JSON.stringify({
    type: "message",
    id,
    parentId,
    timestamp,
    message: { role: "user", content: [{ type: "text", text }], timestamp: 1785949742316 },
  })
}

function writeSession(dir: string, name: string, lines: string[]): string {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, name)
  writeFileSync(file, `${lines.join("\n")}\n`)
  return file
}

describe("SenpiSessionProvider", () => {
  it("#given a session file #when conversations are listed #then the file is one conversation keyed by the header id", () => {
    // given
    const root = sessionsRoot()
    writeSession(join(root, "--tmp-project--"), "2026-08-05T17-09-02-186Z_sess-a.jsonl", [
      header("sess-a"),
      userEntry("e1", null, "hello world"),
    ])

    // when
    const conversations = new SenpiSessionProvider({ sessionsDir: root }).listConversations()

    // then
    expect(conversations).toHaveLength(1)
    expect(conversations[0]?.id).toBe("sess-a")
    expect(conversations[0]?.messages.map((document) => document.id)).toEqual(["e1"])
  })

  it("#given user, assistant and tool-result entries #when mapped #then text, reasoning, tool names, arguments and returns are searchable", () => {
    // given
    const root = sessionsRoot()
    writeSession(join(root, "--tmp-project--"), "sess-b.jsonl", [
      header("sess-b"),
      JSON.stringify({ type: "model_change", id: "mc", parentId: null, timestamp: "2026-08-05T17:09:02.282Z", provider: "apitopia", modelId: "kimi-k3" }),
      userEntry("u1", "mc", "run the migration"),
      JSON.stringify({
        type: "message",
        id: "a1",
        parentId: "u1",
        timestamp: "2026-08-05T17:09:09.088Z",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "starting now" },
            { type: "thinking", thinking: "consider rollback safety" },
            { type: "toolCall", id: "call-1", name: "bash", arguments: { cmd: "psql migrate" } },
          ],
          usage: { input: 1, output: 1 },
        },
      }),
      JSON.stringify({
        type: "message",
        id: "t1",
        parentId: "a1",
        timestamp: "2026-08-05T17:09:12.000Z",
        message: {
          role: "toolResult",
          toolCallId: "call-1",
          toolName: "bash",
          content: [{ type: "text", text: "migration applied" }],
          isError: false,
        },
      }),
    ])
    const provider = new SenpiSessionProvider({ sessionsDir: root })

    // when
    const documents = provider.listConversations()[0]?.messages ?? []
    const byId = new Map(documents.map((document) => [document.id, document]))

    // then
    expect(documents.map((document) => document.id)).toEqual(["u1", "a1", "t1"])
    expect(byId.get("u1")?.messageType).toBe("user")
    expect(byId.get("u1")?.content).toBe("run the migration")
    expect(byId.get("a1")?.content).toBe("starting now")
    expect(byId.get("a1")?.reasoning).toBe("consider rollback safety")
    expect(byId.get("a1")?.toolCalls).toEqual([{ name: "bash", arguments: '{"cmd":"psql migrate"}' }])
    expect(byId.get("t1")?.toolCalls).toEqual([{ name: "bash" }])
    expect(byId.get("t1")?.toolReturn).toBe("migration applied")
    expect(byId.get("t1")?.date).toBe("2026-08-05T17:09:12.000Z")
    expect(searchTranscripts(provider, "rollback").map((result) => result.messageId)).toEqual(["a1"])
    expect(searchTranscripts(provider, '"psql migrate"').map((result) => result.messageId)).toEqual(["a1"])
    expect(searchTranscripts(provider, "applied").map((result) => result.messageId)).toEqual(["t1"])
  })

  it("#given branches that repeat a shared ancestor entry #when mapped #then each entry id appears once", () => {
    // given
    const root = sessionsRoot()
    writeSession(join(root, "--tmp-project--"), "sess-c.jsonl", [
      header("sess-c"),
      userEntry("shared", null, "shared ancestor"),
      userEntry("branch-1", "shared", "first branch"),
      userEntry("shared", null, "shared ancestor"),
      userEntry("branch-2", "shared", "second branch"),
    ])

    // when
    const documents = new SenpiSessionProvider({ sessionsDir: root }).listConversations()[0]?.messages ?? []

    // then
    expect(documents.map((document) => document.id)).toEqual(["shared", "branch-1", "branch-2"])
  })

  it("#given a malformed line and a missing header #when read #then bad lines are skipped and the rest of the file survives", () => {
    // given
    const root = sessionsRoot()
    writeSession(join(root, "--tmp-project--"), "sess-d.jsonl", [
      header("sess-d"),
      "{ this is not json",
      userEntry("ok-1", null, "still readable"),
      "",
      JSON.stringify({ type: "message", id: "no-message-field", parentId: null, timestamp: "2026-08-05T17:09:02.340Z" }),
      userEntry("ok-2", "ok-1", "also readable"),
    ])
    writeSession(join(root, "--tmp-project--"), "headerless.jsonl", [userEntry("orphan", null, "no header here")])

    // when
    const conversations = new SenpiSessionProvider({ sessionsDir: root }).listConversations()
    const withHeader = conversations.find((item) => item.id === "sess-d")
    const headerless = conversations.find((item) => item.id === "headerless")

    // then
    expect(withHeader?.messages.map((document) => document.id)).toEqual(["ok-1", "ok-2"])
    expect(headerless?.messages.map((document) => document.id)).toEqual(["orphan"])
  })

  it("#given an archived sidecar, an excluded directory and a hidden-marker hook #when listed #then those conversations are hidden but still readable with includeHidden", () => {
    // given
    const root = sessionsRoot()
    const projectDir = join(root, "--tmp-project--")
    writeSession(projectDir, "plain.jsonl", [header("plain"), userEntry("p1", null, "beta visible")])
    writeSession(projectDir, "archived.jsonl", [header("archived"), userEntry("a1", null, "beta archived")])
    writeFileSync(join(projectDir, "archived.jsonl.archived"), "")
    writeSession(join(root, "--omo-reflection--"), "reflect.jsonl", [header("reflect"), userEntry("r1", null, "beta reflection")])
    writeSession(projectDir, "task-child.jsonl", [header("task-child"), userEntry("k1", null, "beta task child")])
    const provider = new SenpiSessionProvider({
      sessionsDir: root,
      excludedDirs: ["--omo-reflection--"],
      isHidden: (candidate) => candidate.header?.id === "task-child",
    })

    // when
    const conversations = provider.listConversations()
    const visible = searchTranscripts(provider, "beta")
    const all = searchTranscripts(provider, "beta", { includeHidden: true })

    // then
    expect(conversations.filter((item) => item.hidden !== true).map((item) => item.id)).toEqual(["plain"])
    expect(visible.map((result) => result.messageId)).toEqual(["p1"])
    expect(all.map((result) => result.messageId).sort()).toEqual(["a1", "k1", "p1", "r1"])
  })

  it("#given a hidden marker file inside a session directory #when listed #then every session in that directory is hidden", () => {
    // given
    const root = sessionsRoot()
    const hiddenDir = join(root, "--tmp-hidden--")
    writeSession(hiddenDir, "one.jsonl", [header("one"), userEntry("h1", null, "beta hidden dir")])
    writeFileSync(join(hiddenDir, ".omo-hidden"), "")
    writeSession(join(root, "--tmp-project--"), "two.jsonl", [header("two"), userEntry("v1", null, "beta plain dir")])
    const provider = new SenpiSessionProvider({ sessionsDir: root, hiddenMarkerFile: ".omo-hidden" })

    // when
    const results = searchTranscripts(provider, "beta")

    // then
    expect(results.map((result) => result.messageId)).toEqual(["v1"])
  })

  it("#given a missing sessions directory or non-jsonl files #when listed #then reading is empty and never throws", () => {
    // given
    const root = sessionsRoot()
    writeFileSync(join(root, "notes.txt"), "not a session")
    const missing = new SenpiSessionProvider({ sessionsDir: join(root, "does-not-exist") })

    // when
    const empty = missing.listConversations()
    const ignored = new SenpiSessionProvider({ sessionsDir: root }).listConversations()

    // then
    expect(empty).toEqual([])
    expect(ignored).toEqual([])
  })
})
