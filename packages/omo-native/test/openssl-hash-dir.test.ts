import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { generateKeyPairSync, sign, X509Certificate } from "node:crypto"
import { once } from "node:events"
import { mkdtemp, mkdir, open, readdir, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createServer, type Server } from "node:tls"
import { selectOpenSslHashDirectory, type HashDirectory } from "../openssl-hash-dir"

// Minimal DER fixture construction; signatures and keys come from node:crypto, not OpenSSL.
const der = (tag: number, bytes: Uint8Array): Buffer => {
  const length = bytes.length < 128 ? [bytes.length] : bytes.length < 256 ? [0x81, bytes.length] : [0x82, bytes.length >> 8, bytes.length & 255]
  return Buffer.concat([Buffer.from([tag, ...length]), bytes])
}
const seq = (...bytes: readonly Uint8Array[]) => der(0x30, Buffer.concat(bytes))
const hex = (value: string) => Buffer.from(value, "hex")
const pem = (bytes: Uint8Array, label = "CERTIFICATE") => `-----BEGIN ${label}-----\n${Buffer.from(bytes).toString("base64").match(/.{1,64}/g)?.join("\n")}\n-----END ${label}-----\n`
const name = (cn: string) => seq(der(0x31, seq(hex("0603550403"), der(0x0c, Buffer.from(cn)))))
const algorithm = hex("300a06082a8648ce3d040302")
type Root = { readonly cert: string; readonly leaf: string; readonly key: string; readonly hash: string; readonly old: string; readonly fingerprint: string }
async function makeRoot(cn: string): Promise<Root> {
  const ca = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
  const leaf = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
  const validity = seq(der(0x17, Buffer.from("200101000000Z")), der(0x17, Buffer.from("491231235959Z")))
  const issue = (subject: Buffer, publicKey: Buffer, extensions: Buffer) => {
    const tbs = seq(hex("a003020102020101"), algorithm, name(cn), validity, subject, publicKey, der(0xa3, extensions))
    return pem(seq(tbs, algorithm, der(0x03, Buffer.concat([hex("00"), sign("sha256", tbs, ca.privateKey)]))))
  }
  const cert = issue(name(cn), ca.publicKey.export({ format: "der", type: "spki" }), seq(hex("300f0603551d130101ff040530030101ff"), hex("300e0603551d0f0101ff040403020106")))
  const leafCert = issue(name("localhost"), leaf.publicKey.export({ format: "der", type: "spki" }), seq(hex("30140603551d11040d300b82096c6f63616c686f7374")))
  // node:crypto exposes no X509_NAME_hash API. Verify these CLI hashes against real Bun below.
  const hash = Bun.spawn(["openssl", "x509", "-noout", "-subject_hash", "-subject_hash_old"], { stdin: Buffer.from(cert), stdout: "pipe", stderr: "pipe" })
  const output = await new Response(hash.stdout).text()
  expect(await hash.exited).toBe(0)
  const [current, old] = output.trim().split("\n")
  if (!current || !old) throw new Error("OpenSSL returned no subject hashes")
  return { cert, leaf: leafCert, key: leaf.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), hash: current, old, fingerprint: new X509Certificate(cert).fingerprint256 }
}

