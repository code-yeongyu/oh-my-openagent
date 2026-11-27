// The capped holder (#14941, senpi#7138): device B's engine stops automatic turns after one per person's message
// (`engineTurns.maxPerUserInput: 1`, world option capB). A session on A sends to B through the thread tools, the relay
// leg that reaches B's `admit_external_message` (the SDK and the CLI reach another device as the person's own input,
// which lifts the cap, so they cannot meet it). Steps, in order, each judged on the surface's own answer AND on B read
// through its own engine:
//   start   the first tools send after B's opening prompt starts a turn: `started`, and B answers it;
//   capped  the next one meets the cap: `queued` waiting on `engine_turn_cap` (reason and count), never `started`; B
//           records the message, does not answer it, and its `get_state.engineTurnCap` names the cap;
//   resend  the same send again under the same key answers the first delivery's state, cap included, and B holds the
//           message once;
//   lift    a person's message from the CLI starts a turn, and B's cap is gone.
import type { Driver } from "./drivers/driver.ts"
import { isRecord } from "./drivers/driver.ts"
import { withinStep } from "./steps.ts"
import { ackOf } from "./scenario.ts"
import type { Observer } from "./world/observe.ts"
import { waitFor } from "../../../packages/omo-senpi/scripts/qa/thread-tools/lib/gateway.mjs"

export const CAP_B = 1

export type CappedRecord = {
  readonly step: "start" | "capped" | "resend" | "lift"
  readonly raw: unknown
  readonly cell: "pass" | "fail" | "not reached"
  readonly why: string
}

const DEADLINE_MS = 180_000
const SETTLE_MS = 60_000

const deliveryOf = (raw: unknown): Readonly<Record<string, unknown>> =>
  isRecord(raw) && isRecord(raw["delivery"]) ? raw["delivery"] : {}

/** Why an answer is not a delivery parked behind B's cap-per-message cap, or undefined when it is one. */
export function notParked(raw: unknown): string | undefined {
  const delivery = deliveryOf(raw)
  const wait = isRecord(delivery["waiting_on"]) ? delivery["waiting_on"] : {}
  if (delivery["kind"] !== "queued") return `delivery.kind is ${String(delivery["kind"])}, not queued`
  if (wait["kind"] !== "engine_turn_cap") return `waiting_on.kind is ${String(wait["kind"])}, not engine_turn_cap`
  if (wait["reason"] !== "cap-per-message") return `waiting_on.reason is ${String(wait["reason"])}`
  return typeof wait["count"] === "number" ? undefined : "waiting_on.count is missing"
}

const capOf = (state: Readonly<Record<string, unknown>>): unknown => state["engineTurnCap"]

