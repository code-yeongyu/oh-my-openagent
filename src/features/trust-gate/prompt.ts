/**
 * Prompt - Trust Gateの承認ダイアログ（TTY/非TTY対応）
 */

import type { ExecutionSurface, TrustDecision } from "./types"
import { formatShortHash } from "./hash"

/**
 * 対話承認結果
 */
export interface InteractiveApprovalResult {
  approved: boolean
  action: "approve" | "deny" | "diff"
}

/**
 * 実行面リストを整形して表示
 */
function formatSurfaceList(surfaces: ExecutionSurface[]): string {
  const lines: string[] = []

  for (const s of surfaces) {
    const typeLabel = {
      hook: "Hook",
      mcp: "MCP Server",
      "embedded-command": "Embedded Command",
      "openclaw-gateway": "OpenClaw Gateway",
      "local-skill": "Local Skill",
    }[s.type] ?? s.type

    lines.push(`  [${typeLabel}] ${s.filePath}`)
    if (s.command) {
      lines.push(`    → ${s.command.slice(0, 60)}${s.command.length > 60 ? "..." : ""}`)
    }
    if (s.contentHash) {
      lines.push(`    hash: ${formatShortHash(s.contentHash)}`)
    }
  }

  return lines.join("\n")
}

/**
 * プロンプトメッセージを生成
 */
function createPromptMessage(surfaces: ExecutionSurface[], projectPath: string): string {
  const hashLine = surfaces[0]?.contentHash
    ? `\nConfig Hash: ${formatShortHash(computeSurfacesHash(surfaces))}`
    : ""

  return `
🔒 Trust Gate: Unrecognized project execution surfaces detected

Project: ${projectPath}

This project contains code that will be executed by oh-my-openagent:
${formatSurfaceList(surfaces)}
${hashLine}

Actions:
  (y) Yes - Trust this project and allow all execution surfaces
  (n) No  - Load only, disable execution (hooks/MCP/commands will not run)
  (d) Diff - Show what changed from last approval

Choice [y/n/d]: `
}

/**
 * 簡易hash計算（表示用）
 */
function computeSurfacesHash(surfaces: ExecutionSurface[]): string {
  // 簡易表示用hash
  const content = surfaces.map((s) => `${s.type}:${s.filePath}`).join("\n")
  // node:cryptoが使えない場合を考慮して簡易hash
  let hash = 0
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i)
    hash = ((hash << 5) - hash + char) | 0
  }
  return Math.abs(hash).toString(16).padStart(16, "0")
}

/**
 * 非TTY環境用のエラーメッセージ
 */
export function createNonTTYErrorMessage(surfaces: ExecutionSurface[], projectPath: string): string {
  return `
Error: Trust Gate detected execution surfaces in non-interactive environment.

Project: ${projectPath}

Execution surfaces detected:
${formatSurfaceList(surfaces)}

To approve this project, run:
  opencode trust ${projectPath}

Or set the environment variable to skip approval (CI only):
  OMO_TRUST_PROJECT=1 opencode

All execution surfaces are disabled until approved.
`
}

/**
 * 非TTY環境ではエラーを返す
 */
export function handleNonTTY(decision: TrustDecision, projectPath: string): { error: string; exit: true } {
  return {
    error: createNonTTYErrorMessage(decision.surfaces, projectPath),
    exit: true,
  }
}

/**
 * TTY対話プロンプト（シンプル版 - readline使用）
 */
export async function showInteractivePrompt(
  decision: TrustDecision,
  projectPath: string
): Promise<InteractiveApprovalResult> {
  const message = createPromptMessage(decision.surfaces, projectPath)

  // 標準入力から読み取り
  process.stdout.write(message)

  const response = await new Promise<string>((resolve) => {
    const chunks: Buffer[] = []
    process.stdin.on("data", (chunk) => {
      chunks.push(Buffer.from(chunk))
    })
    process.stdin.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf-8").trim().toLowerCase())
    })

    // タイムアウト（30秒）
    setTimeout(() => resolve(""), 30000)
  })

  if (response === "y" || response === "yes") {
    return { approved: true, action: "approve" }
  } else if (response === "d" || response === "diff") {
    return { approved: false, action: "diff" }
  } else {
    return { approved: false, action: "deny" }
  }
}

/**
 * 差分表示（簡易版 - 将来拡張）
 */
export function showDiff(_decision: TrustDecision, _projectPath: string): string {
  // TODO: 前回承認時との差分詳細表示
  return "Diff view not yet implemented. Showing current execution surfaces."
}
