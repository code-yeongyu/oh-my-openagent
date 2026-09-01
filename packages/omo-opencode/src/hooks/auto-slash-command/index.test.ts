import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { clearCommandLoaderCache } from "../../features/claude-code-command-loader"
import type { LoadedSkill } from "../../features/opencode-skill-loader/types"
// Import real shared module to avoid mock leaking to other test files
import * as shared from "../../shared"
import type {
  AutoSlashCommandHookInput,
  AutoSlashCommandHookOutput,
  CommandExecuteBeforeInput,
  CommandExecuteBeforeOutput,
} from "./types"

type AutoSlashCommandModule = typeof import("./hook")

function createMockInput(sessionID: string, messageID?: string): AutoSlashCommandHookInput {
  return {
    sessionID,
    messageID: messageID ?? `msg-${Date.now()}-${Math.random()}`,
    agent: "test-agent",
    model: { providerID: "anthropic", modelID: "claude-sonnet-4-6" },
  }
}

function createMockOutput(text: string): AutoSlashCommandHookOutput {
  return {
    message: {
      agent: "test-agent",
      model: { providerID: "anthropic", modelID: "claude-sonnet-4-6" },
      path: { cwd: "/test", root: "/test" },
      tools: {},
    },
    parts: [{ type: "text", text }],
  }
}

