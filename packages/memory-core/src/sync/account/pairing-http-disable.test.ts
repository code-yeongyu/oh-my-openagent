import { expect, test } from "bun:test"

import { AccountHttpError } from "./http.ts"
import { createPairingHttp } from "./pairing-http.ts"

interface Seen {
  readonly method: string
  readonly path: string
  readonly body: unknown
}

/** A service that records each request and answers from the script; no socket, no clock. */
function service(reply: (seen: Seen) => Response) {
  const seen: Seen[] = []
  const pairing = createPairingHttp({
    baseUrl: "https://service.invalid",
    token: () => "access",
    fetch: Object.assign(
      async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const request: Seen = {
          method: init?.method ?? "GET",
          path: new URL(String(input)).pathname,
          body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
        }
        seen.push(request)
        return reply(request)
      },
      { preconnect: fetch.preconnect },
    ),
  })
  return { pairing, seen }
}

const refusal = (status: number, code: string): Response => Response.json({ error: { code } }, { status })
const ready = (token: string | null): Response =>
  Response.json({
    ready: true,
    code: null,
    at: "2026-11-17T00:00:00.000Z",
    token,
    expiresAt: "2026-11-17T00:10:00.000Z",
  })

test("#given a live device #when its sync is turned off #then the confirmation is asked for that device and its token is spent on the switch", async () => {
  const { pairing, seen } = service((request) =>
    request.path === "/v1/confirm" ? ready("confirm-token") : new Response(null, { status: 204 }),
  )
  expect(await pairing.disableDeviceSync("dev 1")).toEqual({ ok: true })
  expect(seen).toEqual([
    { method: "POST", path: "/v1/confirm", body: { action: "sync.disable_device", target: "dev 1" } },
    { method: "PUT", path: "/v1/devices/dev%201/sync", body: { enabled: false, confirmToken: "confirm-token" } },
  ])
})

test("#given a device the service no longer lists #when its sync is turned off #then the refusal code is the answer and no switch is sent", async () => {
  const { pairing, seen } = service(() =>
    Response.json({ ready: false, code: "not_found", at: "2026-11-17T00:00:00.000Z", token: null, expiresAt: null }),
  )
  expect(await pairing.disableDeviceSync("dev_gone")).toEqual({ ok: false, code: "not_found" })
  expect(seen.map((request) => request.path)).toEqual(["/v1/confirm"])
})

test("#given the service refuses the switch #when its sync is turned off #then the closed refusal code is the answer", async () => {
  const { pairing } = service((request) =>
    request.path === "/v1/confirm" ? ready("confirm-token") : refusal(409, "conflict"),
  )
  expect(await pairing.disableDeviceSync("dev_1")).toEqual({ ok: false, code: "conflict" })
})

test("#given a failing service #when its sync is turned off #then the call throws instead of reporting a refusal", async () => {
  const { pairing } = service(() => refusal(503, "internal"))
  const error = await pairing.disableDeviceSync("dev_1").catch((thrown: unknown) => thrown)
  expect(error).toBeInstanceOf(AccountHttpError)
  expect(error).toMatchObject({ code: "unavailable", status: 503 })
})

test("#given a ready confirmation that carries no token #when its sync is turned off #then the reply is malformed and no switch is sent without a token", async () => {
  const { pairing, seen } = service(() => ready(null))
  await expect(pairing.disableDeviceSync("dev_1")).rejects.toMatchObject({ code: "malformed_reply" })
  expect(seen.map((request) => request.path)).toEqual(["/v1/confirm"])
})
