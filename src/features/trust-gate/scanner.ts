/**
 * Scanner - Projectから実行面（execution surface）を検出
 *
 * 検出対象:
 * - .claude/settings.json, .claude/settings.local.json (hooks)
 * - .mcp.json (local MCP servers)
 * - .opencode/command/*.md, .claude/commands/*.md (!cmd)
 * - .opencode config (openclaw command gateway)
 * - project-local skills (.claude/skills, .opencode/skills, .agents/skills)
 * - config.skills.sources (project-local skill sources)
 */

import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join, resolve } from "node:path"
import type { ExecutionSurface, ScannerConfig } from "./types"
import { log } from "../../shared/logger"

/**
 * デフォルトスキャナー設定
 */
const DEFAULT_CONFIG: ScannerConfig = {
  hookFiles: [".claude/settings.json", ".claude/settings.local.json"],
  mcpFiles: [".mcp.json"],
  commandFiles: [".opencode/command/*.md", ".claude/commands/*.md"],
  skillDirs: [".claude/skills", ".opencode/skills", ".agents/skills"],
  openclawConfigs: [".opencode/config.json", ".opencode/oh-my-opencode.jsonc"],
}

/**
 * globSyncの簡易実装（依存を避ける）
 */
function simpleGlob(dir: string, pattern: string): string[] {
  const results: string[] = []
  try {
    if (!existsSync(dir)) return results

    const entries = readdirSync(dir, { withFileTypes: true })
    const ext = pattern.replace(/^\*\./, "")

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(ext)) {
        results.push(join(dir, entry.name))
      }
    }
  } catch {
    // ignore
  }
  return results
}

/**
 * JSONファイルを安全にパース
 */
function safeParseJson<T>(filePath: string): T | null {
  try {
    const content = readFileSync(filePath, "utf-8")
    return JSON.parse(content) as T
  } catch {
    return null
  }
}

/**
 * Markdownファイル内の !cmd パターンを検出
 */
