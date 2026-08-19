export type SessionPermissionRule = {
  permission: string
  action: "allow" | "deny"
  pattern: string
}

export const QUESTION_DENIED_SESSION_PERMISSION: SessionPermissionRule[] = [
  { permission: "question", action: "deny", pattern: "*" },
]

export const READ_ONLY_SESSION_PERMISSION: SessionPermissionRule[] = [
  ...QUESTION_DENIED_SESSION_PERMISSION,
  { permission: "edit", action: "deny", pattern: "*" },
]

export const READ_ONLY_STRICT_SESSION_PERMISSION: SessionPermissionRule[] = [
  ...READ_ONLY_SESSION_PERMISSION,
  { permission: "bash", action: "deny", pattern: "*" },
]