describe("createAutoSlashCommandHook", () => {
  let tempDir = ""
  let originalWorkingDirectory = ""
  let logCalls: Array<[string, unknown?]>
  let createAutoSlashCommandHook: AutoSlashCommandModule["createAutoSlashCommandHook"]

  beforeEach(async () => {
    clearCommandLoaderCache()
    mock.restore()
    logCalls = []
    spyOn(shared, "log").mockImplementation((message: string, data?: unknown) => {
      logCalls.push([message, data])
    })
    tempDir = mkdtempSync(join(tmpdir(), "omo-auto-slash-hook-test-"))
    originalWorkingDirectory = process.cwd()

    const autoSlashCommandModule = await import(`./hook?test=${Date.now()}-${Math.random()}`)
    createAutoSlashCommandHook = autoSlashCommandModule.createAutoSlashCommandHook
  })

  afterEach(() => {
    clearCommandLoaderCache()
    process.chdir(originalWorkingDirectory)
    rmSync(tempDir, { recursive: true, force: true })
    mock.restore()
  })

  describe("slash command replacement", () => {
    it("should resolve project commands from provided directory even when cwd differs", async () => {
      // given
      const projectDir = join(tempDir, "project")
      const commandDir = join(projectDir, ".claude", "commands")
      mkdirSync(commandDir, { recursive: true })
      writeFileSync(
        join(commandDir, "project-only-command.md"),
        `---\ndescription: Project command\n---\nExecute from project directory.\n`,
      )
      process.chdir(tempDir)

      const hook = createAutoSlashCommandHook({ directory: projectDir })
      const input = createMockInput(`test-session-project-${Date.now()}`)
      const output = createMockOutput("/project-only-command")

      // when
      await hook["chat.message"](input, output)

      // then
      expect(output.parts[0].text).toContain("<auto-slash-command>")
      expect(output.parts[0].text).toContain("Execute from project directory.")
      expect(output.parts[0].text).toContain("**Scope**: project")
    })

    it("should not modify message when command not found", async () => {
      // given a slash command that doesn't exist
      const hook = createAutoSlashCommandHook()
      const sessionID = `test-session-notfound-${Date.now()}`
      const input = createMockInput(sessionID)
      const output = createMockOutput("/nonexistent-command args")
      const originalText = output.parts[0].text

      // when hook is called
      await hook["chat.message"](input, output)

      // then should NOT modify the message (feature inactive when command not found)
      expect(output.parts[0].text).toBe(originalText)
    })

    it("should not modify message for unknown command (feature inactive)", async () => {
      // given unknown slash command
      const hook = createAutoSlashCommandHook()
      const sessionID = `test-session-tags-${Date.now()}`
      const input = createMockInput(sessionID)
      const output = createMockOutput("/some-command")
      const originalText = output.parts[0].text

      // when hook is called
      await hook["chat.message"](input, output)

      // then should NOT modify (command not found = feature inactive)
      expect(output.parts[0].text).toBe(originalText)
    })

    it("should not modify for unknown command (no prepending)", async () => {
      // given unknown slash command
      const hook = createAutoSlashCommandHook()
      const sessionID = `test-session-replace-${Date.now()}`
      const input = createMockInput(sessionID)
      const output = createMockOutput("/test-cmd some args")
      const originalText = output.parts[0].text

      // when hook is called
      await hook["chat.message"](input, output)

      // then should not modify (feature inactive for unknown commands)
      expect(output.parts[0].text).toBe(originalText)
    })
  })

  describe("no slash command", () => {
    it("should do nothing for regular text", async () => {
      // given regular text without slash
      const hook = createAutoSlashCommandHook()
      const sessionID = `test-session-regular-${Date.now()}`
      const input = createMockInput(sessionID)
      const output = createMockOutput("Just regular text")
      const originalText = output.parts[0].text

      // when hook is called
      await hook["chat.message"](input, output)

      // then should not modify
      expect(output.parts[0].text).toBe(originalText)
    })

    it("should do nothing for slash in middle of text", async () => {
      // given slash in middle
      const hook = createAutoSlashCommandHook()
      const sessionID = `test-session-middle-${Date.now()}`
      const input = createMockInput(sessionID)
      const output = createMockOutput("Please run /commit later")
      const originalText = output.parts[0].text

      // when hook is called
      await hook["chat.message"](input, output)

      // then should not detect (not at start)
      expect(output.parts[0].text).toBe(originalText)
    })
  })

  describe("goal command", () => {
    it("should inject template for /goal via chat.message", async () => {
      // given goal command
      const hook = createAutoSlashCommandHook()
      const sessionID = `test-session-goal-${Date.now()}`
      const input = createMockInput(sessionID)
      const output = createMockOutput("/goal implement the feature")
      const originalText = output.parts[0].text

      // when hook is called
      await hook["chat.message"](input, output)

      // then should replace message with goal template
      expect(output.parts[0].text).not.toBe(originalText)
      expect(output.parts[0].text).toContain("<auto-slash-command>")
      expect(output.parts[0].text).toContain("/goal Command")
      expect(output.parts[0].text).toContain("<user-task>")
      expect(output.parts[0].text).toContain("implement the feature")
    })

    it("should inject template for /goal with no args via chat.message", async () => {
      // given bare goal command
      const hook = createAutoSlashCommandHook()
      const sessionID = `test-session-goal-empty-${Date.now()}`
      const input = createMockInput(sessionID)
      const output = createMockOutput("/goal")
      const originalText = output.parts[0].text

      // when hook is called
      await hook["chat.message"](input, output)

      // then should replace message with goal template
      expect(output.parts[0].text).not.toBe(originalText)
      expect(output.parts[0].text).toContain("<auto-slash-command>")
      expect(output.parts[0].text).toContain("/goal Command")
    })
  })

  describe("already processed", () => {
    it("should skip if auto-slash-command tags already present", async () => {
      // given text with existing tags
      const hook = createAutoSlashCommandHook()
      const sessionID = `test-session-existing-${Date.now()}`
      const input = createMockInput(sessionID)
      const output = createMockOutput(
        "<auto-slash-command>/commit</auto-slash-command>"
      )
      const originalText = output.parts[0].text

      // when hook is called
      await hook["chat.message"](input, output)

      // then should not modify
      expect(output.parts[0].text).toBe(originalText)
    })
  })

  describe("code blocks", () => {
    it("should NOT detect command inside code block", async () => {
      // given command inside code block
      const hook = createAutoSlashCommandHook()
      const sessionID = `test-session-codeblock-${Date.now()}`
      const input = createMockInput(sessionID)
      const output = createMockOutput("```\n/commit\n```")
      const originalText = output.parts[0].text

      // when hook is called
      await hook["chat.message"](input, output)

      // then should not detect
      expect(output.parts[0].text).toBe(originalText)
    })
  })

  describe("edge cases", () => {
    it("should handle empty text", async () => {
      // given empty text
      const hook = createAutoSlashCommandHook()
      const sessionID = `test-session-empty-${Date.now()}`
      const input = createMockInput(sessionID)
      const output = createMockOutput("")

      // when hook is called
      // then should not throw
      await hook["chat.message"](input, output)
    })

    it("should handle just slash", async () => {
      // given just slash
      const hook = createAutoSlashCommandHook()
      const sessionID = `test-session-slash-only-${Date.now()}`
      const input = createMockInput(sessionID)
      const output = createMockOutput("/")
      const originalText = output.parts[0].text

      // when hook is called
      await hook["chat.message"](input, output)

      // then should not modify
      expect(output.parts[0].text).toBe(originalText)
    })

    it("should handle command with special characters in args (not found = no modification)", async () => {
      // given command with special characters that doesn't exist
      const hook = createAutoSlashCommandHook()
      const sessionID = `test-session-special-${Date.now()}`
      const input = createMockInput(sessionID)
      const output = createMockOutput('/execute "test & stuff <tag>"')
      const originalText = output.parts[0].text

      // when hook is called
      await hook["chat.message"](input, output)

      // then should not modify (command not found = feature inactive)
      expect(output.parts[0].text).toBe(originalText)
    })

    it("should handle multiple text parts (unknown command = no modification)", async () => {
      // given multiple text parts with unknown command
      const hook = createAutoSlashCommandHook()
      const sessionID = `test-session-multi-${Date.now()}`
      const input = createMockInput(sessionID)
      const output: AutoSlashCommandHookOutput = {
        message: {},
        parts: [
          { type: "text", text: "/truly-nonexistent-xyz-cmd " },
          { type: "text", text: "some args" },
        ],
      }
      const originalText = output.parts[0].text

      // when hook is called
      await hook["chat.message"](input, output)

      // then should not modify (command not found = feature inactive)
      expect(output.parts[0].text).toBe(originalText)
    })
  })

  describe("command.execute.before hook", () => {
    function createCommandInput(command: string, args: string = ""): CommandExecuteBeforeInput {
      return {
        command,
        sessionID: `test-session-cmd-${Date.now()}-${Math.random()}`,
        arguments: args,
      }
    }

    function createCommandOutput(text?: string): CommandExecuteBeforeOutput {
      return {
        parts: text ? [{ type: "text", text }] : [],
      }
    }

    it("should not modify output for unknown command", async () => {
      //#given
      const hook = createAutoSlashCommandHook()
      const input = createCommandInput("nonexistent-command-xyz")
      const output = createCommandOutput("original text")
      const originalText = output.parts[0].text

      //#when
      await hook["command.execute.before"](input, output)

      //#then
      expect(output.parts[0].text).toBe(originalText)
    })

    it("should add text part when parts array is empty and command is unknown", async () => {
      //#given
      const hook = createAutoSlashCommandHook()
      const input = createCommandInput("nonexistent-command-abc")
      const output = createCommandOutput()

      //#when
      await hook["command.execute.before"](input, output)

      //#then
      expect(output.parts.length).toBe(0)
    })

    it("should inject template for builtin goal command", async () => {
      //#given
      const hook = createAutoSlashCommandHook()
      const input = createCommandInput("goal")
      const output = createCommandOutput("original")

      //#when
      await hook["command.execute.before"](input, output)

      //#then
      expect(output.parts[0].text).toContain("<auto-slash-command>")
      expect(output.parts[0].text).toContain("/goal Command")
    })

    it("should not duplicate injection when command output is already tagged", async () => {
      //#given
      const hook = createAutoSlashCommandHook()
      const input = createCommandInput("goal")
      const taggedContent = "<auto-slash-command>\n/goal Command\n</auto-slash-command>"
      const output = createCommandOutput(taggedContent)

      //#when
      await hook["command.execute.before"](input, output)

      //#then
      expect(output.parts).toHaveLength(1)
      expect(output.parts[0]?.text).toBe(taggedContent)
      expect(output.parts[0]?.text?.split("<auto-slash-command>").length).toBe(2)
    })

    it("should inject template for builtin goal command with arguments", async () => {
      //#given
      const hook = createAutoSlashCommandHook()
      const input = createCommandInput("goal", "implement auth flow")
      const output = createCommandOutput("original")

      //#when
      await hook["command.execute.before"](input, output)

      //#then
      expect(output.parts[0].text).toContain("<auto-slash-command>")
      expect(output.parts[0].text).toContain("/goal Command")
      expect(output.parts[0].text).toContain("<user-task>")
      expect(output.parts[0].text).toContain("implement auth flow")
    })

    it("should pass command arguments correctly", async () => {
      //#given
      const hook = createAutoSlashCommandHook()
      const input = createCommandInput("some-command", "arg1 arg2 arg3")
      const output = createCommandOutput("original")

      //#when
      await hook["command.execute.before"](input, output)

      //#then
      expect(logCalls).toContainEqual([
        "[auto-slash-command] command.execute.before received",
        expect.objectContaining({
          command: "some-command",
          arguments: "arg1 arg2 arg3",
        }),
      ])
    })

    it("should not duplicate injection when parts already contain auto-slash-command tags (#3724)", async () => {
      //#given - parts already have tags (as if chat.message hook already ran)
      const hook = createAutoSlashCommandHook()
      const input = createCommandInput("goal")
      const alreadyTagged = "<auto-slash-command>\n/goal Command\n## Command Instructions\ntemplate content\n</auto-slash-command>"
      const output: CommandExecuteBeforeOutput = {
        parts: [{ type: "text", text: alreadyTagged }],
      }

      //#when
      await hook["command.execute.before"](input, output)

      //#then - parts unchanged, no second injection
      expect(output.parts).toHaveLength(1)
      expect(output.parts[0].text).toBe(alreadyTagged)
      const tagCount = (output.parts[0].text?.split("<auto-slash-command>").length ?? 1) - 1
      expect(tagCount).toBe(1)
    })

  })
  describe("skills as slash commands", () => {
    function createTestSkill(name: string, template: string): LoadedSkill {
      return {
        name,
        path: `/test/skills/${name}/SKILL.md`,
        definition: {
          name,
          description: `Test skill: ${name}`,
          template,
        },
        scope: "user",
      }
    }

    it("should replace message with skill template when skill is used as slash command via chat.message", async () => {
      // given a hook with a skill
      const skill = createTestSkill("my-test-skill", "This is the skill template content")
      const hook = createAutoSlashCommandHook({ skills: [skill] })
      const sessionID = `test-session-skill-chat-${Date.now()}`
      const input = createMockInput(sessionID)
      const output = createMockOutput("/my-test-skill some arguments")

      // when hook processes the message
      await hook["chat.message"](input, output)

      // then should replace message with skill template
      expect(output.parts[0].text).toContain("<auto-slash-command>")
      expect(output.parts[0].text).toContain("/my-test-skill Command")
      expect(output.parts[0].text).toContain("This is the skill template content")
    })

    it("does not replace synthetic slash text with a skill template", async () => {
      // given
      const skill = createTestSkill("my-test-skill", "This is the skill template content")
      const hook = createAutoSlashCommandHook({ skills: [skill] })
      const sessionID = `test-session-skill-synthetic-${Date.now()}`
      const input = createMockInput(sessionID)
      const output: AutoSlashCommandHookOutput = {
        message: {},
        parts: [{ type: "text", text: "/my-test-skill some arguments", synthetic: true }],
      }
      const originalText = output.parts[0].text

      // when
      await hook["chat.message"](input, output)

      // then
      expect(output.parts[0].text).toBe(originalText)
    })

    it("should inject skill template via command.execute.before", async () => {
      // given a hook with a skill
      const skill = createTestSkill("my-test-skill", "Skill template for command execute")
      const hook = createAutoSlashCommandHook({ skills: [skill] })
      const input: CommandExecuteBeforeInput = {
        command: "my-test-skill",
        sessionID: `test-session-skill-cmd-${Date.now()}-${Math.random()}`,
        arguments: "extra args",
      }
      const output: CommandExecuteBeforeOutput = {
        parts: [{ type: "text", text: "original" }],
      }

      // when hook processes the command
      await hook["command.execute.before"](input, output)

      // then should inject skill template
      expect(output.parts[0].text).toContain("<auto-slash-command>")
      expect(output.parts[0].text).toContain("/my-test-skill Command")
      expect(output.parts[0].text).toContain("Skill template for command execute")
      expect(output.parts[0].text).toContain("extra args")
    })

    it("should handle skill with lazy content loader", async () => {
      // given a skill with lazy content (no inline template)
      const skill: LoadedSkill = {
        name: "lazy-skill",
        path: "/test/skills/lazy-skill/SKILL.md",
        definition: {
          name: "lazy-skill",
          description: "A lazy-loaded skill",
          template: "",
        },
        scope: "user",
        lazyContent: {
          loaded: false,
          load: async () => "Lazy loaded skill content here",
        },
      }
      const hook = createAutoSlashCommandHook({ skills: [skill] })
      const sessionID = `test-session-lazy-skill-${Date.now()}`
      const input = createMockInput(sessionID)
      const output = createMockOutput("/lazy-skill")

      // when hook processes the message
      await hook["chat.message"](input, output)

      // then should replace message with lazily loaded content
      expect(output.parts[0].text).toContain("<auto-slash-command>")
      expect(output.parts[0].text).toContain("Lazy loaded skill content here")
    })
  })
})
