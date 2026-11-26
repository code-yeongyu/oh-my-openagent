import { afterEach, describe, expect, test } from "bun:test"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { abortedAnswer, waitOn } from "../bin/lib/install-abort.js"
import { update } from "../bin/lib/install-calls.js"
import { applySetupStages, setupApplyFault } from "../bin/lib/setup-stream.js"

// The publish boundary of the install calls (slice C1c, #14960, review of c7b1a0187c; design lane rule): the signal
// reaches the step that publishes state and is read immediately before it; a publish that happened is answered as
// done, never stopped; a stop names the phase it reached and whether state changed, and never reads as install_failed;
// every controlled wait inside a stage ends on the signal with nothing written after it. Synthetic fixtures only: the
// package manager and bun install are fakes, and the only process run is the fixture's version-printing script.

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const never = <T>(): Promise<T> => new Promise<T>(() => {})
const settled = () => new Promise((resolve) => setImmediate(resolve))
const posix = process.platform !== "win32"

const PRINT_VERSION = [
  "#!/bin/sh",
  'here=$(dirname "$(readlink -f "$0")")',
  'printf "omo %s (engine: senpi 0.0.0)\\n" "$(sed -n \'s/.*"version": *"\\([^"]*\\)".*/\\1/p\' "$here/../package.json")"',
  "",
].join("\n")

function writePackage(versionDir: string, version: string) {
  const pkg = join(versionDir, "node_modules", "omo-ai")
  mkdirSync(join(pkg, "bin"), { recursive: true })
  writeFileSync(join(pkg, "package.json"), `${JSON.stringify({ name: "omo-ai", version })}\n`)
  writeFileSync(join(pkg, "bin", "omo.js"), PRINT_VERSION, { mode: 0o755 })
  mkdirSync(join(versionDir, "node_modules", ".bin"), { recursive: true })
  symlinkSync("../omo-ai/bin/omo.js", join(versionDir, "node_modules", ".bin", "omo"))
}

// A versioned layout on 5.1.77 with 5.1.78 published; `bunInstall` stands in for bun install in the staging dir.
function versionedLayout(
  bunInstall: (stage: string, version: string) => { status: number | null; signal: string | null },
) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "omo-c1c-publish-")))
  roots.push(home)
  const versions = join(home, ".omo", "omo-versions")
  const bunBin = join(home, ".bun", "bin")
  mkdirSync(join(versions, "5.1.77"), { recursive: true })
  mkdirSync(bunBin, { recursive: true })
  writeFileSync(join(bunBin, "bun"), "#!/bin/sh\nexit 0\n", { mode: 0o755 })
  const manifest = { private: true, dependencies: { "omo-ai": "5.1.77" } }
  writeFileSync(join(versions, "5.1.77", "package.json"), `${JSON.stringify(manifest, null, 2)}\n`)
  writePackage(join(versions, "5.1.77"), "5.1.77")
  symlinkSync("5.1.77", join(versions, "current"))
  symlinkSync(join(versions, "current", "node_modules", ".bin", "omo"), join(bunBin, "omo"))
  const env = { HOME: home, PATH: `${bunBin}:/usr/bin:/bin`, OMO_RUNTIME: "node" }
  const ports = {
    root: join(versions, "current", "node_modules", "omo-ai"),
    fetchDistTags: () => ({ latest: "5.1.78" }),
    readInstalled: () => ({ omo: "5.1.77", engine: "2026.11.1" }),
    env,
    platform: "linux" as const,
    run: async (_command: string, _args: string[], options: { cwd?: string } = {}) => {
      const stage = options.cwd ?? ""
      const wanted = JSON.parse(readFileSync(join(stage, "package.json"), "utf8")).dependencies["omo-ai"]
      return bunInstall(stage, wanted)
    },
  }
  return { current: join(versions, "current"), ports }
}

