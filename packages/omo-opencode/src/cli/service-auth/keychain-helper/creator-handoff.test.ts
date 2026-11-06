import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import {
  createCreatorHandOff,
  DESKTOP_APP_REQUIREMENT,
  DESKTOP_RUNTIME_REQUIREMENT,
  type DesktopRuntime,
  desktopRuntimeCandidates,
  HANDOFF_ENV,
  type HandOffRunner,
} from "./creator-handoff"
import { runtimeDeclaresKeychainHandoff } from "./runtime-capabilities"

// The desktop's installed layout, written out literally and shared with no product code (RULING-74; desktop#5057
// keychain-helper.ts installs the runtime, its keychain helper and the capability file side by side here).
const RUNTIME_DIR = "Applications/OmO.app/Contents/Resources/omo-runtime/darwin-arm64"
const CAPABILITY_FILE = "omo-runtime-capabilities.json"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function installedApps(...names: string[]): DesktopRuntime[] {
  const root = mkdtempSync(join(tmpdir(), "creator-handoff-"))
  roots.push(root)
  return names.map(name => {
    const home = join(root, name)
    mkdirSync(join(home, RUNTIME_DIR), { recursive: true })
    writeFileSync(join(home, RUNTIME_DIR, "omo"), name)
    writeFileSync(join(home, RUNTIME_DIR, "omo-keychain"), "helper")
    writeFileSync(join(home, RUNTIME_DIR, CAPABILITY_FILE), '{"keychainHandoff":1}\n')
    return { app: join(home, "Applications/OmO.app"), runtime: join(home, RUNTIME_DIR, "omo") }
  })
}

function recorder(code: number | null = 0) {
  const runs: Array<{ path: string; args: readonly string[]; env: Record<string, string> }> = []
  const run: HandOffRunner = async (path, args, env) => {
    runs.push({ path, args, env })
    return code
  }
  return { runs, run }
}

const valid = async () => true

