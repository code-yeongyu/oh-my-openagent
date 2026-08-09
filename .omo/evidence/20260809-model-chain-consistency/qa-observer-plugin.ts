import { appendFileSync } from "node:fs"

const logPath = process.env.QA_OBSERVER_LOG

function record(value: unknown): void {
  if (logPath) appendFileSync(logPath, `${JSON.stringify(value)}\n`)
}

export default {
  id: "model-chain-qa-observer",
  async server() {
    return {
      event: async ({ event }: { event: { type: string; properties?: unknown } }) => {
        if (event.type === "session.error") record({ type: "event", event })
      },
      "chat.params": async (input: unknown, output: unknown) => {
        record({ type: "chat.params", input, output })
      },
    }
  },
}
