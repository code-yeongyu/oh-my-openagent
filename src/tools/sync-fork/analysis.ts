import { readFileSync, existsSync } from "node:fs"
import { executeCommand } from "../../shared/command-executor"
import { log } from "../../shared/logger"
import { FILE_RISK_HINTS, SECURITY_KEYWORDS } from "./constants"
import type {
  ParsedCommit,
  AIAnalysisResult,
  Priority,
  GitContext,
} from "./types"

export interface AnalysisPacket {
  commit: ParsedCommit
  upstreamDiff: string
  forkContext: string
  riskLevel: "HIGH" | "MEDIUM" | "LOW"
  suggestedPrompt: string
}

async function getCommitDiff(repoRoot: string, sha: string): Promise<string> {
  const cmd = `cd "${repoRoot}" && git show --stat --patch ${sha} | head -500`
  try {
    const result = await executeCommand(cmd)
    return result.replace(/\[stderr:.*\]/g, "").trim()
  } catch {
    return "[Failed to get diff]"
  }
}

async function getForkFileContent(
  repoRoot: string,
  filePath: string
): Promise<string | null> {
  const fullPath = `${repoRoot}/${filePath}`
  if (!existsSync(fullPath)) {
    return null
  }
  try {
    const content = readFileSync(fullPath, "utf-8")
    if (content.length > 10000) {
      return content.slice(0, 10000) + "\n... [truncated]"
    }
    return content
  } catch {
    return null
  }
}

function classifyFileRisk(filePath: string): "HIGH" | "MEDIUM" | "LOW" {
  for (const pattern of FILE_RISK_HINTS.HIGH) {
    if (matchGlobPattern(filePath, pattern)) {
      return "HIGH"
    }
  }
  for (const pattern of FILE_RISK_HINTS.MEDIUM) {
    if (matchGlobPattern(filePath, pattern)) {
      return "MEDIUM"
    }
  }
  return "LOW"
}

function matchGlobPattern(path: string, pattern: string): boolean {
  const regexPattern = pattern
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, ".")
  try {
    return new RegExp(`^${regexPattern}$`).test(path)
  } catch {
    return path.includes(pattern.replace(/\*/g, ""))
  }
}

function getCommitRiskLevel(commit: ParsedCommit): "HIGH" | "MEDIUM" | "LOW" {
  if (commit.type === "security") return "HIGH"
  if (commit.isBreaking) return "HIGH"

  const fileRisks = commit.files.map((f) => classifyFileRisk(f.path))
  if (fileRisks.includes("HIGH")) return "HIGH"
  if (fileRisks.includes("MEDIUM")) return "MEDIUM"
  return "LOW"
}

function hasSecurityKeywords(text: string): boolean {
  const lower = text.toLowerCase()
  return SECURITY_KEYWORDS.some((kw) => lower.includes(kw))
}

export function suggestPriority(commit: ParsedCommit): Priority | "Skip" {
  if (commit.type === "security") return "P0"
  if (hasSecurityKeywords(commit.subject)) return "P0"

  if (commit.type === "fix") {
    const risk = getCommitRiskLevel(commit)
    return risk === "HIGH" ? "P0" : "P1"
  }

  if (commit.type === "perf") return "P2"
  if (commit.type === "feat") return "P2"

  if (commit.type === "docs" || commit.type === "test" || commit.type === "chore") {
    return "P3"
  }

  return "P3"
}

function buildAnalysisPrompt(packet: AnalysisPacket): string {
  const { commit, upstreamDiff, forkContext, riskLevel } = packet

  return `UPSTREAM CHANGE:
- Commit: ${commit.sha}
- Type: ${commit.type}${commit.scope ? ` (${commit.scope})` : ""}
- Message: ${commit.subject}
- Author: ${commit.author}
- Date: ${commit.date}
- Files: ${commit.files.map((f) => f.path).join(", ")}
- Risk Level: ${riskLevel}

DIFF:
\`\`\`
${upstreamDiff.slice(0, 3000)}
\`\`\`

FORK CONTEXT:
${forkContext || "No fork modifications to these files detected."}

EVALUATE:
1. Does this fix a bug our fork might have?
2. Does this add functionality we'd benefit from?
3. Does this conflict with our customizations?
4. What's the risk level of integrating this?

RESPOND IN JSON:
{
  "priority": "P0|P1|P2|P3|Skip",
  "reasoning": "2-3 sentences explaining why",
  "conflictLikelihood": "likely|possible|unlikely",
  "action": "sync_immediately|queue_for_batch|skip",
  "affectedAreas": ["area1", "area2"]
}`
}

export async function prepareAnalysisPackets(
  context: GitContext,
  commits: ParsedCommit[]
): Promise<AnalysisPacket[]> {
  const packets: AnalysisPacket[] = []

  for (const commit of commits) {
    log(`[sync-fork] Preparing analysis packet for ${commit.shortSha}`)

    const upstreamDiff = await getCommitDiff(context.repoRoot, commit.sha)

    let forkContext = ""
    for (const file of commit.files.slice(0, 5)) {
      const content = await getForkFileContent(context.repoRoot, file.path)
      if (content) {
        forkContext += `\n### ${file.path}\n\`\`\`\n${content.slice(0, 2000)}\n\`\`\`\n`
      }
    }

    const riskLevel = getCommitRiskLevel(commit)

    const packet: AnalysisPacket = {
      commit,
      upstreamDiff,
      forkContext: forkContext.trim(),
      riskLevel,
      suggestedPrompt: "",
    }

    packet.suggestedPrompt = buildAnalysisPrompt(packet)
    packets.push(packet)
  }

  return packets
}

export function parseAIResponse(response: string): AIAnalysisResult | null {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      log(`[sync-fork] No JSON found in AI response`)
      return null
    }

    const parsed = JSON.parse(jsonMatch[0])

    const validPriorities = ["P0", "P1", "P2", "P3", "Skip"]
    if (!validPriorities.includes(parsed.priority)) {
      log(`[sync-fork] Invalid priority: ${parsed.priority}`)
      return null
    }

    return {
      commitSha: "",
      priority: parsed.priority,
      reasoning: parsed.reasoning || "No reasoning provided",
      conflictLikelihood: parsed.conflictLikelihood || "possible",
      action: parsed.action || "queue_for_batch",
      affectedAreas: parsed.affectedAreas || [],
    }
  } catch (e) {
    log(`[sync-fork] Failed to parse AI response: ${e}`)
    return null
  }
}

export function createFallbackAnalysis(commit: ParsedCommit): AIAnalysisResult {
  const priority = suggestPriority(commit)
  const riskLevel = getCommitRiskLevel(commit)

  return {
    commitSha: commit.sha,
    priority,
    reasoning: `Auto-classified based on commit type (${commit.type}) and file risk (${riskLevel}).`,
    conflictLikelihood: riskLevel === "HIGH" ? "possible" : "unlikely",
    action: priority === "P0" ? "sync_immediately" : "queue_for_batch",
    affectedAreas: commit.files.map((f) => f.path.split("/").slice(0, 2).join("/")),
  }
}
