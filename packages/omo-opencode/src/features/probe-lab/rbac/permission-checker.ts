import { ROLE_PERMISSIONS, type ProbeRole } from "./role-definitions"

export function hasPermission(role: ProbeRole, toolName: string): boolean {
  return ROLE_PERMISSIONS.get(role)?.has(toolName) ?? false
}
