import { expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, watch, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { findChromeExecutable } from "./browser"
import { sweepStaleProfiles, writeSilentWav } from "./browser-profile"

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Resolve when `path` disappears. Event-ordered: the watcher is armed before the trigger fires, and
 * it watches the PARENT directory - a directory watch does not reliably report its own deletion.
 */
function whenRemoved(path: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!existsSync(path)) {
      resolve()
      return
    }
    const watcher = watch(dirname(path), () => {
      if (existsSync(path)) return
      watcher.close()
      clearTimeout(timer)
      resolve()
    })
    const timer = setTimeout(() => {
      watcher.close()
      reject(new Error(`${path} still existed after ${timeoutMs} ms`))
    }, timeoutMs)
  })
}

test("the fake microphone file is a valid 48 kHz mono WAV carrying only silence", () => {
  const dir = mkdtempSync(join(tmpdir(), "huddle-wav-"))
  try {
    const path = join(dir, "silence.wav")
    writeSilentWav(path, 0.25)
    const wav = readFileSync(path)
    expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF")
    expect(wav.subarray(8, 12).toString("ascii")).toBe("WAVE")
    expect(wav.readUInt16LE(22)).toBe(1)
    expect(wav.readUInt32LE(24)).toBe(48_000)
    expect(wav.readUInt16LE(34)).toBe(16)
    const samples = wav.readUInt32LE(40) / 2
    expect(samples).toBe(12_000)
    let peak = 0
    for (let i = 0; i < samples; i++) peak = Math.max(peak, Math.abs(wav.readInt16LE(44 + i * 2)))
    expect(peak).toBe(0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("a pinned browser path wins, and a machine with none says which variable to set", () => {
  expect(findChromeExecutable({ OMO_GATEWAY_CHROME_PATH: "/opt/pinned/chrome" })).toBe("/opt/pinned/chrome")
  const original = process.platform
  Object.defineProperty(process, "platform", { value: "sunos", configurable: true })
  try {
    expect(() => findChromeExecutable({})).toThrow(/OMO_GATEWAY_CHROME_PATH/)
  } finally {
    Object.defineProperty(process, "platform", { value: original, configurable: true })
  }
})

test("killing the host process still kills the browser and deletes its profile", async () => {
  const root = mkdtempSync(join(tmpdir(), "huddle-crash-"))
  const profile = join(root, "profile")
  const hostScript = join(root, "host.ts")
  writeFileSync(
    hostScript,
    [
      `import { spawn } from "node:child_process"`,
      `import { mkdirSync } from "node:fs"`,
      `import { spawnWatchdog } from "${import.meta.dir}/browser-watchdog"`,
      `mkdirSync(${JSON.stringify(profile)}, { recursive: true })`,
      // stands in for the browser: detached, so killing the host never reaches it by itself
      `const victim = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", detached: true })`,
      `if (victim.pid === undefined) throw new Error("the stand-in browser did not start")`,
      `spawnWatchdog({ pid: victim.pid, dir: ${JSON.stringify(profile)} })`,
      `console.log("READY " + victim.pid)`,
      `setInterval(() => {}, 1000)`,
    ].join("\n"),
  )

  const host = spawn(process.execPath, [hostScript], { stdio: ["ignore", "pipe", "ignore"] })
  try {
    const victimPid = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("the host never reported a browser pid"))
      }, 20_000)
      host.stdout?.on("data", (chunk: Buffer) => {
        const match = /READY (\d+)/.exec(chunk.toString("utf8"))
        if (match === null) return
        clearTimeout(timer)
        resolve(Number(match[1]))
      })
    })

    // control: nothing has died yet, so the assertions below cannot pass by accident
    expect(alive(victimPid)).toBe(true)
    expect(existsSync(profile)).toBe(true)

    host.kill("SIGKILL")

    await whenRemoved(profile, 20_000)
    expect(existsSync(profile)).toBe(false)
    expect(alive(victimPid)).toBe(false)
  } finally {
    host.kill("SIGKILL")
    rmSync(root, { recursive: true, force: true })
  }
}, 40_000)

test("a profile left behind by a machine that never shut down is swept on the next launch", () => {
  const root = mkdtempSync(join(tmpdir(), "huddle-sweep-"))
  try {
    const stale = join(root, "call-stale")
    const fresh = join(root, "call-fresh")
    const foreign = join(root, "something-else")
    for (const dir of [stale, fresh, foreign]) mkdirSync(dir)
    const longAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    utimesSync(stale, longAgo, longAgo)
    utimesSync(foreign, longAgo, longAgo)

    expect(sweepStaleProfiles(root)).toEqual([stale])
    expect(existsSync(stale)).toBe(false)
    // a live call's profile and anything this module did not create are left alone
    expect(existsSync(fresh)).toBe(true)
    expect(existsSync(foreign)).toBe(true)
    expect(sweepStaleProfiles(join(root, "missing"))).toEqual([])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
