import { describe, expect, test } from "bun:test"
import { extractPassThroughFields } from "./passthrough-fields"

describe("extractPassThroughFields", () => {
  describe("#given empty or nullish input", () => {
    test("#when called with empty object #then returns empty object", () => {
      expect(extractPassThroughFields({})).toEqual({})
    })

    test("#when called with null #then returns empty object", () => {
      expect(extractPassThroughFields(null)).toEqual({})
    })

    test("#when called with undefined #then returns empty object", () => {
      expect(extractPassThroughFields(undefined)).toEqual({})
    })
  })

  describe("#given each whitelisted field is present", () => {
    test("#when max_tokens set #then forwarded", () => {
      expect(extractPassThroughFields({ max_tokens: 1000 })).toEqual({
        max_tokens: 1000,
      })
    })

    test("#when max_completion_tokens set #then forwarded", () => {
      expect(
        extractPassThroughFields({ max_completion_tokens: 4096 }),
      ).toEqual({ max_completion_tokens: 4096 })
    })

    test("#when temperature set #then forwarded", () => {
      expect(extractPassThroughFields({ temperature: 0.7 })).toEqual({
        temperature: 0.7,
      })
    })

    test("#when top_p set #then forwarded", () => {
      expect(extractPassThroughFields({ top_p: 0.9 })).toEqual({ top_p: 0.9 })
    })

    test("#when presence_penalty and frequency_penalty set #then both forwarded", () => {
      expect(
        extractPassThroughFields({
          presence_penalty: 0.5,
          frequency_penalty: -0.5,
        }),
      ).toEqual({ presence_penalty: 0.5, frequency_penalty: -0.5 })
    })

    test("#when stop is a string #then forwarded as string", () => {
      expect(extractPassThroughFields({ stop: "###" })).toEqual({
        stop: "###",
      })
    })

    test("#when stop is a string array #then forwarded as array", () => {
      expect(extractPassThroughFields({ stop: ["###", "END"] })).toEqual({
        stop: ["###", "END"],
      })
    })

    test("#when seed set #then forwarded", () => {
      expect(extractPassThroughFields({ seed: 42 })).toEqual({ seed: 42 })
    })
  })

  describe("#given null/undefined values for whitelisted keys", () => {
    test("#when value is null #then key is stripped", () => {
      expect(extractPassThroughFields({ max_tokens: null })).toEqual({})
    })

    test("#when value is undefined #then key is stripped", () => {
      expect(extractPassThroughFields({ temperature: undefined })).toEqual({})
    })

    test("#when zero value present #then forwarded (zero is valid)", () => {
      expect(extractPassThroughFields({ temperature: 0 })).toEqual({
        temperature: 0,
      })
    })
  })

  describe("#given non-whitelisted fields", () => {
    test("#when unknown field present #then stripped", () => {
      expect(
        extractPassThroughFields({ random_field: "x", custom: 123 }),
      ).toEqual({})
    })

    test("#when protected field model present #then stripped", () => {
      expect(extractPassThroughFields({ model: "deepseek-v4-pro" })).toEqual(
        {},
      )
    })

    test("#when protected field messages present #then stripped", () => {
      expect(
        extractPassThroughFields({
          messages: [{ role: "user", content: "hi" }],
        }),
      ).toEqual({})
    })

    test("#when managed thinking_enabled and search_enabled present #then stripped", () => {
      expect(
        extractPassThroughFields({
          thinking_enabled: true,
          search_enabled: false,
          stream: true,
          tools: [],
          tool_choice: "auto",
          parallel_tool_calls: false,
        }),
      ).toEqual({})
    })
  })

  describe("#given a realistic mixed body", () => {
    test("#when called with model+messages+sampling fields #then only sampling fields returned", () => {
      const incoming = {
        model: "deepseek-v4-pro",
        messages: [{ role: "user", content: "hi" }],
        stream: false,
        thinking: true,
        max_completion_tokens: 4096,
        temperature: 0.7,
        top_p: 1,
        seed: 7,
        random_thing: { foo: "bar" },
      }
      expect(extractPassThroughFields(incoming)).toEqual({
        max_completion_tokens: 4096,
        temperature: 0.7,
        top_p: 1,
        seed: 7,
      })
    })
  })
})
