/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import {
  createAnonymousOpenCodeTmuxServerAccess,
  createOpenCodeTmuxServerAccess,
  normalizeOpenCodeTmuxServerTarget,
  type ResolvedOpenCodeServerTarget,
} from "./opencode-server-access"

type FetchContact = {
  readonly authorization: string | null
  readonly redirect: RequestInit["redirect"]
  readonly url: string
}

type Deferred<T> = {
  readonly promise: Promise<T>
  resolve(value: T): void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function createFetchRecorder(contacts: FetchContact[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    contacts.push({
      authorization: new Headers(init?.headers).get("authorization"),
      redirect: init?.redirect,
      url: input.toString(),
    })
    return new Response(null, { status: 200 })
  }) as typeof fetch
}

function trustedTarget(): ResolvedOpenCodeServerTarget {
  return {
    serverUrl: "http://127.0.0.1:5317",
    source: "current-context",
    trusted: true,
  }
}

describe("OpenCode tmux server access", () => {
  it("uses lazy Basic auth and defaults a missing username to opencode", async () => {
    const contacts: FetchContact[] = []
    const environment = { OPENCODE_SERVER_PASSWORD: "password-only" }
    const access = createOpenCodeTmuxServerAccess(trustedTarget(), {
      fetchImplementation: createFetchRecorder(contacts),
      getEnvironment: () => environment,
    })

    expect(await access.checkServerHealth()).toBe(true)
    expect(contacts).toEqual([{
      authorization: `Basic ${Buffer.from("opencode:password-only", "utf8").toString("base64")}`,
      redirect: "error",
      url: "http://127.0.0.1:5317/global/health",
    }])
    expect(access.getPaneEnvironment()).toEqual({
      OPENCODE_SERVER_PASSWORD: "password-only",
      OPENCODE_SERVER_USERNAME: "opencode",
    })
  })

  it("preserves an explicit empty username and UTF-8 credentials", async () => {
    const contacts: FetchContact[] = []
    const environment = {
      OPENCODE_SERVER_PASSWORD: "päss🔐",
      OPENCODE_SERVER_USERNAME: "",
    }
    const access = createOpenCodeTmuxServerAccess(trustedTarget(), {
      fetchImplementation: createFetchRecorder(contacts),
      getEnvironment: () => environment,
    })

    await access.checkServerHealth()

    expect(contacts[0]?.authorization).toBe(
      `Basic ${Buffer.from(":päss🔐", "utf8").toString("base64")}`,
    )
    expect(access.getPaneEnvironment()).toEqual({
      OPENCODE_SERVER_PASSWORD: "päss🔐",
      OPENCODE_SERVER_USERNAME: { kind: "set", value: "" },
    })
  })

  it("keeps a healthy synthetic canonical fallback anonymous and clears pane credentials", async () => {
    const contacts: FetchContact[] = []
    const ambientCredentialCanary = ["must", "not", "cross"].join("-")
    const ambientIdentityCanary = [ambientCredentialCanary, "user"].join("-")
    const access = createOpenCodeTmuxServerAccess({
      serverUrl: "http://localhost:4096",
      source: "synthetic-fallback",
      trusted: false,
    }, {
      fetchImplementation: createFetchRecorder(contacts),
      getEnvironment: () => ({
        OPENCODE_SERVER_PASSWORD: ambientCredentialCanary,
        OPENCODE_SERVER_USERNAME: ambientIdentityCanary,
      }),
    })

    expect(await access.checkServerHealth()).toBe(true)
    expect(contacts[0]?.authorization).toBeNull()
    expect(access.getPaneEnvironment()).toEqual({
      OPENCODE_SERVER_PASSWORD: "",
      OPENCODE_SERVER_USERNAME: "",
    })
  })

  it("converts raw and historical URLs to anonymous access", async () => {
    const contacts: FetchContact[] = []
    const access = createAnonymousOpenCodeTmuxServerAccess("http://127.0.0.1:5318", {
      fetchImplementation: createFetchRecorder(contacts),
      getEnvironment: () => ({ OPENCODE_SERVER_PASSWORD: "ambient-secret" }),
    })

    await access.checkServerHealth()

    expect(contacts[0]?.authorization).toBeNull()
    expect(access.getPaneEnvironment()).toEqual({
      OPENCODE_SERVER_PASSWORD: "",
      OPENCODE_SERVER_USERNAME: "",
    })
    const existing = normalizeOpenCodeTmuxServerTarget(access)
    expect(existing).toBe(access)
  })

  it("normalizes a raw string itself to cleared anonymous pane access", () => {
    const access = normalizeOpenCodeTmuxServerTarget("http://127.0.0.1:5318")

    expect(access.serverUrl).toBe("http://127.0.0.1:5318")
    expect(access.getPaneEnvironment()).toEqual({
      OPENCODE_SERVER_PASSWORD: "",
      OPENCODE_SERVER_USERNAME: "",
    })
  })

  it("actively clears both pane variables for a trusted listener without a password", () => {
    const access = createOpenCodeTmuxServerAccess(trustedTarget(), {
      getEnvironment: () => ({ OPENCODE_SERVER_USERNAME: "stale-user" }),
    })

    expect(access.getPaneEnvironment()).toEqual({
      OPENCODE_SERVER_PASSWORD: "",
      OPENCODE_SERVER_USERNAME: "",
    })
  })

  it("rechecks health and returns current pane values after credential rotation", async () => {
    const contacts: FetchContact[] = []
    let environment = {
      OPENCODE_SERVER_PASSWORD: "first-password",
      OPENCODE_SERVER_USERNAME: "first-user",
    }
    const access = createOpenCodeTmuxServerAccess(trustedTarget(), {
      fetchImplementation: createFetchRecorder(contacts),
      getEnvironment: () => environment,
    })

    await access.checkServerHealth()
    environment = {
      OPENCODE_SERVER_PASSWORD: "rotated-password",
      OPENCODE_SERVER_USERNAME: "rotated-user",
    }
    await access.checkServerHealth()

    expect(contacts.map((contact) => contact.authorization)).toEqual([
      `Basic ${Buffer.from("first-user:first-password", "utf8").toString("base64")}`,
      `Basic ${Buffer.from("rotated-user:rotated-password", "utf8").toString("base64")}`,
    ])
    expect(access.getPaneEnvironment()).toEqual({
      OPENCODE_SERVER_PASSWORD: "rotated-password",
      OPENCODE_SERVER_USERNAME: "rotated-user",
    })
  })

  it("returns the exact credential snapshot whose readiness was verified", async () => {
    const firstResponse = createDeferred<Response>()
    const contacts: FetchContact[] = []
    let environment = {
      OPENCODE_SERVER_PASSWORD: "verified-password",
      OPENCODE_SERVER_USERNAME: "verified-user",
    }
    const fetchImplementation = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      contacts.push({
        authorization: new Headers(init?.headers).get("authorization"),
        redirect: init?.redirect,
        url: input.toString(),
      })
      return contacts.length === 1
        ? firstResponse.promise
        : new Response(null, { status: 200 })
    }) as typeof fetch
    const access = createOpenCodeTmuxServerAccess(trustedTarget(), {
      fetchImplementation,
      getEnvironment: () => environment,
    })

    const firstReadyEnvironment = access.getReadyPaneEnvironment?.()
    environment = {
      OPENCODE_SERVER_PASSWORD: "rotated-password",
      OPENCODE_SERVER_USERNAME: "rotated-user",
    }
    firstResponse.resolve(new Response(null, { status: 200 }))

    expect(await firstReadyEnvironment).toEqual({
      OPENCODE_SERVER_PASSWORD: "verified-password",
      OPENCODE_SERVER_USERNAME: "verified-user",
    })
    expect(contacts[0]?.authorization).toBe(
      `Basic ${Buffer.from("verified-user:verified-password", "utf8").toString("base64")}`,
    )
    expect(await access.getReadyPaneEnvironment?.()).toEqual({
      OPENCODE_SERVER_PASSWORD: "rotated-password",
      OPENCODE_SERVER_USERNAME: "rotated-user",
    })
    expect(contacts[1]?.authorization).toBe(
      `Basic ${Buffer.from("rotated-user:rotated-password", "utf8").toString("base64")}`,
    )
  })
})
