import { describe, expect, test } from "bun:test"

import { createSystemTransformHandler } from "./system-transform"
import {
  GPT_APPLY_PATCH_GUIDANCE,
  GPT_FILE_EDIT_GUIDANCE,
} from "../agents/gpt-apply-patch-guard"
import { createSisyphusAgent } from "../agents/sisyphus"

const GPT_MODEL = { id: "gpt-5.5", providerID: "openai" }
const NON_GPT_MODEL = { id: "qwen3.7-plus", providerID: "opencode-go" }

function runHandler(
  system: string[],
  model: { id: string; providerID: string },
): Promise<string[]> {
  const handler = createSystemTransformHandler(undefined, undefined, {})
  const output = { system }
  return handler({ sessionID: "s", model }, output).then(() => output.system)
}

describe("Sisyphus runtime prompt family reconciliation (#5297)", () => {
  test("#given GPT apply_patch guidance baked #when runtime model is non-GPT #then guidance is rewritten to be tool-agnostic", async () => {
    // given: configured GPT model baked the apply_patch-only guidance
    const baked = [`Step 4. ${GPT_APPLY_PATCH_GUIDANCE}`]

    // when: user switched to a non-GPT model in the TUI
    const result = await runHandler(baked, NON_GPT_MODEL)

    // then: the prompt no longer forces apply_patch
    const joined = result.join("\n")
    expect(joined).not.toContain(GPT_APPLY_PATCH_GUIDANCE)
    expect(joined).toContain(GPT_FILE_EDIT_GUIDANCE)
  })

  test("#given non-GPT file-edit guidance baked #when runtime model is GPT #then guidance is upgraded to apply_patch", async () => {
    // given: configured non-GPT model baked the tool-agnostic guidance
    const baked = [`Step 4. ${GPT_FILE_EDIT_GUIDANCE}`]

    // when: user switched to a GPT model in the TUI
    const result = await runHandler(baked, GPT_MODEL)

    // then: GPT gets its apply_patch-specific guidance back
    const joined = result.join("\n")
    expect(joined).toContain(GPT_APPLY_PATCH_GUIDANCE)
    expect(joined).not.toContain(GPT_FILE_EDIT_GUIDANCE)
  })

  test("#given GPT guidance baked #when runtime model is also GPT #then guidance is left unchanged", async () => {
    const baked = [`Step 4. ${GPT_APPLY_PATCH_GUIDANCE}`]
    const result = await runHandler(baked, GPT_MODEL)
    expect(result.join("\n")).toContain(GPT_APPLY_PATCH_GUIDANCE)
  })

  test("#given no runtime model #when system transform runs #then guidance is untouched", async () => {
    const baked = [`Step 4. ${GPT_APPLY_PATCH_GUIDANCE}`]
    const handler = createSystemTransformHandler(undefined, undefined, {})
    const output = { system: [...baked] }
    await handler(
      { sessionID: "s", model: undefined as unknown as { id: string; providerID: string } },
      output,
    )
    expect(output.system).toEqual(baked)
  })

  test("#given a real GPT-configured Sisyphus prompt #when run on a non-GPT model #then apply_patch is not forced (config-to-runtime mismatch)", async () => {
    // given: this is the path issue #5258 tests missed — the prompt is actually
    // *built* for a GPT model (as it would be from oh-my-openagent.jsonc), then
    // assembled and passed through the runtime hook with a different model.
    const gptAgent = createSisyphusAgent("openai/gpt-5.5", [], [], [], [])
    expect(gptAgent.prompt).toContain(GPT_APPLY_PATCH_GUIDANCE)

    // when: the runtime model selected in the TUI is non-GPT
    const result = await runHandler([gptAgent.prompt ?? ""], NON_GPT_MODEL)

    // then: the final system prompt no longer instructs apply_patch usage
    expect(result.join("\n")).not.toContain(GPT_APPLY_PATCH_GUIDANCE)
  })
})
