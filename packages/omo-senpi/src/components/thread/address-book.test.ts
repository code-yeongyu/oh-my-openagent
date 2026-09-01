import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  assembleAddressBook,
  scanDiskSessions,
  type AddressBookHost,
  type DiskSession,
} from "./address-book"

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
