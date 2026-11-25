import { describe, expect, test } from "bun:test"

import type { SignInRequest } from "@oh-my-opencode/account-core/calls/sign-in"
import { assembleOmoSdk } from "../assembly"
import type { OmoPrincipal } from "../contract"
import type { InProcessSignIn } from "./account-sign-in"

// account.signIn on the root (first-party design 6.4, security design 4.2, 5.4, slice A1b). With an in-process sign-in
// (the omo-ai/sdk entry) both methods run in this process; without one the shipped launcher child keeps running the
// device code (child-backed-members.json). Replace from a session is refused before either path is touched (B4), and
// the lower layer's error never reaches an answer.

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
  test("#given a session principal #when it asks to replace #then it is refused before either sign-in path runs (B4)", async () => {
    const requests: SignInRequest[] = []
    const { sdk, touched } = rootWith({
      principal: { kind: "session", session_id: "01-session" },
      inProcess: async (api, request) => {
        requests.push(request)
        return signedIn("on")(api, request)
      },
    })
    const codes: unknown[] = []
    const answer = await sdk.account.signIn({
      method: "device_code",
      replace: true,
      onUserCode: (code: unknown) => {
        codes.push(code)
      },
    })
    expect(answer).toMatchObject({ kind: "error", error: { code: "sender_not_allowed", details: { change: "B4" } } })
    expect({ requests, touched, codes }).toEqual({ requests: [], touched: [], codes: [] })
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
      inProcess: async (api, request) => {
        reached = true
        return signedIn("on")(api, request)
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
      inProcess: async (api, request) => {
        reached = true
        return signedIn("on")(api, request)
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
