import { describe, expect, test } from "bun:test"

import type { SignInRequest } from "@oh-my-opencode/account-core/calls/sign-in"
import { assembleOmoSdk } from "../assembly"
import type { OmoPrincipal } from "../contract"
import { assertedExpectation, BEHAVIOUR_CHANGES } from "../contract/behaviour-changes"
import type { InProcessSignIn } from "./account-sign-in"

// account.signIn on the root (first-party design 6.4, security design 4.2, 5.4, slice A1b). With an in-process sign-in
// (the omo-ai/sdk entry) both methods run in this process; without one the shipped launcher child keeps running the
// device code (child-backed-members.json). Replace from a session follows B4's asserted expectation (today's, until its
// evidence exists), and the lower layer's error never reaches an answer.

const CODE = {
  verificationUri: "https://signin.example/device",
  userCode: "BCDF-GHJK",
  matchingCode: "482 913",
  expiresAt: "2030-01-01T00:05:00.000Z",
}
const CAUSE_CANARY = "sign-in-cause-canary-token"

function rootWith(options: {
  readonly principal?: OmoPrincipal
  readonly inProcess?: InProcessSignIn
  readonly desktop?: boolean
}) {
  const touched: string[] = []
  const sdk = assembleOmoSdk(
    {
      principal: options.principal ?? { kind: "script", uid: 501 },
      env: { OMO_SERVICE_API_URL: "https://api.example.test" },
      cwd: "/work",
      ports: {
        desktopLaunch: () => options.desktop === true,
        signInProcess: async ({ onLine }) => {
          touched.push("process")
          onLine(JSON.stringify({ event: "code", ...CODE }))
          onLine(
            JSON.stringify({
              event: "signed_in",
              device: { id: "dev-1", name: "laptop" },
              deviceService: "background",
            }),
          )
          return { code: 0 }
        },
      },
    },
    options.inProcess === undefined ? {} : { signIn: options.inProcess },
  )
  return { sdk, touched }
}

const signedIn =
  (deviceService: "on" | "not_run"): InProcessSignIn =>
  async (api, request) => {
    await request.onUserCode(CODE)
    return { kind: "ok", value: { api, device: { id: "dev-1", name: "laptop" }, deviceService } }
  }

