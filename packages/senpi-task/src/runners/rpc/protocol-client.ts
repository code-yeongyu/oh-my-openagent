import type { ChildProcess } from "node:child_process"
import type { AgentSessionEvent, RpcCommand, RpcExtensionUIRequest, RpcResponse } from "@code-yeongyu/senpi"
import { log } from "@oh-my-opencode/utils"

import type { ChildEventListener, RpcEntriesResult, RpcSwitchSessionResult } from "../types"
import { RpcCommandError } from "./errors"
import { tailStderr } from "./exit-mapping"
import { buildAutoUiResponse } from "./ui-auto-answer"

export type MalformedLineHandler = (line: string, error: unknown) => void

export type RpcProtocolClientOptions = {
  readonly child: ChildProcess
  readonly onMalformedLine?: MalformedLineHandler
  readonly autoAnswerUi?: boolean
}

type PendingRequest = {
  readonly resolve: (response: RpcResponse) => void
  readonly reject: (error: Error) => void
}

/**
 * Newline-delimited JSON RPC client over a spawned senpi child. Correlates
 * responses to requests by id, fans AgentSessionEvents out to subscribers, and
 * auto-answers extension_ui_request with safe deny/cancel defaults so the child
 * never blocks on UI. A malformed line is reported and skipped; the connection
 * survives. This module NEVER sends process signals - see terminate.ts.
 */
export class RpcProtocolClient {
  private readonly child: ChildProcess
  private readonly onMalformedLine: MalformedLineHandler
  private readonly autoAnswerUi: boolean
  private readonly pending = new Map<string, PendingRequest>()
  private readonly eventListeners = new Set<ChildEventListener>()
  private readonly exitListeners = new Set<(error?: Error) => void>()
  private stdoutBuffer = ""
  private stderrBuffer = ""
  private nextRequestId = 0
  private isExited = false

  constructor(options: RpcProtocolClientOptions) {
    this.child = options.child
    this.onMalformedLine =
      options.onMalformedLine ?? ((line, error) => log("senpi-task rpc malformed line", { line, error: String(error) }))
    this.autoAnswerUi = options.autoAnswerUi ?? true
    this.attach()
  }

  get pid(): number | undefined {
    return this.child.pid ?? undefined
  }

  get exited(): boolean {
    return this.isExited
  }

  get stderrTail(): string {
    return tailStderr(this.stderrBuffer)
  }

  send(command: RpcCommand): Promise<RpcResponse> {
    if (this.isExited) {
      return Promise.reject(new Error(`RPC process is not running. Stderr: ${this.stderrTail}`))
    }
    const id = command.id ?? `senpi-task_${++this.nextRequestId}`
    return new Promise<RpcResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.child.stdin?.write(`${JSON.stringify({ ...command, id })}\n`, (error) => {
        if (!error) {
          return
        }
        this.pending.delete(id)
        reject(error)
      })
    })
  }

  async switchSession(sessionPath: string): Promise<RpcSwitchSessionResult> {
    const response = await this.send({ type: "switch_session", sessionPath })
    if (response.success && response.command === "switch_session") return response.data
    throw commandError(response, "switch_session")
  }

  async getEntries(since?: string): Promise<RpcEntriesResult> {
    const command: RpcCommand = since === undefined ? { type: "get_entries" } : { type: "get_entries", since }
    const response = await this.send(command)
    if (response.success && response.command === "get_entries") return response.data
    throw commandError(response, "get_entries")
  }

  onEvent(listener: ChildEventListener): () => void {
    this.eventListeners.add(listener)
    return () => {
      this.eventListeners.delete(listener)
    }
  }

  onExit(listener: (error?: Error) => void): () => void {
    this.exitListeners.add(listener)
    return () => {
      this.exitListeners.delete(listener)
    }
  }

  detach(): void {
    this.eventListeners.clear()
    this.exitListeners.clear()
  }

  private attach(): void {
    this.child.stdout?.setEncoding("utf8")
    this.child.stdout?.on("data", (chunk: string) => this.ingest(chunk))
    this.child.stderr?.setEncoding("utf8")
    this.child.stderr?.on("data", (chunk: string) => {
      this.stderrBuffer += chunk
    })
    this.child.once("error", (error) => this.finalize(error))
    this.child.once("exit", () => this.finalize())
  }

  private ingest(chunk: string): void {
    this.stdoutBuffer += chunk
    for (;;) {
      const newlineIndex = this.stdoutBuffer.indexOf("\n")
      if (newlineIndex === -1) {
        break
      }
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim()
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1)
      if (line) {
        this.handleLine(line)
      }
    }
  }

  private handleLine(line: string): void {
    let parsed: { type?: string; id?: string }
    try {
      parsed = JSON.parse(line) as { type?: string; id?: string }
    } catch (error) {
      this.onMalformedLine(line, error)
      return
    }
    if (parsed.type === "response") {
      this.resolveResponse(parsed as RpcResponse)
      return
    }
    if (parsed.type === "extension_ui_request") {
      this.answerUi(parsed as RpcExtensionUIRequest)
      return
    }
    for (const listener of this.eventListeners) {
      listener(parsed as AgentSessionEvent)
    }
  }

  private resolveResponse(response: RpcResponse): void {
    if (!response.id) {
      return
    }
    const pending = this.pending.get(response.id)
    if (!pending) {
      return
    }
    this.pending.delete(response.id)
    pending.resolve(response)
  }

  private answerUi(request: RpcExtensionUIRequest): void {
    if (!this.autoAnswerUi) {
      return
    }
    const answer = buildAutoUiResponse(request)
    if (answer) {
      this.child.stdin?.write(`${JSON.stringify(answer)}\n`)
    }
  }

  private finalize(error?: Error): void {
    if (this.isExited) {
      return
    }
    this.isExited = true
    const failure = error ?? new Error(`RPC process exited. Stderr: ${this.stderrTail}`)
    for (const [id, pending] of this.pending) {
      this.pending.delete(id)
      pending.reject(failure)
    }
    for (const listener of this.exitListeners) {
      listener(error)
    }
  }
}

function commandError(response: RpcResponse, expectedCommand: string): RpcCommandError {
  if (!response.success) return new RpcCommandError(expectedCommand, response.error)
  return new RpcCommandError(expectedCommand, `unexpected response command: ${response.command}`)
}
