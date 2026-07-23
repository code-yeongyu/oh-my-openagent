import type { AgentSessionEvent, SessionEntry } from "@code-yeongyu/senpi"

export type RpcSwitchSessionResult = { readonly cancelled: boolean }

export type RpcEntriesResult = {
  readonly entries: readonly SessionEntry[]
  readonly leafId: string | null
}

export type RpcSpawnSpec = {
  readonly cwd: string
  readonly extensions?: readonly string[]
  readonly memberEnv?: Readonly<Record<string, string>>
}

export type RpcRunnerSpec = {
  readonly task_id: string
  readonly cwd: string
  readonly state_dir: string
  readonly prompt: string
  readonly resumeSessionPath?: string
  // The provider/modelId the child must resolve. A separate OS process cannot share the parent's
  // in-memory registry, so the model is threaded onto the child command line (`--model`).
  readonly model?: string
  // The resolved variant the child must apply as its thinking level (`--thinking`).
  readonly variant?: string
  // Extension entry paths the child must load (`-e`). The child is spawned with `--no-extensions` and
  // then ONLY these are loaded, so a keyless local provider (or a production `-e` extension) the parent
  // registered is reproducible in the detached child without inheriting the parent's whole package set.
  readonly extensions?: readonly string[]
  readonly memberEnv?: Readonly<Record<string, string>>
}

export type ChildEventListener = (event: AgentSessionEvent) => void

export type ChildHandle = {
  readonly task_id: string
  readonly sessionId: string | undefined
  readonly pid: number | undefined
  steer(text: string): Promise<void>
  followUp(text: string): Promise<void>
  abort(): Promise<void>
  subscribe(listener: ChildEventListener): () => void
  waitForIdle(): Promise<void>
  lastAssistantText(): string | undefined
  dispose(): Promise<void>
}

export type ChildExitFacts = {
  readonly pid: number | undefined
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  readonly stderrTail: string
}

export type ChildExitOutcome =
  | { readonly kind: "clean"; readonly facts: ChildExitFacts }
  | { readonly kind: "killed"; readonly facts: ChildExitFacts }
  | { readonly kind: "crashed"; readonly facts: ChildExitFacts }
  | { readonly kind: "spawn_error"; readonly message: string; readonly facts: ChildExitFacts }

export type RunnerErrorFacts = {
  readonly status: "error"
  readonly killed: boolean
  readonly error_message: string
  readonly exit: ChildExitFacts
}

export type TerminateOptions = {
  readonly sigkillDelayMs?: number
}

export type RpcChildHandle = ChildHandle & {
  readonly spawnSpec?: RpcSpawnSpec
  switchSession?(sessionPath: string): Promise<RpcSwitchSessionResult>
  getEntries?(since?: string): Promise<RpcEntriesResult>
  terminate(options?: TerminateOptions): Promise<void>
  exitOutcome(): ChildExitOutcome | undefined
  waitForExit(): Promise<ChildExitOutcome>
  lastSeen(): number | undefined
}
