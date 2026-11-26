import { createDiagnosticsLoader } from "../../../packages/omo-native/diagnostics-loader"
import { hostStatusPort } from "../fakes/host-status"
import { type ScenarioFakes, scenarioRuns } from "../fakes/setup"
import { loadScenarioTable } from "../scenario-table"

// Slice C1b's drivers: the reap and run rows through the real root and the real diagnostics core, over the shared fake
// ports (process: one ps spawn, one signal per reaped pid; host: one status read). The core's own parse, validation and
// decisions run as shipped. run's other sections (artifacts, engine, memory, config, settings) read the scratch home's
// files directly and write nothing: the trace states these operations happen, not that only these happen
// (diagnostics-hermetic.test.ts). The npm registry read has no port; the driver answers it unreachable. The OpenCode
// edition's run scenarios (platform input) are slice OC1a's; models stays unresolved until its engine port.
const ROWS = ["diagnostics.reapStaleEngines", "diagnostics.run"]
const OPENCODE_EDITION = new Set(["diagnostics.run/opencode-platform", "diagnostics.run/codex-platform"])

const cores = (fakes: ScenarioFakes) => ({
  diagnostics: createDiagnosticsLoader({
    process: fakes.process,
    host: hostStatusPort(fakes.recorder),
    fetchDistTags: () => undefined,
  }),
})

const ids = loadScenarioTable()
  .flatMap((file) => file.scenarios)
  .filter((scenario) => ROWS.includes(scenario.row) && !OPENCODE_EDITION.has(scenario.id))
  .map((scenario) => scenario.id)

export const runs = scenarioRuns(ROWS, Object.fromEntries(ids.map((id) => [id, { cores }]))).filter(
  (run) => !OPENCODE_EDITION.has(run.scenario.id),
)
