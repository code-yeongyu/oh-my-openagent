import { createSession } from "./session"
import { credentialSchema } from "./protocol"

// argv[3] is the lock home; absent, the session resolves its default the way a real process does (#12978).
const api = process.argv[2]
const home = process.argv[3]
if (!api) throw new Error("missing fake API")
const store = (kind: "read" | "authoritative") => fetch(`${api}/fake-store`, { proxy: "", headers: { "x-read": kind, "x-pid": String(process.pid) } })
const session = createSession({
  api, ...(home === undefined ? {} : { home }),
  beforeKeysDiscarded: async () => undefined,
  store: {
    async read() {
      const value: unknown = await (await store("read")).json()
      return value === null ? null : credentialSchema.parse(value)
    },
    async readAuthoritative() {
      const value: unknown = await (await store("authoritative")).json()
      return value === null ? null : credentialSchema.parse(value)
    },
    async write(value) {
      await fetch(`${api}/fake-store`, { method: "PUT", body: JSON.stringify(value), proxy: "" })
    },
    async clear() { await fetch(`${api}/fake-store`, { method: "DELETE", proxy: "" }) },
  },
})
await session.accessToken()
console.log("ACCESS_READY")
