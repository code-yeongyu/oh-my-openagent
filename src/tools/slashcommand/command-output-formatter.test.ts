/// <reference types="bun-types" />

import { describe, test, expect } from "bun:test"
import type { CommandInfo } from "./types"
import {
  resetGlobalCompressionConfig,
  setGlobalCompressionConfig,
} from "../../shared/toon-compression/config-store"

// Helper to create mock command info
function createMockCommandInfo(id: number): CommandInfo {
  return {
    name: `command-${String(id).padStart(3, "0")}`,
    path: `/path/to/command-${id}.md`,
    scope: id % 2 === 0 ? "project" : "user",
    content: `This is command content for command ${id}. It has some description and instructions.`,
    metadata: {
      name: `command-${String(id).padStart(3, "0")}`,
      description: `Description for command ${id} - a sample command with detailed info`,
      argumentHint: id % 2 === 0 ? "<arg1> [arg2]" : undefined,
    },
  }
}

function createMockCommandList(count: number): CommandInfo[] {
  return Array.from({ length: count }, (_, i) => createMockCommandInfo(i + 1))
}

describe("formatCommandList", () => {
  describe("#given empty command list", () => {
    describe("#when formatting", () => {
      test("#then returns no commands message", async () => {
        const { formatCommandList } = await import("./command-output-formatter")
        const result = formatCommandList([])

        expect(result).toBe("No commands or skills found.")
      })
    })
  })

  describe("#given small command list", () => {
    describe("#when formatting without compression", () => {
      test("#then returns formatted text", async () => {
        const { formatCommandList } = await import("./command-output-formatter")
        const commands = createMockCommandList(3)
        setGlobalCompressionConfig({ enabled: false, threshold: 5000 })

        const formatted = formatCommandList(commands)

        expect(formatted).toContain("Available Commands & Skills")
        expect(formatted).toContain("command-001")
        expect(formatted).toContain("**Total**: 3 items")
      })
    })

    describe("#when formatting with compression enabled but output small", () => {
      test("#then returns formatted text not compressed", async () => {
        const { formatCommandList } = await import("./command-output-formatter")
        const commands = createMockCommandList(3)
        setGlobalCompressionConfig({ enabled: true, threshold: 5000 })

        const formatted = formatCommandList(commands)

        expect(formatted).toContain("Available Commands & Skills")
        expect(formatted).not.toContain("toon:")
      })
    })
  })

  describe("#given large command list exceeding threshold", () => {
    describe("#when compression is enabled", () => {
      test("#then returns compressed TOON format", async () => {
        const { formatCommandList } = await import("./command-output-formatter")
        const commands = createMockCommandList(100)
        setGlobalCompressionConfig({ enabled: true, threshold: 1000 })

        const formatted = formatCommandList(commands)

        // TOON format: [count]: for nested objects OR toon: for mocked compression
        const isCompressed = formatted.includes("[100]:") || formatted.startsWith("toon:")
        expect(isCompressed).toBe(true)
        // Verify the data structure is preserved in the output
        expect(formatted).toContain("name")
        expect(formatted).toContain("command-001")
      })
    })

    describe("#when compression is disabled", () => {
      test("#then returns formatted text", async () => {
        const { formatCommandList } = await import("./command-output-formatter")
        const commands = createMockCommandList(100)
        setGlobalCompressionConfig({ enabled: false, threshold: 1000 })

        const formatted = formatCommandList(commands)

        expect(formatted).toContain("Available Commands & Skills")
        expect(formatted).toContain("**Total**: 100 items")
      })
    })
  })

  describe("#given commands without descriptions", () => {
    describe("#when formatting", () => {
      test("#then shows no description placeholder", async () => {
        const { formatCommandList } = await import("./command-output-formatter")
        const commands: CommandInfo[] = [
          {
            name: "no-desc-cmd",
            path: "/path/to/cmd.md",
            scope: "project",
            content: "content",
            metadata: { name: "no-desc-cmd", description: "" },
          },
        ]

        setGlobalCompressionConfig({ enabled: false, threshold: 5000 })
        const formatted = formatCommandList(commands)

        expect(formatted).toContain("(no description)")
      })
    })
  })
})

describe("formatLoadedCommand", () => {
  describe("#given command with all metadata", () => {
    describe("#when formatting", () => {
      test("#then includes all metadata fields", async () => {
        const { formatLoadedCommand } = await import("./command-output-formatter")
        const command: CommandInfo = {
          name: "test-cmd",
          path: "/path/to/test-cmd.md",
          scope: "project",
          content: "This is the command content.",
          metadata: {
            name: "test-cmd",
            description: "A test command",
            argumentHint: "<arg>",
            model: "claude-3",
            agent: "sisyphus",
            subtask: true,
          },
        }

        const formatted = await formatLoadedCommand(command)

        expect(formatted).toContain("test-cmd")
        expect(formatted).toContain("A test command")
        expect(formatted).toContain("<arg>")
        expect(formatted).toContain("claude-3")
        expect(formatted).toContain("sisyphus")
        expect(formatted).toContain("Subtask")
      })
    })
  })

  describe("#given command with user message", () => {
    describe("#when formatting", () => {
      test("#then substitutes user_message placeholder", async () => {
        const { formatLoadedCommand } = await import("./command-output-formatter")
        const command: CommandInfo = {
          name: "test-cmd",
          path: "/path/to/test-cmd.md",
          scope: "project",
          content: "Hello ${user_message}!",
          metadata: { name: "test-cmd", description: "test command" },
        }

        const formatted = await formatLoadedCommand(command, "World")

        expect(formatted).toContain("Hello World!")
      })
    })
  })

  describe("#given command template includes argument placeholders", () => {
    test("#then replaces both placeholder forms", async () => {
      const { formatLoadedCommand } = await import("./command-output-formatter")
      const command: CommandInfo = {
        name: "daplug:templated",
        metadata: {
          name: "daplug:templated",
          description: "Templated plugin command",
        },
        content: "Echo $ARGUMENTS and ${user_message}.",
        scope: "plugin",
      }

      const output = await formatLoadedCommand(command, "ship it")

      expect(output).toContain("Echo ship it and ship it.")
      expect(output).not.toContain("$ARGUMENTS")
      expect(output).not.toContain("${user_message}")
    })
  })
})

resetGlobalCompressionConfig()
