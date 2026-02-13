import { afterEach, describe, expect, test } from "bun:test"
import {
  isCouncilRunning,
  markCouncilDone,
  markCouncilRunning,
  _resetForTesting,
  _setTimestampForTesting,
} from "./session-guard"

afterEach(() => {
  _resetForTesting()
})

describe("session-guard", () => {
  //#given no active sessions
  //#when isCouncilRunning is checked
  //#then returns false
  test("returns false for unknown session", () => {
    expect(isCouncilRunning("session-1")).toBe(false)
  })

  //#given a session is marked as running
  //#when isCouncilRunning is checked
  //#then returns true
  test("returns true after markCouncilRunning", () => {
    markCouncilRunning("session-1")

    expect(isCouncilRunning("session-1")).toBe(true)
  })

  //#given a session was marked running then done
  //#when isCouncilRunning is checked
  //#then returns false
  test("returns false after markCouncilDone", () => {
    markCouncilRunning("session-1")
    markCouncilDone("session-1")

    expect(isCouncilRunning("session-1")).toBe(false)
  })

  //#given a session was marked running 6 minutes ago (past 5-minute timeout)
  //#when isCouncilRunning is checked
  //#then stale entry is purged and returns false
  test("purges stale entries older than 5 minutes", () => {
    const sixMinutesAgo = Date.now() - 6 * 60 * 1000
    _setTimestampForTesting("stale-session", sixMinutesAgo)

    expect(isCouncilRunning("stale-session")).toBe(false)
  })

  //#given a session was marked running 4 minutes ago (within 5-minute timeout)
  //#when isCouncilRunning is checked
  //#then entry is kept and returns true
  test("keeps entries within timeout window", () => {
    const fourMinutesAgo = Date.now() - 4 * 60 * 1000
    _setTimestampForTesting("recent-session", fourMinutesAgo)

    expect(isCouncilRunning("recent-session")).toBe(true)
  })

  //#given multiple sessions where one is stale and one is fresh
  //#when isCouncilRunning is checked for the fresh one
  //#then stale entry is purged but fresh entry remains
  test("purges only stale entries while keeping fresh ones", () => {
    const sixMinutesAgo = Date.now() - 6 * 60 * 1000
    _setTimestampForTesting("stale-session", sixMinutesAgo)
    markCouncilRunning("fresh-session")

    expect(isCouncilRunning("stale-session")).toBe(false)
    expect(isCouncilRunning("fresh-session")).toBe(true)
  })
})
