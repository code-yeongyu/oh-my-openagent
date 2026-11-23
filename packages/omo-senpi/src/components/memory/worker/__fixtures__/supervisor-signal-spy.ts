import { appendFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

// Observe the actual syscall boundary in the OUTER supervisor only. Never forward a group
// signal from it, even on the broken baseline. The fixture model owns a separate exit socket.
const kill = process.kill
const runDir = process.argv[2]
process.kill = (pid, signal) => {
  if (pid <= 0 && signal !== 0) {
    appendFileSync(join(runDir, "external-signals.jsonl"), `${JSON.stringify({ pid, signal })}\n`)
    return true
  }
  return kill(pid, signal)
}
// Run the real bootstrap at the same PID but physically disconnect fd 3. Its durable exit
// record is real; no model status written before its death can possibly reach the supervisor.
const shim = join(runDir, "bootstrap-without-status")
writeFileSync(shim, '#!/bin/sh\nexec "$FIXTURE_BOOTSTRAP_RUNTIME" "$@" 3>/dev/null\n', { mode: 0o700 })
process.env.FIXTURE_BOOTSTRAP_RUNTIME = process.execPath
process.execPath = shim
await import("../memory-run-supervisor")
