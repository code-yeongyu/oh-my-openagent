import { remoteClientForService } from "../omo-senpi/src/components/remote/index"
import packageJson from "./package.json" with { type: "json" }
import { bootstrapOnce } from "./remote-bootstrap"
import type { RemoteVerbDependencies } from "./remote-cli"
import { remoteDependencies } from "./remote-entry"
import { REMOTE_EXIT } from "./remote-exit"

// `omo __device-service-bootstrap --json` (design v8-core r2 B4, G4): the device service bootstrap every interactive omo
// start runs in the background, as the internal entry the engine's device-service component spawns. It is not a person's
// `remote` verb: it runs `service.bootstrap` on the service client, under 570 s (the runner stops it at 600 s). Its one
// stdout line is the report the runner parses: {state: "connected", status} or {state, notice}.

const BOOTSTRAP_DEADLINE_MS = 570_000

/** The launchers' entry for `omo __device-service-bootstrap`; sets the exit code. */
export async function runDeviceServiceBootstrapCommand(): Promise<void> {
  process.exitCode = await runDeviceServiceBootstrap(remoteDependencies())
}

/** One bootstrap on the service client over `dependencies`; prints the report line and answers the exit code. */
export async function runDeviceServiceBootstrap(dependencies: RemoteVerbDependencies): Promise<number> {
  const client = remoteClientForService({
    version: packageJson.version,
    stateDir: dependencies.stateDir,
    connect: () => dependencies.connect(),
    bootstrap: async () => {
      const outcome = await bootstrapOnce(dependencies, dependencies.bootstrap, dependencies)
      return outcome.kind === "connected"
        ? { kind: "connected", status: { ...outcome.status, service_version: outcome.serviceVersion } }
        : { kind: "stopped", state: outcome.state, notice: outcome.notice }
    },
  })
  try {
    const answer = await client.service.bootstrap({}, { deadlineMs: BOOTSTRAP_DEADLINE_MS })
    if (answer.kind === "error") {
      dependencies.output(JSON.stringify({ state: answer.code, notice: `${answer.message} ${answer.next_action}` }))
      return REMOTE_EXIT.unavailable
    }
    const result = answer.value
    if (result.kind === "connected") dependencies.output(JSON.stringify({ state: "connected", status: result.status }))
    else dependencies.output(JSON.stringify({ state: result.state, notice: result.notice }))
    return result.kind === "connected" ? REMOTE_EXIT.ok : REMOTE_EXIT.unavailable
  } finally {
    client.close()
  }
}