export async function runCapped(
  tools: Driver,
  cli: Driver,
  device: string,
  observer: Pick<Observer, "keys" | "adopt" | "read" | "engineState">,
): Promise<CappedRecord[]> {
  const records: CappedRecord[] = []
  const skip = (from: CappedRecord["step"][], why: string): CappedRecord[] => [
    ...records,
    ...from.map((step) => ({ step, raw: null, cell: "not reached" as const, why })),
  ]
  const texts = async (key: string, role: "assistant" | "sent"): Promise<string[]> =>
    (await observer.read(key)).messages
      .filter((message) => (role === "assistant" ? message.role === "assistant" : message.role !== "assistant"))
      .map((message) => message.text)
  const settles = async (check: () => Promise<boolean>, label: string): Promise<boolean> => {
    try {
      await waitFor(async () => ((await check()) ? true : undefined), { label, timeoutMs: SETTLE_MS })
      return true
    } catch {
      return false
    }
  }

  const before = await observer.keys()
  const open = "QA-TOKEN-x1a-capped-open"
  const opened = await withinStep(
    (signal) => cli.run({ op: "create", input: { device, prompt: `x1a capped ${open}` } }, signal),
    "cli open",
    DEADLINE_MS,
  )
  const key = "stalled" in opened ? undefined : await observer.adopt(before)
  if (key === undefined || !(await settles(async () => (await texts(key, "assistant")).some((t) => t.includes(ackOf(open))), "B answers its opening prompt")))
    return skip(["start", "capped", "resend", "lift"], "the thread on B did not open and answer its first prompt (setup)")
  const thread = "stalled" in opened ? "" : (opened.thread ?? "")

  const send = async (token: string, idempotency_key: string) =>
    await withinStep(
      (signal) => tools.run({ op: "send", input: { thread, message: `x1a capped ${token}`, idempotency_key } }, signal),
      "tools send",
      DEADLINE_MS,
    )

  const first = "QA-TOKEN-x1a-capped-first"
  const started = await send(first, "x1a-capped-first")
  if ("stalled" in started) return skip(["start", "capped", "resend", "lift"], "the first tools send answered nothing (harness)")
  const answeredFirst = await settles(
    async () => (await texts(key, "assistant")).some((text) => text.includes(ackOf(first))),
    "B answers the first send",
  )
  const startedOk = deliveryOf(started.raw)["kind"] === "started" && answeredFirst
  records.push({
    step: "start",
    raw: started.raw,
    cell: startedOk ? "pass" : "fail",
    why: startedOk ? "started, and B answered it" : `delivery ${JSON.stringify(deliveryOf(started.raw))}; B answered: ${answeredFirst}`,
  })

  const parked = "QA-TOKEN-x1a-capped-parked"
  const capped = await send(parked, "x1a-capped-parked")
  if ("stalled" in capped) return skip(["capped", "resend", "lift"], "the capped tools send answered nothing (harness)")
  const recorded = await settles(
    async () => (await texts(key, "sent")).some((text) => text.includes(parked)),
    "B records the capped message",
  )
  const state = await observer.engineState(key)
  const unanswered = !(await texts(key, "assistant")).some((text) => text.includes(ackOf(parked)))
  const notParkedWhy = notParked(capped.raw)
  const cappedOk = notParkedWhy === undefined && recorded && unanswered && isRecord(capOf(state))
  records.push({
    step: "capped",
    raw: { answer: capped.raw, b_engine_turn_cap: capOf(state) ?? null },
    cell: cappedOk ? "pass" : "fail",
    why: cappedOk
      ? "queued waiting on engine_turn_cap; B recorded it unanswered and names the cap"
      : `${notParkedWhy ?? "parked"}; B recorded: ${recorded}; B unanswered: ${unanswered}; B engineTurnCap: ${JSON.stringify(capOf(state) ?? null)}`,
  })

  const resent = await send(parked, "x1a-capped-parked")
  if ("stalled" in resent) return skip(["resend", "lift"], "the resend answered nothing (harness)")
  const copies = (await texts(key, "sent")).filter((text) => text.includes(parked)).length
  const resendWhy = notParked(resent.raw)
  const resendOk = resendWhy === undefined && isRecord(resent.raw) && resent.raw["deduplicated"] === true && copies === 1
  records.push({
    step: "resend",
    raw: resent.raw,
    cell: resendOk ? "pass" : "fail",
    why: resendOk
      ? "deduplicated, still waiting on engine_turn_cap; B holds the message once"
      : `${resendWhy ?? "parked"}; deduplicated: ${isRecord(resent.raw) ? String(resent.raw["deduplicated"]) : "-"}; copies on B: ${copies}`,
  })

  const person = "QA-TOKEN-x1a-capped-person"
  const lifted = await withinStep(
    (signal) => cli.run({ op: "send", input: { thread, message: `x1a capped ${person}`, delivery: "auto" } }, signal),
    "cli send",
    DEADLINE_MS,
  )
  if ("stalled" in lifted) return skip(["lift"], "the person's send answered nothing (harness)")
  // The fake model acks every token in the turn's context, so the person's turn names the parked message too.
  const personTurn = async (): Promise<string | undefined> =>
    (await texts(key, "assistant")).find((text) => text.startsWith("QA-ACK") && text.includes(person))
  const ran = await settles(async () => (await personTurn()) !== undefined, "B answers the person")
  const reply = (await personTurn()) ?? ""
  const capAfter = capOf(await observer.engineState(key))
  const liftOk = lifted.answered && ran && reply.includes(parked) && capAfter === undefined
  records.push({
    step: "lift",
    raw: { answer: lifted.raw, b_reply: reply, b_engine_turn_cap: capAfter ?? null },
    cell: liftOk ? "pass" : "fail",
    why: liftOk
      ? "the person's message ran a turn that answered the parked message, and B's cap is gone"
      : `answered: ${lifted.answered}; B ran: ${ran}; parked message in that turn: ${reply.includes(parked)}; B engineTurnCap: ${JSON.stringify(capAfter ?? null)}`,
  })
  return records
}

export const cappedTable = (records: readonly CappedRecord[]): string =>
  [
    "",
    "## A send to a thread whose engine-turn cap stops it (#14941, senpi#7138)",
    "",
    "| Step | Cell |",
    "|---|---|",
    ...records.map((record) => `| ${record.step} | ${record.cell === "pass" ? "pass" : `${record.cell}: ${record.why}`} |`),
    "",
  ].join("\n")
