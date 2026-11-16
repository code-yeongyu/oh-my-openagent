import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { AuthorityAudit, ConsentBridge, readHostLatch } from "../src/index.ts"
import { tempDirs } from "./support/tmp.ts"

const temp = tempDirs("omo-hand-consent-")

/** The engine's own settings table (generated schema): every row it marks as an admission key. */
const ADMISSION_KEYS: readonly string[] = (() => {
  const schema: unknown = JSON.parse(
    readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../../crates/omo-computer-core/schema/engine.schema.json"),
      "utf8",
    ),
  )
  const table: unknown =
    typeof schema === "object" && schema !== null ? Reflect.get(schema, "settingsTable") : undefined
  if (!Array.isArray(table)) throw new Error("the engine schema has no settingsTable")
  return table
    .filter((row: unknown) => typeof row === "object" && row !== null && Reflect.get(row, "admissionKey") === true)
    .map((row: unknown) => `computer.${String(Reflect.get(Object(row), "key"))}`)
})()

const CONSENT = {
  v: 1,
  computerUse: true,
  remoteCommands: true,
  foreground: "policy",
  apps: { allow: [], deny: [], mentions: [] },
}

interface Hand {
  readonly dir: string
  readonly files: {
    readonly consent: string
    readonly sidecar: string
    readonly hostLatch: string
    readonly audit: string
  }
  readonly settingsFile: string
  start(writerPid: number, authority?: boolean): ConsentBridge
}

function hand(): Hand {
  const dir = temp()
  const files = {
    consent: join(dir, "computer", "consent.json"),
    sidecar: join(dir, "computer", "consent-sidecar.json"),
    hostLatch: join(dir, "computer", "host-latch"),
    audit: join(dir, "audit", "audit.jsonl"),
  }
  const settingsFile = join(dir, "settings.json")
  writeFileSync(settingsFile, JSON.stringify(Object.fromEntries(ADMISSION_KEYS.map((key) => [key, false]))))
  const settings = () => JSON.parse(readFileSync(settingsFile, "utf8"))
  return {
    dir,
    files,
    settingsFile,
    start: (writerPid, authority = true) => {
      const audit = authority
        ? new AuthorityAudit(files.audit, {
            handId: "hand-1",
            generation: 1,
            writerPid,
            writerProcStartMs: writerPid * 1000,
          })
        : undefined
      return new ConsentBridge({
        files,
        admissionKeys: ADMISSION_KEYS,
        settings,
        audit,
        latch: () => ({ suspended: false, stopEpoch: 2 }),
      })
    },
  }
}

function lines(path: string): Array<Record<string, unknown>> {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line))
}

