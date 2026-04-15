/**
 * Trust Store - 信頼済みprojectの永続化
 *
 * ~/.config/oh-my-opencode/trusted.json の読み書き
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  chmodSync,
  renameSync,
  unlinkSync,
} from "node:fs"
import { join, dirname } from "node:path"
import { homedir } from "node:os"
import type { TrustedProject, TrustStoreConfig } from "./types"
import { log } from "../../shared/logger"
import { CACHE_DIR_NAME } from "../../shared/plugin-identity"

const DEFAULT_FILE_MODE = 0o600 // 所有者のみ読み書き

/**
 * デフォルトの信頼リストファイルパス
 */
export function getDefaultTrustFilePath(): string {
  const configDir = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
  return join(configDir, CACHE_DIR_NAME, "trusted.json")
}

/**
 * Trust Storeの設定を取得
 */
export function getTrustStoreConfig(customPath?: string): TrustStoreConfig {
  return {
    trustFilePath: customPath ?? getDefaultTrustFilePath(),
    fileMode: DEFAULT_FILE_MODE,
  }
}

/**
 * 信頼リストディレクトリを確保
 */
function ensureTrustDir(config: TrustStoreConfig): void {
  const dir = dirname(config.trustFilePath)
  if (!existsSync(dir)) {
    // Node.js recursive mkdirはBunでは使えない場合があるのでBun.spawnを使う
    const proc = Bun.spawn(["mkdir", "-p", dir], {
      stdout: "ignore",
      stderr: "ignore",
    })
    // 同期的に完了を待つ（Bun.spawnのexitedはPromise）
  }
}

/**
 * 信頼リストを読み込み
 */
export function loadTrustedProjects(config?: TrustStoreConfig): TrustedProject[] {
  const cfg = config ?? getTrustStoreConfig()

  if (!existsSync(cfg.trustFilePath)) {
    return []
  }

  try {
    const content = readFileSync(cfg.trustFilePath, "utf-8")
    const data = JSON.parse(content) as { projects?: TrustedProject[] }

    // バリデーション: 基本フィールドチェック
    if (!data.projects || !Array.isArray(data.projects)) {
      log(`[trust-gate] Warning: Invalid trust file format at ${cfg.trustFilePath}`)
      return []
    }

    return data.projects.filter((p): p is TrustedProject => {
      return (
        typeof p.absPath === "string" &&
        typeof p.configHash === "string" &&
        typeof p.approvedAt === "string" &&
        typeof p.approvedBy === "string" &&
        typeof p.scope === "string"
      )
    })
  } catch (err) {
    log(`[trust-gate] Error loading trust file: ${err instanceof Error ? err.message : err}`)
    return []
  }
}

/**
 * 特定のprojectの信頼状態を取得
 */
export function getTrustedProject(
  absPath: string,
  config?: TrustStoreConfig
): TrustedProject | undefined {
  const projects = loadTrustedProjects(config)
  return projects.find((p) => p.absPath === absPath)
}

/**
 * projectが信頼済みかチェック（hash一致も確認）
 */
export function isProjectTrusted(
  absPath: string,
  currentHash: string,
  config?: TrustStoreConfig
): { trusted: boolean; modified: boolean } {
  const project = getTrustedProject(absPath, config)

  if (!project) {
    return { trusted: false, modified: false }
  }

  if (project.configHash !== currentHash) {
    return { trusted: false, modified: true }
  }

  return { trusted: true, modified: false }
}

/**
 * 信頼リストに追加（atomic write）
 */
export function addTrustedProject(
  project: TrustedProject,
  config?: TrustStoreConfig
): void {
  const cfg = config ?? getTrustStoreConfig()
  ensureTrustDir(cfg)

  const projects = loadTrustedProjects(cfg)

  // 同じパスの既存エントリを除去
  const filtered = projects.filter((p) => p.absPath !== project.absPath)
  filtered.push(project)

  // 日時でソート（新しい順）
  filtered.sort((a, b) => new Date(b.approvedAt).getTime() - new Date(a.approvedAt).getTime())

  const data = { projects: filtered }
  const json = JSON.stringify(data, null, 2)

  // atomic write: 一時ファイル → rename
  const tempPath = `${cfg.trustFilePath}.tmp`
  writeFileSync(tempPath, json, "utf-8")

  // パーミッション設定
  try {
    chmodSync(tempPath, cfg.fileMode ?? DEFAULT_FILE_MODE)
  } catch {
    // パーミッション設定失敗は無視（Windows等）
  }

  renameSync(tempPath, cfg.trustFilePath)

  log(`[trust-gate] Project trusted: ${project.absPath} (${project.configHash.slice(0, 16)}...)`)
}

/**
 * 信頼リストから削除
 */
export function removeTrustedProject(absPath: string, config?: TrustStoreConfig): boolean {
  const cfg = config ?? getTrustStoreConfig()

  if (!existsSync(cfg.trustFilePath)) {
    return false
  }

  const projects = loadTrustedProjects(cfg)
  const filtered = projects.filter((p) => p.absPath !== absPath)

  if (filtered.length === projects.length) {
    return false // 削除対象なし
  }

  const data = { projects: filtered }
  const json = JSON.stringify(data, null, 2)

  const tempPath = `${cfg.trustFilePath}.tmp`
  writeFileSync(tempPath, json, "utf-8")

  try {
    chmodSync(tempPath, cfg.fileMode ?? DEFAULT_FILE_MODE)
  } catch {
    // Windows等では無視
  }

  renameSync(tempPath, cfg.trustFilePath)

  log(`[trust-gate] Project removed from trust list: ${absPath}`)
  return true
}

/**
 * 全信頼projectリストを取得
 */
export function listTrustedProjects(config?: TrustStoreConfig): TrustedProject[] {
  return loadTrustedProjects(config)
}
