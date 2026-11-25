import { createDiagnosticsLoader } from "../../../packages/omo-native/diagnostics-loader"
import { engineModelsPort } from "../fakes/engine-models"
import { hostStatusPort } from "../fakes/host-status"
import { type ScenarioFakes, scenarioRuns } from "../fakes/setup"
import { loadScenarioTable } from "../scenario-table"

// Slice C1b's drivers: the reap and run rows through the real root and the real diagnostics core, over the shared fake
// ports (process: one ps spawn, one signal per reaped pid; host: one status read). The core's own parse, validation and
// decisions run as shipped. run's other sections (artifacts, engine, memory, config, settings) read the scratch home's
// files directly and write nothing: the trace states these operations happen, not that only these happen
// (diagnostics-hermetic.test.ts). The npm registry read has no port; the driver answers it unreachable. The OpenCode
// edition's run scenarios (platform input) are slice OC1a's. models reads the engine's catalog through its engine port.
const ROWS = ["diagnostics.reapStaleEngines", "diagnostics.run", "diagnostics.models"]
const OPENCODE_EDITION = new Set(["diagnostics.run/opencode-platform", "diagnostics.run/codex-platform"])

// The model view's resolver loads from the staged runtime bundle, which a source tree has not built: the driver loads it
// from its source entry, and a scenario that states the bundle unreadable gets a load that fails, as the bundle would.
const RUNTIME_BUNDLE = "plugin/runtime/category-coverage/index.js"
const loadRuntime = (fakes: ScenarioFakes) => async () => {
  const unreadable = fakes.recorder.given("fs")["unreadable"]
  if (Array.isArray(unreadable) && unreadable.includes(RUNTIME_BUNDLE)) throw new Error(`cannot read ${RUNTIME_BUNDLE}`)
  return import("../../../packages/omo-native/category-coverage-entry")
}

const cores = (fakes: ScenarioFakes) => ({
  diagnostics: createDiagnosticsLoader({
    process: fakes.process,
    host: hostStatusPort(fakes.recorder),
    engine: engineModelsPort(fakes.recorder),
    loadRuntime: loadRuntime(fakes),
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
