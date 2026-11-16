/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { rmSync, unlinkSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"
import { type Tools, verifyOperatorDarwin } from "../.github/workflows/operator-darwin-verify.ts"
import {
  adhocReport,
  buildFiles,
  engineMeta,
  type Fixture,
  machoWithMeta,
  PREPARED_SHA,
  signatureReport,
  SOURCE_SHA,
  TAG,
  VERSION,
  writeFixture,
} from "./fixtures/operator-darwin-artifacts"

/**
 * Release security contract (#13921): publish-platform consumes operator-built darwin artifacts only after
 * verify.ts accepts every one of them. Each row forges exactly one defect and must be refused with its own
 * reason; the untouched fixture is the GREEN control. rcodesign, Apple's ticket service and git are injected,
 * with the rcodesign report shaped like rcodesign 0.29 print-signature-info output.
 */

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

type Overrides = {
  readonly verifyStatus?: (name: string) => number
  readonly ticket?: (cdhash: string) => boolean
  readonly ancestor?: boolean
  readonly delta?: string
  readonly report?: (name: string) => string | undefined
}

async function run(fixture: Fixture, overrides: Overrides = {}, input: Partial<{ tag: string; prepared: string; version: string }> = {}) {
  dirs.push(fixture.dir)
  const tickets: string[] = []
  const tools: Tools = {
    verify: (file) => overrides.verifyStatus?.(basename(file)) ?? 0,
    signatureInfo: (file) => {
      const forged = overrides.report?.(basename(file))
      if (forged !== undefined) return forged
      const fields = fixture.signatures.get(basename(file))
      return fields ? signatureReport(file, fields) : "[]"
    },
    ticket: async (cdhash) => {
      tickets.push(cdhash)
      return overrides.ticket?.(cdhash) ?? true
    },
    git: (args) =>
      args[0] === "merge-base"
        ? { status: overrides.ancestor === false ? 1 : 0, stdout: "" }
        : { status: 0, stdout: overrides.delta ?? ".github/workflows/publish.yml\n" },
  }
  const verdict = await verifyOperatorDarwin(
    { dir: fixture.dir, tag: input.tag ?? TAG, preparedSha: input.prepared ?? PREPARED_SHA, version: input.version ?? VERSION },
    tools,
  ).then(
    (rows) => ({ ok: true, detail: rows.join("\n") }),
    (error: Error) => ({ ok: false, detail: error.message }),
  )
  return { ...verdict, tickets }
}

function forge(name: string, change: Partial<NonNullable<ReturnType<Fixture["signatures"]["get"]>>>): Fixture {
  const fixture = writeFixture()
  const fields = fixture.signatures.get(name)
  if (!fields) throw new Error(`no fixture signature for ${name}`)
  fixture.signatures.set(name, { ...fields, ...change })
  return fixture
}

describe("operator darwin verifier", () => {
  test("accepts the untouched staging set and looks up a ticket for every notarized artifact only", async () => {
    const outcome = await run(writeFixture())
    expect(outcome).toMatchObject({ ok: true })
    expect(outcome.detail).toContain(SOURCE_SHA)
    // 6 notarized artifacts; the two signed-only trust helpers have no ticket.
    expect(outcome.tickets).toHaveLength(6)
  })

  const refusals: Array<[string, () => Promise<{ ok: boolean; detail: string }>, RegExp]> = [
    ["an extra asset", async () => { const f = writeFixture(); writeFileSync(join(f.dir, "extra"), "x"); return run(f) }, /asset set differs/],
    ["a missing asset", async () => { const f = writeFixture(); unlinkSync(join(f.dir, "omo-darwin-x64")); return run(f) }, /asset set differs/],
    ["a .sha256 that does not match", async () => { const f = writeFixture(); writeFileSync(join(f.dir, "omo-darwin-arm64.sha256"), `${"0".repeat(64)}  omo-darwin-arm64\n`); return run(f) }, /omo-darwin-arm64: sha256 .* does not match omo-darwin-arm64\.sha256/],
    ["a manifest hash that does not match", () => run(writeFixture(buildFiles(), { sha256: {} })), /does not match the manifest/],
    ["a tag naming another source", () => run(writeFixture(), {}, { tag: "operator-darwin-aaaaaaaaaaaa" }), /does not name source/],
    ["a malformed tag", () => run(writeFixture(), {}, { tag: "operator-darwin-ABC" }), /is not operator-darwin-<12 hex>/],
    ["a short prepared sha", () => run(writeFixture(), {}, { prepared: "2222" }), /prepared_release_sha must be a full/],
    ["a manifest for another version", () => run(writeFixture(buildFiles(), { version: "5.1.72" })), /manifest version 5\.1\.72/],
    ["a source that is not an ancestor", () => run(writeFixture(), { ancestor: false }), /is not an ancestor/],
    ["a source differing outside workflows", () => run(writeFixture(), { delta: ".github/workflows/publish.yml\nscript/build-omo-binary.ts\n" }), /outside \.github\/workflows\/: script\/build-omo-binary\.ts/],
    ["a failing rcodesign verify", () => run(writeFixture(), { verifyStatus: (name) => (name === "omo-darwin-x64" ? 1 : 0) }), /omo-darwin-x64: rcodesign verify failed/],
    ["an unsigned file", async () => { const f = writeFixture(); f.signatures.delete("omo-keychain-darwin-universal"); return run(f) }, /omo-keychain-darwin-universal: no code signature/],
    ["an ad-hoc signature (no team, no Developer ID signer)", () => run(writeFixture(), { report: (name) => (name === "omo-darwin-arm64" ? adhocReport(name, "ai.sisyphuslabs.omo", "a".repeat(64)) : undefined) }), /omo-darwin-arm64: TeamIdentifier , expected 523JNR86LZ/],
    ["another identifier", () => run(forge("senpi-desktop-engine-darwin-x64", { identifier: "ai.sisyphuslabs.omo" })), /identifier ai\.sisyphuslabs\.omo, expected/],
    ["another team in the code directory", () => run(forge("omo-darwin-arm64", { team: "ABCDE12345" })), /TeamIdentifier ABCDE12345/],
    ["a signer certificate of another team", () => run(forge("omo-darwin-arm64", { leafTeam: "ABCDE12345" })), /not a Developer ID Application certificate/],
    ["a non-Developer-ID signer profile", () => run(forge("omo-engine-trust-helper-darwin-arm64", { leafProfile: "apple-development" })), /not a Developer ID Application certificate/],
    ["a chain that does not reach Apple", () => run(forge("omo-keychain-darwin-universal", { chains: false })), /not a Developer ID Application certificate/],
    ["a missing hardened runtime", () => run(forge("omo-darwin-x64-baseline", { flags: "ADHOC" })), /hardened runtime flag missing/],
    ["a CMS signature over another code directory", () => run(forge("omo-darwin-arm64", { signerDigest: "f".repeat(64) })), /does not sign the code directory/],
    ["a notarized artifact without a ticket", async () => { const f = writeFixture(); const cd = f.signatures.get("omo-keychain-darwin-universal")?.cdSha256.slice(0, 40); return run(f, { ticket: (h) => h !== cd }) }, /omo-keychain-darwin-universal: no notarization ticket/],
    ["an engine without the source section", () => { const files = buildFiles(); files.set("senpi-desktop-engine-darwin-arm64", new TextEncoder().encode("plain")); return run(writeFixture(files)) }, /no __OMO_META,__build section/],
    ["an engine built from another source", () => { const files = buildFiles(); files.set("senpi-desktop-engine-darwin-x64", machoWithMeta(engineMeta("darwin-x64", "x86_64-apple-darwin", { source_sha: "3".repeat(40) }), "e")); return run(writeFixture(files)) }, /embedded source_sha 3{40}/],
    ["an engine stamped for another host", () => { const files = buildFiles(); files.set("senpi-desktop-engine-darwin-x64", machoWithMeta(engineMeta("darwin-arm64", "aarch64-apple-darwin"), "e")); return run(writeFixture(files)) }, /embedded target darwin-arm64/],
    ["an engine stamped for another version", () => { const files = buildFiles(); files.set("senpi-desktop-engine-darwin-arm64", machoWithMeta(engineMeta("darwin-arm64", "aarch64-apple-darwin", { version: "5.1.72" }), "e")); return run(writeFixture(files)) }, /embedded version 5\.1\.72/],
    ["an omo binary without its verified engine", () => { const files = buildFiles(); files.set("omo-darwin-x64-baseline", new TextEncoder().encode("omo without engine")); return run(writeFixture(files)) }, /omo-darwin-x64-baseline: does not embed the verified senpi-desktop-engine-darwin-x64/],
  ]
  for (const [name, outcome, reason] of refusals) {
    test(`refuses ${name}`, async () => {
      const result = await outcome()
      expect(result.ok).toBe(false)
      expect(result.detail).toMatch(reason)
    })
  }
})
