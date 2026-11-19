import { Database } from "bun:sqlite"
import { afterEach, expect, test } from "bun:test"
import { mkdirSync } from "node:fs"

import { gatewayDatabasePath, gatewayRootDirectory } from "./paths"
import { GATEWAY_MIGRATIONS } from "./schema"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"

let harness: GatewayHarness | undefined
afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

test("#given v4 rows #when opening the store #then the current schema preserves its deliveries and session counters", async () => {
  const h = (harness = createGatewayHarness())
  mkdirSync(gatewayRootDirectory(h.agentDir), { recursive: true })
  const old = new Database(gatewayDatabasePath(h.agentDir))
  for (const step of GATEWAY_MIGRATIONS.slice(0, 4)) for (const statement of step) old.exec(statement)
  old.exec(`PRAGMA user_version = 4;
    INSERT INTO deliveries (delivery_id, target_durable_id, seq, sender, envelope, body, bytes, mode_requested, state, root_id, hop, created_at, updated_at, expires_at)
    VALUES ('old', 'target', 1, 'cli:1', '{}', 'keep me', 7, 'auto', 'queued', 'root-old', 1, 1, 1, 9999999999999);
    INSERT INTO session_meta (durable_id, next_seq, applied_seq) VALUES ('target', 2, 0)`)
  old.close()
  await h.store().identity()
  const db = new Database(gatewayDatabasePath(h.agentDir), { readonly: true })
  try {
    expect(db.query("SELECT user_version AS v FROM pragma_user_version()").get()).toEqual({
      v: GATEWAY_MIGRATIONS.length,
    })
    expect(db.query("SELECT body, seq FROM deliveries WHERE delivery_id = 'old'").get()).toEqual({
      body: "keep me",
      seq: 1,
    })
    expect(db.query("SELECT next_seq FROM session_meta WHERE durable_id = 'target'").get()).toEqual({ next_seq: 2 })
    expect(db.query("SELECT * FROM extension_schema").all()).toEqual([])
  } finally {
    db.close()
  }
})
