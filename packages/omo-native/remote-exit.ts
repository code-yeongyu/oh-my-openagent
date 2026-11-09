// `omo remote`'s outcomes: its exit codes, and the refusal of arguments it cannot run.
export const REMOTE_EXIT = { ok: 0, failed: 1, usage: 2, unavailable: 3 } as const

export class UsageError extends Error {}
