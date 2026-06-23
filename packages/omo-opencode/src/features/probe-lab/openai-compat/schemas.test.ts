import { describe, expect, test } from "bun:test"
import { ChatCompletionRequestSchema, ModelsResponseSchema } from "./schemas"

describe("ChatCompletionRequestSchema", () => {
  describe("#given a minimal valid request", () => {
    test("#when parsed #then succeeds", () => {
      const result = ChatCompletionRequestSchema.safeParse({
        model: "deepseek-chat",
        messages: [{ role: "user", content: "hello" }],
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.model).toBe("deepseek-chat")
        expect(result.data.messages).toHaveLength(1)
      }
    })
  })

  describe("#given missing model", () => {
    test("#when parsed #then fails with model issue", () => {
      const result = ChatCompletionRequestSchema.safeParse({
        messages: [{ role: "user", content: "hello" }],
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.includes("model"))).toBe(true)
      }
    })
  })

  describe("#given empty messages array", () => {
    test("#when parsed #then fails", () => {
      const result = ChatCompletionRequestSchema.safeParse({
        model: "deepseek-chat",
        messages: [],
      })
      expect(result.success).toBe(false)
    })
  })

  describe("#given malformed message role", () => {
    test("#when role is unknown #then fails", () => {
      const result = ChatCompletionRequestSchema.safeParse({
        model: "deepseek-chat",
        messages: [{ role: "alien", content: "hi" }],
      })
      expect(result.success).toBe(false)
    })
  })

  describe("#given temperature out of range", () => {
    test("#when temperature > 2 #then fails", () => {
      const result = ChatCompletionRequestSchema.safeParse({
        model: "deepseek-chat",
        messages: [{ role: "user", content: "hi" }],
        temperature: 3,
      })
      expect(result.success).toBe(false)
    })
  })

  describe("#given unknown OpenAI-standard fields", () => {
    test("#when extra field passed #then is preserved (passthrough)", () => {
      const result = ChatCompletionRequestSchema.safeParse({
        model: "deepseek-chat",
        messages: [{ role: "user", content: "hi" }],
        future_field: "foo",
      })
      expect(result.success).toBe(true)
    })
  })

  describe("#given a multimodal user message (text + image_url part)", () => {
    test("#when content is an array of parts #then validation succeeds", () => {
      const result = ChatCompletionRequestSchema.safeParse({
        model: "deepseek-v4-vision",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "what is in this image?" },
              {
                type: "image_url",
                image_url: { url: "data:image/png;base64,iVBORw0KGgo=" },
              },
            ],
          },
        ],
      })
      expect(result.success).toBe(true)
      if (result.success) {
        const msg = result.data.messages[0]!
        const parts = msg.content as ReadonlyArray<{ type: string }>
        expect(Array.isArray(parts)).toBe(true)
        expect(parts).toHaveLength(2)
        expect(parts[0]?.type).toBe("text")
        expect(parts[1]?.type).toBe("image_url")
      }
    })
  })

  describe("#given a multimodal message with bare-string image_url", () => {
    test("#when image_url is a plain string #then validation still succeeds (OpenAI spec accepts both)", () => {
      const result = ChatCompletionRequestSchema.safeParse({
        model: "deepseek-v4-vision",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "describe" },
              { type: "image_url", image_url: "data:image/jpeg;base64,Zm9v" },
            ],
          },
        ],
      })
      expect(result.success).toBe(true)
    })
  })
})

describe("ModelsResponseSchema", () => {
  test("#given a well-formed list #when parsed #then succeeds", () => {
    const result = ModelsResponseSchema.safeParse({
      object: "list",
      data: [{ id: "deepseek-chat", object: "model", created: 0, owned_by: "deepseek" }],
    })
    expect(result.success).toBe(true)
  })
})
