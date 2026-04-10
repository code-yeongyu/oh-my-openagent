import { describe, expect, it } from "bun:test"
import { parseSkillMcpConfigFromFrontmatter } from "./skill-mcp-config"

describe("skill MCP config frontmatter parsing", () => {
  it("parses nested MCP config", () => {
    const skillContent = `---
name: test-skill
description: A test skill with MCP
mcp:
  sqlite:
    command: uvx
    args:
      - mcp-server-sqlite
      - --db-path
      - ./data.db
  memory:
    command: npx
    args: [-y, "@anthropic-ai/mcp-server-memory"]
---
This is the skill body.
`

    const mcpConfig = parseSkillMcpConfigFromFrontmatter(skillContent)

    expect(mcpConfig).toBeDefined()
    expect(mcpConfig?.sqlite).toBeDefined()
    expect(mcpConfig?.sqlite?.command).toBe("uvx")
    expect(mcpConfig?.sqlite?.args).toEqual([
      "mcp-server-sqlite",
      "--db-path",
      "./data.db",
    ])
    expect(mcpConfig?.memory).toBeDefined()
    expect(mcpConfig?.memory?.command).toBe("npx")
  })

  it("returns undefined for skill without MCP frontmatter", () => {
    const skillContent = `---
name: simple-skill
description: A simple skill without MCP
---
This is a simple skill.
`

    expect(parseSkillMcpConfigFromFrontmatter(skillContent)).toBeUndefined()
  })

  it("preserves env var placeholders without expansion", () => {
    const skillContent = `---
name: env-skill
mcp:
  api-server:
    command: node
    args: [server.js]
    env:
      API_KEY: "\${API_KEY}"
      DB_PATH: "\${HOME}/data.db"
---
Skill with env vars.
`

    const mcpConfig = parseSkillMcpConfigFromFrontmatter(skillContent)

    expect(mcpConfig?.["api-server"]?.env?.API_KEY).toBe("${API_KEY}")
    expect(mcpConfig?.["api-server"]?.env?.DB_PATH).toBe("${HOME}/data.db")
  })

  it("handles malformed YAML gracefully", () => {
    const skillContent = `---
name: bad-yaml
mcp: [this is not valid yaml for mcp
---
Skill body.
`

    expect(parseSkillMcpConfigFromFrontmatter(skillContent)).toBeUndefined()
  })
})
