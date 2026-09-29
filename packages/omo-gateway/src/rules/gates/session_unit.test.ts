import { describe, expect, it } from "bun:test"
import { SESSION_UNIT_DEFAULTS } from "../gates"
import { gate, sessionUnitFor } from "./session_unit"
import { eventOf, repaired } from "./testing"

const inThread = eventOf({ kind: "thread_reply", key: { platform: "slack", account_id: "T000TEST", chat_id: "C000WORK", thread_id: "M000ROOT" } })

describe("session_unit gate", () => {
  it("#given the defaults #when events arrive on each surface #then the default unit and key apply", () => {
    expect(sessionUnitFor(inThread, SESSION_UNIT_DEFAULTS)).toMatchObject({ surface: "slack", unit: "thread", overridden: false, key: { thread_id: "M000ROOT" } })
    const notion = eventOf({ key: { platform: "notion", account_id: "W000", chat_id: "PAGE1", thread_id: "D1" }, kind: "thread_reply" })
    expect(sessionUnitFor(notion, {})).toMatchObject({ surface: "notion", unit: "discussion", key: { chat_id: "PAGE1", thread_id: "D1" } })
    const dm = eventOf({ kind: "dm", key: { platform: "telegram", account_id: "B000", chat_id: "U000ALICE", thread_id: null } })
    expect(sessionUnitFor(dm, {})).toMatchObject({ surface: "dm", unit: "dm_thread" })
    const telegram = eventOf({ key: { platform: "telegram", account_id: "B000", chat_id: "G1", thread_id: "T9" }, kind: "thread_reply" })
    expect(sessionUnitFor(telegram, {})).toMatchObject({ unit: "topic", key: { thread_id: "T9" } })
  })

  it("#given an override (one Notion page = one session) #when a discussion reply arrives #then the page is the unit", () => {
    const notion = eventOf({ key: { platform: "notion", account_id: "W000", chat_id: "PAGE1", thread_id: "D1" }, kind: "thread_reply" })
    expect(sessionUnitFor(notion, { ...SESSION_UNIT_DEFAULTS, notion: "page" })).toMatchObject({ unit: "page", overridden: true, key: { chat_id: "PAGE1", thread_id: null } })
  })

  it("#given an invalid unit for a platform #when resolved #then it throws a params error", () => {
    expect(() => sessionUnitFor(inThread, { slack: "page" })).toThrow("session_unit 'slack' must be one of thread, chat")
  })

  it("#given a route without a unit #when the gate runs #then it sets unit and session key; rerun #then ok", async () => {
    const start = { event: inThread, unit: null, session_key: null, open_work_item: false }
    const routed = repaired(await gate.run(start, { slack: "chat" }, {}))
    expect(routed).toMatchObject({ unit: "chat", session_key: { chat_id: "C000WORK", thread_id: null } })
    expect(await gate.run(routed, { slack: "chat" }, {})).toEqual({ ok: true })
  })
})
