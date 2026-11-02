import { describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"

import { isClaimantDead, parseLstart, processStartTime } from "./process-identity"

const MODULE = new URL("./process-identity.ts", import.meta.url).href

/** Runs one process-identity call in a separate process with its own locale and time zone, as a recorder and a checker do. */
async function inProcess(env: Readonly<Record<string, string>>, expression: string): Promise<unknown> {
  const script = `const m = await import(${JSON.stringify(MODULE)}); console.log(JSON.stringify(await (${expression})))`
  const child = Bun.spawn([process.execPath, "-e", script], { env: { ...process.env, ...env }, stdout: "pipe", stderr: "inherit" })
  const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited])
  if (code !== 0) throw new Error(`the identity probe exited ${code}`)
  return JSON.parse(stdout)
}

describe.skipIf(process.platform === "win32")("claimant liveness across locales and time zones", () => {
  test("#given a live process whose start time was recorded under one locale and time zone #when another locale and time zone checks it #then it is alive", async () => {
    const recorded = await inProcess({ LC_ALL: "fr_FR.UTF-8", LANG: "fr_FR.UTF-8", TZ: "Asia/Seoul" }, `m.processStartTime(${process.pid})`)
    expect(typeof recorded).toBe("string")
    const identity = { pid: process.pid, process_start_time: recorded, instance_id: randomUUID(), runtime_instance: null }
    expect(await inProcess({ LC_ALL: "de_DE.UTF-8", LANG: "de_DE.UTF-8", TZ: "America/New_York" }, `m.isClaimantDead(${JSON.stringify(identity)})`)).toBe(false)
  })

  test("#given a live pid recorded with another start time #when it is checked #then it is a reused pid, so the claimant is dead", async () => {
    const current = await processStartTime(process.pid)
    expect(current).toMatch(/^epoch:\d+$/)
    const earlier = `epoch:${Number(current?.slice("epoch:".length)) - 3600}`
    expect(await isClaimantDead({ pid: process.pid, process_start_time: earlier, instance_id: randomUUID(), runtime_instance: null })).toBe(true)
  })

  test("#given a live pid with a raw localized start time from a pre-release build #when it is checked #then it counts as live rather than dead", async () => {
    expect(await isClaimantDead({ pid: process.pid, process_start_time: "Jeu  1 oct 11:23:35 2026", instance_id: randomUUID(), runtime_instance: null })).toBe(false)
  })
})

describe("lstart parsing", () => {
  test("#given the C-locale UTC lstart of procps and BSD ps #when it is parsed #then it is the epoch second, and a localized string is not", () => {
    expect(parseLstart("Thu Oct  1 02:23:35 2026\n")).toBe(Date.UTC(2026, 9, 1, 2, 23, 35) / 1000)
    expect(parseLstart("Do  1 Okt 11:23:35 2026")).toBeNull()
  })
})
