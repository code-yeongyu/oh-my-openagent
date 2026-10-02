import type { GatewayEndpointKind } from "./adapter"
import { transaction, type StoreContext } from "./store-ops"

export type SessionOwner = {
  readonly incarnation: string | null
  readonly endpoint: { readonly socket: string; readonly kind: GatewayEndpointKind } | null
}
export type RegisterIncarnationRequest = {
  readonly durable_id: string
  readonly incarnation: string
  readonly endpoint?: { readonly socket: string; readonly kind: GatewayEndpointKind }
}
export type ClearEndpointRequest = Pick<RegisterIncarnationRequest, "durable_id" | "incarnation">

/** The endpoint and its fencing token become visible in the same transaction. */
export async function registerIncarnation(ctx: StoreContext, request: RegisterIncarnationRequest): Promise<void> {
  await transaction(ctx, "register_incarnation", () => {
    ctx.sql.run(
      `INSERT INTO session_meta (durable_id, next_seq, incarnation, endpoint_socket, endpoint_kind)
       VALUES (?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM deliveries WHERE target_durable_id = ?), ?, ?, ?)
       ON CONFLICT(durable_id) DO UPDATE SET incarnation = excluded.incarnation,
       endpoint_socket = excluded.endpoint_socket, endpoint_kind = excluded.endpoint_kind`,
      [request.durable_id, request.durable_id, request.incarnation, request.endpoint?.socket ?? null, request.endpoint?.kind ?? null],
    )
  })
}

/** A late exit owns only its incarnation, never its successor's endpoint. */
export async function clearEndpoint(ctx: StoreContext, request: ClearEndpointRequest): Promise<void> {
  await transaction(ctx, "clear_endpoint", () => {
    ctx.sql.run("UPDATE session_meta SET endpoint_socket = NULL, endpoint_kind = NULL WHERE durable_id = ? AND incarnation = ?", [request.durable_id, request.incarnation])
  })
}

/** No row means legacy discovery; a row without an endpoint means queued offline. */
export function sessionOwner(ctx: StoreContext, durableId: string): SessionOwner | null {
  const row = ctx.sql.one(["incarnation", "endpoint_socket", "endpoint_kind"], "SELECT incarnation, endpoint_socket, endpoint_kind FROM session_meta WHERE durable_id = ?", [durableId])
  if (row === undefined) return null
  return {
    incarnation: typeof row.incarnation === "string" ? row.incarnation : null,
    endpoint: typeof row.endpoint_socket === "string" && (row.endpoint_kind === "tui" || row.endpoint_kind === "rpc_host")
      ? { socket: row.endpoint_socket, kind: row.endpoint_kind }
      : null,
  }
}
