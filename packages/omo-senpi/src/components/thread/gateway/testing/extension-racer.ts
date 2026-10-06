export {}

const { createGatewayStore } = await import(process.env.OMO_GATEWAY_TEST_STORE_MODULE ?? "../store") as typeof import("../store")

const [agentDir, moduleUrl] = process.argv.slice(2)
const store = createGatewayStore({ agentDir })
await store.identity()
const go = new Promise<void>((resolve) => process.once("message", () => resolve()))
process.send?.("ready")
await go
try {
  const result = await store.registerStoreExtension({ name: "racing", moduleUrl, migrations: [
    ["CREATE TABLE racing_items (id INTEGER PRIMARY KEY, value TEXT)", "INSERT INTO racing_items VALUES (1, 'once')"],
    ["UPDATE racing_items SET value = value || '-next'"],
  ] })
  console.log(JSON.stringify(result))
} finally {
  await store.dispose()
  process.disconnect?.()
}
