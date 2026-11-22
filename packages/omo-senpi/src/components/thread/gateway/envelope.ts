import type { EnvelopeOrigin, GatewaySender, Provenance } from "./types"

export type SenderFacts = {
  readonly provenance: Provenance
  readonly principal: string
  readonly rate_principal: string
  readonly node: string
  readonly turn: string | null
  readonly cause: string | null
  readonly actor: string
  readonly origin: (deliveryId: string) => EnvelopeOrigin
  readonly binding: { readonly binding_id: string; readonly revision: number } | null
}

/** Who is sending, as every delivery names it: one principal, one causal node, one actor, whatever the transport. */
export function senderFacts(sender: GatewaySender, resolved: Provenance): SenderFacts {
  const sessionLabel = sender.kind === "session" ? sender.name?.trim() : undefined
  const provenance = { ...resolved, ...(sessionLabel ? { session: sessionLabel } : {}) }
  if (sender.kind === "session") {
    return {
      provenance,
      principal: `session:${sender.durable_id}`,
      rate_principal: `session:${sender.durable_id}`,
      node: sender.durable_id,
      turn: sender.turn_id ?? null,
      cause: sender.cause_delivery_id ?? null,
      actor: sender.name ?? sender.durable_id,
      origin: () => ({ session: sender.durable_id }),
      binding: null,
    }
  }
  if (sender.kind === "person") {
    // A person's own input carries no envelope; these facts only key its receipt and name the actor in a refusal.
    const principal = `person:${sender.uid}`
    return {
      provenance,
      principal,
      rate_principal: principal,
      node: principal,
      turn: null,
      cause: null,
      actor: sender.user,
      origin: (deliveryId) => ({
        external: {
          platform: "cli",
          account_id: sender.user,
          chat_id: "@person",
          thread_id: "@chat",
          message_id: deliveryId,
        },
      }),
      binding: null,
    }
  }
  if (sender.kind === "cli") {
    const principal = `cli:${sender.uid}`
    return {
      provenance,
      principal,
      rate_principal: principal,
      node: principal,
      turn: null,
      cause: null,
      actor: sender.user,
      origin: (deliveryId) => ({
        external: {
          platform: "cli",
          account_id: sender.user,
          chat_id: "@cli",
          thread_id: "@chat",
          message_id: deliveryId,
        },
      }),
      binding: null,
    }
  }
  const principal = `binding:${sender.binding_id}`
  const author = sender.origin.author
  return {
    provenance,
    principal,
    // Each human in a bound thread gets their own pair bucket; a sender with no author shares the binding's.
    rate_principal: author === undefined ? principal : `${principal}#author:${author.platform_user_id}`,
    node: principal,
    turn: null,
    cause: null,
    actor: sender.origin.account_id,
    origin: () => ({ external: sender.origin }),
    binding: { binding_id: sender.binding_id, revision: sender.binding_revision },
  }
}
