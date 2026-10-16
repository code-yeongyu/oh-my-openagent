import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { spawn, spawnSync } from "node:child_process"
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:https"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  ExtraCaCertificatesError,
  installEngineCaTrust,
  MAX_EXTRA_CA_BYTES,
  parseExtraCaCertificates,
} from "../compiled-ca-trust"

const fixtures = join(import.meta.dir, "fixtures", "ca-trust")
const withoutCaVariables = (env: NodeJS.ProcessEnv) => {
  const { NODE_EXTRA_CA_CERTS: _extra, NODE_USE_SYSTEM_CA: _system, OMO_EXTRA_CA_CERTIFICATES: _omo, ...rest } = env
  return rest
}
const fixture = (name: string) => readFileSync(join(fixtures, name), "utf8")

describe("parseExtraCaCertificates", () => {
  test("#given one CA PEM twice with CRLF #then returns it once", () => {
    const ca = fixture("ca.pem")
    expect(parseExtraCaCertificates(`${ca}\r\n${ca.replaceAll("\n", "\r\n")}`)).toHaveLength(1)
  })

  test("#given LF, CRLF, CR-CR-LF and mixed endings #then every form parses to the identical certificate set", () => {
    const ca = fixture("ca.pem")
    const lf = parseExtraCaCertificates(ca)
    const forms = [
      ca.replaceAll("\n", "\r\n"),
      ca.replaceAll("\n", "\r\r\n"),
      ca.split("\n").map((line, index) => line + (index % 2 === 0 ? "\r\n" : "\n")).join(""),
    ]
    for (const form of forms) expect(parseExtraCaCertificates(form)).toEqual(lf)
  })

  test.each([
    ["plain text", "hello"],
    ["a private key", fixture("leaf.key")],
    ["a server certificate", fixture("leaf.pem")],
    ["a CA:FALSE certificate", fixture("not-ca.pem")],
    ["text around a certificate", `junk\n${fixture("ca.pem")}`],
    ["an oversized value", "a".repeat(MAX_EXTRA_CA_BYTES + 1)],
  ])("#given %s #then fails closed", (_name, value) => {
    expect(() => parseExtraCaCertificates(value)).toThrow(ExtraCaCertificatesError)
  })
})

describe("installEngineCaTrust", () => {
  test("#given an invalid OMO_EXTRA_CA_CERTIFICATES #then throws before touching trust", () => {
    let touched = false
    const tls = {
      getCACertificates: () => [],
      setDefaultCACertificates: () => {
        touched = true
      },
    }
    expect(() => installEngineCaTrust({ OMO_EXTRA_CA_CERTIFICATES: "junk" }, tls)).toThrow(ExtraCaCertificatesError)
    expect(touched).toBe(false)
  })

  // Diagnostics contract (#10236): the report must show what NODE_EXTRA_CA_CERTS contributed.
  test("#given NODE_EXTRA_CA_CERTS loaded one CA #then the report counts it as ambient and installs it", () => {
    let installed: string[] = []
    const tls = {
      getCACertificates: (kind: string) => ({ bundled: ["B"], system: ["S"], extra: ["A"] })[kind] ?? [],
      setDefaultCACertificates: (certificates: string[]) => {
        installed = certificates
      },
    }
    expect(installEngineCaTrust({}, tls as never)).toEqual({ installed: true, bundled: 1, system: 1, ambient: 1, extra: 0 })
    expect(installed).toEqual(["B", "S", "A"])
  })

  test("#given a runtime without the trust APIs #then leaves it alone and still sets NODE_USE_SYSTEM_CA", () => {
    const env: NodeJS.ProcessEnv = {}
    expect(installEngineCaTrust(env, {} as never).installed).toBe(false)
    expect(env.NODE_USE_SYSTEM_CA).toBe("1")
  })
})

