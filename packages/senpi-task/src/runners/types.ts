import type { AgentSessionEvent } from "@code-yeongyu/senpi"

export type RpcRunnerSpec = {
  readonly task_id: string
  readonly cwd: string
  readonly state_dir: string
  readonly prompt: string
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
  terminate(options?: TerminateOptions): Promise<void>
  exitOutcome(): ChildExitOutcome | undefined
  waitForExit(): Promise<ChildExitOutcome>
  lastSeen(): number | undefined
}
