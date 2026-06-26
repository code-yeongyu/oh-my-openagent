import type { Readable, Writable } from "node:stream"

import {
  errorResponse,
  isPlainRecord,
  jsonRpcId,
  readStdioJsonRpcMessages,
  writeStdioJsonRpcResponse,
} from "@oh-my-opencode/mcp-stdio-core"

import { spawnCodegraphServer } from "./process.js"
import type {
  CodegraphCommandSpec,
  CodegraphProjectSynchronizer,
  CodegraphServerSpawner,
} from "./types.js"

export interface RunCodegraphMcpProxyOptions {
  readonly autoInit: boolean
  readonly command: CodegraphCommandSpec
  readonly cwd: string
  readonly env: Record<string, string | undefined>
  readonly input?: Readable
  readonly output?: Writable
  readonly stderr?: { readonly write: (chunk: string) => unknown }
  readonly spawnServer?: CodegraphServerSpawner
  readonly synchronizer: CodegraphProjectSynchronizer
}

export async function runCodegraphMcpProxy(options: RunCodegraphMcpProxyOptions): Promise<number> {
  const input = options.input ?? process.stdin
  const output = options.output ?? process.stdout
  const stderr = options.stderr ?? process.stderr
  await options.synchronizer.initialize(options.cwd, options.autoInit)

  const server = (options.spawnServer ?? spawnCodegraphServer)(options.cwd, options.command, options.env)
  server.output.pipe(output, { end: false })
  const forwardError = (chunk: Buffer | string): void => {
    stderr.write(String(chunk))
  }
  server.error.on("data", forwardError)
  try {
    for await (const message of readStdioJsonRpcMessages(input)) {
      if (message.kind === "parse_error") {
        writeStdioJsonRpcResponse(output, errorResponse(null, -32700, "Parse error", message.message), message.responseMode)
        continue
      }
      const projectPath = projectPathFromToolCall(message.payload)
      if (projectPath !== null) {
        try {
          await options.synchronizer.refresh(projectPath, options.autoInit)
        } catch (error) {
          const parsed = isPlainRecord(message.payload) ? message.payload : {}
          writeStdioJsonRpcResponse(
            output,
            errorResponse(jsonRpcId(parsed["id"]), -32001, error instanceof Error ? error.message : String(error)),
            message.responseMode,
          )
          continue
        }
      }
      writeStdioJsonRpcResponse(server.input, message.payload, message.responseMode)
    }
    server.input.end()
    return await server.wait()
  } catch (error) {
    server.terminate()
    throw error
  } finally {
    server.output.unpipe(output)
    server.error.off("data", forwardError)
  }
}

function projectPathFromToolCall(input: unknown): string | null {
  if (!isPlainRecord(input) || input["method"] !== "tools/call") return null
  const params = input["params"]
  if (!isPlainRecord(params)) return null
  const args = params["arguments"]
  if (!isPlainRecord(args)) return null
  const projectPath = args["projectPath"]
  return typeof projectPath === "string" && projectPath.trim().length > 0 ? projectPath : null
}
