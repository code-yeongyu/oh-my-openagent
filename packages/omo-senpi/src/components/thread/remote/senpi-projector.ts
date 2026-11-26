import type { SessionEntry } from "@code-yeongyu/senpi"
import type { SessionProjector } from "./ports"

/**
 * The engine this extension runs in projects the entries a paged thread_read fetched from another device the way that
 * device's engine answers get_messages; entries are senpi's own session records, as get_entries hands them over.
 */
export async function loadSenpiProjector(): Promise<SessionProjector> {
  const { buildSessionProjection } = await import("@code-yeongyu/senpi")
  return (entries, leafId) => buildSessionProjection(entries as unknown as SessionEntry[], leafId).entries
}
