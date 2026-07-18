import type { RelevantLesson } from "./decision-types"

export interface MemoryRead {
  readonly query: string
  readonly timestampISO: string
  readonly agentmemory: AgentMemoryRead
  readonly magicContext: MagicContextRead
  readonly boulderState: BoulderStateRead
  readonly degradedSources: readonly MemorySource[]
}

export type MemorySource = "agentmemory" | "magicContext" | "boulderState"

export interface AgentMemoryRead {
  readonly available: boolean
  readonly lessons: readonly RelevantLesson[]
  readonly errorMessage?: string
}

export interface MagicContextRead {
  readonly available: boolean
  readonly slots: readonly { readonly label: string; readonly content: string }[]
  readonly errorMessage?: string
}

export interface BoulderStateRead {
  readonly available: boolean
  readonly tasks: readonly { readonly id: string; readonly status: string; readonly title: string }[]
  readonly planProgress: number
  readonly errorMessage?: string
}

export interface OrchestratorAgentmemoryBackend {
  smartSearch(input: {
    readonly query: string
    readonly limit?: number
  }): Promise<{
    readonly lessons: readonly {
      readonly title: string
      readonly content: string
      readonly type: string
      readonly confidence: number
    }[]
    readonly crystals: readonly unknown[]
  }>
}

export interface OrchestratorMagicContextBackend {
  slotList(input: {
    readonly directory?: string
    readonly labelPrefix?: string
  }): Promise<readonly { readonly label: string; readonly content: string }[]>
}

export interface OrchestratorBoulderStateBackend {
  boulderRead(input: {
    readonly directory: string
    readonly sessionID: string
    readonly query?: string
  }): Promise<
    readonly {
      readonly id: string
      readonly title: string
      readonly priority: number
      readonly status: string
      readonly createdAtMs: number
      readonly updatedAtMs: number
    }[]
  >
}

export interface MemoryBackends {
  readonly agentmemory: OrchestratorAgentmemoryBackend
  readonly magicContext: OrchestratorMagicContextBackend
  readonly boulderState: OrchestratorBoulderStateBackend
}
