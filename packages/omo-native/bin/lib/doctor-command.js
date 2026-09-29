import { canonicalAgentDir } from "./agent-dir.js"
import { doctorCoverageLines } from "./category-coverage.js"
import { doctorComputerUseLines } from "./computer-use-doctor.js"
import { runDoctor } from "./doctor.js"
import { gatewayDoctorLines } from "./gateway.js"
import { detectHarnesses } from "./setup-detect.js"

/** `omo doctor`: `--reap` only cleans up daemon state, so it skips the staged-runtime rows. */
export async function runDoctorCommand(doctorArgs, { engineHostCall }) {
  const [categoryCoverage, computerUse, gatewayConfig] = doctorArgs[0] === "--reap"
    ? [[], [], []]
    : await Promise.all([
        doctorCoverageLines({ agentDir: canonicalAgentDir() }),
        doctorComputerUseLines(),
        gatewayDoctorLines(),
      ])
  runDoctor(await detectHarnesses(), doctorArgs, {
    daemonEngine: { run: engineHostCall },
    categoryCoverage,
    computerUse,
    gatewayConfig,
  })
}
