import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  assembleAddressBook,
  deriveSurface,
  readDiskSession,
  scanDiskSessions,
  toGatewayAddressEntries,
  type AddressBookHost,
  type DiskSession,
} from "./address-book"
import { readSessionFacts, SESSION_FACTS_WINDOW_BYTES, THREAD_TITLE_MAX_CHARS } from "./session-facts"
import { summary } from "./tools/internals"

const scratch: string[] = []
afterEach(() => {
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true })
})

function live(
  socket: string,
  sessions: Array<{
    sessionId: string
    durableSessionId: string
    sessionPath?: string
    cwd: string
    name?: string
    status?: "opening" | "open" | "closing" | "closed"
  }>,
): AddressBookHost {
  return {
    socket,
    result: {
      sessions: sessions.map((session) => ({ status: "open" as const, ...session })),
    },
  }
}

function disk(partial: Partial<DiskSession> & Pick<DiskSession, "durable_id" | "cwd">): DiskSession {
  return {
    durable_id: partial.durable_id,
    cwd: partial.cwd,
    name: partial.name ?? null,
    created_at: partial.created_at ?? "2026-01-01T00:00:00.000Z",
    updated_at: partial.updated_at ?? "2026-01-01T00:00:00.000Z",
    session_path: partial.session_path ?? `/sessions/${partial.durable_id}.jsonl`,
    source_host: partial.source_host ?? null,
  }
}

describe("assembleAddressBook", () => {
  test("merges live sessions from two reachable hosts", () => {
    const entries = assembleAddressBook(
      [
        live("/tmp/a.sock", [{ sessionId: "route-a", durableSessionId: "durable-a", cwd: "/work/a", name: "A" }]),
        live("/tmp/b.sock", [{ sessionId: "route-b", durableSessionId: "durable-b", cwd: "/work/b", name: "B" }]),
      ],
      [],
    )

    expect(entries.map((entry) => [entry.durable_id, entry.routing_id, entry.liveness, entry.source_host])).toEqual([
      ["durable-a", "route-a", "live", "/tmp/a.sock"],
      ["durable-b", "route-b", "live", "/tmp/b.sock"],
    ])
  })

  test("a killed host flips its disk-backed session to resumable with the same durable id while another stays live", () => {
    const persisted = [
      disk({ durable_id: "durable-a", cwd: "/work/a", source_host: "/tmp/a.sock" }),
      disk({ durable_id: "durable-b", cwd: "/work/b", source_host: "/tmp/b.sock" }),
    ]
    const entries = assembleAddressBook(
      [
        { socket: "/tmp/a.sock", error: new Error("connect ENOENT") },
        live("/tmp/b.sock", [{ sessionId: "route-b2", durableSessionId: "durable-b", cwd: "/work/b" }]),
      ],
      persisted,
    )

    expect(entries.find((entry) => entry.durable_id === "durable-a")).toMatchObject({
      durable_id: "durable-a",
      routing_id: null,
      liveness: "resumable",
      source_host: "/tmp/a.sock",
      error_note: "connect ENOENT",
    })
    expect(entries.find((entry) => entry.durable_id === "durable-b")).toMatchObject({
      routing_id: "route-b2",
      liveness: "live",
    })
  })

  test("distinguishes host error, explicit down, and an empty reachable list without throwing", () => {
    const saved = [
      disk({ durable_id: "errored", cwd: "/error", source_host: "error.sock" }),
      disk({ durable_id: "down", cwd: "/down", source_host: "down.sock" }),
    ]
    const entries = assembleAddressBook(
      [
        { socket: "error.sock", error: "permission denied" },
        { socket: "down.sock", result: { kind: "error", error: { message: "connection refused" } } },
        { socket: "empty.sock", result: { sessions: [] } },
      ],
      saved,
    )

    expect(entries).toHaveLength(2)
    expect(entries.find((entry) => entry.durable_id === "errored")?.error_note).toBe("permission denied")
    expect(entries.find((entry) => entry.durable_id === "down")?.error_note).toBe("connection refused")
  })

  test("includes disk-only sessions, live wins duplicates, and absent names remain null", () => {
    const entries = assembleAddressBook(
      [live("live.sock", [{ sessionId: "routing", durableSessionId: "same", cwd: "/live", name: "Live name" }])],
      [disk({ durable_id: "same", cwd: "/old" }), disk({ durable_id: "disk-only", cwd: "/disk" })],
    )

    expect(entries.find((entry) => entry.durable_id === "same")).toMatchObject({
      cwd: "/live",
      name: "Live name",
      liveness: "live",
    })
    expect(entries.find((entry) => entry.durable_id === "disk-only")).toMatchObject({
      name: null,
      liveness: "resumable",
    })
  })

  test("sorts newest updated_at first and durable id ascending for ties", () => {
    const entries = assembleAddressBook([], [
      disk({ durable_id: "b", cwd: "/b", updated_at: "2026-01-02T00:00:00.000Z" }),
      disk({ durable_id: "c", cwd: "/c", updated_at: "2026-01-03T00:00:00.000Z" }),
      disk({ durable_id: "a", cwd: "/a", updated_at: "2026-01-02T00:00:00.000Z" }),
    ])

    expect(entries.map((entry) => entry.durable_id)).toEqual(["c", "a", "b"])
  })
})

