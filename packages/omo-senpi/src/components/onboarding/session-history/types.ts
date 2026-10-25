import type { SessionHistoryFs } from "./session-history-fs"

export type AgentSessionSource = "claudeAgent" | "codex"
export type ProjectSource = AgentSessionSource | "omo"

export interface AgentHome {
  readonly source: AgentSessionSource
  readonly homePath: string
}

export interface ImportedProject {
  readonly id: string
  readonly workspaceRoot: string
}

export interface ProjectGit {
  readonly remoteKey: string | null
  readonly repository: string | null
}

export interface ProjectCandidate {
  readonly path: string
  readonly title: string
  readonly projectId?: string
  readonly sources: ReadonlyArray<ProjectSource>
  readonly threadCount: number
  readonly lastActiveAt: string | null
  readonly alreadyImported: boolean
  readonly git: ProjectGit | null
}

export interface ScanCounts {
  readonly found: number
  readonly read: number
  readonly cap: number
}

export interface ProjectScanResult {
  readonly candidates: ReadonlyArray<ProjectCandidate>
  readonly scannedAt: string
  readonly truncated?: true
  readonly counts: ScanCounts
}

export interface AgentSessionThreadMessage {
  readonly role: "user" | "assistant"
  readonly text: string
  readonly createdAt: string
}

export interface AgentSessionThread {
  readonly source: AgentSessionSource
  readonly providerSessionId: string
  readonly title: string
  readonly model: string | null
  readonly createdAt: string
  readonly updatedAt: string
  readonly messages: ReadonlyArray<AgentSessionThreadMessage>
}

export interface TranscriptSource {
  readonly provider: AgentSessionSource
  readonly homePath: string
  readonly providerSessionId: string
  readonly filePath: string
  readonly size: number
  readonly mtimeMs: number | null
  readonly device: number
  readonly inode: number | null
  readonly birthtimeMs: number | null
}

/** A transcript the caller already imported, named by the identity it had then. */
export type CompletedTranscript = Omit<TranscriptSource, "homePath">

export interface SessionToolUse {
  readonly name: string
  readonly count: number
}

export interface SessionDigest {
  readonly sessionKey: string
  readonly source: AgentSessionSource
  readonly providerSessionId: string
  readonly cwd: string
  readonly title: string
  readonly model: string | null
  readonly startedAt: string
  readonly lastActiveAt: string
  readonly messageCount: number
  readonly firstRequest: string
  readonly toolsUsed: ReadonlyArray<SessionToolUse>
  readonly filesChanged: ReadonlyArray<string>
  readonly outcome: string
  readonly truncated: boolean
}

export type RecentSessionOutcome =
  | { readonly _tag: "Importable"; readonly thread: AgentSessionThread; readonly source: TranscriptSource; readonly cwd: string; readonly digest: SessionDigest }
  | { readonly _tag: "AlreadyImported"; readonly source: TranscriptSource }
  | { readonly _tag: "Duplicate"; readonly source: TranscriptSource }
  | { readonly _tag: "Skipped" }

export interface SessionHistoryOptions {
  /** Agent homes to read. Defaults to `CLAUDE_CONFIG_DIR`/`~/.claude` and `CODEX_HOME`/`~/.codex`. */
  readonly homes?: ReadonlyArray<AgentHome>
  /** omo CLI session roots. Defaults to the engine's own sessions directory. */
  readonly omoSessionsRoots?: ReadonlyArray<string>
  readonly importedProjects?: ReadonlyArray<ImportedProject>
  /** App data directories whose subtree is never a project. Defaults to `~/.omo`. */
  readonly excludedDirectories?: ReadonlyArray<string>
  readonly managedWorktreeDirectories?: ReadonlyArray<string>
  readonly homeDir?: string
  readonly tmpDir?: string
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly platform?: NodeJS.Platform
  readonly fs?: SessionHistoryFs
  readonly now?: () => number
}

export interface RecentSessionsQuery {
  /** Restrict to one project; omitted means every non-excluded project. */
  readonly workspaceRoot?: string
  /** How far back a session counts as recent. Defaults to 30 days. */
  readonly recentWindowMs?: number
  /** Transcripts still identical to one of these come back AlreadyImported, unread and outside the read caps. */
  readonly completed?: ReadonlyArray<CompletedTranscript>
}
