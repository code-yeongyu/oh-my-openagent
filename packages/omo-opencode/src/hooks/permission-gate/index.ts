export {
  createPermissionGateHook,
  resolveToolPermission,
  writeAuditEntry,
  createSessionPermissionCache,
  type PermissionGateDeps,
} from "./hook"
export type {
  PermissionGateDecision,
} from "./schema"
export {
  setPermissionGateAuditHomedirOverride,
  clearPermissionGateAuditHomedirOverride,
} from "./audit"
export {
  createSessionPermissionCache as createPermissionGateSessionCache,
  sharedSessionPermissionCache,
  resetSessionPermissionCacheForTesting,
} from "./session-cache"
