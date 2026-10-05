import type {
  MemoryIdentity,
  ReflectionFailureSignal,
  ReflectionOutcome,
  ReflectionParkTransition,
  ReflectionTranscriptState,
  ReservedRun,
} from "@oh-my-opencode/memory-core"
import type { SenpiModelPort, SenpiModelRegistryPort } from "@oh-my-opencode/senpi-task"

import type { SenpiOmoConfigResult } from "../../config-resolution"
import type { ComponentLogger } from "../../../extension/types"
import type { ReflectionCompletionRecord, ReflectionLiveSession } from "./completion"
import type { ResolveAndPreflightMemoryLaunch } from "./memory-launch-preflight"
import type { ReflectionSessionModel, ReflectionThinkingLevel } from "./resolve-model"
import type { ReflectionSandbox } from "./spawn"

export interface ReflectionReservationLockOptions {
  readonly waitTimeoutMs?: number
}

export interface ReflectionReservationCompleteOptions extends ReflectionReservationLockOptions {
  readonly failure?: ReflectionFailureSignal
}

export interface ReflectionReservationPort {
  readState(options?: ReflectionReservationLockOptions): Promise<{ readonly active?: ReservedRun }>
  complete(
    runId: string,
    outcome: ReflectionOutcome,
    options?: ReflectionReservationCompleteOptions,
  ): Promise<{ readonly outcome: ReflectionOutcome; readonly launch?: ReservedRun; readonly park?: ReflectionParkTransition }>
}

export interface ReflectionRunResult {
  readonly runId: string
  readonly outcome: ReflectionOutcome
  readonly reason?: string
  readonly detail?: string
  readonly completion: ReflectionCompletionRecord
  readonly launch?: ReservedRun
  readonly park?: ReflectionParkTransition
}

export interface ReflectionRunner {
  launch(request: ReservedRun): Promise<ReflectionRunResult>
}

export interface SenpiSubprocessRunnerOptions {
  readonly identity: MemoryIdentity
  readonly reservation: ReflectionReservationPort
  readonly logger?: ComponentLogger
  readonly resolveModelRegistry: () => SenpiModelRegistryPort<SenpiModelPort> | undefined
  readonly resolveSessionModel?: () => ReflectionSessionModel | undefined
  readonly resolveParentContextTokens?: () => number | undefined
  readonly resolveParentSessionFile?: () => string | undefined
  readonly resolveParentCacheReusable?: () => boolean
  readonly loadConfig?: (options?: { readonly cwd?: string }) => SenpiOmoConfigResult
  readonly cwd?: string
  readonly env?: NodeJS.ProcessEnv
  readonly deadlineMs?: number
  readonly terminationGraceMs?: number
  readonly maxOutputBytes?: number
  readonly sandbox?: ReflectionSandbox
  readonly liveSession?: () => ReflectionLiveSession | undefined
  readonly getTranscriptState?: (conversationId: string) => Promise<ReflectionTranscriptState>
  readonly now?: () => Date
  readonly senpiCommand?: string
  readonly senpiPrefixArgs?: readonly string[]
  readonly resolveAndPreflightLaunch?: ResolveAndPreflightMemoryLaunch
  readonly supervisorPath?: string
  readonly withWriterLock?: <T>(operation: () => Promise<T>) => Promise<T>
}

export type ExecutionResult = {
  readonly outcome: ReflectionOutcome
  readonly reason?: string
  readonly detail?: string
  readonly model?: string
  readonly thinking?: ReflectionThinkingLevel
}
