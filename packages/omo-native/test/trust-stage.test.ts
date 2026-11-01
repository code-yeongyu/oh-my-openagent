import { afterAll, beforeAll, expect, test } from "bun:test"
import { createHash, X509Certificate } from "node:crypto"
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile, readdir, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildTrustLaunchEnvironment, type EngineTrustMarker } from "@code-yeongyu/senpi/engine-trust"
import { trustLaunchKind } from "../compile-args"
import { runTrustStage } from "../trust-stage"
import { issueCertificates } from "./trust-certificate-fixtures"

let root: string
let executable: string
let ca: string
let other: string
let leaf: string
function required<T>(value: T | null | undefined, name: string): T {
  if (value === undefined || value === null) throw new Error(`${name} is missing`)
  return value
}
const trustMarker = (env: NodeJS.ProcessEnv) => JSON.parse(required(env.SENPI_ENGINE_TRUST, "SENPI_ENGINE_TRUST")) as EngineTrustMarker
beforeAll(async () => {
  // The stage relocates a directory reached through any link (macOS tmpdir() is under /var -> /private/var),
  // so the directories these tests name must be canonical, as temporaryTrustDirectory's own are.
  root = await mkdtemp(join(await realpath(tmpdir()), "omo-trust-stage-"))
  const certs = await issueCertificates(root, [...["root", "other"].map((name) => ({
    name, subject: `/CN=synthetic-${name}`, days: 2,
    extensions: "basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign",
  })), {
    name: "leaf", subject: "/CN=localhost", issuer: "root", days: 2,
    extensions: "basicConstraints=critical,CA:FALSE\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:127.0.0.1,DNS:localhost",
  }])
  const pem = (name: string) => new X509Certificate(required(certs.get(name), `synthetic ${name} certificate`)).toString()
  ca = pem("root")
  other = pem("other")
  leaf = pem("leaf")
  executable = join(root, process.platform === "win32" ? "probe.exe" : "probe")
  const build = await Bun.build({
    entrypoints: [join(import.meta.dir, "fixtures/trust-stage-probe.ts")],
    compile: { outfile: executable },
  })
  if (!build.success) throw new Error(build.logs.join("\n"))
}, 60_000)
afterAll(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true })
    expect(await stat(root).catch(() => null)).toBeNull()
  }
})

