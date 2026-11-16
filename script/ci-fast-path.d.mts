export type CiMode = {
  readonly generatedReleasePush: boolean
  readonly webOnly: boolean
  readonly runHeavy: boolean
  readonly fullMatrix: boolean
  readonly runtimeTouching: boolean
  readonly labelRefused: boolean
}

export function isRuntimePath(path: string): boolean
export function classifyCiMode(input: {
  readonly eventName: string
  readonly headCommitMessage: string
  readonly changedPaths: readonly string[]
  readonly diffAvailable: boolean
  readonly mergeParentCount: number
  readonly headRef?: string
  readonly labels?: readonly string[]
  readonly body?: string
}): CiMode