describe.skipIf(!posix)(
  "install.update on a versioned layout: current is switched or the call stops, never both",
  () => {
    test("#given the stop lands after bun install finished #then it answers cancelled before_switch and current still names the old version", async () => {
      const controller = new AbortController()
      const layout = versionedLayout((stage, version) => {
        writePackage(stage, version)
        controller.abort()
        return { status: 0, signal: null }
      })
      const answer = await update({}, layout.ports, { signal: controller.signal })
      expect(answer).toMatchObject({
        kind: "error",
        error: {
          code: "cancelled",
          details: { stopped_in: "versioned_install", phase: "before_switch", switched: false },
        },
      })
      expect(readlinkSync(layout.current)).toBe("5.1.77")
    })

    test("#given the stop ends bun install #then it answers cancelled in the install phase, not install_failed, and current is unchanged", async () => {
      const controller = new AbortController()
      const layout = versionedLayout(() => {
        controller.abort()
        return { status: null, signal: "SIGTERM" }
      })
      const answer = await update({}, layout.ports, { signal: controller.signal })
      expect(answer).toMatchObject({
        kind: "error",
        error: { code: "cancelled", details: { stopped_in: "versioned_install", phase: "install", switched: false } },
      })
      expect(readlinkSync(layout.current)).toBe("5.1.77")
    })

    test("#given the stop lands once current was switched #then the call answers updated with the new version", async () => {
      const controller = new AbortController()
      const layout = versionedLayout((stage, version) => {
        writePackage(stage, version)
        return { status: 0, signal: null }
      })
      const events: string[] = []
      const answer = await update(
        {},
        {
          ...layout.ports,
          onProgress: (event: { kind: string }) => {
            events.push(event.kind)
            if (event.kind === "switched") controller.abort()
          },
        },
        { signal: controller.signal },
      )
      expect(controller.signal.aborted).toBe(true)
      expect(events).toContain("switched")
      expect(answer).toMatchObject({
        kind: "ok",
        value: { state: "updated", version: "5.1.78", after: { omo: "5.1.78" } },
      })
      expect(readlinkSync(layout.current)).toBe("5.1.78")
    })
  },
)

describe("install.update on Windows: a stop between attempts or in the held-file restore is a stop", () => {
  const LOCKED = [
    "npm error code EBUSY",
    "npm error syscall rename",
    "npm error Error: EBUSY: resource busy or locked, rename 'C:\\omo\\node_modules\\omo-ai'",
  ].join("\n")
  const spec = (version: string | undefined) => ({
    manager: "npm",
    command: `npm i -g omo-ai@${version ?? "beta"}`,
    argv: ["npm", "i", "-g", `omo-ai@${version ?? "beta"}`],
  })
  const windows = (overrides: Record<string, unknown>) => ({
    fetchDistTags: () => ({ latest: "1.0.1" }),
    resolveUpdate: spec,
    root: "/nonexistent-omo-root",
    platform: "win32" as const,
    listProcesses: () => [],
    installDir: "C:\\omo",
    selfPids: [],
    ...overrides,
  })

  test("#given a held file and the stop during the retry wait #then it answers cancelled in install_retry after one attempt", async () => {
    const controller = new AbortController()
    const spawned: string[] = []
    const pending = update(
      {},
      windows({
        readInstalled: () => ({ omo: "1.0.0", engine: "1" }),
        run: async (_command: string, args: string[]) => {
          spawned.push(args.join(" "))
          return { status: 1, signal: null, stderr: LOCKED }
        },
        sleep: never,
      }),
      { signal: controller.signal },
    )
    await settled()
    controller.abort()
    expect(await pending).toMatchObject({
      kind: "error",
      error: {
        code: "cancelled",
        details: { stopped_in: "install_retry", attempts: 1, command: "npm i -g omo-ai@1.0.1" },
      },
    })
    expect(spawned).toEqual(["i -g omo-ai@1.0.1"])
  })

  test("#given a held file, an unreadable install and the stop ending the restore #then it answers cancelled in held_restore, not install_failed", async () => {
    const controller = new AbortController()
    let reads = 0
    const answer = await update(
      {},
      windows({
        readInstalled: () => {
          reads += 1
          if (reads === 1) return { omo: "1.0.0", engine: "1" }
          throw new Error("no install can be read")
        },
        run: async (_command: string, args: string[]) => {
          if (!args.includes("omo-ai@1.0.0")) return { status: 1, signal: null, stderr: LOCKED }
          controller.abort()
          return { status: null, signal: "SIGTERM" }
        },
        sleep: async () => {},
      }),
      { signal: controller.signal },
    )
    expect(answer).toMatchObject({
      kind: "error",
      error: {
        code: "cancelled",
        details: {
          stopped_in: "held_restore",
          attempts: 3,
          before: "1.0.0",
          previous_command: "npm i -g omo-ai@1.0.0",
        },
      },
    })
  })
})

describe("install.setup.apply's model-choice replan ends on the signal", () => {
  test("#given a replan that never resolves #when the call is cancelled #then apply stops before model-choices and writes nothing", async () => {
    const controller = new AbortController()
    const wait = waitOn({ signal: controller.signal })
    const applied: string[] = []
    const stage = (pending: number) => ({ present: true, pending, notices: [] })
    const plans = { providers: stage(1), modelChoices: stage(1), planChoices: never }
    const pending = applySetupStages(
      plans,
      async (candidate: { id: string }) => {
        applied.push(candidate.id)
        return false
      },
      () => {},
      { signal: wait.signal },
    )
    await settled()
    controller.abort()
    const error = await pending.then(
      () => undefined,
      (thrown: unknown) => thrown,
    )
    wait.done()
    expect(abortedAnswer(error)).toMatchObject({ kind: "error", error: { code: "cancelled" } })
    expect(setupApplyFault(error)).toEqual({ applied: [], stage: "model-choices" })
    expect(applied).toEqual(["providers"])
  })
})
