import { describe, expect, test } from "bun:test"
import { ApiRefusal, type Credentials } from "@oh-my-opencode/omo-opencode/service-auth"
import { createOmoSdk, type OmoResult, type OmoSdkPorts } from ".."

const stored: Credentials = {
  accessToken: "access-fixture",
  accessTokenExpiresAt: "2030-01-01T00:00:00.000Z",
  refreshToken: "refresh-fixture",
  device: { id: "dev-a", name: "device-a" },
  signingPrivateKey: "signing-fixture",
  sealingPrivateKey: "sealing-fixture",
}

type Delete = "removes" | "404-already-gone" | "keeps-listed"

// A fake account: GET /v1/devices lists the live devices, DELETE /v1/devices/:id answers as `onDelete` says.
function account(initial: Record<string, string>, onDelete: Delete = "removes") {
  const names = new Map(Object.entries(initial))
  const requests: { method: string; path: string }[] = []
  const ports: OmoSdkPorts = {
    credentialStore: { read: async () => stored },
    session: {
      accessToken: async () => "access-fixture",
      request: async (path, init) => {
        const method = init.method ?? "GET"
        requests.push({ method, path })
        if (method === "DELETE") {
          const id = decodeURIComponent(path.slice("/v1/devices/".length))
          if (onDelete === "404-already-gone") {
            names.delete(id)
            throw new ApiRefusal("not_found", 404)
          }
          if (onDelete === "removes") names.delete(id)
          return null
        }
        return { devices: [...names].map(([id, name]) => ({ id, name, revokedAt: null, current: id === "dev-a" })) }
      },
    },
  }
  return { ports, requests, names }
}

const sdkWith = (ports: OmoSdkPorts) =>
  createOmoSdk({
    env: { OMO_SERVICE_API_URL: "https://accounts.example.test", PATH: "/usr/bin" },
    ports: { desktopLaunch: () => false, ...ports },
  })

const errorOf = <T>(result: OmoResult<T>) => {
  if (result.kind !== "error") throw new Error(`expected an error, got ${JSON.stringify(result)}`)
  return result.error
}

const deletes = (requests: readonly { method: string; path: string }[]) =>
  requests.filter((request) => request.method === "DELETE")

describe("devices.revoke", () => {
  test("#given another device and its current name #when revoked #then one DELETE is sent and it is gone from the list", async () => {
    const { ports, requests, names } = account({ "dev-a": "device-a", "dev-b": "device-b" })
    const result = await sdkWith(ports).devices.revoke({ id: "dev-b", confirmName: "device-b" })
    expect(result).toEqual({ kind: "ok", value: { revoked: { id: "dev-b", name: "device-b", current: false } } })
    expect(deletes(requests)).toEqual([{ method: "DELETE", path: "/v1/devices/dev-b" }])
    expect([...names.keys()]).toEqual(["dev-a"])
  })

  test("#given a name that is not the device's current name #when revoked #then confirmation_mismatch and no DELETE", async () => {
    const { ports, requests, names } = account({ "dev-a": "device-a", "dev-b": "device-b" })
    const error = errorOf(await sdkWith(ports).devices.revoke({ id: "dev-b", confirmName: "wrong" }))
    expect(error.code).toBe("confirmation_mismatch")
    expect(deletes(requests)).toEqual([])
    expect([...names.keys()]).toEqual(["dev-a", "dev-b"])
  })

  test("#given this device #when revoked even with its right name #then this_device and no DELETE", async () => {
    const { ports, requests } = account({ "dev-a": "device-a", "dev-b": "device-b" })
    const error = errorOf(await sdkWith(ports).devices.revoke({ id: "dev-a", confirmName: "device-a" }))
    expect(error.code).toBe("this_device")
    expect(deletes(requests)).toEqual([])
  })

  test("#given an id the account does not list #when revoked #then not_found and no DELETE", async () => {
    const { ports, requests } = account({ "dev-a": "device-a" })
    const error = errorOf(await sdkWith(ports).devices.revoke({ id: "dev-missing", confirmName: "anything" }))
    expect(error.code).toBe("not_found")
    expect(deletes(requests)).toEqual([])
  })

  test("#given the DELETE answers 404 and the device is gone from the next list #when revoked #then it counts as revoked", async () => {
    const { ports } = account({ "dev-a": "device-a", "dev-b": "device-b" }, "404-already-gone")
    const result = await sdkWith(ports).devices.revoke({ id: "dev-b", confirmName: "device-b" })
    expect(result).toEqual({ kind: "ok", value: { revoked: { id: "dev-b", name: "device-b", current: false } } })
  })

  test("#given the device is still listed after the DELETE #when revoked #then still_live", async () => {
    const { ports } = account({ "dev-a": "device-a", "dev-b": "device-b" }, "keeps-listed")
    const error = errorOf(await sdkWith(ports).devices.revoke({ id: "dev-b", confirmName: "device-b" }))
    expect(error.code).toBe("still_live")
  })
})
