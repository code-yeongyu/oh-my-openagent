import { afterEach, describe, expect, it, spyOn } from "bun:test"
import * as os from "node:os"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir, userInfo } from "node:os"
import { basename, join } from "node:path"

import { automatedRunReason, isOmoNativeTelemetryEnabled } from "./omo-native-session"
import { getOmoNativeAttribution } from "./product-identity"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const ID_A = "a".repeat(64)
const ID_B = "b".repeat(64)
const homedirOf = () => userInfo().homedir
const sha = (id: string) => createHash("sha256").update(id).digest("hex")

function home(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "omo-identity-")))
  roots.push(root)
  return root
}

const canonicalFile = (homeDir: string) => join(homeDir, ".omo", "agent", "omo-senpi", "omo-native", "install-id")

function writeId(path: string, id: string): void {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, `${id}\n`, { mode: 0o600 })
}

function flatLayout(homeDir: string): void {
  mkdirSync(join(homeDir, ".omo"), { recursive: true })
  writeFileSync(join(homeDir, ".omo", "settings.json"), "{}")
}

const attribution = (env: Record<string, string>) => getOmoNativeAttribution({ env })

describe("one anonymous install id per user, independent of the agent home (#10934)", () => {
  it("#given the Desktop's canonical id and a CLI resolving the flat ~/.omo home #then both report ONE install_hash", () => {
    const h = home()
    flatLayout(h)
    writeId(canonicalFile(h), ID_A)
    expect(attribution({ HOME: h, USERPROFILE: h }).install_hash).toBe(sha(ID_A))
  })

  it("#given an agent-dir override (an orchestrator's isolated agent dir per run) #then the id stays the user's canonical id", () => {
    const h = home()
    writeId(canonicalFile(h), ID_A)
    const isolated = join(h, "runs", "run-1", "agent")
    expect(attribution({ HOME: h, USERPROFILE: h, OMO_CODING_AGENT_DIR: isolated }).install_hash).toBe(sha(ID_A))
    expect(attribution({ HOME: h, USERPROFILE: h, SENPI_CODING_AGENT_DIR: join(h, "runs", "run-2") }).install_hash).toBe(sha(ID_A))
  })

  it("#given only a legacy per-agent-home id #then it is adopted once into the canonical file (0600) and kept", () => {
    const h = home()
    flatLayout(h)
    writeId(join(h, ".omo", "omo-senpi", "omo-native", "install-id"), ID_B)
    expect(attribution({ HOME: h, USERPROFILE: h }).install_hash).toBe(sha(ID_B))
    expect(readFileSync(canonicalFile(h), "utf8").trim()).toBe(ID_B)
    // Windows has no POSIX permission bits (stat reports 0o666): the 0600 mode is asserted only where it exists.
    if (process.platform !== "win32") expect(statSync(canonicalFile(h)).mode & 0o777).toBe(0o600)
  })

  it("#given a flat-layout legacy id and the FIRST post-upgrade run under an orchestrator's agent-dir override #then the user's real legacy id is adopted, not a fresh one", () => {
    const h = home()
    flatLayout(h)
    writeId(join(h, ".omo", "omo-senpi", "omo-native", "install-id"), ID_B)
    expect(attribution({ HOME: h, USERPROFILE: h, OMO_CODING_AGENT_DIR: join(h, "runs", "fresh", "agent") }).install_hash).toBe(sha(ID_B))
    expect(attribution({ HOME: h, USERPROFILE: h }).install_hash).toBe(sha(ID_B))
  })

  it("#given no id anywhere #then one is created at the canonical path and every agent home reads it", () => {
    const h = home()
    const first = attribution({ HOME: h, USERPROFILE: h, OMO_CODING_AGENT_DIR: join(h, "x") }).install_hash
    expect(attribution({ HOME: h, USERPROFILE: h }).install_hash).toBe(first)
    expect(sha(readFileSync(canonicalFile(h), "utf8").trim())).toBe(first)
  })

  it("#given OMO_NATIVE_INSTALL_ID (the Desktop pinning a remote runtime) #then it still wins", () => {
    const h = home()
    writeId(canonicalFile(h), ID_A)
    expect(attribution({ HOME: h, USERPROFILE: h, OMO_NATIVE_INSTALL_ID: ID_B }).install_hash).toBe(sha(ID_B))
  })
})

