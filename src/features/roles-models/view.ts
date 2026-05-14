import type { Role, RoleView } from "./types"
import { getOverride } from "./state"

export type BuildViewsOptions = {
  sessionID?: string
}

export function buildViews(roles: Role[], options: BuildViewsOptions = {}): RoleView[] {
  return roles.map((role) => {
    const override = options.sessionID ? getOverride(options.sessionID, role.name) : undefined

    if (override) {
      const matchIndex = role.chain.findIndex(
        (entry) => entry.model === override.model && entry.variant === override.variant,
      )
      return {
        ...role,
        active: override,
        activeIndex: matchIndex,
        activeReason: "pick",
      }
    }

    if (role.primary) {
      return {
        ...role,
        active: role.primary,
        activeIndex: -1,
        activeReason: "primary",
      }
    }

    return {
      ...role,
      active: undefined,
      activeIndex: -1,
      activeReason: "primary",
    }
  })
}
