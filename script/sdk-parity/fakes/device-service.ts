import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  fakeClock,
  type FakeClock,
} from "../../../packages/device-service-core/test/local-api/conformance/fake-clock.ts"
import {
  type FakeOwner,
  startFakeOwner,
} from "../../../packages/device-service-core/test/local-api/conformance/fake-owner.ts"
import { refuse } from "../../../packages/device-service-core/test/local-api/conformance/fake-owner-state.ts"
import { defaultWorld } from "../../../packages/device-service-core/test/local-api/conformance/world.ts"
import type { Recorder } from "./recorder"

// The device service that devices.list reads since train 14 (omo#14881: the remote module's listing): device-service-core's
// own conformance owner in a short temp state dir, so its socket path stays under the platform limit. The listing has no
// injectable port but the clock, so the owner's answered requests are the trace, recorded as port `deviceService` with
// the request's type as the operation. The scenario's given state picks the service: `running` (the default world),
// `absent` (no owner: the state dir holds no socket), `silent` (the owner never completes its handshake; the call ends
// at the clock's deadline) or `signed_out` (the owner refuses the listing with the local API's signed_out, through its
// intercept: the device service holds no sign-in, a declared answer of devices.list since omo#14881).

export type DeviceServiceState = "running" | "absent" | "silent" | "signed_out"

export type DeviceServiceFake = {
  readonly stateDir: string
  readonly clock: FakeClock
  readonly start: () => Promise<void>
  readonly stop: () => Promise<void>
}

export function deviceServicePort(recorder: Recorder, needed: boolean): DeviceServiceFake {
  const stateDir = mkdtempSync(join(tmpdir(), "la-"))
  const clock = fakeClock()
  const service = (recorder.given("deviceService")["service"] ?? "running") as DeviceServiceState
  let owner: FakeOwner | undefined
  return {
    stateDir,
    clock,
    start: async () => {
      if (!needed || service === "absent" || owner !== undefined) return
      owner = await startFakeOwner({
        stateDir,
        world: defaultWorld(),
        now: clock.now,
        ...(service === "signed_out"
          ? {
              intercept: (_state, _conn, request) =>
                request.type === "devices.list"
                  ? refuse("signed_out", "this device service holds no sign-in")
                  : undefined,
            }
          : {}),
        ...(service === "silent"
          ? {
              mode: "silent-handshake" as const,
              // The owner keeps its welcome back; the client's deadline then passes on the fake clock at once.
              onWithheld: () => clock.advance(60_000),
            }
          : {}),
        // Reads of the connection's own state (device.info, status) carry no operation of the table and pass unrecorded.
        onRequest: (type) => {
          if (type === "devices.list") recorder.record("deviceService", type)
        },
      })
      if (owner.connections() !== 0) throw new Error("the device service fake started with a connection open")
    },
    stop: async () => {
      await owner?.stop()
      owner = undefined
      rmSync(stateDir, { recursive: true, force: true })
    },
  }
}
