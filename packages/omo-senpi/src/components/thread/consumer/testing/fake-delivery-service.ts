import type {
  DeliveryHoldsEvent,
  DeliveryInboundEvent,
  DeliveryPendingPair,
  DeliveryServicePort,
} from "../port"

export type FakeServiceCall =
  | { readonly type: "deliveries.serve"; readonly agent_dir: string; readonly v: number }
  | { readonly type: "delivery.pending"; readonly pairs: readonly DeliveryPendingPair[] }
  | ({ readonly type: "delivery.drained" } & DeliveryPendingPair)
  | { readonly type: "peer.admitted"; readonly device: string }

export type FakeDeliveryService = {
  readonly port: DeliveryServicePort
  readonly calls: FakeServiceCall[]
  /** The next `deliveries.serve` is refused with this local-API error code. */
  readonly refuseServe: (code: string) => void
  /** `delivery.pending` and `delivery.drained` are refused with this code from now on. */
  readonly refuseMarks: (code: string) => void
  readonly onAnswer: (listener: () => Promise<void>) => void
  /** Hands a delivery to the declared consumer; resolves with the consumer's `delivery.answer` reply for that (sender device, command id). */
  readonly inbound: (event: DeliveryInboundEvent) => Promise<Record<string, unknown>>
  /** Asks the consumer `delivery.holds`; resolves with its `delivery.held` answer. */
  readonly holds: (event: DeliveryHoldsEvent) => Promise<boolean>
}

function refusal(code: string): Error {
  return Object.assign(new Error(`local API refused: ${code}`), { code })
}

/** The device service's side of the delivery protocol, in memory: it records each request a consumer sends. */
export function createFakeDeliveryService(options: { readonly admitted: boolean }): FakeDeliveryService {
  const calls: FakeServiceCall[] = []
  let serveRefusal: string | undefined
  let marksRefusal: string | undefined
  let answerListener: (() => Promise<void>) | undefined
  let inboundListener: ((event: DeliveryInboundEvent) => void) | undefined
  let holdsListener: ((event: DeliveryHoldsEvent) => void) | undefined
  const answers = new Map<string, (reply: Record<string, unknown>) => void>()
  const helds = new Map<string, (holds: boolean) => void>()

  const port: DeliveryServicePort = {
    serve: async (request) => {
      calls.push({ type: "deliveries.serve", agent_dir: request.agent_dir, v: request.v })
      if (serveRefusal !== undefined) throw refusal(serveRefusal)
    },
    answer: async (delivery, reply) => {
      await answerListener?.()
      const key = `${delivery.sender_device}\u0000${delivery.command_id}`
      const waiting = answers.get(key)
      if (waiting === undefined) throw refusal("unknown_delivery")
      answers.delete(key)
      waiting(reply)
    },
    held: async (askId, holds) => {
      helds.get(askId)?.(holds)
      helds.delete(askId)
    },
    peerAdmitted: async (device) => {
      calls.push({ type: "peer.admitted", device })
      return options.admitted
    },
    pending: async (pairs) => {
      calls.push({ type: "delivery.pending", pairs })
      if (marksRefusal !== undefined) throw refusal(marksRefusal)
    },
    drained: async (pair) => {
      if (marksRefusal !== undefined) throw refusal(marksRefusal)
      calls.push({ type: "delivery.drained", ...pair })
    },
    onInbound: (listener) => {
      inboundListener = listener
      return () => {
        inboundListener = undefined
      }
    },
    onHolds: (listener) => {
      holdsListener = listener
      return () => {
        holdsListener = undefined
      }
    },
  }

  return {
    port,
    calls,
    refuseServe: (code) => {
      serveRefusal = code
    },
    refuseMarks: (code) => {
      marksRefusal = code
    },
    onAnswer: (listener) => {
      answerListener = listener
    },
    inbound: (event) =>
      new Promise((resolve, reject) => {
        if (inboundListener === undefined) {
          reject(new Error("no consumer is declared"))
          return
        }
        answers.set(`${event.sender_device}\u0000${event.command_id}`, resolve)
        inboundListener(event)
      }),
    holds: (event) =>
      new Promise((resolve, reject) => {
        if (holdsListener === undefined) {
          reject(new Error("no consumer is declared"))
          return
        }
        helds.set(event.ask_id, resolve)
        holdsListener(event)
      }),
  }
}
