export type SessionPermissionRule = {
  permission: string
  action: "allow" | "ask" | "deny"
  pattern: string
}

export const QUESTION_DENIED_SESSION_PERMISSION: SessionPermissionRule[] = [
  { permission: "question", action: "deny", pattern: "*" },
]