describe("telemetry is off by default for automated runs that cannot hold a stable id (#10934)", () => {
  const realHome = { HOME: "/Users/someone", USERPROFILE: "/Users/someone" }
  // A real profile, simulated (identity realpath) so the fixture does not depend on the machine's own home.
  const realDeps = { platform: "darwin" as const, realpath: (p: string) => p, tmpdir: () => "/var/folders/ab/T", posixTempRoots: [] }

  it("#given CI, a test runner, or a HOME inside the OS temp dir #then the run is automated", () => {
    expect(automatedRunReason({ ...realHome, CI: "1" })).toBe("ci")
    expect(automatedRunReason({ ...realHome, CI: "false" }, realDeps)).toBeUndefined()
    expect(automatedRunReason({ ...realHome, NODE_ENV: "test" })).toBe("test_runner")
    expect(automatedRunReason({ ...realHome, VITEST: "true" })).toBe("test_runner")
    expect(automatedRunReason({ ...realHome, JEST_WORKER_ID: "1" })).toBe("test_runner")
    const h = home()
    // Diagnostic for the Windows CI run (#10935): the temp-dir comparison's inputs, as the OS reports them.
    if (process.platform === "win32") console.log("[#10935 diag]", JSON.stringify({ tmpdir: tmpdir(), tmpdirReal: realpathSync(tmpdir()), tmpdirNative: realpathSync.native(tmpdir()), home: h, homeReal: realpathSync(h), homeNative: realpathSync.native(h), systemDrive: process.env.SystemDrive, verdict: automatedRunReason({ HOME: h, USERPROFILE: h }) ?? "none" }))
    expect(automatedRunReason({ HOME: h, USERPROFILE: h })).toBe("ephemeral_home")
    expect(automatedRunReason(realHome, realDeps)).toBeUndefined()
  })

  it("#given a HOME that cannot be resolved #then it fails SAFE: the run counts as ephemeral and telemetry is OFF", () => {
    const gone = join(tmpdir(), "omo-identity-gone-" + process.pid, "home")
    expect(automatedRunReason({ HOME: gone, USERPROFILE: gone })).toBe("ephemeral_home")
    expect(isOmoNativeTelemetryEnabled({ isConfigEnabled: () => true }, {}, { HOME: gone, USERPROFILE: gone })).toBe(false)
  })

  it("#given a misconfigured temp dir (TMPDIR=/ or one containing the real account home) #then a real user's home is NOT treated as temporary", () => {
    // Simulated POSIX paths (identity realpath): a real profile is a direct child of the users directory.
    const posixDeps = (tmp: string) => ({ platform: "linux" as const, realpath: (p: string) => p, tmpdir: () => tmp, posixTempRoots: [] })
    expect(automatedRunReason({ HOME: "/home/someone" }, posixDeps("/"))).toBeUndefined()
    expect(automatedRunReason({ HOME: "/home/someone" }, posixDeps("/home"))).toBeUndefined()
    expect(automatedRunReason({ HOME: "/home/someone" }, posixDeps("/home/someone"))).toBeUndefined()
    expect(automatedRunReason({ HOME: "/root" }, posixDeps("/"))).toBeUndefined()
    expect(automatedRunReason({ HOME: "/var/folders/ab/T/fake-home" }, posixDeps("/var/folders/ab/T"))).toBe("ephemeral_home")
  })

  it("#given a darwin HOME outside /Users #when the automation check runs #then it never resolves an automount trigger (/home, /net), which blocks the host loop when wedged (#11545)", () => {
    const triggers = (p: string) => ["/home", "/net"].some((t) => p === t || p.startsWith(`${t}/`))
    const cases: ReadonlyArray<{ readonly home: string; readonly tmp: string; readonly verdict: "ephemeral_home" | undefined }> = [
      { home: "/Users/Shared/app-home", tmp: "/var/folders/ab/T", verdict: undefined },
      { home: "/opt/app/home", tmp: "/var/folders/ab/T", verdict: undefined },
      { home: "/Volumes/ext/home", tmp: "/var/folders/ab/T", verdict: undefined },
      { home: "/var/folders/ab/T/omo-x", tmp: "/var/folders/ab/T", verdict: "ephemeral_home" },
      { home: "/Users/Shared/app-home", tmp: "/home/tmp", verdict: undefined },
      { home: "/Users/Shared/app-home", tmp: "/net/host/tmp", verdict: undefined },
      { home: "/Users/someone", tmp: "/var/folders/ab/T", verdict: undefined },
    ]
    for (const { home: h, tmp, verdict } of cases) {
      const resolved: string[] = []
      const deps = { platform: "darwin" as const, realpath: (p: string) => (resolved.push(p), p), tmpdir: () => tmp, posixTempRoots: [] }
      expect({ home: h, tmp, verdict: automatedRunReason({ HOME: h }, deps) }).toEqual({ home: h, tmp, verdict })
      expect({ home: h, tmp, triggers: resolved.filter(triggers) }).toEqual({ home: h, tmp, triggers: [] })
    }
  })

  it("#given a darwin account home under /home (resolving to the /System/Volumes/Data firmlink) #then it is a real profile, never ephemeral, whatever TMPDIR says (#11547)", () => {
    const firmlink = (p: string) => (p === "/home" || p.startsWith("/home/") ? `/System/Volumes/Data${p}` : p)
    for (const tmp of ["/home/me", "/home", "/"]) {
      const deps = { platform: "darwin" as const, realpath: firmlink, tmpdir: () => tmp, posixTempRoots: [] }
      expect({ tmp, verdict: automatedRunReason({ HOME: "/home/me" }, deps) }).toEqual({ tmp, verdict: undefined })
    }
  })

  it("#given a darwin HOME inside a temp dir under an automount trigger #then only that HOME itself is resolved and the run still counts as ephemeral", () => {
    const resolved: string[] = []
    const deps = { platform: "darwin" as const, realpath: (p: string) => (resolved.push(p), p), tmpdir: () => "/home/tmp", posixTempRoots: [] }
    expect(automatedRunReason({ HOME: "/home/tmp/run-1" }, deps)).toBe("ephemeral_home")
    expect(new Set(resolved.filter((p) => p === "/home" || p.startsWith("/home/")))).toEqual(new Set(["/home/tmp/run-1"]))
  })

  it("#given linux, where /home is a real directory #then the users-dir candidates are still resolved (a /home symlink keeps counting as the users dir)", () => {
    const deps = { platform: "linux" as const, realpath: (p: string) => (p === "/home" ? "/var/home" : p), tmpdir: () => "/var/home", posixTempRoots: [] }
    expect(automatedRunReason({ HOME: "/var/home/someone" }, deps)).toBeUndefined()
  })

  it("#given the automation check throws (os.userInfo with no passwd entry) #then the consent gate never throws and telemetry is OFF for that run", () => {
    const spy = spyOn(os, "tmpdir").mockImplementation(() => {
      throw new Error("ENOENT: no such file or directory, uv_os_tmpdir")
    })
    try {
      const gate = () => isOmoNativeTelemetryEnabled({ isConfigEnabled: () => true }, {}, { HOME: "/Users/someone", USERPROFILE: "/Users/someone" })
      expect(gate).not.toThrow()
      expect(gate()).toBe(false)
    } finally {
      spy.mockRestore()
    }
  })

  it("#given an automated run #then the enablement gate is off, unless OMO_TELEMETRY_ALLOW_AUTOMATION opts back in", () => {
    const enabled = (env: Record<string, string>, automationDeps?: typeof realDeps) =>
      isOmoNativeTelemetryEnabled({ isConfigEnabled: () => true, ...(automationDeps === undefined ? {} : { automationDeps }) }, {}, env)
    expect(enabled({ ...realHome }, realDeps)).toBe(true)
    expect(enabled({ ...realHome, CI: "true" })).toBe(false)
    expect(enabled({ ...realHome, NODE_ENV: "test" })).toBe(false)
    expect(enabled({ HOME: home(), USERPROFILE: tmpdir() })).toBe(false)
    expect(enabled({ ...realHome, CI: "true", OMO_TELEMETRY_ALLOW_AUTOMATION: "1" }, realDeps)).toBe(true)
  })
})

