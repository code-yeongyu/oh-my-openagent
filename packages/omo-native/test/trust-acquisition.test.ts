import { expect, test } from "bun:test"
import { X509Certificate } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { acquireEngineTrust } from "../trust-acquisition"
import { issueCertificates } from "./trust-certificate-fixtures"

test("the owner deadline resolves even when a source never answers", async () => {
  let expire: (() => void) | undefined
  let entered!: () => void
  const started = new Promise<void>((resolve) => { entered = resolve })
  const outcome = acquireEngineTrust({
    deadlineMs: 1500, platform: "linux", environment: {},
    deadline: (callback, milliseconds) => {
      expect(milliseconds).toBe(1500)
      expire = callback
      return () => {}
    },
    linux: {
      osRelease: async () => { entered(); return new Promise(() => {}) },
      available: async () => [],
      read: async () => { throw new Error("unreachable") },
    },
  })
  await started
  if (expire === undefined) throw new Error("acquisition never armed its deadline")
  expire()
  expect(await outcome).toEqual({ certificates: [], fallbackReason: "helper-timeout", codes: [] })
})

test.each(["linux-bundle-unreadable", "linux-bundle-too-large", "linux-bundle-replaced"] as const)(
  "Linux %s never returns automatic certificates", async (kind) => {
    const result = await acquireEngineTrust({
      deadlineMs: 20_000, platform: "linux", environment: {},
      linux: {
        osRelease: async () => "ID=debian\n",
        available: async () => ["/etc/ssl/certs/ca-certificates.crt"],
        read: async (path) => ({ kind, path }),
      },
    })
    expect(result.certificates).toEqual([])
    expect(result.fallbackReason).toBe("linux-bundle-unreadable")
  },
)

test("a malformed Linux bundle is discarded as a whole", async () => {
  const result = await acquireEngineTrust({
    deadlineMs: 20_000, platform: "linux", environment: {},
    linux: {
      osRelease: async () => "ID=debian\n",
      available: async () => ["/etc/ssl/certs/ca-certificates.crt"],
      read: async (path) => ({ kind: "success", path, bytes: Buffer.from("-----BEGIN CERTIFICATE-----\nMAA=\n-----END CERTIFICATE-----\n") }),
    },
  })
  expect(result.certificates).toEqual([])
  expect(result.fallbackReason).toBe("linux-bundle-malformed")
})

test.each(["darwin", "win32"] as const)("a missing shipped %s helper is fallback, never system enumeration", async (platform) => {
  expect(await acquireEngineTrust({ deadlineMs: 1500, platform, environment: {} }))
    .toMatchObject({ certificates: [], fallbackReason: "helper-missing" })
})

test("Linux acquisition applies the shared server-auth policy to a synthetic selected bundle", async () => {
  const directory = await mkdtemp(join(tmpdir(), "omo-trust-acquire-"))
  try {
    const issued = await issueCertificates(directory, [
      { name: "server", subject: "/CN=synthetic-server-ca", days: 2,
        extensions: "basicConstraints=critical,CA:TRUE\nextendedKeyUsage=serverAuth" },
      { name: "client", subject: "/CN=synthetic-client-ca", days: 2,
        extensions: "basicConstraints=critical,CA:TRUE\nextendedKeyUsage=clientAuth" },
    ])
    const pem = (name: string) => {
      const value = issued.get(name)
      if (value === undefined) throw new Error(`synthetic ${name} certificate was not issued`)
      return new X509Certificate(value).toString()
    }
    const server = pem("server")
    const client = pem("client")
    const result = await acquireEngineTrust({
      deadlineMs: 20_000, platform: "linux", environment: {},
      linux: {
        osRelease: async () => "ID=debian\n",
        available: async () => ["/etc/ssl/certs/ca-certificates.crt"],
        read: async (path) => ({ kind: "success", path, bytes: Buffer.from(server + client) }),
      },
    })
    expect(result.fallbackReason).toBeNull()
    expect(result.certificates).toEqual([server])
  } finally { await rm(directory, { recursive: true, force: true }) }
})
