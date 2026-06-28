import { describe, expect, it } from "bun:test"
import type { ClaudeCodeMcpServer } from "@oh-my-opencode/claude-code-compat-core/claude-code-mcp-loader/types"
import { getConnectionType } from "./connection-type"
import { createCleanMcpEnvironment } from "./env-cleaner"
import { redactSensitiveData } from "./error-redaction"
import { buildSkillMcpClientKey } from "./manager"

describe("skill MCP core behavior", () => {
  it("#given MCP config variants #when detecting connection type #then legacy sse maps to http", () => {
    // given
    const legacySseConfig = { type: "sse", url: "https://example.com/mcp" } as const
    const inferredStdioConfig: ClaudeCodeMcpServer = { command: "node", args: ["server.js"] }

    expect(getConnectionType(legacySseConfig)).toBe("http")
    expect(getConnectionType(inferredStdioConfig)).toBe("stdio")
    expect(getConnectionType({})).toBeNull()
  })

  it("#given ambient secrets and declared MCP env #when cleaning env #then only ambient secrets are stripped", () => {
    // given
    const originalToken = process.env["OPENAI_API_KEY"]
    process.env["OPENAI_API_KEY"] = "ambient-secret"

    try {
      // when
      const cleaned = createCleanMcpEnvironment({ OPENAI_API_KEY: "declared-secret", SAFE_FLAG: "1" })

      // then
      expect(cleaned["OPENAI_API_KEY"]).toBe("declared-secret")
      expect(cleaned["SAFE_FLAG"]).toBe("1")
    } finally {
      if (originalToken === undefined) {
        delete process.env["OPENAI_API_KEY"]
      } else {
        process.env["OPENAI_API_KEY"] = originalToken
      }
    }
  })

  it("#given token-bearing text #when redacting #then secret values are removed", () => {
    // given
    const message = "Authorization: Bearer sk-123456789012345678901234"

    // when
    const redacted = redactSensitiveData(message)

    // then
    expect(redacted).toContain("[REDACTED]")
    expect(redacted).not.toContain("sk-123456789012345678901234")
  })

  it("#given Slack token-bearing text #when redacting #then Slack token values are removed", () => {
    // given
    const message = "mcp args: --token=xoxp-1234567890-1234567890-1234567890"

    // when
    const redacted = redactSensitiveData(message)

    // then
    expect(redacted).toContain("[REDACTED]")
    expect(redacted).not.toContain("xoxp-1234567890-1234567890-1234567890")
  })

  it("#given CDP option #when building key #then session skill and server isolation is preserved", () => {
    // given
    const info = { sessionID: "ses_1", skillName: "skill-a", serverName: "server-a" }

    expect(buildSkillMcpClientKey(info)).toBe("ses_1:skill-a:server-a")
    expect(buildSkillMcpClientKey(info, { cdpUrl: "ws://127.0.0.1/devtools" })).toBe(
      "ses_1:skill-a:server-a::cdp=ws://127.0.0.1/devtools",
    )
  })
})
