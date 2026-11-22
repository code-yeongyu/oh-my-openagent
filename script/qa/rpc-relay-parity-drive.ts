// The driver of the live relay parity sweep (#13478), run through script/qa/rpc-relay-parity-live.ts: starts the local
// leg on the target device and the relay leg on the second device (each command must run `rpc-relay-parity-live.ts leg
// local|relay` there, e.g. through ssh or docker exec), walks the pinned engine's method table with
// script/rpc-relay-parity-sweep.ts, and writes <out>.json and <out>.md.
import { writeFileSync } from "node:fs"
import { parseArgs } from "node:util"
import type { Answer } from "../rpc-relay-parity-compare"
import { engineMethodClasses } from "../rpc-relay-parity"
import { type MethodResult, renderSweep, type SweepLeg, sweepMethods, verdictLine } from "../rpc-relay-parity-sweep"
import { type JsonRecord, readRecords } from "./rpc-relay-parity-lines"

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    device: { type: "string" },
    local: { type: "string" },
    relay: { type: "string" },
    out: { type: "string" },
    label: { type: "string", default: "" },
  },
})
if (!values.device || !values.local || !values.relay || !values.out) {
  console.error(
    "usage: rpc-relay-parity-live.ts --device <id> --local '<cmd>' --relay '<cmd>' --out <prefix> [--label <text>]",
  )
  process.exit(2)
}

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** One leg process: requests on stdin, one answer line per request, in order. */
function startLeg(command: string) {
  const child = Bun.spawn(["bash", "-c", command], { stdin: "pipe", stdout: "pipe", stderr: "inherit" })
  const waiting = new Map<number, (answer: JsonRecord) => void>()
  let seq = 0
  void readRecords(child.stdout, (line) => {
    if (typeof line["seq"] === "number") waiting.get(line["seq"])?.(line)
  })
  const call = (request: JsonRecord): Promise<JsonRecord> =>
    new Promise((resolve, reject) => {
      const id = ++seq
      waiting.set(id, (line) => {
        waiting.delete(id)
        if (line["ok"] === true) resolve(line)
        else reject(new Error(`${String(request["op"])}: ${String(line["error"])}`))
      })
      child.stdin.write(`${JSON.stringify({ ...request, seq: id })}\n`)
      child.stdin.flush()
    })
  return { call, end: () => child.stdin.end(), exited: child.exited }
}

const ANSWER_KINDS: ReadonlySet<unknown> = new Set(["reply", "outcome", "refused", "no_reply"])
// A leg writes each answer as one JSON line built from an Answer; the kind is the one field the driver branches on.
const isAnswer = (value: unknown): value is Answer => isRecord(value) && ANSWER_KINDS.has(value["kind"])

const aliases = new Map<string, string>()
const learn = (table: unknown) => {
  if (isRecord(table))
    for (const [raw, alias] of Object.entries(table)) if (!raw.includes(":")) aliases.set(raw, String(alias))
}
// Sessions the sweep's own records made (open_session, clone, new_session...): closed at teardown.
const minted = new Set<string>()
const remember = (answer: Answer) => {
  if (answer.kind !== "reply" || !isRecord(answer.reply["data"])) return
  const id = answer.reply["data"]["sessionId"]
  if (typeof id === "string" && !aliases.has(id)) minted.add(id)
}

const contextOf = (setup: JsonRecord): JsonRecord => (isRecord(setup["context"]) ? setup["context"] : {})

const local = startLeg(values.local)
const relay = startLeg(values.relay)
const leg = (process: ReturnType<typeof startLeg>, context: JsonRecord): SweepLeg => ({
  context: { sessionId: String(context["sessionId"]) },
  send: async (route, record) => {
    const line = await process.call({ op: "send", route, record })
    const answer = line["answer"]
    if (!isAnswer(answer)) throw new Error(`${route} ${String(record["type"])}: the leg answered no answer`)
    remember(answer)
    return answer
  },
})

const started = new Date().toISOString()
const onResult = (result: MethodResult) => console.error(`${result.method}: ${verdictLine(result)}`)
let relaySetup: JsonRecord = {}
let result: Awaited<ReturnType<typeof sweepMethods>>
// Teardown runs whatever failed, setup included: every fixture and minted session is closed on the target.
try {
  const localSetup = await local.call({ op: "setup" })
  learn(localSetup["aliases"])
  relaySetup = await relay.call({ op: "setup", device: values.device, durableId: localSetup["relayDurable"] })
  learn(relaySetup["aliases"])
  result = await sweepMethods(
    await engineMethodClasses(),
    leg(local, contextOf(localSetup)),
    leg(relay, contextOf(relaySetup)),
    () => aliases,
    onResult,
  )
} finally {
  await relay.call({ op: "teardown" }).catch((error: unknown) => console.error(String(error)))
  const closed = await local
    .call({ op: "teardown", sessions: [...minted] })
    .catch((error: unknown) => ({ error: String(error) }))
  console.error(`teardown: ${JSON.stringify(closed)}`)
  local.end()
  relay.end()
}
const finished = new Date().toISOString()
const meta = { started, finished, label: values.label, relayServiceVersion: relaySetup["serviceVersion"] }
writeFileSync(`${values.out}.json`, `${JSON.stringify({ meta, ...result }, null, 2)}\n`)
writeFileSync(
  `${values.out}.md`,
  renderSweep(
    result,
    `# Engine RPC methods: measured local versus relay parity\n\n${values.label}\nRun ${started} - ${finished}.`,
  ),
)
const { same, differs, missing, unsafeToProbe } = result.counts
console.log(
  `COUNTS same=${same} differs=${differs} missing=${missing} unsafeToProbe=${unsafeToProbe} methods=${result.methods.length}`,
)
await Promise.all([local.exited, relay.exited])
