/**
 * #9425: the `open_session` context label of the hidden worker session that only reads the model
 * catalog for a session that does not exist yet. senpi hands the label to that session's own
 * extensions as `pi.sessionContext`, so startup work that would start a turn or spend a
 * once-per-install marker (onboarding) can skip a session nobody will ever talk to.
 */
export const CATALOG_PROBE_CONTEXT = { omo_probe: "model_catalog" } as const

export function isCatalogProbeSession(pi: unknown): boolean {
  if (typeof pi !== "object" || pi === null) return false
  const context = (pi as { readonly sessionContext?: unknown }).sessionContext
  if (typeof context !== "object" || context === null) return false
  return (context as { readonly omo_probe?: unknown }).omo_probe === CATALOG_PROBE_CONTEXT.omo_probe
}
