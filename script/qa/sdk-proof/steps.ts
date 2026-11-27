// One surface's run of the scenario: each step through the driver, then device B's verdict, as one cell per step. The
// world reaches this module only through `StepWorld`, so the runner itself is testable with a stand-in world.
import { cellOf, turnOf } from "./cell.ts"
import type { Answer, Driver } from "./drivers/driver.ts"
import type { Cell, StepRecord, Surface } from "./evidence.ts"
import { fill, parkModelId, parkWindowFor, SCENARIO } from "./scenario.ts"
import { DEVICE_B } from "./world/devices.ts"
import type { World } from "./world/world.ts"

export type StepWorld = Pick<World, "account" | "observer" | "release">

// One step's bound: a surface that has not answered by then failed the step; its call is aborted (a driver that started
// a process stops it), and the surface's later cells are not reached, so no step runs beside a stalled one.
export const STEP_DEADLINE_MS = 180_000
/** A preparatory call (a surface's driver, a world's start) under the same deadline as a step: undefined when it stalled. */
export const prepared = async <T>(
  prepare: Promise<T>,
  deadlineMs: number,
  onLate: (late: T) => void,
): Promise<T | undefined> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  let expired = false
  const deadline = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      expired = true
      resolve(undefined)
    }, deadlineMs)
  })
  // A preparation that lands after its deadline is handed to onLate (closed), never used.
  void prepare.then(
    (value) => {
      if (expired) onLate(value)
    },
    () => undefined,
  )
  return await Promise.race([prepare, deadline]).finally(() => clearTimeout(timer))
}

/** Every cell of a surface whose preparation stalled: not reached, attributed to the harness. */
export const unprepared = (surface: Surface, what: string): StepRecord[] =>
  SCENARIO.map((step) => ({
    step: step.id,
    op: step.op,
    input: {},
    call: "-",
    raw: null,
    observed: null,
    cell: "not reached" as const,
    why: `${what} did not finish within the step deadline (the harness: no answer to attribute)`,
    slice: "the harness (no answer to attribute; not a product finding)",
  }))

export const withinStep = (
  run: (signal: AbortSignal) => Promise<Answer>,
  call: string,
  deadlineMs: number,
): Promise<Answer & { stalled?: true }> => {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<Answer & { stalled: true }>((resolve) => {
    timer = setTimeout(() => {
      controller.abort()
      resolve({ call, raw: { no_answer_within_ms: deadlineMs }, answered: false, stalled: true })
    }, deadlineMs)
  })
  return Promise.race([run(controller.signal), expired]).finally(() => clearTimeout(timer))
}

export async function runSteps(
  surface: Surface,
  world: StepWorld,
  driver: Driver,
  deadlineMs = STEP_DEADLINE_MS,
): Promise<StepRecord[]> {
  const values: Record<string, string> = { deviceB: DEVICE_B.id, run: surface }
  const records: StepRecord[] = []
  let key: string | undefined
  // Set once this surface cannot go on (its open needs an account the world lacks, or a step stalled): every later cell
  // of the surface reads not reached with the same reason, never fail and never pass.
  let notRun: { readonly cell: Cell; readonly why: string } | undefined
  const record = (entry: StepRecord): void => {
    records.push(entry)
    process.stderr.write(`x1a ${surface} ${entry.step}: ${entry.cell} (${entry.why})\n`)
  }
  for (const step of SCENARIO) {
    const input = Object.fromEntries(Object.entries(step.input).map(([name, text]) => [name, fill(text, values)]))
    const mapping = driver.mapping[step.op]
    const skipped = (why: string, cell: Cell, slice: string): void =>
      record({ step: step.id, op: step.op, input, call: "-", raw: null, observed: null, cell, why, slice })
    if (mapping.kind === "unavailable") {
      skipped("no call on this surface today", "not reached", mapping.slice)
      continue
    }
    if (mapping.kind === "needs_account" && !world.account)
      notRun = {
        cell: "not reached",
        why: "the world carries no account",
      }
    if (notRun !== undefined) {
      skipped(notRun.why, notRun.cell, step.owner.slice)
      continue
    }
    // A step that names the thread cannot run when this surface's open answered none: it is not reached.
    if (step.op !== "create" && values["thread"] === undefined) {
      skipped("this surface's open answered no thread", "not reached", `${SCENARIO[0]?.owner.slice} (open)`)
      continue
    }
    const before = step.op === "create" ? await world.observer.keys() : new Set<string>()
    if (step.before === "fill-context") {
      const filled = await world.observer.fill(key)
      const window = "requirement" in filled ? parkWindowFor(filled.requirement) : undefined
      if (!("requirement" in filled) || window === undefined) {
        const why = "failed" in filled ? filled.failed : `no ladder window below the requirement ${filled.requirement}`
        skipped(`world setup failed, not a product result: ${why}`, "not reached", step.owner.slice)
        continue
      }
      values["park"] = parkModelId(window)
      Object.assign(
        input,
        Object.fromEntries(Object.entries(step.input).map(([name, text]) => [name, fill(text, values)])),
      )
    }
    const answer = await withinStep(
      (signal) =>
        driver.run({ op: step.op, input }, signal).catch((error: unknown) => ({
          call: mapping.how,
          raw: { thrown: String(error) },
          answered: false,
        })),
      mapping.how,
      deadlineMs,
    )
    // A stalled call was aborted: nothing is observed after it, its cell fails on the deadline, and the surface's later
    // cells are not reached.
    if ("stalled" in answer) {
      notRun = { cell: "not reached", why: "an earlier step of this surface did not answer within the step deadline" }
      record({
        step: step.id,
        op: step.op,
        input,
        call: answer.call,
        raw: answer.raw,
        observed: null,
        cell: "fail",
        why: "the surface answered nothing within the step deadline",
        // A stall shows no product behaviour: it is the harness's finding until a product answer says otherwise.
        slice: "the harness (no answer to attribute; not a product finding)",
      })
      continue
    }
    if (step.op === "create") {
      key = await world.observer.adopt(before)
      if ("thread" in answer && typeof answer.thread === "string") values["thread"] = answer.thread
    }
    const turn = turnOf(answer.raw)
    if (turn !== undefined) values["turn"] = turn
    if (step.release !== undefined) world.release(fill(step.release, values))
    const expect = JSON.parse(fill(JSON.stringify(step.expect), values))
    const refusal = step.refusedTo?.surfaces.includes(surface) === true ? step.refusedTo.code : undefined
    const verdict = await world.observer.judge(key, expect, answer.raw, answer.answered && refusal === undefined)
    // An interrupted held turn is over: its tag stays released, or a later request quoting it (B's compaction summary)
    // would be held again with no step left to release it.
    if (expect.kind === "interrupted") world.release(expect.tag)
    const { cell, why } = cellOf(answer, verdict.ok ? undefined : verdict.why, refusal)
    record({
      step: step.id,
      op: step.op,
      input,
      call: answer.call,
      raw: answer.raw,
      observed: verdict.state,
      cell,
      why,
      slice: step.owner.slice,
    })
  }
  return records
}
