/**
 * Hash - 実行面ファイルのコンテンツハッシュ計算
 */

import { createHash } from "node:crypto"
import { readFileSync, existsSync } from "node:fs"
import type { ExecutionSurface } from "./types"

/**
 * ファイル内容のSHA256ハッシュを計算
 */
export function computeFileHash(filePath: string): string | null {
  if (!existsSync(filePath)) {
    return null
  }

  try {
    const content = readFileSync(filePath)
    return createHash("sha256").update(content).digest("hex")
  } catch {
    return null
  }
}

/**
 * 複数ファイルの結合ハッシュを計算
 * ファイルパスとハッシュのペアをソートして連結
 */
export function computeCombinedHash(surfaces: ExecutionSurface[]): string {
  // ファイルパスでソート（決定論的）
  const sorted = [...surfaces].sort((a, b) => a.filePath.localeCompare(b.filePath))

  // パス:ハッシュ の形式で連結
  const hashContent = sorted
    .map((s) => {
      const hash = s.contentHash ?? computeFileHash(s.filePath) ?? "missing"
      return `${s.type}:${s.filePath}:${hash}`
    })
    .join("\n")

  return createHash("sha256").update(hashContent).digest("hex")
}

/**
 * 実行面リストにハッシュを付与
 */
export function hashSurfaces(surfaces: ExecutionSurface[]): ExecutionSurface[] {
  return surfaces.map((s) => ({
    ...s,
    contentHash: computeFileHash(s.filePath) ?? undefined,
  }))
}

/**
 * 短縮ハッシュ表示用（16文字）
 */
export function formatShortHash(hash: string): string {
  return hash.slice(0, 16) + "..."
}
