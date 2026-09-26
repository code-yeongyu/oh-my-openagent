import { describe, expect, test } from "bun:test"
import { translateProviderOptions } from "./provider-options-translator"

describe("translateProviderOptions", () => {
  test("spreads providerOptions contents flat into options", () => {
    const entry = { model: "foo", providerOptions: { thinking_token_budget: 1024 } }
    const result = translateProviderOptions(entry)
    expect(result).toEqual({ model: "foo", options: { thinking_token_budget: 1024 } })
    expect(result["providerOptions"]).toBeUndefined()
  })

  test("deep-merges with pre-existing options", () => {
    const entry = {
      model: "foo",
      options: { top_p: 0.95 },
      providerOptions: { chat_template_kwargs: { enable_thinking: false } },
    }
    const result = translateProviderOptions(entry)
    expect(result).toEqual({
      model: "foo",
      options: { top_p: 0.95, chat_template_kwargs: { enable_thinking: false } },
    })
    expect(result["providerOptions"]).toBeUndefined()
  })

  test("override-wins precedence: providerOptions beats options", () => {
    const entry = {
      model: "foo",
      options: { thinking_token_budget: 512 },
      providerOptions: { thinking_token_budget: 1024 },
    }
    const result = translateProviderOptions(entry)
    expect(result["options"]?.thinking_token_budget).toBe(1024)
  })

  test("no-op when providerOptions is absent", () => {
    const entry = { model: "foo", options: { top_p: 0.95 } }
    const result = translateProviderOptions(entry)
    expect(result).toEqual({ model: "foo", options: { top_p: 0.95 } })
  })

  test("no-op when providerOptions is undefined", () => {
    const entry = { model: "foo", providerOptions: undefined }
    const result = translateProviderOptions(entry)
    expect(result).toEqual({ model: "foo", providerOptions: undefined })
  })

  test("no-op when entry is null", () => {
    expect(translateProviderOptions(null as never)).toBeNull()
  })

  test("no-op when entry is not an object", () => {
    expect(translateProviderOptions("string" as never)).toBe("string")
    expect(translateProviderOptions([] as never)).toEqual([])
  })

  test("output has no providerOptions key", () => {
    const entry = { model: "bar", providerOptions: { foo: "bar", nested: { a: 1, b: 2 } } }
    const result = translateProviderOptions(entry)
    expect("providerOptions" in result).toBe(false)
  })

  test("preserves nested providerOptions objects intact", () => {
    const entry = {
      model: "baz",
      providerOptions: { chat_template_kwargs: { enable_thinking: false, min_tokens: 0 } },
    }
    const result = translateProviderOptions(entry)
    expect(result).toEqual({
      model: "baz",
      options: { chat_template_kwargs: { enable_thinking: false, min_tokens: 0 } },
    })
  })
})
