import type { CheckResult, CommentCheckerReleaseAsset, RunCommentCheckerInput } from "@oh-my-opencode/comment-checker-core"

import type { ComponentContext } from "../../extension/types"

export interface CommentCheckerComponentOptions {
  resolveBinary?: () => string | null
  /** Runs once per session when {@link resolveBinary} finds nothing; null keeps the component disabled. */
  downloadBinary?: (logger: ComponentContext["logger"]) => Promise<string | null>
  runCommentChecker?: (input: RunCommentCheckerInput) => Promise<CheckResult>
}

export interface SenpiCommentCheckerBinaryResolverOptions {
  readonly env?: Record<string, string | undefined>
  readonly existsSync?: (path: string) => boolean
  readonly importMetaUrl?: string
  readonly requireModule?: (moduleName: string) => unknown
  readonly pathLookup?: (binaryName: string) => string | null | undefined
  readonly platform?: NodeJS.Platform
  readonly cacheDir?: string
}

export interface SenpiCommentCheckerDownloadOptions {
  readonly logger: ComponentContext["logger"]
  readonly platform?: NodeJS.Platform
  readonly arch?: string
  readonly cacheDir?: string
  /** Tests point the pinned asset at a local server; production downloads from the release URL. */
  readonly resolveAssetUrl?: (asset: CommentCheckerReleaseAsset) => string
}

export type ToolResultTextBlock = { type: "text"; text: string }
export type ToolResultContentBlock = ToolResultTextBlock | Record<string, unknown>

export interface ToolResultEventLike {
  type: "tool_result"
  toolCallId: string
  toolName: string
  input: Record<string, unknown>
  content: ToolResultContentBlock[]
  details?: unknown
  isError: boolean
}

export interface ToolResultContextLike {
  cwd: string
  sessionManager?: {
    getSessionId?: () => string
    getSessionFile?: () => string | undefined
  }
}

export interface BinaryResolutionState {
  logger: ComponentContext["logger"]
  cachedBinaryPath: string | null | undefined
  inertForSession: boolean
  missingBinaryNoticeLogged: boolean
}