describe("temp-home detection is path-correct on every platform (#10935)", () => {
  // Simulated Windows: os.tmpdir() reports the 8.3 short profile name; the native realpath expands it to the long name
  // and keeps the input's case, so a mixed-case home matches only through win32 case-insensitive comparison.
  const nativeWin = (path: string) => path.replace(/RUNNER~1/i, "runneradmin")
  const TEMP = "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp"
  const win = (tmp: string = TEMP) => ({ platform: "win32" as const, realpath: nativeWin, tmpdir: () => tmp })

  it("#given the Windows CI shape (USERPROFILE is a test home inside the run root inside TEMP, TEMP = the run root) #then it is ephemeral", () => {
    const runRoot = TEMP + "\\omo-test-run"
    const testHome = runRoot + "\\omo-test-home-1"
    // Bun's os.userInfo().homedir reads USERPROFILE/HOME, so the "account home" IS the home being classified: the
    // check must not depend on it (the guard that read it dropped the only Windows temp root, #10935 review H1).
    const spy = spyOn(os, "userInfo").mockImplementation((() => ({ uid: -1, gid: -1, username: "runneradmin", homedir: testHome, shell: null })) as typeof os.userInfo)
    try {
      expect(automatedRunReason({ USERPROFILE: testHome }, win(runRoot))).toBe("ephemeral_home")
      expect(automatedRunReason({ USERPROFILE: runRoot }, win(runRoot))).toBe("ephemeral_home")
    } finally {
      spy.mockRestore()
    }
  })

  it("#given a mixed-case long-name home under the short-name TEMP #then it is ephemeral (win32 compares case-insensitively)", () => {
    expect(automatedRunReason({ USERPROFILE: "c:\\users\\RunnerAdmin\\appdata\\local\\temp\\omo-x1" }, win())).toBe("ephemeral_home")
  })

  it("#given the real Windows profile (TEMP lives under it), in any case #then it is NOT ephemeral", () => {
    expect(automatedRunReason({ USERPROFILE: "C:\\Users\\runneradmin" }, win())).toBeUndefined()
    expect(automatedRunReason({ USERPROFILE: "c:\\users\\RunnerAdmin" }, win("C:\\Users"))).toBeUndefined()
  })

  it("#given a sibling directory that only shares TEMP's name prefix #then it is NOT inside", () => {
    expect(automatedRunReason({ USERPROFILE: TEMP + "-sibling\\x" }, win())).toBeUndefined()
  })

  it("#given a temp root that resolves to the filesystem root #then it is not a temp root", () => {
    const toRoot = { platform: "linux" as const, realpath: (p: string) => (p === "/tmp-link" ? "/" : p), tmpdir: () => "/tmp-link", posixTempRoots: [] }
    expect(automatedRunReason({ HOME: "/srv/someone" }, toRoot)).toBeUndefined()
  })

  it.skipIf(process.platform === "win32")("#given a POSIX symlink inside the temp root whose target uses '..' to leave it #then the home is NOT inside", () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "omo-escape-")))
    roots.push(base)
    const root = join(base, "root")
    const outside = join(base, "outside")
    mkdirSync(join(root, "jump"), { recursive: true })
    mkdirSync(join(outside, "home"), { recursive: true })
    symlinkSync(join(outside, "home"), join(root, "jump", "out"))
    symlinkSync("jump/out/../home", join(root, "entry"))
    expect(automatedRunReason({ HOME: join(root, "entry") }, { tmpdir: () => root, posixTempRoots: [] })).toBeUndefined()
    // Control: the same home reached without the escaping link IS inside.
    mkdirSync(join(root, "inner"))
    expect(automatedRunReason({ HOME: join(root, "inner") }, { tmpdir: () => root, posixTempRoots: [] })).toBe("ephemeral_home")
  })

  it.skipIf(process.platform === "win32")("#given a missing lexical HOME whose raw path links outside temp #then it is ephemeral, never telemetry ON", () => {
    const base = home()
    const root = join(base, "temp")
    const outside = join(base, "outside")
    mkdirSync(root, { recursive: true })
    mkdirSync(join(outside, "subdir"), { recursive: true })
    mkdirSync(join(outside, "onlyout"))
    symlinkSync(join(outside, "subdir"), join(root, "jump"))
    const rawHome = `${root}/jump/../onlyout`

    // path.join collapses `jump/..` lexically: the id would be written in <root>/onlyout, which does not exist and is inside temp.
    expect(join(rawHome, ".omo")).toBe(join(root, "onlyout", ".omo"))
    expect(automatedRunReason({ HOME: rawHome }, { tmpdir: () => root, posixTempRoots: [] })).toBe("ephemeral_home")
  })

  it.skipIf(process.platform === "win32")("#given literal dot-dot after a symlink in HOME #then temp detection agrees with where the id is written", () => {
    const base = home()
    const root = join(base, "temp")
    const outside = join(base, "outside")
    mkdirSync(join(root, "home"), { recursive: true })
    mkdirSync(join(outside, "subdir"), { recursive: true })
    mkdirSync(join(outside, "home"))
    symlinkSync(join(outside, "subdir"), join(root, "jump"))
    const rawHome = `${root}/jump/../home`

    // path.join(rawHome, ".omo") collapses `jump/..` lexically, so the id would land in <root>/home: inside temp.
    expect(join(rawHome, ".omo")).toBe(join(root, "home", ".omo"))
    expect(automatedRunReason({ HOME: rawHome }, { tmpdir: () => root, posixTempRoots: [] })).toBe("ephemeral_home")
    expect(automatedRunReason({ HOME: join(root, "home") }, { tmpdir: () => root, posixTempRoots: [] })).toBe("ephemeral_home")
  })
})
