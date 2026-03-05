export function buildCheckpointPrompt(stats: {
  messagesSinceCheckpoint: number
  minutesSinceCheckpoint: number
}): string {
  return [
    `<system-reminder>`,
    `[AUTO-CHECKPOINT] Session has ${stats.messagesSinceCheckpoint} messages since last checkpoint (${stats.minutesSinceCheckpoint}min ago).`,
    `Run session_checkpoint now to preserve context in case of crash.`,
    `Include: current todos, active files, key decisions, and a brief summary of work in progress.`,
    `</system-reminder>`,
  ].join("\n")
}

export function buildRestorePrompt(): string {
  return [
    `<system-reminder>`,
    `[SESSION RECOVERY] This appears to be a fresh session. A previous checkpoint may exist.`,
    `Run session_restore to recover context from your last session.`,
    `If no checkpoint exists, this will be a no-op.`,
    `</system-reminder>`,
  ].join("\n")
}
