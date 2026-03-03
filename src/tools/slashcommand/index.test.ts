import { describe, expect, it } from "bun:test"
import * as slashcommand from "./index"

describe("slashcommand module exports", () => {
  it("exports discovery API only", () => {
    // given
    const moduleExports = slashcommand as Record<string, unknown>

    // when
    const exportNames = Object.keys(moduleExports)

    // then
    expect(exportNames).toContain("discoverCommandsSync")
    expect(exportNames).not.toContain("createSlashcommandTool")
    expect(exportNames).not.toContain("slashcommand")
  })
})
