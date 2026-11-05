import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { selectEngineTrust, type MacTrustSetting } from "../engine-trust-policy"
import {
  decodeMacTrustHelperOutput,
  MAC_TRUST_HELPER_EXIT,
  MAC_TRUST_HELPER_MAX_OUTPUT_BYTES,
  runMacTrustHelper,
  type MacTrustSource,
} from "../macos-trust-helper"
import { issueCertificates } from "./trust-certificate-fixtures"

const SSL = "1.2.840.113635.100.1.3"
const SERVER_AUTH = "1.3.6.1.5.5.7.3.1"
const CLIENT_AUTH = "1.3.6.1.5.5.7.3.2"
let base = ""
let certificates: ReadonlyMap<string, Buffer> = new Map()
const certificate = (name: string): Buffer => {
  const der = certificates.get(name)
  if (der === undefined) throw new Error(`Unknown fixture ${name}`)
  return der
}
const id = (name: string) => ({
  sha256: createHash("sha256").update(certificate(name)).digest("hex"),
  sha1: createHash("sha1").update(certificate(name)).digest("hex"),
})
const grant: MacTrustSetting = { policy: { oid: SSL, role: "server", nameConstrained: false }, application: false, policyString: null, keyUsage: null, allowedErrors: [], result: "TrustRoot" }
const sources = (): MacTrustSource[] => [
  { name: "trust-settings-user", outcome: "read", status: 0 },
  { name: "trust-settings-admin", outcome: "absent", status: -25263 },
  { name: "trust-settings-system", outcome: "read", status: 0 },
  { name: "keychain-search-list", outcome: "read", status: 0 },
]
// The helper's wire shape, built fresh per case so a test can mutate one field.
const document = (): Record<string, unknown> & { certificates: Record<string, unknown>[]; sources: Record<string, unknown>[] } => ({
  schema: 1,
  os: "macos",
  complete: true,
  sources: sources(),
  certificates: [
    { der: certificate("root").toString("base64"), source: "trust-settings", settings: { user: [structuredClone(grant)], admin: null, system: [] } },
    {
      der: certificate("intermediate").toString("base64"), source: "keychain", settings: { user: null, admin: null, system: null },
      chain: { anchor: id("root"), path: [id("intermediate"), id("root")], explicitDistrust: false },
    },
  ],
})
const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))
const decode = (value: unknown) => decodeMacTrustHelperOutput(encode(value))
const malformed = (value: unknown) => {
  const result = decode(value)
  if (result.kind !== "helper-malformed-output") throw new Error(`Expected malformed output, got ${result.kind}`)
  return { check: result.check, path: result.path }
}

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), "omo-macos-trust-helper-"))
  certificates = await issueCertificates(join(base, "certificates"), [
    { name: "root", subject: "/CN=Example Trust Test decoder root", days: 30, extensions: "basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign" },
    { name: "intermediate", subject: "/CN=Example Trust Test decoder intermediate", issuer: "root", days: 30, extensions: `basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,digitalSignature,keyCertSign,cRLSign\nextendedKeyUsage=serverAuth` },
    { name: "client", subject: "/CN=Example Trust Test decoder client", issuer: "root", days: 30, extensions: "basicConstraints=critical,CA:FALSE\nextendedKeyUsage=clientAuth" },
  ])
})
afterAll(async () => {
  if (base) await rm(base, { recursive: true, force: true })
})

