import { createDiagnosticsLoader } from "../../../packages/omo-native/diagnostics-loader"
import { type ScenarioFakes, scenarioRuns } from "../fakes/setup"
import { loadScenarioTable } from "../scenario-table"

// Slice C1b's drivers: the reap row through the real root and the real diagnostics core, over the shared fake process
// port (one ps spawn answered with the scenario's ps text, one signal per reaped pid). The core's own parse, validation
// and stale-engine decision run as shipped. run, models and fixReflectionLock stay unresolved with their reasons.
const ROWS = ["diagnostics.reapStaleEngines"]

const cores = (fakes: ScenarioFakes) => ({ diagnostics: createDiagnosticsLoader({ process: fakes.process }) })

const ids = loadScenarioTable()
  .flatMap((file) => file.scenarios)
  .filter((scenario) => ROWS.includes(scenario.row))
  .map((scenario) => scenario.id)

export const runs = scenarioRuns(ROWS, Object.fromEntries(ids.map((id) => [id, { cores }])))