async function directory() {
  return mkdtemp(join(root, "generation-"))
}
function cleanEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(NODE_|SSL_|BUN_OPTIONS$|SENPI_ENGINE_TRUST|OMO_EXTRA_CA_CERTIFICATES$|T3CODE_OMO_AGENT_DIR$)/i.test(key)))
}
async function child(env: NodeJS.ProcessEnv, dir: string, mode?: string) {
  const proc = Bun.spawn([executable, dir, ...(mode ? [mode] : [])], { env, stdout: "pipe", stderr: "pipe", timeout: 15_000 })
  const [code, stdout, stderr] = await Promise.all([
    proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text(),
  ])
  return { code, stdout, stderr }
}
async function records(dir: string) {
  return (await readFile(join(dir, "diagnostics.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line))
}
async function launch(dir: string, env: NodeJS.ProcessEnv = cleanEnv(), fault?: (env: NodeJS.ProcessEnv) => Promise<void>) {
  let output: Awaited<ReturnType<typeof child>> | undefined
  const result = await runTrustStage({
    args: ["-p"], env, directory: dir, executable, argv: [dir],
    loadedExtra: () => [],
    acquire: async () => ({ certificates: [ca], fallbackReason: null, codes: [] }),
    exec: async (_file, _args, next) => {
      await fault?.(next)
      output = await child(next, dir)
    },
  })
  return { result, output: required(output, "compiled child output") }
}

test.each([
  [["--help"], "static"], [["--version"], "static"], [["-v"], "static"],
  [["update", "--help"], "static"], [["host", "status"], "short-host-cli"],
  [["thread", "list"], "short-host-cli"], [["daemon", "run"], "short-host-cli"],
  [["login"], "static"], [["whoami", "--help"], "static"], [["logout"], "static"], [["update"], "one-shot-network"],
  [["doctor"], "one-shot-network"], [["-p"], "one-shot-network"],
  [["--mode", "json"], "one-shot-network"], [["--mode", "rpc"], "long-lived"],
  [["--", "-p"], "long-lived"], [[], "long-lived"],
] as const)("launch kind %j is %s", (args, expected) => {
  expect(trustLaunchKind(args)).toBe(expected)
})

// Fail closed: the closed-account answer is static only while the build switch refuses it.
test("an account command that can sign in is a one-shot network launch", () => {
  const open = Symbol.for("omo.test.serviceAccountsOpen")
  Object.assign(globalThis, { [open]: true })
  try {
    expect(["login", "logout", "whoami"].map((command) => trustLaunchKind([command]))).toEqual(Array(3).fill("one-shot-network"))
  } finally {
    delete (globalThis as Record<symbol, unknown>)[open]
  }
})

test("static commands never acquire, execute, or create trust storage", async () => {
  const dir = join(root, "not-created")
  const result = await runTrustStage({
    args: ["--help"], directory: dir, env: cleanEnv(),
    acquire: async () => { throw new Error("static acquired") },
    exec: async () => { throw new Error("static exec") },
  })
  expect(result.action).toBe("static")
  expect(await stat(dir).catch(() => null)).toBeNull()
})

test("a compiled child adopts native extras, scrubs plumbing, and restores old desktop values", async () => {
  const dir = await directory()
  const originals = {
    NODE_USE_SYSTEM_CA: "1", SSL_CERT_FILE: "/synthetic/file", SSL_CERT_DIR: "/synthetic/dir",
    BUN_OPTIONS: "--use-system-ca", T3CODE_OMO_AGENT_DIR: "/synthetic/agent",
  }
  const { result, output } = await launch(dir, { ...cleanEnv(), ...originals })
  expect(result.action).toBe("import-exec")
  expect(output.code).toBe(0)
  const value = JSON.parse(output.stdout)
  expect(value.env).toEqual({
    NODE_EXTRA_CA_CERTS: null, NODE_USE_SYSTEM_CA: "1", SSL_CERT_FILE: "/synthetic/file",
    SSL_CERT_DIR: "/synthetic/dir", BUN_OPTIONS: "--use-system-ca",
    SENPI_ENGINE_TRUST: null, SENPI_ENGINE_TRUST_HOP: null,
  })
  expect(value.marker.owner).toBe("server")
  expect(value.marker.automatic).toBe("os")
  expect((await records(dir)).filter((record) => record.action === "import-exec")).toHaveLength(1)
  // Windows has no POSIX mode: libuv reports a writable file as 0o666 and the profile ACL guards it (5.3).
  expect((await stat(value.marker.file)).mode & 0o777).toBe(process.platform === "win32" ? 0o666 : 0o600)
  const raw = await readFile(join(dir, "diagnostics.jsonl"), "utf8")
  expect(raw).not.toContain(dir)
  expect(raw).not.toContain("/synthetic")
  expect(raw).not.toContain("CERTIFICATE")
})

type Fault = { name: string; code: string; check: string | null; apply: (env: NodeJS.ProcessEnv) => Promise<void> }
const faults: Fault[] = [
  { name: "different native extra path", code: "trust-exec-loop", check: null,
    apply: async (env) => { env.NODE_EXTRA_CA_CERTS = join(root, "absent.pem") } },
  { name: "missing extra path", code: "trust-exec-loop", check: null,
    apply: async (env) => { delete env.NODE_EXTRA_CA_CERTS } },
  { name: "missing marker", code: "trust-exec-loop", check: null,
    apply: async (env) => { delete env.SENPI_ENGINE_TRUST } },
  { name: "replaced generation", code: "trust-load-mismatch", check: "file",
    apply: async (env) => { await writeFile(required(env.NODE_EXTRA_CA_CERTS, "NODE_EXTRA_CA_CERTS"), other) } },
  { name: "native loaded-set mismatch", code: "trust-load-mismatch", check: "loaded-set",
    apply: async (env) => {
      const marker = trustMarker(env)
      const text = (await readFile(marker.file, "utf8")) + "\n-----BEGIN CERTIFICATE-----\nMAA=\n-----END CERTIFICATE-----\n"
      const sha256 = createHash("sha256").update(text).digest("hex")
      const file = join(root, `${sha256}.pem`)
      await writeFile(file, text, { mode: 0o600 })
      env.NODE_EXTRA_CA_CERTS = file
      env.SENPI_ENGINE_TRUST = JSON.stringify({ ...marker, sha256, file })
    } },
  { name: "server default input reopened", code: "trust-load-mismatch", check: "provenance",
    apply: async (env) => { env.SSL_CERT_FILE = join(root, "ambient.pem") } },
  { name: "changed validated extras", code: "trust-load-mismatch", check: "extras",
    apply: async (env) => { env.OMO_EXTRA_CA_CERTIFICATES = other } },
]
test.each(faults)("exec bound: $name", async ({ apply, code, check }) => {
  const dir = await directory()
  const { output } = await launch(dir, { ...cleanEnv(), T3CODE_OMO_AGENT_DIR: "/synthetic/server" }, apply)
  expect(output.code).toBe(78)
  expect(output.stderr).toContain(code)
  expect(output.stderr).toContain("SENPI_ENGINE_TRUST")
  expect(output.stderr).toContain("SENPI_ENGINE_TRUST_HOP")
  const log = await records(dir)
  expect(log.filter((record) => record.action === "import-exec")).toHaveLength(1)
  expect(log.filter((record) => record.action === "refuse")).toHaveLength(1)
  expect(log.find((record) => record.action === "refuse")).toMatchObject({ codes: expect.arrayContaining([{ code }]), check })
})

test("foreign marker has no authority without a hop; a hop of any value refuses before import", async () => {
  const dir = await directory()
  const foreign: EngineTrustMarker = {
    v: 1, file: "/foreign/generation.pem", sha256: "a".repeat(64), user: null, owner: "server",
    automatic: "os", fallbackReason: null, defaults: { file: "/foreign/empty.pem", dir: "/foreign/empty.d" },
    restore: { NODE_USE_SYSTEM_CA: "foreign-restore" },
  }
  const { output } = await launch(dir, { ...cleanEnv(), SENPI_ENGINE_TRUST: JSON.stringify(foreign) })
  expect(output.code).toBe(0)
  expect(JSON.parse(output.stdout).marker.owner).toBe("standalone")
  expect(JSON.parse(output.stdout).env.NODE_USE_SYSTEM_CA).toBeNull()
  expect((await records(dir)).flatMap((record) => record.codes).filter((entry) => entry.code === "trust-marker-foreign")).toHaveLength(1)
  const refusal = await runTrustStage({
    args: [], directory: dir, env: { SENPI_ENGINE_TRUST_HOP: "" },
    acquire: async () => { throw new Error("hop imported") }, stderr: () => {},
  })
  expect(refusal).toMatchObject({ action: "refuse", code: "trust-exec-loop" })
})

test("failed addressed handoff preserves recorded originals and recovers only U", async () => {
  const dir = await directory()
  const userFile = join(root, "user.pem")
  await writeFile(userFile, other)
  let marker: EngineTrustMarker | undefined
  await runTrustStage({
    args: ["-p"], directory: dir, env: { NODE_EXTRA_CA_CERTS: userFile },
    loadedExtra: () => [other],
    acquire: async () => ({ certificates: [ca], fallbackReason: null, codes: [] }),
    exec: async (_file, _argv, env) => { marker = trustMarker(env) },
  })
  const arrived = buildTrustLaunchEnvironment({}, { marker: required(marker, "first marker"), hop: false, platform: process.platform })
  let next: EngineTrustMarker | undefined
  await runTrustStage({
    args: ["-p"], directory: dir, env: arrived, loadedExtra: () => [],
    acquire: async () => ({ certificates: [], fallbackReason: "negatives-incomplete", codes: [] }),
    exec: async (_file, _argv, env) => { next = trustMarker(env) },
  })
  const recovered = required(next, "recovered marker")
  expect(recovered.restore.NODE_EXTRA_CA_CERTS).toBe(userFile)
  const pem = await readFile(recovered.file, "utf8")
  expect(pem).toContain(other.trim())
  expect(pem).not.toContain(ca.trim())
  expect(recovered.fallbackReason).toBe("negatives-incomplete")
  await rm(join(dir, `u-${recovered.user}.pem`))
  const refused = await runTrustStage({
    args: [], directory: dir, env: { NODE_EXTRA_CA_CERTS: recovered.file },
    loadedExtra: () => [ca, other], stderr: () => {},
    acquire: async () => { throw new Error("unrecoverable U imported") },
  })
  expect(refused).toMatchObject({ action: "refuse", code: "trust-user-extras-unrecoverable" })
})

test.each([[[], 1500], [["host", "ensure"], 1500], [["-p"], 20_000]] as const)(
  "launch %j bounds acquisition at %i milliseconds and keeps fallback closure",
  async (args, expected) => {
    const dir = await directory()
    let budget = 0
    let marker: EngineTrustMarker | undefined
    await runTrustStage({
      args, directory: dir, env: {}, loadedExtra: () => [],
      acquire: async (options) => { budget = options.deadlineMs; return { certificates: [], fallbackReason: "helper-timeout", codes: [] } },
      exec: async (_file, _argv, env) => { marker = trustMarker(env) },
    })
    expect(budget).toBe(expected)
    const written = required(marker, "fallback marker")
    expect(written.automatic).toBe("fallback")
    expect(written.defaults).not.toBeNull()
    expect(await readFile(required(written.defaults, "fallback closure").file, "utf8")).toBe("")
  },
)

test.each(["native-child", "shell-child"] as const)("compiled %s preserves the native versus restored environment boundary", async (mode) => {
  const dir = await directory()
  let output: Awaited<ReturnType<typeof child>> | undefined
  await runTrustStage({
    args: ["-p"], env: cleanEnv(), directory: dir, loadedExtra: () => [],
    acquire: async () => ({ certificates: [ca], fallbackReason: null, codes: [] }),
    exec: async (_file, _argv, env) => { output = await child(env, dir, mode) },
  })
  const compiled = required(output, "compiled child output")
  expect(compiled.code).toBe(0)
  const nested = JSON.parse(compiled.stdout).nested
  expect(nested.code).toBe(0)
  const log = await records(dir)
  expect(log.filter((record) => record.action === "import-exec")).toHaveLength(mode === "native-child" ? 1 : 2)
  expect(log.filter((record) => record.action === "refuse")).toEqual([])
  expect(log.flatMap((record) => record.codes).filter((entry) => entry.code === "trust-marker-foreign")).toEqual([])
})

test.each([null, "helper-missing"] as const)("native TLS uses only the selected generation, including fallback %s", async (fallbackReason) => {
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    tls: { cert: leaf, key: await readFile(join(root, "leaf.key"), "utf8") },
    fetch(request, server) {
      if (server.upgrade(request)) return
      return new Response("synthetic TLS")
    },
    websocket: { message() {} },
  })
  try {
    const dir = await directory()
    let output: Awaited<ReturnType<typeof child>> | undefined
    await runTrustStage({
      args: ["-p"], env: cleanEnv(), directory: dir, loadedExtra: () => [],
      acquire: async () => ({ certificates: [ca], fallbackReason, codes: [] }),
      exec: async (_file, _argv, env) => { output = await child(env, dir, `https://127.0.0.1:${server.port}`) },
    })
    const compiled = required(output, "compiled child output")
    expect(compiled.code).toBe(0)
    expect(JSON.parse(compiled.stdout).tls).toEqual({
      native: fallbackReason === null, https: fallbackReason === null, websocket: fallbackReason === null,
    })
  } finally { await server.stop(true) }
})

test.each(["missing", "directory"] as const)("an addressed generation replaced with %s never promotes cached automatic roots to U", async (replacement) => {
  const dir = await directory()
  await launch(dir, cleanEnv(), async (env) => {
    delete env.SENPI_ENGINE_TRUST_HOP
    const generation = required(env.NODE_EXTRA_CA_CERTS, "NODE_EXTRA_CA_CERTS")
    await rm(generation)
    if (replacement === "directory") await mkdir(generation)
    const result = await runTrustStage({
      args: [], env, directory: dir, loadedExtra: () => [ca], stderr: () => {},
      acquire: async () => { throw new Error("unrecoverable generation acquired") },
    })
    expect(result).toMatchObject({ action: "refuse", code: "trust-user-extras-unrecoverable" })
  })
})

test("a damaged closure relocates without following or trusting the old contents", async () => {
  const dir = await directory()
  await launch(dir)
  await writeFile(join(dir, "defaults/empty.d/injected"), ca)
  let relocated: string | undefined
  try {
    await runTrustStage({
      args: [], env: {}, directory: dir, loadedExtra: () => [],
      acquire: async () => ({ certificates: [], fallbackReason: "helper-missing", codes: [] }),
      exec: async (_file, _argv, env) => {
        const marker = trustMarker(env)
        relocated = join(marker.file, "..")
        const defaults = required(marker.defaults, "relocated closure")
        expect(defaults.dir).not.toBe(join(dir, "defaults/empty.d"))
        expect(await readdir(defaults.dir)).toEqual([])
      },
    })
  } finally { if (relocated) await rm(relocated, { recursive: true, force: true }) }
})

test.each([false, true])("U is Bun's actual native parse, malformed sibling = %s", async (malformed) => {
  const dir = await directory()
  const incoming = join(dir, "incoming.pem")
  await writeFile(incoming, other + (malformed ? "\n-----BEGIN CERTIFICATE-----\nMAA=\n-----END CERTIFICATE-----\n" : ""))
  const output = await child({ ...cleanEnv(), NODE_EXTRA_CA_CERTS: incoming }, dir)
  expect(output.code).toBe(0)
  const marker = JSON.parse(output.stdout).marker as EngineTrustMarker
  expect(marker.user === null).toBe(malformed)
  expect((await readFile(marker.file, "utf8")).includes(other.trim())).toBe(!malformed)
})

test("Windows case forms are read at arrival and canonicalized only by senpi's builder", async () => {
  const dir = await directory()
  const incoming = join(dir, "incoming.pem")
  await writeFile(incoming, other)
  await runTrustStage({
    args: [], directory: dir, platform: "win32",
    env: { node_extra_ca_certs: incoming, node_use_system_ca: "1", ssl_cert_file: "ambient",
      T3CODE_OMO_AGENT_DIR: "server", Senpi_Engine_Trust: "{}" },
    loadedExtra: () => [other],
    acquire: async () => ({ certificates: [], fallbackReason: null, codes: [] }),
    exec: async (_file, _argv, env) => {
      for (const name of ["NODE_EXTRA_CA_CERTS", "SENPI_ENGINE_TRUST", "SENPI_ENGINE_TRUST_HOP", "SSL_CERT_FILE", "SSL_CERT_DIR"]) {
        expect(Object.keys(env).filter((key) => key.toUpperCase() === name)).toEqual([name])
      }
      expect(Object.keys(env).filter((key) => key.toUpperCase() === "NODE_USE_SYSTEM_CA")).toEqual([])
      const marker = trustMarker(env)
      expect(marker.restore.NODE_EXTRA_CA_CERTS).toBe(incoming)
      expect(marker.restore.NODE_USE_SYSTEM_CA).toBe("1")
      expect(await readFile(marker.file, "utf8")).toContain(other.trim())
    },
  })
})

test.each([["--help", 0], ["--version", 0], ["-p", 78]] as const)(
  "compile-entry validation keeps %s at exit %i without importing a store", async (arg, expected) => {
    const home = await directory()
    const proc = Bun.spawn([process.execPath, join(import.meta.dir, "../compile-entry.ts"), arg], {
      env: { ...cleanEnv(), HOME: home, OMO_EXTRA_CA_CERTIFICATES: "invalid synthetic input" },
      stdout: "pipe", stderr: "pipe", timeout: 20_000,
    })
    const [code, _stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
    expect(code).toBe(expected)
    expect(stderr).toContain("OMO_EXTRA_CA_CERTIFICATES")
    expect(await stat(join(home, ".omo/engine-trust")).catch(() => null)).toBeNull()
  },
)
