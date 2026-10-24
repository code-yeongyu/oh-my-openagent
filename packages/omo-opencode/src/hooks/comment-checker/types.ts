export type {
  ApplyPatchAccumulator,
  ApplyPatchFileMetadata,
  CheckResult,
  CheckerEdit,
  CommentFilter,
  CommentInfo,
  CommentType,
  FileComments,
  FilterResult,
  HookInput,
  ResolveCommentCheckerBinaryInput,
  RunCommentCheckerInput,
  RunCommentCheckerOptions,
  SpawnFn,
  SpawnProcess,
  SpawnSignal,
} from "@oh-my-opencode/comment-checker-core"

import type { PendingCall as CorePendingCall } from "@oh-my-opencode/comment-checker-core"

/** `previousContent` is the file text a `write` replaces, read before the write runs. */
export type PendingCall = CorePendingCall & { readonly previousContent?: string }
