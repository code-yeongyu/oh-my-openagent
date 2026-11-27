const { createGatewayStore } = await import(
  process.env.OMO_GATEWAY_TEST_STORE_MODULE ?? new URL("../store.ts", import.meta.url).href
)

const scenario = process.argv[2]
const agentDir = process.argv[3]
const moduleUrl = new URL("./extension-lifecycle.mjs", import.meta.url).href
if (scenario === "lateThrow" || scenario === "lateReject") {
  const store = createGatewayStore({ agentDir })
  await store.registerStoreExtension({
    name: "alpha",
    moduleUrl,
    migrations: [["CREATE TABLE alpha_items (id INTEGER PRIMARY KEY, value TEXT)"]],
  })
  const before = await store.identity()
  const event = new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error("no extension_error event within 5s")), 5_000)
    const remove = store.onEvent((value) => {
      if (value.kind === "extension_error" && value.phase === "async") {
        clearTimeout(deadline)
        remove()
        resolve(value)
      }
    })
  })
  const outcome = await store.extensionCall("alpha", scenario, null)
  const observed = await event
  const after = await store.identity()
  console.log(
    JSON.stringify({
      outcome,
      event: observed,
      sameWorker:
        before.pid === after.pid &&
        before.process_start_time === after.process_start_time &&
        before.instance_id === after.instance_id,
      core: await store.list(),
      rows: await store.extensionCall("alpha", "rows", { name: "alpha" }),
    }),
  )
  await store.dispose()
}
