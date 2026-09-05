import childProcess from "node:child_process"
import { appendFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { syncBuiltinESMExports } from "node:module"

const evidence = dirname(fileURLToPath(import.meta.url))
const originalSpawn = childProcess.spawn
if (globalThis.Bun === undefined) {
  globalThis.Bun = {
    spawnSync([command, ...args], options) {
      const result = childProcess.spawnSync(command, args, options)
      if (result.error) throw result.error
      return { ...result, exitCode: result.status }
    },
  }
}
childProcess.spawn = function (command, args, options) {
  const isSenpi = String(command).endsWith("/senpi") || String(command).endsWith("/senpi-child-shim")
  if (!isSenpi) return originalSpawn.call(this, command, args, options)
  const root = dirname(options.env.SENPI_CODING_AGENT_DIR)
  const env = {
    ...options.env,
    OMO_CODING_AGENT_DIR: options.env.SENPI_CODING_AGENT_DIR,
    PI_CODING_AGENT_DIR: options.env.SENPI_CODING_AGENT_DIR,
    HOME: join(root, "home"),
    USERPROFILE: join(root, "home"),
    XDG_DATA_HOME: join(root, "xdg-data"),
    XDG_CACHE_HOME: join(root, "xdg-cache"),
    XDG_STATE_HOME: join(root, "xdg-state"),
    PI_OFFLINE: "1",
    OMO_SENPI_QA: "1",
  }
  const observedArgs = ["-e", join(evidence, "live-driver-prompt-dump.mjs"), ...args]
  appendFileSync(join(evidence, "live-driver-spawns.jsonl"), JSON.stringify({ command, args: observedArgs, cwd: options.cwd, agentDir: env.SENPI_CODING_AGENT_DIR }) + "\n")
  const child = originalSpawn.call(this, command, observedArgs, { ...options, env })
  child.stdout?.on("data", (chunk) => appendFileSync(join(evidence, `live-driver-${child.pid}.stdout`), chunk))
  child.stderr?.on("data", (chunk) => appendFileSync(join(evidence, `live-driver-${child.pid}.stderr`), chunk))
  return child
}
syncBuiltinESMExports()
