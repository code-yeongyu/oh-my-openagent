import { describe, expect, test } from "bun:test"
import { createRemoteThreadFixture } from "../omo-senpi/src/components/thread/thread-remote-fixture"
import { personSenderProvenance } from "./remote-session-verbs"

const ENV = { OMO_PROVENANCE_WORKSPACE: "Owner workspace", OMO_PROVENANCE_PROJECT: "sender-project" }

// #13004 (decision 0027 section 3): `omo remote send` creates a delivery like every other path, so it names this device.
describe("omo remote send sender provenance", () => {
  const remoteFixture = createRemoteThreadFixture()

  test("#given the device service names this device #when a person sends from the command line #then the delivery names this device", async () => {
    const account = remoteFixture.account()
    try {
      expect(await personSenderProvenance(account.remote, process.cwd(), ENV)()).toMatchObject({
        workspace: "Owner workspace",
        project: "sender-project",
        device: "here",
      })
    } finally {
      await remoteFixture.cleanup()
    }
  })

  test("#given the device service answers without a device id #when a person sends #then the delivery names why it carries none", async () => {
    const account = remoteFixture.account()
    const unnamed = { ...account.remote, sessions: { ...account.remote.sessions, thisDevice: async () => null } }
    try {
      const provenance = await personSenderProvenance(unnamed, process.cwd(), ENV)()
      expect({ device: provenance.device, device_absent: provenance.device_absent }).toEqual({
        device: undefined,
        device_absent: "no_device_id",
      })
    } finally {
      await remoteFixture.cleanup()
    }
  })
})
