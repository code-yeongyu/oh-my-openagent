import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { memorySecrets } from "./test-support"

// The fallback notice is once per process, so each test loads a fresh module instance.
let instance = 0
const freshKeystore = async (): Promise<typeof import("./keystore")> => import(`./keystore.ts?notice=${++instance}`)

describe("keyring fallback notice", () => {
  afterEach(() => { spyOn(process.stderr, "write").mockRestore() })

  test("#given a quiet host store ran first #when a normal store falls back #then the person still sees the notice once", async () => {
    const { createCredentialStore } = await freshKeystore()
    const written: string[] = []
    spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => { written.push(String(chunk)); return true })
    const unknownLock = async () => "unknown" as const

    await createCredentialStore("https://api.omo.dev", memorySecrets().api, "linux", unknownLock, () => {}).read()
    await createCredentialStore("https://api.omo.dev", memorySecrets().api, "linux", unknownLock).read()
    await createCredentialStore("https://api.omo.dev", memorySecrets().api, "linux", unknownLock).read()

    expect(written.filter(line => line.includes("using libsecret directly"))).toHaveLength(1)
  })

  test("#given a normal store noticed first #when a quiet host store and another normal store fall back #then the notice still shows once", async () => {
    const { createCredentialStore } = await freshKeystore()
    const written: string[] = []
    spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => { written.push(String(chunk)); return true })
    const unknownLock = async () => "unknown" as const

    await createCredentialStore("https://api.omo.dev", memorySecrets().api, "linux", unknownLock).read()
    await createCredentialStore("https://api.omo.dev", memorySecrets().api, "linux", unknownLock, () => {}).read()
    await createCredentialStore("https://api.omo.dev", memorySecrets().api, "linux", unknownLock).read()

    expect(written.filter(line => line.includes("using libsecret directly"))).toHaveLength(1)
  })
})
