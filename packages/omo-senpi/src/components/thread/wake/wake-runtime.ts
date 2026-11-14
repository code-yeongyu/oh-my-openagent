import type { GatewayStore } from "../gateway/store"
import type { SameDeviceWake } from "../gateway/same-device-wake"
import {
  processIntakeAdmission,
  processSameDeviceWake,
  startThreadWakeAtSession,
  wakeHostIdleExitMs,
  wakeSettingsReader,
  type ThreadWakeOptions,
} from "./runtime"

/**
 * The wake's sidecar entry (extensions/omo-wake.js): everything the session wake of #13037 pulls in - the carrier and
 * its host connection, the delivery consumer and its device-service client - loads only when a session first needs it,
 * so the main bundle carries nothing of it. The thread component reaches this module through `#omo-wake-runtime` and
 * keeps only lazy shells of the three calls it needs.
 */

export type WakeAtSessionInput = {
  readonly options: ThreadWakeOptions
  readonly agentDir: () => string
  readonly sessionsDirectory: () => string
  /** The caller's workspace root: the fallback cwd every non-target read (such as `wake_limit`) uses. */
  readonly cwd: () => string
  readonly engineVersion: string | undefined
  readonly ensureHost: (() => Promise<void>) | undefined
  readonly warn: (line: string) => void
}

export function startWakeAtSession(eventCtx: unknown, input: WakeAtSessionInput): void {
  startThreadWakeAtSession(eventCtx, {
    options: input.options,
    agentDir: input.agentDir,
    sessionsDirectory: input.sessionsDirectory,
    settings: wakeSettingsReader(input.options, input.cwd, input.warn),
    engineVersion: input.engineVersion,
    hostIdleExitMs: wakeHostIdleExitMs(input.options, input.cwd, input.warn),
    ensureHost: input.ensureHost,
    warn: input.warn,
  })
}

export function createSameDeviceWake(input: {
  readonly options: ThreadWakeOptions
  readonly store: GatewayStore
  readonly agentDir: () => string
  readonly sessionsDirectory: () => string
  readonly cwd: () => string
  readonly warn: (line: string) => void
}): SameDeviceWake {
  return processSameDeviceWake({
    options: input.options,
    store: input.store,
    agentDir: input.agentDir,
    sessionsDirectory: input.sessionsDirectory,
    settings: wakeSettingsReader(input.options, input.cwd, input.warn),
  })
}

export function intakeAdmission(
  options: ThreadWakeOptions,
  agentDir: () => string,
): (device: string) => Promise<"admitted" | "refused" | "unknown"> {
  return processIntakeAdmission(options, agentDir)
}
