import { randomUUID } from "node:crypto"

import type { AgentToolResult, ToolDefinition } from "@code-yeongyu/senpi"
import { type Static, Type } from "typebox"

import { loadOnboardingScanRuntime } from "./scan-component"
import type { ScanCounts, SessionHistoryOptions, SessionHistoryScanSource } from "./session-history"
import { loadSessionHistoryRuntime, type SessionHistoryRuntimeLoader } from "./session-history-runtime-loader"

export const ONBOARDING_SESSION_HISTORY_TOOL_NAME = "onboarding_session_history"

export const OnboardingSessionHistoryParams = Type.Object(
  {
    workspace_root: Type.Optional(Type.String({ minLength: 1 })),
    recent_days: Type.Optional(Type.Integer({ minimum: 1, maximum: 365 })),
  },
  { additionalProperties: false },
)
export type OnboardingSessionHistoryParams = Static<typeof OnboardingSessionHistoryParams>

export interface SourceSummary {
  readonly counts?: ScanCounts
  readonly error?: string
}

export interface OnboardingSessionHistoryDetails {
  readonly scanId: string
  readonly digestsFile: string
  readonly sources: Readonly<Partial<Record<SessionHistoryScanSource, SourceSummary>>>
  readonly projectCount: number
  readonly digestCount: number
}

export interface CreateOnboardingSessionHistoryToolOptions {
  /** Engine state dir; digests land in `<stateDir>/onboarding/scans/<scanId>/digests.jsonl`. */
  readonly stateDir: string
  /** Test seam: fixture homes, fs, clock. Production uses the module's defaults. */
  readonly scanOptions?: SessionHistoryOptions
  readonly newScanId?: () => string
  /** Test seam; production imports the scan runtime on the first call. */
  readonly loadRuntime?: SessionHistoryRuntimeLoader
}

/**
 * TUI consumer of the engine session-history module. It drives the same `scanSessionHistory` stream the
 * onboarding scan RPC (`omo.onboarding.scan`, #10478) exposes for the `projects` and `sessions` sources, so the
 * TUI and the desktop read one implementation. Read-only, no model call, no network. The tool's body
 * (`session-history-tool-runtime.ts`) ships in the lazy onboarding-scan sidecar; this shell carries its definition.
 */
export function createOnboardingSessionHistoryTool(
  options: CreateOnboardingSessionHistoryToolOptions,
): ToolDefinition<typeof OnboardingSessionHistoryParams, OnboardingSessionHistoryDetails> {
  const newScanId = options.newScanId ?? (() => `tui-${randomUUID()}`)
  const loadRuntime = options.loadRuntime ?? loadSessionHistoryRuntime
  return {
    name: ONBOARDING_SESSION_HISTORY_TOOL_NAME,
    label: "Scan agent session history",
    description:
      "Onboarding: lists this machine's coding-agent projects and recent sessions (Claude Code and other agents' local history) " +
      "with a per-session digest: first request, tools used, files changed, outcome. Programmatic and read-only; " +
      "digests stay on this machine. Use it instead of reading transcript files by hand.",
    parameters: OnboardingSessionHistoryParams,
    exposure: "search",
    searchGroup: "onboarding",
    searchKeywords: ["onboarding", "session archaeology", "previous sessions", "agent history", "projects"],
    allowLazyActivation: true,
    executionMode: "sequential",
    async execute(_toolCallId, params): Promise<AgentToolResult<OnboardingSessionHistoryDetails>> {
      return (await loadOnboardingScanRuntime()).executeOnboardingSessionHistory({
        params,
        stateDir: options.stateDir,
        ...(options.scanOptions === undefined ? {} : { scanOptions: options.scanOptions }),
        scanId: newScanId(),
        loadRuntime,
      })
    },
  }
}
