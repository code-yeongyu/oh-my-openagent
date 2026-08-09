import { spawnSync } from "node:child_process"

export function propagateResult(result) {
  if (result.error) throw result.error
  if (result.signal) {
    process.kill(process.pid, result.signal)
    return
  }
  process.exitCode = result.status ?? 1
}

export function spawnNode(scriptPath, args, options = {}) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    stdio: "inherit",
    ...options,
  })
  propagateResult(result)
}
