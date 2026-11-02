import { afterAll, describe, expect, test } from "bun:test"
import { generateKeyPairSync, sign, X509Certificate } from "node:crypto"
import { once } from "node:events"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:https"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { readDefaultFileCandidates } from "../openssl-default-file"

// A private PKI per run, independent of all machine trust stores and fixed fixtures.
const dir = mkdtempSync(join(tmpdir(), "omo-default-file-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const rootKey = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
const leafKey = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
function der(tag: number, ...parts: readonly Uint8Array[]): Buffer {
  const body = Buffer.concat(parts)
  const size: number[] = []
  for (let n = body.length; n > 0; n = Math.floor(n / 256)) size.unshift(n % 256)
  const length = body.length < 128 ? [body.length] : [0x80 + size.length, ...size]
  return Buffer.concat([Buffer.from([tag, ...length]), body])
}
const hex = (value: string) => Buffer.from(value, "hex")
const seq = (...parts: readonly Uint8Array[]) => der(0x30, ...parts)
const oid = (value: string) => der(6, hex(value))
const name = (value: Uint8Array) => seq(der(0x31, seq(oid("550403"), value)))
const rootName = name(der(12, Buffer.from("omo synthetic default-file R")))
const signature = seq(oid("2a8648ce3d040302"))
const validity = seq(der(23, Buffer.from("250101000000Z")), der(23, Buffer.from("490101000000Z")))
const prefix = [der(0xa0, der(2, hex("02"))), der(2, hex("01")), signature, rootName, validity] as const
const rootPrefix = [...prefix, rootName] as const
const extensions = (items: readonly Buffer[]) => der(0xa3, seq(...items))
const caExtension = seq(oid("551d13"), der(1, hex("ff")), der(4, seq(der(1, hex("ff")))))
const rootTbs = seq(...rootPrefix, rootKey.publicKey.export({ type: "spki", format: "der" }), extensions([caExtension]))
const signed = (tbs: Buffer) => seq(tbs, signature, der(3, hex("00"), sign("sha256", tbs, rootKey.privateKey)))
const rootDer = signed(rootTbs)
const leafTbs = seq(...prefix, name(der(12, Buffer.from("localhost"))),
  leafKey.publicKey.export({ type: "spki", format: "der" }), extensions([
    seq(oid("551d13"), der(1, hex("ff")), der(4, seq())),
    seq(oid("551d11"), der(4, seq(der(0x82, Buffer.from("localhost")), der(0x87, hex("7f000001"))))),
    seq(oid("551d25"), der(4, seq(oid("2b06010505070301")))),
  ]))
function pem(bytes: Uint8Array, type = "CERTIFICATE"): string {
  return `-----BEGIN ${type}-----\n${Buffer.from(bytes).toString("base64").match(/.{1,64}/g)?.join("\n") ?? ""}\n-----END ${type}-----\n`
}
const rootPem = pem(rootDer)
const c4 = hex("30123010a0030201020201013000300030003000")
const x = seq(seq(...rootPrefix))
const short = pem(hex("3000"))
// The importer takes raw file bytes; fixtures are written to disk with the same UTF-8 encoding.
const read = (text: string, isBundledRoot: (der: Buffer) => boolean) => readDefaultFileCandidates(Buffer.from(text, "utf8"), isBundledRoot)
const kept = { kind: "kept", certificates: [{ der: rootDer, index: 0 }] } as const
type Dropped = Extract<ReturnType<typeof readDefaultFileCandidates>, { readonly kind: "dropped" }>
const dropped = (cause: Dropped["cause"], blockIndex = 1, narrowing = false): Dropped => ({
  kind: "dropped", cause, blockIndex, narrowing,
})
const fixtures = [
  { id: "c0", text: rootPem, expected: kept },
  { id: "c1", text: rootPem + short, expected: dropped("ordinary-block-not-indexable") },
  { id: "c1b", text: short + rootPem, expected: dropped("ordinary-block-not-indexable", 0) },
  { id: "c2", text: rootPem + pem(Buffer.concat([rootDer, hex("00")])), expected: dropped("ordinary-block-not-indexable") },
  { id: "c3", text: rootPem + pem(hex("30143012a00302010202010130003000300030023100")), expected: dropped("ordinary-block-not-indexable") },
  { id: "c4", text: rootPem + pem(c4), expected: dropped("ordinary-block-unparseable", 1, true) },
  { id: "c4s", text: pem(x) + rootPem, expected: dropped("ordinary-block-unparseable", 0, true) },
  { id: "c4t", text: rootPem + pem(x), expected: dropped("ordinary-block-unparseable", 1, true) },
  { id: "c5", text: rootPem + "plain trailing text\n", expected: kept },
  { id: "c6", text: rootPem + "-----BEGIN CERTIFICATE-----\n!!!!\n-----END CERTIFICATE-----\n", expected: dropped("pem-noncanonical", 1, true) },
  { id: "c7", text: rootPem + pem(hex("3000"), "TRUSTED CERTIFICATE"), expected: dropped("aux-block-unverified", 1, true) },
  { id: "c8", text: rootPem + pem(hex("3000"), "SOMETHING ELSE"), expected: kept },
  { id: "c9", text: rootPem + "-----BEGIN CERTIFICATE-----\nMAA=\n", expected: dropped("pem-noncanonical", 1, true) },
  { id: "body253", text: `-----BEGIN CERTIFICATE-----\n${rootDer.toString("base64").match(/.{1,253}/g)?.join("\n")}\n-----END CERTIFICATE-----\n`, expected: dropped("pem-noncanonical", 0, true) },
  { id: "spaces253", text: rootPem.replace(/(\n[A-Za-z0-9+/=]+\n)/, `$1${" ".repeat(253)}`), expected: dropped("pem-noncanonical", 0, true) },
  { id: "hidden-begin", text: rootPem + `${"a".repeat(253)}-----BEGIN OTHER-----\n!!!!\n-----END OTHER-----\n`, expected: dropped("pem-noncanonical", 1, true) },
  { id: "empty-label", text: rootPem + "-----BEGIN -----\n!!!!\n-----END -----\n", expected: dropped("pem-noncanonical", 1, true) },
  { id: "long-label", text: rootPem + pem(hex("3000"), "A".repeat(201)), expected: dropped("pem-noncanonical", 1, true) },
  { id: "mid-cr", text: rootPem + "plain\rtext\n", expected: dropped("pem-noncanonical", 1, true) },
  { id: "form-feed", text: rootPem + "plain\ftext\n", expected: dropped("pem-noncanonical", 1, true) },
  { id: "high-byte", text: rootPem + "plain\u00fftext\n", expected: dropped("pem-noncanonical", 1, true) },
  { id: "lowercase-label", text: rootPem + pem(hex("3000"), "other"), expected: dropped("pem-noncanonical", 1, true) },
  { id: "crlf", text: rootPem.replaceAll("\n", "\r\n"), expected: kept },
  { id: "bad-padding", text: rootPem + pem(hex("3000"), "OTHER").replace("MAA=", "MAA"), expected: dropped("pem-read-error") },
  { id: "blank-body", text: rootPem.replace("\n", "\n\n"), expected: dropped("pem-noncanonical", 0, true) },
  { id: "bom", text: `\uFEFF${rootPem}`, expected: dropped("pem-noncanonical", 0, true) },
  { id: "space-only-header-line", text: rootPem.replace(/^(-----BEGIN CERTIFICATE-----\n)([A-Za-z0-9+/=]+\n)/, "$1   \n$2\n"), expected: dropped("pem-noncanonical", 0, true) },
  { id: "mismatched-end", text: rootPem + "-----BEGIN OTHER-----\nMAA=\n-----END WRONG-----\n", expected: dropped("pem-noncanonical", 1, true) },
]

describe("OpenSSL default-file whole-file transaction", () => {
  test.each(fixtures)("returns the exact candidate transaction when given $id", ({ text, expected }) => {
    // Given: a design fixture with no bundled copy of R.
    // When: the complete file is selected.
    const result = read(text, () => false)
    // Then: no valid prefix or sibling survives a whole-file failure.
    expect(result).toEqual(expected)
  })
  test.each(["", "only text\n"])("keeps an empty set when given no blocks: %s", (text) => {
    // Given / When: an input containing no PEM blocks.
    const result = read(text, () => false)
    // Then: absence is not malformed.
    expect(result).toEqual({ kind: "kept", certificates: [] })
  })
  test("excludes bundled bytes before indexing when the callback identifies them", () => {
    // Given: the only ordinary block is identified as bundled.
    // When: even non-indexable bytes match the caller's bundled identity.
    const result = read(short, (bytes) => bytes.equals(hex("3000")))
    // Then: the block never enters the lazy-set mirror.
    expect(result).toEqual({ kind: "kept", certificates: [] })
  })
  test("preserves block indices when unknown decoded blocks precede a root", () => {
    // Given / When: a skipped block precedes an ordinary legacy-label certificate.
    const result = read(pem(hex("3000"), "OTHER") + pem(rootDer, "X509 CERTIFICATE"), () => false)
    // Then: index is the file block index, not candidate position.
    expect(result).toEqual({ ...kept, certificates: [{ der: rootDer, index: 1 }] })
  })
})

const indexedSubject = (subject: Buffer) => seq(seq(...prefix, subject))
const subjectCases = [
  ["invalid UTF8String", indexedSubject(name(der(12, hex("c080"))))],
  ["invalid BMPString", indexedSubject(name(der(30, hex("d800"))))],
  ["invalid UniversalString", indexedSubject(name(der(28, hex("00110000"))))],
  ["UTF8String U+FFFF", indexedSubject(name(der(12, hex("efbfbf"))))],
  ["BMPString U+FFFE", indexedSubject(name(der(30, hex("fffe"))))],
  ["UniversalString U+FDD0", indexedSubject(name(der(28, hex("0000fdd0"))))],
  ["UTF8String plane-one noncharacter", indexedSubject(name(der(12, hex("f09fbfbe"))))],
  ["UniversalString plane-sixteen noncharacter", indexedSubject(name(der(28, hex("0010ffff"))))],
  ["empty RDN", indexedSubject(seq(der(0x31)))],
  ["two attribute values", indexedSubject(seq(der(0x31, seq(oid("550403"), der(12, hex("61")), der(12, hex("62"))))))],
  ["universal tag zero", indexedSubject(name(hex("0000")))],
  ["invalid high tag", indexedSubject(name(hex("1f1e00")))],
  ["non-minimal length", hex("3081123010a0030201020201013000300030003000")],
  ["indefinite length", hex("30803010a00302010202010130003000300030000000")],
  ["trailing byte", Buffer.concat([rootDer, hex("00")])],
] as const
test.each(subjectCases)("rejects the file as not indexable when given %s", (_name, bytes) => {
  // Given: a structurally invalid ordinary block after a good root.
  // When: the subject mirror reads the file.
  const result = read(rootPem + pem(bytes), () => false)
  // Then: even full-parse failures must first be classified by indexability.
  expect(result).toEqual(dropped("ordinary-block-not-indexable"))
})

const headerLabels = ["CERTIFICATE", "X509 CERTIFICATE", "TRUSTED CERTIFICATE", "X509 CRL"] as const
test.each(headerLabels)(
  "rejects recognized headers when the block is %s", (type) => {
    // Given / When: PEM decoding succeeds but a recognized block has headers.
    const text = pem(rootDer, type).replace("-----\n", "-----\nComment: synthetic\n\n")
    const result = read(text, () => false)
    // Then: headers invalidate the file independently of DER.
    expect(result).toEqual(dropped("recognized-block-has-headers", 0))
  },
)
const malformedCases = [
  ["unknown bad base64", "-----BEGIN OTHER-----\n!!!!\n-----END OTHER-----\n", "pem-noncanonical", true],
  ["malformed headers", "-----BEGIN OTHER-----\nComment: synthetic\nMAA=\n-----END OTHER-----\n", "pem-noncanonical", true],
  ["invalid CRL", pem(hex("3000"), "X509 CRL"), "aux-block-unverified", true],
] as const
test.each(malformedCases)("drops the whole file when given %s", (_name, text, cause, narrowing) => {
  // Given / When: an error after a valid root, including in an otherwise skipped type.
  const result = read(rootPem + text, () => false)
  // Then: decoded unknown blocks alone may be skipped.
  expect(result).toEqual(dropped(cause, 1, narrowing))
})
const whitespaceCases = [
  ["blank-separated base64 header", "-----BEGIN CERTIFICATE-----\nMAA=\n\nMAA=\n-----END CERTIFICATE-----\n", "recognized-block-has-headers"],
  ["non-ASCII trailing whitespace", "-----BEGIN CERTIFICATE-----\nMAA=\u00a0\n-----END CERTIFICATE-----\n", "pem-noncanonical"],
] as const
test.each(whitespaceCases)("does not broaden PEM decoding when given %s", (_name, text, cause) => {
  // Given / When: framing that a whitespace-normalizing PEM regex would silently salvage.
  const result = read(rootPem + text, () => false)
  // Then: preserve PEM_read_bio's ASCII and header boundaries.
  expect(result).toEqual(dropped(cause, 1, cause === "pem-noncanonical"))
})
test("finishes PEM reading before indexing when a bad DER block precedes bad PEM", () => {
  // Given / When: the loader cannot finish its PEM transaction.
  const result = read(short + "-----BEGIN OTHER-----\n!!!!\n-----END OTHER-----\n", () => false)
  // Then: report the PEM failure, not a lazy-set check that Bun never reaches.
  expect(result).toEqual(dropped("pem-noncanonical", 1, true))
})
test.each([["R", rootDer, true], ["c4", c4, false], ["X", x, false]] as const)(
  "agrees with the lazy-parser fixture when crypto parses %s", (_name, bytes, parses) => {
    // Given: a full certificate or a subject-indexable truncation.
    // When / Then: the runtime parser accepts only the full certificate.
    const parse = () => new X509Certificate(bytes)
    if (parses) expect(parse).not.toThrow()
    else expect(parse).toThrow()
  },
)

test.skipIf(process.platform === "win32")("never imports R beyond real Bun's accepted set", async () => {
  // Given: a leaf signed by R, a fresh empty directory, and sanitized child environments.
  const emptyDir = join(dir, "empty-dir")
  mkdirSync(emptyDir)
  const server = createServer({
    key: leafKey.privateKey.export({ type: "pkcs8", format: "pem" }), cert: pem(signed(leafTbs)),
  }, (_request, response) => response.end("ok"))
  const listening = once(server, "listening", { signal: AbortSignal.timeout(10_000) })
  server.listen(0, "127.0.0.1")
  await listening
  const address = server.address()
  if (address === null || typeof address === "string") throw new TypeError("Expected TCP listener")
  const url = `https://localhost:${address.port}/`
  const client = `
    import { get } from "node:https";
    const url = process.argv[1];
    for (let i = 0; i < 3; i++) {
      try { const r = await fetch(url, { signal: AbortSignal.timeout(5000) }); await r.text(); console.log(r.status === 200 ? "1" : "0"); }
      catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "UNABLE_TO_VERIFY_LEAF_SIGNATURE") throw error;
        console.log("0");
      }
    }
    for (let i = 0; i < 2; i++) await new Promise((resolve, reject) => {
      get(url, { agent: false, signal: AbortSignal.timeout(5000) }, r => {
        r.resume(); r.on("end", () => { console.log(r.statusCode === 200 ? "1" : "0"); resolve(); });
      }).on("error", error => {
        if ("code" in error && error.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") { console.log("0"); resolve(); }
        else reject(error);
      });
    });
  `
  const outcomes = new Map<string, readonly string[]>()
  const narrowings: string[] = []
  try {
    // When: each fixture gets its own Bun process and all five requests share its lazy set.
    for (const fixture of [...fixtures,
      ...headerLabels.map((label) => ({ id: `headers-${label}`, text: rootPem + pem(rootDer, label).replace("-----\n", "-----\nComment: synthetic\n\n") })),
      ...[...malformedCases, ...whitespaceCases].map(([id, text]) => ({ id, text: rootPem + text })),
      ...subjectCases.map(([id, bytes]) => ({ id, text: rootPem + pem(bytes) })),
      { id: "unknown-before-root", text: pem(hex("3000"), "OTHER") + pem(rootDer, "X509 CERTIFICATE") },
      { id: "bad-der-before-pem", text: short + "-----BEGIN OTHER-----\n!!!!\n-----END OTHER-----\n" },
      { id: "no-block-text", text: "only text\n" },
      { id: "empty", text: "", expected: { kind: "kept" } }]) {
      const file = join(dir, `${fixture.id}.pem`)
      writeFileSync(file, Buffer.from(fixture.text, "utf8"))
      const home = mkdtempSync(join(dir, "oracle-home-"))
      const child = Bun.spawn([process.execPath, "-e", client, url], {
        env: { PATH: process.env.PATH, HOME: home, SSL_CERT_FILE: file, SSL_CERT_DIR: emptyDir },
        stdout: "pipe", stderr: "pipe", timeout: 30_000,
      })
      const [status, stdout, stderr] = await Promise.all([
        child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
      ])
      expect({ fixture: fixture.id, status, stderr }).toEqual({ fixture: fixture.id, status: 0, stderr: "" })
      const requests = stdout.trim().split("\n")
      expect(requests).toHaveLength(5)
      expect(requests.every((value) => value === "0" || value === "1")).toBe(true)
      outcomes.set(fixture.id, requests)
      console.log(`oracle ${fixture.id}: ${requests.join("")}`)
      // Then: every importer candidate must be accepted by every lookup in the real oracle.
      const imported = read(fixture.text, () => false)
      switch (imported.kind) {
        case "kept":
          if (imported.certificates.length > 0) expect(requests).toEqual(["1", "1", "1", "1", "1"])
          break
        case "dropped":
          if (requests.every((value) => value === "1")) narrowings.push(fixture.id)
          break
        default: { const unreachable: never = imported; throw unreachable }
      }
    }
    expect(outcomes.get("empty")).toEqual(["0", "0", "0", "0", "0"])
    expect(outcomes.get("c0")).toEqual(["1", "1", "1", "1", "1"])
    expect(outcomes.get("c1")).toEqual(["0", "0", "0", "0", "0"])
    // Equal canonical subjects have no sort tie-breaker: exactly one permutation exposes R, never assumed which.
    const exposed = ["c4s", "c4t"].filter((id) => outcomes.get(id)?.every((value) => value === "1"))
    expect(exposed).toHaveLength(1)
    console.log(`oracle narrowings: ${narrowings.join(", ")}`)
    expect([...narrowings].sort()).toEqual(["c4", ...exposed, "long-label", "mid-cr", "form-feed", "high-byte",
      "lowercase-label", "blank-body", "space-only-header-line"].sort())
  } finally {
    const closed = once(server, "close", { signal: AbortSignal.timeout(10_000) })
    server.closeAllConnections()
    server.close()
    await closed
  }
}, 240_000)

test.skipIf(Bun.which("node") === null)("refuses to run outside Bun when loaded by Node", async () => {
  // Given: Node's OpenSSL parser, which cause (e) must never rely on.
  const module = pathToFileURL(join(import.meta.dir, "..", "openssl-default-file.ts")).href
  const script = `import(${JSON.stringify(module)}).then((m) => { try { m.readDefaultFileCandidates(new Uint8Array(), () => false); console.log("returned") } catch (error) { console.log(error.name) } })`
  // When: the module runs under node.
  const child = Bun.spawn(["node", "-e", script], { env: { PATH: process.env.PATH }, stdout: "pipe", stderr: "pipe", timeout: 30_000 })
  const [status, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()])
  // Then: it throws the typed guard instead of selecting anything.
  expect({ status, stdout: stdout.trim() }).toEqual({ status: 0, stdout: "BunRequiredError" })
})
