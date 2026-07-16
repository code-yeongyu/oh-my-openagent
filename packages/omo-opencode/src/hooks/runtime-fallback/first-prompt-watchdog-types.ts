export type WatchdogEventDecision =
  | { readonly kind: "defer-terminal"; readonly sessionID: string }
  | { readonly kind: "inspect-terminal"; readonly sessionID: string }
  | { readonly kind: "resolve-terminal"; readonly sessionID: string }

export type ArmedWatchdog = {
  readonly sessionID: string
  readonly model: string | undefined
  readonly agent: string | undefined
  readonly wasSubagent: boolean
  readonly generation: number
  readonly sessionGeneration: number
  readonly deadlineAt: number
}
