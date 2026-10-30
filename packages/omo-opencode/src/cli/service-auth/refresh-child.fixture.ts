import { createSession } from "./session"
import { credentialSchema } from "./protocol"

const api = process.argv[2]
const home = process.argv[3]
if (!api || !home) throw new Error("missing fake API or home")
const session = createSession({
  api, home,
  store: {
    async read() {
      const response = await fetch(`${api}/fake-store`, { proxy: "" })
      const value: unknown = await response.json()
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
