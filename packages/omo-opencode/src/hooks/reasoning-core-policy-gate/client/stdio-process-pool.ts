import type { ReasoningCoreTransport, SendRequestOptions, TransportConfig } from "./transport-interface"
import type { JsonRpcRequest } from "./json-rpc-message"
import { createStdioTransport, type StdioTransportConfig } from "./stdio-transport"

export interface StdioProcessPoolConfig extends TransportConfig {
  binaryPath: string
  poolSize: number
}

interface PoolSlot {
  transport: ReasoningCoreTransport
  busy: boolean
}

type QueuedTask = (slot: PoolSlot) => void

export function createStdioProcessPool(config: StdioProcessPoolConfig): ReasoningCoreTransport {
  const slots: PoolSlot[] = []
  const queue: QueuedTask[] = []
  const dedicatedSessions = new Map<string, ReasoningCoreTransport>()
  let disposed = false

  function slotConfig(): StdioTransportConfig {
    return { binaryPath: config.binaryPath, timeoutMs: config.timeoutMs }
  }

  function acquireSlot(): Promise<PoolSlot> {
    return new Promise((resolve, reject) => {
      if (disposed) {
        reject(new Error("stdio-process-pool: disposed"))
        return
      }

      const idle = slots.find((s) => !s.busy)
      if (idle) {
        idle.busy = true
        resolve(idle)
        return
      }

      if (slots.length < config.poolSize) {
        const slot: PoolSlot = { transport: createStdioTransport(slotConfig()), busy: true }
        slots.push(slot)
        resolve(slot)
        return
      }

      queue.push((slot) => resolve(slot))
    })
  }

  function releaseSlot(slot: PoolSlot): void {
    slot.busy = false
    const next = queue.shift()
    if (next) {
      slot.busy = true
      next(slot)
    }
  }

  async function sendRequest(message: JsonRpcRequest, options?: SendRequestOptions): Promise<unknown> {
    if (disposed) throw new Error("stdio-process-pool: disposed")

    if (options?.sessionKey) {
      let dedicated = dedicatedSessions.get(options.sessionKey)
      if (!dedicated) {
        dedicated = createStdioTransport(slotConfig())
        dedicatedSessions.set(options.sessionKey, dedicated)
      }
      return dedicated.sendRequest(message)
    }

    const slot = await acquireSlot()
    try {
      return await slot.transport.sendRequest(message)
    } finally {
      releaseSlot(slot)
    }
  }

  function disposeSession(sessionKey: string): void {
    const dedicated = dedicatedSessions.get(sessionKey)
    if (!dedicated) return
    dedicatedSessions.delete(sessionKey)
    dedicated.dispose()
  }

  function dispose(): void {
    disposed = true
    queue.length = 0
    for (const slot of slots) slot.transport.dispose()
    slots.length = 0
    for (const dedicated of dedicatedSessions.values()) dedicated.dispose()
    dedicatedSessions.clear()
  }

  return { sendRequest, dispose, disposeSession }
}
