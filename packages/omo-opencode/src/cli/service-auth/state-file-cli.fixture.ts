import { chmodSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

// Preloaded into a launcher child: a Linux machine whose session bus has no Secret Service (#7185b). gdbus answers as it
// does there, and every OS-store call fails the way libsecret does with nothing to talk to, and says so on stderr.
const unavailable = async (): Promise<never> => {
  process.stderr.write("KEYSTORE_CALL\n")
  throw new Error("synthetic: the name org.freedesktop.secrets was not provided by any .service files")
}
Object.defineProperty(Bun, "secrets", {
  value: { get: unavailable, set: unavailable, delete: unavailable, [Symbol.for("omo.test.injectedSecrets")]: true },
})
if (!process.env.HOME) throw new Error("a temporary HOME is required")
const bin = join(process.env.HOME, ".fake-gdbus")
mkdirSync(bin, { recursive: true })
writeFileSync(
  join(bin, "gdbus"),
  "#!/bin/sh\necho 'Error: GDBus.Error:org.freedesktop.DBus.Error.ServiceUnknown: The name org.freedesktop.secrets was not provided by any .service files' >&2\nexit 1\n",
)
chmodSync(join(bin, "gdbus"), 0o755)
process.env.PATH = `${bin}:${process.env.PATH ?? ""}`
Object.assign(globalThis, { [Symbol.for("omo.test.serviceAccountsOpen")]: true })
