const { createGatewayStore } = await import(process.env.OMO_GATEWAY_TEST_STORE_MODULE ?? new URL("../store.ts", import.meta.url).href)
const agentDir = process.argv[3]
const store = createGatewayStore({ agentDir, _test: { busyTimeoutMs: 10, lockWaitMaxMs: 60 } })
const moduleUrl = new URL("./extension-lifecycle.mjs", import.meta.url).href
try {
  await store.registerStoreExtension({ name: "alpha", moduleUrl, migrations: [["CREATE TABLE alpha_items (id INTEGER PRIMARY KEY, value TEXT)"]] })
  console.log("READY")
  if (process.argv[2] === "hang") {
    const outcome = await store.extensionCall("alpha", "hang", null)
    const rows = await store.extensionCall("alpha", "rows", { name: "alpha" })
    const core = await store.list()
    const other = createGatewayStore({ agentDir, _test: { busyTimeoutMs: 10, lockWaitMaxMs: 60 } })
    try { await other.registerIncarnation({ durable_id: "post-timeout", incarnation: "new" }) }
    finally { await other.dispose() }
    console.log(JSON.stringify({ outcome, rows, core, otherWriter: "ok" }))
  } else if (process.argv[2].startsWith("uncloneable-")) {
    const args = process.argv[2] === "uncloneable-function" ? () => null : Symbol("invalid")
    const outcome = await store.extensionCall("alpha", "rows", args)
    console.log(JSON.stringify({ outcome, core: await store.list(), rows: await store.extensionCall("alpha", "rows", { name: "alpha" }) }))
  } else {
    await store.extensionCall("alpha", "retain", null)
    const event = new Promise((resolve) => {
      const remove = store.onEvent((value) => {
        if (value.kind === "extension_error" && value.phase === "stale_transaction") {
          remove()
          resolve(value)
        }
      })
    })
    await store.extensionCall("alpha", "staleTimer", null)
    const observed = await event
    console.log(JSON.stringify({ event: observed, core: await store.list(), rows: await store.extensionCall("alpha", "rows", { name: "alpha" }) }))
  }
} finally {
  await store.dispose()
}
