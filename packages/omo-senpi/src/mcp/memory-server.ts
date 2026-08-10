#!/usr/bin/env node
// Standalone stdio MCP server exposing the omo memory tools. The senpi extension registers this server
// with exposure "search" so the tools surface through senpi's tool_search catalog instead of occupying
// the always-on tool set. It runs under plain Node with no senpi runtime: identity derives from the
// child process cwd (the session project directory) via memory-core's auto rule.

import { resolve } from "node:path"
import type { Readable, Writable } from "node:stream"
import { pathToFileURL } from "node:url"

import {
  errorResponse,
  isPlainRecord,
  jsonRpcId,
  runJsonRpcStdioServer,
  successResponse,
  type JsonRpcResponse,
} from "@oh-my-opencode/mcp-stdio-core"
import {
  MemoryApplyPatchError,
  MemoryPatchHunkError,
  MemoryPatchParseError,
  MemoryToolError,
  resolveMemoryIdentity,
  runMemoryApplyPatch,
  runMemoryTool,
  type MemoryToolParams,
} from "@oh-my-opencode/memory-core"

import { prepareMemoryEngineSession } from "../components/memory/engine-session"
import {
  MEMORY_APPLY_PATCH_DESCRIPTION,
  MEMORY_APPLY_PATCH_TOOL_NAME,
  MEMORY_TOOL_DESCRIPTION,
  MEMORY_TOOL_NAME,
} from "../components/memory/tool-metadata"

const SERVER_NAME = "omo-memory"
const SERVER_VERSION = "0.1.0"

const MEMORY_INPUT_SCHEMA = {
  type: "object",
  properties: {
    command: {
      type: "string",
      enum: ["create", "str_replace", "insert", "delete", "rename", "update_description"],
      description: "The memory operation to perform.",
    },
    reason: { type: "string", description: "Git commit message recorded for this memory change." },
    file_path: { type: "string", description: "Target memory file: relative to the memory repo, or absolute inside it. Required by create, str_replace, insert, delete, and update_description." },
    old_path: { type: "string", description: "Current path of the memory file. Required by rename." },
    new_path: { type: "string", description: "Destination path of the memory file. Required by rename." },
    old_string: { type: "string", description: "Exact text to replace. Required by str_replace." },
    new_string: { type: "string", description: "Replacement text. Required by str_replace." },
    insert_line: { type: "number", description: "1-based line number at which to insert text. Required by insert." },
    insert_text: { type: "string", description: "Text to insert. Required by insert." },
    description: { type: "string", description: "Frontmatter description of the memory block. Required by create and update_description." },
    file_text: { type: "string", description: "Initial body text for create." },
  },
  required: ["command", "reason"],
  additionalProperties: false,
} as const

const APPLY_PATCH_INPUT_SCHEMA = {
  type: "object",
  properties: {
    reason: { type: "string", description: "Git commit message recorded for this memory change." },
    input: { type: "string", description: "Patch text in the standard apply_patch format (*** Begin Patch ... *** End Patch)." },
  },
  required: ["reason", "input"],
  additionalProperties: false,
} as const

const TOOLS = [
  { name: MEMORY_TOOL_NAME, description: MEMORY_TOOL_DESCRIPTION, inputSchema: MEMORY_INPUT_SCHEMA },
  { name: MEMORY_APPLY_PATCH_TOOL_NAME, description: MEMORY_APPLY_PATCH_DESCRIPTION, inputSchema: APPLY_PATCH_INPUT_SCHEMA },
]

export async function handleMemoryMcpRequest(
  input: unknown,
  options: { cwd?: string; env?: Record<string, string | undefined> } = {},
): Promise<JsonRpcResponse | undefined> {
  if (!isPlainRecord(input)) return errorResponse(null, -32600, "Invalid Request")
  const id = jsonRpcId(input["id"])
  const method = typeof input["method"] === "string" ? input["method"] : null

  if (method === "initialize") {
    return successResponse(id, {
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      protocolVersion: readProtocolVersion(input) ?? "2024-11-05",
    })
  }
  if (method === "tools/list") return successResponse(id, { tools: TOOLS })
  if (method === "notifications/initialized") return undefined

  if (method === "tools/call") {
    const params = isPlainRecord(input["params"]) ? input["params"] : {}
    const name = typeof params["name"] === "string" ? params["name"] : ""
    const args = isPlainRecord(params["arguments"]) ? params["arguments"] : {}
    return callMemoryTool(id, name, args, options)
  }

  return errorResponse(id, -32601, "Method not found")
}

async function callMemoryTool(
  id: string | number | null,
  name: string,
  args: Record<string, unknown>,
  options: { cwd?: string; env?: Record<string, string | undefined> },
): Promise<JsonRpcResponse> {
  if (name !== MEMORY_TOOL_NAME && name !== MEMORY_APPLY_PATCH_TOOL_NAME) {
    return toolText(id, `Unknown ${SERVER_NAME} tool: ${name}`, true)
  }
  try {
    const cwd = options.cwd ?? process.cwd()
    const identity = resolveMemoryIdentity(undefined, cwd, options.env ?? process.env)
    const session = await prepareMemoryEngineSession(identity.id, identity.paths)
    if (name === MEMORY_TOOL_NAME) {
      // Field-level validation lives in runMemoryTool's required() guards, so the MCP argument record
      // is asserted straight into the core param shape rather than re-validated here.
      const params = { ...args, author: session.author } as MemoryToolParams
      const result = await runMemoryTool({ repo: session.repo, lock: session.lock, params })
      return toolText(id, result.message)
    }
    const result = await runMemoryApplyPatch({
      repo: session.repo,
      lock: session.lock,
      params: {
        reason: typeof args.reason === "string" ? args.reason : "",
        input: typeof args.input === "string" ? args.input : "",
        author: session.author,
      },
    })
    return toolText(id, result.message)
  } catch (error) {
    if (
      error instanceof MemoryToolError
      || error instanceof MemoryApplyPatchError
      || error instanceof MemoryPatchParseError
      || error instanceof MemoryPatchHunkError
    ) {
      return toolText(id, error.message, true)
    }
    throw error
  }
}

function toolText(id: string | number | null, text: string, isError = false): JsonRpcResponse {
  return successResponse(id, { content: [{ type: "text", text }], isError })
}

function readProtocolVersion(input: Record<string, unknown>): string | null {
  const params = input["params"]
  if (!isPlainRecord(params)) return null
  const version = params["protocolVersion"]
  return typeof version === "string" ? version : null
}

export async function runMemoryMcpStdioServer(input: Readable, output: Writable): Promise<void> {
  await runJsonRpcStdioServer({
    input,
    output,
    handler: handleMemoryMcpRequest,
    handlerOptions: {},
    parentWatchdog: {},
    parseErrorResponse: () => errorResponse(null, -32601, "Method not found"),
  })
}

const invokedPath = process.argv[1] === undefined ? "" : pathToFileURL(resolve(process.argv[1])).href
if (invokedPath !== "" && import.meta.url === invokedPath) {
  await runMemoryMcpStdioServer(process.stdin, process.stdout)
}
