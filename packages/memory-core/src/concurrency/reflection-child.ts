import { buildIdentityPaths, type MemoryIdentity } from "../identity"
import { ReflectionReservationStore } from "../reflection/reservation"

const [memoryRoot, identityId, runId] = process.argv.slice(2)
if (memoryRoot === undefined || identityId === undefined || runId === undefined) {
  throw new Error("missing reflection child arguments")
}

let buffered = ""
const messages: string[] = []
const waiters: Array<() => void> = []
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk: string) => {
  buffered += chunk
  for (;;) {
    const newline = buffered.indexOf("\n")
    if (newline < 0) break
    messages.push(buffered.slice(0, newline))
    buffered = buffered.slice(newline + 1)
    waiters.shift()?.()
  }
})
process.stdin.resume()

async function waitForMessage(expected: string): Promise<void> {
  for (;;) {
    const index = messages.indexOf(expected)
    if (index >= 0) {
      messages.splice(index, 1)
      return
    }
    await new Promise<void>((resolve) => waiters.push(resolve))
  }
}

const identity: MemoryIdentity = {
  id: identityId,
  safeSlug: identityId,
  paths: buildIdentityPaths(memoryRoot, identityId),
}
const store = new ReflectionReservationStore({
  identity,
  config: {},
  getJournal: async (conversationId) => {
    throw new Error(`unexpected journal access: ${conversationId}`)
  },
  createRunId: () => runId,
})

process.stdout.write("ready\n")
await waitForMessage("go")
const result = await store.tryReserve({
  trigger: "manual",
  conversationIds: [],
  snapshots: [],
  focus: runId,
})
process.stdout.write(`result:${JSON.stringify(result)}\n`)
process.stdin.pause()
