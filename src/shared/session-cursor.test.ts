import { beforeEach, describe, expect, it } from "bun:test"
import { getNewMessages, resetMessageCursor } from "./session-cursor"

describe("getNewMessages", () => {
  const sessionID = "session-123"

  const buildMessage = (id: string, created: number) => ({
    info: { id, time: { created } },
  })

  beforeEach(() => {
    resetMessageCursor(sessionID)
  })

  it("returns all messages on first read and none on repeat", () => {
    // #given
    const messages = [buildMessage("m1", 1), buildMessage("m2", 2)]

    // #when
    const first = getNewMessages(sessionID, messages)
    const second = getNewMessages(sessionID, messages)

    // #then
    expect(first).toEqual(messages)
    expect(second).toEqual([])
  })

  it("returns only new messages after cursor advances", () => {
    // #given
    const messages = [buildMessage("m1", 1), buildMessage("m2", 2)]
    getNewMessages(sessionID, messages)
    const extended = [...messages, buildMessage("m3", 3)]

    // #when
    const next = getNewMessages(sessionID, extended)

    // #then
    expect(next).toEqual([extended[2]])
  })

  it("resets when message history shrinks", () => {
    // #given
    const messages = [buildMessage("m1", 1), buildMessage("m2", 2)]
    getNewMessages(sessionID, messages)
    const shorter = [buildMessage("n1", 1)]

    // #when
    const next = getNewMessages(sessionID, shorter)

    // #then
    expect(next).toEqual(shorter)
  })
})
