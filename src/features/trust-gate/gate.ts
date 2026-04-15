/**
 * Gate - Trust Gateのエントリポイント
 *
 * 未信頼projectの承認判定を行う
 */

import type { TrustDecision, TrustedProject, ApprovalResult, ExecutionSurface, TrustStoreConfig } from "./types"
import { TRUST_ENV_VAR } from "./types"
import { scanExecutionSurfaces, hasExecutionSurfaces } from "./scanner"
import { computeCombinedHash, hashSurfaces } from "./hash"
import { getTrustedProject, isProjectTrusted, addTrustedProject } from "./store"
import { showInteractivePrompt, handleNonTTY, createNonTTYErrorMessage } from "./prompt"
import { log } from "../../shared/logger"
import { resolve } from "node:path"

/**
 * Trust Gate判定オプション
 */
export interface TrustGateOptions {
  /** 自動承認（CI環境用） */
  autoApprove?: boolean
  /** カスタムtrust store設定 */
  storeConfig?: TrustStoreConfig
}

/**
 * 信頼決定結果（実行制御用）
 */
export interface TrustGateDecision {
  /** 承認済みか */
  approved: boolean
  /** 実行面リスト */
  surfaces: ExecutionSurface[]
  /** 信頼記録（承認時） */
  trustRecord?: TrustedProject
  /** エラーメッセージ（拒否時） */
  error?: string
}

/**
 * projectの信頼状態を評価
 */
export async function evaluateProjectTrust(
  projectRoot: string,
  options?: TrustGateOptions
): Promise<TrustGateDecision> {
  const absPath = resolve(projectRoot)

  // 1. 実行面をスキャン
  const surfaces = scanExecutionSurfaces(absPath)

  // 実行面がない場合は自動承認（gate不要）
  if (surfaces.length === 0) {
    log(`[trust-gate] No execution surfaces detected in ${absPath}`)
    return { approved: true, surfaces: [] }
  }

  log(`[trust-gate] ${surfaces.length} execution surface(s) detected in ${absPath}`)

  // 2. 実行面にハッシュを付与
  const hashedSurfaces = hashSurfaces(surfaces)

  // 3. 結合ハッシュを計算
  const currentHash = computeCombinedHash(hashedSurfaces)

  // 4. CI escape hatch: OMO_TRUST_PROJECT=1
  if (process.env[TRUST_ENV_VAR] === "1" || options?.autoApprove) {
    log(`[trust-gate] Auto-approved via ${TRUST_ENV_VAR}=1`)
    const trustRecord: TrustedProject = {
      absPath,
      configHash: currentHash,
      approvedAt: new Date().toISOString(),
      approvedBy: "env-var",
      scope: "all",
    }

    // 永続化（オプション）
    try {
      addTrustedProject(trustRecord, options?.storeConfig)
    } catch {
      // 永続化失敗は無視
    }

    return { approved: true, surfaces: hashedSurfaces, trustRecord }
  }

  // 5. 保存済み信頼状態をチェック
  const stored = getTrustedProject(absPath, options?.storeConfig)

  if (stored) {
    if (stored.configHash === currentHash) {
      log(`[trust-gate] Project trusted (hash match): ${absPath}`)
      return { approved: true, surfaces: hashedSurfaces, trustRecord: stored }
    }

    log(`[trust-gate] Project modified since last approval: ${absPath}`)
    // hash不一致 - 再承認が必要
  }

  // 6. TTY判定
  const isTTY = process.stdin.isTTY && process.stdout.isTTY

  if (!isTTY) {
    const error = createNonTTYErrorMessage(hashedSurfaces, absPath)
    log(`[trust-gate] Non-TTY environment, approval required`)
    return { approved: false, surfaces: hashedSurfaces, error }
  }

  // 7. 対話承認プロンプト
  log(`[trust-gate] Showing interactive approval prompt...`)

  const decision: TrustDecision = {
    status: stored ? "modified" : "untrusted",
    surfaces: hashedSurfaces,
    currentHash,
    storedHash: stored?.configHash,
  }

  const result = await showInteractivePrompt(decision, absPath)

  if (result.approved) {
    const trustRecord: TrustedProject = {
      absPath,
      configHash: currentHash,
      approvedAt: new Date().toISOString(),
      approvedBy: "interactive",
      scope: "all",
    }

    try {
      addTrustedProject(trustRecord, options?.storeConfig)
    } catch (err) {
      log(`[trust-gate] Failed to save trust record: ${err instanceof Error ? err.message : err}`)
    }

    log(`[trust-gate] Project approved interactively: ${absPath}`)
    return { approved: true, surfaces: hashedSurfaces, trustRecord }
  }

  // 拒否またはdiff選択
  log(`[trust-gate] Project not approved: ${absPath}`)
  return {
    approved: false,
    surfaces: hashedSurfaces,
    error: `Execution surfaces not approved. Run "opencode trust ${absPath}" to approve.`,
  }
}

/**
 * 実行面が存在し、かつ承認が必要かチェック（高速判定）
 */
export function shouldGateProject(projectRoot: string, storeConfig?: TrustStoreConfig): boolean {
  const absPath = resolve(projectRoot)

  // CI escape hatch
  if (process.env[TRUST_ENV_VAR] === "1") {
    return false
  }

  // 実行面がない場合はgate不要
  if (!hasExecutionSurfaces(absPath)) {
    return false
  }

  // 実行面あり - hash計算してチェック
  const surfaces = scanExecutionSurfaces(absPath)
  if (surfaces.length === 0) {
    return false
  }

  const hashedSurfaces = hashSurfaces(surfaces)
  const currentHash = computeCombinedHash(hashedSurfaces)
  const { trusted } = isProjectTrusted(absPath, currentHash, storeConfig)

  return !trusted
}

/**
 * 実行面リストを取得（ログ・デバッグ用）
 */
export function getExecutionSurfaces(projectRoot: string): ExecutionSurface[] {
  const absPath = resolve(projectRoot)
  return scanExecutionSurfaces(absPath)
}
