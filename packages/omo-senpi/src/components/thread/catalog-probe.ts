/**
 * #9425: the `open_session` context label of the hidden worker session that only reads the model
 * catalog for a session that does not exist yet. senpi hands the label to that session's own
 * extensions as `pi.sessionContext`, so startup work that would start a turn or spend a
 * once-per-install marker (onboarding) can skip a session nobody will ever talk to.
 */
export const CATALOG_PROBE_CONTEXT = { omo_probe: "model_catalog" } as const

/**
 * #9425: the `open_session` context label of a session `thread_create` / `omo thread create` opens.
 * Its first turn belongs to the creator's message and nobody sits at a terminal for it, so the same
 * startup work skips it: an onboarding turn there would greet no one and race the creator's send.
 */
export const THREAD_CREATE_CONTEXT = { omo_origin: "thread_create" } as const

function sessionLabel(pi: unknown, key: string): unknown {
  if (typeof pi !== "object" || pi === null) return undefined
  const context = (pi as { readonly sessionContext?: unknown }).sessionContext
  if (typeof context !== "object" || context === null) return undefined
  return (context as Readonly<Record<string, unknown>>)[key]
}

export function isCatalogProbeSession(pi: unknown): boolean {
  return sessionLabel(pi, "omo_probe") === CATALOG_PROBE_CONTEXT.omo_probe
}

export function isThreadCreatedSession(pi: unknown): boolean {
  return sessionLabel(pi, "omo_origin") === THREAD_CREATE_CONTEXT.omo_origin
}
