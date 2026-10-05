import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { _resetForTesting, setMainSession, subagentSessions, updateSessionAgent } from "../../features/claude-code-session-state"
import { resolveUltraworkOverride } from "../../plugin/ultrawork-model-override"
import { stopContinuation } from "../../plugin/stop-continuation"
import { createEventHookDispatcher, createEventHookRunner } from "../../plugin/event-hook-dispatcher"
import { createKeywordDetectorHook } from "./hook"
import { getUltraworkMessage } from "./ultrawork"

let hook: ReturnType<typeof createKeywordDetectorHook>
let messageNumber = 0
const config = { agents: { sisyphus: { ultrawork: { model: "test/ulw-model" } } } }
const marker = { type: "text", text: "<ultrawork-mode>active</ultrawork-mode>", synthetic: true }

function userOutput(text: string, synthetic = false, sessionID = "main-session") {
  const messageID = `msg_test_${++messageNumber}`
  return { message: { id: messageID }, parts: [{ id: `prt_input_${messageNumber}`, sessionID, messageID, type: "text", text, synthetic }] }
}

async function send(text: string, sessionID = "main-session", agent = "sisyphus", synthetic = false) {
  const output = userOutput(text, synthetic, sessionID)
  await hook["chat.message"]({ sessionID, agent }, output)
  return {
    active: output.parts.some(part => part.text.includes("<ultrawork-mode>")),
    override: resolveUltraworkOverride(config, agent, output, sessionID),
  }
}

beforeEach(() => {
  _resetForTesting()
  messageNumber = 0
  setMainSession("main-session")
  hook = createKeywordDetectorHook(unsafeTestValue<PluginInput>({
    client: { tui: { showToast: async () => {} } },
  }))
})
afterEach(() => {
  hook.dispose()
  _resetForTesting()
})

