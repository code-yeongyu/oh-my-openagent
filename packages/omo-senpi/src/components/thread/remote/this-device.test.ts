import { describe, expect, test } from "bun:test"
import type { Provenance } from "../gateway/types"
import { fakeRemoteClient } from "../thread-remote-fixture"
import type { RemoteThreadSurface } from "./ports"
import { stampThisDevice } from "./this-device"

// #13004 (decision 0027 section 3): every delivery names the device it left, the person's `omo remote send` included,
// which now runs on the remote module's person send (#13414 4c-2) and stamps through this one function.

const SENDER: Provenance = { workspace: "Owner workspace", project: "sender-project" } as Provenance

const surface = (here: string | null): RemoteThreadSurface =>
  ({
    client: fakeRemoteClient({
      state: () => "connected",
      here,
      devices: () => (here === null ? [] : [{ device: here, label: "This Mac", online: true }]),
    }),
    sessions: {},
    chain: { stamp: (record: unknown) => record },
  }) as unknown as RemoteThreadSurface

describe("stampThisDevice", () => {
  test("#given the device service names this device #when a delivery is stamped #then it names this device", async () => {
    expect(await stampThisDevice(Promise.resolve(SENDER), surface("dev-self"))).toMatchObject({
      workspace: "Owner workspace",
      project: "sender-project",
      device: "dev-self",
    })
  })

  test("#given the device service answers without a device id #when a delivery is stamped #then it names why it carries none", async () => {
    const stamped = await stampThisDevice(Promise.resolve(SENDER), surface(null))
    expect({ device: "device" in stamped ? stamped.device : undefined, device_absent: stamped.device_absent }).toEqual({
      device: undefined,
      device_absent: "no_device_id",
    })
  })
})
