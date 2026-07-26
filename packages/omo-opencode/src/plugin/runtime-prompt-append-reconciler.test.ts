import { afterEach, describe, expect, test } from "bun:test"

import { createRuntimePromptAppendRegistry } from "../agents/runtime-prompt-append-reconciler"
import { resolveAgentPromptAppend } from "../agents/builtin-agents/resolve-prompt-append"
import {
  clearSisyphusRuntimePromptContext,
  setSisyphusRuntimePromptContext,
} from "../agents/sisyphus-runtime-prompt-reconciler"
import { createCompactionRequestTracker } from "./compaction-request-tracker"
import { createSystemTransformHandler } from "./system-transform"

const SESSION_ID = "ses_runtime_prompt_append"

type PromptAppendOverride = {
  displayName?: string
  model?: string
  prompt_append: string
  prompt_append_exclude_model_keywords: string[]
  prompt_append_always?: string
}

function createHandler(
  agentName: string,
  override: PromptAppendOverride,
  basePrompt = "BASE_PROMPT",
  finalModel = override.model,
) {
  const configuredAppend = resolveAgentPromptAppend({
    model: finalModel,
    promptAppend: override.prompt_append,
    promptAppendAlways: override.prompt_append_always,
    excludeModelKeywords: override.prompt_append_exclude_model_keywords,
  })
  const configuredPrompt = configuredAppend
    ? `${basePrompt}\n${configuredAppend}`
    : basePrompt
  const registry = createRuntimePromptAppendRegistry()
  registry.configure({
    agentConfigs: { [agentName]: { prompt: configuredPrompt, model: finalModel } },
    agentOverrides: { meidocho: override },
  })
  return {
    configuredPrompt,
    handler: createSystemTransformHandler(undefined, undefined, {
      reconcileRuntimePromptAppend: registry.reconcile,
      getSessionAgent: () => agentName,
    }),
  }
}

afterEach(() => {
  clearSisyphusRuntimePromptContext()
})

