// Discriminates the team-mailbox send failures the tool layer maps to structured results. team-core's
// mailbox errors carry a stable `.name` but are not all re-exported, so the tool layer keys on the
// name rather than importing every class (keeps the tools free of a direct team-mailbox dependency).
export type MailboxErrorKind =
  | "recipient_backpressure"
  | "invalid_recipient"
  | "payload_too_large"
  | "broadcast_denied"
  | "team_deleting"

const MAILBOX_ERROR_NAMES: Readonly<Record<string, MailboxErrorKind>> = {
  RecipientBackpressureError: "recipient_backpressure",
  InvalidRecipientError: "invalid_recipient",
  PayloadTooLargeError: "payload_too_large",
  BroadcastNotPermittedError: "broadcast_denied",
  TeamDeletingError: "team_deleting",
}

export function classifyMailboxError(error: unknown): MailboxErrorKind | undefined {
  if (!(error instanceof Error)) return undefined
  return MAILBOX_ERROR_NAMES[error.name]
}

export function isMissingStateError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "ENOENT"
}
