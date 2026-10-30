import { InputUncertainError, type InputEffects } from "./input-effects"
import { isBusyChildRejection, type RpcStreamingBehavior } from "./rpc/delivery-semantics"

/** One queueing policy for identified inputs on either transport. A busy refusal is not an admission. */
export function createInputDelivery(input: {
  readonly effects: InputEffects
  readonly beginTurn: () => void
  readonly promptFailed: (error: unknown) => void
}) {
  // A caller's own id travels with the input; a busy refusal admitted nothing, so its fallback keeps it.
  const prompt = async (message: string, streamingBehavior: RpcStreamingBehavior, clientMessageId?: string): Promise<void> => {
    const identity = clientMessageId === undefined ? {} : { clientMessageId }
    try {
      await input.effects.send({ type: "prompt", message, streamingBehavior, ...identity })
    } catch (error) {
      if (streamingBehavior === "followUp" || !isBusyChildRejection(error)) throw error
      await input.effects.send({ type: "prompt", message, streamingBehavior: "followUp", ...identity })
    }
  }
  return {
    prompt,
    async runPrompt(message: string, streamingBehavior: RpcStreamingBehavior = "steer", clientMessageId?: string): Promise<void> {
      input.beginTurn()
      try {
        await prompt(message, streamingBehavior, clientMessageId)
      } catch (error) {
        if (!(error instanceof InputUncertainError)) input.promptFailed(error)
        throw error
      }
    },
    async steer(message: string, clientMessageId?: string): Promise<void> {
      input.beginTurn()
      try {
        await input.effects.send({ type: "steer", message, ...(clientMessageId === undefined ? {} : { clientMessageId }) })
      } catch (error) {
        if (!isBusyChildRejection(error)) throw error
        await prompt(message, "followUp", clientMessageId)
      }
    },
  }
}
