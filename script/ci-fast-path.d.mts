import type { InvocationCoverage } from "./ci-platform-invocations.mjs"

export type CiMode = {
  readonly generatedReleasePush: boolean
  readonly webOnly: boolean
  readonly runHeavy: boolean
  readonly fullMatrix: boolean
  readonly runtimeTouching: boolean
}

export function isRuntimePath(path: string): boolean
export function isPlatformSensitivePath(path: string, invocationCoverage: readonly InvocationCoverage[]): boolean
export function classifyCiMode(input: {
  readonly eventName: string
  readonly headCommitMessage: string
  readonly changedPaths: readonly string[]
  readonly diffAvailable: boolean
  readonly mergeParentCount: number
  readonly headRef?: string
  readonly labels?: readonly string[]
  readonly invocationCoverage?: readonly InvocationCoverage[]
}): CiMode
