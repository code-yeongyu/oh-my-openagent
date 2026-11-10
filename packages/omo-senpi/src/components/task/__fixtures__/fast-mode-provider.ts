import type { ExtensionAPI } from "@code-yeongyu/senpi"
import { assistant, streamMessage } from "../../../../../senpi-task/src/runners/__fixtures__/in-process-fallback-session"

// A local provider for the real RPC engine: no credentials or network requests.
export default function fastModeProvider(pi: ExtensionAPI): void {
  const models = ["gpt-6-luna", "gpt-6-astra"].flatMap((id) => {
    const base = {
      id,
      name: id,
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200_000,
      maxTokens: 4096,
    }
    return [base, { ...base, id: `${id}-fast`, upstreamModelId: id, serviceTier: "priority" }]
  })
  Reflect.apply(pi.registerProvider, pi, ["chatgpt-subscription", {
    api: "openai-codex-responses",
    apiKey: "synthetic-test-key",
    models,
    streamSimple(model: { readonly id: string }) {
      return streamMessage(assistant(model.id, "stop", "OK", undefined, "chatgpt-subscription"))
    },
  }])
}
