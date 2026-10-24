/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BuiltinBrowserUnavailableError, guardOmowright } from "./skills/browser/scripts/omowright.mjs"

type Json = Record<string, unknown>

function fakeRaw() {
  const calls: Array<[string, ...unknown[]]> = []
  const record =
    (name: string, result: unknown = { from: name }) =>
    async (...args: unknown[]) => {
      calls.push([name, ...args])
      return result
    }
  const raw = {
    calls,
    connectBrowserSkill: record("connectBrowserSkill"),
    connectPipe: record("connectPipe"),
    connectCloakProfile: record("connectCloakProfile"),
    connect: record("connect"),
    createCua: record("createCua"),
    emulate: record("emulate"),
    bskSnapshot: record("bskSnapshot"),
    bskDoctor: record("bskDoctor"),
    DEVICE_PRESETS: { phone: { width: 390 } },
  }
  return raw
}

function fakeHost(answer?: (args: Json) => Json) {
  const log: Array<{ tool: string; args: Json }> = []
  return {
    log,
    async listTools(): Promise<string[]> {
      return ["omo_desktop_toolkit"]
    },
    async callTool(tool: string, args: Json): Promise<Json> {
      log.push({ tool, args })
      return answer === undefined ? { details: { ok: false, reason: "unavailable" } } : answer(args)
    },
  }
}

const RAW_EXPORTS = ["connectBrowserSkill", "connectPipe", "connectCloakProfile", "connect", "createCua", "emulate", "bskSnapshot", "bskDoctor", "DEVICE_PRESETS"] as const

describe("inside OmO Desktop the library is the terminal's, plus the app's built-in browser", () => {
  test("#given no OMO_BROWSER_ENGINE #when the library loads #then it is the raw library", () => {
    const raw = fakeRaw()

    expect(guardOmowright(raw, { env: {}, host: fakeHost() })).toBe(raw)
  })

  for (const engine of ["builtin", "connected", "none", "something-new"]) {
    test(`#given OMO_BROWSER_ENGINE=${engine} #when the library loads #then every export is the terminal's own, and connectBuiltinBrowser is added`, () => {
      const raw = fakeRaw()

      const library = guardOmowright(raw, { env: { OMO_BROWSER_ENGINE: engine }, host: fakeHost() }) as unknown as Record<string, unknown>

      for (const name of RAW_EXPORTS) expect(library[name]).toBe(raw[name])
      expect(typeof library.connectBuiltinBrowser).toBe("function")
    })

    test(`#given OMO_BROWSER_ENGINE=${engine} #when the agent starts its own browser or the user's #then it runs as in the terminal and nothing is asked of the app`, async () => {
      const raw = fakeRaw()
      const host = fakeHost()
      const library = guardOmowright(raw, { env: { OMO_BROWSER_ENGINE: engine }, host })

      expect(await library.connectPipe({ headless: true })).toEqual({ from: "connectPipe" })
      expect(await library.connectBrowserSkill({ name: "task" })).toEqual({ from: "connectBrowserSkill" })

      expect(raw.calls).toEqual([["connectPipe", { headless: true }], ["connectBrowserSkill", { name: "task" }]])
      expect(host.log).toEqual([])
    })
  }
})

