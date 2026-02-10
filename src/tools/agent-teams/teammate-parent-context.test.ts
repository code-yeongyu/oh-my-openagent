/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { buildTeamParentToolContext } from "./teammate-parent-context"

describe("agent-teams teammate parent context", () => {
  test("forwards incoming abort signal to parent context resolver", () => {
    //#given
    const abortSignal = new AbortController().signal

    //#when
    const parentToolContext = buildTeamParentToolContext({
      sessionID: "ses-main",
      messageID: "msg-main",
      agent: "sisyphus",
      abort: abortSignal,
    })

    //#then
    expect(parentToolContext.abort).toBe(abortSignal)
    expect(parentToolContext.sessionID).toBe("ses-main")
    expect(parentToolContext.messageID).toBe("msg-main")
    expect(parentToolContext.agent).toBe("sisyphus")
  })

  test("leaves agent undefined if missing in tool context", () => {
    //#when
    const parentToolContext = buildTeamParentToolContext({
      sessionID: "ses-main",
      messageID: "msg-main",
      abort: new AbortController().signal,
    })

    //#then
    expect(parentToolContext.agent).toBeUndefined()
  })
})
