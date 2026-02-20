import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { AthenaConfigSchema, CouncilConfigSchema, CouncilMemberSchema } from "./athena"

describe("CouncilMemberSchema", () => {
  test("accepts member config with model and name", () => {
    //#given
    const config = { model: "anthropic/claude-opus-4-6", name: "member-a" }

    //#when
    const result = CouncilMemberSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
  })

  test("accepts member config with all optional fields", () => {
    //#given
    const config = {
      model: "openai/gpt-5.3-codex",
      variant: "high",
      name: "analyst-a",
      temperature: 0.3,
    }

    //#when
    const result = CouncilMemberSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
  })

  test("rejects member config missing model", () => {
    //#given
    const config = { name: "no-model" }

    //#when
    const result = CouncilMemberSchema.safeParse(config)

    //#then
    expect(result.success).toBe(false)
  })

  test("rejects model string without provider/model separator", () => {
    //#given
    const config = { model: "invalid-model", name: "test-member" }

    //#when
    const result = CouncilMemberSchema.safeParse(config)

    //#then
    expect(result.success).toBe(false)
  })

  test("rejects model string with empty provider", () => {
    //#given
    const config = { model: "/gpt-5.3-codex", name: "test-member" }

    //#when
    const result = CouncilMemberSchema.safeParse(config)

    //#then
    expect(result.success).toBe(false)
  })

  test("rejects model string with empty model ID", () => {
    //#given
    const config = { model: "openai/", name: "test-member" }

    //#when
    const result = CouncilMemberSchema.safeParse(config)

    //#then
    expect(result.success).toBe(false)
  })

  test("rejects empty model string", () => {
    //#given
    const config = { model: "" }

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
    const config = { model: "xai/grok-code-fast-1", name: "member-x" }

    //#when
    const parsed = CouncilMemberSchema.parse(config)

    //#then
    expect(parsed.variant).toBeUndefined()
    expect(parsed.temperature).toBeUndefined()
  })

  test("rejects member config missing name", () => {
    //#given
    const config = { model: "anthropic/claude-opus-4-6" }

    //#when
    const result = CouncilMemberSchema.safeParse(config)

    //#then
    expect(result.success).toBe(false)
  })

  test("rejects member config with empty name", () => {
    //#given
    const config = { model: "anthropic/claude-opus-4-6", name: "" }

    //#when
    const result = CouncilMemberSchema.safeParse(config)

    //#then
    expect(result.success).toBe(false)
  })

  test("accepts member config with temperature", () => {
    //#given
    const config = { model: "openai/gpt-5.3-codex", name: "member-a", temperature: 0.5 }

    //#when
    const result = CouncilMemberSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.temperature).toBe(0.5)
    }
  })

  test("rejects temperature below 0", () => {
    //#given
    const config = { model: "openai/gpt-5.3-codex", name: "test-member", temperature: -0.1 }

    //#when
    const result = CouncilMemberSchema.safeParse(config)

    //#then
    expect(result.success).toBe(false)
  })

  test("rejects temperature above 2", () => {
    //#given
    const config = { model: "openai/gpt-5.3-codex", name: "test-member", temperature: 2.1 }

    //#when
    const result = CouncilMemberSchema.safeParse(config)

    //#then
    expect(result.success).toBe(false)
  })

  test("rejects member config with unknown fields", () => {
    //#given
    const config = { model: "openai/gpt-5.3-codex", name: "test-member", unknownField: true }

    //#when
    const result = CouncilMemberSchema.safeParse(config)

    //#then
    expect(result.success).toBe(false)
  })

  test("trims leading and trailing whitespace from name", () => {
    //#given
    const config = { model: "anthropic/claude-opus-4-6", name: "  member-a  " }

    //#when
    const result = CouncilMemberSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.name).toBe("member-a")
    }
  })

  test("accepts name with spaces like 'Claude Opus 4'", () => {
    //#given
    const config = { model: "anthropic/claude-opus-4-6", name: "Claude Opus 4" }

    //#when
    const result = CouncilMemberSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
  })

  test("accepts name with dots like 'Claude 4.6'", () => {
    //#given
    const config = { model: "anthropic/claude-opus-4-6", name: "Claude 4.6" }

    //#when
    const result = CouncilMemberSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
  })

  test("accepts name with hyphens like 'my-model-1'", () => {
    //#given
    const config = { model: "anthropic/claude-opus-4-6", name: "my-model-1" }

    //#when
    const result = CouncilMemberSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
  })

  test("rejects name with special characters like '@'", () => {
    //#given
    const config = { model: "anthropic/claude-opus-4-6", name: "member@1" }

    //#when
    const result = CouncilMemberSchema.safeParse(config)

    //#then
    expect(result.success).toBe(false)
  })

  test("rejects name with exclamation mark", () => {
    //#given
    const config = { model: "anthropic/claude-opus-4-6", name: "member!" }

    //#when
    const result = CouncilMemberSchema.safeParse(config)

    //#then
    expect(result.success).toBe(false)
  })

  test("rejects name starting with a space after trim", () => {
    //#given
    const config = { model: "anthropic/claude-opus-4-6", name: " " }

    //#when
    const result = CouncilMemberSchema.safeParse(config)

    //#then
    expect(result.success).toBe(false)
  })
})

