import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { AthenaConfigSchema, CouncilConfigSchema, CouncilMemberSchema } from "./athena"

describe("CouncilMemberSchema", () => {
  test("accepts model-only member config", () => {
    //#given
    const config = { model: "anthropic/claude-opus-4-6" }

    //#when
    const result = CouncilMemberSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
  })

  test("accepts member config with all optional fields", () => {
    //#given
    const config = {
      model: "openai/gpt-5.3-codex",
      temperature: 0.4,
      variant: "high",
      name: "analyst-a",
    }

    //#when
    const result = CouncilMemberSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
  })

  test("rejects member config missing model", () => {
    //#given
    const config = { temperature: 0.5 }

    //#when
    const result = CouncilMemberSchema.safeParse(config)

    //#then
    expect(result.success).toBe(false)
  })

  test("rejects temperature below 0", () => {
    //#given
    const config = { model: "openai/gpt-5.3-codex", temperature: -0.1 }

    //#when
    const result = CouncilMemberSchema.safeParse(config)

    //#then
    expect(result.success).toBe(false)
  })

  test("rejects temperature above 2", () => {
    //#given
    const config = { model: "openai/gpt-5.3-codex", temperature: 2.1 }

    //#when
    const result = CouncilMemberSchema.safeParse(config)

    //#then
    expect(result.success).toBe(false)
  })

  test("z.infer produces expected type shape", () => {
    //#given
    type InferredCouncilMember = z.infer<typeof CouncilMemberSchema>
    const member: InferredCouncilMember = {
      model: "anthropic/claude-opus-4-6",
      temperature: 0.1,
      variant: "medium",
      name: "oracle",
    }

    //#when
    const model = member.model

    //#then
    expect(model).toBe("anthropic/claude-opus-4-6")
  })

  test("optional fields are optional without runtime defaults", () => {
    //#given
    const config = { model: "xai/grok-code-fast-1" }

    //#when
    const parsed = CouncilMemberSchema.parse(config)

    //#then
    expect(parsed.temperature).toBeUndefined()
    expect(parsed.variant).toBeUndefined()
    expect(parsed.name).toBeUndefined()
  })
})

describe("CouncilConfigSchema", () => {
  test("accepts council with 2 members", () => {
    //#given
    const config = {
      members: [{ model: "anthropic/claude-opus-4-6" }, { model: "openai/gpt-5.3-codex" }],
    }

    //#when
    const result = CouncilConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
  })

  test("accepts council with 3 members and optional fields", () => {
    //#given
    const config = {
      members: [
        { model: "anthropic/claude-opus-4-6", name: "a", temperature: 0.1 },
        { model: "openai/gpt-5.3-codex", name: "b", variant: "high" },
        { model: "xai/grok-code-fast-1", name: "c", temperature: 1.2, variant: "low" },
      ],
    }

    //#when
    const result = CouncilConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
  })

  test("rejects council with 0 members", () => {
    //#given
    const config = { members: [] }

    //#when
    const result = CouncilConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(false)
  })

  test("rejects council with 1 member", () => {
    //#given
    const config = { members: [{ model: "anthropic/claude-opus-4-6" }] }

    //#when
    const result = CouncilConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(false)
  })

  test("rejects council missing members field", () => {
    //#given
    const config = {}

    //#when
    const result = CouncilConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(false)
  })
})

describe("AthenaConfigSchema", () => {
  test("accepts Athena config with model and council", () => {
    //#given
    const config = {
      model: "anthropic/claude-opus-4-6",
      council: {
        members: [{ model: "openai/gpt-5.3-codex" }, { model: "xai/grok-code-fast-1" }],
      },
    }

    //#when
    const result = AthenaConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
  })

  test("rejects Athena config without council", () => {
    //#given
    const config = { model: "anthropic/claude-opus-4-6" }

    //#when
    const result = AthenaConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(false)
  })
})
