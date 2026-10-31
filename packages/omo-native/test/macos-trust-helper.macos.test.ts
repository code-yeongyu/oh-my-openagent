import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { selectEngineTrust } from "../engine-trust-policy"
import { decodeMacTrustHelperOutput, runMacTrustHelper, type MacTrustHelperDocument } from "../macos-trust-helper"
import { issueCertificates } from "./trust-certificate-fixtures"

// Design 9.3, on the macOS CI job: real Security.framework objects through the helper's production
// projection and evaluation, then the production decoder and selectEngineTrust. The desktop-engine
// workflow builds the crate and names its target directory here; without it there is no helper to run.
const targetDirectory = process.env.OMO_ENGINE_TRUST_HELPER_TARGET_DIR
const SSL = "1.2.840.113635.100.1.3"

describe.skipIf(process.platform !== "darwin" || targetDirectory === undefined)("macOS engine trust helper", () => {
  const directory = targetDirectory ?? ""
  let base = ""
  let certificates: ReadonlyMap<string, Buffer> = new Map()
  const path = (name: string) => join(base, "certificates", `${name}.der`)
  const sha256 = (name: string) => createHash("sha256").update(certificates.get(name) ?? Buffer.alloc(0)).digest("hex")
  const sha1 = (name: string) => createHash("sha1").update(certificates.get(name) ?? Buffer.alloc(0)).digest("hex")

  async function fixture(...args: string[]): Promise<MacTrustHelperDocument> {
    const child = Bun.spawn([join(directory, "examples", "trust_facts_fixture"), ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 60_000 })
    const [bytes, stderr, code] = await Promise.all([new Response(child.stdout).bytes(), new Response(child.stderr).text(), child.exited])
    if (code !== 0) throw new Error(`trust_facts_fixture ${args.join(" ")} exited ${code}: ${stderr}`)
    const decoded = decodeMacTrustHelperOutput(bytes)
    if (decoded.kind !== "decoded") throw new Error(`fixture output did not decode: ${JSON.stringify(decoded)}`)
    return decoded.document
  }

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), "omo-macos-trust-helper-"))
    certificates = await issueCertificates(join(base, "certificates"), [
      { name: "root", subject: "/CN=Example Trust Test helper root", days: 3650, extensions: "basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign" },
      // Ten years, no EKU, no SCTs: the strict SSL policy rejects it (-67901), the BasicX509 chain step does not.
      { name: "long-no-eku", subject: "/CN=Example Trust Test helper long no-EKU intermediate", issuer: "root", days: 3650, extensions: "basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign" },
      { name: "client-only", subject: "/CN=Example Trust Test helper client-auth intermediate", issuer: "root", days: 365, extensions: "basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\nextendedKeyUsage=clientAuth" },
    ])
  })
  afterAll(async () => {
    if (base) await rm(base, { recursive: true, force: true })
  })

  test("macos-ssl-role-from-policy-properties", async () => {
    const root = sha256("root")
    const select = async (kind: string) => {
      const document = await fixture("role", kind, path("root"))
      return { setting: document.facts.certificates[0]?.settings.user?.[0], selection: selectEngineTrust(document.facts) }
    }
    const server = await select("server-grant")
    const client = await select("client-grant")
    const unknown = await select("non-policy-grant")
    const deny = await select("client-deny")
    expect(server.setting?.policy).toEqual({ oid: SSL, role: "server", nameConstrained: false })
    expect(client.setting?.policy).toEqual({ oid: SSL, role: "client", nameConstrained: false })
    expect(server.selection).toEqual({ status: "selected", S: [root], I: [], D: { sha256: [], sha1: [] }, diagnostics: [] })
    // The client grant excludes the root with no other difference.
    expect(client.selection).toEqual({ ...server.selection, S: [] })
    expect(unknown.setting?.policy).toEqual({ oid: null, role: "unknown", nameConstrained: false })
    expect(unknown.selection).toEqual({ ...server.selection, S: [], diagnostics: ["macos-policy-unreadable"] })
    expect(deny.setting).toMatchObject({ policy: { oid: SSL, role: "client" }, result: "Deny" })
    expect(deny.selection).toEqual({ status: "selected", S: [], I: [], D: { sha256: [root], sha1: [] }, diagnostics: ["scoped-deny-applied-globally"] })
  })

  const id = (name: string) => ({ sha256: sha256(name), sha1: sha1(name) })
  const none = { sha256: [], sha1: [] }

  // Design revision 12 (option C), 9.3: BasicX509 chain step in the helper, EKU rule and Deny-on-path in the policy.
  test("macos-intermediate-long-validity-no-eku-included", async () => {
    const document = await fixture("intermediate", path("root"), path("long-no-eku"))
    expect(document.facts.certificates[1]).toMatchObject({ ...id("long-no-eku"), selfSigned: false, ca: true, eku: { kind: "unrestricted" }, chain: { anchor: id("root"), path: [id("long-no-eku"), id("root")], explicitDistrust: false } })
    expect(selectEngineTrust(document.facts)).toEqual({ status: "selected", S: [sha256("root")], I: [sha256("long-no-eku")], D: none, diagnostics: [] })
  })

  test("macos-intermediate-client-auth-only-excluded", async () => {
    const document = await fixture("intermediate", path("root"), path("client-only"))
    // The chain is anchored; only the EKU rule keeps it out of I.
    expect(document.facts.certificates[1]).toMatchObject({ eku: { kind: "oids", oids: ["1.3.6.1.5.5.7.3.2"] }, chain: { anchor: id("root"), path: [id("client-only"), id("root")] } })
    expect(selectEngineTrust(document.facts)).toEqual({ status: "selected", S: [sha256("root")], I: [], D: none, diagnostics: [] })
  })

  // Without a keychain the OS reports only [intermediate, anchor], so on real objects the Deny sits on the
  // anchor. A Deny on a non-anchor path member is owned by the policy table case "macOS denied path".
  test("macos-intermediate-anchor-deny-excluded", async () => {
    const document = await fixture("intermediate", path("root"), path("long-no-eku"), "root-deny")
    expect(document.facts.certificates[0]?.settings.user).toMatchObject([{ policy: null, result: "Deny" }])
    expect(document.facts.certificates[1]).toMatchObject({ chain: { anchor: id("root"), path: [id("long-no-eku"), id("root")] } })
    expect(selectEngineTrust(document.facts)).toEqual({ status: "selected", S: [], I: [], D: { sha256: [sha256("root")], sha1: [] }, diagnostics: [] })
  })

  // Reads the runner's real stores; asserts the contract only, never which certificates they hold.
  test("real helper output decodes and selects", async () => {
    const run = await runMacTrustHelper(join(directory, "omo-engine-trust-helper"), { deadlineMs: 20_000, environment: process.env })
    if (run.kind !== "output") throw new Error(`helper did not produce output: ${JSON.stringify(run)}`)
    const decoded = decodeMacTrustHelperOutput(run.bytes)
    if (decoded.kind !== "decoded") throw new Error(`helper output did not decode: ${JSON.stringify(decoded)}`)
    const { facts, der, sources } = decoded.document
    console.log(JSON.stringify({ complete: facts.complete, sources, certificates: facts.certificates.length }))
    const selection = selectEngineTrust(facts)
    expect(selection.status).toBe(facts.complete ? "selected" : "failed")
    for (const identity of [...selection.S, ...selection.I]) expect(der.has(identity)).toBe(true)
  })
})