describe("CouncilConfigSchema", () => {
  test("accepts council with 2 members", () => {
    //#given
    const config = {
      members: [
        { model: "anthropic/claude-opus-4-6", name: "member-a" },
        { model: "openai/gpt-5.3-codex", name: "member-b" },
      ],
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
        { model: "anthropic/claude-opus-4-6", name: "a" },
        { model: "openai/gpt-5.3-codex", name: "b", variant: "high" },
        { model: "xai/grok-code-fast-1", name: "c", variant: "low" },
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
    const config = { members: [{ model: "anthropic/claude-opus-4-6", name: "member-a" }] }

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

  test("accepts council with duplicate member names for graceful runtime handling", () => {
    //#given - duplicate detection is handled at runtime by registerCouncilMemberAgents,
    // not at schema level, to allow graceful fallback instead of hard parse failure
    const config = {
      members: [
        { model: "anthropic/claude-opus-4-6", name: "analyst" },
        { model: "openai/gpt-5.3-codex", name: "analyst" },
      ],
    }

    //#when
    const result = CouncilConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
  })

  test("accepts council with case-insensitive duplicate names for graceful runtime handling", () => {
    //#given - case-insensitive dedup is handled at runtime by registerCouncilMemberAgents
    const config = {
      members: [
        { model: "anthropic/claude-opus-4-6", name: "Claude" },
        { model: "openai/gpt-5.3-codex", name: "claude" },
      ],
    }

    //#when
    const result = CouncilConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
  })

  test("accepts council with unique member names", () => {
    //#given
    const config = {
      members: [
        { model: "anthropic/claude-opus-4-6", name: "analyst-a" },
        { model: "openai/gpt-5.3-codex", name: "analyst-b" },
      ],
    }

    //#when
    const result = CouncilConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
  })
})

describe("AthenaConfigSchema", () => {
  test("accepts Athena config with council", () => {
    //#given
    const config = {
      council: {
        members: [
          { model: "openai/gpt-5.3-codex", name: "member-a" },
          { model: "xai/grok-code-fast-1", name: "member-b" },
        ],
      },
    }

    //#when
    const result = AthenaConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
  })

  test("rejects Athena config without council", () => {
    //#given
    const config = {}

    //#when
    const result = AthenaConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(false)
  })

  test("rejects Athena config with unknown model field", () => {
    //#given
    const config = {
      model: "anthropic/claude-opus-4-6",
      council: {
        members: [
          { model: "openai/gpt-5.3-codex", name: "member-a" },
          { model: "xai/grok-code-fast-1", name: "member-b" },
        ],
      },
    }

    //#when
    const result = AthenaConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(false)
  })
})
