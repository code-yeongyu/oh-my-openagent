export type AuditLogEntry = {
  id: number
  entity_type: string
  entity_id: string
  action: string
  actor: string
  changes: string | null
  reason: string | null
  session_context: string | null
  created_at: number
}

export type NewAuditLogInput = {
  entity_type: string
  entity_id: string
  action: string
  actor?: string
  changes?: unknown | null
  reason?: string | null
  session_context?: unknown | null
}

export type AuditLogFilters = {
  entity_type?: string
  entity_id?: string
  action?: string
  since?: number
  until?: number
}
