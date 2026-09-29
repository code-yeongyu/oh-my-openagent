import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { watchForChange } from "./watch"

const POLL_MS = 25

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function files(): { config: string; creds: string } {
  const root = mkdtempSync(join(tmpdir(), "omo-gateway-watch-"))
  roots.push(root)
  const config = join(root, "omo.jsonc")
  const creds = join(root, "creds.json")
  writeFileSync(config, "{}")
  writeFileSync(creds, '{"token":"a"}', { mode: 0o600 })
  return { config, creds }
}

function within<T>(work: Promise<T>, what: string, ms = 4_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`waited ${ms} ms for ${what}`)), ms)
  })
  return Promise.race([work, expired]).finally(() => clearTimeout(timer))
}

describe("watchForChange", () => {
  test("#given a parked wait #when the credential file is rewritten #then it resolves true", async () => {
    const { config, creds } = files()
    const waiting = watchForChange([config, creds], POLL_MS)(new AbortController().signal)
    writeFileSync(creds, '{"token":"a fresh one"}', { mode: 0o600 })
    expect(await within(waiting, "the credential rewrite to count as a change")).toBe(true)
  })

  test("#given a parked wait #when only the credential mode is fixed #then it resolves true", async () => {
    const { config, creds } = files()
    chmodSync(creds, 0o644)
    const waiting = watchForChange([config, creds], POLL_MS)(new AbortController().signal)
    chmodSync(creds, 0o600)
    expect(await within(waiting, "the chmod to count as a change")).toBe(true)
  })

  test("#given a parked wait with no change #when the signal aborts #then it resolves false", async () => {
    const { config, creds } = files()
    const controller = new AbortController()
    const waiting = watchForChange([config, creds], POLL_MS)(controller.signal)
    controller.abort()
    expect(await within(waiting, "the abort")).toBe(false)
  })
})
