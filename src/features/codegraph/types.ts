export interface CodeGraphInfo { fileCount: number; nodeCount: number; edgeCount: number }
export interface CodeGraphStatus {
  isAvailable: boolean; isInitialized: boolean
  fileCount: number; nodeCount: number; edgeCount: number
  errorMessage: string | null; indexPath: string | null
}
export interface CodeGraphManagerOptions {
  directory: string
  config: { enabled: boolean; auto_init: boolean; init_timeout_ms: number; fallback_on_error: boolean; fallback_on_empty: boolean; prefer_codegraph: boolean }
}
