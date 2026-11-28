type JsonObject = Record<string, unknown>

/** An engine-minted prompt id this side will adopt: a short token, no whitespace or control characters (#15374). */
const ENGINE_PROMPT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

function engineNamedId(reply: JsonObject): unknown {
  const admission = reply["admission"]
  const nested =
    typeof admission === "object" && admission !== null ? (admission as JsonObject)["clientMessageId"] : undefined
  return reply["clientMessageId"] ?? nested
}

/**
 * The id a person's relayed prompt answers by (#15093, #15374): the clientMessageId this side sent, never one the
 * receiving engine names instead; with nothing sent, the id the engine minted (senpi client-input admission, top level
 * or admission), only when it is a bounded token.
 */
export function promptDeliveryId(reply: JsonObject, sent: string | undefined): string | undefined {
  if (sent !== undefined) return sent
  const named = engineNamedId(reply)
  return typeof named === "string" && ENGINE_PROMPT_ID.test(named) ? named : undefined
}
