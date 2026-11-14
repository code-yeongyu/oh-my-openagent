import { chmodSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

// Preloaded into a launcher child while accounts stay CLOSED: an empty in-memory credential store stands in for an
// unlocked keyring, and every write is reported on stderr so a test can prove a refused device sign-in stored nothing.
// OMO_TEST_STORE=seed preloads a usable stored sign-in instead: the adopted-credential signal a desktop app's sign-in
// leaves for the CLI (#13265), so the attach-before-mint refusal (#13096) answers before any request.
const seeded = JSON.stringify({
  accessToken: "seeded-access-token",
  accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
  refreshToken: "seeded-refresh-token",
  offlineGrant: "seeded-offline-grant",
  device: { id: "seeded-device", name: "Seeded CLI" },
  signingPrivateKey: "seeded-signing-private",
  sealingPrivateKey: "seeded-sealing-private",
})
const mode = process.env.OMO_TEST_STORE ?? "empty"
const values = new Map<string, string>()
const seededForAnySlot = mode === "seed"
const slot = ({ service, name }: { readonly service: string; readonly name: string }) => `${service}\n${name}`
Object.defineProperty(Bun, "secrets", {
  value: {
    get: async (key: { readonly service: string; readonly name: string }) =>
      seededForAnySlot ? seeded : (values.get(slot(key)) ?? null),
    set: async (key: { readonly service: string; readonly name: string; readonly value: string }) => {
      process.stderr.write("KEYSTORE_WRITE\n")
      values.set(slot(key), key.value)
    },
    delete: async (key: { readonly service: string; readonly name: string }) => {
      if (values.delete(slot(key))) process.stderr.write("KEYSTORE_CLEAR\n")
    },
    // Marked as injected, like every launcher-child stand-in: never the real macOS store (store-binding.ts), and the
    // child takes its credential lock where the test says (account-home.ts).
    [Symbol.for("omo.test.injectedSecrets")]: true,
  },
})
// On Linux the CLI asks the Secret Service over D-Bus whether the default collection is locked; answer unlocked.
if (process.platform === "linux") {
  if (!process.env.HOME) throw new Error("a temporary HOME is required")
  const bin = join(process.env.HOME, ".fake-gdbus")
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, "gdbus"), "#!/bin/sh\necho '(<false>,)'\n")
  chmodSync(join(bin, "gdbus"), 0o755)
  process.env.PATH = `${bin}:${process.env.PATH ?? ""}`
}
