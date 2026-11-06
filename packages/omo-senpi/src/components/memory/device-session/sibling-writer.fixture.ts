import { readFile, rename, rm, writeFile } from "@oh-my-opencode/memory-core/fs"
import { createCredentialStore, type Credentials } from "@oh-my-opencode/omo-opencode/service-auth"

// A credential writer in its own process: it takes the real per-origin lock under `home` and commits B, then A again.
const [origin, home, secretFile] = process.argv.slice(2)
if (origin === undefined || home === undefined || secretFile === undefined) throw new Error("usage: origin home secretFile")
const store = createCredentialStore(origin, {
  platform: "darwin",
  home,
  lockProbe: async () => "unlocked",
  secrets: {
    get: async () => readFile(secretFile, "utf8").catch(() => null),
    set: async ({ value }) => { await writeFile(`${secretFile}.tmp`, value); await rename(`${secretFile}.tmp`, secretFile) },
    delete: async () => { await rm(secretFile, { force: true }); return true },
  },
})
const a = await store.read()
if (a === null) throw new Error("the sibling found no credential")
const b: Credentials = { ...a, device: { ...a.device, id: `${a.device.id}-replacement` } }
await store.write(b)
await store.write(a)
process.stdout.write("SIBLING_COMMITTED_ABA\n")
