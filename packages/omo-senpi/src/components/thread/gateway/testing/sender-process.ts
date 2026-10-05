import { createInterface } from "node:readline"

import { createGatewayEngine } from "../engine"
import { createGatewayStore } from "../store"
import type { GatewayStoreTestHooks } from "../types"

type SenderConfig = {
  readonly agentDir: string
  readonly sender: string
  readonly target: string
  readonly text: string
  readonly hooks: GatewayStoreTestHooks
}

const config = JSON.parse(process.argv[2] ?? "{}") as SenderConfig
const store = createGatewayStore({ agentDir: config.agentDir, _test: config.hooks })
store.onEvent((event) => {
  if (event.kind === "paused") process.stdout.write(`PAUSED ${event.hook}\n`)
})
createInterface({ input: process.stdin }).on("line", (line) => {
  const [command, hook] = line.trim().split(" ")
  if (command === "RESUME" && (hook === "beforeDbCommit" || hook === "afterDbCommit")) store.resume(hook)
})
const engine = createGatewayEngine({
  store,
  endpoints: {
    wake: async () => {
      throw new Error("the sender process never wakes; the receiver's inbox watch does")
    },
  },
  resolve: async () => ({ kind: "ok", target: { durable_id: config.target, endpoint: null, liveness: "dead" } }),
})
const result = await engine.deliver({ sender: { kind: "session", durable_id: config.sender }, target: config.target, text: config.text })
process.stdout.write(`DONE ${JSON.stringify(result)}\n`)
await store.dispose()
process.exit(0)
