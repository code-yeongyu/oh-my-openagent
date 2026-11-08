const { createGatewayStore } = await import(process.env.OMO_GATEWAY_TEST_STORE_MODULE ?? new URL("../store.ts", import.meta.url).href)
const { existsSync, readdirSync } = await import("node:fs")
const { join } = await import("node:path")

const scenario = process.argv[2]
const agentDir = process.argv[3]
const moduleUrl = new URL("./extension-lifecycle.mjs", import.meta.url).href
const bind = (session) => ({
  principal: "fixture",
  binding: { platform: "custom", account_id: "bot", chat_id: session, session_durable_id: session, ttl_seconds: null },
})

if (scenario === "crashBeforeCommit") {
  const store = createGatewayStore({ agentDir, resolveTarget: async () => ({ kind: "ok", target: { durable_id: "target", endpoint: null, liveness: "dead" } }) })
  await store.registerStoreExtension({ name: "alpha", moduleUrl, migrations: [] })
  console.log("READY")
  // The operation enqueues, then never returns: the parent kills this process after the wake
  // marker appears, while the joined transaction is still open.
  void store.extensionCall("alpha", "hangAfterEnqueue", bind("target"))
} else if (scenario === "crashAfterCommit") {
  const store = createGatewayStore({ agentDir, resolveTarget: async () => ({ kind: "ok", target: { durable_id: "target", endpoint: null, liveness: "dead" } }) })
  await store.registerStoreExtension({ name: "alpha", moduleUrl, migrations: [] })
  console.log("READY")
  const outcome = await store.extensionCall("alpha", "enqueuePair", [bind("target")])
  console.log(JSON.stringify({ outcome }))
  // Exit without dispose: a crash right after the caller saw ok.
  process.exit(0)
} else if (scenario === "lateThrow" || scenario === "lateReject") {
  const store = createGatewayStore({ agentDir })
  await store.registerStoreExtension({ name: "alpha", moduleUrl, migrations: [["CREATE TABLE alpha_items (id INTEGER PRIMARY KEY, value TEXT)"]] })
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
  console.log(JSON.stringify({
    outcome,
    event: observed,
    sameWorker: before.pid === after.pid && before.process_start_time === after.process_start_time && before.instance_id === after.instance_id,
    core: await store.list(),
    rows: await store.extensionCall("alpha", "rows", { name: "alpha" }),
  }))
  await store.dispose()
} else if (scenario === "commitHook") {
  // afterDbCommit runs after the joined transaction's COMMIT: the marker must already exist then.
  const marker = join(agentDir, "gateway", "inbox", "target")
  const store = createGatewayStore({ agentDir, resolveTarget: async () => ({ kind: "ok", target: { durable_id: "target", endpoint: null, liveness: "dead" } }), _test: { afterDbCommit: "pause" } })
  await store.registerStoreExtension({ name: "alpha", moduleUrl, migrations: [] })
  const paused = new Promise((resolve) => {
    const remove = store.onEvent((value) => {
      if (value.kind === "paused" && value.hook === "afterDbCommit") { remove(); resolve(value) }
    })
  })
  const call = store.extensionCall("alpha", "enqueuePair", [bind("target")])
  await paused
  console.log(JSON.stringify({ markerAtCommit: existsSync(marker) && readdirSync(marker).length === 1 }))
  store.resume("afterDbCommit")
  console.log(JSON.stringify({ outcome: await call }))
  await store.dispose()
}