describe("consent tamper evidence bound to the audit chain", () => {
  it("the engine's table marks the admission keys this test flips (send_on_enter, record, background_indicator among them)", () => {
    expect(ADMISSION_KEYS).toEqual(
      expect.arrayContaining([
        "computer.send_on_enter",
        "computer.record",
        "computer.background_indicator",
        "computer.stop_hotkey",
      ]),
    )
  })

  it("consent_chain_survives_three_rotations_and_a_host_restart", () => {
    // Given a hand whose user saved consent once, then three audit rotations.
    const h = hand()
    const host = h.start(100)
    expect(host.verifyAndAnchor()).toMatchObject({ kind: "clean", chainOk: true })
    host.save(CONSENT)
    for (let rotation = 0; rotation < 3; rotation++) expect(host.rotate()).toMatchObject({ kind: "rotated" })

    // When the host restarts (a new writer segment).
    const restarted = h.start(200)

    // Then the newest segment verifies: not tampered, chain ok.
    expect(restarted.verifyAndAnchor()).toMatchObject({ kind: "clean", chainOk: true })
  })

  it("forged_sidecar_after_rotation_still_reads_chain_broken", () => {
    // Given a rotated hand.
    const h = hand()
    const host = h.start(100)
    host.verifyAndAnchor()
    host.save(CONSENT)
    const before = JSON.parse(readFileSync(h.files.sidecar, "utf8"))
    host.rotate()

    // When the sidecar is put back to its pre-rotation line (a real line, but not in the newest segment), or forged outright.
    for (const lineHash of [before.lineHash, "0123456789abcdef"]) {
      writeFileSync(h.files.sidecar, JSON.stringify({ fingerprint: before.fingerprint, lineHash }), { mode: 0o600 })

      // Then a restarted host reads chain_broken.
      expect(h.start(300).verifyAndAnchor()).toEqual({ kind: "chain_broken" })
    }
  })

  it("consent_and_sidecar_rewritten_then_host_restart_reads_rebased", () => {
    // Given a saved consent.
    const h = hand()
    const host = h.start(100)
    host.verifyAndAnchor()
    host.save(CONSENT)

    // When both consent.json and the sidecar's fingerprint are rewritten consistently, outside the UI.
    const sidecar = JSON.parse(readFileSync(h.files.sidecar, "utf8"))
    writeFileSync(h.files.consent, JSON.stringify({ ...CONSENT, foreground: "always" }), { mode: 0o600 })
    const forged = h.start(400).fingerprintNow()
    writeFileSync(h.files.sidecar, JSON.stringify({ fingerprint: forged, lineHash: sidecar.lineHash }), { mode: 0o600 })

    // Then the restarted host reads rebased: the fingerprint moved with no audited consent_save.
    expect(h.start(500).verifyAndAnchor()).toEqual({ kind: "rebased" })
  })

  it("send_on_enter_rewritten_outside_the_ui_reads_tampered", () => {
    const h = hand()
    const host = h.start(100)
    host.verifyAndAnchor()
    host.save(CONSENT)
    writeFileSync(
      h.settingsFile,
      JSON.stringify({ ...JSON.parse(readFileSync(h.settingsFile, "utf8")), "computer.send_on_enter": true }),
    )
    expect(h.start(600).verifyAndAnchor()).toEqual({ kind: "tampered" })
  })

  it("every admission key flipped outside the UI reads tampered; a UI save of the same flip reads clean", () => {
    for (const key of ADMISSION_KEYS) {
      const h = hand()
      const host = h.start(100)
      host.verifyAndAnchor()
      host.save(CONSENT)
      const flipped = { ...JSON.parse(readFileSync(h.settingsFile, "utf8")), [key]: true }
      writeFileSync(h.settingsFile, JSON.stringify(flipped))
      expect([key, h.start(700).verifyAndAnchor().kind]).toEqual([key, "tampered"])
      const saving = h.start(800)
      saving.save(CONSENT)
      expect([key, h.start(900).verifyAndAnchor().kind]).toEqual([key, "clean"])
    }
  })

  it("rotation_is_performed_by_the_authority_host_anchor_first", () => {
    // Given a hand with a saved consent and a latch.
    const h = hand()
    const host = h.start(100)
    host.verifyAndAnchor()
    host.save(CONSENT)
    const lastBefore = lines(h.files.audit).at(-1)?.lineHash

    // When the authority host rotates.
    host.rotate()

    // Then the old file is audit.1.jsonl and the new one opens with audit.meta then the rotation_anchor, chained to the old file's last line.
    const rotated = lines(join(h.dir, "audit", "audit.1.jsonl"))
    expect(rotated.at(-1)?.lineHash).toBe(lastBefore)
    const [meta, anchor] = lines(h.files.audit)
    expect(meta).toMatchObject({ kind: "audit.meta", schema: 2, handId: "hand-1", writerPid: 100 })
    expect(anchor).toMatchObject({
      prev: lastBefore,
      grant: { kind: "consent_save", verdict: "rotation_anchor", latch: { suspended: false, stopEpoch: 2 } },
    })

    // And the sidecar and the host latch both point at the anchor.
    expect(JSON.parse(readFileSync(h.files.sidecar, "utf8")).lineHash).toBe(anchor?.lineHash)
    expect(JSON.parse(readFileSync(h.files.hostLatch, "utf8"))).toMatchObject({
      suspended: false,
      stopEpoch: 2,
      lineHash: anchor?.lineHash,
    })
    expect(readHostLatch(h.files.hostLatch)).toEqual({ kind: "read", latch: { suspended: false, stopEpoch: 2 } })
  })

  it("rotation_without_an_authority_host_is_refused_until_the_host_returns", () => {
    // Given a hand whose only live host is not the authority.
    const h = hand()
    h.start(100).verifyAndAnchor()
    const attachOnly = h.start(150, false)

    // When rotation is asked of it, nothing rotates and the answer is Unavailable{audit_unavailable}.
    expect(attachOnly.rotate()).toEqual({ kind: "refused", code: "Unavailable", reason: "audit_unavailable" })
    expect(existsSync(join(h.dir, "audit", "audit.1.jsonl"))).toBe(false)

    // Then once the authority host returns, it rotates.
    expect(h.start(160).rotate()).toMatchObject({ kind: "rotated" })
    expect(existsSync(join(h.dir, "audit", "audit.1.jsonl"))).toBe(true)
  })
})