describe("decodeMacTrustHelperOutput", () => {
  test("decodes helper output into exactly the policy facts, with DER kept by identity", () => {
    const result = decode(document())
    if (result.kind !== "decoded") throw new Error(`Expected decoded output, got ${JSON.stringify(result)}`)
    expect(result.document.facts).toEqual({
      os: "macos",
      complete: true,
      certificates: [
        { ...id("root"), selfSigned: true, ca: true, eku: { kind: "unrestricted" }, source: "trust-settings", settings: { user: [grant], admin: null, system: [] } },
        {
          ...id("intermediate"), selfSigned: false, ca: true, eku: { kind: "oids", oids: [SERVER_AUTH] }, source: "keychain", settings: { user: null, admin: null, system: null },
          chain: { anchor: id("root"), path: [id("intermediate"), id("root")], explicitDistrust: false },
        },
      ],
    })
    expect(result.document.sources).toEqual(sources())
    expect([...result.document.der.keys()].sort()).toEqual([id("root").sha256, id("intermediate").sha256].sort())
    expect(Buffer.from(result.document.der.get(id("intermediate").sha256) ?? []).equals(certificate("intermediate"))).toBe(true)
    expect(selectEngineTrust(result.document.facts)).toEqual({
      status: "selected", S: [id("root").sha256], I: [id("intermediate").sha256], D: { sha256: [], sha1: [] }, diagnostics: [],
    })
  })

  test("derives the CA flag, self-signed flag and EKU from the DER itself", () => {
    const value = document()
    value.certificates = [{ der: certificate("client").toString("base64"), source: "keychain", settings: { user: null, admin: null, system: null }, chain: { anchor: null, path: [], explicitDistrust: false } }]
    const result = decode(value)
    if (result.kind !== "decoded") throw new Error(`Expected decoded output, got ${JSON.stringify(result)}`)
    expect(result.document.facts.certificates).toEqual([
      { ...id("client"), selfSigned: false, ca: false, eku: { kind: "oids", oids: [CLIENT_AUTH] }, source: "keychain", settings: { user: null, admin: null, system: null }, chain: { anchor: null, path: [], explicitDistrust: false } },
    ])
  })

  test("an unreadable trust-settings domain makes the facts incomplete; the keychain list does not", () => {
    for (const name of ["trust-settings-user", "trust-settings-admin", "trust-settings-system"]) {
      for (const outcome of ["access-denied", "enumeration-failed"]) {
        const value = document()
        value.sources = sources().map((source) => (source.name === name ? { name, outcome, status: -25293 } : source))
        const result = decode(value)
        if (result.kind !== "decoded") throw new Error(`Expected decoded output for ${name} ${outcome}`)
        expect(result.document.facts.complete).toBe(false)
        expect(selectEngineTrust(result.document.facts)).toMatchObject({ status: "failed", S: [], I: [], diagnostics: ["negative-sources-incomplete"] })
      }
    }
    for (const outcome of ["absent", "access-denied", "enumeration-failed"]) {
      const value = document()
      value.sources = sources().map((source) => (source.name === "keychain-search-list" ? { ...source, outcome, status: -25308 } : source))
      const result = decode(value)
      if (result.kind !== "decoded") throw new Error(`Expected decoded output for keychain ${outcome}`)
      expect(result.document.facts.complete).toBe(true)
    }
    const result = decode({ ...document(), complete: false })
    if (result.kind !== "decoded") throw new Error("Expected decoded output")
    expect(result.document.facts.complete).toBe(false)
  })

  test("rejects an unknown field at every object level", () => {
    const cases: [string, (value: ReturnType<typeof document>) => void][] = [
      ["$.extra", (value) => { value.extra = 1 }],
      ["$.sources[0].extra", (value) => { Object.assign(value.sources[0] ?? {}, { extra: 1 }) }],
      ["$.certificates[0].extra", (value) => { Object.assign(value.certificates[0] ?? {}, { extra: 1 }) }],
      ["$.certificates[0].settings.extra", (value) => { Object.assign((value.certificates[0] as { settings: object }).settings, { extra: null }) }],
      ["$.certificates[0].settings.user[0].extra", (value) => { Object.assign((value.certificates[0] as { settings: { user: object[] } }).settings.user[0] ?? {}, { extra: null }) }],
      ["$.certificates[0].settings.user[0].policy.extra", (value) => { Object.assign((value.certificates[0] as { settings: { user: { policy: object }[] } }).settings.user[0]?.policy ?? {}, { extra: null }) }],
      ["$.certificates[1].chain.extra", (value) => { Object.assign((value.certificates[1] as { chain: object }).chain, { extra: null }) }],
      ["$.certificates[1].chain.path[0].extra", (value) => { Object.assign((value.certificates[1] as { chain: { path: object[] } }).chain.path[0] ?? {}, { extra: null }) }],
    ]
    for (const [path, mutate] of cases) {
      const value = document()
      mutate(value)
      expect(malformed(value)).toEqual({ check: "unknown-field", path })
    }
  })

  test("rejects a missing field", () => {
    const value = document()
    delete (value.certificates[0] as { settings: Record<string, unknown> }).settings.admin
    expect(malformed(value)).toEqual({ check: "missing-field", path: "$.certificates[0].settings.admin" })
    const noComplete: Record<string, unknown> = document()
    delete noComplete.complete
    expect(malformed(noComplete)).toEqual({ check: "missing-field", path: "$.complete" })
  })

  test("rejects a wrong type", () => {
    const setting = (patch: Record<string, unknown>) => {
      const value = document()
      Object.assign((value.certificates[0] as { settings: { user: object[] } }).settings.user[0] ?? {}, patch)
      return value
    }
    const cases: [unknown, string][] = [
      [[], "$"],
      [{ ...document(), schema: "1" }, "$.schema"],
      [{ ...document(), complete: "true" }, "$.complete"],
      [{ ...document(), sources: {} }, "$.sources"],
      [{ ...document(), sources: sources().map((source, index) => (index === 0 ? { ...source, status: 1.5 } : source)) }, "$.sources[0].status"],
      [{ ...document(), certificates: [{ ...document().certificates[0], der: 5 }] }, "$.certificates[0].der"],
      [{ ...document(), certificates: [{ ...document().certificates[0], settings: { user: {}, admin: null, system: null } }] }, "$.certificates[0].settings.user"],
      [setting({ application: 1 }), "$.certificates[0].settings.user[0].application"],
      [setting({ policyString: 7 }), "$.certificates[0].settings.user[0].policyString"],
      [setting({ keyUsage: "1" }), "$.certificates[0].settings.user[0].keyUsage"],
      [setting({ allowedErrors: ["x"] }), "$.certificates[0].settings.user[0].allowedErrors[0]"],
      [setting({ result: 1 }), "$.certificates[0].settings.user[0].result"],
      [setting({ policy: { oid: SSL, role: "server", nameConstrained: null } }), "$.certificates[0].settings.user[0].policy.nameConstrained"],
      [{ ...document(), certificates: [document().certificates[0], { ...document().certificates[1], chain: { anchor: null, path: {}, explicitDistrust: false } }] }, "$.certificates[1].chain.path"],
      [{ ...document(), certificates: [document().certificates[0], { ...document().certificates[1], chain: { anchor: null, path: [], explicitDistrust: 0 } }] }, "$.certificates[1].chain.explicitDistrust"],
    ]
    for (const [value, path] of cases) expect(malformed(value)).toEqual({ check: "wrong-type", path })
  })

  test("rejects values outside the helper contract", () => {
    const setting = (patch: Record<string, unknown>) => {
      const value = document()
      Object.assign((value.certificates[0] as { settings: { user: object[] } }).settings.user[0] ?? {}, patch)
      return value
    }
    const certificateAt = (index: number, patch: Record<string, unknown>) => {
      const value = document()
      Object.assign(value.certificates[index] ?? {}, patch)
      return value
    }
    const badId = { sha256: id("root").sha256.toUpperCase(), sha1: id("root").sha1 }
    const cases: [unknown, string][] = [
      [{ ...document(), schema: 2 }, "$.schema"],
      [{ ...document(), os: "windows" }, "$.os"],
      [{ ...document(), sources: sources().slice(1) }, "$.sources"],
      [{ ...document(), sources: [...sources().slice(0, 3), sources()[0]] }, "$.sources[3].name"],
      [{ ...document(), sources: sources().map((source, index) => (index === 0 ? { ...source, name: "keychain-login" } : source)) }, "$.sources[0].name"],
      [{ ...document(), sources: sources().map((source, index) => (index === 0 ? { ...source, outcome: "partial" } : source)) }, "$.sources[0].outcome"],
      [{ ...document(), sources: sources().map((source, index) => (index === 0 ? { ...source, status: 2 ** 31 } : source)) }, "$.sources[0].status"],
      [certificateAt(0, { source: "openssl-default-file" }), "$.certificates[0].source"],
      [certificateAt(0, { der: "" }), "$.certificates[0].der"],
      [certificateAt(0, { der: `${certificate("root").toString("base64")}\n` }), "$.certificates[0].der"],
      [certificateAt(0, { der: certificate("root").toString("base64url") + "-_" }), "$.certificates[0].der"],
      [certificateAt(0, { settings: { user: null, admin: null, system: null } }), "$.certificates[0].settings"],
      [certificateAt(0, { chain: { anchor: null, path: [], explicitDistrust: false } }), "$.certificates[0].chain"],
      [certificateAt(1, { settings: { user: [], admin: null, system: null } }), "$.certificates[1].settings"],
      [(() => { const value = document(); delete (value.certificates[1] as { chain?: unknown }).chain; return value })(), "$.certificates[1].chain"],
      [certificateAt(1, { chain: { anchor: badId, path: [], explicitDistrust: false } }), "$.certificates[1].chain.anchor.sha256"],
      [certificateAt(1, { chain: { anchor: null, path: [{ sha256: id("root").sha256, sha1: "00" }], explicitDistrust: false } }), "$.certificates[1].chain.path[0].sha1"],
      // A chain must describe its own certificate: the policy applies the EKU rule only to path members.
      [certificateAt(1, { chain: { anchor: null, path: [id("root")], explicitDistrust: false } }), "$.certificates[1].chain.path[0]"],
      [certificateAt(1, { chain: { anchor: id("root"), path: [id("intermediate")], explicitDistrust: false } }), "$.certificates[1].chain.anchor"],
      [certificateAt(1, { chain: { anchor: id("root"), path: [], explicitDistrust: false } }), "$.certificates[1].chain.anchor"],
      [setting({ result: "Allow" }), "$.certificates[0].settings.user[0].result"],
      [setting({ policy: { oid: SSL, role: "admin", nameConstrained: false } }), "$.certificates[0].settings.user[0].policy.role"],
      [setting({ policy: { oid: "not-an-oid", role: null, nameConstrained: false } }), "$.certificates[0].settings.user[0].policy.oid"],
      // The role exists for the SSL OID only; an unreadable policy (oid null) is always role unknown (design 4.4 item 2).
      [setting({ policy: { oid: SSL, role: null, nameConstrained: false } }), "$.certificates[0].settings.user[0].policy.role"],
      [setting({ policy: { oid: "1.2.840.113635.100.1.9", role: "server", nameConstrained: false } }), "$.certificates[0].settings.user[0].policy.role"],
      [setting({ policy: { oid: null, role: "server", nameConstrained: false } }), "$.certificates[0].settings.user[0].policy.role"],
      [setting({ keyUsage: 2 ** 32 }), "$.certificates[0].settings.user[0].keyUsage"],
    ]
    for (const [value, path] of cases) expect(malformed(value)).toEqual({ check: "invalid-value", path })
  })

  test("accepts an unanchored chain that is empty or starts at its own certificate", () => {
    for (const path of [[], [id("intermediate")]]) {
      const value = document()
      Object.assign(value.certificates[1] ?? {}, { chain: { anchor: null, path, explicitDistrust: false } })
      expect(decode(value).kind).toBe("decoded")
    }
  })

  test("accepts every documented policy projection", () => {
    for (const policy of [
      null,
      { oid: SSL, role: "server", nameConstrained: true },
      { oid: SSL, role: "client", nameConstrained: false },
      { oid: SSL, role: "unknown", nameConstrained: false },
      { oid: null, role: "unknown", nameConstrained: false },
      { oid: "1.2.840.113635.100.1.9", role: null, nameConstrained: false },
    ]) {
      const value = document()
      Object.assign((value.certificates[0] as { settings: { user: object[] } }).settings.user[0] ?? {}, { policy })
      expect(decode(value).kind).toBe("decoded")
    }
  })

  test("rejects a duplicate certificate and a certificate Bun cannot parse exactly", () => {
    const duplicate = document()
    duplicate.certificates.push({ ...duplicate.certificates[1] })
    expect(malformed(duplicate)).toEqual({ check: "duplicate-certificate", path: "$.certificates[2].der" })
    for (const der of [Buffer.from([0x30, 0x00]), Buffer.concat([certificate("root"), Buffer.from([0x00])])]) {
      const value = document()
      Object.assign(value.certificates[0] ?? {}, { der: der.toString("base64") })
      expect(malformed(value)).toEqual({ check: "unparseable-certificate", path: "$.certificates[0].der" })
    }
  })

  test("bounds the output before parsing it", () => {
    const valid = encode(document())
    const padded = new Uint8Array(MAC_TRUST_HELPER_MAX_OUTPUT_BYTES).fill(0x20)
    padded.set(valid)
    expect(decodeMacTrustHelperOutput(padded).kind).toBe("decoded")
    const oversize = new Uint8Array(MAC_TRUST_HELPER_MAX_OUTPUT_BYTES + 1).fill(0x20)
    oversize.set(valid)
    expect(decodeMacTrustHelperOutput(oversize)).toEqual({ kind: "helper-malformed-output", check: "oversize", path: "$" })
  })

  test("rejects bytes that are not one UTF-8 JSON document", () => {
    expect(decodeMacTrustHelperOutput(new Uint8Array([0x7b, 0xff, 0x7d]))).toEqual({ kind: "helper-malformed-output", check: "encoding", path: "$" })
    expect(decodeMacTrustHelperOutput(new Uint8Array())).toEqual({ kind: "helper-malformed-output", check: "syntax", path: "$" })
    expect(decodeMacTrustHelperOutput(new TextEncoder().encode(`${JSON.stringify(document())}{}`))).toEqual({ kind: "helper-malformed-output", check: "syntax", path: "$" })
  })
})

