import { afterEach, describe, expect, test } from "bun:test"

import { createSystemTransformHandler } from "./system-transform"
import { GPT_APPLY_PATCH_GUIDANCE } from "../agents/gpt-apply-patch-guard"
import { createSisyphusAgent } from "../agents/sisyphus"
import {
  clearSisyphusRuntimePromptContext,
  reconcileSisyphusRuntimePrompt,
  setSisyphusRuntimePromptContext,
} from "../agents/sisyphus-runtime-prompt-reconciler"

const GPT_MODEL = "openai/gpt-5.5"
const NON_GPT_MODEL = "opencode-go/qwen3.7-plus"

// Mirror what maybeCreateSisyphusConfig captures at registration: the baked GPT
// prompt plus a rebuild closure that re-runs the factory for a different model.
function registerGptSisyphus(): string {
  const baked = createSisyphusAgent(GPT_MODEL, [], [], [], []).prompt ?? ""
  setSisyphusRuntimePromptContext({
    configuredModel: GPT_MODEL,
    bakedPrompt: baked,
    rebuildPromptForModel: (model) => createSisyphusAgent(model, [], [], [], []).prompt ?? "",
  })
  return baked
}

afterEach(() => {
  clearSisyphusRuntimePromptContext()
})

describe("Sisyphus runtime prompt family reconciliation (#5297/#5316)", () => {
  test("#given a GPT-configured Sisyphus body #when run on a non-GPT model #then the WHOLE body is rebuilt, not just the apply_patch line", () => {
    const baked = registerGptSisyphus()
    // sanity: the baked body really is the GPT-5.5 family body
    expect(baked).toContain("based on GPT-5.5")
    expect(baked).toContain(GPT_APPLY_PATCH_GUIDANCE)

    const system = [baked]
    const swapped = reconcileSisyphusRuntimePrompt(system, NON_GPT_MODEL)

    expect(swapped).toBe(true)
    // The GPT identity and the GPT-only apply_patch guidance are both gone...
    expect(system[0]).not.toContain("based on GPT-5.5")
    expect(system[0]).not.toContain(GPT_APPLY_PATCH_GUIDANCE)
    // ...and the entry is exactly what registration would have baked for qwen.
    expect(system[0]).toBe(createSisyphusAgent(NON_GPT_MODEL, [], [], [], []).prompt)
  })

  test("#given the baked body concatenated with other system text #when run on a non-GPT model #then only the body portion is rebuilt", () => {
    const baked = registerGptSisyphus()
    // opencode may join the agent prompt with surrounding system text in one entry
    const system = [`<context>\n${baked}\n</context>`]

    const swapped = reconcileSisyphusRuntimePrompt(system, NON_GPT_MODEL)

    expect(swapped).toBe(true)
    expect(system[0]).toContain("<context>")
    expect(system[0]).toContain("</context>")
    expect(system[0]).not.toContain("based on GPT-5.5")
    expect(system[0]).not.toContain(GPT_APPLY_PATCH_GUIDANCE)
  })

  test("#given a GPT-configured body #when run on the same GPT family #then the body is left untouched", () => {
    const baked = registerGptSisyphus()
    const system = [baked]
    const swapped = reconcileSisyphusRuntimePrompt(system, GPT_MODEL)
    expect(swapped).toBe(false)
    expect(system[0]).toBe(baked)
  })

  test("#given no registered Sisyphus context #when reconcile runs #then it is a no-op", () => {
    const system = ["unrelated system prompt"]
    expect(reconcileSisyphusRuntimePrompt(system, NON_GPT_MODEL)).toBe(false)
    expect(system).toEqual(["unrelated system prompt"])
  })

  test("#given a non-Sisyphus session #when reconcile runs #then nothing matches and nothing changes", () => {
    registerGptSisyphus()
    const system = ["some other agent's prompt with no Sisyphus body"]
    expect(reconcileSisyphusRuntimePrompt(system, NON_GPT_MODEL)).toBe(false)
    expect(system).toEqual(["some other agent's prompt with no Sisyphus body"])
  })

  test("#given the full system-transform handler #when runtime model is non-GPT #then the GPT body is reconciled end-to-end", async () => {
    const baked = registerGptSisyphus()
    const handler = createSystemTransformHandler()
    const output = { system: [baked] }

    await handler(
      { sessionID: "s", model: { id: NON_GPT_MODEL, providerID: "opencode-go" } },
      output,
    )

    expect(output.system[0]).not.toContain("based on GPT-5.5")
    expect(output.system[0]).not.toContain(GPT_APPLY_PATCH_GUIDANCE)
  })
})
