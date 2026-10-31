import { afterAll, beforeAll, expect, test } from "bun:test"
import { createHash, X509Certificate } from "node:crypto"
import { mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises"
import { tmpdir, uptime } from "node:os"
import { basename, join } from "node:path"
import { trustLaunchKind } from "../compile-args"
import { runTrustStage, type TrustStageOptions } from "../trust-stage"
import { issueCertificates } from "./trust-certificate-fixtures"

let root: string
let ca: string
let extra: string
let user: string
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "omo-trust-ensure-"))
  const certs = await issueCertificates(root, ["root", "extra", "user"].map((name) => ({
    name, subject: `/CN=synthetic-ensure-${name}`, days: 2,
    extensions: "basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign",
  })))
  ;[ca, extra, user] = ["root", "extra", "user"].map((name) => new X509Certificate(certs.get(name)!).toString())
}, 60_000)
afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true })
})

const directory = () => mkdtemp(join(root, "ensure-"))
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex")
type Ensured = { v: number; file: string; sha256: string; automatic: string; fallbackReason: string | null
  user: string | null; defaults: { file: string; dir: string } | null; diagnostics: { code: string }[] }

async function ensure(dir: string, args: string[], overrides: Partial<TrustStageOptions> = {}) {
  const out: string[] = []
  const err: string[] = []
  let budget = 0
  const result = await runTrustStage({
    args: ["trust", "ensure", ...args], directory: dir, env: {}, loadedExtra: () => [],
    acquire: async (options) => { budget = options.deadlineMs; return { certificates: [ca], fallbackReason: null, codes: [] } },
    exec: async () => { throw new Error("trust ensure must never exec") },
    stdout: (line) => out.push(line), stderr: (line) => err.push(line),
    ...overrides,
  })
  return { result, out: out.join(""), err: err.join(""), budget }
}
const parsed = (out: string) => JSON.parse(out) as Ensured
async function records(dir: string) {
  return (await readFile(join(dir, "diagnostics.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line))
}
async function exists(path: string) {
  return stat(path).then(() => true, () => false)
}

test.each([
  [["trust", "ensure", "--json"], "short-host-cli"],
  [["trust", "ensure", "--json", "--lease-pid", "42"], "short-host-cli"],
  [["trust", "ensure", "--json", "--wait"], "one-shot-network"],
  [["trust", "ensure", "--wait", "--json", "--lease-pid", "42"], "one-shot-network"],
] as const)("trust ensure %j runs as %s (design 6.1)", (args, kind) => {
  expect(trustLaunchKind(args)).toBe(kind)
})

test.each([[[], 1500], [["--wait"], 20_000]] as const)(
  "trust ensure %j imports with a %i ms budget, prints the 5.2 fields and never execs", async (args, expected) => {
    const dir = await directory()
    const { result, out, budget } = await ensure(dir, ["--json", ...args], {
      env: { OMO_EXTRA_CA_CERTIFICATES: extra, SENPI_ENGINE_TRUST_HOP: "1" },
    })
    expect(result).toEqual({ action: "ensure" })
    expect(budget).toBe(expected)
    expect(out.endsWith("\n")).toBe(true)
    expect(out.trim().split("\n")).toHaveLength(1)
    const value = parsed(out)
    expect(Object.keys(value)).toEqual(["v", "file", "sha256", "automatic", "fallbackReason", "user", "defaults", "diagnostics"])
    expect(value).toMatchObject({ v: 1, automatic: "os", fallbackReason: null, user: null, diagnostics: [] })
    const text = await readFile(value.file, "utf8")
    expect(basename(value.file)).toBe(`${value.sha256}.pem`)
    expect(sha256(text)).toBe(value.sha256)
    expect((await stat(value.file)).mode & 0o777).toBe(0o600)
    expect(text).toContain(ca.trim())
    expect(text).toContain(extra.trim())
    // A server launch never runs without the closure (5.4, 5.8), so ensure always hands one out.
    expect(await readFile(value.defaults!.file, "utf8")).toBe("")
    expect(await readdir(value.defaults!.dir)).toEqual([])
    const log = await records(dir)
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ action: "ensure", kind: expected === 1500 ? "short-host-cli" : "one-shot-network", generation: value.sha256, codes: [] })
    // No lease without --lease-pid: this process exits as soon as it prints.
    expect(await readdir(join(dir, "leases")).catch(() => [])).toEqual([])
  },
)

test("a fallback ensure is reported as a fallback, keeps the closure and holds only explicit extras", async () => {
  const dir = await directory()
  const userFile = join(dir, "user.pem")
  await writeFile(userFile, user)
  const { result, out } = await ensure(dir, ["--json"], {
    env: { OMO_EXTRA_CA_CERTIFICATES: extra, NODE_EXTRA_CA_CERTS: userFile }, loadedExtra: () => [user],
    acquire: async () => ({ certificates: [ca], fallbackReason: "helper-timeout", codes: [] }),
  })
  expect(result).toEqual({ action: "ensure" })
  const value = parsed(out)
  expect(value).toMatchObject({ automatic: "fallback", fallbackReason: "helper-timeout", diagnostics: [{ code: "helper-timeout" }] })
  expect(value.defaults).not.toBeNull()
  const text = await readFile(value.file, "utf8")
  expect(text).not.toContain(ca.trim())
  expect(text).toContain(extra.trim())
  expect(text).toContain(user.trim())
  expect(value.user).toBe(sha256(await readFile(join(dir, `u-${value.user}.pem`), "utf8")))
  expect(text.startsWith(`# omo-engine-trust-generation v1 user=${value.user}\n`)).toBe(true)
})

test("--lease-pid writes { v, pid, bootAtMs } by rename, and a second lease by the same pid replaces the first", async () => {
  const dir = await directory()
  const first = parsed((await ensure(dir, ["--json", "--lease-pid", String(process.pid)])).out)
  const second = parsed((await ensure(dir, ["--json", "--lease-pid", String(process.pid)])).out)
  expect(second.sha256).toBe(first.sha256)
  const entries = await readdir(join(dir, "leases"))
  expect(entries).toEqual([`${first.sha256}.${process.pid}`])
  const lease = JSON.parse(await readFile(join(dir, "leases", entries[0]!), "utf8"))
  expect(Object.keys(lease)).toEqual(["v", "pid", "bootAtMs"])
  expect(lease.v).toBe(1)
  expect(lease.pid).toBe(process.pid)
  expect(Math.abs(lease.bootAtMs - (Date.now() - uptime() * 1000))).toBeLessThan(120_000)
  expect((await stat(join(dir, "leases", entries[0]!))).mode & 0o777).toBe(0o600)
})

test("a lease for another pid outlives the ensure process and pins its generation past 16 newer ones", async () => {
  const dir = await directory()
  const probe = Bun.spawn([process.execPath, join(import.meta.dir, "fixtures/trust-ensure-probe.ts"), dir,
    "trust", "ensure", "--json", "--lease-pid", String(process.pid)], { stdout: "pipe", stderr: "pipe", timeout: 20_000 })
  const [code, stdout, stderr] = await Promise.all([probe.exited, new Response(probe.stdout).text(), new Response(probe.stderr).text()])
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" })
  const leased = parsed(stdout)
  const leaseFile = join(dir, "leases", `${leased.sha256}.${process.pid}`)
  // The ensure process has exited; the lease names this live test process, so it must still be there.
  expect(await exists(leaseFile)).toBe(true)

  const now = Date.now() / 1000
  await utimes(leased.file, now - 10_000, now - 10_000)
  const newer: string[] = []
  for (let index = 0; index < 16; index++) {
    const text = `# omo-engine-trust-generation v1 user=none\n# synthetic ${index}\n`
    newer.push(sha256(text))
    await writeFile(join(dir, `${sha256(text)}.pem`), text, { mode: 0o600 })
    await utimes(join(dir, `${sha256(text)}.pem`), now - 1000 + index, now - 1000 + index)
  }
  // A later ensure writes the 17th newer generation and sweeps.
  const current = parsed((await ensure(dir, ["--json"], { env: { OMO_EXTRA_CA_CERTIFICATES: extra } })).out)
  expect(current.sha256).not.toBe(leased.sha256)
  expect(await exists(leased.file)).toBe(true)
  expect(await exists(leaseFile)).toBe(true)
  expect(await exists(join(dir, `${newer[0]}.pem`))).toBe(false)
  expect(await exists(join(dir, `${newer[1]}.pem`))).toBe(true)
})

test("a lease for a pid that has exited is dead: the next sweep removes it and its generation becomes evictable", async () => {
  const dir = await directory()
  const gone = Bun.spawn([process.execPath, "-e", ""], { stdout: "ignore", stderr: "ignore" })
  await gone.exited
  const leased = parsed((await ensure(dir, ["--json", "--lease-pid", String(gone.pid)])).out)
  // Its own sweep already finds the lease dead; only the current-generation rule keeps the file.
  expect(await readdir(join(dir, "leases"))).toEqual([])
  expect(await exists(leased.file)).toBe(true)
  const now = Date.now() / 1000
  await utimes(leased.file, now - 10_000, now - 10_000)
  for (let index = 0; index < 16; index++) {
    const text = `# omo-engine-trust-generation v1 user=none\n# synthetic dead ${index}\n`
    await writeFile(join(dir, `${sha256(text)}.pem`), text, { mode: 0o600 })
    await utimes(join(dir, `${sha256(text)}.pem`), now - 1000 + index, now - 1000 + index)
  }
  await ensure(dir, ["--json"], { env: { OMO_EXTRA_CA_CERTIFICATES: extra } })
  expect(await readdir(join(dir, "leases"))).toEqual([])
  expect(await exists(leased.file)).toBe(false)
})

test("reusing an existing generation refreshes its recency, so ensure never hands out the next eviction", async () => {
  const dir = await directory()
  const first = parsed((await ensure(dir, ["--json"])).out)
  const old = Date.now() / 1000 - 10_000
  await utimes(first.file, old, old)
  const again = parsed((await ensure(dir, ["--json"])).out)
  expect(again.file).toBe(first.file)
  expect((await stat(first.file)).mtimeMs).toBeGreaterThan(Date.now() - 60_000)
})

test("a lease that cannot be written is reported, never fatal, and never widens the generation", async () => {
  const dir = await directory()
  await writeFile(join(dir, "leases"), "not a directory", { mode: 0o600 })
  const { result, out } = await ensure(dir, ["--json", "--lease-pid", String(process.pid)])
  expect(result).toEqual({ action: "ensure" })
  const value = parsed(out)
  expect(value.diagnostics).toEqual([{ code: "trust-lease-failed" }])
  expect((await records(dir))[0].codes).toEqual([{ code: "trust-lease-failed" }])
  expect(sha256(await readFile(value.file, "utf8"))).toBe(value.sha256)
})

test("an unrecoverable U refuses with exit 78 semantics and prints no generation", async () => {
  const dir = await directory()
  const generation = join(dir, `${"b".repeat(64)}.pem`)
  await writeFile(generation, `# omo-engine-trust-generation v1 user=${"c".repeat(64)}\n${ca}`, { mode: 0o600 })
  const { result, out, err } = await ensure(dir, ["--json"], {
    env: { NODE_EXTRA_CA_CERTS: generation }, loadedExtra: () => [ca],
    acquire: async () => { throw new Error("unrecoverable U acquired") },
  })
  expect(result).toMatchObject({ action: "refuse", code: "trust-user-extras-unrecoverable" })
  expect(out).toBe("")
  expect(err).toContain("trust-user-extras-unrecoverable")
})

test.each([
  [["trust"]], [["trust", "status"]], [["trust", "ensure"]], [["trust", "ensure", "--wait"]],
  [["trust", "ensure", "--json", "--json"]], [["trust", "ensure", "--json", "--wait", "--wait"]],
  [["trust", "ensure", "--json", "--lease-pid"]], [["trust", "ensure", "--json", "--lease-pid", "0"]],
  [["trust", "ensure", "--json", "--lease-pid", "-5"]], [["trust", "ensure", "--json", "--lease-pid", "007"]],
  [["trust", "ensure", "--json", "--lease-pid", "12x"]], [["trust", "ensure", "--json", "--lease-pid", "2147483648"]],
  [["trust", "ensure", "--json", "--lease-pid", "1", "--lease-pid", "2"]], [["trust", "ensure", "--json", "--lease-pid=1"]],
  [["trust", "ensure", "--json", "--force"]], [["trust", "ensure", "--json", "--", "x"]],
] as const)("%j is a usage error before any import or write", async (args) => {
  const dir = join(root, `usage-${Math.random().toString(16).slice(2)}`)
  const err: string[] = []
  const result = await runTrustStage({
    args, directory: dir, env: {}, stderr: (line) => err.push(line), stdout: () => { throw new Error("usage printed output") },
    acquire: async () => { throw new Error("usage acquired") },
    exec: async () => { throw new Error("usage exec") },
  })
  expect(result).toEqual({ action: "usage" })
  expect(err.join("")).not.toBe("")
  expect(await exists(dir)).toBe(false)
})

test.each([[["trust", "bogus"]], [["trust", "ensure", "--json", "--lease-pid", "0"]]])(
  "compile-entry answers %j with exit 2 and never reaches the engine or the trust directory", async (args) => {
    const home = await directory()
    const proc = Bun.spawn([process.execPath, join(import.meta.dir, "../compile-entry.ts"), ...args], {
      env: { PATH: process.env.PATH, HOME: home }, stdout: "pipe", stderr: "pipe", timeout: 30_000,
    })
    const [code, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
    expect({ code, stdout }).toEqual({ code: 2, stdout: "" })
    expect(stderr).not.toBe("")
    expect(await exists(join(home, ".omo/engine-trust"))).toBe(false)
  },
)