function findEmbeddedCommands(filePath: string): string[] {
  try {
    const content = readFileSync(filePath, "utf-8")
    const matches: string[] = []

    // backtick-wrapped: !`command`
    const backtickRegex = /!`([^`]+)`/g
    let match: RegExpExecArray | null
    while ((match = backtickRegex.exec(content)) !== null) {
      matches.push(match[1]!.trim())
    }

    // cmd prefix: !cmd command
    const cmdRegex = /!cmd\s+(\S.+)/g
    while ((match = cmdRegex.exec(content)) !== null) {
      matches.push(match[1]!.trim())
    }

    return matches
  } catch {
    return []
  }
}

/**
 * hooks定義を検出
 */
function scanHooks(projectRoot: string, config: ScannerConfig): ExecutionSurface[] {
  const surfaces: ExecutionSurface[] = []

  for (const file of config.hookFiles) {
    const filePath = join(projectRoot, file)
    if (!existsSync(filePath)) continue

    const json = safeParseJson<{ hooks?: Array<{ event: string; command?: string; shell?: boolean }> }>(filePath)
    if (!json?.hooks?.length) continue

    for (const hook of json.hooks) {
      if (hook.command || hook.shell) {
        surfaces.push({
          type: "hook",
          filePath: resolve(filePath),
          command: hook.command,
        })
      }
    }
  }

  return surfaces
}

/**
 * MCP設定を検出（command+argsを持つlocal MCP）
 */
function scanMcpConfigs(projectRoot: string, config: ScannerConfig): ExecutionSurface[] {
  const surfaces: ExecutionSurface[] = []

  for (const file of config.mcpFiles) {
    const filePath = join(projectRoot, file)
    if (!existsSync(filePath)) continue

    const json = safeParseJson<{ mcpServers?: Record<string, { command?: string; args?: string[] }> }>(filePath)
    if (!json?.mcpServers) continue

    for (const [name, server] of Object.entries(json.mcpServers)) {
      if (server.command) {
        surfaces.push({
          type: "mcp",
          filePath: resolve(filePath),
          command: `${server.command} ${(server.args ?? []).join(" ")}`,
        })
      }
    }
  }

  return surfaces
}

/**
 * embedded command (!cmd) を検出
 */
function scanEmbeddedCommands(projectRoot: string, config: ScannerConfig): ExecutionSurface[] {
  const surfaces: ExecutionSurface[] = []

  for (const pattern of config.commandFiles) {
    // パターンからディレクトリと拡張子を抽出
    const parts = pattern.split("/")
    const dirPath = parts.slice(0, -1).join("/")
    const filePattern = parts[parts.length - 1]!
    const ext = filePattern.replace(/^\*\./, "")

    const fullDir = join(projectRoot, dirPath)

    try {
      const files = simpleGlob(fullDir, filePattern)

      for (const file of files) {
        const commands = findEmbeddedCommands(file)
        if (commands.length > 0) {
          surfaces.push({
            type: "embedded-command",
            filePath: resolve(file),
            command: commands.join("; "),
          })
        }
      }
    } catch {
      // glob失敗は無視
    }
  }

  return surfaces
}

/**
 * openclaw command gateway を検出
 */
function scanOpenclawGateways(projectRoot: string, config: ScannerConfig): ExecutionSurface[] {
  const surfaces: ExecutionSurface[] = []

  for (const file of config.openclawConfigs) {
    const filePath = join(projectRoot, file)
    if (!existsSync(filePath)) continue

    let content: string
    try {
      content = readFileSync(filePath, "utf-8")
    } catch {
      continue
    }

    // openclaw gateway type:command を検索
    const gatewayRegex = /"type"\s*:\s*"command"/g
    if (gatewayRegex.test(content)) {
      surfaces.push({
        type: "openclaw-gateway",
        filePath: resolve(filePath),
        command: "openclaw command gateway",
      })
    }
  }

  return surfaces
}

/**
 * project-local skills を検出
 */
function scanLocalSkills(projectRoot: string, config: ScannerConfig): ExecutionSurface[] {
  const surfaces: ExecutionSurface[] = []

  for (const dir of config.skillDirs) {
    const dirPath = join(projectRoot, dir)
    if (!existsSync(dirPath)) continue

    // SKILL.md または mcp.json を持つサブディレクトリを検索
    try {
      const entries = readdirSync(dirPath, { withFileTypes: true })

      for (const entry of entries) {
        if (!entry.isDirectory()) continue

        const skillDir = join(dirPath, entry.name)
        const skillMdPath = join(skillDir, "SKILL.md")
        const mcpJsonPath = join(skillDir, "mcp.json")

        const hasSkillMd = existsSync(skillMdPath)
        const hasMcpJson = existsSync(mcpJsonPath)

        if (hasSkillMd || hasMcpJson) {
          const commands: string[] = []
          if (hasSkillMd) {
            const cmds = findEmbeddedCommands(skillMdPath)
            commands.push(...cmds)
          }

          if (hasMcpJson) {
            const mcpJson = safeParseJson<{ command?: string; args?: string[] }>(mcpJsonPath)
            if (mcpJson?.command) {
              commands.push(`${mcpJson.command} ${(mcpJson.args ?? []).join(" ")}`)
            }
          }

          surfaces.push({
            type: "local-skill",
            filePath: resolve(skillDir),
            command: commands.length > 0 ? commands.join("; ") : "skill definition",
          })
        }
      }
    } catch {
      // 読み込み失敗は無視
    }
  }

  return surfaces
}

/**
 * 全実行面をスキャン
 */
export function scanExecutionSurfaces(projectRoot: string, config?: ScannerConfig): ExecutionSurface[] {
  const cfg = config ?? DEFAULT_CONFIG
  const surfaces: ExecutionSurface[] = []

  try {
    surfaces.push(...scanHooks(projectRoot, cfg))
    surfaces.push(...scanMcpConfigs(projectRoot, cfg))
    surfaces.push(...scanEmbeddedCommands(projectRoot, cfg))
    surfaces.push(...scanOpenclawGateways(projectRoot, cfg))
    surfaces.push(...scanLocalSkills(projectRoot, cfg))
  } catch (err) {
    log(`[trust-gate] Error scanning execution surfaces: ${err instanceof Error ? err.message : err}`)
  }

  return surfaces
}

/**
 * 実行面があるかチェック（高速判定用）
 */
export function hasExecutionSurfaces(projectRoot: string, config?: ScannerConfig): boolean {
  const cfg = config ?? DEFAULT_CONFIG

  // いずれかのファイルが存在するかチェック
  const filesToCheck = [...cfg.hookFiles, ...cfg.mcpFiles, ...cfg.openclawConfigs]
  for (const file of filesToCheck) {
    if (existsSync(join(projectRoot, file))) {
      return scanExecutionSurfaces(projectRoot, config).length > 0
    }
  }

  // command files check
  for (const pattern of cfg.commandFiles) {
    const parts = pattern.split("/")
    const dirPath = parts.slice(0, -1).join("/")
    const fullDir = join(projectRoot, dirPath)

    try {
      const files = simpleGlob(fullDir, pattern)
      if (files.length > 0) {
        for (const file of files) {
          if (findEmbeddedCommands(file).length > 0) return true
        }
      }
    } catch {
      // ignore
    }
  }

  // skill dirs check
  for (const dir of cfg.skillDirs) {
    if (existsSync(join(projectRoot, dir))) {
      return scanExecutionSurfaces(projectRoot, config).length > 0
    }
  }

  return false
}
