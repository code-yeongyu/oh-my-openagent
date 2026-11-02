import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readDaemonLaunchSpec } from "../../senpi-task/src/runners/rpc-host/launch-spec"
import { runDoctor } from "../bin/lib/doctor.js"
import { preparePluginLaunchSpec } from "../bin/lib/engine-prepare.js"
import { launchSpecDoctorLines, normalizeLaunchSpecMode } from "../bin/lib/launch-spec-mode.js"

const SPEC = {
  spec_version: 1,
  core: { session_runtime: "in-process", multi_session: true, extensions: [".", "./extensions/omo-member.js"] },
  tunables: { idleExitMs: 900000, coldStart: "transient" },
  env: { OMO_NATIVE: "1" },
}

const roots: string[] = []
const posixOnly = test.skipIf(process.platform === "win32")

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function pluginWithSpec(mode: number): { pluginRoot: string; specPath: string } {
  const pluginRoot = mkdtempSync(join(tmpdir(), "omo-launch-spec-"))
  roots.push(pluginRoot)
  mkdirSync(join(pluginRoot, "extensions"), { recursive: true })
  writeFileSync(join(pluginRoot, "extensions", "omo-member.js"), "export {}\n")
  const specPath = join(pluginRoot, "daemon-launch-spec.json")
  writeFileSync(specPath, `${JSON.stringify(SPEC, null, 2)}\n`)
  // Simulates what npm extraction leaves under `umask 002`.
  chmodSync(specPath, mode)
  return { pluginRoot, specPath }
}

const modeOf = (path: string) => statSync(path).mode & 0o777

function captureDoctor(options: Record<string, unknown>): { stdout: string; exitCode: typeof process.exitCode } {
  const output: string[] = []
  const originalLog = console.log
  const originalExitCode = process.exitCode
  console.log = (value?: unknown) => { output.push(String(value)) }
  process.exitCode = undefined
  try {
    runDoctor({ harnesses: [] }, [], { list: () => [], fetchDistTags: () => null, daemonReport: () => [], ...options })
    return { stdout: output.join("\n"), exitCode: process.exitCode }
  } finally {
    console.log = originalLog
    process.exitCode = originalExitCode ?? 0
  }
}

