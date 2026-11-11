import { describe, expect, test } from "bun:test"
import type { DeviceService } from "../device-service-core/src/index.ts"
import { createRemoteThreadFixture } from "../omo-senpi/src/components/thread/thread-remote-fixture"
import type { RemoteCommandDependencies } from "./remote-cli"
import { REMOTE_EXIT } from "./remote-exit"
import { personSenderProvenance, runSession } from "./remote-session-verbs"

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

describe("omo remote open connection", () => {
  test("#given the CLI holds one shared device-service connection #when open runs #then open_session rides a fresh connection that is closed and the shared connection stays open", async () => {
    const calls: string[] = []
    const opened = {
      outcome: { type: "event", kind: "session.command_state", command_id: "c", state: "engine_applied" },
      response: {
        type: "response",
        command: "open_session",
        success: true,
        data: { sessionId: "engine-1" },
      },
      located: { key: "s-new", session: "b.s-new" },
    }
    const service = (name: string): { readonly conn: DeviceService; readonly wasClosed: () => boolean } => {
      let closed = false
      const conn = {
        status: async () => {
          calls.push(`${name}:status`)
          return { state: "connected" }
        },
        devices: async () => {
          calls.push(`${name}:devices`)
          return [{ device: "b", label: "studio", kind: "desktop", platform: "darwin", last_seen_ms: 1, online: true }]
        },
        attach: async () => {
          calls.push(`${name}:attach`)
          return { onEvent: () => () => {}, detached: new Promise(() => {}) }
        },
        endpointCommand: async () => {
          calls.push(`${name}:endpoint`)
          return opened
        },
        close: () => {
          closed = true
          calls.push(`${name}:close`)
        },
        closed: new Promise(() => {}),
      } as unknown as DeviceService
      return { conn, wasClosed: () => closed }
    }
    const shared = service("shared")
    const dialed: Array<ReturnType<typeof service>> = []
    const lines: string[] = []
    const errors: string[] = []
    const dependencies = {
      connect: async () => {
        const next = service("dialed")
        dialed.push(next)
        return next.conn
      },
      output: (line: string) => {
        lines.push(line)
      },
      error: (line: string) => {
        errors.push(line)
      },
      write: () => {},
      now: () => 0,
      stateDir: "/unused",
      accountShow: async () => {
        throw new Error("account show is not part of open")
      },
      localPermissionPreset: () => "full-access",
    } as RemoteCommandDependencies
    const code = await runSession(
      shared.conn,
      { verb: "open", device: "b", permissionPreset: "full-access" },
      false,
      dependencies,
    )
    expect({ code, errors, calls, dialed: dialed.length, sharedClosed: shared.wasClosed() }).toEqual({
      code: REMOTE_EXIT.ok,
      errors: [],
      calls: ["shared:status", "shared:devices", "dialed:endpoint", "dialed:close", "shared:attach"],
      dialed: 1,
      sharedClosed: false,
    })
    expect(dialed[0]?.wasClosed()).toBe(true)
    expect(lines.length).toBeGreaterThan(0)
  })
})
