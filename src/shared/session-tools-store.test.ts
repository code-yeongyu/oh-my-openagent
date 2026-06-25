import { beforeEach, describe, expect, test } from "bun:test"
import { clearSessionTools, getSessionTools, setSessionTools } from "./session-tools-store"

describe("session-tools-store", () => {
  beforeEach(() => {
    clearSessionTools()
  })

  test("returns undefined for unknown session", () => {
    //#given
    const sessionID = "ses_unknown"

    //#when
    const result = getSessionTools(sessionID)

    //#then
    expect(result).toBeUndefined()
  })

  test("stores and retrieves tools for a session", () => {
    //#given
    const sessionID = "ses_abc123"
    const tools = { question: false, task: true, delegate_agent: true }

    //#when
    setSessionTools(sessionID, tools)
    const result = getSessionTools(sessionID)

    //#then
    expect(result).toEqual({ question: false, task: true, delegate_agent: true })
  })

  test("overwrites existing tools for same session", () => {
    //#given
    const sessionID = "ses_abc123"
    setSessionTools(sessionID, { question: false })

    //#when
    setSessionTools(sessionID, { question: true, task: false })
    const result = getSessionTools(sessionID)

    //#then
    expect(result).toEqual({ question: true, task: false })
  })

  test("clearSessionTools removes all entries", () => {
    //#given
    setSessionTools("ses_1", { question: false })
    setSessionTools("ses_2", { task: true })

    //#when
    clearSessionTools()

    //#then
    expect(getSessionTools("ses_1")).toBeUndefined()
    expect(getSessionTools("ses_2")).toBeUndefined()
  })

  test("returns a copy, not a reference", () => {
    //#given
    const sessionID = "ses_abc123"
    const tools = { question: false }
    setSessionTools(sessionID, tools)

    //#when
    const result = getSessionTools(sessionID) as Record<string, boolean>
    result.question = true

    //#then
    expect(getSessionTools(sessionID)).toEqual({ question: false })
  })
})