describe("launch-time launch spec preparation (#9208)", () => {
  posixOnly("#given a 0664 spec left by a umask 002 install #when the launch prepares the plugin #then it is 0644 and the task host reader accepts it", () => {
    const { pluginRoot, specPath } = pluginWithSpec(0o664)
    expect(() => readDaemonLaunchSpec(specPath)).toThrow("launch_spec_insecure")

    const reported: string[] = []
    preparePluginLaunchSpec({ pluginRoot, report: (line: string) => reported.push(line) })

    expect(modeOf(specPath)).toBe(0o644)
    expect(readDaemonLaunchSpec(specPath).spec_version).toBe(1)
    expect(reported).toEqual([])
  })

  posixOnly("#given a world-writable spec #when normalized #then only the group and world write bits are removed", () => {
    const { pluginRoot, specPath } = pluginWithSpec(0o666)
    expect(normalizeLaunchSpecMode(pluginRoot)).toEqual({ action: "normalized", path: specPath, from: 0o666, to: 0o644 })
    expect(modeOf(specPath)).toBe(0o644)
  })

  posixOnly("#given an already private spec #when normalized #then nothing is written", () => {
    const { pluginRoot, specPath } = pluginWithSpec(0o600)
    expect(normalizeLaunchSpecMode(pluginRoot)).toEqual({ action: "unchanged", path: specPath })
    expect(modeOf(specPath)).toBe(0o600)
  })

  posixOnly("#given a symlinked spec whose target is 0664 #when the launch prepares the plugin #then the link is not followed and the reader still rejects it", () => {
    const { specPath: target } = pluginWithSpec(0o664)
    const { pluginRoot } = pluginWithSpec(0o644)
    const linked = join(pluginRoot, "daemon-launch-spec.json")
    rmSync(linked)
    symlinkSync(target, linked)

    const result = normalizeLaunchSpecMode(pluginRoot)

    expect(result).toEqual({ action: "left", path: linked, reason: "not_regular_file" })
    expect(lstatSync(linked).isSymbolicLink()).toBe(true)
    expect(modeOf(target)).toBe(0o664)
    expect(() => readDaemonLaunchSpec(linked)).toThrow("launch_spec_insecure")
  })

  posixOnly("#given a spec owned by another uid (injected lstat) #when normalized #then it is left alone", () => {
    const { pluginRoot, specPath } = pluginWithSpec(0o664)
    const chmods: string[] = []
    const real = lstatSync(specPath)
    const result = normalizeLaunchSpecMode(pluginRoot, {
      lstat: () => ({ isFile: () => true, mode: real.mode, uid: (process.getuid?.() ?? 0) + 1 }),
      chmod: (path: string) => { chmods.push(path) },
    })
    expect(result).toEqual({ action: "left", path: specPath, reason: "foreign_owner" })
    expect(chmods).toEqual([])
    expect(modeOf(specPath)).toBe(0o664)
  })

  test("#given win32 #when normalized #then modes are not touched at all", () => {
    const calls: string[] = []
    const result = normalizeLaunchSpecMode("/plugin", {
      platform: "win32",
      lstat: () => { calls.push("lstat"); throw new Error("must not stat") },
      chmod: () => { calls.push("chmod") },
    })
    expect(result).toEqual({ action: "skipped", path: join("/plugin", "daemon-launch-spec.json"), reason: "win32" })
    expect(calls).toEqual([])
  })

  posixOnly("#given a plugin without a spec #when prepared #then the launch is not blocked and nothing is reported", () => {
    const pluginRoot = mkdtempSync(join(tmpdir(), "omo-launch-spec-empty-"))
    roots.push(pluginRoot)
    const reported: string[] = []
    expect(() => preparePluginLaunchSpec({ pluginRoot, report: (line: string) => reported.push(line) })).not.toThrow()
    expect(reported).toEqual([])
  })

  posixOnly("#given a chmod that fails #when prepared #then the launch warns with the manual fix and does not throw", () => {
    const { pluginRoot, specPath } = pluginWithSpec(0o664)
    const reported: string[] = []
    expect(() => preparePluginLaunchSpec({
      pluginRoot,
      report: (line: string) => reported.push(line),
      io: { chmod: () => { throw Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" }) } },
    })).not.toThrow()
    expect(reported.join("")).toContain(`chmod 644 ${specPath}`)
  })
})

describe("omo doctor launch spec line (#9208)", () => {
  posixOnly("#given a healthy spec #when doctor inspects it #then it adds no line", () => {
    const { pluginRoot } = pluginWithSpec(0o644)
    expect(launchSpecDoctorLines(pluginRoot)).toEqual([])
  })

  posixOnly("#given a symlinked spec whose target is group-writable #when doctor inspects it #then it FAILs naming the path and the fix", () => {
    const { specPath: target } = pluginWithSpec(0o664)
    const { pluginRoot } = pluginWithSpec(0o644)
    const linked = join(pluginRoot, "daemon-launch-spec.json")
    rmSync(linked)
    symlinkSync(target, linked)

    const [line = "", ...rest] = launchSpecDoctorLines(pluginRoot)

    expect(rest).toEqual([])
    expect(line.startsWith("FAIL ")).toBe(true)
    expect(line).toContain(`launch_spec_insecure: ${linked}`)
    expect(line).toContain(`chmod 644 ${linked}`)
  })

  posixOnly("#given a spec owned by another uid (injected stat) #when doctor inspects it #then it FAILs naming the path and the owner fix", () => {
    const { pluginRoot, specPath } = pluginWithSpec(0o644)
    const [line = ""] = launchSpecDoctorLines(pluginRoot, {
      stat: () => ({ isFile: () => true, mode: 0o100644, uid: (process.getuid?.() ?? 0) + 1 }),
    })
    expect(line.startsWith("FAIL ")).toBe(true)
    expect(line).toContain(`launch_spec_insecure: ${specPath}`)
    expect(line).toContain("owned by")
  })

  posixOnly("#given a rejected spec #when omo doctor runs #then it prints the FAIL line and exits 1", () => {
    const { pluginRoot, specPath } = pluginWithSpec(0o644)

    const { stdout, exitCode } = captureDoctor({
      pluginRoot,
      launchSpecIo: { stat: () => ({ isFile: () => true, mode: 0o100664, uid: process.getuid?.() ?? 0 }) },
    })

    const failLine = stdout.split("\n").find((line) => line.startsWith("FAIL launch spec:"))
    expect(failLine).toContain(`launch_spec_insecure: ${specPath}`)
    expect(failLine).toContain(`chmod 644 ${specPath}`)
    expect(exitCode).toBe(1)
  })

  test("#given win32 #when doctor inspects it #then it adds no line", () => {
    expect(launchSpecDoctorLines("/plugin", { platform: "win32" })).toEqual([])
  })
})
