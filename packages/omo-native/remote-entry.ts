import { deviceServiceStateDir } from "../device-service-core/src/device-service.ts"
import { createCredentialStore, SESSION_READ_WAIT } from "../omo-opencode/src/cli/service-auth/keystore"
import { accountServiceApi } from "./account-show"
import { canonicalAgentDir } from "./bin/lib/agent-dir.js"
import { cliDeviceServiceHandoff } from "./device-service-handoff"
import { deviceServiceBootstrapSetup, omoBinaryPath } from "./remote-bootstrap"
import { prepareRemoteAttach, type RemoteVerbDependencies, runRemoteVerb } from "./remote-cli"
import { coldWakeSetup } from "./remote-cold-wake"
import { localRemoteDependencies } from "./remote-local"

// The launchers' `omo remote` entries: the verbs in remote-cli.ts over this device's real service, sign-in and binary.

function remoteDependencies(packageRoot?: string): RemoteVerbDependencies {
  const stateDir = deviceServiceStateDir()
  const binaryPath = omoBinaryPath()
  const agentDir = canonicalAgentDir()
  return {
    ...localRemoteDependencies(packageRoot),
    bootstrap: deviceServiceBootstrapSetup({ stateDir, binaryPath, agentDir }),
    coldWake: coldWakeSetup({ binaryPath, agentDir }),
    // Reads the stored credential only when `omo remote enable` finds a service that holds no device (omo#13602).
    linkDevice: async () => {
      const api = accountServiceApi()
      const credentials = await createCredentialStore(api, { wait: SESSION_READ_WAIT }).read()
      if (credentials === null) return "signed_out"
      await cliDeviceServiceHandoff({ api, stateDir, log: (line) => process.stderr.write(`${line}\n`) }).adopt(
        credentials,
      )
      return "linked"
    },
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
