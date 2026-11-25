import { tmpdir } from "node:os"

import { createDiagnosticsLoader } from "../../../packages/omo-native/diagnostics-loader"
import { assembleOmoSdk } from "../../../packages/omo-senpi/src/components/omo-sdk/assembly"
import type { OmoPrincipal } from "../../../packages/omo-senpi/src/components/omo-sdk/contract"
import type { ScenarioRun } from "../conformance-run"
import type { ObservedCall, TableScenario } from "../expectation"
import { loadScenarioTable } from "../scenario-table"

// Slice C1b's drivers for the diagnostics rows. The fakes stand at the process port (the `ps` listing and the signal);
// everything above it, the pid validation and the stale-engine decision, is the real core, so the observed trace is
// what the core did. This file stands in for slice P1b's shared fake ports until they land; delete it for those then.
const PS_ARGV = ["-ww", "-axo", "pid=,ppid=,etime=,tty=,args="]

type PsRow = {
  readonly pid: number
  readonly ppid: number
  readonly elapsed: string
  readonly tty: string
  readonly command: string
}

function psAnswer(scenario: TableScenario): readonly PsRow[] {
  const spawn = scenario.expect.find((entry) => entry.port === "process" && entry.op === "spawn")
  return (spawn?.result as readonly PsRow[] | undefined) ?? []
}

function reapRun(scenario: TableScenario): ScenarioRun {
  return {
    scenario,
    setup: () => {
      const observed: ObservedCall[] = []
      const loader = createDiagnosticsLoader({
        list: () => {
          observed.push({ port: "process", op: "spawn", args: { command: "ps", argv: PS_ARGV } })
          return [...psAnswer(scenario)]
        },
        kill: (pid, signal) => {
          observed.push({ port: "process", op: "signal", args: { pid, signal } })
        },
      })
      const principal = scenario.principal as OmoPrincipal | undefined
      const root = assembleOmoSdk(
        { env: {}, cwd: tmpdir(), ...(principal === undefined ? {} : { principal }) },
        { cores: { diagnostics: loader } },
      )
      return { root, calls: () => observed }
    },
  }
}

/** The reap row's effect and refusal scenarios; the other diagnostics rows stay unresolved with their reasons. */
export const runs: readonly ScenarioRun[] = loadScenarioTable()
  .filter((file) => file.domain === "diagnostics")
  .flatMap((file) => file.scenarios)
  .filter((scenario) => scenario.row === "diagnostics.reapStaleEngines")
  .map(reapRun)
