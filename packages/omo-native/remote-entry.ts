import {
  type AccountShowResult,
  connectDeviceService,
  deviceServiceStateDir,
} from "../device-service-core/src/index.ts"
import { resolveMemoryRoot } from "../memory-core/src/identity/layout"
import { syncPinDir } from "../memory-core/src/sync/pin-dir"
import { createCredentialStore, type CredentialStore, SESSION_READ_WAIT } from "../omo-opencode/src/cli/service-auth/keystore"
import { serviceOrigin } from "../omo-opencode/src/cli/service-auth/protocol"
import { retireSyncPinOnDiscard } from "../omo-opencode/src/cli/service-auth/sync-pin-retire"
import { runAccountVerb } from "./account-cli"
import { canonicalAgentDir } from "./bin/lib/agent-dir.js"
import packageJson from "./package.json" with { type: "json" }
import { deviceServiceBootstrapSetup, omoBinaryPath, storedDeviceCredential } from "./remote-bootstrap"
import { prepareRemoteAttach, type RemoteVerbDependencies, runRemoteVerb } from "./remote-cli"

// The launchers' `omo remote` entries: the verbs in remote-cli.ts over this device's real service, sign-in and binary.

const serviceApi = (): string => serviceOrigin(process.env.OMO_SERVICE_API_URL ?? "https://api.omo.dev")

async function inProcessAccountShow(): Promise<AccountShowResult> {
  const api = serviceApi()
  const lines: string[] = []
  let store: CredentialStore | undefined
  const exitCode = await runAccountVerb(
    {
      api,
      get store() {
        store ??= createCredentialStore(api, { wait: SESSION_READ_WAIT })
        return store
      },
      pinDir: () => syncPinDir(resolveMemoryRoot(process.env, process.cwd())),
      beforeKeysDiscarded: retireSyncPinOnDiscard({ pinDir: () => syncPinDir(resolveMemoryRoot(process.env, process.cwd())), log: () => {} }),
      readStdin: async () => "",
      output: line => lines.push(line),
      error: () => {},
    },
    ["show"],
  )
  return { exitCode, stdout: lines.join("\n") }
}

function remoteDependencies(): RemoteVerbDependencies {
  const stateDir = deviceServiceStateDir()
  return {
    accountShow: inProcessAccountShow,
    stateDir,
    connect: () => connectDeviceService({ version: packageJson.version, stateDir }),
    now: () => Date.now(),
    output: line => process.stdout.write(`${line}\n`),
    error: line => process.stderr.write(`${line}\n`),
    bootstrap: deviceServiceBootstrapSetup({
      stateDir,
      credential: storedDeviceCredential(serviceApi()),
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

export async function runRemoteCommand(args: readonly string[]): Promise<void> {
  process.exitCode = await runRemoteVerb(remoteDependencies(), args.slice(1))
}
