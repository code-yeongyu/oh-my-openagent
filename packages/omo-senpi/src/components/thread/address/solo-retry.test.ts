import { describe, expect, test } from "bun:test"
import { withCallDeadline } from "../../call-budget/call-deadline"
import type { RemoteLookupOutcome } from "../remote/ports"
import { askSilentAlone, type ProbeAnswer } from "./solo-retry"

// #14748: which silent devices a resolution asks again alone, and what each answer becomes. The reserve a retry leaves
// for the step after the resolution is the call budget's READ_RESERVE_MS (15 s); one solo lookup is bounded at 3.5 s.

const silent = (device: string): ProbeAnswer => ({ device, answer: { kind: "silent", reason: "lookup_timeout" } })

function port(
  answers: Readonly<Record<string, RemoteLookupOutcome | undefined>>,
  onAsk?: (device: string) => Promise<void>,
) {
  const asked: Array<{ readonly device: string; readonly waitMs: number }> = []
  return {
    asked,
    sessions: {
      lookupAlone: async (device: string, _thread: string, waitMs: number) => {
        asked.push({ device, waitMs })
        await onAsk?.(device)
        return answers[device]
      },
    },
  }
}

describe("#14748 asking silent devices again alone", () => {
  test("E12: #given no enclosing call budget (a script outside a tool call) #then every silent device is asked, each with one lookup's wait", async () => {
    const p = port({ b: { kind: "found", key: "kb" }, c: { kind: "none" } })
    const answers = await askSilentAlone(p.sessions, "t", [silent("b"), silent("c")])
    expect(answers.map((entry) => entry.answer.kind)).toEqual(["found", "none"])
    expect(p.asked).toEqual([
      { device: "b", waitMs: 3_500 },
      { device: "c", waitMs: 3_500 },
    ])
  })

  test("E14: #given a budget that holds one retry #when the first retry uses it up #then the next device is not asked and keeps its silent answer", async () => {
    const p = port({ b: { kind: "none" }, c: { kind: "found", key: "kc" } }, async (device) => {
      // Time is what this case is about: the first retry takes the budget's spare 2 s and more.
      if (device === "b") await new Promise((resolve) => setTimeout(resolve, 2_500))
    })
    const answers = await withCallDeadline(Date.now() + 15_000 + 3_500 + 2_000, () =>
      askSilentAlone(p.sessions, "t", [silent("b"), silent("c")]),
    )
    expect(p.asked.map((entry) => entry.device)).toEqual(["b"])
    expect(answers).toEqual([{ device: "b", answer: { kind: "none" } }, silent("c")])
  })

  test("E15: #given a budget with room for a lookup and a little more #then the wait offered leaves the lookup its time", async () => {
    const p = port({ b: { kind: "none" } })
    await withCallDeadline(Date.now() + 15_000 + 3_500 + 1_000, () => askSilentAlone(p.sessions, "t", [silent("b")]))
    const waitMs = p.asked[0]?.waitMs ?? Number.NaN
    expect(waitMs).toBeGreaterThan(0)
    expect(waitMs).toBeLessThanOrEqual(1_000)
  })

  test("E19/E6: #given the port could not ask alone in time (undefined) #then the silent answer is kept", async () => {
    const p = port({ b: undefined })
    expect(await askSilentAlone(p.sessions, "t", [silent("b")])).toEqual([silent("b")])
  })

  test("E23: #given a retry the port answers unavailable #then the silent answer is kept, so the probe's own answer still stands", async () => {
    const p = port({ b: { kind: "unavailable" } })
    expect(await askSilentAlone(p.sessions, "t", [silent("b")])).toEqual([silent("b")])
  })

  test("E26: #given a port that cannot ask alone #then nothing is asked and every silent answer is kept", async () => {
    expect(await askSilentAlone({}, "t", [silent("b")])).toEqual([silent("b")])
  })

  test("E36: #given answers that are not silent #then they are never asked again", async () => {
    const p = port({})
    const settled: ProbeAnswer[] = [
      { device: "b", answer: { kind: "none" } },
      { device: "c", answer: { kind: "found", key: "kc" } },
    ]
    expect(await askSilentAlone(p.sessions, "t", settled)).toEqual(settled)
    expect(p.asked).toEqual([])
  })
})
