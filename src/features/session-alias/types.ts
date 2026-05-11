export interface SessionAliasEntry {
  alias: string
  session_id: string
  created_at: number
  note?: string
}

export interface SessionAliasFile {
  version: 1
  aliases: Record<string, SessionAliasEntry>
}

export const SESSION_ID_PREFIX = "ses_"
export const ALIAS_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}[a-z0-9]$|^[a-z0-9]$/i
export const MAX_ALIAS_LENGTH = 64
export const MAX_NOTE_LENGTH = 256
