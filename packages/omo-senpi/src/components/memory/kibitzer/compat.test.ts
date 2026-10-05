import { describe, expect, test } from "bun:test"
import { createRecallDrain } from "../recall-drain"
import { judgeTranscript, userTexts } from "../recall-session-read"
import { GATE_ENTRY_TYPE, NUDGED_ENTRY_TYPE } from "./notice"
import { RECALL_CUSTOM_TYPE } from "../recall-session-read"
import { MemoryFakeExtensionAPI } from "../memory.test-support"

describe("Kibitzer session compatibility (#7993)", () => {
  test("emits the Kibitzer channels while registering both generations for replay", () => {
    // Given a drain whose data dependencies must not run during registration.
    const unused = (): never => { throw new Error("registration must not read recall state") }
    const drain = createRecallDrain({
      resolveContext: unused,
      resolveSettings: unused,
      env: {},
      ledgerFor: unused,
      pendingFor: unused,
    })
    const api = new MemoryFakeExtensionAPI()

    // When the extension registers its session renderers.
    drain.register(api)

    // Then new records use the new identity and old records remain renderable.
    expect([NUDGED_ENTRY_TYPE, GATE_ENTRY_TYPE, RECALL_CUSTOM_TYPE]).toEqual([
      "omo-kibitzer:nudged", "omo-kibitzer:gate", "omo-kibitzer:recall",
    ])
    for (const kind of ["nudged", "gate", "recall"]) {
      const current = api.entryRenderers.find((entry) => entry.customType === `omo-kibitzer:${kind}`)?.renderer
      const legacy = api.entryRenderers.find((entry) => entry.customType === `omo-memorian:${kind}`)?.renderer
      expect(current).toBeDefined()
      expect(legacy).toBe(current)
    }
  })

  test.each(["omo-kibitzer:recall", "omo-memorian:recall"])(
    "excludes %s from both transcript windows without excluding conversation",
    (customType) => {
      // Given a resumed conversation containing either generation of recall hint.
      const entries = [
        { type: "message", message: { role: "user", content: "USER_CONTROL" } },
        { type: "message", message: { role: "user", customType, content: "HIDDEN_HINT" } },
        { type: "message", message: { role: "assistant", content: "ASSISTANT_CONTROL" } },
      ]

      // When the planner and judge build their independent conversation windows.
      const users = userTexts(entries)
      const transcript = judgeTranscript(entries)

      // Then the hint cannot cause a second recall but real turns remain available.
      expect(users).toEqual(["USER_CONTROL"])
      expect(transcript).toEqual([
        { role: "user", text: "USER_CONTROL" },
        { role: "assistant", text: "ASSISTANT_CONTROL" },
      ])
    },
  )
})
