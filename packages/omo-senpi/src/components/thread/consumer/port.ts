/**
 * The device service's delivery protocol as an engine process consumes it (#13037 design 5.4 receiving half): a
 * port the consumer is written against, so the consumer is tested with an in-memory service and the real local-API
 * client is wired behind it later. A refused request throws an Error whose `code` is the local-API error code.
 */

export type DeliveryInboundEvent = {
  readonly command_id: string
  readonly sender_device: string
  readonly durable_id: string
  readonly record: Readonly<Record<string, unknown>>
}

export type DeliveryHoldsEvent = { readonly ask_id: string; readonly durable_id: string }

export type DeliveryPendingPair = {
  readonly sender_device: string
  readonly session_id: string
  readonly last_command_id: string
}

/**
 * The acknowledgement of `deliveries.serve` (A7.2.3): `wake` is the receiving device's effective wake switch at that
 * moment. An acknowledgement WITHOUT the field reads off, and the decoder stays closed for every other field.
 */
export type DeliveryServeAck = { readonly wake?: boolean }

export type DeliveryServicePort = {
  readonly serve: (request: { readonly agent_dir: string; readonly v: number }) => Promise<unknown>
  /** Echoes the inbound's own pair: the service keys a waiting hand-off by (sender device, command id) (A5.1). */
  readonly answer: (
    delivery: { readonly sender_device: string; readonly command_id: string },
    reply: Record<string, unknown>,
  ) => Promise<void>
  readonly held: (askId: string, holds: boolean) => Promise<void>
  readonly peerAdmitted: (device: string) => Promise<boolean>
  readonly pending: (pairs: readonly DeliveryPendingPair[]) => Promise<void>
  /** `kept` with `expecting`: the service keeps the mark and names the command it still expects (the backstop, A5.3). */
  readonly drained: (
    pair: DeliveryPendingPair,
  ) => Promise<{ readonly kept: false } | { readonly kept: true; readonly expecting: string }>
  readonly onInbound: (listener: (event: DeliveryInboundEvent) => void) => () => void
  readonly onHolds: (listener: (event: DeliveryHoldsEvent) => void) => () => void
  /** `delivery.wake { enabled }` on this serving connection: the device's wake switch changed (A7.2.3). */
  readonly onWake: (listener: (enabled: unknown) => void) => () => void
}

/**
 * The closed decoder of the serve acknowledgement: only the absent case and a boolean `wake` are accepted, and any
 * other field makes it undefined, so the consumer serves nothing rather than guessing (A7.2.3).
 */
export function decodeServeAck(ack: unknown): DeliveryServeAck | undefined {
  if (typeof ack !== "object" || ack === null) return undefined
  for (const key of Object.keys(ack)) if (key !== "wake") return undefined
  const wake = (ack as { readonly wake?: unknown }).wake
  if (wake === undefined) return {}
  return typeof wake === "boolean" ? { wake } : undefined
}

export function refusalCode(error: unknown): string | undefined {
  const code = (error as { readonly code?: unknown } | null)?.code
  return typeof code === "string" ? code : undefined
}
