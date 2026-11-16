/**
 * QA driver for row 37 (cu-v3 plan: packages/omo-computer-hand/scripts/qa-hand.ts), against a real
 * engine binary on the fake backend.
 *
 *   bun packages/omo-computer-hand/scripts/qa-hand.ts --engine target/debug/omo-computer-engine --scenario ensure-register
 *
 * Prints PASS/FAIL per check and HAND_OK when every check passed (exit 0), HAND_FAILED otherwise.
 */
import { attachOnlyRole, ensureRegister, strangerRole } from "./qa-hand/ensure-register.ts"
import { heartbeatAndClick } from "./qa-hand/heartbeat-click.ts"

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

const role = arg("--role")
const seam = arg("--seam")
if (role !== undefined && seam !== undefined) {
  if (role === "attach-only") await attachOnlyRole(seam)
  else if (role === "stranger") await strangerRole(seam)
  process.exit(0)
}

const engine = arg("--engine")
const scenario = arg("--scenario")
const scenarios: Readonly<Record<string, (engine: string) => Promise<boolean>>> = {
  "ensure-register": (path) => ensureRegister(path, process.argv[1] ?? ""),
  "heartbeat-and-click": heartbeatAndClick,
}
const runScenario = scenario === undefined ? undefined : scenarios[scenario]
if (engine === undefined || runScenario === undefined) {
  console.error(`usage: qa-hand.ts --engine <path> --scenario <${Object.keys(scenarios).join("|")}>`)
  process.exit(2)
}
const ok = await runScenario(engine)
console.log(ok ? "HAND_OK" : "HAND_FAILED")
process.exit(ok ? 0 : 1)
