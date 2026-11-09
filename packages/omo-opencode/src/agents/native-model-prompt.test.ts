import { describe, expect, test } from "bun:test"
import { buildDynamicSystemPrompt, resolvePreset } from "@code-yeongyu/senpi/prompt-presets"
import {
  adaptNativePrompt,
  buildNativeAgentPrompt,
  nativePromptOptions,
  resolveNativePromptModel,
} from "./native-model-prompt"
import { createSisyphusAgent } from "./sisyphus"
import { frameNativePrompt } from "./native-prompt-frame"

describe("OpenCode host transform", () => {
  test("translates only Native tool identifiers", () => {
    const input = "ask_user_question `todo` todo todos todo_context MY_BODY"
    expect(adaptNativePrompt(input)).toBe("question `todowrite` todo todos todo_context MY_BODY")
    expect(nativePromptOptions(["question", "todowrite", "read"]).selectedTools)
      .toEqual(["ask_user_question", "todo", "read"])
  })

  test("preserves uncatalogued provider namespaces after the first slash", () => {
    expect(resolveNativePromptModel("synthetic/vendor/model-id"))
      .toEqual({ provider: "synthetic", id: "vendor/model-id" })
  })

  test("maps tracking identifiers to the enabled task surface", () => {
    expect(adaptNativePrompt("`todo` todo_context", true))
      .toBe("`task_create` / `task_update` / `task_list` / `task_get` todo_context")
  })

  test("removes the Native-only question wait parameter", () => {
    const options = nativePromptOptions(["question"])
    const native = resolvePreset(
      { provider: "anthropic", id: "claude-opus-5-5" },
      { promptPreset: "auto" },
      options,
    )
    expect(native).toBeDefined()
    expect(adaptNativePrompt(native?.prompt ?? "")).not.toContain("waitForAnswer")
  })

  test("uses the actual Native default for an uncatalogued model", () => {
    const options = nativePromptOptions()
    const core = buildDynamicSystemPrompt(options)
    const identity = 'Model: {"provider":"synthetic","id":"vendor/model-id","preset":null}'
    expect(buildNativeAgentPrompt("synthetic/vendor/model-id", "ROLE_SENTINEL"))
      .toBe(frameNativePrompt([adaptNativePrompt(core), identity].join("\n\n"), {
        model: "synthetic/vendor/model-id", tools: [],
      }) + "\n\nROLE_SENTINEL")
  })

  test.each([
    ["anthropic/claude-opus-5-5", "claude-opus-5-5"],
    ["anthropic/claude-fable-5-1", "claude-fable-5-1"],
  ])("renders the complete identifier for %s", (model, preset) => {
    const prompt = createSisyphusAgent(model).prompt ?? ""
    const line = prompt.split("\n").find((entry) => entry.startsWith("Model: "))
    expect(line).toBeDefined()
    expect(JSON.parse((line ?? "").slice("Model: ".length)))
      .toEqual({ provider: "anthropic", id: model.slice("anthropic/".length), preset })
  })

  test("keeps each model body independent from the role append", () => {
    const model = { provider: "anthropic", id: "claude-opus-5-5" }
    const options = nativePromptOptions()
    const native = resolvePreset(model, { promptPreset: "auto" }, options)
    expect(native).toBeDefined()
    const identity = 'Model: {"provider":"anthropic","id":"claude-opus-5-5","preset":"claude-opus-5-5"}'
    const framed = frameNativePrompt([adaptNativePrompt(native?.prompt ?? ""), identity].join("\n\n"), {
      model: "anthropic/claude-opus-5-5", tools: [],
    })
    expect(buildNativeAgentPrompt("anthropic/claude-opus-5-5", "ROLE_A"))
      .toBe(framed + "\n\nROLE_A")
    expect(buildNativeAgentPrompt("anthropic/claude-opus-5-5", "ROLE_B"))
      .toBe(framed + "\n\nROLE_B")
  })
})
