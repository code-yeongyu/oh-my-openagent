export interface Env {
  readonly RELEASES: R2Bucket
  readonly DB: D1Database
  readonly DOWNLOADS: AnalyticsEngineDataset
  readonly ACCOUNT_ID: string
  readonly ANALYTICS_DATASET: string
  readonly ANALYTICS_TOKEN?: string
  /** The first UTC day the hourly rollup may write (YYYY-MM-DD); earlier days in its window are left as stored. */
  readonly ROLLUP_FIRST_DAY?: string
}

export interface RequestContext {
  readonly env: Env
  readonly cache: Cache
  readonly waitUntil: (promise: Promise<unknown>) => void
}
