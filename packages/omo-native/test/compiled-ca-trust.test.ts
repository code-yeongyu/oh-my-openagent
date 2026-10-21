import { afterAll, beforeAll, describe, expect, onTestFinished, test } from "bun:test"
import { spawn, spawnSync } from "node:child_process"
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:https"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  engineCaTrustReady,
  ExtraCaCertificatesError,
  installEngineCaTrust,
  loadSystemStoreOffThread,
  selfSpawnTrustEnv,
  SYSTEM_STORE_STATE_ENV,
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
  test("#given NODE_EXTRA_CA_CERTS loaded one CA #then the report counts it as ambient and installs it", async () => {
    let installed: string[] = []
    const tls = {
      getCACertificates: (kind: string) => ({ bundled: ["B"], system: ["S"], extra: ["A"] })[kind] ?? [],
      setDefaultCACertificates: (certificates: string[]) => {
        installed = certificates
      },
    }
    const loadSystem = async () => tls.getCACertificates("system")
    expect(installEngineCaTrust({}, tls as never, { loadSystem })).toEqual({ installed: true, bundled: 1, system: 0, ambient: 1, extra: 0 })
    expect(installed).toEqual(["B", "A"])
    expect(await engineCaTrustReady(1_000)).toBe("loaded")
    expect(installed).toEqual(["B", "A", "S"])
  })

  test("#given a runtime without the trust APIs #then leaves it alone and still sets NODE_USE_SYSTEM_CA", () => {
    const env: NodeJS.ProcessEnv = {}
    expect(installEngineCaTrust(env, {} as never).installed).toBe(false)
    expect(env.NODE_USE_SYSTEM_CA).toBe("1")
  })
})

