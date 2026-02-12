import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import type { McbCallToolResult, McbToolName } from "./types"

export interface McbTestClient {
  client: Client
  transport: StdioClientTransport
  close: () => Promise<void>
}

export async function createMcbTestClient(
  timeoutMs = 10_000,
  configPath?: string,
  env?: Record<string, string>,
): Promise<McbTestClient> {
  const serveArgs = configPath ? ["serve", "--config", configPath] : ["serve"]
  const transport = new StdioClientTransport({
    command: "mcb",
    args: serveArgs,
    stderr: "pipe",
    ...(env ? { env: { ...env, PATH: process.env.PATH ?? "" } } : {}),
  })

  const client = new Client({ name: "mcb-e2e-test", version: "0.1.0" }, { capabilities: {} })

  await withTimeout(client.connect(transport), timeoutMs, "mcb_connect_timeout")

  return {
    client,
    transport,
    close: async () => {
      try {
        await withTimeout(client.close(), timeoutMs, "mcb_close_timeout")
      } catch {
        await transport.close().catch(() => undefined)
      }
    },
  }
}

export async function callMcbTool(
  client: Client,
  name: McbToolName,
  args: Record<string, unknown>,
  timeoutMs = 5_000,
): Promise<McbCallToolResult> {
  const result = await withTimeout(client.callTool({ name, arguments: args }), timeoutMs, `mcb_call_timeout:${name}`)
  const rawContent = Array.isArray(result.content) ? result.content : []
  return {
    content: rawContent.map((item) => ({
      type: typeof item === "object" && item !== null && "type" in item && typeof item.type === "string" ? item.type : "text",
      text:
        typeof item === "object" && item !== null && "text" in item && typeof item.text === "string" ? item.text : "",
    })),
    isError: result.isError === true,
  }
}

export function parseMcbToolResponse(result: McbCallToolResult): unknown {
  const textItem = result.content.find((item) => item.type === "text")
  const text = textItem?.text ?? ""
  if (!text) {
    return { text: "", isError: result.isError === true }
  }
  try {
    return JSON.parse(text)
  } catch {
    return { text, isError: result.isError === true }
  }
}

export function createDefaultArgs(toolName: McbToolName): Record<string, unknown> {
  if (toolName === "memory") {
    return {
      action: "list",
      resource: "observation",
      data: {},
      ids: [],
      project_id: "",
      repo_id: "",
      session_id: "",
      tags: [],
      query: "",
      anchor_id: "",
      depth_before: 0,
      depth_after: 0,
      window_secs: 0,
      observation_types: [],
      max_tokens: 0,
      limit: 10,
      org_id: null,
    }
  }

  if (toolName === "search") {
    return {
      query: "test",
      resource: "memory",
      collection: "default",
      extensions: [],
      filters: [],
      limit: 10,
      min_score: 0,
      tags: [],
      session_id: "",
      token: "",
      org_id: null,
    }
  }

  if (toolName === "index") {
    return {
      action: "status",
      path: ".",
      collection: "default",
      extensions: [],
      exclude_dirs: [],
      ignore_patterns: [],
      max_file_size: 1024 * 1024,
      follow_symlinks: false,
      token: "",
    }
  }

  if (toolName === "validate") {
    return {
      action: "list_rules",
      scope: "project",
      path: ".",
      rules: [],
      category: "",
    }
  }

  if (toolName === "vcs") {
    return {
      action: "list_repositories",
      repo_id: "",
      repo_path: "",
      base_branch: "",
      target_branch: "",
      query: "",
      branches: [],
      include_commits: false,
      depth: 0,
      limit: 10,
      org_id: null,
    }
  }

  if (toolName === "session") {
    return {
      action: "list",
      session_id: "",
      data: {},
      project_id: "",
      worktree_id: null,
      agent_type: "",
      status: "active",
      limit: 10,
      org_id: null,
    }
  }

  return {}
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, code: string): Promise<T> {
  let timeoutRef: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutRef = setTimeout(() => reject(new Error(code)), timeoutMs)
  })
  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeoutRef) {
      clearTimeout(timeoutRef)
    }
  }
}
