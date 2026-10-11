const fakeStoreUrl = process.env.OMO_TEST_KEYSTORE_URL
if (!fakeStoreUrl?.startsWith("http://127.0.0.1:")) throw new Error("local fake keystore required")
const get = async () => {
  const response = await fetch(fakeStoreUrl, { proxy: "" })
  const value: unknown = await response.json()
  if (value !== null && typeof value !== "string") throw new Error("invalid fake keystore value")
  return value
}
const set = async ({ value }: { readonly value: string }) => {
  await fetch(fakeStoreUrl, { method: "PUT", body: value, proxy: "" })
}
const remove = async () => {
  await fetch(fakeStoreUrl, { method: "DELETE", proxy: "" })
  return true
}
Object.defineProperty(Bun, "secrets", { value: { get, set, delete: remove } })

const failure = process.env.OMO_TEST_FETCH_FAILURE
if (failure === "offline" || failure === "lost-response" || failure === "timeout") {
  const original = globalThis.fetch
  const failing: typeof fetch = Object.assign(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = input instanceof Request ? input.url : String(input)
    if (url.endsWith("/v1/session/refresh")) {
      if (failure !== "offline") {
        const response = await original(input, init)
        await response.arrayBuffer()
        if (failure === "timeout") throw new DOMException("synthetic timeout after send", "TimeoutError")
        throw Object.assign(new Error("synthetic response loss"), { code: "ECONNRESET" })
      }
      throw Object.assign(new Error(await get() ?? "offline"), { code: "ECONNREFUSED" })
    }
    return original(input, init)
  }, { preconnect: original.preconnect })
  globalThis.fetch = failing
}