// #10760: on some Macs the security server never answers getCACertificates("system"); that call
// used to run synchronously at the top of every start and hung `omo --version` forever.
describe("the OS store never blocks startup (#10760)", () => {
  const fakeTls = () => {
    const calls: string[] = []
    const installs: string[][] = []
    return {
      calls,
      installs,
      tls: {
        getCACertificates: (kind: string) => {
          calls.push(kind)
          return ({ bundled: ["B"], extra: ["A"], system: ["S"] } as Record<string, string[]>)[kind] ?? []
        },
        setDefaultCACertificates: (certificates: string[]) => {
          installs.push(certificates)
        },
      },
    }
  }

  test("#given --version or --help #then the OS store is never read", async () => {
    const { calls, tls } = fakeTls()
    let loads = 0
    installEngineCaTrust({}, tls as never, { skipSystem: true, loadSystem: async () => (loads++, ["S"]) })
    expect(await engineCaTrustReady(50)).toBe("skipped")
    expect({ calls: calls.includes("system"), loads }).toEqual({ calls: false, loads: 0 })
  })

  test("#given a start #then install returns at once, without reading the OS store on the calling thread", () => {
    const { calls, installs, tls } = fakeTls()
    const env: NodeJS.ProcessEnv = {}
    installEngineCaTrust(env, tls as never, { loadSystem: () => new Promise<string[]>(() => {}) })
    expect(calls).not.toContain("system")
    expect(installs).toEqual([["B", "A"]])
    expect(env.NODE_USE_SYSTEM_CA).toBeUndefined()
  })

  test("#given an OS store that never answers #then the first request proceeds after the bound with bundled + extras, warned once", async () => {
    const { installs, tls } = fakeTls()
    const warnings: string[] = []
    installEngineCaTrust({}, tls as never, { loadSystem: () => new Promise<string[]>(() => {}) })
    const started = performance.now()
    expect(await engineCaTrustReady(50, (message) => warnings.push(message))).toBe("timed-out")
    expect(performance.now() - started).toBeLessThan(1_000)
    expect(await engineCaTrustReady(50, (message) => warnings.push(message))).toBe("timed-out")
    expect(installs).toEqual([["B", "A"]])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("system certificate store did not answer")
  })

  test("#given a slow store that does answer #then later requests trust a system-only CA and children read the store", async () => {
    const { installs, tls } = fakeTls()
    const env: NodeJS.ProcessEnv = {}
    let answer: (certificates: string[]) => void = () => {}
    installEngineCaTrust(env, tls as never, { loadSystem: () => new Promise<string[]>((resolve) => (answer = resolve)) })
    expect(await engineCaTrustReady(20, () => {})).toBe("timed-out")
    answer(["S"])
    expect(await engineCaTrustReady(1_000)).toBe("loaded")
    expect(installs.at(-1)).toEqual(["B", "A", "S"])
    expect(env.NODE_USE_SYSTEM_CA).toBe("1")
  })

  // Regression guard for #10219's users: a company proxy whose CA lives only in the OS store.
  test("#given the OS-store worker never returns #then the process still exits promptly", () => {
    const dir = mkdtempSync(join(tmpdir(), "omo-ca-exit-"))
    try {
      const script = join(dir, "exit.ts")
      writeFileSync(script, `import { loadSystemStoreOffThread } from ${JSON.stringify(join(import.meta.dir, "..", "compiled-ca-trust.ts"))}
void loadSystemStoreOffThread("for (;;) {}")
console.log("done")
`)
      const started = performance.now()
      const run = spawnSync(process.execPath, [script], { encoding: "utf8", timeout: 10_000 })
      expect({ status: run.status, out: run.stdout.trim() }).toEqual({ status: 0, out: "done" })
      expect(performance.now() - started).toBeLessThan(5_000)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 15_000)
})

// The bug is specific to `bun build --compile`: a compiled binary ignores --use-system-ca, so this
// compiles a real probe and connects to a local TLS server whose leaf chains to a private CA.
// #10771 review: a child that re-runs the entry inherits the parent's RESOLVED store state, so it
// never reads the OS store again and the slow-store warning prints once per user command.
describe("children inherit the resolved store state (#10771)", () => {
  const CHILD = { parentPid: process.pid, pid: 424_242 }
  const counting = () => {
    const installs: string[][] = []
    let reads = 0
    return {
      installs,
      reads: () => reads,
      tls: {
        getCACertificates: (kind: string) => (kind === "bundled" ? ["B"] : []),
        setDefaultCACertificates: (certificates: string[]) => {
          installs.push(certificates)
        },
      },
      loadSystem: (system: readonly string[] | "never") => () => {
        reads += 1
        return system === "never" ? new Promise<readonly string[]>(() => {}) : Promise.resolve(system)
      },
    }
  }
  const caPem = () => readFileSync(join(fixtures, "ca.pem"), "utf8")
  const tempDir = (prefix: string) => {
    const dir = mkdtempSync(join(tmpdir(), prefix))
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
    return dir
  }
  async function loadedParent(handoffDir: string) {
    const parent = counting()
    const env: NodeJS.ProcessEnv = {}
    installEngineCaTrust(env, parent.tls as never, { loadSystem: parent.loadSystem([caPem()]), handoffDir })
    expect(await engineCaTrustReady(1_000)).toBe("loaded")
    return env
  }

  test("#given the parent's store answered #then a self-spawn installs the cached set without asking the OS", async () => {
    const handoffDir = tempDir("omo-ca-handoff-")
    const parentEnv = await loadedParent(handoffDir)
    // Never in the parent's own environment: a tool shell it starts inherits nothing.
    expect(parentEnv[SYSTEM_STORE_STATE_ENV]).toBeUndefined()
    const childEnv = selfSpawnTrustEnv({}) as NodeJS.ProcessEnv
    expect(childEnv[SYSTEM_STORE_STATE_ENV]).toBe(`${process.pid}:loaded`)

    const child = counting()
    installEngineCaTrust(childEnv, child.tls as never, { ...CHILD, loadSystem: child.loadSystem("never"), handoffDir })
    expect(await engineCaTrustReady(50, () => {})).toBe("loaded")
    expect(child.reads()).toBe(0)
    expect(child.installs.at(-1)?.map((pem) => pem.trim())).toEqual(["B", caPem().trim()])
  })

  test.each([
    ["a hostile path (the file is a symlink elsewhere)", (dir: string) => {
      const elsewhere = join(tempDir("omo-ca-elsewhere-"), "evil.pem")
      writeFileSync(elsewhere, caPem(), { mode: 0o600 })
      rmSync(join(dir, "system-ca.pem"))
      symlinkSync(elsewhere, join(dir, "system-ca.pem"))
      return {}
    }],
    ["a file another user owns", () => ({ ownerUid: (process.getuid?.() ?? 0) + 1 })],
    ["a group-readable file", (dir: string) => {
      chmodSync(join(dir, "system-ca.pem"), 0o640)
      return {}
    }],
    ["a file holding a non-CA certificate", (dir: string) => {
      writeFileSync(join(dir, "system-ca.pem"), readFileSync(join(fixtures, "leaf.pem"), "utf8"), { mode: 0o600 })
      return {}
    }],
  ] as const)("#given %s #then the child ignores the hint and reads the OS store itself", async (_name, tamper) => {
    if (process.platform === "win32") return
    const handoffDir = tempDir("omo-ca-handoff-")
    await loadedParent(handoffDir)
    const childEnv = selfSpawnTrustEnv({}) as NodeJS.ProcessEnv
    const extra = tamper(handoffDir)
    const child = counting()
    installEngineCaTrust(childEnv, child.tls as never, { ...CHILD, ...extra, loadSystem: child.loadSystem(["S"]), handoffDir })
    expect(await engineCaTrustReady(1_000)).toBe("loaded")
    expect(child.reads()).toBe(1)
    expect(child.installs.at(-1)).toEqual(["B", "S"])
  })

  test("#given a hint from a process that is not this one's parent #then it is ignored", async () => {
    const child = counting()
    installEngineCaTrust({ [SYSTEM_STORE_STATE_ENV]: "1:unanswered" }, child.tls as never, { ...CHILD, loadSystem: child.loadSystem(["S"]) })
    expect(await engineCaTrustReady(1_000)).toBe("loaded")
    expect(child.reads()).toBe(1)
  })

  test.each(["unanswered", "failed"] as const)("#given the parent's store %s #then a self-spawn neither reads nor warns", async (outcome) => {
    const parent = counting()
    const parentEnv: NodeJS.ProcessEnv = {}
    installEngineCaTrust(parentEnv, parent.tls as never, {
      loadSystem: outcome === "failed" ? () => Promise.reject(new Error("store refused")) : parent.loadSystem("never"),
      warn: () => {},
    })
    expect(await engineCaTrustReady(30, () => {})).toBe(outcome === "failed" ? "failed" : "timed-out")
    expect(parentEnv[SYSTEM_STORE_STATE_ENV]).toBeUndefined()

    const child = counting()
    const warnings: string[] = []
    installEngineCaTrust(selfSpawnTrustEnv({}) as NodeJS.ProcessEnv, child.tls as never, { ...CHILD, loadSystem: child.loadSystem("never"), warn: (m) => warnings.push(m) })
    expect(await engineCaTrustReady(1_000, (message) => warnings.push(message))).toBe("skipped")
    expect({ reads: child.reads(), warnings }).toEqual({ reads: 0, warnings: [] })
  })

  // The lead's RED: a blocking store, a command that self-spawns twice, and a tool shell it starts.
  test("#given a blocking store #then two self-spawns skip it, one warning prints, and a tool shell does not inherit it", () => {
    const dir = tempDir("omo-ca-spawn-")
    const script = join(dir, "entry.ts")
    writeFileSync(script, `import { spawnSync } from "node:child_process"
import { engineCaTrustReady, installEngineCaTrust, selfSpawnTrustEnv } from ${JSON.stringify(join(import.meta.dir, "..", "compiled-ca-trust.ts"))}
const role = process.argv[2]
installEngineCaTrust(process.env, undefined, { loadSystem: () => { process.stdout.write("READ " + role + "\\n"); return new Promise(() => {}) } })
process.stdout.write("OUTCOME " + role + " " + (await engineCaTrustReady(400)) + "\\n")
const run = (name, env) => process.stdout.write(spawnSync(process.execPath, [import.meta.path, name], { env, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).stdout)
if (role === "parent") {
  run("child1", selfSpawnTrustEnv(process.env))
  run("child2", selfSpawnTrustEnv(process.env))
  run("toolshell", process.env)
}
process.exit(0)
`)
    const run = spawnSync(process.execPath, [script, "parent"], { env: withoutCaVariables(process.env), encoding: "utf8", timeout: 30_000 })
    const warnings = run.stderr.split("\n").filter((line) => line.includes("did not answer within"))
    expect({ status: run.status, lines: run.stdout.trim().split("\n"), warnings: warnings.length }).toEqual({
      status: 0,
      lines: [
        "READ parent",
        "OUTCOME parent timed-out",
        "OUTCOME child1 skipped",
        "OUTCOME child2 skipped",
        // A process started with the parent's plain environment knows nothing and reads the store itself.
        "READ toolshell",
        "OUTCOME toolshell timed-out",
      ],
      // The parent's, and the tool shell's own: the self-spawns add none.
      warnings: 2,
    })
  }, 40_000)
})

describe("the fast path's local-only argv never reads the OS store (#10771)", () => {
  test.each([
    [["--version"], true],
    [["-v"], true],
    [["--help"], false],
    [["-h"], false],
    [["update"], false],
    [["--version", "doctor"], false],
    [["doctor"], false],
  ] as const)("%p -> %p", async (args, expected) => {
    const { answeredFromLocalData } = await import("../compile-entry-fast-path")
    expect(answeredFromLocalData(args)).toBe(expected)
  })
})

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
  let caFile = ""

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "omo-ca-trust-"))
    const entry = join(dir, "probe.ts")
    writeFileSync(
      entry,
      `import { engineCaTrustReady, installEngineCaTrust } from ${JSON.stringify(join(import.meta.dir, "..", "compiled-ca-trust.ts"))}
import { request } from "node:https"
import { spawnSync } from "node:child_process"
const [mode, port] = process.argv.slice(2)
if (mode === "late") {
  // The store answers 300 ms after start with the only CA that signs the test server: the
  // "company CA lives only in the OS store" case. compile-entry awaits the store before any engine code.
  const ca = require("node:fs").readFileSync(process.argv[5], "utf8")
  installEngineCaTrust(process.env, undefined, { loadSystem: () => new Promise((resolve) => setTimeout(() => resolve([ca]), 300)) })
  await engineCaTrustReady()
  await new Promise<void>((done) => request("https://localhost:" + port + "/", (r) => { r.resume(); console.log("ok " + r.statusCode); done() }).on("error", (e: NodeJS.ErrnoException) => { console.log("error " + e.code); done() }).end())
  process.exit(0)
}
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
  await engineCaTrustReady()
  const code = 'require("node:https").get("https://localhost:' + port + '/",r=>{r.resume();console.log("ok "+r.statusCode)}).on("error",e=>console.log("error "+e.code))'
  const child = spawnSync(process.execPath, ["-e", code], { env: { ...process.env, BUN_BE_BUN: "1" }, encoding: "utf8" })
  console.log(child.stdout.trim()); process.exit(0)
}
if (mode === "bun-be-bun") {
  installEngineCaTrust()
  await engineCaTrustReady()
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
    caFile = join(dir, "store-only-ca.pem")
    writeFileSync(caFile, fixture("ca.pem"))
  })
  afterAll(async () => {
    // A probe's keep-alive socket would hold close() open until it idles out; end every connection first.
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(dir, { recursive: true, force: true })
  })

  const probe = (mode: string, env: NodeJS.ProcessEnv, extra: readonly string[] = []) =>
    new Promise<string>((resolve) => {
      const child = spawn(join(dir, "probe"), [mode, String(port), ...extra], {
        env: { ...withoutCaVariables(process.env), ...env },
      })
      let out = ""
      child.stdout.on("data", (chunk) => (out += chunk))
      child.on("close", () => resolve(out.trim()))
    })

  // #10760: a CA that lives only in the OS store and answers late is trusted by the first node:https
  // request, because startup waits for the store at the one choke point. (Bun's fetch and WebSocket
  // never read the runtime trust set; see compiled-ca-trust.ts engineCaTrustReady.)
  test("#given the store-only CA arrives late #then a node:https request made right after start trusts it", async () => {
    expect(await probe("late", {}, ["https", caFile])).toBe("ok 200")
  }, 30_000)

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
