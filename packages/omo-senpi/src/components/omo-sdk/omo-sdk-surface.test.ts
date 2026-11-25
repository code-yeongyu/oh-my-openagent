import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import type { Credentials } from "@oh-my-opencode/omo-opencode/service-auth"
import { createOmoSdk, type OmoResult, type OmoSdkPorts } from "."

// Public API contract of the shipped omo SDK (OMO_SDK_ROOT, first-party design 4.1): P1b extends createOmoSdk into the
// root additively, so every shipped member and the synchronous close() must stay, with what each answers.

const credentials: Credentials = {
  accessToken: "access-fixture",
  accessTokenExpiresAt: "2026-11-19T15:00:00.000Z",
  refreshToken: "refresh-fixture",
  device: { id: "dev_this", name: "device-a" },
  signingPrivateKey: "signing-fixture",
  sealingPrivateKey: "sealing-fixture",
}

function sdkWithRecording() {
  const requests: string[] = []
  const signIns: string[] = []
  const ports: OmoSdkPorts = {
    desktopLaunch: () => false,
    credentialStore: { read: async () => credentials },
    session: {
      accessToken: async () => "access-fixture",
      request: async (path) => {
        requests.push(path)
        return { devices: [] }
      },
    },
    deviceServiceStatus: async () => "not_running",
    signInProcess: async () => {
      signIns.push("spawned")
      throw new Error("not reached")
    },
  }
  const sdk = createOmoSdk({ env: { OMO_SERVICE_API_URL: "https://accounts.example.test" }, cwd: tmpdir(), ports })
  return { sdk, requests, signIns }
}

const codeOf = (result: OmoResult<unknown>) => (result.kind === "error" ? result.error.code : "ok")

describe("omo SDK: the shipped surface", () => {
  test("#given an omo SDK #when the shipped members are looked up #then every one is still a function, close included", () => {
    const { sdk } = sdkWithRecording()
    const shipped = {
      account: sdk.account,
      devices: sdk.devices,
      deviceService: sdk.deviceService,
      config: sdk.config,
    }
    expect({
      account: [typeof shipped.account.signIn, typeof shipped.account.whoami],
      devices: [typeof shipped.devices.list, typeof shipped.devices.rename],
      deviceService: [typeof shipped.deviceService.status],
      config: [typeof shipped.config.status],
      close: typeof sdk.close,
    }).toEqual({
      account: ["function", "function"],
      devices: ["function", "function"],
      deviceService: ["function"],
      config: ["function"],
      close: "function",
    })
  })

  test("#given an omo SDK #when close() runs #then it returns synchronously, every account and device call answers internal_error without a request, and the local reads still answer", async () => {
    const { sdk, requests, signIns } = sdkWithRecording()
    expect(sdk.close()).toBeUndefined()
    expect(codeOf(await sdk.account.whoami())).toBe("internal_error")
    expect(codeOf(await sdk.account.signIn({ onUserCode: () => undefined }))).toBe("internal_error")
    expect(codeOf(await sdk.devices.list())).toBe("internal_error")
    expect(codeOf(await sdk.devices.rename({ id: "dev_this", name: "renamed" }))).toBe("internal_error")
    expect(requests).toEqual([])
    expect(signIns).toEqual([])
    expect(codeOf(await sdk.deviceService.status())).toBe("ok")
    expect(codeOf(await sdk.config.status())).toBe("ok")
  })
})
