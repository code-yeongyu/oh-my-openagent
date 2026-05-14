export type ChainEntry = {
  model: string
  variant?: string
}

export type Role = {
  name: string
  primary?: ChainEntry
  chain: ChainEntry[]
}

export type ActiveReason = "primary" | "pick" | "fallback"

export type RoleView = Role & {
  active?: ChainEntry
  activeIndex: number
  activeReason: ActiveReason
}
