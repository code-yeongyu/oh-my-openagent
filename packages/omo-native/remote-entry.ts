import { deviceServiceStateDir } from "../device-service-core/src/device-service.ts"
import { canonicalAgentDir } from "./bin/lib/agent-dir.js"
import { deviceServiceBootstrapSetup, omoBinaryPath } from "./remote-bootstrap"
import { prepareRemoteAttach, type RemoteVerbDependencies, runRemoteVerb } from "./remote-cli"
import { localRemoteDependencies } from "./remote-local"

// The launchers' `omo remote` entries: the verbs in remote-cli.ts over this device's real service, sign-in and binary.

function remoteDependencies(packageRoot?: string): RemoteVerbDependencies {
  return {
    ...localRemoteDependencies(packageRoot),
    bootstrap: deviceServiceBootstrapSetup({
      stateDir: deviceServiceStateDir(),
      binaryPath: omoBinaryPath(),
      agentDir: canonicalAgentDir(),
    }),
  }
}

/** The launchers' entry for `omo remote attach`: the engine argv to run in place of this command, or undefined (exit code set). */
export async function runRemoteAttachCommand(args: readonly string[]): Promise<readonly string[] | undefined> {
  const prepared = await prepareRemoteAttach(remoteDependencies(), args.slice(2))
  if (typeof prepared === "number") {
    process.exitCode = prepared
    return undefined
  }
  return prepared.engineArgs
}

/** `packageRoot`: the compiled binary's provisioned runtime directory (its staged `plugin/`); the npm launcher passes nothing. */
export async function runRemoteCommand(args: readonly string[], packageRoot?: string): Promise<void> {
  process.exitCode = await runRemoteVerb(remoteDependencies(packageRoot), args.slice(1))
}