describe("account.signIn on the root", () => {
  test("#given B4 with no evidence #when a session's root asks to replace #then today's answer: the shipped child signs in with replace", async () => {
    // The pin of today's behaviour (design lane, 2026-11-26): B4 in contract/behaviour-changes.ts still asserts its
    // today expectation. When B4's evidence lands, this table entry flips and this test turns into the refusal.
    const b4 = BEHAVIOUR_CHANGES.find((change) => change.id === "B4")
    expect(b4 === undefined ? undefined : assertedExpectation(b4).outcome).toBe("allow")
    const stdins: string[] = []
    const sdk = assembleOmoSdk(
      {
        principal: { kind: "session", session_id: "01-session" },
        env: { OMO_SERVICE_API_URL: "https://api.example.test" },
        cwd: "/work",
        ports: {
          desktopLaunch: () => false,
          signInProcess: async ({ stdin, onLine }) => {
            stdins.push(stdin)
            onLine(JSON.stringify({ event: "signed_in", device: { id: "dev-1", name: "laptop" }, deviceService: "on" }))
            return { code: 0 }
          },
        },
      },
      {},
    )
    expect(
      (await sdk.account.signIn({ method: "device_code", replace: true, onUserCode: () => undefined })) as unknown,
    ).toMatchObject({ kind: "ok", value: { device_service: "on" } })
    expect(stdins.map((line) => JSON.parse(line))).toEqual([{ replace: true, custodyRecordedByCaller: true }])
  })

  test("#given an in-process sign-in #when the device code is approved #then the code reaches onUserCode and the answer names the device", async () => {
    const { sdk, touched } = rootWith({ inProcess: signedIn("on") })
    const codes: unknown[] = []
    expect(
      (await sdk.account.signIn({
        method: "device_code",
        onUserCode: (code: unknown) => {
          codes.push(code)
        },
      })) as unknown,
    ).toEqual({
      kind: "ok",
      value: { api: "https://api.example.test", device: { id: "dev-1", name: "laptop" }, device_service: "on" },
    })
    expect(codes).toEqual([
      {
        verification_uri: CODE.verificationUri,
        user_code: CODE.userCode,
        matching_code: CODE.matchingCode,
        expires_at: CODE.expiresAt,
      },
    ])
    expect(touched).toEqual([])
  })

  test("#given the browser method #when it runs in process #then the browser options reach the core", async () => {
    const requests: SignInRequest[] = []
    const opened: string[] = []
    const { sdk } = rootWith({
      inProcess: async (api, request) => {
        requests.push(request)
        await request.onOpenUrl?.("https://signin.example/?state=s")
        return { kind: "ok", value: { api, device: { id: "dev-1", name: "laptop" }, deviceService: "on" } }
      },
    })
    await sdk.account.signIn({
      method: "browser",
      open_browser: true,
      onUserCode: () => undefined,
      onOpenUrl: (url: string) => {
        opened.push(url)
      },
    })
    expect(requests).toMatchObject([{ method: "browser", openBrowser: true }])
    expect(opened).toEqual(["https://signin.example/?state=s"])
  })

  test("#given an in-process sign-in with no device-service setup #then the answer says the setup was not run", async () => {
    const { sdk } = rootWith({ inProcess: signedIn("not_run") })
    expect((await sdk.account.signIn({ method: "device_code", onUserCode: () => undefined })) as unknown).toMatchObject(
      {
        kind: "ok",
        value: { device_service: "not_run" },
      },
    )
  })

  test("#given a refused in-process sign-in #then the core's code and words come back and the lower layer's error does not", async () => {
    const { sdk } = rootWith({
      inProcess: async () => ({
        kind: "refused",
        code: "approval_denied",
        message: "the sign-in was denied",
        next_action: "start a new sign-in if that was a mistake",
        cause: new Error(CAUSE_CANARY),
      }),
    })
    const answer = await sdk.account.signIn({ method: "device_code", onUserCode: () => undefined })
    expect(answer).toEqual({
      kind: "error",
      error: {
        code: "approval_denied",
        message: "the sign-in was denied",
        next_action: "start a new sign-in if that was a mistake",
      },
    })
    expect(JSON.stringify(answer)).not.toContain(CAUSE_CANARY)
  })

  test("#given accounts are closed #when the browser method is asked for #then it is refused as unsupported", async () => {
    const { sdk } = rootWith({ inProcess: async () => ({ kind: "refused", code: "accounts_closed" }) })
    expect((await sdk.account.signIn({ method: "browser", onUserCode: () => undefined })) as unknown).toMatchObject({
      kind: "error",
      error: { code: "unsupported", details: { reason: "accounts_closed" } },
    })
  })

  test("#given no in-process sign-in #when the device code is asked for #then the shipped launcher child runs it", async () => {
    const { sdk, touched } = rootWith({ principal: { kind: "session", session_id: "01-session" } })
    const codes: unknown[] = []
    expect(
      (await sdk.account.signIn({
        method: "device_code",
        onUserCode: (code: unknown) => {
          codes.push(code)
        },
      })) as unknown,
    ).toEqual({
      kind: "ok",
      value: { api: "https://api.example.test", device: { id: "dev-1", name: "laptop" }, device_service: "background" },
    })
    expect(touched).toEqual(["process"])
    expect(codes).toHaveLength(1)
  })

  test("#given the session's root #when the browser method is asked for #then it answers today's unsupported and the child never starts", async () => {
    const { sdk, touched } = rootWith({ principal: { kind: "session", session_id: "01-session" } })
    expect((await sdk.account.signIn({ method: "browser", onUserCode: () => undefined })) as unknown).toMatchObject({
      kind: "error",
      error: { code: "unsupported", details: { reason: "child_backed_sign_in" } },
    })
    expect(touched).toEqual([])
  })

  test("#given a connector principal #when it signs in #then the boundary refuses it and no sign-in path runs", async () => {
    let reached = false
    const { sdk, touched } = rootWith({
      principal: { kind: "connector", binding: "slack:T1/C1" },
      inProcess: async (api, request, custody) => {
        reached = true
        return signedIn("on")(api, request, custody)
      },
    })
    expect((await sdk.account.signIn({ method: "device_code", onUserCode: () => undefined })) as unknown).toMatchObject(
      {
        kind: "error",
        error: { code: "sender_not_allowed" },
      },
    )
    expect({ reached, touched }).toEqual({ reached: false, touched: [] })
  })

  test("#given a desktop launch #when it signs in #then it answers desktop_sign_in and no sign-in path runs", async () => {
    let reached = false
    const { sdk, touched } = rootWith({
      desktop: true,
      inProcess: async (api, request, custody) => {
        reached = true
        return signedIn("on")(api, request, custody)
      },
    })
    expect((await sdk.account.signIn({ method: "device_code", onUserCode: () => undefined })) as unknown).toMatchObject(
      {
        kind: "error",
        error: { code: "desktop_sign_in" },
      },
    )
    expect({ reached, touched }).toEqual({ reached: false, touched: [] })
  })
})

