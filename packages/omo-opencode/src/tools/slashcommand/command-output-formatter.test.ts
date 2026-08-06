import { describe, expect, it } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { formatLoadedCommand } from "./command-output-formatter"
import type { CommandInfo } from "./types"

describe("command output formatter", () => {
  describe("#given command template includes argument placeholders", () => {
    it("#then replaces both placeholder forms", async () => {
      // given
      const command: CommandInfo = {
        name: "daplug:templated",
        metadata: {
          name: "daplug:templated",
          description: "Templated plugin command",
        },
        content: "Echo $ARGUMENTS and ${user_message}.",
        scope: "plugin",
      }

      // when
      const output = await formatLoadedCommand(command, "ship it")

      // then
      expect(output).toContain("Echo ship it and ship it.")
      expect(output).not.toContain("$ARGUMENTS")
      expect(output).not.toContain("${user_message}")
    })
  })

  describe("#given command content mixes a real @file reference with literal @token prose", () => {
    it("#then inlines the real file but leaves the documentation token uncorrupted", async () => {
      // given
      const fixtureDir = join(tmpdir(), `command-output-formatter-${Date.now()}`)
      mkdirSync(fixtureDir, { recursive: true })
      writeFileSync(join(fixtureDir, "real.md"), "REAL_FILE_CONTENT", "utf8")
      try {
        const command: CommandInfo = {
          name: "daplug:wrapper",
          path: join(fixtureDir, "wrapper.md"),
          metadata: { name: "daplug:wrapper", description: "Wrapper command" },
          content: "File references (@path) are relative here. Load @real.md now.",
          scope: "plugin",
        }

        // when
        const output = await formatLoadedCommand(command)

        // then
        expect(output).toContain("REAL_FILE_CONTENT")
        expect(output).toContain("(@path)")
        expect(output).not.toContain("[file not found:")
      } finally {
        rmSync(fixtureDir, { recursive: true, force: true })
      }
    })
  })
})
