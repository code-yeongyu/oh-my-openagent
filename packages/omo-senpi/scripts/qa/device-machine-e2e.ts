// End-to-end check for bash through this device's own hands daemon (tools-via-hands-daemon slice 1b). Run ON the
// device under test, after its device service carries relay-daemon#1134 (0.1.34 or later):
//   bun packages/omo-senpi/scripts/qa/device-machine-e2e.ts
// It runs one command through the device service's local API and prints the output, the exit code and the journal
// read that proves the op went through the daemon: one "machine batch: 1 ops in flight" line in the window.
import { execOnDevice, localDeviceRunner } from "../../src/components/device-service/device-machine"

const since = new Date().toISOString().slice(0, 19).replace("T", " ")
const marker = `e2e-${Date.now()}`
const chunks: string[] = []
const result = await execOnDevice(
  localDeviceRunner(),
  { command: `echo ${marker}; hostname; exit 7`, onOutput: (chunk) => chunks.push(chunk.toString()) },
  new AbortController().signal,
)
process.stdout.write(chunks.join(""))
console.log(`exitCode=${String(result.exitCode)} timedOut=${String(result.timedOut)} durationMs=${String(result.durationMs)}`)
console.log(`journal: journalctl --user --since "${since}" --no-pager | grep "machine batch"`)
const passed = chunks.join("").includes(marker) && result.exitCode === 7
console.log(passed ? "E2E PASS" : "E2E FAIL")
process.exitCode = passed ? 0 : 1