describe("the app's built-in browser", () => {
  test("#given app refusals including user Stop #when acquiring or refreshing #then only genuine unavailability permits fallback", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omo-toolkit-refusal-"))
    try {
      const tokenFile = join(dir, "browser.token")
      writeFileSync(tokenFile, "test-token")
      for (const reason of ["user_stopped", "permission_denied", "toString", "unavailable", "timeout", "invalid_grant"]) {
        for (const refresh of [false, true]) {
          let acquireCount = 0
          let authorizer: { resolveAuthorization: (options: { forceRefresh: boolean }) => Promise<string> } | undefined
          const capture = (options: { authorizer: typeof authorizer }) => { authorizer = options.authorizer }
          const raw = {
            ...fakeRaw(),
            connect: async (_url: string, options: { client: { authorizer: typeof authorizer } }) => { capture(options.client); return {} },
            CdpClient: class {
              constructor(options: { authorizer: typeof authorizer }) { capture(options) }
            },
            BrowserConnection: class { async initialize() { return this } },
          }
          const host = fakeHost(() => ({
            details: refresh && acquireCount++ === 0
              ? { ok: true, grant: { endpoint: "http://127.0.0.1:41234/toolkit/browser", tokenFile } }
              : { ok: false, reason },
          }))
          const library = guardOmowright(raw, { env: { OMO_BROWSER_ENGINE: "builtin" }, host })
          const error = await (refresh
            ? library.connectBuiltinBrowser().then(() => {
              if (authorizer === undefined) throw new Error("no authorizer attached")
              return authorizer.resolveAuthorization({ forceRefresh: true })
            })
            : library.connectBuiltinBrowser()).then(() => undefined, (cause: unknown) => cause)
          expect(error).toBeInstanceOf(BuiltinBrowserUnavailableError)
          expect((error as BuiltinBrowserUnavailableError).reason).toBe(reason)
          expect(/connectBrowserSkill|connectPipe/.test((error as Error).message)).toBe(["unavailable", "timeout", "invalid_grant"].includes(reason))
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("#given a missing or unreadable token file #when acquiring #then the failure is typed and no browser attaches", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omo-toolkit-token-"))
    try {
      // Reading a directory is rejected even under a privileged test user, unlike chmod-based fixtures.
      for (const tokenFile of [join(dir, "missing.token"), dir]) {
        const raw = fakeRaw()
        const host = fakeHost(() => ({ details: { ok: true, grant: { endpoint: "http://127.0.0.1:41234/toolkit/browser", tokenFile } } }))
        const library = guardOmowright(raw, { env: { OMO_BROWSER_ENGINE: "builtin" }, host })
        const error = await library.connectBuiltinBrowser().then(() => undefined, (cause: unknown) => cause)
        expect(error).toBeInstanceOf(BuiltinBrowserUnavailableError)
        expect((error as BuiltinBrowserUnavailableError).reason).toBe("invalid_grant")
        expect(raw.calls).toEqual([])
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // Security contract (#10602 review LOW 1): a grant must name its endpoint. Without one, CdpClient falls back to
  // 127.0.0.1:9222 and would send the app's bearer token to whatever browser listens there.
  test("#given a grant without a usable endpoint #when acquiring or refreshing #then invalid_grant, the token is never sent, and the endpoint is unchanged", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omo-toolkit-endpoint-"))
    try {
      const tokenFile = join(dir, "browser.token")
      writeFileSync(tokenFile, "secret-token")
      const goodEndpoint = "http://127.0.0.1:41234/toolkit/browser"
      for (const endpoint of [undefined, "", 9222, null]) {
        for (const onRefresh of [false, true]) {
          let acquireCount = 0
          const cdpUrls: unknown[] = []
          let authorize: (options?: { forceRefresh?: boolean }) => Promise<string> = async () => ""
          const host = fakeHost(() => ({ details: { ok: true, grant: onRefresh && acquireCount++ === 0
            ? { endpoint: goodEndpoint, tokenFile }
            : { endpoint, tokenFile } } }))
          const raw = {
            ...fakeRaw(),
            CdpClient: class {
              constructor(options: { cdpUrl: unknown; authorizer: { resolveAuthorization: typeof authorize } }) {
                cdpUrls.push(options.cdpUrl)
                authorize = options.authorizer.resolveAuthorization
              }
              set cdpUrl(value: unknown) { cdpUrls.push(value) }
            },
            BrowserConnection: class { async initialize() { return { connected: true } } },
          }
          const library = guardOmowright(raw, { env: { OMO_BROWSER_ENGINE: "builtin" }, host })
          const error = await (onRefresh
            ? library.connectBuiltinBrowser().then(() => authorize({ forceRefresh: true }))
            : library.connectBuiltinBrowser()
          ).then(() => undefined, (cause: unknown) => cause)
          expect(error).toBeInstanceOf(BuiltinBrowserUnavailableError)
          expect((error as BuiltinBrowserUnavailableError).reason).toBe("invalid_grant")
          expect(cdpUrls).toEqual(onRefresh ? [goodEndpoint] : [])
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("#given concurrent refreshes #when both force a refresh at once #then one acquire runs and both get the same token for the same endpoint", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omo-toolkit-inflight-"))
    try {
      const firstToken = join(dir, "first.token")
      const secondToken = join(dir, "second.token")
      const thirdToken = join(dir, "third.token")
      writeFileSync(firstToken, "first-token")
      writeFileSync(secondToken, "second-token")
      writeFileSync(thirdToken, "third-token")
      const grants = [
        { endpoint: "http://127.0.0.1:41000/toolkit/browser", tokenFile: firstToken },
        { endpoint: "http://127.0.0.1:42000/toolkit/browser", tokenFile: secondToken },
        { endpoint: "http://127.0.0.1:43000/toolkit/browser", tokenFile: thirdToken },
      ]
      let release: () => void = () => {}
      const held = new Promise<void>((resolve) => { release = resolve })
      let acquireCount = 0
      const host = {
        log: [] as Json[],
        async listTools(): Promise<string[]> { return ["omo_desktop_toolkit"] },
        async callTool(_tool: string, args: Json): Promise<Json> {
          host.log.push(args)
          const grant = grants[acquireCount++]
          if (acquireCount > 1) await held
          return { details: { ok: true, grant } }
        },
      }
      let endpoint: unknown
      let authorize: (options?: { forceRefresh?: boolean }) => Promise<string> = async () => ""
      const raw = {
        ...fakeRaw(),
        CdpClient: class {
          constructor(options: { cdpUrl: unknown; authorizer: { resolveAuthorization: typeof authorize } }) {
            endpoint = options.cdpUrl
            authorize = options.authorizer.resolveAuthorization
          }
          set cdpUrl(value: unknown) { endpoint = value }
        },
        BrowserConnection: class { async initialize() { return { connected: true } } },
      }
      const library = guardOmowright(raw, { env: { OMO_BROWSER_ENGINE: "builtin" }, host })
      await library.connectBuiltinBrowser()
      const both = Promise.all([authorize({ forceRefresh: true }), authorize({ forceRefresh: true })])
      release()
      expect(await both).toEqual(["Bearer second-token", "Bearer second-token"])
      expect(endpoint).toBe(grants[1]?.endpoint)
      expect(host.log).toHaveLength(2)
      expect(await authorize({ forceRefresh: true })).toBe("Bearer third-token")
      expect(endpoint).toBe(grants[2]?.endpoint)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("#given a refreshed grant on another endpoint #when authorization refreshes during connect or later #then endpoint and token rotate together", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omo-toolkit-refresh-"))
    try {
      const firstToken = join(dir, "first.token")
      const nextToken = join(dir, "next.token")
      writeFileSync(firstToken, "first-token")
      writeFileSync(nextToken, "next-token")
      for (const duringConnect of [true, false]) {
        let acquireCount = 0
        let endpoint = ""
        let authorize: (options?: { forceRefresh?: boolean }) => Promise<string> = async () => ""
        const initialEndpoint = "http://127.0.0.1:41234/toolkit/browser"
        const refreshedEndpoint = "http://127.0.0.1:42345/toolkit/browser"
        const host = fakeHost(() => ({ details: { ok: true, grant: acquireCount++ === 0
          ? { endpoint: initialEndpoint, tokenFile: firstToken }
          : { endpoint: refreshedEndpoint, tokenFile: nextToken } } }))
        const initialize = async () => {
          if (duringConnect) {
            expect(await authorize({ forceRefresh: true })).toBe("Bearer next-token")
            expect(endpoint).toBe(refreshedEndpoint)
          }
          return { connected: true }
        }
        const raw = {
          ...fakeRaw(),
          connect: async (url: string, options: { client: { authorizer: { resolveAuthorization: typeof authorize } } }) => {
            endpoint = url
            authorize = options.client.authorizer.resolveAuthorization
            return await initialize()
          },
          CdpClient: class {
            constructor(options: { cdpUrl: string; authorizer: { resolveAuthorization: typeof authorize } }) {
              endpoint = options.cdpUrl
              authorize = options.authorizer.resolveAuthorization
            }
            set cdpUrl(value: string) { endpoint = value }
          },
          BrowserConnection: class { initialize = initialize },
        }
        const library = guardOmowright(raw, { env: { OMO_BROWSER_ENGINE: "builtin" }, host })
        expect(await library.connectBuiltinBrowser()).toEqual({ connected: true })
        if (!duringConnect) {
          expect(await authorize()).toBe("Bearer first-token")
          expect(await authorize({ forceRefresh: true })).toBe("Bearer next-token")
          expect(endpoint).toBe(refreshedEndpoint)
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("#given the app grants it #when connectBuiltinBrowser runs #then OmOWright attaches to the granted endpoint with the token file's token, and re-acquires on refresh", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omo-toolkit-test-"))
    try {
      const tokenFile = join(dir, "browser.token")
      writeFileSync(tokenFile, "first-token\n", { mode: 0o600 })
      const grant = { endpoint: "http://127.0.0.1:41234/toolkit/browser", tokenFile }
      const host = fakeHost(() => ({ details: { ok: true, grant } }))
      const attached: Array<{ url: string; options: { client: { authorizer: { resolveAuthorization: (o?: { forceRefresh?: boolean }) => Promise<string> } } } }> = []
      const raw = {
        ...fakeRaw(),
        CdpClient: class {
          constructor(options: { cdpUrl: string; authorizer: typeof attached[number]["options"]["client"]["authorizer"] }) {
            attached.push({ url: options.cdpUrl, options: { client: { authorizer: options.authorizer } } })
          }
        },
        BrowserConnection: class { async initialize() { return { kind: "connection" } } },
      }
      const library = guardOmowright(raw, { env: { OMO_BROWSER_ENGINE: "connected" }, host }) as unknown as { connectBuiltinBrowser: () => Promise<unknown> }

      expect(await library.connectBuiltinBrowser()).toEqual({ kind: "connection" })
      expect(attached[0]?.url).toBe(grant.endpoint)
      const first = attached[0]
      if (first === undefined) throw new Error("no client attached")
      const authorizer = first.options.client.authorizer
      expect(await authorizer.resolveAuthorization()).toBe("Bearer first-token")
      writeFileSync(tokenFile, "rotated-token\n", { mode: 0o600 })
      expect(await authorizer.resolveAuthorization({ forceRefresh: true })).toBe("Bearer rotated-token")
      expect(host.log).toEqual([
        { tool: "omo_desktop_toolkit", args: { op: "acquire", toolkit: "browser" } },
        { tool: "omo_desktop_toolkit", args: { op: "acquire", toolkit: "browser" } },
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("#given the app does not offer it #when connectBuiltinBrowser runs #then one plain error says why and that the other browsers work as usual, and no browser is attached", async () => {
    for (const [details, reason] of [
      [{ ok: false, reason: "unavailable" }, "unavailable"],
      [{ ok: false, reason: "timeout" }, "timeout"],
      [undefined, "unavailable"],
    ] as const) {
      const raw = fakeRaw()
      const library = guardOmowright(raw, { env: { OMO_BROWSER_ENGINE: "builtin" }, host: fakeHost(() => (details === undefined ? {} : { details })) }) as unknown as {
        connectBuiltinBrowser: () => Promise<unknown>
      }

      const error = await library.connectBuiltinBrowser().then(() => undefined, (cause: unknown) => cause)

      expect((error as { code?: string }).code).toBe("browser_builtin_unavailable")
      expect((error as { reason?: string }).reason).toBe(reason)
      expect(raw.calls).toEqual([])
    }
  })

  test("#given a kernel without the app's toolkit #when connectBuiltinBrowser runs #then the same plain error, nothing attached", async () => {
    const raw = fakeRaw()
    const library = guardOmowright(raw, { env: { OMO_BROWSER_ENGINE: "builtin" }, host: undefined }) as unknown as { connectBuiltinBrowser: () => Promise<unknown> }

    const error = await library.connectBuiltinBrowser().then(() => undefined, (cause: unknown) => cause)

    expect((error as { code?: string }).code).toBe("browser_builtin_unavailable")
    expect(raw.calls).toEqual([])
  })
})
