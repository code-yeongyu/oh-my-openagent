import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { resolveRpcSocketTransport } from "./socket-client"

// Security and platform contract (#15369, senpi#7571): on Windows no host proof exists at the auth layer, so a dial's
// only protection is that the pipe it reaches is named from the secret in `<socket>.secret`. A process that cannot read
// that file cannot name the pipe, so it cannot sit on it first; without a usable secret there is no dial at all.

const roots: string[] = []
const platform = Object.getOwnPropertyDescriptor(process, "platform")
afterEach(() => {
  if (platform !== undefined) Object.defineProperty(process, "platform", platform)
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function asWindows(): void {
  if (platform === undefined) throw new Error("process.platform has no descriptor")
  Object.defineProperty(process, "platform", { ...platform, value: "win32" })
}

function endpointWith(secret?: Buffer): string {
  const root = mkdtempSync(join(tmpdir(), "pipe-name-"))
  roots.push(root)
  const endpoint = join(root, "h.sock")
  if (secret !== undefined) writeFileSync(`${endpoint}.secret`, secret)
  return endpoint
}

const secretOf = (byte: number) => Buffer.alloc(32, byte)

describe("the Windows pipe a dial reaches is named from the endpoint's secret", () => {
  test("#given another secret for the same endpoint #then the dial goes to another pipe", async () => {
    asWindows()
    const endpoint = endpointWith(secretOf(1))
    const first = await resolveRpcSocketTransport(endpoint)
    writeFileSync(`${endpoint}.secret`, secretOf(2))
    const second = await resolveRpcSocketTransport(endpoint)
    expect(first?.address).toStartWith("\\\\.\\pipe\\senpi-rpc-")
    expect(second?.address).toStartWith("\\\\.\\pipe\\senpi-rpc-")
    expect(second?.address).not.toBe(first?.address)
  })

  test("#given the same secret at another endpoint #then the pipe name does not follow from the secret alone", async () => {
    asWindows()
    const one = await resolveRpcSocketTransport(endpointWith(secretOf(3)))
    const two = await resolveRpcSocketTransport(endpointWith(secretOf(3)))
    expect(one?.address).not.toBe(two?.address)
  })

  test("#given the same endpoint and secret #then every dial reaches the same pipe and sends that secret", async () => {
    asWindows()
    const endpoint = endpointWith(secretOf(4))
    const [first, again] = [await resolveRpcSocketTransport(endpoint), await resolveRpcSocketTransport(endpoint)]
    expect(again?.address).toBe(first?.address)
    expect(first?.secret).toEqual(secretOf(4))
  })

  test.each([
    ["no secret file", undefined],
    ["a secret that is not 32 bytes", Buffer.alloc(31, 5)],
  ])("#given %s #then there is no pipe to dial", async (_name, secret) => {
    asWindows()
    expect(await resolveRpcSocketTransport(endpointWith(secret))).toBeUndefined()
  })
})
