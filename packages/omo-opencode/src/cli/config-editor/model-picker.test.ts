import { describe, expect, test } from "bun:test"

import { selectEditorModel, type EditorModelPrompts } from "./model-picker"

type PromptStep = { readonly message: string; readonly answer: number | string | symbol }

function scriptedPrompts(steps: PromptStep[]): EditorModelPrompts {
  function take(message: string): number | string | symbol {
    const step = steps.shift()
    if (step === undefined) throw new Error(`Unexpected prompt: ${message}`)
    expect(message).toBe(step.message)
    return step.answer
  }
  return {
    select: async ({ message, options }) => {
      const answer = take(message)
      if (typeof answer === "symbol") return answer
      if (typeof answer !== "number" || !options.some((option) => option.value === answer)) throw new Error("Invalid scripted option")
      return answer
    },
    autocomplete: async ({ message, options }) => {
      const answer = take(message)
      if (typeof answer === "symbol") return answer
      if (typeof answer !== "number" || !Array.isArray(options) || !options.some((option) => option.value === answer)) throw new Error("Invalid scripted model")
      return answer
    },
    text: async ({ message, validate }) => {
      const answer = take(message)
      if (typeof answer === "symbol") return answer
      if (typeof answer !== "string") throw new Error("Invalid scripted text")
      if (typeof validate === "function") expect(validate(answer)).toBeUndefined()
      return answer
    },
  }
}

describe("config editor model navigation", () => {
  test("Back from a model list returns to providers and can choose a different provider", async () => {
    // given
    const steps: PromptStep[] = [
      { message: "Choose a model", answer: 1 },
      { message: "Select a cached provider", answer: 0 },
      { message: "Search cached models for anthropic", answer: -1 },
      { message: "Select a cached provider", answer: 1 },
      { message: "Search cached models for openai", answer: 0 },
    ]

    // when
    const result = await selectEditorModel(undefined, {
      models: new Map([["anthropic", ["claude"]], ["openai", ["gpt"]]]),
      prompts: scriptedPrompts(steps),
    })

    // then
    expect(result).toBe("openai/gpt")
    expect(steps).toHaveLength(0)
  })

  test("Back from providers returns to root options and allows trimmed custom entry", async () => {
    const steps: PromptStep[] = [
      { message: "Choose a model", answer: 1 },
      { message: "Select a cached provider", answer: -1 },
      { message: "Choose a model", answer: 0 },
      { message: "Enter a model (provider/model)", answer: " custom/vendor/model " },
    ]
    expect(await selectEditorModel(undefined, {
      models: new Map([["provider", ["model"]]]),
      prompts: scriptedPrompts(steps),
    })).toBe("custom/vendor/model")
    expect(steps).toHaveLength(0)
  })

  test("Ctrl+C during provider selection returns without choosing a model", async () => {
    expect(await selectEditorModel("old/model", {
      models: new Map([["provider", ["model"]]]),
      prompts: scriptedPrompts([
        { message: "Choose a model", answer: 1 },
        { message: "Select a cached provider", answer: Symbol("cancel") },
      ]),
    })).toBeUndefined()
  })

  test("provider and model names resembling old navigation sentinels remain selectable", async () => {
    expect(await selectEditorModel(undefined, {
      models: new Map([["__back__", ["__custom__"]]]),
      prompts: scriptedPrompts([
        { message: "Choose a model", answer: 1 },
        { message: "Select a cached provider", answer: 0 },
        { message: "Search cached models for __back__", answer: 0 },
      ]),
    })).toBe("__back__/__custom__")
  })
})
