import { describe, expect, test } from "bun:test"

import { createEventHandler } from "./event"
import { getSessionVariant, setSessionVariant } from "../shared/session-model-state"

describe("createEventHandler session variant cleanup", () => {
  test("clears persisted session variant on session.deleted", async () => {
    const sessionID = "ses_cleanup_variant"
    setSessionVariant(sessionID, "high")

    const eventHandler = createEventHandler({
      ctx: {} as never,
      pluginConfig: {} as never,
      firstMessageVariantGate: {
        markSessionCreated: () => {},
        clear: () => {},
      },
      managers: {
        skillMcpManager: {
          disconnectSession: async () => {},
        },
        tmuxSessionManager: {
          onSessionCreated: async () => {},
          onSessionDeleted: async () => {},
        },
      } as never,
      hooks: {
        writeExistingFileGuard: {
          event: async () => {},
        },
      } as never,
    })

    await eventHandler({
      event: {
        type: "session.deleted",
        properties: { info: { id: sessionID } },
      },
    } as never)

    expect(getSessionVariant(sessionID)).toBeUndefined()
  })
})
