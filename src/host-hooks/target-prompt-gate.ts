export type TargetPromptSender = (message: string) => void | Promise<void>

export class TargetPromptGate {
  private readonly recent = new Map<string, number>()
  private readonly inFlight = new Set<string>()

  constructor(
    private readonly send: TargetPromptSender,
    private readonly holdMs = 2_000,
  ) {}

  async dispatch(sessionID: string, source: string, message: string): Promise<"dispatched" | "coalesced"> {
    const key = `${sessionID}:${source}:${message}`
    const now = Date.now()
    if (this.inFlight.has(key) || (this.recent.get(key) ?? 0) > now) return "coalesced"
    this.inFlight.add(key)
    try {
      await this.send(message)
      this.recent.set(key, Date.now() + this.holdMs)
      return "dispatched"
    } finally {
      this.inFlight.delete(key)
    }
  }
}
