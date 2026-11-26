import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { senpiEnvironment } from "./engine-environment.js"
import { ensureEnginePrepared, preparePluginLaunchSpec } from "./engine-prepare.js"
import { packageManifest, packageRoot, resolveSenpi, updateTarget } from "./package-paths.js"

export function preparedSenpi() {
  preparePluginLaunchSpec({ pluginRoot: join(packageRoot, "plugin") })
  const senpi = resolveSenpi()
  ensureEnginePrepared({
    senpiRoot: senpi.packageRoot,
    omoVersion: packageManifest().version,
    reinstallCommand: updateTarget().command,
  })
  return senpi
}

/**
 * One call into the engine's host CLI. It prints a single JSON line and exits, so the output is
 * captured rather than inherited - `omo daemon` has to read the engine's answer to turn it into
 * an exit code, and `spawnSync` is honest about a call that is expected to be this short.
 */
export function engineHostCall(engineArgs, options) {
  const senpi = preparedSenpi()
  const result = spawnSync(process.execPath, [senpi.cliPath, ...engineArgs], {
    encoding: "utf8",
    env: senpiEnvironment(senpi.packageRoot, options.env),
    windowsHide: true,
  })
  return { exitCode: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" }
}