const HEADER_TIME = "2026-09-28T04:19:00.000Z"
const LAST_TIME = "2026-09-28T04:23:30.000Z"
const FIRST_USER = "Please look at why thread_list shows every name as a UUID and 1970 for the creation time on all rows"

/** A senpi v3 session file: header, a model change, the user's first message, an assistant reply, optionally a `/name`. */
function sessionFile(dir: string, durableId: string, options: { readonly name?: string; readonly padding?: number } = {}): string {
  const path = join(dir, `${durableId}.jsonl`)
  const lines: unknown[] = [
    { type: "session", version: 3, id: durableId, timestamp: HEADER_TIME, cwd: "/work/project" },
    { type: "model_change", id: "e1", parentId: null, timestamp: "2026-09-28T04:19:00.500Z", provider: "p", modelId: "m" },
    { type: "message", id: "e2", parentId: "e1", timestamp: "2026-09-28T04:19:01.000Z", message: { role: "user", content: [{ type: "text", text: FIRST_USER }] } },
  ]
  for (let index = 0; index < (options.padding ?? 0); index++) {
    lines.push({ type: "message", id: `p${index}`, parentId: "e2", timestamp: "2026-09-28T04:20:00.000Z", message: { role: "assistant", content: [{ type: "text", text: "x".repeat(1024) }] } })
  }
  if (options.name !== undefined) lines.push({ type: "session_info", id: "e8", parentId: "e2", timestamp: "2026-09-28T04:23:00.000Z", name: options.name })
  lines.push({ type: "message", id: "e9", parentId: "e2", timestamp: LAST_TIME, message: { role: "assistant", content: [{ type: "text", text: "done" }] } })
  writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`)
  return path
}

function tempSessions(): string {
  const dir = mkdtempSync(join(tmpdir(), "thr-facts-"))
  scratch.push(dir)
  return dir
}

describe("address book names, timestamps, endpoints (real JSONL header fixture)", () => {
  test("#given a live host row that reports no name or timestamps #when assembled #then the name comes from /name and the times from the header and last entry, never a UUID or 1970", () => {
    // given
    const path = sessionFile(tempSessions(), "019a0000-0000-7000-8000-00000000000a", { name: "my-tui" })
    const host: AddressBookHost = { socket: "/a/rpc/rpc.sock", legacy: true, result: { sessions: [{ sessionId: "rpc-1", durableSessionId: "019a0000-0000-7000-8000-00000000000a", sessionPath: path, cwd: "/work/project", status: "open", kind: "interactive" }] } }

    // when
    const [entry] = assembleAddressBook([host], [], { facts: readSessionFacts })

    // then
    expect(entry).toMatchObject({ name: "my-tui", title: "my-tui", created_at: HEADER_TIME, updated_at: LAST_TIME, surface: "daemon", alive: true, endpoint: { kind: "rpc_host", socket: "/a/rpc/rpc.sock", routing_id: "rpc-1" } })
    expect(entry?.created_at >= HEADER_TIME).toBe(true)
  })

  test("#given an unnamed session #when assembled #then the title is the first user message cut to the title length and the name stays null", () => {
    const path = sessionFile(tempSessions(), "019a0000-0000-7000-8000-00000000000b")
    const [entry] = assembleAddressBook([{ socket: "/a/rpc/shards/i-00000000000000aa.sock", result: { sessions: [{ sessionId: "rpc-1", durableSessionId: "019a0000-0000-7000-8000-00000000000b", sessionPath: path, cwd: "/w" }] } }], [], { facts: readSessionFacts })
    expect(entry?.name).toBeNull()
    expect(entry?.title).toBe(FIRST_USER.slice(0, THREAD_TITLE_MAX_CHARS))
    expect(entry?.title).not.toContain("019a0000")
    expect(entry?.surface).toBe("desktop")
  })

  test("#given a live session with no name and no user message #when listed through thread_list's summary #then its name is empty and never its UUID", () => {
    // given: a header plus an assistant entry only, and an endpoint that reports no name either
    const dir = tempSessions()
    const durableId = "019a0000-0000-7000-8000-00000000000d"
    const path = join(dir, `${durableId}.jsonl`)
    writeFileSync(path, `${[
      { type: "session", version: 3, id: durableId, timestamp: HEADER_TIME, cwd: "/work/project" },
      { type: "message", id: "e1", parentId: null, timestamp: LAST_TIME, message: { role: "assistant", content: [{ type: "text", text: "hello" }] } },
    ].map((line) => JSON.stringify(line)).join("\n")}\n`)
    const session = { sessionId: "rpc-9", durableSessionId: durableId, sessionPath: path, cwd: "/work/project", status: "open" as const }

    // when
    const [entry] = assembleAddressBook([{ socket: "/a/rpc/rpc.sock", result: { sessions: [session] } }], [], { facts: readSessionFacts })
    const listed = summary(session, entry)
    const unaddressed = summary(session)

    // then
    expect({ name: entry?.name, title: entry?.title, created: entry?.created_at, updated: entry?.updated_at }).toEqual({ name: null, title: null, created: HEADER_TIME, updated: LAST_TIME })
    expect(listed.name).toBe("")
    expect(unaddressed.name).toBe("")
    expect(JSON.stringify([listed.name, unaddressed.name, entry?.title])).not.toContain("019a0000")
  })

  test("#given a transcript larger than two read windows #when its facts are read #then the header, first user message and the /name plus last timestamp in the tail are all found", () => {
    const path = sessionFile(tempSessions(), "019a0000-0000-7000-8000-00000000000c", { name: "long-one", padding: (SESSION_FACTS_WINDOW_BYTES * 3) / 1024 })
    expect(readSessionFacts(path)).toEqual({ durable_id: "019a0000-0000-7000-8000-00000000000c", cwd: "/work/project", created_at: HEADER_TIME, updated_at: LAST_TIME, name: "long-one", first_user_text: FIRST_USER })
  })

  test("#given a terminal endpoint listing its one session by durable id #when assembled #then the entry is a tui thread on that endpoint", () => {
    const entries = assembleAddressBook([{ socket: "/a/rpc/tui/t-0123456789abcdef.sock", endpoint_kind: "tui", alive: true, result: { sessions: [{ sessionId: "dur-tui", cwd: "/w", name: "my-tui", kind: "interactive", created_at: HEADER_TIME, updated_at: LAST_TIME }] } }], [])
    expect(entries).toEqual([expect.objectContaining({ durable_id: "dur-tui", routing_id: "dur-tui", name: "my-tui", surface: "tui", alive: true, created_at: HEADER_TIME, updated_at: LAST_TIME, endpoint: { kind: "tui", socket: "/a/rpc/tui/t-0123456789abcdef.sock", routing_id: "dur-tui" } })])
  })

  test("#given a suspended terminal the engine reports live_unresponsive #when assembled #then its session degrades to disk truth with error_note live_unresponsive and alive false, and the gateway sees it as live_unresponsive (not dead)", () => {
    const socket = "/a/rpc/tui/t-0123456789abcdef.sock"
    const path = sessionFile(tempSessions(), "dur-stopped", { name: "my-tui" })
    const disk = readDiskSession(path, socket)
    if (disk === null) throw new Error("fixture did not parse")
    const entries = assembleAddressBook([{ socket, endpoint_kind: "tui", alive: false, reason: "live_unresponsive", error: "live_unresponsive" }], [disk])
    expect(entries).toEqual([expect.objectContaining({ durable_id: "dur-stopped", status: "resumable", alive: false, error_note: "live_unresponsive", name: "my-tui", created_at: HEADER_TIME, updated_at: LAST_TIME, surface: "tui", endpoint: { kind: "tui", socket, routing_id: null } })])
    expect(toGatewayAddressEntries(entries)[0]).toMatchObject({ thread_id: "dur-stopped", liveness: "live_unresponsive", endpoint: { kind: "tui" } })
  })

  test("#given an endpoint that refused the connection #when handed to the gateway #then the thread is dead, and a listed thread is routable", () => {
    const entries = assembleAddressBook(
      [{ socket: "/gone.sock", error: "connect ECONNREFUSED" }, live("/up.sock", [{ sessionId: "rpc-1", durableSessionId: "up", cwd: "/w" }])],
      [disk({ durable_id: "gone", cwd: "/w", source_host: "/gone.sock" })],
    )
    const liveness = Object.fromEntries(toGatewayAddressEntries(entries).map((entry) => [entry.thread_id, entry.liveness]))
    expect(liveness).toEqual({ gone: "dead", up: "routable" })
  })

  test("#given each endpoint shape #when the surface is derived #then tui, desktop, child and daemon follow endpoint kind, session kind and shard prefix", () => {
    expect(deriveSurface("tui", "interactive", "/a/t-0123456789abcdef.sock")).toBe("tui")
    expect(deriveSurface("rpc_host", "interactive", "/a/i-0123456789abcdef.sock")).toBe("desktop")
    expect(deriveSurface("rpc_host", "interactive", "/a/p-0123456789abcdef.sock")).toBe("child")
    expect(deriveSurface("rpc_host", "worker", "/a/rpc.sock")).toBe("child")
    expect(deriveSurface(undefined, undefined, "/a/rpc.sock")).toBe("daemon")
  })
})

describe("scanDiskSessions", () => {
  test("scans encoded cwd directories and derives durable metadata from JSONL", () => {
    const sessionsDir = mkdtempSync(join(tmpdir(), "address-book-"))
    scratch.push(sessionsDir)
    const projectDir = join(sessionsDir, "--Users-me-project--")
    mkdirSync(projectDir)
    const path = join(projectDir, "session.jsonl")
    writeFileSync(
      path,
      [
        JSON.stringify({ type: "session", version: 3, id: "durable-disk", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/Users/me/project" }),
        JSON.stringify({ type: "session_info", id: "one", parentId: null, timestamp: "2026-01-02T00:00:00.000Z", name: "Old" }),
        JSON.stringify({ type: "session_info", id: "two", parentId: "one", timestamp: "2026-01-03T00:00:00.000Z" }),
      ].join("\n") + "\n",
    )

    expect(scanDiskSessions(sessionsDir)).toEqual([
      {
        durable_id: "durable-disk",
        name: null,
        cwd: "/Users/me/project",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-03T00:00:00.000Z",
        session_path: path,
        source_host: null,
      },
    ])
  })
})
