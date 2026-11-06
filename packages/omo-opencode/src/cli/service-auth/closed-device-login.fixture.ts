import { chmodSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

// Preloaded into a launcher child while accounts stay CLOSED: an empty in-memory credential store stands in for an
// unlocked keyring, and every write is reported on stderr so a test can prove a refused device sign-in stored nothing.
const values = new Map<string, string>()
const slot = ({ service, name }: { readonly service: string; readonly name: string }) => `${service}\n${name}`
Object.defineProperty(Bun, "secrets", {
  value: {
    get: async (key: { readonly service: string; readonly name: string }) => values.get(slot(key)) ?? null,
    set: async (key: { readonly service: string; readonly name: string; readonly value: string }) => {
      process.stderr.write("KEYSTORE_WRITE\n")
      values.set(slot(key), key.value)
    },
    delete: async (key: { readonly service: string; readonly name: string }) => values.delete(slot(key)),
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
