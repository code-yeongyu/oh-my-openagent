/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createProbeStore } from "./sqlite-store"

let tmpDir: string
let dbPath: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "probe-lab-v03-store-"))
  dbPath = join(tmpDir, "lab.db")
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe("probe-lab v0.3 stores", () => {
  test("audit triggers #given status and evidence changes #when queried #then audit rows are recorded", () => {
    const store = createProbeStore(dbPath)
    store.insertHypothesis({ id: "h-audit", text: "claim", falsifiability_criteria: "criteria" })
    store.insertSession({ id: "s-audit", hypothesis_id: "h-audit", identity_id: null })
    store.updateHypothesisStatus("h-audit", "refuted", 0.2)
    const exchange = store.insertExchange({ session_id: "s-audit", method: "GET", url: "https://example.test" })
    store.insertEvidence({ hypothesis_id: "h-audit", session_id: "s-audit", exchange_id: exchange.id, verdict: "refutes" })

    const rows = store.listAuditLog({ limit: 10, offset: 0 })
    expect(rows.total).toBeGreaterThanOrEqual(2)
    expect(rows.entries.some((row) => row.entity_type === "hypothesis" && row.action === "refute")).toBe(true)
    expect(rows.entries.some((row) => row.entity_type === "evidence" && row.action === "create")).toBe(true)
    store.close()
  })

  test("audit store #given manual entry #when filtered #then get and count match", () => {
    const store = createProbeStore(dbPath)
    const inserted = store.insertAuditLog({ entity_type: "provider", entity_id: "p-1", action: "rotate", actor: "test" })
    expect(store.getAuditLog(inserted.id)?.action).toBe("rotate")
    expect(store.countAuditLog({ entity_type: "provider", action: "rotate" })).toBe(1)
    expect(store.listAuditLog({ entity_id: "p-1", limit: 10, offset: 0 }).entries).toHaveLength(1)
    store.close()
  })

  test("config store #given kill switch value #when set and deleted #then lifecycle is persisted", () => {
    const store = createProbeStore(dbPath)
    store.setProbeLabConfig("kill_switch", "off", "global stop switch")
    expect(store.getProbeLabConfig("kill_switch")?.value).toBe("off")
    expect(store.listProbeLabConfig()).toHaveLength(1)
    expect(store.deleteProbeLabConfig("kill_switch")).toBe(true)
    expect(store.getProbeLabConfig("kill_switch")).toBeNull()
    store.close()
  })

  test("identity config encryption #given sensitive identity config #when persisted #then raw column is encrypted and store read decrypts", () => {
    const store = createProbeStore(dbPath)
    store.upsertIdentity({ id: "id-secret", kind: "api_key", config: { token: "sensitive-secret" } })
    const db = new Database(dbPath)
    const raw = db.query<{ config: string }, [string]>("SELECT config FROM identities WHERE id = ?1").get("id-secret")
    expect(raw?.config).not.toContain("sensitive-secret")
    const roundTrip = JSON.parse(store.getIdentity("id-secret")!.config) as { token: string }
    expect(roundTrip.token).toBe("sensitive-secret")
    db.close()
    store.close()
  })

  test("identity config legacy plaintext #given raw plaintext identity config #when store reads #then fallback returns plaintext", () => {
    const store = createProbeStore(dbPath)
    const db = new Database(dbPath)
    db.run(
      "INSERT INTO identities (id, kind, label, config, status, tier) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
      ["id-legacy", "api_key", null, JSON.stringify({ token: "legacy-secret" }), "active", "standard"],
    )
    const config = JSON.parse(store.getIdentity("id-legacy")!.config) as { token: string }
    expect(config.token).toBe("legacy-secret")
    db.close()
    store.close()
  })

  test("migration store #given version recorded #when checked #then applied state is queryable", () => {
    const store = createProbeStore(dbPath)
    store.recordSchemaMigration(3, "v0.3 observability")
    expect(store.isSchemaMigrationApplied(3)).toBe(true)
    expect(store.isSchemaMigrationApplied(4)).toBe(false)
    expect(store.listSchemaMigrations()[0]?.description).toBe("v0.3 observability")
    store.close()
  })
})
