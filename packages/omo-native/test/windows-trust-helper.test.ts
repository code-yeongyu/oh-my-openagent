import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { selectEngineTrust } from "../engine-trust-policy"
import {
  WINDOWS_TRUST_HELPER_MAX_OUTPUT_BYTES,
  decodeWindowsTrustHelperOutput,
  encodeBundledRootsForHelper,
  windowsTrustHelperEnvironment,
} from "../windows-trust-helper"
import { issueCertificates } from "./trust-certificate-fixtures"

// A private PKI per run, made with the OpenSSL CLI in a test-owned directory.
const CA = "basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign"
let base = ""
const R = { der: new Uint8Array() }
const X = { der: new Uint8Array() }
const Q = { der: new Uint8Array() }
const N = { der: new Uint8Array() }
beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), "omo-windows-trust-helper-"))
  const issued = await issueCertificates(base, [
    { name: "R", subject: "/CN=Example Trust Test windows decoder R", days: 30, extensions: CA },
    { name: "X", subject: "/CN=Example Trust Test windows decoder X", issuer: "R", days: 30, extensions: `${CA}\nextendedKeyUsage=serverAuth` },
    { name: "Q", subject: "/CN=Example Trust Test windows decoder Q", days: 30, extensions: CA },
    { name: "N", subject: "/CN=Example Trust Test windows decoder N", days: 30, extensions: CA },
  ])
  for (const [name, target] of [["R", R], ["X", X], ["Q", Q], ["N", N]] as const) target.der = new Uint8Array(issued.get(name) ?? [])
})
afterAll(async () => {
  if (base) await rm(base, { recursive: true, force: true })
})

const b64 = (der: Uint8Array) => Buffer.from(der).toString("base64")
const id = (der: Uint8Array) => ({
  sha256: createHash("sha256").update(der).digest("hex"),
  sha1: createHash("sha1").update(der).digest("hex"),
})
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
const disallowedSources = ["CURRENT_USER", "LOCAL_MACHINE", "CURRENT_USER_GROUP_POLICY", "LOCAL_MACHINE_GROUP_POLICY", "LOCAL_MACHINE_ENTERPRISE"]
  .map((location) => ({ store: "Disallowed", location, physicalStore: ".Default", outcome: "read", status: 0 }))

type Wire = Record<string, unknown> & { certificates: Record<string, unknown>[]; sources: Record<string, unknown>[] }
function wire(): Wire {
  return {
    schema: 1,
    os: "windows",
    complete: true,
    sources: [{ store: "ROOT", location: "LOCAL_MACHINE", physicalStore: ".Default", outcome: "read", status: 0 }, ...disallowedSources],
    ctl: "read",
    certificates: [
      { der: b64(R.der), store: "ROOT", location: "LOCAL_MACHINE", physicalStore: ".Default", selfSigned: true, ca: true, eku: { kind: "unrestricted" } },
      {
        der: b64(X.der), store: "CA", location: "CURRENT_USER", physicalStore: ".Default", selfSigned: false, ca: true,
        eku: { kind: "oids", oids: ["1.3.6.1.5.5.7.3.1"] },
        chain: { anchor: id(R.der), path: [id(X.der), id(R.der)], explicitDistrust: false },
      },
    ],
    disallowed: [{ der: b64(N.der), location: "LOCAL_MACHINE", physicalStore: ".Default" }],
    ctlSha1: [id(Q.der).sha1],
    bundledRoots: [id(Q.der)],
  }
}

function failure(value: unknown) {
  const result = decodeWindowsTrustHelperOutput(value instanceof Uint8Array ? value : bytes(value))
  if (result.kind === "decoded") throw new Error("expected the decoder to reject the document")
  return result
}
function decoded(value: unknown) {
  const result = decodeWindowsTrustHelperOutput(bytes(value))
  if (result.kind !== "decoded") throw new Error(`${result.check} at ${result.path}`)
  return result.document
}

