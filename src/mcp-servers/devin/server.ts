import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import {
  cancelDevinSession,
  getDevinSession,
  listDevinSessions,
  snapshotDevinSession,
  shutdownAllSessions,
  startDevinSession,
} from "./session-store"
import type { DevinSessionSnapshot } from "./types"

const SERVER_NAME = "devin"
const SERVER_VERSION = "0.1.0"

function renderSnapshot(snap: DevinSessionSnapshot): string {
  const lines = [
    `session_id: ${snap.id}`,
    `status: ${snap.status}` + (snap.exitCode !== undefined ? ` (exit ${snap.exitCode})` : ""),
    `cwd: ${snap.cwd}`,
    snap.model ? `model: ${snap.model}` : null,
    snap.resumeId ? `resume_of: ${snap.resumeId}` : null,
    `started_at: ${new Date(snap.startedAt).toISOString()}`,
    snap.endedAt ? `ended_at: ${new Date(snap.endedAt).toISOString()}` : null,
    `duration_ms: ${snap.durationMs}`,
    `log_path: ${snap.logPath}`,
    `output_bytes: ${snap.outputBytes}`,
    "",
    "--- output (tail) ---",
    snap.output || "(no output yet)",
  ].filter((line): line is string => line !== null)
  return lines.join("\n")
}

function asTextResult(text: string) {
  return { content: [{ type: "text" as const, text }] }
}

export function createDevinMcpServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION })

  server.registerTool(
    "devin_start",
    {
      description:
        "Start a background Devin CLI session running `devin -p <prompt>`. Returns a session_id you can poll with devin_status. The session inherits the working directory unless `cwd` is given.",
      inputSchema: {
        prompt: z.string().min(1).describe("Prompt to send to Devin."),
        cwd: z.string().optional().describe("Working directory. Defaults to MCP server cwd."),
        model: z
          .string()
          .optional()
          .describe('Optional Devin model (e.g. "claude-sonnet-4", "opus", "codex").'),
        permission_mode: z.enum(["auto", "dangerous"]).optional().describe("Devin --permission-mode (default: auto)."),
        resume: z.string().optional().describe("Resume an existing Devin session by id (passes -r)."),
      },
    },
    async ({ prompt, cwd, model, permission_mode, resume }) => {
      const session = await startDevinSession({
        prompt,
        cwd,
        model,
        permissionMode: permission_mode,
        resume,
      })
      const snap = await snapshotDevinSession(session, 0)
      return asTextResult(
        `Started Devin session ${session.id}.\nPoll with devin_status({session_id: "${session.id}"}).\n\n` +
          renderSnapshot(snap),
      )
    },
  )

  server.registerTool(
    "devin_status",
    {
      description:
        "Get current status and recent stdout/stderr output of a background Devin session. Returns the tail of the log file plus runtime metadata.",
      inputSchema: {
        session_id: z.string().describe("Session id returned by devin_start."),
        tail_bytes: z
          .number()
          .int()
          .min(0)
          .max(262144)
          .optional()
          .describe("How many bytes of trailing output to return (default 8192, max 262144)."),
      },
    },
    async ({ session_id, tail_bytes }) => {
      const session = getDevinSession(session_id)
      if (!session) return asTextResult(`unknown session_id: ${session_id}`)
      const snap = await snapshotDevinSession(session, tail_bytes ?? 8192)
      return asTextResult(renderSnapshot(snap))
    },
  )

  server.registerTool(
    "devin_wait",
    {
      description:
        "Block until a background Devin session finishes (or timeout). Returns the final snapshot. Use this when you have nothing else to do.",
      inputSchema: {
        session_id: z.string().describe("Session id returned by devin_start."),
        timeout_ms: z
          .number()
          .int()
          .min(1000)
          .max(600000)
          .optional()
          .describe("Max time to wait in ms (default 60000, max 600000)."),
        tail_bytes: z.number().int().min(0).max(262144).optional(),
      },
    },
    async ({ session_id, timeout_ms, tail_bytes }) => {
      const session = getDevinSession(session_id)
      if (!session) return asTextResult(`unknown session_id: ${session_id}`)
      const limit = timeout_ms ?? 60000
      const timer = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), limit))
      const result = await Promise.race([session.proc.exited.then(() => "exited" as const), timer])
      const snap = await snapshotDevinSession(session, tail_bytes ?? 8192)
      const prefix = result === "timeout" ? `Wait timed out after ${limit}ms (session still running).\n\n` : ""
      return asTextResult(prefix + renderSnapshot(snap))
    },
  )

  server.registerTool(
    "devin_cancel",
    {
      description: "Cancel a running background Devin session by killing its process.",
      inputSchema: {
        session_id: z.string().describe("Session id returned by devin_start."),
      },
    },
    async ({ session_id }) => {
      const session = await cancelDevinSession(session_id)
      if (!session) return asTextResult(`unknown session_id: ${session_id}`)
      const snap = await snapshotDevinSession(session, 0)
      return asTextResult(`Cancelled.\n\n` + renderSnapshot(snap))
    },
  )

  server.registerTool(
    "devin_list",
    {
      description: "List all background Devin sessions managed by this MCP server in the current process.",
      inputSchema: {
        include_output: z
          .boolean()
          .optional()
          .describe("If true, include the last 256 bytes of each session's output."),
      },
    },
    async ({ include_output }) => {
      const sessions = listDevinSessions()
      if (sessions.length === 0) return asTextResult("(no sessions)")
      const parts = await Promise.all(
        sessions.map(async (session) => {
          const snap = await snapshotDevinSession(session, include_output ? 256 : 0)
          const head =
            `- ${snap.id}  [${snap.status}]  duration=${snap.durationMs}ms  prompt=${JSON.stringify(snap.prompt.slice(0, 80))}`
          return include_output ? `${head}\n  tail: ${snap.output.replace(/\n/g, " ").slice(0, 256)}` : head
        }),
      )
      return asTextResult(parts.join("\n"))
    },
  )

  return server
}

export async function runDevinMcpServer(): Promise<void> {
  const server = createDevinMcpServer()
  const transport = new StdioServerTransport()
  const cleanup = () => {
    void shutdownAllSessions().finally(() => process.exit(0))
  }
  process.on("SIGINT", cleanup)
  process.on("SIGTERM", cleanup)
  await server.connect(transport)
}
