import { isRecord } from "../../shared/record-type-guard"

/**
 * Normalize a session model value into a canonical "<providerID>/<id>" string.
 *
 * Since opencode 1.15.x the `session.created` event payload exposes
 * `info.model` as an object (`{ id, providerID, variant }`) rather than a
 * plain string. Downstream fallback state treats the model as a string and
 * calls `.toLowerCase()` on it, so an object value crashes the hook. This
 * helper collapses both the legacy string form and the object form to a
 * single canonical string at the hook boundary. Returns undefined when no
 * usable provider/model pair can be derived.
 */
export function normalizeModelToCanonicalString(model: unknown): string | undefined {
  if (typeof model === "string") {
    const trimmed = model.trim()
    return trimmed ? trimmed : undefined
  }

  if (isRecord(model)) {
    const providerID = typeof model.providerID === "string" ? model.providerID.trim() : undefined
    const rawModelID = typeof model.id === "string"
      ? model.id
      : typeof model.modelID === "string"
        ? model.modelID
        : undefined
    const modelID = rawModelID?.trim()
    if (providerID && modelID) {
      return `${providerID}/${modelID}`
    }
  }

  return undefined
}
