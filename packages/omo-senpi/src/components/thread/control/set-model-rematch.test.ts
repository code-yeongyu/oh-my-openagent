import { describe, expect, test } from "bun:test"
import { answered, setModelOn } from "./operations"
import { refuse, type SessionControl, type SessionModelState } from "./port"

function unused(name: string): () => never {
  return () => {
    throw new Error(`${name} is not part of this case`)
  }
}

function rematchControl(states: (SessionModelState | undefined)[]): SessionControl {
  return {
    thread_id: "dur-peer",
    title: "peer",
    visible: unused("visible"),
    interrupt: unused("interrupt"),
    close: unused("close"),
    setName: unused("setName"),
    getAvailableModels: async (options) => ({
      models: [{ provider: options?.fresh === true ? "azure" : "openai", id: "gpt-x" }],
      held: false,
    }),
    getModelState: async () => states.shift(),
    setModel: async () => {
      throw refuse("model_not_found", "The engine no longer offers openai/gpt-x.", "Pick another model.")
    },
    getAvailableThinkingLevels: unused("getAvailableThinkingLevels"),
    setThinkingLevel: unused("setThinkingLevel"),
    getMessages: unused("getMessages"),
    waitSettled: unused("waitSettled"),
    running: unused("running"),
    setArchived: unused("setArchived"),
    listed: unused("listed"),
  }
}

describe("#14482 review L2: set_model rematch after a refused switch", () => {
  test("#given the engine refuses the switch and the target then reports no model state #when the suffix rematches #then the engine's refusal is answered", async () => {
    // given
    const control = rematchControl([{ model: { provider: "openai", id: "gpt-previous" }, thinkingLevel: "off" }, undefined])

    // when
    const result = await answered(() => setModelOn(control, "gpt-x:max", undefined))

    // then
    expect(result).toMatchObject({ kind: "error", error: { code: "model_not_found" } })
  })
})