describe("decodeWindowsTrustHelperOutput", () => {
  test("#given a complete helper document #when decoding #then it yields exactly the policy facts and DER by identity", () => {
    const result = { output: decoded(wire()) }
    expect(result.output.facts).toEqual({
      os: "windows",
      complete: true,
      certificates: [
        { ...id(R.der), store: "ROOT", location: "LOCAL_MACHINE", physicalStore: ".Default", selfSigned: true, ca: true, eku: { kind: "unrestricted" } },
        {
          ...id(X.der), store: "CA", location: "CURRENT_USER", physicalStore: ".Default", selfSigned: false, ca: true,
          eku: { kind: "oids", oids: ["1.3.6.1.5.5.7.3.1"] },
          chain: { anchor: id(R.der), path: [id(X.der), id(R.der)], explicitDistrust: false },
        },
      ],
      disallowed: [{ ...id(N.der), location: "LOCAL_MACHINE", physicalStore: ".Default" }],
      ctlSha1: [id(Q.der).sha1],
      bundledRoots: [id(Q.der)],
    })
    expect([...result.output.der.keys()].sort()).toEqual([id(R.der).sha256, id(X.der).sha256].sort())
    expect(result.output.der.get(id(X.der).sha256)).toEqual(X.der)
    expect(result.output.ctl).toBe("read")
    expect(result.output.sources).toHaveLength(6)
    const selection = selectEngineTrust(result.output.facts)
    expect(selection.status).toBe("selected")
    expect(selection.S).toEqual([id(R.der).sha256])
    expect(selection.I).toEqual([id(X.der).sha256])
    expect(selection.D).toEqual({ sha256: [id(N.der).sha256], sha1: [id(Q.der).sha1] })
  })

  test.each([
    ["access-denied"],
    ["enumeration-failed"],
  ])("#given a Disallowed source %s and complete:false #when decoding and selecting #then the import fails closed", (outcome) => {
    const document = wire()
    document.complete = false
    document.sources = [...document.sources.slice(0, 2), { ...document.sources[2], outcome, status: 5 }, ...document.sources.slice(3)]
    const result = { output: decoded(document) }
    expect(result.output.facts.complete).toBe(false)
    const selection = selectEngineTrust(result.output.facts)
    expect(selection.status).toBe("failed")
    expect(selection.diagnostics).toEqual(["negative-sources-incomplete"])
  })

  test.each([
    ["a Disallowed store access-denied", (document: Wire) => { document.sources = [{ ...document.sources[1], outcome: "access-denied" }] }, "$.complete"],
    ["a Disallowed store enumeration-failed", (document: Wire) => { document.sources = [{ ...document.sources[1], outcome: "enumeration-failed" }] }, "$.complete"],
    ["an unreadable CTL", (document: Wire) => { document.ctl = "unreadable" }, "$.complete"],
    ["an undecodable CTL", (document: Wire) => { document.ctl = "undecodable" }, "$.complete"],
    ["a CTL with an unsupported subject algorithm", (document: Wire) => { document.ctl = "unsupported-subject-algorithm" }, "$.complete"],
    ["a CTL with an entry of an unsupported length", (document: Wire) => { document.ctl = "unsupported-entry-length" }, "$.complete"],
  ])("#given %s with complete:true #when decoding #then the claim is rejected as inconsistent", (_case, mutate, path) => {
    const document = wire()
    mutate(document)
    expect(failure(document)).toEqual({ kind: "helper-malformed-output", check: "inconsistent-complete", path })
  })

  test("#given absent, access-denied and failed positive stores #when decoding #then the outcomes stay distinct and complete holds", () => {
    const document = wire()
    document.sources = [
      ...document.sources,
      { store: "TrustedPeople", location: "LOCAL_MACHINE_ENTERPRISE", physicalStore: null, outcome: "absent", status: 2 },
      { store: "CA", location: "LOCAL_MACHINE_GROUP_POLICY", physicalStore: ".GroupPolicy", outcome: "access-denied", status: 5 },
      { store: "ROOT", location: "CURRENT_USER", physicalStore: ".SmartCard", outcome: "enumeration-failed", status: 0x80092004 },
    ]
    const result = decoded(document)
    expect(result.sources.slice(-3).map((source) => [source.outcome, source.status]))
      .toEqual([["absent", 2], ["access-denied", 5], ["enumeration-failed", 0x80092004]])
    expect(result.facts.complete).toBe(true)
  })

  test.each([
    ["a top-level field", (document: Wire) => { document.extra = 1 }, "$.extra"],
    ["a certificate field", (document: Wire) => { document.certificates[0] = { ...document.certificates[0], subject: "CN=x" } }, "$.certificates[0].subject"],
    ["a chain field", (document: Wire) => { document.certificates[1] = { ...document.certificates[1], chain: { ...(document.certificates[1]?.chain as object), score: 1 } } }, "$.certificates[1].chain.score"],
    ["an EKU field", (document: Wire) => { document.certificates[0] = { ...document.certificates[0], eku: { kind: "unrestricted", oids: [] } } }, "$.certificates[0].eku.oids"],
    ["a source field", (document: Wire) => { document.sources[0] = { ...document.sources[0], error: 5 } }, "$.sources[0].error"],
  ])("#given an unknown %s #when decoding #then it is rejected", (_case, mutate, path) => {
    const document = wire()
    mutate(document)
    expect(failure(document)).toEqual({ kind: "helper-malformed-output", check: "unknown-field", path })
  })

  test.each(["schema", "os", "complete", "sources", "ctl", "certificates", "disallowed", "ctlSha1", "bundledRoots"])(
    "#given no %s #when decoding #then it is rejected as missing",
    (field) => {
      const document = wire()
      delete document[field]
      expect(failure(document)).toEqual({ kind: "helper-malformed-output", check: "missing-field", path: `$.${field}` })
    },
  )

  test.each([
    ["a string complete", (document: Wire) => { document.complete = "true" }, "wrong-type", "$.complete"],
    ["a non-array certificates", (document: Wire) => { document.certificates = {} as never }, "wrong-type", "$.certificates"],
    ["a numeric selfSigned", (document: Wire) => { document.certificates[0] = { ...document.certificates[0], selfSigned: 1 } }, "wrong-type", "$.certificates[0].selfSigned"],
    ["a null document", () => null, "wrong-type", "$"],
    ["another schema", (document: Wire) => { document.schema = 2 }, "invalid-value", "$.schema"],
    ["a negative status", (document: Wire) => { document.sources[0] = { ...document.sources[0], status: -1 } }, "invalid-value", "$.sources[0].status"],
    ["a fractional status", (document: Wire) => { document.sources[0] = { ...document.sources[0], status: 1.5 } }, "wrong-type", "$.sources[0].status"],
    ["the macOS-only disabled outcome", (document: Wire) => { document.sources[0] = { ...document.sources[0], outcome: "disabled" } }, "invalid-value", "$.sources[0].outcome"],
    ["another OS", (document: Wire) => { document.os = "macos" }, "invalid-value", "$.os"],
    ["an unknown EKU kind", (document: Wire) => { document.certificates[0] = { ...document.certificates[0], eku: { kind: "maybe" } } }, "invalid-value", "$.certificates[0].eku.kind"],
    ["a non-OID usage", (document: Wire) => { document.certificates[0] = { ...document.certificates[0], eku: { kind: "oids", oids: ["serverAuth"] } } }, "invalid-value", "$.certificates[0].eku.oids[0]"],
    ["an unknown location", (document: Wire) => { document.certificates[0] = { ...document.certificates[0], location: "MOON" } }, "invalid-value", "$.certificates[0].location"],
    ["a Disallowed positive store", (document: Wire) => { document.certificates[0] = { ...document.certificates[0], store: "Disallowed" } }, "invalid-value", "$.certificates[0].store"],
    ["an empty physical store name", (document: Wire) => { document.certificates[0] = { ...document.certificates[0], physicalStore: "" } }, "invalid-value", "$.certificates[0].physicalStore"],
    ["an unknown source outcome", (document: Wire) => { document.sources[0] = { ...document.sources[0], outcome: "maybe" } }, "invalid-value", "$.sources[0].outcome"],
    ["an unknown CTL outcome", (document: Wire) => { document.ctl = "skipped" }, "invalid-value", "$.ctl"],
    ["an upper-case CTL thumbprint", (document: Wire) => { document.ctlSha1 = [id(Q.der).sha1.toUpperCase()] }, "invalid-value", "$.ctlSha1[0]"],
    ["a short CTL thumbprint", (document: Wire) => { document.ctlSha1 = ["abcd"] }, "invalid-value", "$.ctlSha1[0]"],
    ["a SHA-1 in a SHA-256 slot", (document: Wire) => { document.bundledRoots = [{ sha256: id(Q.der).sha1, sha1: id(Q.der).sha1 }] }, "invalid-value", "$.bundledRoots[0].sha256"],
    ["a null chain path entry", (document: Wire) => { document.certificates[1] = { ...document.certificates[1], chain: { anchor: null, path: [null], explicitDistrust: false } } }, "wrong-type", "$.certificates[1].chain.path[0]"],
    // The policy denies by path member and anchor, so a chain must describe its own certificate (shared with the macOS decoder).
    ["a chain whose path starts at another certificate", (document: Wire) => { document.certificates[1] = { ...document.certificates[1], chain: { anchor: id(R.der), path: [id(R.der)], explicitDistrust: false } } }, "invalid-value", "$.certificates[1].chain.path[0]"],
    ["an anchor that is not the path's last member", (document: Wire) => { document.certificates[1] = { ...document.certificates[1], chain: { anchor: id(Q.der), path: [id(X.der), id(R.der)], explicitDistrust: false } } }, "invalid-value", "$.certificates[1].chain.anchor"],
    ["an anchor with an empty path", (document: Wire) => { document.certificates[1] = { ...document.certificates[1], chain: { anchor: id(R.der), path: [], explicitDistrust: false } } }, "invalid-value", "$.certificates[1].chain.anchor"],
  ] as const)("#given %s #when decoding #then it is rejected", (_case, mutate, check, path) => {
    const document = wire()
    const replaced = mutate(document)
    expect(failure(replaced === null ? null : document)).toEqual({ kind: "helper-malformed-output", check, path })
  })

  test.each([
    ["non-canonical base64", (der: Uint8Array) => `${b64(der)}\n`],
    ["base64 with a stray character", (der: Uint8Array) => `${b64(der).slice(0, -4)}!!!!`],
    ["a truncated certificate", (der: Uint8Array) => b64(der.subarray(0, der.length - 1))],
    ["a certificate with a trailing byte", (der: Uint8Array) => b64(new Uint8Array([...der, 0]))],
    ["an empty value", () => ""],
    ["a non-SEQUENCE value", () => b64(new Uint8Array([0x04, 0x00]))],
  ])("#given %s #when decoding #then the DER is rejected", (_case, encode) => {
    const document = wire()
    document.certificates[0] = { ...document.certificates[0], der: encode(R.der) }
    expect(failure(document)).toEqual({ kind: "helper-malformed-output", check: "unparseable-certificate", path: "$.certificates[0].der" })
    const negative = wire()
    negative.disallowed = [{ der: encode(N.der), location: "LOCAL_MACHINE", physicalStore: ".Default" }]
    expect(failure(negative)).toEqual({ kind: "helper-malformed-output", check: "unparseable-certificate", path: "$.disallowed[0].der" })
  })

  test("#given output one byte over the bound #when decoding #then it is rejected before parsing", () => {
    const over = new Uint8Array(WINDOWS_TRUST_HELPER_MAX_OUTPUT_BYTES + 1).fill(0x20)
    expect(failure(over)).toEqual({ kind: "helper-malformed-output", check: "oversize", path: "$" })
    const at = new Uint8Array(WINDOWS_TRUST_HELPER_MAX_OUTPUT_BYTES).fill(0x20)
    expect(failure(at)).toEqual({ kind: "helper-malformed-output", check: "syntax", path: "$" })
  })

  test.each([
    ["invalid UTF-8", () => new Uint8Array([0x7b, 0xff, 0x7d]), "encoding"],
    ["truncated JSON", () => bytes(wire()).subarray(0, 40), "syntax"],
    ["empty output", () => new Uint8Array(), "syntax"],
  ] as const)("#given %s #when decoding #then it is malformed", (_case, output, check) => {
    expect(failure(output())).toEqual({ kind: "helper-malformed-output", check, path: "$" })
  })
})

describe("encodeBundledRootsForHelper", () => {
  test("#given Bun's bundled roots as DER #when encoding stdin #then it is their plain concatenation in order", () => {
    expect(encodeBundledRootsForHelper([R.der, Q.der])).toEqual(new Uint8Array([...R.der, ...Q.der]))
    expect(encodeBundledRootsForHelper([])).toEqual(new Uint8Array())
  })
})

describe("windowsTrustHelperEnvironment", () => {
  test("#given an arrival environment with trust-steering variables #when building the helper environment #then only SystemRoot survives", () => {
    expect(windowsTrustHelperEnvironment({
      SYSTEMROOT: "C:\\Windows",
      NODE_EXTRA_CA_CERTS: "C:\\extra.pem",
      node_use_system_ca: "1",
      SSL_CERT_FILE: "C:\\cert.pem",
      SSL_CERT_DIR: "C:\\certs",
      BUN_OPTIONS: "--use-system-ca",
      Path: "C:\\Windows\\system32",
      SENPI_ENGINE_TRUST: "{}",
    })).toEqual({ SystemRoot: "C:\\Windows" })
    expect(windowsTrustHelperEnvironment({ PATH: "/usr/bin" })).toEqual({})
  })
})
