import { describe, expect, test } from "bun:test"
import { buildDynamicSystemPrompt, resolvePreset } from "@code-yeongyu/senpi/prompt-presets"
import { getPrometheusPrompt, PROMETHEUS_SYSTEM_PROMPT } from "./system-prompt"
import { adaptNativePrompt, nativePromptOptions } from "../native-model-prompt"
import { frameNativePrompt } from "../native-prompt-frame"

describe("Prometheus role and host capabilities", () => {
  test("keeps its single planning role after the Native model core", () => {
    const model = { provider: "synthetic", id: "claude-opus-5-5" }
    const tools = ["read", "grep", "glob", "bash", "edit", "write", "question", "skill"]
    const options = nativePromptOptions(tools)
    const native = resolvePreset(model, { promptPreset: "auto" }, options)
    expect(native).toBeDefined()
    const identity = "Model: " + JSON.stringify({ ...model, preset: native?.name ?? null })
    expect(getPrometheusPrompt("synthetic/claude-opus-5-5"))
      .toBe(frameNativePrompt([adaptNativePrompt(native?.prompt ?? ""), identity].join("\n\n"), {
        model: "synthetic/claude-opus-5-5", tools,
      }) + "\n\n" + PROMETHEUS_SYSTEM_PROMPT)
  })
  test("does not advertise disabled tool capabilities to the Native builder", () => {
    const tools = ["grep", "glob", "bash", "edit", "write", "skill"]
    const core = buildDynamicSystemPrompt(nativePromptOptions(tools))
    const identity = 'Model: {"provider":"synthetic","id":"unknown","preset":null}'
    expect(getPrometheusPrompt("synthetic/unknown", ["read", "question"]))
      .toBe(frameNativePrompt([adaptNativePrompt(core), identity].join("\n\n"), {
        model: "synthetic/unknown", tools,
      }) + "\n\n" + PROMETHEUS_SYSTEM_PROMPT)
  })
})
