import { describe, expect, test } from "bun:test"

import { reapStaleEngines } from "../bin/lib/diagnostics.js"
import { exitOf, REAP_EXIT_SURFACE } from "../bin/lib/reap-exit.js"

const ENGINE = "node /opt/omo/node_modules/@code-yeongyu/senpi/dist/bundle/cli.js --extension /opt/omo/plugin"
const row = (pid: number, ppid: number, command = ENGINE) => ({ pid, ppid, elapsed: "05:00", tty: "pts/1", command })
const TABLE = [
  row(11, 1),
  row(12, 1, "node /srv/other-app.js"),
  row(13, 1, `${ENGINE} --mode rpc`),
  row(14, 99),
  row(15, 1),
]
const noSignal = () => {}

// The nine reap cases the pins hold, with the exit `omo doctor --reap` prints for each.
const CASES: readonly (readonly [string, number[], number])[] = [
  ["the orphaned engine alone", [11], 0],
  ["two orphaned engines", [11, 15], 0],
  ["an orphaned engine and one that is not an engine", [11, 12], 1],
  ["an orphaned engine and a managed one", [11, 13], 1],
  ["an orphaned engine and a live session", [11, 14], 1],
  ["a pid absent from the table", [404], 1],
  ["a managed engine", [13], 1],
  ["a live session", [14], 1],
  ["an absent pid and a managed one", [404, 13], 1],
]

describe("omo doctor --reap exit surface", () => {
  for (const [name, pids, exit] of CASES) {
    test(`#given ${name} #when the core answers #then complete folds the outcomes and the surface gives exit ${exit}`, async () => {
      const answer = await reapStaleEngines({ pids }, { list: () => TABLE, kill: noSignal })
      if (answer.kind === "ok")
        expect(answer.value.complete).toBe(answer.value.engines.every((engine) => engine.outcome === "reaped"))
      expect(exitOf(REAP_EXIT_SURFACE, answer)).toBe(exit)
    })
  }

  test("#given a failure rule that passes a status through #when the status is not an integer from 1 to 255 #then the rule is skipped", () => {
    const surface = { ok: 0, okRules: [], refused: 9, rules: [{ code: "x", exitFrom: "status" }] }
    expect(exitOf(surface, { kind: "error", error: { code: "x", details: { status: 4 } } })).toBe(4)
    expect(exitOf(surface, { kind: "error", error: { code: "x", details: { status: 0 } } })).toBe(9)
    expect(exitOf(surface, { kind: "error", error: { code: "x", details: { status: "4" } } })).toBe(9)
  })
})
