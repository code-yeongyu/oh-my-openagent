import * as fs from "node:fs"
import * as path from "node:path"
import { getOpenCodeStorageDir } from "../../shared/data-path"

const COMPACTION_LOG_FILE = path.join(getOpenCodeStorageDir(), "compaction.log")

export interface CompactionLogEntry {
  timestamp: string
  sessionID: string
  phase: "triggered" | "dcp" | "truncation" | "decision" | "summarized" | "skipped"
  data: Record<string, unknown>
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function formatTokens(tokens: number): string {
  if (tokens < 1000) return `${tokens}`
  return `${(tokens / 1000).toFixed(1)}k`
}

export function logCompaction(entry: CompactionLogEntry): void {
  try {
    const { timestamp, sessionID, phase, data } = entry
    const shortSessionID = sessionID.slice(0, 8)
    
    let line = `[${timestamp}] [${shortSessionID}] `
    
    switch (phase) {
      case "triggered":
        line += `📊 COMPACTION TRIGGERED\n`
        line += `   ├─ Tokens: ${formatTokens(data.totalUsed as number)} / ${formatTokens(data.contextLimit as number)}\n`
        line += `   ├─ Usage: ${((data.usageRatio as number) * 100).toFixed(1)}%\n`
        line += `   └─ Threshold: ${((data.threshold as number) * 100).toFixed(0)}%\n`
        break
        
      case "dcp":
        line += `🧹 DCP COMPLETED\n`
        line += `   ├─ Items Pruned: ${data.itemsPruned}\n`
        line += `   ├─ Tokens Saved: ${formatTokens(data.tokensSaved as number)}\n`
        if (data.strategies) {
          const s = data.strategies as { deduplication: number; supersedeWrites: number; purgeErrors: number }
          line += `   └─ Breakdown: dedup=${s.deduplication}, supersede=${s.supersedeWrites}, purge=${s.purgeErrors}\n`
        }
        break
        
      case "truncation":
        line += `✂️  TRUNCATION COMPLETED\n`
        line += `   ├─ Outputs Truncated: ${data.truncatedCount}\n`
        line += `   ├─ Bytes Removed: ${formatBytes(data.bytesRemoved as number)}\n`
        line += `   ├─ Tokens Saved: ${formatTokens(data.tokensSaved as number)}\n`
        if (data.tools && (data.tools as string[]).length > 0) {
          line += `   └─ Tools: ${(data.tools as string[]).join(", ")}\n`
        }
        break
        
      case "decision":
        line += `📈 POST-PRUNING STATUS\n`
        line += `   ├─ Original: ${formatTokens(data.originalTokens as number)}\n`
        line += `   ├─ Saved: ${formatTokens(data.tokensSaved as number)}\n`
        line += `   ├─ Current: ${formatTokens(data.currentTokens as number)}\n`
        line += `   ├─ New Usage: ${((data.newUsageRatio as number) * 100).toFixed(1)}%\n`
        line += `   └─ Decision: ${data.needsSummarize ? "⚠️ NEEDS SUMMARIZE" : "✅ SKIP SUMMARIZE"}\n`
        break
        
      case "skipped":
        line += `✅ COMPACTION SKIPPED - Pruning was sufficient\n`
        line += `   └─ Final Usage: ${((data.finalUsageRatio as number) * 100).toFixed(1)}%\n`
        break
        
      case "summarized":
        line += `📝 SUMMARIZATION COMPLETED\n`
        line += `   └─ Session compacted and resumed\n`
        break
    }
    
    line += "\n"
    fs.appendFileSync(COMPACTION_LOG_FILE, line)
  } catch {
    // Silent fail - logging should never break the main flow
  }
}

export function getCompactionLogPath(): string {
  return COMPACTION_LOG_FILE
}

export function clearCompactionLog(): void {
  try {
    fs.writeFileSync(COMPACTION_LOG_FILE, "")
  } catch {
    // Silent fail
  }
}