// Fixtures need symlinks and the openssl CLI, and the oracle relies on Bun reading SSL_CERT_DIR.
describe.skipIf(process.platform === "win32")("OpenSSL hash-directory selection", () => {
let base = ""
const roots = new Map<string, Root>()
const servers: Server[] = []
const ports = new Map<string, number>()
const get = (id: string) => {
  const root = roots.get(id)
  if (!root) throw new Error(`Unknown fixture ${id}`)
  return root
}
const io = (directory: string, opened: string[] = []): HashDirectory => ({
  entries: () => readdir(directory),
  open: async (entry) => {
    opened.push(entry)
    return open(join(directory, entry), "r")
  },
})
const selected = async (fixture: string) => {
  const result = await selectOpenSslHashDirectory(io(join(base, fixture)))
  return { result, ids: result.candidates.map((cert) => [...roots].find(([, root]) => cert.fingerprint256 === root.fingerprint)?.[0] ?? cert.fingerprint256).sort() }
}
const bad = pem(hex("3000"))
beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), "omo-hash-dir-"))
  await writeFile(join(base, "empty.pem"), "")
  await mkdir(join(base, "home"))
  for (const id of ["R0", "R1", "R2", "R4", "X4", "R5", "R5b", "R6", "X6", "X8", "Q8", "G", "RU", "A1", "B1", "C1", "A2", "B2", "C2"]) {
    const root = await makeRoot(`hash-dir ${id}`)
    roots.set(id, root)
    const server = createServer({ key: root.key, cert: root.leaf }, (socket) => socket.end())
    server.on("tlsClientError", () => { /* Expected for rejected roots. */ })
    servers.push(server)
    const listening = once(server, "listening", { signal: AbortSignal.timeout(10_000) })
    server.listen(0, "127.0.0.1")
    await listening
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("No fixture TLS port")
    ports.set(id, address.port)
  }
  expect(new Set([...roots.values()].flatMap((root) => [root.hash, root.old])).size).toBe(roots.size * 2)
  const layouts: Readonly<Record<string, Readonly<Record<string, string>>>> = {
    c0: { [`${get("R0").hash}.0`]: get("R0").cert },
    c1: { [`${get("R1").hash}.1`]: get("R1").cert },
    c2: { [`${get("R2").hash}.01`]: get("R2").cert },
    c4: { [`${get("R4").hash}.0`]: get("X4").cert, [`${get("R4").hash}.1`]: get("R4").cert },
    c5: { [`${get("R5").hash}.0`]: "", [`${get("R5").hash}.1`]: get("R5").cert },
    c5b: { [`${get("R5b").hash}.0`]: bad, [`${get("R5b").hash}.1`]: get("R5b").cert },
    cold: { [`${get("R0").old}.0`]: get("R0").cert },
    cup: { [`${get("RU").hash.toUpperCase()}.0`]: get("RU").cert },
    c6: { [`${get("X6").hash}.0`]: get("X6").cert + get("R6").cert },
    c8: { [`${get("Q8").hash}.0`]: get("X8").cert },
    c9: { [`${get("G").hash}.0`]: get("G").cert + bad },
    c10: Object.fromEntries(["1", "2"].flatMap((n) => [[`${get(`A${n}`).hash}.0`, get(`A${n}`).cert + get(`B${n}`).cert], [`${get(`B${n}`).hash}.0`, get(`B${n}`).cert + get(`C${n}`).cert]])),
    c10solo: { [`${get("A1").hash}.0`]: get("A1").cert + get("B1").cert, [`${get("B1").hash}.0`]: get("B1").cert + get("C1").cert },
    auxiliary: { [`${get("R0").hash}.0`]: get("R0").cert + pem(new X509Certificate(get("R0").cert).raw, "TRUSTED CERTIFICATE") },
    "aux-trailer": { [`${get("R0").hash}.0`]: get("R0").cert, [`${get("R0").hash}.1`]: pem(Buffer.concat([new X509Certificate(get("R0").cert).raw, hex("3000")]), "TRUSTED CERTIFICATE") },
    legacy: { [`${get("R0").hash}.0`]: get("R0").cert.replaceAll("CERTIFICATE", "X509 CERTIFICATE").replaceAll("\n", "\r\n") },
    text: { [`${get("R0").hash}.0`]: `comment\n${get("R0").cert}` },
    leading: { [`${get("R0").hash}.0`]: ` ${get("R0").cert}` },
    joined: { [`${get("R0").hash}.0`]: get("R0").cert.trimEnd() + get("R0").cert },
    crl: { [`${get("R0").hash}.0`]: get("R0").cert + pem(new X509Certificate(get("R0").cert).raw, "X509 CRL") },
    gap: { [`${get("R0").hash}.0`]: get("R0").cert, [`${get("R0").hash}.2`]: get("R1").cert },
    empty: {},
  }
  for (const [fixture, files] of Object.entries(layouts)) {
    await mkdir(join(base, fixture))
    for (const [entry, bytes] of Object.entries(files)) await writeFile(join(base, fixture, entry), bytes)
  }
  await mkdir(join(base, "c7"))
  await writeFile(join(base, "R0.pem"), get("R0").cert)
  await symlink(join(base, "R0.pem"), join(base, "c7", `${get("R0").hash}.0`))
}, 60_000)
afterAll(async () => {
  for (const server of servers) {
    const closed = once(server, "close", { signal: AbortSignal.timeout(10_000) })
    server.close()
    await closed
  }
  if (base) await rm(base, { recursive: true, force: true })
})