describe("explicit ULW session follow-ups", () => {
  test.each(["prometheus", "builder"])("#given pending restoration #when switching to %s #then its agent guard still applies", async (agent) => {
    await send("ulw initial")
    hook.event({ event: { type: "session.compacted", properties: { sessionID: "main-session" } } })
    updateSessionAgent("main-session", agent)
    await send("continue", "main-session", agent)
    expect(hook.getSystemTransformGuidance("main-session") === undefined).toBe(true)
    updateSessionAgent("main-session", "sisyphus")
    expect(hook.getSystemTransformGuidance("main-session") === getUltraworkMessage("sisyphus")).toBe(true)
  })

  test("#given active GPT mode #when fallback selects Gemini #then its output model refreshes guidance", async () => {
    const input = { sessionID: "main-session", agent: "sisyphus", model: { providerID: "test", modelID: "gpt-5" } }
    await hook["chat.message"](input, userOutput("ulw initial"))
    const original = userOutput("continue")
    const output = { ...original, message: { ...original.message, model: { providerID: "test", modelID: "gemini-3-pro" } } }
    await hook["chat.message"](input, output)
    const expected = getUltraworkMessage("sisyphus", "gemini-3-pro")
    expect({
      fullGuidance: output.parts.length === 1,
      selectedSource: output.parts[0].text.slice(-expected.length) === expected,
    }).toEqual({ fullGuidance: true, selectedSource: true })
  })

  test("#given active mode #when a plain follow-up is processed twice #then only one compact marker is added", async () => {
    await send("ulw initial")
    const output = userOutput("follow-up")
    const original = { ...output.parts[0] }
    const input = { sessionID: "main-session", agent: "sisyphus" }
    await hook["chat.message"](input, output)
    expect(output.parts).toHaveLength(2)
    expect(output.parts).toEqual([original, {
      ...marker, id: expect.stringMatching(/^prt_/), sessionID: original.sessionID, messageID: original.messageID,
    }])
    expect(output.parts[1].id).not.toBe(original.id)
    const savedMarker = { ...output.parts[1] }
    await hook["chat.message"](input, output)
    expect(output.parts).toEqual([original, savedMarker])
    expect(resolveUltraworkOverride(config, input.agent, output, input.sessionID)?.modelID).toBe("ulw-model")
  })

  test("#given active mode #when compaction finishes #then full guidance is restored once", async () => {
    const input = { sessionID: "main-session", agent: "sisyphus" }
    const initial = userOutput("ulw initial")
    await hook["chat.message"](input, initial)
    const injected = initial.parts[0].text.slice("ulw initial".length)
    const followup = userOutput("before compaction")
    await hook["chat.message"](input, followup)
    expect(followup.parts).toHaveLength(2)
    const dispatch = createEventHookDispatcher(
      unsafeTestValue<Parameters<typeof createEventHookDispatcher>[0]>({ keywordDetector: hook }),
      createEventHookRunner(),
    )
    await dispatch({ event: { type: "session.compacted", properties: { sessionID: "main-session" } } })
    const restored = userOutput("after compaction")
    await hook["chat.message"](input, restored)
    expect(restored.parts).toHaveLength(1)
    expect(restored.parts[0].text).toBe(`after compaction${injected}`)
    const later = userOutput("later")
    const original = { ...later.parts[0] }
    await hook["chat.message"](input, later)
    expect(later.parts).toEqual([original, {
      ...marker, id: expect.stringMatching(/^prt_/), sessionID: original.sessionID, messageID: original.messageID,
    }])
  })

  test("#given combo-only expansions #when ULW state replays #then the marker and model selection persist", async () => {
    const comboHook = createKeywordDetectorHook(
      unsafeTestValue<PluginInput>({ client: { tui: { showToast: async () => {} } } }),
      undefined,
      undefined,
      { enabled_expansions: ["hyperplan-ultrawork"] },
    )
    const initial = userOutput("hpp ulw initial")
    const followup = userOutput("continue")

    try {
      await comboHook["chat.message"]({ sessionID: "main-session", agent: "sisyphus" }, initial)
      await comboHook["chat.message"]({ sessionID: "main-session", agent: "sisyphus" }, followup)

      expect(followup.parts).toHaveLength(2)
      expect(followup.parts[1]).toMatchObject({ ...marker, sessionID: "main-session", messageID: followup.message.id })
      expect(resolveUltraworkOverride(config, "sisyphus", followup, "main-session")?.modelID).toBe("ulw-model")
    } finally {
      comboHook.dispose()
    }
  })

  test("#given active mode #when an attachment-only follow-up arrives #then it receives a durable ULW marker", async () => {
    await send("ulw initial")
    const output = {
      message: { id: "msg_attachment" },
      parts: [{ id: "prt_attachment", sessionID: "main-session", messageID: "msg_attachment", type: "image" }],
    }

    await hook["chat.message"]({ sessionID: "main-session", agent: "sisyphus" }, output)

    expect(output.parts).toEqual([
      { id: "prt_attachment", sessionID: "main-session", messageID: "msg_attachment", type: "image" },
      { ...marker, id: expect.stringMatching(/^prt_/), sessionID: "main-session", messageID: "msg_attachment" },
    ])
    expect(resolveUltraworkOverride(config, "sisyphus", output, "main-session")?.modelID).toBe("ulw-model")
  })

  test("#given restoration is pending #when an image follows a model change #then full guidance persists before compact markers resume", async () => {
    const gptInput = {
      sessionID: "main-session",
      agent: "sisyphus",
      model: { providerID: "openai", modelID: "gpt-5" },
    }
    await hook["chat.message"](gptInput, userOutput("ulw initial"))
    hook.event({ event: { type: "session.compacted", properties: { sessionID: "main-session" } } })
    const geminiInput = {
      sessionID: "main-session",
      agent: "sisyphus",
      model: { providerID: "google", modelID: "gemini-3-pro" },
    }
    const restoredImage = {
      message: { id: "msg_restored_image" },
      parts: [{ id: "prt_restored_image", sessionID: "main-session", messageID: "msg_restored_image", type: "image" }],
    }

    await hook["chat.message"](geminiInput, restoredImage)

    const expectedGuidance = getUltraworkMessage("sisyphus", "gemini-3-pro")
    expect(restoredImage.parts).toHaveLength(2)
    expect({
      durableIdentity: restoredImage.parts[1].id !== restoredImage.parts[0].id,
      durableModelOverride: resolveUltraworkOverride(config, "sisyphus", restoredImage, "main-session")?.modelID === "ulw-model",
      sourceByteEquality: restoredImage.parts[1].text === expectedGuidance
        && Buffer.byteLength(restoredImage.parts[1].text ?? "") === Buffer.byteLength(expectedGuidance),
      synthetic: restoredImage.parts[1].synthetic === true,
    }).toEqual({ durableIdentity: true, durableModelOverride: true, sourceByteEquality: true, synthetic: true })

    const compactImage = {
      message: { id: "msg_compact_image" },
      parts: [{ id: "prt_compact_image", sessionID: "main-session", messageID: "msg_compact_image", type: "image" }],
    }
    await hook["chat.message"](geminiInput, compactImage)
    expect(compactImage.parts[1]).toMatchObject({ ...marker, sessionID: "main-session", messageID: "msg_compact_image" })
  })

  test("#given active mode #when model family changes #then its full guidance is refreshed", async () => {
    const input = { sessionID: "main-session", agent: "sisyphus", model: { providerID: "test", modelID: "gpt-5" } }
    await hook["chat.message"](input, userOutput("ulw initial"))
    const same = userOutput("same model")
    await hook["chat.message"](input, same)
    expect(same.parts).toHaveLength(2)
    input.model.modelID = "gemini-3-pro"
    const changed = userOutput("new model")
    await hook["chat.message"](input, changed)
    expect(changed.parts).toHaveLength(1)
    expect(changed.parts[0].text).toContain("<ultrawork-mode>")
  })

  test("#given explicit activation #when a follow-up has no keyword #then injection and model selection persist only in that session", async () => {
    expect((await send("ulw implement auth")).active).toBe(true)
    expect(await send("and add error handling")).toEqual({
      active: true, override: { providerID: "test", modelID: "ulw-model", variant: undefined },
    })
    expect(await send("unrelated request", "other-session")).toEqual({ active: false, override: null })
  })

  test.each(["command", "owner", "deleted", "disposed"])("#given activation #when cleared by %s #then follow-ups are ordinary", async (reason) => {
    await send("ulw implement auth")
    if (reason === "command") await send("/stop-continuation")
    if (reason === "owner") {
      const directory = mkdtempSync(join(tmpdir(), "ulw-followup-"))
      try {
        stopContinuation({ directory, hooks: { keywordDetector: hook }, sessionID: "main-session" })
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    }
    if (reason === "deleted") {
      const dispatch = createEventHookDispatcher(
        unsafeTestValue<Parameters<typeof createEventHookDispatcher>[0]>({ keywordDetector: hook }),
        createEventHookRunner(),
      )
      await dispatch({ event: { type: "session.deleted", properties: { info: { id: "main-session" } } } })
    }
    if (reason === "disposed") hook.dispose()
    expect(await send("next request")).toEqual({ active: false, override: null })
  })

  test("#given activation #when a follow-up is guarded #then no ULW is injected", async () => {
    await send("ulw implement auth")
    expect((await send("internal request", "main-session", "sisyphus", true)).active).toBe(false)
    expect((await send("plan a change", "main-session", "prometheus")).active).toBe(false)
    subagentSessions.add("main-session")
    expect((await send("background request")).active).toBe(false)
    subagentSessions.delete("main-session")
    expect((await send("real follow-up")).active).toBe(true)
  })

  test("#given more than the session cap #when checking follow-ups #then oldest activation is evicted", async () => {
    for (let i = 0; i <= 256; i++) await send("ulw implement auth", `session-${i}`)
    expect((await send("next request", "session-0")).active).toBe(false)
    expect((await send("next request", "session-256")).active).toBe(true)
  })
})
