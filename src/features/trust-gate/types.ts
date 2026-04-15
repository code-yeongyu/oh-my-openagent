/**
 * Trust Gate - セキュリティ承認システムの型定義
 *
 * 未信頼のprojectからのimplicit-execution surfaceをgate化する
 */

/**
 * 実行面の種類 - 承認対象となる実行経路
 */
export type ExecutionSurfaceType =
  | "hook" // .claude/settings.json の hooks
  | "mcp" // .mcp.json の command+args
  | "embedded-command" // SKILL.md/command 内の !cmd
  | "openclaw-gateway" // .opencode config の type:command gateway
  | "local-skill" // project-local skills (.claude/skills, .opencode/skills, .agents/skills)

/**
 * 個別の実行面エントリ
 */
export interface ExecutionSurface {
  type: ExecutionSurfaceType
  /** ファイル絶対パス */
  filePath: string
  /** 実行されるコマンドまたは説明 */
  command?: string
  /** 実行面ファイルのcontentHash */
  contentHash?: string
}

/**
 * projectの信頼状態
 */
export type TrustStatus = "trusted" | "untrusted" | "modified" // hash変化により再承認必要

/**
 * 信頼済みprojectの記録
 */
export interface TrustedProject {
  /** projectの絶対パス（PK） */
  absPath: string
  /** 実行面ファイル群の結合ハッシュ */
  configHash: string
  /** 承認日時 ISO8601 */
  approvedAt: string
  /** 承認方法 ("interactive" | "env-var") */
  approvedBy: "interactive" | "env-var"
  /** 実行面スコープ ("all" | "hooks-only" | "mcp-only" 等将来的拡張用) */
  scope: string
}

/**
 * Trust Gateの判定結果
 */
export interface TrustDecision {
  /** 信頼状態 */
  status: TrustStatus
  /** 実行面リスト（untrusted/modified時に表示用） */
  surfaces: ExecutionSurface[]
  /** 現在の結合ハッシュ */
  currentHash: string
  /** 保存されているハッシュ（存在する場合） */
  storedHash?: string
}

/**
 * 承認結果
 */
export interface ApprovalResult {
  /** 承認されたか */
  approved: boolean
  /** 永続化する信頼記録（承認時のみ） */
  trustRecord?: TrustedProject
  /** 拒否理由（拒否時のみ） */
  reason?: string
}

/**
 * Trust Storeの設定
 */
export interface TrustStoreConfig {
  /** 信頼リストファイルパス */
  trustFilePath: string
  /** ファイルモード（デフォルト 0o600） */
  fileMode?: number
}

/**
 * Scanner設定
 */
export interface ScannerConfig {
  /** 実行面を検出するファイルパターン */
  hookFiles: string[]
  mcpFiles: string[]
  commandFiles: string[]
  skillDirs: string[]
  openclawConfigs: string[]
}

/**
 * デフォルト設定
 */
export const DEFAULT_SCANNER_CONFIG: ScannerConfig = {
  hookFiles: [".claude/settings.json", ".claude/settings.local.json"],
  mcpFiles: [".mcp.json"],
  commandFiles: [".opencode/command/*.md", ".claude/commands/*.md"],
  skillDirs: [".claude/skills", ".opencode/skills", ".agents/skills"],
  openclawConfigs: [".opencode/config.json", ".opencode/oh-my-opencode.jsonc"],
}

/**
 * 環境変数名
 */
export const TRUST_ENV_VAR = "OMO_TRUST_PROJECT"
