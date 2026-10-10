import { describe, expect, it } from "bun:test"
import { createConnection } from "node:net"

import { startCallbackServer } from "./oauth-authorization-flow"

const HOSTNAME = "127.0.0.1"
const CALLBACK_PATH = "/callback"
const STATE = "known-state"

type RawResponse = { readonly status: number; readonly body: string }

function rawGet(port: number, path: string, host = `${HOSTNAME}:${port}`): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: HOSTNAME, port }, () => {
      socket.write(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`)
    })
    let data = ""
    socket.on("data", (chunk: Buffer) => {
      data += chunk.toString()
    })
    socket.on("error", reject)
    socket.on("close", () => {
      const status = Number(/^HTTP\/1\.1 (\d+)/.exec(data)?.[1] ?? 0)
      const body = data.slice(data.indexOf("\r\n\r\n") + 4)
      resolve({ status, body })
    })
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

// Every flow in this file is driven to a real terminal outcome, so no server is left listening.
function start(port: number): Promise<{ code: string; state: string }> {
  return startCallbackServer(port, { expectedPath: CALLBACK_PATH, expectedState: STATE })
}

describe("startCallbackServer request scoping", () => {
  it("#given a callback server #when a request arrives on a different path #then it is answered 404 and the real callback still resolves the flow", async () => {
    // given
    const port = 45921
    const flow = start(port)

    // when
    const stray = await rawGet(port, "/totally/different?code=ATTACKER&state=ATTACKER")
    const accepted = await rawGet(port, `${CALLBACK_PATH}?code=REAL-CODE&state=${STATE}`)

    // then
    expect(stray.status).toBe(404)
    expect(accepted.status).toBe(200)
    await expect(flow).resolves.toEqual({ code: "REAL-CODE", state: STATE })
  })

  it("#given a callback server #when a browser sends a speculative favicon request #then the flow survives and still resolves", async () => {
    // given
    const port = 45922
    const flow = start(port)

    // when
    const favicon = await rawGet(port, "/favicon.ico")
    const accepted = await rawGet(port, `${CALLBACK_PATH}?code=AFTER-FAVICON&state=${STATE}`)

    // then
    expect(favicon.status).toBe(404)
    expect(accepted.status).toBe(200)
    await expect(flow).resolves.toEqual({ code: "AFTER-FAVICON", state: STATE })
  })

  it("#given a callback server #when an error callback arrives on a different path #then it is ignored and the real callback still resolves", async () => {
    // given
    const port = 45923
    const flow = start(port)

    // when
    const stray = await rawGet(port, "/elsewhere?error=access_denied&error_description=no")
    const accepted = await rawGet(port, `${CALLBACK_PATH}?code=C&state=${STATE}`)

    // then
    expect(stray.status).toBe(404)
    expect(accepted.status).toBe(200)
    await expect(flow).resolves.toEqual({ code: "C", state: STATE })
  })

  it("#given a callback server #when a callback arrives with a wrong state #then it is refused and the flow waits for the real one", async () => {
    // given
    const port = 45924
    const flow = start(port)

    // when
    const spoofed = await rawGet(port, `${CALLBACK_PATH}?code=STOLEN&state=WRONG-STATE`)
    const accepted = await rawGet(port, `${CALLBACK_PATH}?code=REAL&state=${STATE}`)

    // then
    expect(spoofed.status).toBe(400)
    expect(accepted.status).toBe(200)
    await expect(flow).resolves.toEqual({ code: "REAL", state: STATE })
  })

  it("#given a callback server #when a callback omits the code #then it is refused and the flow waits for the real one", async () => {
    // given
    const port = 45925
    const flow = start(port)

    // when
    const missingCode = await rawGet(port, `${CALLBACK_PATH}?state=${STATE}`)
    const accepted = await rawGet(port, `${CALLBACK_PATH}?code=REAL&state=${STATE}`)

    // then
    expect(missingCode.status).toBe(400)
    expect(accepted.status).toBe(200)
    await expect(flow).resolves.toEqual({ code: "REAL", state: STATE })
  })

  it("#given a callback server #when an error callback arrives on the callback path #then the flow rejects with the provider description", async () => {
    // given
    const port = 45926
    const flow = start(port)
    // Attach the rejection handler before the request so the rejection is never unhandled.
    const rejection = flow.then(
      () => "resolved",
      (error: Error) => error.message,
    )

    // when
    const refused = await rawGet(port, `${CALLBACK_PATH}?error=access_denied&error_description=user%20refused`)

    // then
    expect(refused.status).toBe(400)
    expect(await rejection).toContain("user refused")
  })

  it("#given a callback server #when the real callback arrives first #then the flow resolves without waiting for the timeout", async () => {
    // given
    const port = 45927
    const flow = start(port)

    // when
    const accepted = await rawGet(port, `${CALLBACK_PATH}?code=IMMEDIATE&state=${STATE}`)

    // then
    expect(accepted.status).toBe(200)
    await expect(flow).resolves.toEqual({ code: "IMMEDIATE", state: STATE })
  })

  it("#given a resolved callback server #when a second callback arrives #then it does not change the already-settled result", async () => {
    // given
    const port = 45928
    const flow = start(port)
    const accepted = await rawGet(port, `${CALLBACK_PATH}?code=FIRST&state=${STATE}`)
    expect(accepted.status).toBe(200)

    // when: the server has closed, so the second attempt cannot reach it
    await sleep(50)
    const second = await rawGet(port, `${CALLBACK_PATH}?code=SECOND&state=${STATE}`).catch(() => ({ status: 0, body: "" }))

    // then
    expect(second.status).toBe(0)
    await expect(flow).resolves.toEqual({ code: "FIRST", state: STATE })
  })
})