// The bug is specific to `bun build --compile`: a compiled binary ignores --use-system-ca, so this
// compiles a real probe and connects to a local TLS server whose leaf chains to a private CA.
describe("engine entry", () => {
  const entry = join(import.meta.dir, "..", "compile-entry.ts")
  const runEntry = (args: readonly string[], home?: string) =>
    spawnSync(process.execPath, [entry, ...args], {
      env: { ...process.env, ...(home === undefined ? {} : { HOME: home }), OMO_EXTRA_CA_CERTIFICATES: "junk" },
      encoding: "utf8",
    })

  // Security contract (#10236): a bad trust value fails closed for every argv except the exact
  // `--version` and `--help`, so no engine code (extension loading, package installs) runs under it.
  test.each([
    { args: ["doctor"] },
    { args: ["-h"] },
    { args: ["-v"] },
    { args: ["--help", "x"] },
    { args: ["--version", "doctor"] },
    { args: ["--version", "--help"] },
    { args: ["setup", "--help"] },
  ].map((row) => [row.args.join(" "), row] as const))("#given an invalid OMO_EXTRA_CA_CERTIFICATES #then `%s` refuses to start", (_argv, { args }) => {
    const run = runEntry(args)
    expect({ status: run.status, named: run.stderr.includes("OMO_EXTRA_CA_CERTIFICATES") }).toEqual({ status: 78, named: true })
  }, 60_000)

  // The answer comes from static local data before anything else runs: an empty HOME stays empty,
  // where the engine's help path would run migrations and write its state there.
  test.each([
    { args: ["--version"], output: /^omo \S+ \(engine: / },
    { args: ["--help"], output: /^Usage: omo / },
  ].map((row) => [row.args.join(" "), row] as const))("#given an invalid OMO_EXTRA_CA_CERTIFICATES #then `%s` answers without starting anything", (_argv, { args, output }) => {
    const home = mkdtempSync(join(tmpdir(), "omo-trust-home-"))
    try {
      const run = runEntry(args, home)
      expect({ status: run.status, warned: run.stderr.includes("OMO_EXTRA_CA_CERTIFICATES") }).toEqual({ status: 0, warned: true })
      expect(run.stdout).toMatch(output)
      expect(readdirSync(home)).toEqual([])
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  }, 60_000)
})

describe("compiled binary", () => {
  let dir = ""
  let server: Server
  let port = 0

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "omo-ca-trust-"))
    const entry = join(dir, "probe.ts")
    writeFileSync(
      entry,
      `import { installEngineCaTrust } from ${JSON.stringify(join(import.meta.dir, "..", "compiled-ca-trust.ts"))}
import { request } from "node:https"
import { spawnSync } from "node:child_process"
const [mode, port] = process.argv.slice(2)
if (mode === "install") {
  try { installEngineCaTrust() } catch (error) { console.log("refused " + (error as Error).name); process.exit(3) }
}
if (mode === "daemon") {
  installEngineCaTrust()
  const child = spawnSync(process.execPath, ["install", port], { env: process.env, encoding: "utf8" })
  console.log(child.stdout.trim()); process.exit(0)
}
if (mode === "bun-be-bun-tls") {
  installEngineCaTrust()
  const code = 'require("node:https").get("https://localhost:' + port + '/",r=>{r.resume();console.log("ok "+r.statusCode)}).on("error",e=>console.log("error "+e.code))'
  const child = spawnSync(process.execPath, ["-e", code], { env: { ...process.env, BUN_BE_BUN: "1" }, encoding: "utf8" })
  console.log(child.stdout.trim()); process.exit(0)
}
if (mode === "bun-be-bun") {
  installEngineCaTrust()
  const code = 'const t=require("node:tls");console.log(t.getCACertificates("default").length-t.getCACertificates("bundled").length,t.getCACertificates("system").length)'
  const child = spawnSync(process.execPath, ["-e", code], { env: { ...process.env, BUN_BE_BUN: "1" }, encoding: "utf8" })
  console.log(child.stdout.trim()); process.exit(0)
}
request("https://localhost:" + port + "/", (r) => { r.resume(); console.log("ok " + r.statusCode) })
  .on("error", (e: NodeJS.ErrnoException) => console.log("error " + e.code)).end()
`,
    )
    const built = spawnSync(process.execPath, ["build", "--compile", entry, "--outfile", join(dir, "probe")], { encoding: "utf8" })
    if (built.status !== 0) throw new Error(built.stderr)
    server = createServer({ key: fixture("leaf.key"), cert: fixture("leaf.pem") }, (_req, res) => res.end("ok"))
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    port = (server.address() as AddressInfo).port
  })
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(dir, { recursive: true, force: true })
  })

  const probe = (mode: string, env: NodeJS.ProcessEnv) =>
    new Promise<string>((resolve) => {
      const child = spawn(join(dir, "probe"), [mode, String(port)], {
        env: { ...withoutCaVariables(process.env), ...env },
      })
      let out = ""
      child.stdout.on("data", (chunk) => (out += chunk))
      child.on("close", () => resolve(out.trim()))
    })

  test("#given the private CA only in OMO_EXTRA_CA_CERTIFICATES #then a plain compiled binary rejects it", async () => {
    expect(await probe("none", { OMO_EXTRA_CA_CERTIFICATES: fixture("ca.pem") })).toBe("error UNABLE_TO_VERIFY_LEAF_SIGNATURE")
  })

  test("#given the private CA in OMO_EXTRA_CA_CERTIFICATES #then the engine trusts it after install", async () => {
    expect(await probe("install", { OMO_EXTRA_CA_CERTIFICATES: fixture("ca.pem") })).toBe("ok 200")
  })

  // A standalone CLI user behind a corporate proxy sets NODE_EXTRA_CA_CERTS; the desktop strips it
  // from the engines it starts (omo-desktop-app#2766), so honoring it here only serves standalone runs.
  test("#given the private CA only in an ambient NODE_EXTRA_CA_CERTS #then the engine and its BUN_BE_BUN child honor it", async () => {
    const caFile = join(dir, "ambient-ca.pem")
    writeFileSync(caFile, fixture("ca.pem"))
    expect(await probe("install", { NODE_EXTRA_CA_CERTS: caFile })).toBe("ok 200")
    expect(await probe("bun-be-bun-tls", { NODE_EXTRA_CA_CERTS: caFile })).toBe("ok 200")
  })

  test("#given an invalid OMO_EXTRA_CA_CERTIFICATES #then the compiled engine refuses to start", async () => {
    expect(await probe("install", { OMO_EXTRA_CA_CERTIFICATES: fixture("not-ca.pem") })).toBe("refused ExtraCaCertificatesError")
  })

  // The host daemon is a grandchild of the process the server spawned: it inherits the variable, not
  // a descriptor, and re-runs this entry, so it must trust the same extra CA.
  test("#given the binary re-run as a grandchild #then it trusts the same extra CA", async () => {
    expect(await probe("daemon", { OMO_EXTRA_CA_CERTIFICATES: fixture("ca.pem") })).toBe("ok 200")
  })

  // A BUN_BE_BUN child never runs this entry; NODE_USE_SYSTEM_CA is how it reads the OS store.
  test("#given a BUN_BE_BUN child #then it trusts the OS store", async () => {
    const [added, system] = (await probe("bun-be-bun", {})).split(" ").map(Number)
    expect(added).toBe(system ?? -1)
  })
})
