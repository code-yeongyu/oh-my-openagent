import type { HostKind, HostToolContent, HostToolDefinition, HostToolResult, JsonObject } from "../host-contract"
import { createAstGrepMcpConfig } from "../mcp/ast-grep"
import type { LocalMcpConfig } from "../mcp/lsp"
import { createLspMcpConfig } from "../mcp/lsp"
import { spawn } from "../shared/bun-spawn-shim"
import { registerTargetTool, type TargetToolDefinition, type TargetToolRegistry } from "./tool-registration"

type McpServerName = "lsp" | "ast_grep"

type McpToolDescriptor = {
  publicName: string
  serverName: McpServerName
  mcpToolName: string
  label: string
  description: string
  inputSchema: JsonObject
}

type McpTextContent = {
  type: "text"
  text: string
}

type McpImageContent = {
  type: "image"
  mimeType?: string
  data?: string
}

type McpResourceContent = {
  type: "resource"
  resource: {
    uri: string
    mimeType?: string
    text?: string
    blob?: string
  }
}

type McpContent = McpTextContent | McpImageContent | McpResourceContent

type McpCallResult = {
  content: readonly McpContent[]
  isError?: boolean
}

export type McpToolBackend = {
  callTool(
    serverName: McpServerName,
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<McpCallResult>
}

export type McpBackedToolsOptions = {
  host: Exclude<HostKind, "opencode">
  registry: TargetToolRegistry
  cwd: string
  backend?: McpToolBackend
}

export const MCP_BACKED_TOOL_NAMES = [
  "lsp_goto_definition",
  "lsp_find_references",
  "lsp_symbols",
  "lsp_diagnostics",
  "lsp_prepare_rename",
  "lsp_rename",
  "ast_grep_search",
  "ast_grep_replace",
] as const

export type McpBackedToolName = (typeof MCP_BACKED_TOOL_NAMES)[number]

const stringSchema = (description: string): JsonObject => ({ type: "string", description })
const numberSchema = (description: string): JsonObject => ({ type: "number", description })
const booleanSchema = (description: string): JsonObject => ({ type: "boolean", description })

function objectSchema(properties: Record<string, JsonObject>, required: readonly string[] = []): JsonObject {
  return {
    type: "object",
    properties,
    required: [...required],
    additionalProperties: false,
  }
}

const LSP_POSITION_PROPERTIES = {
  filePath: stringSchema("Source file path."),
  line: numberSchema("1-based line number."),
  character: numberSchema("0-based column."),
} satisfies Record<string, JsonObject>

const MCP_TOOL_DESCRIPTORS: readonly McpToolDescriptor[] = [
  {
    publicName: "lsp_goto_definition",
    serverName: "lsp",
    mcpToolName: "goto_definition",
    label: "LSP Goto Definition",
    description: "Find where a symbol is defined.",
    inputSchema: objectSchema(LSP_POSITION_PROPERTIES, ["filePath", "line", "character"]),
  },
  {
    publicName: "lsp_find_references",
    serverName: "lsp",
    mcpToolName: "find_references",
    label: "LSP Find References",
    description: "Find references of a symbol across the workspace.",
    inputSchema: objectSchema(
      {
        ...LSP_POSITION_PROPERTIES,
        includeDeclaration: booleanSchema("Include the declaration. Defaults to true."),
      },
      ["filePath", "line", "character"],
    ),
  },
  {
    publicName: "lsp_symbols",
    serverName: "lsp",
    mcpToolName: "symbols",
    label: "LSP Symbols",
    description: "List document symbols or search workspace symbols.",
    inputSchema: objectSchema(
      {
        filePath: stringSchema("File path used as LSP context."),
        scope: {
          type: "string",
          enum: ["document", "workspace"],
          description: "Use document for file outline or workspace for project-wide search.",
        },
        query: stringSchema("Workspace symbol query."),
        limit: numberSchema("Maximum number of symbols to return."),
      },
      ["filePath", "scope"],
    ),
  },
  {
    publicName: "lsp_diagnostics",
    serverName: "lsp",
    mcpToolName: "diagnostics",
    label: "LSP Diagnostics",
    description: "Get errors, warnings, and hints for a source file or directory.",
    inputSchema: objectSchema(
      {
        filePath: stringSchema("File or directory path to check."),
        severity: {
          type: "string",
          enum: ["error", "warning", "information", "hint", "all"],
          description: "Severity filter. Defaults to all.",
        },
      },
      ["filePath"],
    ),
  },
  {
    publicName: "lsp_prepare_rename",
    serverName: "lsp",
    mcpToolName: "prepare_rename",
    label: "LSP Prepare Rename",
    description: "Check whether a symbol can be renamed at a position.",
    inputSchema: objectSchema(LSP_POSITION_PROPERTIES, ["filePath", "line", "character"]),
  },
  {
    publicName: "lsp_rename",
    serverName: "lsp",
    mcpToolName: "rename",
    label: "LSP Rename",
    description: "Rename a symbol across the workspace and apply the returned workspace edit.",
    inputSchema: objectSchema(
      {
        ...LSP_POSITION_PROPERTIES,
        newName: stringSchema("New symbol name."),
      },
      ["filePath", "line", "character", "newName"],
    ),
  },
  {
    publicName: "ast_grep_search",
    serverName: "ast_grep",
    mcpToolName: "search",
    label: "AST grep search",
    description: "Search source files with an ast-grep structural pattern.",
    inputSchema: objectSchema(
      {
        pattern: stringSchema("AST pattern to match."),
        lang: stringSchema("Target language."),
        paths: { type: "array", items: { type: "string" }, description: "Paths to search." },
        globs: { type: "array", items: { type: "string" }, description: "Include or exclude globs." },
        context: numberSchema("Context lines around each match."),
      },
      ["pattern", "lang"],
    ),
  },
  {
    publicName: "ast_grep_replace",
    serverName: "ast_grep",
    mcpToolName: "replace",
    label: "AST grep replace",
    description: "Preview or apply a structural ast-grep replacement.",
    inputSchema: objectSchema(
      {
        pattern: stringSchema("AST pattern to match."),
        rewrite: stringSchema("Replacement pattern."),
        lang: stringSchema("Target language."),
        paths: { type: "array", items: { type: "string" }, description: "Paths to search." },
        globs: { type: "array", items: { type: "string" }, description: "Include or exclude globs." },
        dryRun: booleanSchema("Preview changes without applying. Defaults to true."),
      },
      ["pattern", "rewrite", "lang"],
    ),
  },
]

function isMcpServerName(value: string): value is McpServerName {
  return value === "lsp" || value === "ast_grep"
}

function localMcpConfigForServer(serverName: McpServerName, cwd: string): LocalMcpConfig {
  if (serverName === "lsp") return createLspMcpConfig()
  return createAstGrepMcpConfig({ cwd })
}

function mcpContentToHostContent(content: McpContent): HostToolContent {
  if (content.type === "text") return { type: "text", text: content.text }
  if (content.type === "image") return { type: "image", mediaType: content.mimeType, data: content.data }

  const text = content.resource.text ?? content.resource.blob ?? ""
  return { type: "text", text: `[Resource: ${content.resource.uri}]\n${text}` }
}

function createHostToolResult(result: McpCallResult): HostToolResult {
  return {
    content: result.content.map(mcpContentToHostContent),
    isError: result.isError,
  }
}

function createMcpRequest(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: toolName,
      arguments: args,
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseMcpCallResult(responseText: string, serverName: McpServerName, toolName: string): McpCallResult {
  const line = responseText.split("\n").find((candidate) => candidate.trim().length > 0)
  if (!line) {
    throw new Error(`${serverName} MCP returned no response for ${toolName}`)
  }

  const parsed: unknown = JSON.parse(line)
  if (!isRecord(parsed)) {
    throw new Error(`${serverName} MCP returned a non-object response for ${toolName}`)
  }

  const error = parsed.error
  if (isRecord(error) && typeof error.message === "string") {
    throw new Error(error.message)
  }

  const result = parsed.result
  if (!isRecord(result) || !Array.isArray(result.content)) {
    throw new Error(`${serverName} MCP returned an invalid result for ${toolName}`)
  }

  return {
    content: result.content.filter(isMcpContent),
    isError: result.isError === true,
  }
}

function isMcpContent(value: unknown): value is McpContent {
  if (!isRecord(value) || typeof value.type !== "string") return false
  if (value.type === "text") return typeof value.text === "string"
  if (value.type === "image") return true
  if (value.type !== "resource") return false
  return isRecord(value.resource) && typeof value.resource.uri === "string"
}

async function callLocalMcpTool(
  config: LocalMcpConfig,
  serverName: McpServerName,
  toolName: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<McpCallResult> {
  if (!config.enabled) {
    throw new Error(`${serverName} MCP is not available`)
  }

  const [command, ...commandArgs] = config.command
  if (!command) {
    throw new Error(`${serverName} MCP command is empty`)
  }

  const proc = spawn({
    cmd: [command, ...commandArgs],
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...config.environment,
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })

  const abort = () => {
    proc.kill()
  }
  signal?.addEventListener("abort", abort, { once: true })

  try {
    proc.stdin.write(`${JSON.stringify(createMcpRequest(toolName, args))}\n`)
    proc.stdin.end()
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    if (exitCode !== 0) {
      const message = stderr.trim() || `${serverName} MCP exited with code ${exitCode}`
      throw new Error(message)
    }

    return parseMcpCallResult(stdout, serverName, toolName)
  } finally {
    signal?.removeEventListener("abort", abort)
  }
}

function createDefaultMcpBackend(cwd: string): McpToolBackend {
  return {
    callTool: (serverName, toolName, args, signal) => {
      const config = localMcpConfigForServer(serverName, cwd)
      return callLocalMcpTool(config, serverName, toolName, args, signal)
    },
  }
}

function createMcpHostTool(descriptor: McpToolDescriptor, backend: McpToolBackend): HostToolDefinition<JsonObject> {
  return {
    name: descriptor.publicName,
    label: descriptor.label,
    description: descriptor.description,
    parameters: descriptor.inputSchema,
    mcpServerName: descriptor.serverName,
    mcpToolName: descriptor.mcpToolName,
    execute: async (request) => {
      if (!isMcpServerName(descriptor.serverName)) {
        throw new Error(`Unsupported MCP server: ${descriptor.serverName}`)
      }

      const result = await backend.callTool(descriptor.serverName, descriptor.mcpToolName, request.input, request.signal)
      return createHostToolResult(result)
    },
  }
}

export function registerMcpBackedTools(options: McpBackedToolsOptions): readonly TargetToolDefinition[] {
  const registered: TargetToolDefinition[] = []
  const backend = options.backend ?? createDefaultMcpBackend(options.cwd)

  for (const descriptor of MCP_TOOL_DESCRIPTORS) {
    const hostTool = createMcpHostTool(descriptor, backend)
    registered.push(
      registerTargetTool(options.registry, hostTool, {
        host: options.host,
        parameters: { kind: "json-schema", schema: descriptor.inputSchema },
        createSessionContext: () => ({
          id: "target-session",
          cwd: options.cwd,
          actions: {
            sendUserMessage: async () => {},
            sendInternalMessage: async () => {},
            appendEntry: async () => {},
            getSessionName: () => undefined,
            setSessionName: async () => {},
            getContextUsage: () => undefined,
            compact: async () => {},
            abort: () => {},
            isIdle: () => true,
            hasPendingMessages: () => false,
          },
        }),
      }),
    )
  }

  return registered
}
