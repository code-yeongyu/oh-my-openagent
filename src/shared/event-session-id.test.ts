import { describe, expect, test } from "bun:test"

import { resolveMessageEventSessionID, resolveSessionEventID } from "./event-session-id"

describe("event session id resolvers", () => {
  test("#given legacy message.part.updated properties #when resolving message session id #then part.sessionID is used", () => {
    const sessionID = resolveMessageEventSessionID({
      part: {
        id: "part-1",
        messageID: "msg-1",
        sessionID: "ses-part-only",
        type: "text",
        text: "working",
      },
    })

    expect(sessionID).toBe("ses-part-only")
  })

  test("#given message.updated info id #when resolving message session id #then message id is not mistaken for session id", () => {
    const sessionID = resolveMessageEventSessionID({
      info: {
        id: "msg-not-session",
        role: "assistant",
      },
    })

    expect(sessionID).toBeUndefined()
  })

  test("#given legacy session lifecycle properties #when resolving session id #then info.id is used", () => {
    const sessionID = resolveSessionEventID({
      info: {
        id: "ses-legacy-info-id",
      },
    })

    expect(sessionID).toBe("ses-legacy-info-id")
  })
})
