import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import type { Credentials } from "@oh-my-opencode/omo-opencode/service-auth"
import { createOmoSdk, type OmoResult, type OmoSdkPorts } from "."

// Public API contract of the shipped omo SDK (OMO_SDK_ROOT, first-party design 4.1): P1b extends createOmoSdk into the
// root additively, so the four shipped namespaces, their members and the synchronous close() must stay exactly as here.

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
  test("#given an omo SDK #when its members are listed #then the four namespaces and close are exactly the shipped ones", () => {
    const { sdk } = sdkWithRecording()
    const tree = Object.fromEntries(
      Object.entries(sdk).map(([name, member]) => [
        name,
        typeof member === "function" ? "function" : Object.keys(member as object).sort(),
      ]),
    )
    expect(tree).toEqual({
      account: ["signIn", "whoami"],
      devices: ["list", "rename"],
      deviceService: ["status"],
      config: ["status"],
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
