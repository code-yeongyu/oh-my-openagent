/** Where a rung of a category's or agent's chain was declared. */
export type ChainRungSource = "built-in" | "omo.json" | `category:${string}`

/**
 * What the spawn resolver does with a rung right now: `primary` and `fallback` are the runtime
 * chain in order; the rest never run, because `exclude_models` keeps the model out, none of the
 * rung's providers has a login, or the resolver never reaches it (a rung ahead of the selected one,
 * or one after a user pin outside the builtin chain).
 */
export type ChainRungState = "primary" | "fallback" | "excluded" | "no-login" | "not-reached"

export type ChainRung = {
  readonly model: string
  readonly source: ChainRungSource
  readonly state: ChainRungState
  /** For a `no-login` builtin rung: the providers any one of which would serve it. */
  readonly providers?: readonly string[]
  /** For an `excluded` rung: the `exclude_models` entry that matched. */
  readonly excludedBy?: string
}

export type ModelChainEntry = {
  readonly kind: "category" | "agent"
  readonly name: string
  readonly status: "resolved" | "unavailable" | "disabled"
  /** The model a spawn runs first; absent unless `status` is `resolved`. */
  readonly primary?: string
  /** The runtime retry chain in order, primary first; empty unless `status` is `resolved`. */
  readonly runtime: readonly string[]
  /** Every declared rung in declaration order, each with its source and state. */
  readonly rungs: readonly ChainRung[]
  /** Why a non-resolved entry has no model. */
  readonly reason?: string
}

export type ModelChainsReport = {
  readonly excludeModels: readonly string[]
  readonly categories: readonly ModelChainEntry[]
  readonly agents: readonly ModelChainEntry[]
}
