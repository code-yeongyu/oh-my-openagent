import type { Decision, Deviation } from "./decision-types"
import type { MemoryRead } from "./memory-types"

export interface ClosedLoopConfig {
  readonly enabled: boolean
  readonly minSeverityToLearn: "leve" | "media" | "grave"
  readonly maxLessonsPerSession: number
  readonly saveDecisions: boolean
}

export interface MemoryDecision {
  readonly id: string
  readonly timestampISO: string
  readonly action: Decision["action"]
  readonly score: number
  readonly reasoning: string
  readonly sessionID: string
  readonly directory: string
  readonly deviations: readonly Deviation[]
}

export interface LessonLearned {
  readonly id: string
  readonly title: string
  readonly content: string
  readonly type: "pattern" | "bug" | "architecture" | "workflow"
  readonly concepts: readonly string[]
  readonly confidence: number
  readonly files: readonly string[]
  readonly sessionID: string
}

export interface AgentmemoryWriteBackend {
  saveMemory(input: {
    readonly content: string
    readonly concepts: readonly string[]
    readonly type: string
    readonly files?: readonly string[]
  }): Promise<{ readonly id: string }>

  saveLesson(input: {
    readonly content: string
    readonly context: string
    readonly confidence?: number
    readonly tags?: readonly string[]
  }): Promise<{ readonly id: string }>
}

export interface LearnFromOutcomeInput {
  readonly decision: Decision
  readonly memoryRead: MemoryRead
  readonly config: ClosedLoopConfig
  readonly sessionID: string
  readonly directory: string
  readonly filesChanged: readonly string[]
}

export interface LearnFromOutcomeOutput {
  readonly lessonSaved: LessonLearned | null
  readonly decisionSaved: MemoryDecision | null
  readonly reason: string
}
