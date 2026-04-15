/**
 * Trust Gate - セキュリティ承認システム
 *
 * 未信頼projectのimplicit-execution surfaceをgate化するモジュール
 */

// Types
export type {
  ExecutionSurface,
  ExecutionSurfaceType,
  TrustStatus,
  TrustedProject,
  TrustDecision,
  ApprovalResult,
  TrustStoreConfig,
  ScannerConfig,
} from "./types"
export { TRUST_ENV_VAR, DEFAULT_SCANNER_CONFIG } from "./types"

// Core functions
export {
  evaluateProjectTrust,
  shouldGateProject,
  getExecutionSurfaces,
  type TrustGateDecision,
  type TrustGateOptions,
} from "./gate"

// Scanner
export { scanExecutionSurfaces, hasExecutionSurfaces } from "./scanner"

// Hash
export { computeCombinedHash, hashSurfaces, formatShortHash } from "./hash"

// Store
export {
  getDefaultTrustFilePath,
  getTrustStoreConfig,
  loadTrustedProjects,
  getTrustedProject,
  isProjectTrusted,
  addTrustedProject,
  removeTrustedProject,
  listTrustedProjects,
} from "./store"

// CLI
export { setupTrustCommand } from "./cli"
