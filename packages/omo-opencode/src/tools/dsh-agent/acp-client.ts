import { spawn } from "node:child_process"

export type DshAcpRunInput = {
  readonly command: string
  readonly args: string[]
  readonly cwd: string
  readonly prompt: string
  readonly permission: "reject" | "allow_once"
  readonly timeoutMs: number
  readonly abort: AbortSignal
  readonly env?: Record<string, string | undefined>
}

export type DshAcpRunResult = {
  readonly output: string
  readonly stopReason: string
}

interface JsonRpcRequest {
  jsonrpc: "2.0"
  id: number
  method: string
  params?: unknown
}

interface JsonRpcResponse {
  jsonrpc: "2.0"
  id: number
  result?: unknown
  error?: { code: number; message: string }
}

interface JsonRpcNotification {
  jsonrpc: "2.0"
  method: string
  params?: unknown
}

type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification

function isResponse(message: JsonRpcMessage): message is JsonRpcResponse {
  return "id" in message && ("result" in message || "error" in message)
}

function isRequest(message: JsonRpcMessage): message is JsonRpcRequest {
  return "id" in message && "method" in message && !("result" in message) && !("error" in message)
}

/**
 * Drive one DeepSeek Harness agent over the Agent Client Protocol (ACP):
 * spawn a fresh dsh ACP child, initialize, create a session, send the prompt,
 * collect committed assistant text chunks, and settle on the ACP stop reason.
 */
export async function runDshAcpAgent(input: DshAcpRunInput): Promise<DshAcpRunResult> {
  const child = spawn(input.command, input.args, {
    cwd: input.cwd,
    env: {
      ...process.env,
      ...Object.fromEntries(Object.entries(input.env ?? {}).filter(([, value]) => value !== undefined)),
    } as NodeJS.ProcessEnv,
    stdio: ["pipe", "pipe", "inherit"],
    windowsHide: process.platform === "win32",
  })

  return new Promise<DshAcpRunResult>((resolve, reject) => {
    let settled = false
    let nextId = 0
    let buffer = ""
    let chunks = ""
    let stopReason = "end_turn"
    let childError: Error | undefined

    const pending = new Map<number, (message: JsonRpcResponse) => void>()
    let promptResponseResolver: ((message: JsonRpcResponse) => void) | undefined

    const finish = (result: DshAcpRunResult) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    const fail = (error: Error) => {
      if (settled) return
      settled = true
      reject(error)
    }

    const disposeChild = () => {
      try {
        child.stdin?.end()
      } catch {
        // stdin may already be closed
      }
      if (!child.killed) {
        try {
          child.kill("SIGTERM")
        } catch {
          // reaping races are tolerated
        }
      }
    }

    const timeout = setTimeout(() => {
      disposeChild()
      fail(new Error(`dsh ACP run exceeded ${input.timeoutMs}ms`))
    }, input.timeoutMs)

    const onAbort = () => {
      disposeChild()
      fail(new Error("dsh ACP run aborted"))
    }
    if (input.abort.aborted) {
      onAbort()
      return
    }
    input.abort.addEventListener("abort", onAbort, { once: true })

    const send = (message: JsonRpcMessage) => {
      child.stdin?.write(`${JSON.stringify(message)}\n`)
    }

    const call = (method: string, params: unknown): Promise<unknown> => {
      const id = ++nextId
      return new Promise((resolveCall, rejectCall) => {
        pending.set(id, (message) => {
          if (message.error) {
            rejectCall(new Error(message.error.message))
            return
          }
          resolveCall(message.result)
        })
        send({ jsonrpc: "2.0", id, method, params } satisfies JsonRpcRequest)
      })
    }

    const answerPermission = (requestId: number, params: unknown) => {
      const outcome =
        input.permission === "reject"
          ? { outcome: "rejected" }
          : { outcome: "selected", optionId: pickAllowOnceOption(params) }
      child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id: requestId, result: { outcome } })}\n`)
    }

    const handleLine = (line: string) => {
      if (!line.trim()) return
      let message: JsonRpcMessage
      try {
        message = JSON.parse(line) as JsonRpcMessage
      } catch {
        return // tolerate non-JSON noise on the wire
      }

      if (isRequest(message)) {
        if (message.method === "session/request_permission") {
          answerPermission(message.id, message.params)
        }
        return
      }

      if (isResponse(message)) {
        if (message.id === 0) {
          // session/prompt settles on the dedicated id-0 response slot
          promptResponseResolver?.(message)
          promptResponseResolver = undefined
          return
        }
        const resolver = pending.get(message.id)
        if (resolver) {
          pending.delete(message.id)
          resolver(message)
        }
        return
      }

      // notification
      if (message.method === "session/update") {
        const params = message.params as
          | { update?: { sessionUpdate?: string; content?: { type?: string; text?: string } } }
          | undefined
        const update = params?.update
        if (update?.sessionUpdate === "agent_message_chunk" && update.content?.type === "text") {
          chunks += update.content.text ?? ""
        }
      }
    }

    child.stdout?.on("data", (data: Buffer) => {
      buffer += data.toString("utf8")
      let newlineIndex = buffer.indexOf("\n")
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex)
        buffer = buffer.slice(newlineIndex + 1)
        handleLine(line)
        newlineIndex = buffer.indexOf("\n")
      }
    })

    child.on("error", (error) => {
      childError = error
      clearTimeout(timeout)
      fail(error)
    })

    child.on("close", (code) => {
      clearTimeout(timeout)
      input.abort.removeEventListener("abort", onAbort)
      if (settled) return
      if (code !== 0 && code !== null) {
        fail(childError ?? new Error(`dsh ACP child exited with code ${code}`))
        return
      }
      fail(childError ?? new Error("dsh ACP child exited before the prompt settled"))
    })

    void (async () => {
      try {
        await call("initialize", { protocolVersion: 1, clientCapabilities: {} })
        const session = (await call("session/new", { cwd: input.cwd, mcpServers: [] })) as {
          sessionId?: string
        }
        if (!session?.sessionId) {
          fail(new Error("dsh ACP session/new returned no sessionId"))
          return
        }
        const promptResponse = new Promise<JsonRpcResponse>((resolvePrompt) => {
          promptResponseResolver = resolvePrompt
        })
        send({
          jsonrpc: "2.0",
          id: 0,
          method: "session/prompt",
          params: { sessionId: session.sessionId, prompt: [{ type: "text", text: input.prompt }] },
        } satisfies JsonRpcRequest)
        const response = await promptResponse
        if (response.error) {
          fail(new Error(response.error.message))
          return
        }
        const result = (response.result ?? {}) as { stopReason?: string }
        stopReason = result.stopReason ?? "end_turn"
        finish({ output: chunks, stopReason })
      } catch (error) {
        clearTimeout(timeout)
        input.abort.removeEventListener("abort", onAbort)
        disposeChild()
        fail(error instanceof Error ? error : new Error(String(error)))
      }
    })()
  })
}

function pickAllowOnceOption(params: unknown): unknown {
  if (params && typeof params === "object" && "options" in params) {
    const options = (params as { options?: unknown }).options
    if (Array.isArray(options)) {
      const firstAllow = options.find((option) => {
        if (!option || typeof option !== "object") return false
        const kind = (option as { kind?: unknown }).kind
        return kind === "allow_once" || kind === "allow_always"
      })
      if (firstAllow && typeof firstAllow === "object" && "optionId" in firstAllow) {
        return (firstAllow as { optionId?: unknown }).optionId
      }
    }
  }
  return undefined
}
