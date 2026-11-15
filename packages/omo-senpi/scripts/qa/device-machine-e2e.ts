// End-to-end check for bash on another device through its hands daemon (Q's daemon mode). Run on the CALLING machine
// with the target named, after the senpi release with #6713 + #6720 is pinned:
//   OMO_SESSION_DEVICE=<target device id or alias> bun packages/omo-senpi/scripts/qa/device-machine-e2e.ts
// It runs one command on the target through this machine's device service and the relay, and prints the output, the
// exit code and the journal read to run ON THE TARGET: one "machine batch: 1 ops in flight" line in the window.
import { execOnDevice, relayDeviceRunner, sessionDevice } from "../../src/components/device-service/device-machine"

const target = sessionDevice()
if (target === undefined) throw new Error("set OMO_SESSION_DEVICE to the target device id or alias")
const since = new Date().toISOString().slice(0, 19).replace("T", " ")
const marker = `e2e-${Date.now()}`
const chunks: string[] = []
const result = await execOnDevice(
  relayDeviceRunner(target),
  { command: `echo ${marker}; hostname; exit 7`, onOutput: (chunk) => chunks.push(chunk.toString()) },
  new AbortController().signal,
)
process.stdout.write(chunks.join(""))
console.log(`exitCode=${String(result.exitCode)} timedOut=${String(result.timedOut)} durationMs=${String(result.durationMs)}`)
console.log(`on the target: journalctl --user --since "${since}" --no-pager | grep "machine batch"`)
const passed = chunks.join("").includes(marker) && result.exitCode === 7
console.log(passed ? "E2E PASS" : "E2E FAIL")
process.exitCode = passed ? 0 : 1
