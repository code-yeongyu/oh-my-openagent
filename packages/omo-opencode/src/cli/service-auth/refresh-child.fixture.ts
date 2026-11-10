import { systemAccountFacts, useAccountFacts } from "./account-home"
import { createSession } from "./session"
import { credentialSchema } from "./protocol"

// argv[3] is the lock home; empty, the session resolves its default the way a real process does, from the OS user
// record that argv[4] stands in for so the lock stays in the test's temp root (#12978).
const [api, home, recordHome] = process.argv.slice(2)
if (!api) throw new Error("missing fake API")
if (recordHome !== undefined) useAccountFacts({ ...systemAccountFacts, recordHome: () => recordHome })
const store = (kind: "read" | "authoritative") => fetch(`${api}/fake-store`, { proxy: "", headers: { "x-read": kind, "x-pid": String(process.pid) } })
const session = createSession({
  api, ...(home ? { home } : {}),
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