// The stand-ins are POSIX executables; the helper itself only ships for macOS.
describe.skipIf(process.platform === "win32")("runMacTrustHelper", () => {
  const standIn = async (name: string, script: string): Promise<string> => {
    const path = join(base, name)
    await writeFile(path, `#!/bin/sh\n${script}\n`)
    await chmod(path, 0o755)
    return path
  }

  test("passes only HOME from the engine environment", async () => {
    const environment = { HOME: "/home/omo-test", SSL_CERT_FILE: "/tmp/r.pem", SSL_CERT_DIR: "/tmp/r", NODE_EXTRA_CA_CERTS: "/tmp/x.pem", NODE_USE_SYSTEM_CA: "1", BUN_OPTIONS: "--use-system-ca", PATH: "/usr/bin:/bin" }
    const run = await runMacTrustHelper("/usr/bin/env", { deadlineMs: 10_000, environment })
    if (run.kind !== "output") throw new Error(`Expected output, got ${JSON.stringify(run)}`)
    expect(new TextDecoder().decode(run.bytes).trim().split("\n")).toEqual(["HOME=/home/omo-test"])
    const bare = await runMacTrustHelper("/usr/bin/env", { deadlineMs: 10_000, environment: { PATH: "/usr/bin:/bin" } })
    expect(bare).toEqual({ kind: "output", bytes: new Uint8Array() })
  })

  test("runs the helper as the leader of its own process group", async () => {
    const path = await standIn("group.sh", "exec ps -o pid=,pgid= -p $$")
    const run = await runMacTrustHelper(path, { deadlineMs: 10_000, environment: {} })
    if (run.kind !== "output") throw new Error(`Expected output, got ${JSON.stringify(run)}`)
    const [pid, pgid] = new TextDecoder().decode(run.bytes).trim().split(/\s+/)
    expect(pid).toBeDefined()
    expect(pgid).toBe(pid)
  })

  test("reports a missing helper", async () => {
    expect(await runMacTrustHelper(join(base, "absent-helper"), { deadlineMs: 10_000, environment: {} })).toEqual({ kind: "helper-missing" })
  })

  test("kills the helper at the owner's deadline", async () => {
    const path = await standIn("hang.sh", "exec sleep 600")
    expect(await runMacTrustHelper(path, { deadlineMs: 100, environment: {} })).toEqual({ kind: "helper-timeout", by: "owner" })
  })

  test("maps the helper's own watchdog and output-cap exits", async () => {
    const watchdog = await standIn("watchdog.sh", `exit ${MAC_TRUST_HELPER_EXIT.watchdog}`)
    expect(await runMacTrustHelper(watchdog, { deadlineMs: 10_000, environment: {} })).toEqual({ kind: "helper-timeout", by: "watchdog" })
    const cap = await standIn("cap.sh", `exit ${MAC_TRUST_HELPER_EXIT.outputCap}`)
    expect(await runMacTrustHelper(cap, { deadlineMs: 10_000, environment: {} })).toEqual({ kind: "helper-malformed-output", check: "oversize", path: "$" })
  })

  test("stops reading and kills the helper once stdout passes the cap", async () => {
    const path = await standIn("flood.sh", `head -c ${MAC_TRUST_HELPER_MAX_OUTPUT_BYTES + 1} /dev/zero\nexec sleep 600`)
    expect(await runMacTrustHelper(path, { deadlineMs: 10_000, environment: {} })).toEqual({ kind: "helper-malformed-output", check: "oversize", path: "$" })
  })

  test("reports a crash or another failing exit", async () => {
    const signal = await standIn("segv.sh", "kill -SEGV $$")
    expect(await runMacTrustHelper(signal, { deadlineMs: 10_000, environment: {} })).toEqual({ kind: "helper-crash", exitCode: null, signal: "SIGSEGV" })
    const failing = await standIn("fail.sh", "exit 3")
    expect(await runMacTrustHelper(failing, { deadlineMs: 10_000, environment: {} })).toEqual({ kind: "helper-crash", exitCode: 3, signal: null })
  })
})
