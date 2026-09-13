/**
 * Subscription usage: how much of a plan's rolling windows the serving account has spent.
 *
 * This is the one part of the panel that leaves the machine, so the shapes here are written
 * for a cache that several sessions share rather than for a single session's memory.
 */

/**
 * The providers that publish a usage endpoint; a key is also the cache key. The type is derived
 * from the list rather than written twice, and the list is the only place a third provider would
 * be added - it used to be spelled out separately in the cache, the poller and the section.
 */
export const USAGE_PROVIDER_KEYS = ["claude", "codex"] as const

export type PanelUsageProviderKey = (typeof USAGE_PROVIDER_KEYS)[number]

/** Health of the account the numbers came from, as far as the credential pool knows. */
export type PanelAccountState = "ok" | "cooldown" | "stale"

/** One rolling window of a plan. */
export interface PanelUsageWindow {
  /** Short name: "5h", "7d", or the model a scoped weekly limit applies to. */
  readonly label: string
  /** Percent of the window already spent, 0..100, exactly as the vendor reports it. */
  readonly percent: number
  readonly resetsAt?: number
  /**
   * Length of the window. Neither payload states it, so it is derived from the window kind;
   * it exists so the bar can mark where an evenly paced burn would be by now.
   */
  readonly windowMs?: number
  /** A weekly limit bound to one model rather than to the whole plan. */
  readonly scoped?: boolean
}

/** One provider's slice of the shared cache. */
export interface PanelUsageEntry {
  readonly windows?: readonly PanelUsageWindow[]
  readonly plan?: string
  /** Whose quota this is. Carried with the numbers so a label can never drift off its bars. */
  readonly account?: string
  readonly pinnedAccount?: string
  readonly accountState?: PanelAccountState
  readonly updatedAt?: number
  /** Panel-sized explanation of the last failure; previous windows stay on screen beside it. */
  readonly error?: string
  /** Shared backoff deadline: every session reads it, so one 429 does not become many. */
  readonly retryAt?: number
}

export type PanelUsageSnapshot = { readonly [K in PanelUsageProviderKey]?: PanelUsageEntry }

/** The on-disk shape: the snapshot plus in-flight announcements that stop a stampede. */
export interface PanelUsageCacheFile extends PanelUsageSnapshot {
  readonly fetching?: { readonly [K in PanelUsageProviderKey]?: number }
}
