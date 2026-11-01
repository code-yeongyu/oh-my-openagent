import { describe, expect, test } from "bun:test"
import { guardOmowright } from "./skills/browser/scripts/omowright.mjs"
import { BskIpcClient, connectBrowserSkill } from "omowright"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

async function rejected(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise
  } catch (error) {
    if (error instanceof Error) return error
    throw error
  }
  throw new Error("Expected the attached-browser attempt to stop")
}

function fixture(message: string) {
  let starts = 0
  let copies = 0
  let ready = false
  const cause = new Error(message)
  const owned = async () => { copies++; return {} }
  const raw = {
    connectBrowserSkill: async () => {
      starts++
      if (!ready) throw cause
      return { attached: true }
    },
    connectPipe: owned,
    connectCloakProfile: owned,
    connect: owned,
    bskOnboard: async () => ({
      cli: { installed: true },
      daemon: { running: false, error: message },
      ready: false,
    }),
    bskDoctor: async () => ({ ready, daemon: { running: ready } }),
  }
  return {
    raw, cause,
    starts: () => starts,
    copies: () => copies,
    repair: () => { ready = true },
  }
}

describe("attached-browser failures stop the attempt on every platform", () => {
  for (const message of [
    "cannot start an independent Windows daemon: Job Object breakaway: Access is denied (os error 5)",
    "bsk status exited with 1: daemon socket: Permission denied (os error 13)",
  ]) {
    for (const env of [{}, { OMO_BROWSER_ENGINE: "connected" }]) {
      test(`terminal failure preserves native cause without profile copying: ${message}, desktop=${"OMO_BROWSER_ENGINE" in env}`, async () => {
        // Given a native startup/attach refusal and owned engines that would copy a profile.
        const f = fixture(message)
        const browser = guardOmowright(f.raw, { env })

        // When attachment fails, including a later wrapper load and changed task name.
        const error = await rejected(browser.connectBrowserSkill({ name: "first" }))
        const reloaded = guardOmowright(f.raw, { env })
        const again = await rejected(reloaded.connectBrowserSkill({ name: "second" }))
        for (const method of ["connectPipe", "connectCloakProfile", "connect"] as const) {
          expect(await rejected(reloaded[method]({}))).toBe(error)
        }

        // Then the same terminal error survives; no second start or profile-copy path runs.
        expect(error).toMatchObject({
          code: "browser_attached_setup_failed",
          retryable: false,
          fallbackAllowed: false,
          cause: f.cause,
          recovery: { command: "bsk daemon start", kind: "start_daemon_outside_omo" },
        })
        expect(error.message).toContain(message)
        expect(error.message).toContain("bsk daemon start")
        expect(again).toBe(error)
        expect(f.starts()).toBe(1)
        expect(f.copies()).toBe(0)
      })
    }
  }

  test("concurrent failed attaches perform one native start", async () => {
    const f = fixture("daemon failed to bind its socket")
    const browser = guardOmowright(f.raw, { env: {} })
    const errors = await Promise.all([
      rejected(browser.connectBrowserSkill()),
      rejected(browser.connectBrowserSkill()),
    ])
    expect(errors[1]).toBe(errors[0])
    expect(f.starts()).toBe(1)
  })

  test("an onboarding daemon error is terminal instead of another install attempt", async () => {
    const f = fixture("daemon exited before publishing its socket")
    const browser = guardOmowright(f.raw, { env: {} })
    const error = await rejected(browser.bskOnboard())
    expect(error).toMatchObject({ code: "browser_attached_setup_failed", retryable: false })
    expect(await rejected(browser.connectBrowserSkill())).toBe(error)
    expect(f.starts()).toBe(0)
    expect(f.copies()).toBe(0)
  })

  test("only a positive setup check releases the failure for another attachment", async () => {
    const f = fixture("daemon not reachable")
    const browser = guardOmowright(f.raw, { env: {} })
    const error = await rejected(browser.connectBrowserSkill())
    await browser.bskDoctor()
    expect(await rejected(browser.connectBrowserSkill())).toBe(error)
    f.repair()
    expect(await browser.bskDoctor()).toMatchObject({ ready: true })
    expect(await browser.connectBrowserSkill()).toEqual({ attached: true })
    expect(f.starts()).toBe(2)
    expect(f.copies()).toBe(0)
  })

  test("the pinned IPC start refusal reaches the guard without another native start", async () => {
    const home = mkdtempSync(join(tmpdir(), "omo-bsk-refusal-"))
    try {
      let starts = 0
      const cause = new Error("cannot start daemon: Permission denied (os error 13)")
      const client = new BskIpcClient({ home, startDaemon: async () => { starts++; throw cause } })
      const browser = guardOmowright({ connectBrowserSkill }, { env: {} })
      const error = await rejected(browser.connectBrowserSkill({ client }))
      expect(error.cause).toBe(cause)
      expect(await rejected(browser.connectBrowserSkill({ client }))).toBe(error)
      expect(starts).toBe(1)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test("the doctor CLI reports a terminal daemon failure instead of installing again", async () => {
    const root = mkdtempSync(join(tmpdir(), "omo-bsk-doctor-refusal-"))
    const message = "daemon socket attach failed: Permission denied (os error 13)"
    try {
      const report = {
        ready: false, cli: { installed: true }, daemon: { running: false, error: message },
        primary: null, identification: { needsChoice: false, candidates: [] },
        browsers: [], browsersConnected: [], nextStep: "run onboarding again",
      }
      writeFileSync(join(root, "index.js"), `export async function bskDoctor() { return ${JSON.stringify(report)} }\n`)
      const child = Bun.spawn([process.execPath, join(import.meta.dir, "skills/browser/scripts/browser-doctor.mjs"), "--json"], {
        env: { ...process.env, OMOWRIGHT_ROOT: root }, stdout: "pipe", stderr: "pipe",
      })
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
      expect(stderr).toBe("")
      expect(code).toBe(2)
      const summary = JSON.parse(stdout)
      expect(summary.state).toBe("daemon-failed")
      expect(summary.failure).toMatchObject({
        code: "browser_attached_setup_failed", retryable: false, fallbackAllowed: false,
        recovery: { command: "bsk daemon start" },
      })
      expect(summary.daemon.error).toBe(message)
      expect(summary.nextStep).toBe(summary.remedy)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
