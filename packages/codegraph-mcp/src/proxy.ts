import { PassThrough, type Readable, type Writable } from "node:stream"

import {
  errorResponse,
  isPlainRecord,
  jsonRpcId,
  messageFromError,
  readStdioJsonRpcMessages,
  writeStdioJsonRpcResponse,
  type StdioJsonRpcResponseMode,
} from "@oh-my-opencode/mcp-stdio-core"

import { spawnCodegraphServer } from "./process.js"
import type {
  CodegraphCommandSpec,
  CodegraphProjectSynchronizer,
  CodegraphServerSpawner,
} from "./types.js"

type ProxyBridgeState = {
  readonly clientOutput: Writable
  readonly responseModes: Map<string, StdioJsonRpcResponseMode>
  defaultResponseMode: StdioJsonRpcResponseMode
}

type ClientForwardOptions = {
  readonly autoInit: boolean
  readonly childInput: Writable
  readonly input: Readable
  readonly synchronizer: CodegraphProjectSynchronizer
}

type ClientInputRelay = {
  readonly input: Readable
  readonly stop: () => void
}

const INCOMPLETE_REFRESH_MESSAGE = "CodeGraph project refresh did not complete"

class CodegraphProxyWriteError extends Error {
  override readonly name = "CodegraphProxyWriteError"

  constructor(readonly streamName: string) {
    super(`CodeGraph MCP proxy failed to write to ${streamName}`)
  }
}

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
  const forwardError = (chunk: Buffer | string): void => {
    stderr.write(String(chunk))
  }
  server.error.on("data", forwardError)
  const serverExit = server.wait()
  const bridgeState: ProxyBridgeState = {
    clientOutput: output,
    defaultResponseMode: "line",
    responseModes: new Map<string, StdioJsonRpcResponseMode>(),
  }
  const clientInputRelay = createClientInputRelay(input)
  const bridgeDone = Promise.all([
    forwardClientToCodegraph(
      {
        autoInit: options.autoInit,
        childInput: server.input,
        input: clientInputRelay.input,
        synchronizer: options.synchronizer,
      },
      bridgeState,
    ),
    forwardCodegraphToClient(server.output, bridgeState),
  ])
  void bridgeDone.catch(() => undefined)
  void serverExit.then(clientInputRelay.stop, clientInputRelay.stop)
  try {
    return await Promise.race([serverExit, bridgeDone.then(async () => await serverExit)])
  } catch (error) {
    server.terminate()
    throw error
  } finally {
    clientInputRelay.stop()
    server.error.off("data", forwardError)
  }
}

function createClientInputRelay(input: Readable): ClientInputRelay {
  const relayedInput = new PassThrough()
  let stopped = false
  const removeListeners = (): void => {
    input.off("data", onData)
    input.off("end", onEnd)
    input.off("error", onError)
  }
  const onData = (chunk: Buffer | string): void => {
    relayedInput.write(chunk)
  }
  const onEnd = (): void => {
    removeListeners()
    relayedInput.end()
  }
  const onError = (error: Error): void => {
    removeListeners()
    relayedInput.destroy(error)
  }
  const stop = (): void => {
    if (stopped) return
    stopped = true
    removeListeners()
    relayedInput.destroy()
  }
  input.on("data", onData)
  input.once("end", onEnd)
  input.once("error", onError)
  return { input: relayedInput, stop }
}

async function forwardClientToCodegraph(options: ClientForwardOptions, state: ProxyBridgeState): Promise<void> {
  for await (const message of readStdioJsonRpcMessages(options.input)) {
    state.defaultResponseMode = message.responseMode
    if (message.kind === "parse_error") {
      writeStdioJsonRpcResponse(
        state.clientOutput,
        errorResponse(null, -32700, "Parse error", message.message),
        message.responseMode,
      )
      continue
    }
    const key = responseModeKey(message.payload)
    if (key !== null) state.responseModes.set(key, message.responseMode)
    const projectPath = projectPathFromToolCall(message.payload)
    if (projectPath !== null) {
      try {
        const refreshed = await options.synchronizer.refresh(projectPath, false)
        if (!refreshed) {
          const parsed = isPlainRecord(message.payload) ? message.payload : {}
          writeStdioJsonRpcResponse(
            state.clientOutput,
            errorResponse(jsonRpcId(parsed["id"]), -32001, INCOMPLETE_REFRESH_MESSAGE),
            message.responseMode,
          )
          if (key !== null) state.responseModes.delete(key)
          continue
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : messageFromError(error)
        const parsed = isPlainRecord(message.payload) ? message.payload : {}
        writeStdioJsonRpcResponse(
          state.clientOutput,
          errorResponse(jsonRpcId(parsed["id"]), -32001, errorMessage),
          message.responseMode,
        )
        if (key !== null) state.responseModes.delete(key)
        continue
      }
    }
    await writeLine(options.childInput, JSON.stringify(message.payload))
  }
  options.childInput.end()
}

async function forwardCodegraphToClient(childOutput: Readable, state: ProxyBridgeState): Promise<void> {
  for await (const message of readStdioJsonRpcMessages(childOutput)) {
    if (message.kind === "parse_error") {
      writeStdioJsonRpcResponse(
        state.clientOutput,
        errorResponse(null, -32700, "Parse error", message.message),
        state.defaultResponseMode,
      )
      continue
    }
    const key = responseModeKey(message.payload)
    const responseMode = key === null ? state.defaultResponseMode : (state.responseModes.get(key) ?? state.defaultResponseMode)
    if (key !== null) state.responseModes.delete(key)
    writeStdioJsonRpcResponse(state.clientOutput, message.payload, responseMode)
  }
}

function responseModeKey(payload: unknown): string | null {
  if (!isPlainRecord(payload) || !("id" in payload)) return null
  const id = jsonRpcId(payload["id"])
  return `${typeof id}:${String(id)}`
}

async function writeLine(output: Writable, line: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      output.off("close", onClose)
      output.off("drain", onDrain)
      output.off("error", onError)
    }
    const onClose = (): void => {
      cleanup()
      reject(new CodegraphProxyWriteError("CodeGraph stdin"))
    }
    const onDrain = (): void => {
      cleanup()
      resolve()
    }
    const onError = (error: Error): void => {
      cleanup()
      reject(error)
    }
    output.once("close", onClose)
    output.once("error", onError)
    try {
      if (output.write(`${line}\n`)) {
        cleanup()
        resolve()
      } else {
        output.once("drain", onDrain)
      }
    } catch (error) {
      cleanup()
      reject(error instanceof Error ? error : new Error(messageFromError(error)))
    }
  })
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