// Each history gets one native store; no ambient CA variables or shared home/cache.
async function oracle(fixture: string, history: readonly string[]): Promise<string[]> {
  const script = `const {Socket}=require("node:net");const {connect}=require("node:tls");
for(const port of process.argv.slice(1)){await new Promise((resolve,reject)=>{
 const raw=new Socket();const socket=connect({socket:raw,servername:"localhost",rejectUnauthorized:true});
 const timer=setTimeout(()=>{socket.destroy();reject(new Error("TLS oracle timeout"))},5000);
 socket.once("secureConnect",()=>{clearTimeout(timer);console.log("OK");socket.destroy();resolve()});
 socket.once("error",e=>{clearTimeout(timer);console.log(e.code);socket.destroy();resolve()});
 raw.connect(Number(port),"127.0.0.1");
})}`
  const child = Bun.spawn([process.execPath, "-e", script, ...history.map((id) => String(ports.get(id)))], {
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: join(base, "home"), SSL_CERT_FILE: join(base, "empty.pem"), SSL_CERT_DIR: join(base, fixture) },
    stdout: "pipe", stderr: "pipe", timeout: 20_000,
  })
  const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  expect({ exit, stderr }).toEqual({ exit: 0, stderr: "" })
  console.log(JSON.stringify({ fixture, history, outcomes: stdout.trim().split("\n") }))
  return stdout.trim().split("\n")
}
const reject = "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
test.each([
  ["c0", ["R0"]], ["c1", []], ["c2", []], ["c4", ["R4", "X4"]], ["c5", []], ["c5b", []],
  ["cold", ["R0"]], ["c6", ["R6", "X6"]], ["c7", ["R0"]], ["c8", ["X8"]], ["c9", []],
  ["c10", ["A1", "A2", "B1", "B2", "C1", "C2"]],
] as const)("selects the reachable envelope when directory is %s", async (fixture, expected) => {
  // Given a synthetic directory; when selected; then only the literal envelope survives.
  expect((await selected(fixture)).ids).toEqual([...expected])
})
test.each([
  ["c0", ["R0"], ["OK"]], ["c1", ["R1"], [reject]], ["c2", ["R2"], [reject]],
  ["c5", ["R5"], [reject]], ["c5b", ["R5b"], [reject]], ["cold", ["R0"], ["OK"]],
  ["c7", ["R0"], ["OK"]], ["c9", ["G"], ["OK"]], ["empty", ["R0"], [reject]],
  ["c4", ["X4", "R4", "X4"], [reject, "OK", "OK"]], ["c4", ["R4", "X4"], ["OK", "OK"]],
  ["c6", ["R6", "X6", "R6"], [reject, "OK", "OK"]], ["c6", ["X6", "R6"], ["OK", "OK"]],
  ["c8", ["X8", "Q8", "X8"], [reject, reject, "OK"]], ["c8", ["Q8", "X8"], [reject, "OK"]],
  ["c10", ["A1", "B1", "C1", "B2", "A2", "C2", "C1"], ["OK", "OK", reject, "OK", "OK", "OK", reject]],
  ["c10solo", ["A1", "B1", "C1"], ["OK", "OK", reject]],
  ["c10solo", ["B1", "A1", "C1"], ["OK", "OK", "OK"]], ["c10solo", ["C1"], [reject]],
  ["auxiliary", ["R0"], ["OK"]],
] as const)("matches real Bun when %s runs history %j", async (fixture, history, expected) => {
  // Given a fresh Bun store; when the whole history runs; then its literal vector agrees.
  const outcomes = await oracle(fixture, history)
  expect(outcomes).toEqual([...expected])
  if (!["c4", "c6", "c8", "c10", "c10solo"].includes(fixture)) {
    const accepted = history.filter((_, index) => outcomes[index] === "OK")
    const { ids } = await selected(fixture)
    expect(ids.every((id) => accepted.some((root) => root === id))).toBe(true)
    if (fixture !== "c9" && fixture !== "auxiliary") expect(ids).toEqual([...new Set(accepted)].sort())
  }
}, 30_000)
test("matches the union of accepted histories when the cache suppresses another hash walk", async () => {
  // Given both M17 orders; when measured in fresh processes; then compare the union, not one order.
  for (const [fixture, histories] of [
    ["c4", [["X4", "R4", "X4"], ["R4", "X4"]]],
    ["c6", [["R6", "X6", "R6"], ["X6", "R6"]]],
    ["c8", [["X8", "Q8", "X8"], ["Q8", "X8"]]],
    ["c10solo", [["A1", "B1", "C1"], ["B1", "A1", "C1"]]],
    ["c10", [["A1", "B1", "C1", "B2", "A2", "C2", "C1"], ["B1", "A1", "C1", "A2", "B2", "C2", "C2"]]],
  ] as const) {
    const accepted = new Set<string>()
    for (const history of histories) {
      const outcomes = await oracle(fixture, history)
      history.forEach((id, index) => { if (outcomes[index] === "OK") accepted.add(id) })
    }
    expect((await selected(fixture)).ids).toEqual([...accepted].sort())
  }
}, 60_000)
test("records the literal narrowing list when a hash file is malformed or auxiliary", async () => {
  // Given G followed by malformed DER, and an auxiliary/plain duplicate; when selected; then drops are visible.
  expect((await selected("c9")).result.diagnostics).toEqual([{ path: `${get("G").hash}.0`, code: "openssl-default-dir-malformed", narrowing: true }])
  const auxiliary = await selected("auxiliary")
  expect(auxiliary.ids).toEqual([])
  expect(auxiliary.result.excludedFingerprints).toEqual([get("R0").fingerprint])
  expect(auxiliary.result.diagnostics).toEqual([{ path: `${get("R0").hash}.0`, code: "openssl-default-aux-dropped", narrowing: true }])
})
test("uses constructed lower-case paths when names are uppercase on this filesystem", async () => {
  // Given cup on the real volume; when both loaders run; then case behavior and paths agree.
  const opened: string[] = []
  const result = await selectOpenSslHashDirectory(io(join(base, "cup"), opened))
  expect(opened[0]).toBe(`${get("RU").hash}.0`)
  const outcomes = await oracle("cup", ["RU"])
  expect(result.candidates.map((cert) => cert.fingerprint256)).toEqual(outcomes[0] === "OK" ? [get("RU").fingerprint] : [])
})
test.each([
  ["directory", "openssl-default-dir-not-regular"], ["dangling", undefined], ["oversize", "openssl-default-dir-cap"],
  ["framing", "openssl-default-dir-malformed"], ["headers", "openssl-default-dir-malformed"], ["trailing-der", "openssl-default-dir-malformed"],
] as const)("ends the walk when the opened object has %s", async (kind, code) => {
  // A trailer after the certificate DER is read as AUX by d2i_X509_AUX, so it also excludes the certificate.
  const codes = kind === "trailing-der" ? ["openssl-default-aux-dropped", "openssl-default-dir-malformed"] as const : code === undefined ? [] : [code]
  // Given an unreadable/noncanonical first file and a valid successor; when selected; then the successor is unreachable.
  const directory = await mkdtemp(join(base, "edge-"))
  const path = join(directory, `${get("R0").hash}.0`)
  if (kind === "directory") await mkdir(path)
  else if (kind === "dangling") await symlink(join(directory, "absent"), path)
  else await writeFile(path, kind === "oversize" ? Buffer.alloc(8 * 1024 * 1024 + 1) : kind === "framing" ? "x".repeat(2048) + get("R0").cert : kind === "headers" ? get("R0").cert.replace("-----\n", "-----\nProc-Type: 4,ENCRYPTED\n\n") : pem(Buffer.concat([new X509Certificate(get("R0").cert).raw, hex("00")])))
  await writeFile(join(directory, `${get("R0").hash}.1`), get("R0").cert)
  const result = await selectOpenSslHashDirectory(io(directory))
  expect(result.candidates).toEqual([])
  expect(result.diagnostics).toEqual(codes.map((entry) => ({ path: `${get("R0").hash}.0`, code: entry, narrowing: true })))
  expect(await oracle(directory.slice(base.length + 1), ["R0"])).toEqual([reject])
})
test("excludes a certificate whose CERTIFICATE-labelled block carries an AUX trailer", async () => {
  // Given X with an AUX trailer in its own hash file, and a plain copy of X after Y in Y's file.
  const directory = await mkdtemp(join(base, "aux-label-"))
  const x = new X509Certificate(get("R0").cert).raw
  await writeFile(join(directory, `${get("R0").hash}.0`), pem(Buffer.concat([x, hex("3000")])))
  await writeFile(join(directory, `${get("R1").hash}.0`), get("R1").cert + get("R0").cert)
  // When the directory is selected.
  const result = await selectOpenSslHashDirectory(io(directory))
  // Then the trailer's restriction carries to every copy of X, under any certificate label.
  expect(result.candidates.map((cert) => cert.fingerprint256)).toEqual([get("R1").fingerprint])
  expect(result.excludedFingerprints).toEqual([get("R0").fingerprint])
})
test("records the suffix cap when every prior file loads", async () => {
  // Given a repeating regular certificate source; when its walk reaches 4096; then stop with a visible narrowing.
  const bytes = Buffer.from(get("R0").cert)
  const result = await selectOpenSslHashDirectory({
    entries: async () => ["01234567.anything"],
    open: async () => ({ stat: async () => ({ size: bytes.length, isFile: () => true }), readFile: async () => bytes, close: async () => {} }),
  })
  expect(result.candidates.map((cert) => cert.fingerprint256)).toEqual([get("R0").fingerprint])
  expect(result.diagnostics).toEqual([{ path: "01234567.4096", code: "openssl-default-dir-cap", narrowing: true }])
})
test.each([
  { fixture: "aux-trailer", ids: [], drops: [["openssl-default-aux-dropped", true], ["openssl-default-dir-malformed", true]], history: ["R0"], expected: ["OK"] },
  { fixture: "legacy", ids: ["R0"], drops: [], history: ["R0"], expected: ["OK"] },
  { fixture: "text", ids: [], drops: [["openssl-default-dir-malformed", true]], history: ["R0"], expected: ["OK"] },
  { fixture: "leading", ids: [], drops: [["openssl-default-dir-malformed", true]], history: ["R0"], expected: [reject] },
  { fixture: "joined", ids: [], drops: [["openssl-default-dir-malformed", true]], history: ["R0"], expected: [reject] },
  { fixture: "crl", ids: ["R0"], drops: [["openssl-default-aux-dropped", true]], history: ["R0"], expected: ["OK"] },
  { fixture: "gap", ids: ["R0"], drops: [], history: ["R0", "R1"], expected: ["OK", reject] },
] as const)("preserves the conservative envelope when content is $fixture", async ({ fixture, ids, drops, history, expected }) => {
  // Given auxiliary, legacy, noncanonical, and gap inputs; when selected; then narrowings stay explicit.
  const actual = await selected(fixture)
  expect(actual.ids).toEqual([...ids])
  expect(actual.result.diagnostics.map(({ code, narrowing }) => [code, narrowing])).toEqual(drops.map((entry) => [...entry]))
  const outcomes = await oracle(fixture, history)
  expect(outcomes).toEqual([...expected])
  expect(actual.ids.every((id) => history.some((root, index) => root === id && outcomes[index] === "OK"))).toBe(true)
})
test("records the total byte cap when individually small files exceed the generation budget", async () => {
  // Given two files just over 4 MiB each; when selected; then only the first file contributes.
  const directory = await mkdtemp(join(base, "total-"))
  for (const [suffix, id] of ["R0", "R1"].entries()) {
    await writeFile(join(directory, `${get("R0").hash}.${suffix}`), "\n".repeat(4 * 1024 * 1024 + 1 - get(id).cert.length) + get(id).cert)
  }
  const result = await selectOpenSslHashDirectory(io(directory))
  expect(result.candidates.map((cert) => cert.fingerprint256)).toEqual([get("R0").fingerprint])
  expect(result.diagnostics).toEqual([{ path: `${get("R0").hash}.1`, code: "openssl-default-dir-cap", narrowing: true }])
  expect(await oracle(directory.slice(base.length + 1), ["R0", "R1"])).toEqual(["OK", "OK"])
})
})
