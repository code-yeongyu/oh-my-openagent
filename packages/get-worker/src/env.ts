export interface Env {
  readonly RELEASES: R2Bucket
  readonly DB: D1Database
  readonly DOWNLOADS: AnalyticsEngineDataset
  readonly ACCOUNT_ID: string
  readonly ANALYTICS_DATASET: string
  readonly ANALYTICS_TOKEN?: string
}

export interface RequestContext {
  readonly env: Env
  readonly cache: Cache
  readonly waitUntil: (promise: Promise<unknown>) => void
}
