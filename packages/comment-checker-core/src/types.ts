export type CheckerEdit = {
  readonly filePath: string
  readonly before: string
  readonly after: string
}

export type ApplyPatchFileMetadata = {
  readonly filePath: string
  readonly movePath?: string
  readonly before: string
  readonly after: string
  readonly type?: string
}

export type ApplyPatchAccumulator = {
  operation: "add" | "update" | "delete"
  filePath: string
  movePath?: string
  oldLines: string[]
  newLines: string[]
}

export type CommentType = "line" | "block" | "docstring"

export interface CommentInfo {
  readonly text: string
  readonly lineNumber: number
  readonly filePath: string
  readonly commentType: CommentType
  readonly isDocstring: boolean
  readonly metadata?: Record<string, string>
}

export interface PendingCall {
  readonly filePath: string
  readonly content?: string
  readonly oldString?: string
  readonly newString?: string
  readonly edits?: readonly { old_string: string; new_string: string }[]
  readonly tool: "write" | "edit" | "multiedit"
  readonly sessionID: string
  readonly timestamp: number
}

export interface FileComments {
  readonly filePath: string
  readonly comments: readonly CommentInfo[]
}

export interface FilterResult {
  readonly shouldSkip: boolean
  readonly reason?: string
}

export type CommentFilter = (comment: CommentInfo) => FilterResult

export interface HookInput {
  readonly session_id: string
  readonly tool_name: string
  readonly transcript_path: string
  readonly cwd: string
  readonly hook_event_name: string
  readonly tool_input: {
    readonly file_path?: string
    readonly content?: string
    readonly old_string?: string
    readonly new_string?: string
    readonly edits?: readonly { old_string: string; new_string: string }[]
  }
  readonly tool_response?: unknown
}

export interface CheckResult {
  readonly hasComments: boolean
  readonly message: string
}

export type SpawnSignal = "SIGTERM" | "SIGKILL"

export type SpawnProcess = {
  readonly stdin: {
    write(input: string): void
    end(): void
  }
  readonly stdout: ReadableStream<Uint8Array>
  readonly stderr: ReadableStream<Uint8Array>
  readonly exited: Promise<number>
  kill(signal: SpawnSignal): void
}

export type SpawnFn = (args: readonly string[]) => SpawnProcess

export interface ResolveCommentCheckerBinaryInput {
  readonly binaryName: string
  readonly cachedBinaryPath: string | null
  readonly existsSync: (path: string) => boolean
  readonly importMetaUrl?: string
  readonly packageName?: string
}

export interface RunCommentCheckerInput {
  readonly hookInput: HookInput
  readonly binaryPath: string | null
  readonly customPrompt?: string
}

export interface RunCommentCheckerOptions {
  readonly spawn: SpawnFn
  readonly existsSync: (path: string) => boolean
  readonly timeoutMs?: number
  readonly killGraceMs?: number
  readonly setTimeoutFn?: typeof setTimeout
  readonly clearTimeoutFn?: typeof clearTimeout
}
