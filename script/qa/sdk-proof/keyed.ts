// The cross-surface keyed send (#15021): one thread on device B, then for each ordered pair of surfaces the same message
// with the same idempotency key through the first and again through the second. The contract is at most one delivery per
// thread and key, whichever adapter carries it; the cell passes only when B's transcript holds the message exactly once
// and both calls answered success. Expected red until the core send operation deduplicates across surfaces.
import type { Driver } from "./drivers/driver.ts"
import { withinStep } from "./steps.ts"
import type { Surface } from "./evidence.ts"
import { ackOf } from "./scenario.ts"
import type { Observer } from "./world/observe.ts"

export type KeyedRecord = {
  readonly pair: string
  readonly first: unknown
  readonly second: unknown
  readonly deliveries: number
  readonly cell: "pass" | "fail" | "not reached"
  readonly why: string
}

const KEYED_DEADLINE_MS = 180_000

const OWNER = "#15021 (the core send operation; the cross-device half also needs the engine)"

const countIn = (texts: readonly string[], token: string): number => texts.filter((text) => text.includes(token)).length

export async function runKeyedPairs(
  drivers: Readonly<Record<Surface, Driver>>,
  thread: string | undefined,
  key: string | undefined,
  observer: Pick<Observer, "judge">,
  deadlineMs = KEYED_DEADLINE_MS,
  openFailure = "no thread was opened on B for the pairs",
): Promise<KeyedRecord[]> {
  const surfaces = Object.keys(drivers) as Surface[]
  const pairs = surfaces.flatMap((first) =>
    surfaces.filter((second) => second !== first).map((second) => [first, second] as const),
  )
  const records: KeyedRecord[] = []
  let stalled = false
  for (const [first, second] of pairs) {
    const pair = `${first} then ${second}`
    if (stalled) {
      records.push({
        pair,
        first: null,
        second: null,
        deliveries: 0,
        cell: "not reached",
        why: "an earlier keyed send did not answer within the step deadline",
      })
      continue
    }
    if (thread === undefined) {
      records.push({
        pair,
        first: null,
        second: null,
        deliveries: 0,
        cell: "not reached",
        why: openFailure,
      })
      continue
    }
    const token = `QA-TOKEN-x1a-key-${first}-${second}`
    const input = {
      thread,
      message: `x1a keyed ${token}`,
      delivery: "follow_up",
      idempotency_key: `x1a-key-${first}-${second}`,
    }
    const one = await withinStep(
      (signal) => drivers[first].run({ op: "send", input }, signal),
      `${first} send`,
      deadlineMs,
    )
    const two =
      "stalled" in one
        ? one
        : await withinStep((signal) => drivers[second].run({ op: "send", input }, signal), `${second} send`, deadlineMs)
    // A stall is the harness's, never the product's: it stops the pairs, and nothing is observed after it.
    if ("stalled" in one || "stalled" in two) {
      stalled = true
      records.push({
        pair,
        first: one.raw,
        second: two.raw,
        deliveries: 0,
        cell: "fail",
        why: "a keyed send answered nothing within the step deadline (the harness: no answer to attribute)",
      })
      continue
    }
    const settled = await observer.judge(key, { kind: "exchange", token }, {}, true)
    const sent = settled.state.messages
      .filter((message) => message.role === "user" || message.role === "custom")
      .map((message) => message.text)
    const deliveries = countIn(sent, token)
    const answered = settled.state.messages.some(
      (message) => message.role === "assistant" && message.text.includes(ackOf(token)),
    )
    const ok = one.answered && two.answered && deliveries === 1 && answered
    records.push({
      pair,
      first: one.raw,
      second: two.raw,
      deliveries,
      cell: ok ? "pass" : "fail",
      why: ok
        ? "one delivery"
        : `${deliveries} deliveries of one keyed message${one.answered && two.answered ? "" : "; a send answered no success"} (${OWNER})`,
    })
  }
  return records
}

/**
 * Opens the thread the pairs share, through the CLI, under the same step deadline: a stalled open is the harness's, and
 * every pair is then not reached (runKeyedPairs with no thread).
 */
export async function openKeyedThread(
  cli: Driver,
  device: string,
  observer: Pick<Observer, "keys" | "adopt">,
  deadlineMs = KEYED_DEADLINE_MS,
): Promise<{ readonly thread: string | undefined; readonly key: string | undefined; readonly stalled: boolean }> {
  const before = await observer.keys()
  const opened = await withinStep(
    (signal) => cli.run({ op: "create", input: { device, prompt: "x1a keyed pairs" } }, signal),
    "cli open",
    deadlineMs,
  )
  if ("stalled" in opened) return { thread: undefined, key: undefined, stalled: true }
  return { thread: opened.thread, key: await observer.adopt(before), stalled: false }
}

export const keyedTable = (records: readonly KeyedRecord[]): string =>
  [
    "",
    "## The same keyed send through two surfaces (#15021)",
    "",
    "| Surfaces, in order | Cell |",
    "|---|---|",
    ...records.map(
      (record) => `| ${record.pair} | ${record.cell === "pass" ? "pass" : `${record.cell}: ${record.why}`} |`,
    ),
    "",
  ].join("\n")
