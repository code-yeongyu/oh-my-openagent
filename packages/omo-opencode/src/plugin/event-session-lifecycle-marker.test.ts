import { afterEach, describe, expect, test } from "bun:test"
import { _resetForTesting } from "../features/claude-code-session-state"
import { clearSessionModel, getSessionModel, setSessionModel } from "../shared/session-model-state"
import { clearSessionTools } from "../shared/session-tools-store"
import { handleMessageUpdatedSessionState } from "./event-session-lifecycle"

// fix: compaction-part-marker — the lifecycle writer stored the marker's pin
// model as the session model because it checked only the agent NAME. A marker
// row carries the WORKING agent plus a compaction part; the part is the signal.

describe("event-session-lifecycle marker poison (compaction-part-marker)", () => {
  const sessionID = "ses_lifecycle_marker"
  afterEach(() => {
    _resetForTesting()
    clearSessionModel(sessionID)
    clearSessionTools()
  })

  test("a working-agent message WITH a compaction part does not poison the stored model", () => {
    setSessionModel(sessionID, { providerID: "kimi-for-coding", modelID: "k3-256k" })
    handleMessageUpdatedSessionState({
      props: {
        info: {
          role: "user",
          agent: "Sisyphus - ultraworker",
          providerID: "zai-coding-plan",
          modelID: "glm-5.3-flash",
          sessionID,
        },
        parts: [{ type: "compaction" }],
      },
      noteSessionModel: () => {},
    } as never)
    expect(getSessionModel(sessionID)).toEqual({ providerID: "kimi-for-coding", modelID: "k3-256k" })
  })

  test("a plain working-agent message still updates the stored model", () => {
    handleMessageUpdatedSessionState({
      props: {
        info: {
          role: "user",
          agent: "Sisyphus - ultraworker",
          providerID: "openai",
          modelID: "gpt-6-luna",
          sessionID,
        },
        parts: [{ type: "text", text: "hi" }],
      },
      noteSessionModel: () => {},
    } as never)
    expect(getSessionModel(sessionID)).toEqual({ providerID: "openai", modelID: "gpt-6-luna" })
  })
})
