import type { ClaudeCodeMcpServer } from "@oh-my-opencode/claude-code-compat-core/claude-code-mcp-loader/types"
import { SkillMcpManager } from "@oh-my-opencode/mcp-client-core/skill-mcp-manager/manager"

const serverPath = new URL("./slow-server.ts", import.meta.url).pathname
const waitSeconds = 65

async function run(label: string, timeouts?: ClaudeCodeMcpServer["timeouts"]) {
  const manager = new SkillMcpManager()
  const config: ClaudeCodeMcpServer = { command: "bun", args: [serverPath], ...(timeouts ? { timeouts } : {}) }
  const info = { sessionID: `ses-${label}`, skillName: "qa-skill", serverName: "slow-server" }
  const context = { config, skillName: "qa-skill" }
  const startedAt = Date.now()
  try {
    const result = await manager.callTool(info, context, "wait", { seconds: waitSeconds })
    console.log(`[${label}] OK after ${((Date.now() - startedAt) / 1000).toFixed(1)}s ->`, JSON.stringify(result))
  } catch (error) {
    console.log(`[${label}] FAILED after ${((Date.now() - startedAt) / 1000).toFixed(1)}s ->`, String(error))
  } finally {
    await manager.disconnectAll()
  }
}

await run("no-timeout-config")
await run("requestTimeoutMs=120000", { requestTimeoutMs: 120_000 })
process.exit(0)
