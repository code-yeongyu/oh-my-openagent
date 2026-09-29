import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Database } from "bun:sqlite"
import { afterEach, describe, expect, test } from "bun:test"

import { createAdapterState } from "./adapter-state"
import { presentSession, sessionCatalog } from "./catalog"

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("OpenCode V2 session catalog", () => {
  test("copies location.directory and keeps updated time", () => {
    const session = presentSession({
      id: "ses_1",
      location: { directory: "/tmp/project" },
      time: { created: 10, updated: 20 },
    })
    expect(session.directory).toBe("/tmp/project")
    expect(session.time).toEqual({ created: 10, updated: 20 })
  })

  test("reads a session that existed before the plugin from the database", async () => {
    const directory = mkdtempSync(join(tmpdir(), "omo-v2-db-"))
    directories.push(directory)
    const file = join(directory, "opencode.db")
    const db = new Database(file)
    db.run("CREATE TABLE session_v2 (id TEXT, title TEXT, directory TEXT, parent_id TEXT, time_created INTEGER, time_updated INTEGER)")
    db.run(
      "INSERT INTO session_v2 (id, title, directory, parent_id, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?)",
      ["ses_before", "before-plugin", "/tmp/project", null, 10, 20],
    )
    db.close()

    const sessions = await sessionCatalog({
      origin: undefined,
      fetchImpl: fetch,
      state: createAdapterState(join(directory, "state")),
      known: [],
      databaseFile: file,
    })
    expect(sessions.map((session) => session.id)).toEqual(["ses_before"])
    expect(sessions[0]?.directory).toBe("/tmp/project")
    expect(sessions[0]?.time).toEqual({ created: 10, updated: 20 })
    expect(sessions[0]?.parentID).toBeUndefined()
  })

  test("uses the database when the HTTP session list cannot be reached", async () => {
    const directory = mkdtempSync(join(tmpdir(), "omo-v2-db-"))
    directories.push(directory)
    const file = join(directory, "opencode.db")
    const db = new Database(file)
    db.run("CREATE TABLE session_v2 (id TEXT, title TEXT, directory TEXT, parent_id TEXT, time_created INTEGER, time_updated INTEGER)")
    db.run(
      "INSERT INTO session_v2 (id, title, directory, parent_id, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?)",
      ["ses_before", "before-plugin", "/tmp/project", null, 10, 20],
    )
    db.close()

    const sessions = await sessionCatalog({
      origin: "http://127.0.0.1:9",
      fetchImpl: async () => {
        throw new Error("offline")
      },
      state: createAdapterState(join(directory, "state")),
      known: [],
      databaseFile: file,
    })
    expect(sessions.map((session) => session.id)).toEqual(["ses_before"])
  })
})
