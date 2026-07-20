import { describe, expect, test } from "bun:test"
import { MemberSchema } from "./types"

describe("declared team member per-call model override", () => {
  test("#given subagent member with model + reasoning_effort #then parses and carries both", () => {
    // when
    const result = MemberSchema.safeParse({
      kind: "subagent_type",
      name: "scout",
      subagent_type: "sisyphus",
      model: "openai/gpt-5.5",
      reasoning_effort: "xhigh",
    })
    // then
    expect(result.success).toBe(true)
    if (result.success) {
      const data = result.data as { model?: string; reasoning_effort?: string }
      expect(data.model).toBe("openai/gpt-5.5")
      expect(data.reasoning_effort).toBe("xhigh")
    }
  })

  test("#given category member with model variant string #then parses", () => {
    // when
    const result = MemberSchema.safeParse({
      kind: "category",
      name: "writer",
      category: "writing",
      prompt: "Write release notes",
      model: "openai/gpt-5.5 xhigh",
    })
    // then
    expect(result.success).toBe(true)
    if (result.success) {
      const data = result.data as { model?: string }
      expect(data.model).toBe("openai/gpt-5.5 xhigh")
    }
  })

  test("#given member without model #then still parses (configured default preserved)", () => {
    // when
    const result = MemberSchema.safeParse({
      kind: "subagent_type",
      name: "scout",
      subagent_type: "sisyphus",
    })
    // then
    expect(result.success).toBe(true)
    if (result.success) {
      const data = result.data as { model?: string }
      expect(data.model).toBeUndefined()
    }
  })

  test("#given unknown extra field #then rejected (strict schema preserved)", () => {
    // when
    const result = MemberSchema.safeParse({
      kind: "subagent_type",
      name: "scout",
      subagent_type: "sisyphus",
      bogus_field: "nope",
    })
    // then
    expect(result.success).toBe(false)
  })
})
