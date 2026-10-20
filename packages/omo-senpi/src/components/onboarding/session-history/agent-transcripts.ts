import { homedir } from "node:os"
import { join, resolve } from "node:path"

import {
  MAX_DISCOVERY_OPERATIONS_PER_SOURCE,
  MAX_METADATA_BYTES_PER_SOURCE,
  MAX_METADATA_OPERATIONS_PER_SOURCE,
  MAX_METADATA_RECORDS_PER_SOURCE,
  MAX_TRANSCRIPTS_PER_SOURCE,
} from "./constants"
import { expandHomePath, type ProjectPathRules } from "./project-paths"
import type { SessionHistoryFs } from "./session-history-fs"
import { groupTranscriptsByCwd, type CwdGroup, type MetadataReadBudget } from "./transcript-cwd"
import {
  discoverClaudeTranscripts,
  discoverCodexTranscripts,
  selectMetadataTranscripts,
  type TranscriptCandidate,
} from "./transcript-discovery"
import type { AgentHome, AgentSessionSource } from "./types"

export interface SourceCandidates {
  readonly source: AgentSessionSource
  readonly groups: ReadonlyArray<CwdGroup>
  readonly found: number
  readonly read: number
  readonly truncated: boolean
}

/** `CLAUDE_CONFIG_DIR` or `~/.claude`, and `CODEX_HOME` or `~/.codex`, as each CLI resolves its own home. */
export function defaultAgentHomes(env: Readonly<Record<string, string | undefined>>, homeDir = homedir()): Array<AgentHome> {
  const configured = (value: string | undefined, fallback: string) => {
    const trimmed = value?.trim() ?? ""
    return trimmed.length > 0 ? resolve(expandHomePath(trimmed, homeDir)) : join(homeDir, fallback)
  }
  return [
    { source: "claudeAgent", homePath: configured(env["CLAUDE_CONFIG_DIR"], ".claude") },
    { source: "codex", homePath: configured(env["CODEX_HOME"], ".codex") },
  ]
}

export async function uniqueHomes(rules: ProjectPathRules, homes: ReadonlyArray<AgentHome>, source: AgentSessionSource) {
  const seen = new Set<string>()
  const unique: Array<string> = []
  for (const home of homes) {
    if (home.source !== source) continue
    const homePath = resolve(expandHomePath(home.homePath, rules.homeDir))
    const identity = await rules.directoryIdentity(homePath)
    if (seen.has(identity)) continue
    seen.add(identity)
    unique.push(homePath)
  }
  return unique
}

/** One agent source: shared discovery budget across its homes, newest-first selection, shared metadata budget. */
export async function collectSourceCandidates(input: {
  readonly fs: SessionHistoryFs
  readonly rules: ProjectPathRules
  readonly homes: ReadonlyArray<AgentHome>
  readonly source: AgentSessionSource
}): Promise<SourceCandidates> {
  const homes = await uniqueHomes(input.rules, input.homes, input.source)
  const discover = input.source === "claudeAgent" ? discoverClaudeTranscripts : discoverCodexTranscripts
  const baseBudget = Math.floor(MAX_DISCOVERY_OPERATIONS_PER_SOURCE / Math.max(1, homes.length))
  const extraBudgets = MAX_DISCOVERY_OPERATIONS_PER_SOURCE % Math.max(1, homes.length)
  let truncated = false
  const transcripts: Array<TranscriptCandidate> = []
  for (const [index, homePath] of homes.entries()) {
    const budget = baseBudget + (index < extraBudgets ? 1 : 0)
    if (budget === 0) {
      truncated = true
      continue
    }
    const discovered = await discover(input.fs, homePath, budget)
    truncated ||= discovered.truncated
    transcripts.push(...discovered.transcripts)
  }
  transcripts.sort((left, right) => right.mtimeMs - left.mtimeMs || left.filePath.localeCompare(right.filePath))
  if (transcripts.length > MAX_TRANSCRIPTS_PER_SOURCE) truncated = true
  const selected = selectMetadataTranscripts(transcripts)
  const metadataBudget: MetadataReadBudget = {
    bytesRemaining: MAX_METADATA_BYTES_PER_SOURCE,
    operationsRemaining: MAX_METADATA_OPERATIONS_PER_SOURCE,
    recordsRemaining: MAX_METADATA_RECORDS_PER_SOURCE,
    truncated: false,
  }
  const groups = await groupTranscriptsByCwd(input.fs, selected, metadataBudget)
  return {
    source: input.source,
    groups,
    found: transcripts.length,
    read: selected.length,
    truncated: truncated || metadataBudget.truncated,
  }
}
