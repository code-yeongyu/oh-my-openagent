import { describe, expect, it } from "bun:test"
import {
  parseLookupOutput,
  resolveClaudeBinaryDiagnostics,
  type CommandExecutionResult,
} from "./tools-claude-binary"

describe("tools-claude-binary", () => {
  describe("parseLookupOutput", () => {
    it("deduplicates and trims lookup output", () => {
      const output = " /usr/local/bin/claude \n/Users/me/.local/bin/claude\n/usr/local/bin/claude\n"
      const result = parseLookupOutput(output)
      expect(result).toEqual(["/usr/local/bin/claude", "/Users/me/.local/bin/claude"])
    })
  })

  describe("resolveClaudeBinaryDiagnostics", () => {
    it("reports conflict when multiple binaries are returned", async () => {
      const executeCommand = async (_command: string[]): Promise<CommandExecutionResult> => ({
        exitCode: 0,
        stdout: "/Users/me/.local/bin/claude\n/usr/local/bin/claude\n",
      })
      const result = await resolveClaudeBinaryDiagnostics(executeCommand)
      expect(result.activePath).toBe("/Users/me/.local/bin/claude")
      expect(result.discoveredPaths.length).toBe(2)
      expect(result.hasConflict).toBe(true)
    })

    it("returns empty diagnostics when no lookup command succeeds", async () => {
      const executeCommand = async (_command: string[]): Promise<CommandExecutionResult> => {
        throw new Error("missing")
      }
      const result = await resolveClaudeBinaryDiagnostics(executeCommand)
      expect(result.activePath).toBeNull()
      expect(result.discoveredPaths).toEqual([])
      expect(result.hasConflict).toBe(false)
    })
  })
})
