import { describe, expect, test } from "bun:test"

import { createContextInfoTool } from "./tools"

describe("createContextInfoTool", () => {
  test("#given a hallucinated context_info call #when the tool executes #then it returns concise project context guidance", async () => {
    const tool = createContextInfoTool({ directory: "/repo" } as never)

    const result = await tool.execute({}, {
      directory: "/runtime-repo",
      sessionID: "ses-123",
    } as never)

    expect(result).toContain('"project_path": "/runtime-repo"')
    expect(result).toContain('"tool": "context_info"')
    expect(result).toContain("Use glob to find files")
  })
})
