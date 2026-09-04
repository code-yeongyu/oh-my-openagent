import { afterEach, describe, expect, it, mock } from "bun:test"
import { SkillMcpManager } from "./manager"
import { setStdioClientDependenciesForTesting } from "./stdio-client"
import type { McpClient, McpTransport, SkillMcpClientInfo, SkillMcpServerContext } from "./types"

describe("SkillMcpManager operation retry", () => {
  const managers: SkillMcpManager[] = []

  afterEach(async () => {
    for (const manager of managers) {
      await manager.disconnectAll()
    }
    managers.length = 0
    setStdioClientDependenciesForTesting()
  })

  it("#given cached stdio transport is closed #when calling a tool #then it reconnects and retries", async () => {
    // given
    const manager = new SkillMcpManager()
    managers.push(manager)

    const createdClients: McpClient[] = []
    const createdTransports: McpTransport[] = []

    setStdioClientDependenciesForTesting({
      createClient: () => {
        const clientIndex = createdClients.length
        const client = createClient({
          callTool: mock(async () => {
            if (clientIndex === 0) {
              throw new Error("Transport closed")
            }
            return { content: [{ type: "text", text: "recovered" }] }
          }),
        })
        createdClients.push(client)
        return client
      },
      createTransport: () => {
        const transport = createTransport()
        createdTransports.push(transport)
        return transport
      },
    })

    // when
    const result = await manager.callTool(createInfo(), createContext(), "diagnose", {})

    // then
    expect(result).toEqual([{ type: "text", text: "recovered" }])
    expect(createdClients).toHaveLength(2)
    expect(createdTransports).toHaveLength(2)
    expect(createdClients[0]?.close).toHaveBeenCalledTimes(1)
    expect(createdTransports[0]?.close).toHaveBeenCalledTimes(1)
  })
})

function createInfo(): SkillMcpClientInfo {
  return {
    serverName: "git-bash",
    skillName: "git-bash",
    sessionID: "session-transport-closed",
    scope: "builtin",
  }
}

function createContext(): SkillMcpServerContext {
  return {
    skillName: "git-bash",
    config: {
      command: "node",
      args: ["cli.js", "mcp"],
    },
  }
}

function createClient(overrides: Partial<McpClient>): McpClient {
  return {
    connect: mock(async () => {}),
    close: mock(async () => {}),
    listTools: mock(async () => ({ tools: [] })),
    listResources: mock(async () => ({ resources: [] })),
    listPrompts: mock(async () => ({ prompts: [] })),
    callTool: mock(async () => ({ content: [] })),
    readResource: mock(async () => ({ contents: [] })),
    getPrompt: mock(async () => ({ messages: [] })),
    ...overrides,
  } as McpClient
}

function createTransport(): McpTransport {
  return {
    close: mock(async () => {}),
  } as unknown as McpTransport
}
