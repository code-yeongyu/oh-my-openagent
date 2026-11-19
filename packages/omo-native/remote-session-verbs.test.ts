import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { deviceServiceEndpointPath } from "../device-service-core/src/index.ts"
import { describe, expect, test, onTestFinished } from "bun:test"
import type { DeviceService } from "../device-service-core/src/index.ts"
import { createRemoteThreadFixture, fakeRemoteClient } from "../omo-senpi/src/components/thread/thread-remote-fixture"
import type { RemoteCommandDependencies } from "./remote-cli"
import { REMOTE_EXIT } from "./remote-exit"
import { parseSession } from "./remote-session-args"
import { personSenderProvenance, runSession } from "./remote-session-verbs"

// The command reaches its client through the state dir it is connected on; a connected device service has its endpoint file there.
const connectedStateDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "omo-remote-open-"))
  mkdirSync(dirname(deviceServiceEndpointPath(dir)), { recursive: true })
  writeFileSync(deviceServiceEndpointPath(dir), "")
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

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
    const unnamed = {
      ...account.remote,
      client: fakeRemoteClient({ state: () => "connected", here: null, devices: () => [] }),
    }
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
        thisDevice: async () => null,
        capabilities: [],
        devices: async () => {
          calls.push(`${name}:devices`)
          return [{ device: "b", label: "studio", kind: "desktop", platform: "darwin", last_seen_ms: 1, online: true }]
        },
        attach: async () => {
          calls.push(`${name}:attach`)
          return { onEvent: () => () => {}, detached: new Promise(() => {}), detach: async () => {} }
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
      stateDir: connectedStateDir(),
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
      // The readiness check reads the state; the client's device list reads it again in its own round.
      calls: ["shared:status", "shared:devices", "shared:status", "dialed:endpoint", "dialed:close"],
      dialed: 1,
      sharedClosed: false,
    })
    expect(dialed[0]?.wasClosed()).toBe(true)
    expect(lines.length).toBeGreaterThan(0)
  })
})

// #14074: the sessions port owns the attach pool; a verb that left it open kept an idle-detach timer armed after the
// command returned, and in one test process that timer fired into a later test.
describe("omo remote session verbs close what they opened", () => {
  const remoteFixture = createRemoteThreadFixture()

  test("#given a session verb ran over the device-service surface #when it returns #then its sessions port was closed once (#14074)", async () => {
    const account = remoteFixture.account()
    let closes = 0
    const sessions = new Proxy(account.remote.sessions, {
      get: (target, key) =>
        key === "close"
          ? async () => {
              closes += 1
              await target.close?.()
            }
          : Reflect.get(target, key, target),
    })
    const lines: string[] = []
    const dependencies = {
      connect: async () => {
        throw new Error("the verb reaches the device through the injected surface")
      },
      output: (line: string) => lines.push(line),
      error: (line: string) => lines.push(line),
      write: () => {},
      now: () => 0,
      stateDir: connectedStateDir(),
      accountShow: async () => {
        throw new Error("account show is not part of a session verb")
      },
      remote: () => ({ ...account.remote, sessions }),
    } as unknown as RemoteCommandDependencies
    try {
      await runSession(
        {} as DeviceService,
        parseSession("interrupt", ["b/no-such-session"]).session,
        true,
        dependencies,
      )
      expect({ closes, answered: lines.length > 0 }).toEqual({ closes: 1, answered: true })
    } finally {
      await remoteFixture.cleanup()
    }
  })
})

// #13425: a waiting send settles typed inside a bound; the queue notice and session end reach --json too.
describe("omo remote send bounded settle (#13425)", () => {
  const remoteFixture = createRemoteThreadFixture()

  test("#given the session closes before the turn settles #when the send waits under --json #then one JSON value answers session_ended", async () => {
    const account = remoteFixture.account({
      records: [{ type: "agent_settled", reason: "session_closed" }],
    })
    const out: string[] = []
    const dependencies = {
      connect: async () => {
        throw new Error("the verb reaches the device through the injected surface")
      },
      output: (line: string) => out.push(line),
      error: () => {},
      write: () => {},
      now: () => 0,
      stateDir: connectedStateDir(),
      accountShow: async () => {
        throw new Error("account show is not part of a session verb")
      },
      remote: () => account.remote,
    } as unknown as RemoteCommandDependencies
    try {
      const code = await runSession(
        {} as DeviceService,
        parseSession("send", ["--timeout", "5", "b/rk-on-b", "ping"]).session,
        true,
        dependencies,
      )
      const parsed = JSON.parse(out[0] ?? "{}")
      expect({ code, kind: parsed.kind, end: parsed.end }).toEqual({
        code: REMOTE_EXIT.failed,
        kind: "session_ended",
        end: "session_closed",
      })
    } finally {
      await remoteFixture.cleanup()
    }
  })

  test("#given a turn that never settles #when a person waits with --timeout #then the send answers a typed timeout inside the bound", async () => {
    const account = remoteFixture.account()
    const out: string[] = []
    const errors: string[] = []
    const started = Date.now()
    const dependencies = {
      connect: async () => {
        throw new Error("the verb reaches the device through the injected surface")
      },
      output: (line: string) => out.push(line),
      error: (line: string) => errors.push(line),
      write: () => {},
      now: () => 0,
      stateDir: connectedStateDir(),
      accountShow: async () => {
        throw new Error("account show is not part of a session verb")
      },
      remote: () => account.remote,
    } as unknown as RemoteCommandDependencies
    try {
      const code = await runSession(
        {} as DeviceService,
        parseSession("send", ["--timeout", "1", "b/rk-on-b", "ping"]).session,
        true,
        dependencies,
      )
      const waited = Date.now() - started
      const parsed = JSON.parse(out[0] ?? "{}")
      expect({ code, kind: parsed.kind, waitedUnderBound: waited < 10_000 }).toEqual({
        code: REMOTE_EXIT.failed,
        kind: "timeout",
        waitedUnderBound: true,
      })
    } finally {
      await remoteFixture.cleanup()
    }
  })
})
