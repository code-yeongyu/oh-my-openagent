import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import path from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"
import type {
  EngineMethod,
  JsonRpcErrorData,
  JsonRpcNotification,
  RpcNotificationListener,
  RpcPort,
  RpcPortFailure,
} from "@oh-my-opencode/senpi-desktop-protocol"

// The desktop service's own script engine (packages/senpi-desktop-service/test/fake-engine.mjs), reused unchanged
// behind an RpcPort: one child per port, NDJSON JSON-RPC over stdio, FAKE_ENGINE_DESKTOP=1 scripted desktop.
const FAKE_ENGINE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../senpi-desktop-service/test/fake-engine.mjs",
)
const RECEIVED = "recv "

export class PortFailure extends Error implements RpcPortFailure {
  readonly rpcCode: number
  readonly data: JsonRpcErrorData | null

  constructor(error: { readonly code: number; readonly message: string; readonly data?: unknown }) {
    super(error.message)
    this.name = "PortFailure"
    this.rpcCode = error.code
    this.data = (error.data ?? null) as JsonRpcErrorData | null
  }
}

/** A request as the fake engine received it. */
export interface WireRequest {
  readonly id?: number
  readonly method: string
  readonly params?: unknown
}

export interface FakePort extends RpcPort {
  /** Every request the engine received, in order (from its `recv` echo). */
  readonly requests: readonly WireRequest[]
  /** Delivers `notification` to subscribers as if the engine had sent it. */
  inject(notification: JsonRpcNotification): void
}

export function fakeEnginePort(env: Readonly<Record<string, string>> = {}): FakePort {
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [FAKE_ENGINE, "--stdio"], {
    env: { ...process.env, FAKE_ENGINE_DESKTOP: "1", ...env },
    stdio: "pipe",
  })
  const exited = new Promise<void>((resolve) => child.once("close", () => resolve()))
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  const listeners = new Set<RpcNotificationListener>()
  const requests: WireRequest[] = []
  let nextId = 1
  const dispatch = (notification: JsonRpcNotification) => {
    for (const listener of [...listeners]) listener(notification)
  }
  createInterface({ input: child.stdout }).on("line", (line) => {
    const message = JSON.parse(line)
    if (typeof message.method === "string" && message.id === undefined) {
      if (message.method === "engine.log" && String(message.params?.message).startsWith(RECEIVED)) {
        requests.push(JSON.parse(String(message.params.message).slice(RECEIVED.length)))
      }
      dispatch(message)
      return
    }
    const waiter = pending.get(message.id)
    pending.delete(message.id)
    if (waiter === undefined) return
    if ("result" in message) waiter.resolve(message.result)
    else waiter.reject(new PortFailure(message.error))
  })
  child.once("close", () => {
    for (const waiter of pending.values()) waiter.reject(new Error("fake engine exited"))
    pending.clear()
  })
  return {
    requests,
    inject: dispatch,
    call(method: EngineMethod, params: unknown): Promise<unknown> {
      const id = nextId++
      const { promise, resolve, reject } = Promise.withResolvers<unknown>()
      pending.set(id, { resolve, reject })
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`)
      return promise
    },
    notifications: {
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
    async close() {
      child.stdin.end()
      await exited
    },
  }
}

export type Intercept = (method: EngineMethod, params: unknown, forward: () => Promise<unknown>) => Promise<unknown>

/** `port` with `intercept` in front of every call; notifications and close pass through. */
export function interceptPort(port: FakePort, intercept: Intercept): FakePort {
  return {
    requests: port.requests,
    inject: port.inject,
    notifications: port.notifications,
    close: () => port.close(),
    call: (method, params, options) => intercept(method, params, () => port.call(method, params, options)),
  }
}

/** Resolves with the first value `subscribe` delivers, or rejects naming `what` after `timeoutMs`. */
export function nextEvent<T>(
  subscribe: (listener: (value: T) => void) => () => void,
  what: string,
  timeoutMs = 5_000,
): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>()
  const timer = setTimeout(() => {
    unsubscribe()
    reject(new Error(`waited ${timeoutMs} ms for ${what}, it never arrived`))
  }, timeoutMs)
  const unsubscribe = subscribe((value) => {
    clearTimeout(timer)
    unsubscribe()
    resolve(value)
  })
  return promise
}
