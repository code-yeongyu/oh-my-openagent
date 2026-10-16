import { createHash } from "node:crypto"

export class FakeInputAdmissions {
  private readonly records = new Map<string, { fingerprint: string; disposition: string }>()

  admit(sessionPath: string, payload: Readonly<Record<string, unknown>>): { replayed: boolean; disposition: string } | "conflict" {
    const key = `${sessionPath}\0${payload.clientMessageId}`
    const fingerprint = createHash("sha256").update(JSON.stringify({
      type: payload.type, message: payload.message, images: payload.images ?? [], clientTurnId: payload.clientTurnId,
      ...(payload.type !== "prompt" ? {} : {
        streamingBehavior: payload.streamingBehavior, thinkingLevel: payload.thinkingLevel,
        sessionTitlePrompt: payload.sessionTitlePrompt, expandPromptTemplates: payload.expandPromptTemplates ?? true,
        unknownCommandAsText: payload.unknownCommandAsText ?? false,
      }),
    })).digest("hex")
    const prior = this.records.get(key)
    if (prior !== undefined) return prior.fingerprint === fingerprint ? { ...prior, replayed: true } : "conflict"
    const disposition = payload.type === "prompt" && payload.streamingBehavior === undefined ? "started" : "handled"
    this.records.set(key, { fingerprint, disposition })
    return { disposition, replayed: false }
  }

  count(): number { return this.records.size }

  rebind(sessionPath: string, payload: Readonly<Record<string, unknown>>): void {
    this.records.delete(`${sessionPath}\0${payload.clientMessageId}`)
    this.admit(sessionPath, payload)
  }
}
