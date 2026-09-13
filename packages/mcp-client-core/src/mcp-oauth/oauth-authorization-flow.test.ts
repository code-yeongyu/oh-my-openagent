import { describe, expect, it } from "bun:test"
import { createConnection } from "node:net"
import { findAvailablePort } from "./callback-server"
import { runAuthorizationCodeRedirect } from "./oauth-authorization-flow"

const HOST = "127.0.0.1"

function isPortAcceptingConnections(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: HOST, port })
    let settled = false

    const finish = (accepting: boolean): void => {
      if (settled) {
        return
      }
      settled = true
      socket.destroy()
      resolve(accepting)
    }

    socket.once("connect", () => finish(true))
    socket.once("error", () => finish(false))
    socket.setTimeout(500, () => finish(false))
  })
}

function withWatchdog<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  const watchdog = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`flow did not complete within ${timeoutMs}ms`)), timeoutMs)
  })
  return Promise.race([promise, watchdog]).finally(() => {
    if (timer !== null) {
      clearTimeout(timer)
    }
  })
}

describe("runAuthorizationCodeRedirect", () => {
  describe("#given an injected browser opener", () => {
    it("#when the redirect flow completes #then the opener receives exactly the returned authorization url", async () => {
      // given
      const port = await findAvailablePort(19893)
      const openedUrls: string[] = []

      // when
      const result = await withWatchdog(
        runAuthorizationCodeRedirect({
          authorizationEndpoint: "https://auth.example.com/authorize",
          callbackPort: port,
          clientId: "test-client",
          redirectUri: `http://${HOST}:${port}/callback`,
          openBrowser: async (authorizationUrl) => {
            openedUrls.push(authorizationUrl)
            const state = new URL(authorizationUrl).searchParams.get("state")
            const callbackResponse = await fetch(
              `http://${HOST}:${port}/callback?code=test-code&state=${state ?? ""}`,
              { headers: { connection: "close" } },
            )
            await callbackResponse.arrayBuffer()
          },
        }),
        5_000,
      )

      // then
      expect(openedUrls).toHaveLength(1)
      expect(result.authorizationUrl).toBe(openedUrls[0])
      expect(new URL(result.authorizationUrl).searchParams.get("client_id")).toBe("test-client")
      expect(new URL(result.authorizationUrl).searchParams.get("redirect_uri")).toBe(
        `http://${HOST}:${port}/callback`,
      )
      expect(result.code).toBe("test-code")
      expect(result.verifier.length).toBeGreaterThan(0)
    })

    it("#when the opener is invoked #then the callback server already accepts connections", async () => {
      // given
      const port = await findAvailablePort(19893)
      const readinessAtOpen: boolean[] = []
      const acceptingBeforeFlow = await isPortAcceptingConnections(port)

      // when
      await withWatchdog(
        runAuthorizationCodeRedirect({
          authorizationEndpoint: "https://auth.example.com/authorize",
          callbackPort: port,
          clientId: "test-client",
          redirectUri: `http://${HOST}:${port}/callback`,
          openBrowser: async (authorizationUrl) => {
            readinessAtOpen.push(await isPortAcceptingConnections(port))
            const state = new URL(authorizationUrl).searchParams.get("state")
            const callbackResponse = await fetch(
              `http://${HOST}:${port}/callback?code=test-code&state=${state ?? ""}`,
              { headers: { connection: "close" } },
            )
            await callbackResponse.arrayBuffer()
          },
        }),
        5_000,
      )

      // then
      expect(acceptingBeforeFlow).toBe(false)
      expect(readinessAtOpen).toEqual([true])
    })
  })

  describe("#given a browser opener that fails", () => {
    it("#when the flow attempts the browser open #then the flow rejects with the authorization url and closes the server", async () => {
      // given
      const port = await findAvailablePort(19893)

      // when
      const flowResult = withWatchdog(
        runAuthorizationCodeRedirect({
          authorizationEndpoint: "https://auth.example.com/authorize",
          callbackPort: port,
          clientId: "test-client",
          redirectUri: `http://${HOST}:${port}/callback`,
          openBrowser: () => Promise.reject(new Error("no browser available")),
        }),
        5_000,
      )

      // then
      const error: Error = await flowResult.then(
        () => {
          throw new Error("expected the flow to reject")
        },
        (rejection: unknown) => {
          if (rejection instanceof Error) {
            return rejection
          }
          throw new Error("expected the flow to reject with an Error")
        },
      )
      expect(error.message).toContain("Failed to open browser for OAuth authorization (no browser available)")
      expect(error.message).toContain("Open the URL manually: https://auth.example.com/authorize?")

      let serverClosed = false
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (!(await isPortAcceptingConnections(port))) {
          serverClosed = true
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      expect(serverClosed).toBe(true)
    })
  })
})
