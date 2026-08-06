import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import type { AgentControlRuntime } from "./types"

const McpToolResponseSchema = z.object({
  id: z.number(),
  result: z.object({
    content: z.array(z.object({ type: z.literal("text"), text: z.string() })),
  }).optional(),
  error: z.object({ message: z.string() }).optional(),
})

export function buildAgentControlMcpEnvironment(
  owner: string,
  inherited: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const sessionID = owner.startsWith("owner:") ? owner.slice("owner:".length) : owner
  return {
    ...inherited,
    AGENT_CONTROL_OWNER: owner,
    AGENT_CONTROL_SESSION_ID: sessionID,
  }
}

export class AgentControlRuntimeNotFoundError extends Error {
  readonly start: string

  constructor(start: string) {
    super(`AgentControl Python runtime was not found above ${start}`)
    this.name = "AgentControlRuntimeNotFoundError"
    this.start = start
  }
}

export function resolveAgentControlRuntimeRoot(start = dirname(fileURLToPath(import.meta.url))): string {
  let current = resolve(start)
  while (true) {
    if (existsSync(join(current, "tools", "agent_control", "mcp_server.py"))) return current
    const parent = dirname(current)
    if (parent === current) throw new AgentControlRuntimeNotFoundError(start)
    current = parent
  }
}

export const runAgentControlMcp: AgentControlRuntime = async (request) => {
  const runtimeRoot = resolveAgentControlRuntimeRoot()
  const env: NodeJS.ProcessEnv = {
    ...buildAgentControlMcpEnvironment(request.owner),
    PYTHONPATH: runtimeRoot,
  }
  const child = spawn(
    process.env.AGENT_CONTROL_PYTHON ?? "python",
    ["-m", "tools.agent_control.mcp_server", "--project", request.project],
    { cwd: request.project, env, stdio: ["pipe", "pipe", "pipe"] },
  )
  const abort = (): void => {
    child.kill("SIGTERM")
  }
  request.abort?.addEventListener("abort", abort, { once: true })
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk))
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk))
  child.stdin.end([
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: request.action, arguments: request.arguments },
    }),
    "",
  ].join("\n"))
  const exitCode = await new Promise<number | null>((resolveExit, reject) => {
    child.once("error", reject)
    child.once("close", resolveExit)
  })
  request.abort?.removeEventListener("abort", abort)
  const stderrText = Buffer.concat(stderr).toString("utf8").trim()
  if (exitCode !== 0) throw new Error(stderrText || `AgentControl MCP exited with ${exitCode}`)
  const responseLine = Buffer.concat(stdout)
    .toString("utf8")
    .split("\n")
    .find((line) => line.includes('"id":2'))
  const response = McpToolResponseSchema.parse(JSON.parse(responseLine ?? "{}"))
  if (response.error) throw new Error(response.error.message)
  return response.result?.content[0]?.text ?? "{}"
}
