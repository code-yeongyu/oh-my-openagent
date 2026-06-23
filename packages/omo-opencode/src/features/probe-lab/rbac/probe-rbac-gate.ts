import type { ProbeLabContext } from "../probe-lab-context"
import { hasPermission } from "./permission-checker"
import { isProbeRole, type ProbeRole } from "./role-definitions"

const CURRENT_ROLE_KEY = "current_role"
const DEFAULT_ROLE: ProbeRole = "admin"

export class RbacDeniedError extends Error {
  readonly tool: string
  readonly role: ProbeRole

  constructor(tool: string, role: ProbeRole) {
    super(`RBAC: role '${role}' is not permitted to call tool '${tool}'`)
    this.name = "RbacDeniedError"
    this.tool = tool
    this.role = role
  }
}

export function readCurrentRole(ctx: ProbeLabContext): ProbeRole {
  const row = ctx.store.getProbeLabConfig(CURRENT_ROLE_KEY)
  if (row?.value && isProbeRole(row.value)) return row.value
  return DEFAULT_ROLE
}

export function enforceRbacGate(ctx: ProbeLabContext, toolName: string): void {
  const role = readCurrentRole(ctx)
  if (hasPermission(role, toolName)) return
  throw new RbacDeniedError(toolName, role)
}
