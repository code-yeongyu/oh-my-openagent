import { describe, expect, mock, spyOn, test } from "bun:test"
import { renderAgentHeader } from "./output-renderer"

describe("renderAgentHeader", () => {
  test("strips zero-width characters before printing the agent label", () => {
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(mock(() => true))

    try {
      renderAgentHeader("\u200B\u200BHephaestus - Deep Agent", "gpt-5.4", null, {
        "Hephaestus - Deep Agent": "#ff00ff",
      })

      const output = writeSpy.mock.calls.map(([chunk]) => String(chunk)).join("")
      expect(output).toContain("Hephaestus - Deep Agent")
      expect(output).not.toContain("\u200B\u200BHephaestus - Deep Agent")
    } finally {
      writeSpy.mockRestore()
    }
  })
})