describe("runtime prompt append reconciliation", () => {
  test("#given a GPT-configured agent excluded from a conditional append #when the request uses GLM #then the conditional append is inserted before the always append", async () => {
    const { configuredPrompt, handler } = createHandler("meidocho", {
      model: "openai/gpt-5.6-sol",
      prompt_append: "GLM_INSTRUCTIONS",
      prompt_append_exclude_model_keywords: ["gpt"],
      prompt_append_always: "ALWAYS_INSTRUCTIONS",
    })
    const output = { system: [configuredPrompt] }

    await handler(
      { sessionID: SESSION_ID, model: { id: "glm-5.2", providerID: "opencode-go" } },
      output,
    )

    expect(output.system).toEqual(["BASE_PROMPT\nGLM_INSTRUCTIONS\n\nALWAYS_INSTRUCTIONS"])
  })

  test("#given a GLM-configured agent with a conditional append #when the request uses GPT #then only the conditional append is removed", async () => {
    const { configuredPrompt, handler } = createHandler("meidocho", {
      model: "opencode-go/glm-5.2",
      prompt_append: "GLM_INSTRUCTIONS",
      prompt_append_exclude_model_keywords: ["gpt"],
      prompt_append_always: "ALWAYS_INSTRUCTIONS",
    })
    const output = { system: [configuredPrompt] }

    await handler(
      { sessionID: SESSION_ID, model: { id: "gpt-5.6-sol", providerID: "openai" } },
      output,
    )

    expect(output.system).toEqual(["BASE_PROMPT\nALWAYS_INSTRUCTIONS"])
  })

  test("#given an exclusion matching only the provider #when the model ID does not match #then the conditional append remains enabled", async () => {
    const { configuredPrompt, handler } = createHandler("meidocho", {
      model: "openai/gpt-5.6-sol",
      prompt_append: "MODEL_INSTRUCTIONS",
      prompt_append_exclude_model_keywords: ["opencode-go"],
    })
    const output = { system: [configuredPrompt] }

    await handler(
      { sessionID: SESSION_ID, model: { id: "glm-5.2", providerID: "opencode-go" } },
      output,
    )

    expect(output.system).toEqual([configuredPrompt])
  })

  test("#given a model ID containing a slash #when the provider is separate #then the complete model ID participates in matching", async () => {
    const { configuredPrompt, handler } = createHandler("meidocho", {
      model: "openai/gpt-5.6-sol",
      prompt_append: "OPENAI_MODEL_INSTRUCTIONS",
      prompt_append_exclude_model_keywords: ["openai/gpt"],
    })
    const output = { system: [configuredPrompt] }

    await handler(
      { sessionID: SESSION_ID, model: { id: "openai/gpt-4o", providerID: "openrouter" } },
      output,
    )

    expect(output.system).toEqual(["BASE_PROMPT"])
  })

  test("#given a localized display name #when resolving the active agent override #then the matching config key is reconciled", async () => {
    const { configuredPrompt, handler } = createHandler("Meidocho - 女仆长", {
      displayName: "Meidocho - 女仆长",
      model: "openai/gpt-5.6-sol",
      prompt_append: "GLM_INSTRUCTIONS",
      prompt_append_exclude_model_keywords: ["gpt"],
    })
    const output = { system: [configuredPrompt] }

    await handler(
      { sessionID: SESSION_ID, model: { id: "glm-5.2", providerID: "opencode-go" } },
      output,
    )

    expect(output.system).toEqual(["BASE_PROMPT\nGLM_INSTRUCTIONS"])
  })

  test("#given the conditional text already appears in the base prompt #when the runtime model enables the append #then a distinct suffix is still added", async () => {
    const basePrompt = "BASE_PROMPT\nSHARED_TEXT"
    const { configuredPrompt, handler } = createHandler("meidocho", {
      model: "openai/gpt-5.6-sol",
      prompt_append: "SHARED_TEXT",
      prompt_append_exclude_model_keywords: ["gpt"],
    }, basePrompt)
    const output = { system: [configuredPrompt] }

    await handler(
      { sessionID: SESSION_ID, model: { id: "glm-5.2", providerID: "opencode-go" } },
      output,
    )

    expect(output.system).toEqual(["BASE_PROMPT\nSHARED_TEXT\nSHARED_TEXT"])
  })

  test("#given matching text appears in a later system part #when the registered prompt is reconciled #then later content remains untouched", async () => {
    const { configuredPrompt, handler } = createHandler("meidocho", {
      model: "opencode-go/glm-5.2",
      prompt_append: "SHARED_TEXT",
      prompt_append_exclude_model_keywords: ["gpt"],
    })
    const laterPart = `OTHER\n${configuredPrompt}`
    const output = { system: [configuredPrompt, laterPart] }

    await handler(
      { sessionID: SESSION_ID, model: { id: "gpt-5.6-sol", providerID: "openai" } },
      output,
    )

    expect(output.system).toEqual(["BASE_PROMPT", laterPart])
  })

  test("#given no override model and a final GPT model #when the runtime model switches to GLM #then the missing conditional append is restored", async () => {
    const { configuredPrompt, handler } = createHandler("meidocho", {
      prompt_append: "CONDITIONAL",
      prompt_append_exclude_model_keywords: ["gpt"],
      prompt_append_always: "ALWAYS",
    }, "BASE_PROMPT", "openai/gpt-5.6-sol")
    const output = { system: [configuredPrompt] }

    await handler(
      { sessionID: SESSION_ID, model: { id: "glm-5.2", providerID: "opencode-go" } },
      output,
    )

    expect(configuredPrompt).toBe("BASE_PROMPT\nALWAYS")
    expect(output.system).toEqual(["BASE_PROMPT\nCONDITIONAL\n\nALWAYS"])
  })

  test("#given conditional and always appends have identical text #when the runtime model excludes the conditional copy #then the always copy remains", async () => {
    const { configuredPrompt, handler } = createHandler("meidocho", {
      model: "opencode-go/glm-5.2",
      prompt_append: "SHARED_TEXT",
      prompt_append_exclude_model_keywords: ["gpt"],
      prompt_append_always: "SHARED_TEXT",
    })
    const output = { system: [configuredPrompt] }

    await handler(
      { sessionID: SESSION_ID, model: { id: "gpt-5.6-sol", providerID: "openai" } },
      output,
    )

    expect(output.system).toEqual(["BASE_PROMPT\nSHARED_TEXT"])
  })

  test("#given Sisyphus rebuilds its complete prompt #when runtime append reconciliation follows #then the generic reconciler is skipped", async () => {
    const genericCalls: string[] = []
    setSisyphusRuntimePromptContext({
      configuredModel: "openai/gpt-5.6-sol",
      bakedPrompt: "SISYPHUS_GPT",
      rebuildPromptForModel: () => "SISYPHUS_GLM\nGLM_INSTRUCTIONS",
    })
    const handler = createSystemTransformHandler(undefined, undefined, {
      reconcileRuntimePromptAppend: () => {
        genericCalls.push("called")
        return true
      },
      getSessionAgent: () => "sisyphus",
    })
    const output = { system: ["SISYPHUS_GPT"] }

    await handler(
      { sessionID: SESSION_ID, model: { id: "glm-5.2", providerID: "opencode-go" } },
      output,
    )

    expect(output.system).toEqual(["SISYPHUS_GLM\nGLM_INSTRUCTIONS"])
    expect(genericCalls).toEqual([])
  })

  test("#given an active compaction operation #when system transform retries #then every retry skips the main agent reconciler until cleanup", async () => {
    const tracker = createCompactionRequestTracker()
    const reconcileCalls: string[] = []
    tracker.mark(SESSION_ID)
    const handler = createSystemTransformHandler(undefined, undefined, {
      reconcileRuntimePromptAppend: () => {
        reconcileCalls.push("called")
        return true
      },
      getSessionAgent: () => "meidocho",
      isCompactionRequest: tracker.isActive,
    })

    await handler(
      { sessionID: SESSION_ID, model: { id: "glm-5.2", providerID: "opencode-go" } },
      { system: ["COMPACTION_PROMPT"] },
    )
    await handler(
      { sessionID: SESSION_ID, model: { id: "glm-5.2", providerID: "opencode-go" } },
      { system: ["COMPACTION_PROMPT"] },
    )
    tracker.clear(SESSION_ID)
    await handler(
      { sessionID: SESSION_ID, model: { id: "glm-5.2", providerID: "opencode-go" } },
      { system: ["MAIN_PROMPT"] },
    )

    expect(reconcileCalls).toEqual(["called"])
  })
})
