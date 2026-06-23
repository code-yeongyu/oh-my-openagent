/// <reference types="bun-types" />

import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createProbeStore } from "./sqlite-store"

let tmpDir: string
let dbPath: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "probe-lab-test-"))
  dbPath = join(tmpDir, "lab.db")
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe("createProbeStore", () => {
  describe("hypotheses", () => {
    test("insertHypothesis #given a new claim #when inserted #then is retrievable with default status active", () => {
      const store = createProbeStore(dbPath)
      const row = store.insertHypothesis({
        id: "h-1",
        text: "claim",
        falsifiability_criteria: "criteria",
      })
      expect(row.status).toBe("active")
      expect(row.confidence).toBe(0.5)
      expect(store.getHypothesis("h-1")?.text).toBe("claim")
      store.close()
    })

    test("listHypotheses #given multiple hypotheses with mixed status #when filtered #then returns only matching rows", () => {
      const store = createProbeStore(dbPath)
      store.insertHypothesis({ id: "h-a", text: "a", falsifiability_criteria: "c" })
      store.insertHypothesis({ id: "h-b", text: "b", falsifiability_criteria: "c" })
      store.updateHypothesisStatus("h-b", "refuted", 0)
      const refuted = store.listHypotheses({ status_filter: "refuted", limit: 10, offset: 0 })
      expect(refuted.total).toBe(1)
      expect(refuted.rows[0]?.id).toBe("h-b")
      const all = store.listHypotheses({ limit: 10, offset: 0 })
      expect(all.total).toBe(2)
      store.close()
    })
  })

  describe("exchanges and evidence", () => {
    test("evidence chain #given hypothesis with session and exchange #when evidence inserted #then evidence_count reflects rows", () => {
      const store = createProbeStore(dbPath)
      store.insertHypothesis({ id: "h-1", text: "t", falsifiability_criteria: "c" })
      const session = store.insertSession({ id: "s-1", hypothesis_id: "h-1", identity_id: null })
      const exchange = store.insertExchange({
        session_id: session.id,
        method: "POST",
        url: "https://example.test/x",
        response_status: 200,
        response_body: "ok",
      })
      store.insertEvidence({
        hypothesis_id: "h-1",
        session_id: session.id,
        exchange_id: exchange.id,
        verdict: "supports",
      })
      const list = store.listHypotheses({ limit: 10, offset: 0 })
      expect(list.rows[0]?.evidence_count).toBe(1)
      store.close()
    })
  })

  describe("identities and pool health", () => {
    test("getPoolHealth #given mix of statuses #when ratio computed #then quarantined_ratio matches", () => {
      const store = createProbeStore(dbPath)
      store.upsertIdentity({ id: "id-a", kind: "api_key", config: { token: "x" } })
      store.upsertIdentity({ id: "id-b", kind: "api_key", config: { token: "y" }, status: "quarantined" })
      const health = store.getPoolHealth()
      expect(health.total).toBe(2)
      expect(health.active).toBe(1)
      expect(health.quarantined).toBe(1)
      expect(health.quarantined_ratio).toBeCloseTo(0.5)
      store.close()
    })

    test("findFirstActiveIdentity #given quarantined-until in future #when active queried #then quarantined identity is skipped", () => {
      const store = createProbeStore(dbPath)
      const future = Math.floor(Date.now() / 1000) + 600
      store.upsertIdentity({ id: "id-a", kind: "api_key", config: {} })
      store.setIdentityCircuitState({
        id: "id-a",
        state: "open",
        consecutiveFailures: 5,
        lastFailureAt: Math.floor(Date.now() / 1000),
        quarantinedUntil: future,
        status: "quarantined",
      })
      store.upsertIdentity({ id: "id-b", kind: "api_key", config: {} })
      const found = store.findFirstActiveIdentity()
      expect(found?.id).toBe("id-b")
      store.close()
    })

    test("findFirstActiveIdentity #given expired quarantine #when active queried #then identity is auto-promoted to half_open active", () => {
      const store = createProbeStore(dbPath)
      const past = Math.floor(Date.now() / 1000) - 60
      store.upsertIdentity({ id: "id-a", kind: "api_key", config: {} })
      store.setIdentityCircuitState({
        id: "id-a",
        state: "open",
        consecutiveFailures: 5,
        lastFailureAt: past - 600,
        quarantinedUntil: past,
        status: "quarantined",
      })
      const found = store.findFirstActiveIdentity()
      expect(found?.id).toBe("id-a")
      const refreshed = store.getIdentity("id-a")!
      expect(refreshed.status).toBe("active")
      expect(refreshed.circuit_state).toBe("half_open")
      expect(refreshed.quarantined_until).toBeNull()
      expect(refreshed.consecutive_failures).toBe(0)
      store.close()
    })
  })

  describe("sessions", () => {
    test("findSessionByLabel #given a session inserted with label #when looked up by label #then returns the same session id", () => {
      const store = createProbeStore(dbPath)
      const inserted = store.insertSession({
        id: "sess-label-1",
        hypothesis_id: null,
        identity_id: null,
        config: { label: "cif-kill-switch" },
      })
      const fetched = store.findSessionByLabel("cif-kill-switch")
      expect(fetched?.id).toBe(inserted.id)
      store.close()
    })
  })
})
