const EXPLICIT_USER_ABORT_PHRASES = [
  "the user aborted this request",
  "user aborted",
  "aborted by user",
  "aborted by the user",
  "request was aborted",
  "the operation was aborted",
  "operation was aborted",
  "user cancelled",
  "user canceled",
  "cancelled by user",
  "canceled by user",
  "cancelled by the user",
  "canceled by the user",
  "user interrupted",
  "interrupted by user",
] as const

export function isExplicitUserAbortSignal(message: string): boolean {
  const normalized = message.toLowerCase()
  return EXPLICIT_USER_ABORT_PHRASES.some((phrase) => normalized.includes(phrase))
}
