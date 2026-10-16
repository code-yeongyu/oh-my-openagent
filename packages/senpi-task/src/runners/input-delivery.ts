import { InputUncertainError, type InputEffects } from "./input-effects"
import { isBusyChildRejection, type RpcStreamingBehavior } from "./rpc/delivery-semantics"

/** One queueing policy for identified inputs on either transport. A busy refusal is not an admission. */
export function createInputDelivery(input: {
  readonly effects: InputEffects
  readonly beginTurn: () => void
  readonly promptFailed: (error: unknown) => void
}) {
  const prompt = async (message: string, streamingBehavior: RpcStreamingBehavior): Promise<void> => {
    try {
      await input.effects.send({ type: "prompt", message, streamingBehavior })
    } catch (error) {
      if (streamingBehavior === "followUp" || !isBusyChildRejection(error)) throw error
      await input.effects.send({ type: "prompt", message, streamingBehavior: "followUp" })
    }
  }
  return {
    prompt,
    async runPrompt(message: string, streamingBehavior: RpcStreamingBehavior = "steer"): Promise<void> {
      input.beginTurn()
      try {
        await prompt(message, streamingBehavior)
      } catch (error) {
        if (!(error instanceof InputUncertainError)) input.promptFailed(error)
        throw error
      }
    },
    async steer(message: string): Promise<void> {
      input.beginTurn()
      try {
        await input.effects.send({ type: "steer", message })
      } catch (error) {
        if (!isBusyChildRejection(error)) throw error
        await prompt(message, "followUp")
      }
    },
  }
}
