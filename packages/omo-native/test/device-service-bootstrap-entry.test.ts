import { describe, expect, test } from "bun:test"

import { connectDeviceService } from "../../device-service-core/src/index.ts"
import { startFakeOwner } from "../../device-service-core/test/local-api/conformance/fake-owner.ts"
import { defaultWorld } from "../../device-service-core/test/local-api/conformance/world.ts"
import { runDeviceServiceBootstrap } from "../device-service-bootstrap-entry"
import { REMOTE_EXIT } from "../remote-exit"
import { owners, privateDir, SIGNED_IN, testBootstrap, useRemoteCliCleanup } from "./remote-cli-harness"

useRemoteCliCleanup()

// The engine's device-service runner reads this entry's one stdout line (components/device-service/runner.ts): the
// internal entry must answer the same report `omo remote bootstrap --json` did, through service.bootstrap.
async function bootstrap(account: { exitCode: number; stdout: string }) {
  const owner = await startFakeOwner({ stateDir: privateDir(), world: defaultWorld() })
  owners.push(owner)
  const out: string[] = []
  const coldWake: string[] = []
  const code = await runDeviceServiceBootstrap({
    accountShow: async () => account,
    stateDir: owner.stateDir,
    connect: () => connectDeviceService({ version: "5.1.52", stateDir: owner.stateDir }),
    now: () => 0,
    output: (line) => out.push(line),
    write: () => {},
    error: () => {},
    bootstrap: testBootstrap(),
    coldWake: {
      install: async () => (coldWake.push("install"), { kind: "installed", serviceRestarted: false }),
      uninstall: async () => (coldWake.push("uninstall"), { kind: "removed", serviceRestarted: false }),
      status: async () => undefined,
    },
    linkDevice: async () => "linked",
    optOut: { read: () => false, record: () => {}, clear: () => {} },
  })
  return { code, out, coldWake }
}

describe("omo __device-service-bootstrap (the engine's internal bootstrap entry)", () => {
  test("#given a running service at the pin #when the entry runs #then it reports connected with the status on one line and installs the session host unit", async () => {
    const { code, out, coldWake } = await bootstrap(SIGNED_IN)
    expect(code).toBe(REMOTE_EXIT.ok)
    expect(out).toHaveLength(1)
    expect(JSON.parse(out[0] ?? "")).toMatchObject({ state: "connected", status: { state: "connected" } })
    expect(coldWake).toEqual(["install"])
  })

  test("#given no sign-in #when the entry runs #then it reports the stop with its notice and touches no unit", async () => {
    const { code, out, coldWake } = await bootstrap({ exitCode: 0, stdout: JSON.stringify({ signedIn: false }) })
    expect(code).toBe(REMOTE_EXIT.unavailable)
    expect(JSON.parse(out[0] ?? "")).toMatchObject({ state: "signed_out" })
    expect(coldWake).toEqual([])
  })
})
