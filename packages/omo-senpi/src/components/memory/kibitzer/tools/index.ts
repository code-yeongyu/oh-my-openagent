// The resident Kibitzer's tool surface. Every tool is a member-scoped closure (never a builtin
// passthrough): senpi withholds its builtin grep from children, and only closures can enforce the
// output caps, the per-wake budget, and redaction. The registry is normative - exactly these five
// names, no aliases, no write capability of any kind.

import type { GitMemoryRepo, RecallCorpusCache, RecallNudge } from "@oh-my-opencode/memory-core"

import type { WakeToolBudget } from "./budget"
import { resolveKibitzerToolCaps, type KibitzerToolCaps } from "./caps"
import { createKibitzerGrepTool, KIBITZER_GREP_TOOL_NAME } from "./grep"
import { createKibitzerMemoryTool, KIBITZER_MEMORY_TOOL_NAME } from "./memory"
import { createKibitzerSidecarNudgeTool, KIBITZER_NUDGE_TOOL_NAME } from "./nudge"
import { createKibitzerReadTool, KIBITZER_READ_TOOL_NAME } from "./read"
import type { AnyKibitzerSidecarTool } from "./result"
import { createKibitzerSessionEntriesTool, KIBITZER_SESSION_ENTRIES_TOOL_NAME, type SessionBranchSnapshot } from "./session-read"

export { createWakeToolBudget, type WakeToolBudget } from "./budget"
export { DEFAULT_KIBITZER_TOOL_CAPS, type KibitzerToolCaps } from "./caps"
export { MemoryToolOperations } from "./memory"
export type { AnyKibitzerSidecarTool, KibitzerRejection, KibitzerRejectionCode, KibitzerSidecarTool, KibitzerToolResult } from "./result"
export { createSessionBranchSnapshot, HIDDEN_SESSION_CUSTOM_TYPES, type SessionBranchSnapshot } from "./session-read"

export const KIBITZER_SIDECAR_TOOL_NAMES = [
  KIBITZER_READ_TOOL_NAME,
  KIBITZER_GREP_TOOL_NAME,
  KIBITZER_SESSION_ENTRIES_TOOL_NAME,
  KIBITZER_MEMORY_TOOL_NAME,
  KIBITZER_NUDGE_TOOL_NAME,
] as const

export type KibitzerSidecarToolName = (typeof KIBITZER_SIDECAR_TOOL_NAMES)[number]

export interface KibitzerSidecarToolsInput {
  /** The primary agent's working directory; `read` and `grep` never leave it. */
  readonly workspaceRoot: string
  /** Parent-maintained branch snapshot, refreshed synchronously at every hook. */
  readonly session: Pick<SessionBranchSnapshot, "entries">
  readonly memory: {
    readonly repo: GitMemoryRepo
    readonly cache?: RecallCorpusCache
  }
  readonly nudge: {
    readonly offered: ReadonlySet<string>
    readonly surfaced: ReadonlySet<string>
    readonly maxItems: number
    readonly accepted: () => RecallNudge[]
  }
  /** The CURRENT wake's budget; the lifecycle swaps it per wake. */
  readonly budget: () => WakeToolBudget
  readonly caps?: Partial<KibitzerToolCaps>
}

export interface KibitzerSidecarTools {
  /** Exactly KIBITZER_SIDECAR_TOOL_NAMES, in that order, for ChildSpec.memberScopedTools. */
  readonly tools: readonly AnyKibitzerSidecarTool[]
  /** Corpus-verified paths returned by memory search this lifetime (nudge-eligible). */
  readonly searchedPaths: ReadonlySet<string>
}

export function createKibitzerSidecarTools(input: KibitzerSidecarToolsInput): KibitzerSidecarTools {
  const caps = resolveKibitzerToolCaps(input.caps)
  const searchedPaths = new Set<string>()
  const tools: readonly AnyKibitzerSidecarTool[] = [
    createKibitzerReadTool({ workspaceRoot: input.workspaceRoot, caps, budget: input.budget }),
    createKibitzerGrepTool({ workspaceRoot: input.workspaceRoot, caps, budget: input.budget }),
    createKibitzerSessionEntriesTool({ session: input.session, caps, budget: input.budget }),
    createKibitzerMemoryTool({
      repo: input.memory.repo,
      ...(input.memory.cache === undefined ? {} : { cache: input.memory.cache }),
      caps,
      budget: input.budget,
      searchedPaths,
    }),
    createKibitzerSidecarNudgeTool({ ...input.nudge, searched: searchedPaths, budget: input.budget }),
  ]
  return { tools, searchedPaths }
}
