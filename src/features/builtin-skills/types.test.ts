import { describe, test, expect } from "bun:test"
import type {
  BuiltinSkill,
  BuiltinSkillHooks,
  BuiltinSkillHookHandler,
  BuiltinSkillHookContext,
  BuiltinSkillHookResult,
} from "./types"

describe("BuiltinSkill types", () => {
  test("BuiltinSkill accepts hooks field", () => {
    // #given - a skill with embedded hooks
    const skill: BuiltinSkill = {
      name: "test-skill",
      description: "A test skill with hooks",
      template: "# Test Skill",
      hooks: {
        PostToolUse: [
          {
            matcher: "Read",
            handler: () => ({ additionalContext: "test" }),
          },
        ],
      },
    }

    // #then - type check passes and hooks are accessible
    expect(skill.hooks).toBeDefined()
    expect(skill.hooks?.PostToolUse).toHaveLength(1)
    expect(skill.hooks?.PostToolUse?.[0].matcher).toBe("Read")
  })

  test("BuiltinSkill works without hooks field", () => {
    // #given - a skill without hooks (backwards compatible)
    const skill: BuiltinSkill = {
      name: "simple-skill",
      description: "A simple skill without hooks",
      template: "# Simple",
    }

    // #then - hooks is undefined
    expect(skill.hooks).toBeUndefined()
  })

  test("BuiltinSkillHookHandler supports string matcher", () => {
    // #given
    const handler: BuiltinSkillHookHandler = {
      matcher: "Read",
      handler: () => ({}),
    }

    // #then
    expect(handler.matcher).toBe("Read")
  })

  test("BuiltinSkillHookHandler supports RegExp matcher", () => {
    // #given
    const handler: BuiltinSkillHookHandler = {
      matcher: /^(Read|Write)$/,
      handler: () => ({}),
    }

    // #then
    expect(handler.matcher).toBeInstanceOf(RegExp)
  })

  test("BuiltinSkillHookContext contains required fields", () => {
    // #given
    const context: BuiltinSkillHookContext = {
      tool: "Read",
      sessionID: "ses_123",
      callID: "call_456",
      args: { filePath: "/test.md" },
      output: "file content",
      cwd: "/project",
    }

    // #then
    expect(context.tool).toBe("Read")
    expect(context.sessionID).toBe("ses_123")
    expect(context.args.filePath).toBe("/test.md")
  })

  test("BuiltinSkillHookResult supports additionalContext", () => {
    // #given
    const result: BuiltinSkillHookResult = {
      additionalContext: "Remember to use mdsel for large markdown files",
    }

    // #then
    expect(result.additionalContext).toContain("mdsel")
  })

  test("BuiltinSkillHookResult supports blocking (PreToolUse)", () => {
    // #given
    const result: BuiltinSkillHookResult = {
      block: true,
      blockReason: "This operation is not allowed",
    }

    // #then
    expect(result.block).toBe(true)
    expect(result.blockReason).toBeDefined()
  })

  test("BuiltinSkillHooks supports both PreToolUse and PostToolUse", () => {
    // #given
    const hooks: BuiltinSkillHooks = {
      PreToolUse: [
        {
          matcher: "Write",
          handler: () => ({ block: false }),
        },
      ],
      PostToolUse: [
        {
          matcher: "Read",
          handler: () => ({ additionalContext: "info" }),
        },
      ],
    }

    // #then
    expect(hooks.PreToolUse).toHaveLength(1)
    expect(hooks.PostToolUse).toHaveLength(1)
  })

  test("handler can be async", async () => {
    // #given
    const handler: BuiltinSkillHookHandler = {
      matcher: "Read",
      handler: async (ctx) => {
        await Promise.resolve()
        return { additionalContext: `Processed ${ctx.tool}` }
      },
    }

    // #when
    const context: BuiltinSkillHookContext = {
      tool: "Read",
      sessionID: "ses_test",
      callID: "call_test",
      args: {},
    }
    const result = await handler.handler(context)

    // #then
    expect(result.additionalContext).toBe("Processed Read")
  })
})
