/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { appendInboxMessage, ensureInbox, readInbox } from "./inbox-store"
import { getTeamInboxPath } from "./paths"

describe("agent-teams inbox store", () => {
  let originalCwd: string
  let tempProjectDir: string

  beforeEach(() => {
    originalCwd = process.cwd()
    tempProjectDir = mkdtempSync(join(tmpdir(), "agent-teams-inbox-store-"))
    process.chdir(tempProjectDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(tempProjectDir, { recursive: true, force: true })
  })

  test("readInbox fails on malformed inbox JSON without overwriting file", () => {
    //#given
    ensureInbox("core", "team-lead")
    const inboxPath = getTeamInboxPath("core", "team-lead")
    writeFileSync(inboxPath, "{", "utf-8")

    //#when
    const readMalformedInbox = () => readInbox("core", "team-lead", false, false)

    //#then
    expect(readMalformedInbox).toThrow("team_inbox_parse_failed")
    expect(readFileSync(inboxPath, "utf-8")).toBe("{")
  })

  test("appendInboxMessage fails on schema-invalid inbox JSON without overwriting file", () => {
    //#given
    ensureInbox("core", "team-lead")
    const inboxPath = getTeamInboxPath("core", "team-lead")
    writeFileSync(inboxPath, JSON.stringify({ invalid: true }), "utf-8")

    //#when
    const appendIntoInvalidInbox = () => {
      appendInboxMessage("core", "team-lead", {
        from: "team-lead",
        text: "hello",
        timestamp: new Date().toISOString(),
        read: false,
        summary: "note",
      })
    }

    //#then
    expect(appendIntoInvalidInbox).toThrow("team_inbox_schema_invalid")
    expect(readFileSync(inboxPath, "utf-8")).toBe(JSON.stringify({ invalid: true }))
  })
})
