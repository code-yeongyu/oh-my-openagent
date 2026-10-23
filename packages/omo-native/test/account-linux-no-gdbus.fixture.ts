// Preloaded into a real `omo account` process: a Linux host with no gdbus on PATH (a minimal install) and an
// in-memory OS credential store standing in for libsecret.
import { mkdirSync } from "node:fs"
import { join } from "node:path"

Object.defineProperty(process, "platform", { value: "linux" })
// An empty bin dir inside the test's own HOME, which the parent test removes, so no temp dir outlives the run.
const emptyBin = join(process.env.HOME ?? ".", "empty-bin")
mkdirSync(emptyBin, { recursive: true })
process.env.PATH = emptyBin
const values = new Map<string, string>()
Object.defineProperty(Bun, "secrets", {
  value: {
    get: async ({ name }: { readonly name: string }) => values.get(name) ?? null,
    set: async ({ name, value }: { readonly name: string; readonly value: string }) => { values.set(name, value) },
    delete: async ({ name }: { readonly name: string }) => values.delete(name),
  },
})
