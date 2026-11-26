import { ApiRefusal, type Credentials, RequestFailure } from "@oh-my-opencode/account-core"

import type { AccessPorts } from "../../../packages/omo-senpi/src/components/omo-sdk/access"
import type { Recorder } from "./recorder"

// The account ports (credentialStore, session) over one recorder. The session port is the account service's HTTP
// client, so each request is named by the operation its path and method are: GET /v1/devices is `devices.list`, PATCH
// /v1/devices/<id> is `devices.rename {id, name}`, GET /v1/me is `me`. A stated stimulus becomes the service's own
// answer: a device list, `{ error: { status, code } }` an ApiRefusal, `{ error: "request_failed" }` a RequestFailure.

const SIGNED_IN_DEVICE = { id: "dev-1", name: "laptop" } as const

const credentials = (device: { readonly id: string; readonly name: string }): Credentials => ({
  accessToken: "fake-access-token",
  accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
  refreshToken: "fake-refresh-token",
  device,
  signingPrivateKey: "fake-signing-key",
  sealingPrivateKey: "fake-sealing-key",
})

function thrown(result: unknown): Error | undefined {
  const error = typeof result === "object" && result !== null ? Reflect.get(result, "error") : undefined
  if (error === undefined) return undefined
  if (error === "request_failed") return new RequestFailure(true)
  const status = Reflect.get(Object(error), "status")
  const code = Reflect.get(Object(error), "code")
  if (typeof status === "number") return new ApiRefusal(typeof code === "string" ? code : "refused", status)
  return new Error(`fake session: unreadable stimulus ${JSON.stringify(result)}`)
}

const listed = (devices: readonly object[]) => ({
  devices: devices.map((device) => ({ current: false, revokedAt: null, ...device })),
})

function operation(path: string, init: RequestInit): { op: string; args: Record<string, unknown> } {
  const method = (init.method ?? "GET").toUpperCase()
  if (path === "/v1/devices" && method === "GET") return { op: "devices.list", args: {} }
  if (path === "/v1/me" && method === "GET") return { op: "me", args: {} }
  const renamed = /^\/v1\/devices\/([^/]+)$/.exec(path)
  if (renamed !== null && method === "PATCH") {
    const body = typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {}
    return { op: "devices.rename", args: { id: decodeURIComponent(renamed[1] ?? ""), name: body["name"] } }
  }
  throw new Error(`fake session: ${method} ${path} is not an account operation this fake knows`)
}

export function accountPorts(recorder: Recorder, options: { readonly desktopLaunch?: boolean } = {}): AccessPorts {
  return {
    desktopLaunch: () => options.desktopLaunch === true,
    credentialStore: {
      read: async () => {
        const { result } = recorder.record("credentialStore", "read")
        if (result === null) return null
        const device = Reflect.get(Object(result), "device") as Credentials["device"] | undefined
        return credentials(device ?? SIGNED_IN_DEVICE)
      },
    },
    session: {
      accessToken: async () => "fake-access-token",
      request: async (path, init) => {
        const { op, args } = operation(path, init)
        const { result } = recorder.record("session", op, args)
        const failure = thrown(result)
        if (failure !== undefined) throw failure
        if (op === "devices.list") return listed(Array.isArray(result) ? result : [SIGNED_IN_DEVICE])
        return result ?? {}
      },
    },
  }
}
