/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { rmSync, unlinkSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"
import { createHash, X509Certificate } from "node:crypto"
import {
  inspectSignatures,
  Refusal,
  type SliceFacts,
  type Tools,
  verifyOperatorDarwin,
} from "../.github/workflows/operator-darwin-verify.ts"
import {
  buildFiles,
  engineMeta,
  type Fixture,
  machoWithMeta,
  PREPARED_SHA,
  SOURCE_SHA,
  TAG,
  VERSION,
  writeFixture,
} from "./fixtures/operator-darwin-artifacts"
import { certificateNames, issue, machoSigned, signedData } from "./fixtures/operator-darwin-signing"

/**
 * Release security contract (#13921): publish-platform consumes operator-built darwin artifacts only after
 * verify.ts accepts every one of them. Each row forges exactly one defect and must be refused with its own
 * reason; the untouched fixture is the GREEN control. The signature inspector (whose own checks are proven in
 * publish-operator-darwin-{signature,macho}.test.ts), Apple's ticket service and git are injected.
 */

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

type Overrides = {
  readonly ticket?: (cdhash: string) => boolean
  readonly ancestor?: boolean
  readonly delta?: string
  /** Replaces the inspector's answer for one artifact: forged facts, or a refusal reason. */
  readonly inspect?: (name: string) => SliceFacts[] | string | undefined
  readonly roles?: Readonly<Record<string, string | null>>
}

type RunInput = Partial<{ tag: string; prepared: string; version: string; manifestSha256: string; actors: string[] }>

async function run(fixture: Fixture, overrides: Overrides = {}, input: RunInput = {}) {
  dirs.push(fixture.dir)
  const tickets: string[] = []
  const nameOf = (bytes: Uint8Array) =>
    [...fixture.files].find(([, content]) => Buffer.from(content).equals(Buffer.from(bytes)))?.[0] ?? ""
  const tools: Tools = {
    inspect: (bytes) => {
      const name = nameOf(bytes)
      const forged = overrides.inspect?.(name)
      if (typeof forged === "string") throw new Refusal(forged)
      return forged ?? fixture.signatures.get(name) ?? []
    },
    ticket: async (cdhash) => {
      tickets.push(cdhash)
      return overrides.ticket?.(cdhash) ?? true
    },
    git: (args) =>
      args[0] === "merge-base"
        ? { status: overrides.ancestor === false ? 1 : 0, stdout: "" }
        : { status: 0, stdout: overrides.delta ?? ".github/workflows/publish.yml\n" },
    role: async (login) => {
      const roles = overrides.roles ?? { maintainer: "maintain", owner: "admin", writer: "write" }
      return login in roles ? (roles[login] ?? null) : "none"
    },
  }
  const verdict = await verifyOperatorDarwin(
    {
      dir: fixture.dir,
      tag: input.tag ?? TAG,
      manifestSha256: input.manifestSha256 ?? fixture.manifestSha256,
      actors: input.actors ?? ["maintainer", "owner"],
      preparedSha: input.prepared ?? PREPARED_SHA,
      version: input.version ?? VERSION,
    },
    tools,
  ).then(
    (rows) => ({ ok: true, detail: rows.join("\n") }),
    (error: Error) => ({ ok: false, detail: error.message }),
  )
  return { ...verdict, tickets }
}

/**
 * A Mach-O whose CodeDirectory says team 523JNR86LZ, signed by a foreign Developer ID leaf that is CA-valid under a
 * generated root and CA, with our team's leaf prepended to the CMS list; inspected with those test-only anchors.
 */
function caValidForeignSigner(): SliceFacts[] {
  const CN = "2.5.4.3"
  const OU = "2.5.4.11"
  const root = issue({ subject: [[CN, "Test Root CA"]], serial: 30 })
  const ca = issue({
    subject: [[CN, "Test Developer ID CA"]],
    issuer: certificateNames(root.certificate).subject,
    issuerKey: root.key,
    serial: 31,
  })
  const caName = certificateNames(ca.certificate).subject
  const ours = issue({
    subject: [
      [CN, "Ours"],
      [OU, "523JNR86LZ"],
    ],
    issuer: caName,
    issuerKey: ca.key,
    serial: 32,
    developerIdApplication: true,
  })
  const foreign = issue({
    subject: [
      [CN, "Attacker"],
      [OU, "ATTACKER99"],
    ],
    issuer: caName,
    issuerKey: ca.key,
    serial: 33,
    developerIdApplication: true,
  })
  const { file } = machoSigned({
    code: new Uint8Array(5000),
    identifier: "ai.sisyphuslabs.omo",
    sign: (codeDirectory) =>
      signedData({
        signedOver: codeDirectory,
        key: foreign.key,
        signer: foreign.certificate,
        certificates: [ours.certificate, foreign.certificate],
      }),
  })
  return inspectSignatures(file, {
    root: new X509Certificate(root.certificate),
    developerIdCa: new X509Certificate(ca.certificate),
  })
}

/** Rewrites both keychain-helper slices of a fresh fixture's facts. */
function keychainSlices(change: (slice: SliceFacts) => SliceFacts): Overrides {
  const fixture = writeFixture()
  dirs.push(fixture.dir)
  const slices = (fixture.signatures.get("omo-keychain-darwin-universal") ?? []).map(change)
  return { inspect: (target) => (target === "omo-keychain-darwin-universal" ? slices : undefined) }
}

function forge(name: string, change: Partial<SliceFacts>): Overrides {
  const fixture = writeFixture()
  dirs.push(fixture.dir)
  const [fields] = fixture.signatures.get(name) ?? []
  if (!fields) throw new Error(`no fixture signature for ${name}`)
  return { inspect: (target) => (target === name ? [{ ...fields, ...change }] : undefined) }
}

describe("operator darwin verifier", () => {
  test("accepts the untouched staging set and looks up a ticket for every notarized artifact only", async () => {
    const outcome = await run(writeFixture())
    expect(outcome).toMatchObject({ ok: true })
    expect(outcome.detail).toContain(SOURCE_SHA)
    // 6 notarized artifacts, 7 slices (the keychain helper is universal); the two signed-only trust helpers have none.
    expect(outcome.tickets).toHaveLength(7)
  })

  const refusals: Array<[string, () => Promise<{ ok: boolean; detail: string }>, RegExp]> = [
    [
      "a manifest other than the pinned one",
      () => run(writeFixture(), {}, { manifestSha256: "0".repeat(64) }),
      /operator-darwin-manifest\.json sha256 [0-9a-f]{64} is not the pinned operator_darwin_manifest_sha256 0{64}/,
    ],
    [
      "a malformed manifest pin",
      () => run(writeFixture(), {}, { manifestSha256: "abc" }),
      /operator_darwin_manifest_sha256 must be a 64-hex sha256/,
    ],
    [
      "a write-role dispatcher",
      () => run(writeFixture(), {}, { actors: ["writer", "maintainer"] }),
      /writer has repository role 'write'/,
    ],
    [
      "a write-role triggering actor",
      () => run(writeFixture(), {}, { actors: ["maintainer", "writer"] }),
      /writer has repository role 'write'/,
    ],
    [
      "an unreadable role",
      () => run(writeFixture(), { roles: { maintainer: null } }, { actors: ["maintainer"] }),
      /maintainer has repository role 'unreadable'/,
    ],
    [
      "a bot dispatcher",
      () => run(writeFixture(), {}, { actors: ["github-actions[bot]"] }),
      /github-actions\[bot\] has repository role 'not a user login'/,
    ],
    [
      "an extra asset",
      async () => {
        const f = writeFixture()
        writeFileSync(join(f.dir, "extra"), "x")
        return run(f)
      },
      /asset set differs/,
    ],
    [
      "a missing asset",
      async () => {
        const f = writeFixture()
        unlinkSync(join(f.dir, "omo-darwin-x64"))
        return run(f)
      },
      /asset set differs/,
    ],
    [
      "a .sha256 that does not match",
      async () => {
        const f = writeFixture()
        writeFileSync(join(f.dir, "omo-darwin-arm64.sha256"), `${"0".repeat(64)}  omo-darwin-arm64\n`)
        return run(f)
      },
      /omo-darwin-arm64: sha256 .* does not match omo-darwin-arm64\.sha256/,
    ],
    [
      "a manifest hash that does not match",
      () => run(writeFixture(buildFiles(), { sha256: {} })),
      /does not match the manifest/,
    ],
    [
      "an omo binary without the verified keychain helper",
      () => {
        const files = buildFiles()
        const omo = files.get("omo-darwin-arm64") ?? new Uint8Array()
        files.set(
          "omo-darwin-arm64",
          omo.subarray(0, omo.byteLength - (files.get("omo-keychain-darwin-universal")?.byteLength ?? 0)),
        )
        return run(writeFixture(files))
      },
      /omo-darwin-arm64: does not embed the verified omo-keychain-darwin-universal/,
    ],
    [
      "a tag naming another source",
      () => run(writeFixture(), {}, { tag: "operator-darwin-aaaaaaaaaaaa" }),
      /does not name source/,
    ],
    [
      "a malformed tag",
      () => run(writeFixture(), {}, { tag: "operator-darwin-ABC" }),
      /is not operator-darwin-<12 hex>/,
    ],
    [
      "a short prepared sha",
      () => run(writeFixture(), {}, { prepared: "2222" }),
      /prepared_release_sha must be a full/,
    ],
    [
      "a manifest for another version",
      () => run(writeFixture(buildFiles(), { version: "5.1.72" })),
      /manifest version 5\.1\.72/,
    ],
    ["a source that is not an ancestor", () => run(writeFixture(), { ancestor: false }), /is not an ancestor/],
    [
      "a source differing outside workflows",
      () => run(writeFixture(), { delta: ".github/workflows/publish.yml\nscript/build-omo-binary.ts\n" }),
      /outside \.github\/workflows\/: script\/build-omo-binary\.ts/,
    ],
    [
      "an invalid signature reported by the inspector",
      () =>
        run(writeFixture(), {
          inspect: (name) => (name === "omo-darwin-x64" ? "code page 3 does not match its hash" : undefined),
        }),
      /^omo-darwin-x64: code page 3 does not match its hash$/,
    ],
    [
      "an ad-hoc or unsigned slice",
      () =>
        run(writeFixture(), {
          inspect: (name) =>
            name === "omo-darwin-arm64" ? "no Developer ID signature (unsigned or ad-hoc)" : undefined,
        }),
      /^omo-darwin-arm64: no Developer ID signature/,
    ],
    [
      "a file with no signed slice",
      () => run(writeFixture(), { inspect: (name) => (name === "omo-keychain-darwin-universal" ? [] : undefined) }),
      /omo-keychain-darwin-universal: no code signature/,
    ],
    [
      "another identifier",
      () => run(writeFixture(), forge("senpi-desktop-engine-darwin-x64", { identifier: "ai.sisyphuslabs.omo" })),
      /identifier ai\.sisyphuslabs\.omo, expected/,
    ],
    [
      "another team in the code directory",
      () => run(writeFixture(), forge("omo-darwin-arm64", { team: "ABCDE12345" })),
      /TeamIdentifier ABCDE12345/,
    ],
    [
      "a signing certificate of another team",
      () => run(writeFixture(), forge("omo-engine-trust-helper-darwin-arm64", { signerTeam: "ATTACKER99" })),
      /signed by team ATTACKER99, expected 523JNR86LZ/,
    ],
    [
      "a missing hardened runtime",
      () => run(writeFixture(), forge("omo-darwin-x64-baseline", { runtime: false })),
      /hardened runtime flag missing/,
    ],
    [
      "review NIT-1: a CA-valid foreign signer with our leaf prepended, end to end",
      () =>
        run(writeFixture(), { inspect: (name) => (name === "omo-darwin-arm64" ? caValidForeignSigner() : undefined) }),
      /^omo-darwin-arm64: signed by team ATTACKER99, expected 523JNR86LZ$/,
    ],
    [
      "#13964 LOW-2: an arm64e keychain helper slice",
      () =>
        run(
          writeFixture(),
          keychainSlices((slice) => (slice.cpuType === 0x0100000c ? { ...slice, cpuSubtype: 2 } : slice)),
        ),
      /omo-keychain-darwin-universal: slices are not exactly x86_64 \+ arm64/,
    ],
    [
      "#13964 LOW-1: a pinned manifest that is not JSON",
      () => {
        const fixture = writeFixture()
        writeFileSync(join(fixture.dir, "operator-darwin-manifest.json"), "{not json")
        return run(fixture, {}, { manifestSha256: createHash("sha256").update("{not json").digest("hex") })
      },
      /^operator-darwin-manifest\.json is not valid JSON$/,
    ],
    [
      "a keychain helper with another designated requirement",
      () =>
        run(
          writeFixture(),
          keychainSlices((slice) => ({ ...slice, requirementsSha256: "0".repeat(64) })),
        ),
      /omo-keychain-darwin-universal: designated requirement differs/,
    ],
    [
      "a keychain helper with entitlements",
      () =>
        run(
          writeFixture(),
          keychainSlices((slice) => ({ ...slice, entitlements: true })),
        ),
      /omo-keychain-darwin-universal: carries entitlements/,
    ],
    [
      "a keychain helper missing its x86_64 slice",
      () =>
        run(
          writeFixture(),
          keychainSlices((slice) => ({ ...slice, cpuType: 0x0100000c })),
        ),
      /omo-keychain-darwin-universal: slices are not exactly x86_64 \+ arm64/,
    ],
    [
      "a notarized artifact without a ticket",
      async () => {
        const f = writeFixture()
        const cd = f.signatures.get("omo-keychain-darwin-universal")?.[0]?.cdhash
        return run(f, { ticket: (h) => h !== cd })
      },
      /omo-keychain-darwin-universal: no notarization ticket/,
    ],
    [
      "a source stamp outside the signed bytes",
      async () => {
        const f = writeFixture()
        const [facts] = f.signatures.get("senpi-desktop-engine-darwin-arm64") ?? []
        return run(f, {
          inspect: (n) =>
            n === "senpi-desktop-engine-darwin-arm64" && facts ? [{ ...facts, hashedEnd: 100 }] : undefined,
        })
      },
      /__OMO_META,__build lies outside the signed bytes/,
    ],
    [
      "an engine embedded only in unsigned bytes of the omo binary",
      async () => {
        const f = writeFixture()
        const [facts] = f.signatures.get("omo-darwin-arm64") ?? []
        return run(f, {
          inspect: (n) => (n === "omo-darwin-arm64" && facts ? [{ ...facts, hashedEnd: 20 }] : undefined),
        })
      },
      /omo-darwin-arm64: does not embed the verified senpi-desktop-engine-darwin-arm64/,
    ],
    [
      "an engine without the source section",
      () => {
        const files = buildFiles()
        files.set("senpi-desktop-engine-darwin-arm64", new TextEncoder().encode("plain"))
        return run(writeFixture(files))
      },
      /no __OMO_META,__build section/,
    ],
    [
      "an engine built from another source",
      () => {
        const files = buildFiles()
        files.set(
          "senpi-desktop-engine-darwin-x64",
          machoWithMeta(engineMeta("darwin-x64", "x86_64-apple-darwin", { source_sha: "3".repeat(40) }), "e"),
        )
        return run(writeFixture(files))
      },
      /embedded source_sha 3{40}/,
    ],
    [
      "an engine stamped for another host",
      () => {
        const files = buildFiles()
        files.set(
          "senpi-desktop-engine-darwin-x64",
          machoWithMeta(engineMeta("darwin-arm64", "aarch64-apple-darwin"), "e"),
        )
        return run(writeFixture(files))
      },
      /embedded target darwin-arm64/,
    ],
    [
      "an engine stamped for another version",
      () => {
        const files = buildFiles()
        files.set(
          "senpi-desktop-engine-darwin-arm64",
          machoWithMeta(engineMeta("darwin-arm64", "aarch64-apple-darwin", { version: "5.1.72" }), "e"),
        )
        return run(writeFixture(files))
      },
      /embedded version 5\.1\.72/,
    ],
    [
      "an omo binary without its verified engine",
      () => {
        const files = buildFiles()
        files.set("omo-darwin-x64-baseline", new TextEncoder().encode("omo without engine"))
        return run(writeFixture(files))
      },
      /omo-darwin-x64-baseline: does not embed the verified senpi-desktop-engine-darwin-x64/,
    ],
  ]
  for (const [name, outcome, reason] of refusals) {
    test(`refuses ${name}`, async () => {
      const result = await outcome()
      expect(result.ok).toBe(false)
      expect(result.detail).toMatch(reason)
    })
  }
})
