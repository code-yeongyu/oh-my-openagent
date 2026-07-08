/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { clearCommandLoaderCache } from "../../features/claude-code-command-loader"
import type { LoadedSkill } from "../../features/opencode-skill-loader/types"
import { BTW_AUTO_SLASH_COMMAND_MARKER } from "../btw-context-strip/predicates"
import { _resetBtwTurnStateForTesting, isBtwTurnActive } from "../btw-tool-guard/turn-state"
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
    _resetBtwTurnStateForTesting()
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
    it("should mark empty /btw via chat.message so it is stripped from future context", async () => {
      // given a user types a bare /btw with no question on the chat.message route
      const hook = createAutoSlashCommandHook()
      const sessionID = `test-session-btw-chat-empty-${Date.now()}`
      const input = createMockInput(sessionID)
      const output = createMockOutput("/btw")

      // when
      await hook["chat.message"](input, output)

      // then the expanded /btw turn carries the strip marker on message and part
      expect(output.message?.[BTW_AUTO_SLASH_COMMAND_MARKER]).toBe(true)
      expect(output.parts[0]?.[BTW_AUTO_SLASH_COMMAND_MARKER]).toBe(true)
      expect(output.parts[0].text).toContain("<auto-slash-command>")
      expect(output.parts[0].text).toContain("# BTW Command")
    })

    it("should mark whitespace-only /btw via chat.message so it is stripped from future context", async () => {
      // given a user types /btw followed only by whitespace on the chat.message route
      const hook = createAutoSlashCommandHook()
      const sessionID = `test-session-btw-chat-ws-${Date.now()}`
      const input = createMockInput(sessionID)
      const output = createMockOutput("/btw    ")

      // when
      await hook["chat.message"](input, output)

      // then the expanded /btw turn still carries the strip marker
      expect(output.message?.[BTW_AUTO_SLASH_COMMAND_MARKER]).toBe(true)
      expect(output.parts[0]?.[BTW_AUTO_SLASH_COMMAND_MARKER]).toBe(true)
      expect(output.parts[0].text).toContain("<auto-slash-command>")
    })
  })

  describe("disabled builtin commands", () => {
    it("should not expand /btw via chat.message when disabled_commands includes btw", async () => {
      // given btw is disabled in config
      const hook = createAutoSlashCommandHook({ disabledCommands: ["btw"] })
      const sessionID = `test-session-btw-disabled-chat-${Date.now()}`
      const output = createMockOutput("/btw secret aside")
      const originalText = output.parts[0].text

      // when the message routes through chat.message
      await hook["chat.message"](createMockInput(sessionID), output)

      // then the message is left untouched and unmarked
      expect(output.parts[0].text).toBe(originalText)
      expect(output.message?.[BTW_AUTO_SLASH_COMMAND_MARKER]).toBeUndefined()
      expect(isBtwTurnActive(sessionID)).toBe(false)
    })

    it("should not expand /btw via command.execute.before when disabled_commands includes btw", async () => {
      // given btw is disabled in config
      const hook = createAutoSlashCommandHook({ disabledCommands: ["btw"] })
      const sessionID = `test-session-btw-disabled-cmd-${Date.now()}`
      const input: CommandExecuteBeforeInput = {
        sessionID,
        command: "btw",
        arguments: "secret aside",
        agent: "test-agent",
      }
      const output: CommandExecuteBeforeOutput = { parts: [{ type: "text", text: "/btw secret aside" }] }

      // when the native command routes through command.execute.before
      await hook["command.execute.before"](input, output)

      // then no template is injected and the session is not marked
      expect(output.parts[0].text).toBe("/btw secret aside")
      expect(isBtwTurnActive(sessionID)).toBe(false)
    })

    it("should still expand other builtin commands when only btw is disabled", async () => {
      // given btw is disabled but init-deep is not
      const hook = createAutoSlashCommandHook({ disabledCommands: ["btw"] })
      const sessionID = `test-session-other-enabled-${Date.now()}`
      const output = createMockOutput("/init-deep")

      // when the message routes through chat.message
      await hook["chat.message"](createMockInput(sessionID), output)

      // then the non-disabled builtin still expands
      expect(output.parts[0].text).toContain("<auto-slash-command>")
    })
  })

  describe("btw turn state for the tool guard", () => {
    it("should record an active /btw turn when chat.message expands /btw", async () => {
      // given a /btw question arriving on the chat.message route
      const hook = createAutoSlashCommandHook()
      const sessionID = `test-session-btw-state-on-${Date.now()}`

      // when the /btw message is expanded
      await hook["chat.message"](createMockInput(sessionID), createMockOutput("/btw quick aside"))

      // then the local turn state marks the session as an active /btw turn
      expect(isBtwTurnActive(sessionID)).toBe(true)
    })

    it("should clear the active /btw turn when the next normal message arrives", async () => {
      // given a session with a completed /btw expansion
      const hook = createAutoSlashCommandHook()
      const sessionID = `test-session-btw-state-off-${Date.now()}`
      await hook["chat.message"](createMockInput(sessionID), createMockOutput("/btw quick aside"))

      // when a normal follow-up message arrives
      await hook["chat.message"](createMockInput(sessionID), createMockOutput("back to real work"))

      // then the local turn state no longer marks the session
      expect(isBtwTurnActive(sessionID)).toBe(false)
    })

    it("should keep the active /btw turn when the marked message refires with tags", async () => {
      // given a /btw expansion whose tagged message refires through chat.message
      const hook = createAutoSlashCommandHook()
      const sessionID = `test-session-btw-state-refire-${Date.now()}`
      const output = createMockOutput("/btw quick aside")
      await hook["chat.message"](createMockInput(sessionID), output)

      // when the already-expanded btw message is observed again
      await hook["chat.message"](createMockInput(sessionID), output)

      // then the turn state stays active
      expect(isBtwTurnActive(sessionID)).toBe(true)
    })

    it("should record an active /btw turn on the command.execute.before route", async () => {
      // given a native /btw command execution
      const hook = createAutoSlashCommandHook()
      const sessionID = `test-session-btw-state-cmd-${Date.now()}`
      const input: CommandExecuteBeforeInput = {
        sessionID,
        command: "btw",
        arguments: "quick aside",
        agent: "test-agent",
      }
      const output: CommandExecuteBeforeOutput = { parts: [{ type: "text", text: "/btw quick aside" }] }

      // when the command route expands /btw
      await hook["command.execute.before"](input, output)

      // then the local turn state marks the session
      expect(isBtwTurnActive(sessionID)).toBe(true)
    })

    it("should clear the turn state when the session is deleted", async () => {
      // given a session with an active /btw turn
      const hook = createAutoSlashCommandHook()
      const sessionID = `test-session-btw-state-del-${Date.now()}`
      await hook["chat.message"](createMockInput(sessionID), createMockOutput("/btw quick aside"))

      // when the session is deleted
      await hook["event"]({ event: { type: "session.deleted", properties: { info: { id: sessionID } } } })

      // then the local turn state is cleared
      expect(isBtwTurnActive(sessionID)).toBe(false)
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

  describe("excluded commands", () => {
    it("should NOT trigger for ralph-loop command", async () => {
      // given ralph-loop command
      const hook = createAutoSlashCommandHook()
      const sessionID = `test-session-ralph-${Date.now()}`
      const input = createMockInput(sessionID)
      const output = createMockOutput("/ralph-loop do something")
      const originalText = output.parts[0].text

      // when hook is called
      await hook["chat.message"](input, output)

      // then should not modify (excluded command)
      expect(output.parts[0].text).toBe(originalText)
    })

    it("should NOT trigger for cancel-ralph command", async () => {
      // given cancel-ralph command
      const hook = createAutoSlashCommandHook()
      const sessionID = `test-session-cancel-${Date.now()}`
      const input = createMockInput(sessionID)
      const output = createMockOutput("/cancel-ralph")
      const originalText = output.parts[0].text

      // when hook is called
      await hook["chat.message"](input, output)

      // then should not modify
      expect(output.parts[0].text).toBe(originalText)
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

    it("should inject template for known builtin commands like ralph-loop", async () => {
      //#given
      const hook = createAutoSlashCommandHook()
      const input = createCommandInput("ralph-loop")
      const output = createCommandOutput("original")

      //#when
      await hook["command.execute.before"](input, output)

      //#then
      expect(output.parts[0].text).toContain("<auto-slash-command>")
      expect(output.parts[0].text).toContain("/ralph-loop Command")
    })


    it("should mark /btw native command output with structural metadata", async () => {
      //#given
      const hook = createAutoSlashCommandHook()
      const input = createCommandInput("btw", "What is PURPLE-PANDA-47?")
      const output: CommandExecuteBeforeOutput = {
        parts: [{ type: "text", text: "original" }],
        message: {},
      }

      //#when
      await hook["command.execute.before"](input, output)

      //#then
      expect(output.message?.[BTW_AUTO_SLASH_COMMAND_MARKER]).toBe(true)
      expect(output.parts[0]?.[BTW_AUTO_SLASH_COMMAND_MARKER]).toBe(true)
      expect(output.parts[0]?.text).toContain("<auto-slash-command>")
      expect(output.parts[0]?.text).toContain("# BTW Command")
    })

    it("should mark empty /btw native command output so it is still stripped from future context", async () => {
      //#given an empty /btw (no question): Option B drops the usage special-case,
      //#given so an empty /btw must expand and mark exactly like a real question
      const hook = createAutoSlashCommandHook()
      const input = createCommandInput("btw", "")
      const output: CommandExecuteBeforeOutput = {
        parts: [{ type: "text", text: "original" }],
        message: {},
      }

      //#when
      await hook["command.execute.before"](input, output)

      //#then the empty /btw turn carries the strip marker, so btw-context-strip removes it
      expect(output.message?.[BTW_AUTO_SLASH_COMMAND_MARKER]).toBe(true)
      expect(output.parts[0]?.[BTW_AUTO_SLASH_COMMAND_MARKER]).toBe(true)
      expect(output.parts[0]?.text).toContain("<auto-slash-command>")
      expect(output.parts[0]?.text).toContain("# BTW Command")
    })

    it("should mark inserted /btw command parts when native output starts empty", async () => {
      //#given
      const hook = createAutoSlashCommandHook()
      const input = createCommandInput("btw", "What is PURPLE-PANDA-47?")
      const output: CommandExecuteBeforeOutput = {
        parts: [],
        message: {},
      }

      //#when
      await hook["command.execute.before"](input, output)

      //#then
      expect(output.message?.[BTW_AUTO_SLASH_COMMAND_MARKER]).toBe(true)
      expect(output.parts[0]?.[BTW_AUTO_SLASH_COMMAND_MARKER]).toBe(true)
      expect(output.parts[0]?.text).toContain("<auto-slash-command>")
      expect(output.parts[0]?.text).toContain("# BTW Command")
    })

    it("should not duplicate injection when command output is already tagged", async () => {
      //#given
      const hook = createAutoSlashCommandHook()
      const input = createCommandInput("ralph-loop")
      const taggedContent = "<auto-slash-command>\n/ralph-loop Command\n</auto-slash-command>"
      const output = createCommandOutput(taggedContent)

      //#when
      await hook["command.execute.before"](input, output)

      //#then
      expect(output.parts).toHaveLength(1)
      expect(output.parts[0]?.text).toBe(taggedContent)
      expect(output.parts[0]?.text?.split("<auto-slash-command>").length).toBe(2)
    })

    it("should inject template for known builtin commands like ulw-loop", async () => {
      //#given
      const hook = createAutoSlashCommandHook()
      const input = createCommandInput("ulw-loop", '"Ship feature" --strategy=continue')
      const output = createCommandOutput("original")

      //#when
      await hook["command.execute.before"](input, output)

      //#then
      expect(output.parts[0].text).toContain("<auto-slash-command>")
      expect(output.parts[0].text).toContain("/ulw-loop Command")
      expect(output.parts[0].text).toContain("<user-task>")
      expect(output.parts[0].text).toContain('"Ship feature" --strategy=continue')
    })

    it("should pass command arguments correctly", async () => {
      //#given
      const hook = createAutoSlashCommandHook()
      const input = createCommandInput("some-command", "arg1 arg2 arg3")
      const output = createCommandOutput("original")

      //#when
      await hook["command.execute.before"](input, output)

      //#then
      expect(logCalls.some(([message, data]) => {
        if (message !== "[auto-slash-command] command.execute.before received") {
          return false
        }
        if (typeof data !== "object" || data === null) {
          return false
        }
        const record = data as Record<string, unknown>
        return record.command === "some-command" && record.arguments === "arg1 arg2 arg3"
      })).toBe(true)
    })

    it("should not duplicate injection when parts already contain auto-slash-command tags (#3724)", async () => {
      //#given - parts already have tags (as if chat.message hook already ran)
      const hook = createAutoSlashCommandHook()
      const input = createCommandInput("ralph-loop")
      const alreadyTagged = "<auto-slash-command>\n/ralph-loop Command\n## Command Instructions\ntemplate content\n</auto-slash-command>"
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