describe("account.signIn: a session stays on the shipped child (review 6064989985)", () => {
  for (const form of ["root call", "compatibility form"] as const)
    test(`#given a session root built with an in-process sign-in #when it signs in by the ${form} #then the child runs and the in-process sign-in and its setup never do`, async () => {
      let reached = false
      const { sdk, touched } = rootWith({
        principal: { kind: "session", session_id: "01-session" },
        inProcess: async () => {
          reached = true
          return { kind: "refused", code: "cancelled" }
        },
      })
      const answer =
        form === "root call"
          ? await sdk.account.signIn({ method: "device_code", onUserCode: () => undefined })
          : await sdk.account.signIn({ onUserCode: () => undefined })
      expect({ kind: answer.kind, reached, touched }).toEqual({ kind: "ok", reached: false, touched: ["process"] })
    })
})

describe("account.signIn cancellation (review 6064989985)", () => {
  const TODAY = {
    kind: "error",
    error: { code: "internal_error", message: "the sign-in was cancelled", next_action: "start a new sign-in" },
  }
  test("#given the shipped child and an aborted signal #then today's answer is the cancelled internal error", async () => {
    const controller = new AbortController()
    controller.abort()
    const sdk = assembleOmoSdk(
      {
        principal: { kind: "session", session_id: "01-session" },
        env: { OMO_SERVICE_API_URL: "https://api.example.test" },
        cwd: "/work",
        ports: { desktopLaunch: () => false, signInProcess: async () => ({ code: null }) },
      },
      {},
    )
    expect((await sdk.account.signIn({ onUserCode: () => undefined, signal: controller.signal })) as unknown).toEqual(
      TODAY,
    )
  })
  for (const form of ["root call", "compatibility form"] as const)
    test(`#given an in-process sign-in #when the ${form}'s signal aborts #then the request carries it and the answer is today's`, async () => {
      const controller = new AbortController()
      const signals: (AbortSignal | undefined)[] = []
      const { sdk } = rootWith({
        inProcess: async (_api, request: SignInRequest) => {
          signals.push(request.signal)
          controller.abort()
          return { kind: "refused", code: "cancelled" }
        },
      })
      const answer =
        form === "root call"
          ? await sdk.account.signIn(
              { method: "device_code", onUserCode: () => undefined },
              { signal: controller.signal },
            )
          : await sdk.account.signIn({ onUserCode: () => undefined, signal: controller.signal })
      expect({ answer: answer as unknown, carried: signals[0] === controller.signal }).toEqual({
        answer: TODAY,
        carried: true,
      })
    })
})
