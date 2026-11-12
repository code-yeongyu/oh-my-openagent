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

export type DeliveryServicePort = {
  readonly serve: (request: { readonly agent_dir: string; readonly v: number }) => Promise<void>
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
}

export function refusalCode(error: unknown): string | undefined {
  const code = (error as { readonly code?: unknown } | null)?.code
  return typeof code === "string" ? code : undefined
}