describe("creator hand-off (#11262 addendum change 1, rows 7 and 8)", () => {
  test("#given a verified app #when handing off #then its in-bundle runtime runs `account token` with the store's origin and the no-dialog marker", async () => {
    const [app] = installedApps("one")
    const { runs, run } = recorder()
    const checked: string[] = []
    const handOff = createCreatorHandOff({
      candidates: [app ?? { app: "", runtime: "" }],
      origin: "https://api.example.test",
      env: { HOME: "/Users/someone", OMO_SERVICE_API_URL: "https://other.example.test", SECRET: "not passed" },
      checkBundle: async (path, requirement) => {
        checked.push(`bundle ${path === app?.app} ${requirement === DESKTOP_APP_REQUIREMENT}`)
        return true
      },
      checkRuntime: async (path, requirement) => {
        checked.push(`runtime ${path === app?.runtime} ${requirement === DESKTOP_RUNTIME_REQUIREMENT}`)
        return true
      },
      run,
      selfPath: "/other/bun",
    })
    expect(await handOff()).toBe(true)
    expect(checked).toEqual(["bundle true true", "runtime true true"])
    expect(runs).toEqual([
      { path: app?.runtime, args: ["account", "token"], env: { [HANDOFF_ENV]: "1", HOME: "/Users/someone", OMO_SERVICE_API_URL: "https://api.example.test" } },
    ])
  })

  test.each([
    ["the bundle seal fails", false, true],
    ["the runtime requirement fails", true, false],
  ] as const)("#given %s #when handing off #then that runtime never runs and a later verified one does", async (_name, bundleOk, runtimeOk) => {
    const [forged, real] = installedApps("forged", "real")
    const { runs, run } = recorder()
    const handOff = createCreatorHandOff({
      candidates: [forged ?? { app: "", runtime: "" }, real ?? { app: "", runtime: "" }],
      env: {},
      checkBundle: async app => app !== forged?.app || bundleOk,
      checkRuntime: async runtime => runtime !== forged?.runtime || runtimeOk,
      run,
    })
    expect(await handOff()).toBe(true)
    expect(runs.map(entry => entry.path)).toEqual([real?.runtime])
  })

  test.each([
    ["the process is itself a hand-off child", { [HANDOFF_ENV]: "1" }, false],
    ["the only candidate is this process", {}, true],
  ] as const)("#given %s #when handing off #then nothing runs", async (_name, env, self) => {
    const [app] = installedApps("one")
    const { runs, run } = recorder()
    const handOff = createCreatorHandOff({
      candidates: [app ?? { app: "", runtime: "" }],
      env,
      checkBundle: valid,
      checkRuntime: valid,
      run,
      selfPath: self ? app?.runtime : "/other/bun",
    })
    expect(await handOff()).toBe(false)
    expect(runs).toEqual([])
  })

  test("#given a creator that fails, is killed at the deadline, or cannot be spawned #when handing off #then false, never a rejection", async () => {
    const [app] = installedApps("one")
    const candidates = [app ?? { app: "", runtime: "" }]
    for (const code of [1, null]) {
      const { run } = recorder(code)
      expect(await createCreatorHandOff({ candidates, env: {}, checkBundle: valid, checkRuntime: valid, run, selfPath: "/x" })()).toBe(false)
    }
    const failing: HandOffRunner = async () => {
      throw new Error("EACCES")
    }
    expect(await createCreatorHandOff({ candidates, env: {}, checkBundle: valid, checkRuntime: valid, run: failing, selfPath: "/x" })()).toBe(false)
  })

  test.each([
    ["no capability file (omo-ai 5.1.48 and earlier)", null],
    ["a capability file without the hand-off", '{"other":1}'],
    ["an older hand-off level", '{"keychainHandoff":0}'],
    ["an unreadable capability file", "not json"],
  ] as const)("#given a runtime with %s #when handing off #then it is never run", async (_name, content) => {
    const [old] = installedApps("old")
    const file = join(dirname(old?.runtime ?? ""), CAPABILITY_FILE)
    if (content === null) rmSync(file)
    else writeFileSync(file, content)
    const { runs, run } = recorder()
    const handOff = createCreatorHandOff({ candidates: [old ?? { app: "", runtime: "" }], env: {}, checkBundle: valid, checkRuntime: valid, run, selfPath: "/x" })
    expect(await handOff()).toBe(false)
    expect(runs).toEqual([])
  })

  test("#given the desktop layout #when the capability is read #then it is the file directly beside the runtime binary", async () => {
    const [app] = installedApps("one")
    expect(await runtimeDeclaresKeychainHandoff(app?.runtime ?? "")).toBe(true)
    expect(desktopRuntimeCandidates("/Users/someone", "arm64")[1]?.runtime).toBe(`/Users/someone/${RUNTIME_DIR}/omo`)
  })


  test("#given a signature check that throws #when handing off #then false, never a rejection", async () => {
    const [app] = installedApps("one")
    const { runs, run } = recorder()
    const throwing = async (): Promise<boolean> => {
      throw new Error("spawn codesign failed")
    }
    const candidates = [app ?? { app: "", runtime: "" }]
    expect(await createCreatorHandOff({ candidates, env: {}, checkBundle: throwing, checkRuntime: valid, run, selfPath: "/x" })()).toBe(false)
    expect(await createCreatorHandOff({ candidates, env: {}, checkBundle: valid, checkRuntime: throwing, run, selfPath: "/x" })()).toBe(false)
    expect(runs).toEqual([])
  })

  test("#given no app installed #when handing off #then nothing runs", async () => {
    const { runs, run } = recorder()
    const handOff = createCreatorHandOff({ candidates: [{ app: "/nonexistent/OmO.app", runtime: "/nonexistent/OmO.app/omo" }], env: {}, checkBundle: valid, checkRuntime: valid, run })
    expect(await handOff()).toBe(false)
    expect(runs).toEqual([])
  })

  test("#given the machine #when listing app runtimes #then the system and the user Applications folders, per arch", () => {
    expect(desktopRuntimeCandidates("/Users/someone", "arm64")).toEqual([
      { app: "/Applications/OmO.app", runtime: "/Applications/OmO.app/Contents/Resources/omo-runtime/darwin-arm64/omo" },
      { app: "/Users/someone/Applications/OmO.app", runtime: "/Users/someone/Applications/OmO.app/Contents/Resources/omo-runtime/darwin-arm64/omo" },
    ])
    expect(desktopRuntimeCandidates("/Users/someone", "x64")[0]?.runtime).toContain("darwin-x64")
  })
})
