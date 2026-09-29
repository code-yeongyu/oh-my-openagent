import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { InboundEvent, UploadFile } from "../../adapter/contract"
import { TelegramAdapter, type TelegramAdapterOptions } from "./adapter"
import { startFakeTelegramServer, type FakeTelegramServer } from "./fake-server"
import { virtualClock, type VirtualClock } from "./virtual-clock"

export type TelegramHarness = {
  server: FakeTelegramServer
  dir: string
  statePath: string
  clock: VirtualClock
  notices: string[]
  logs: string[]
  files: readonly UploadFile[]
  make(overrides?: Partial<TelegramAdapterOptions>): TelegramAdapter
  close(): Promise<void>
}

export async function telegramHarness(): Promise<TelegramHarness> {
  const server = startFakeTelegramServer()
  const dir = await mkdtemp(join(tmpdir(), "omo-gateway-telegram-"))
  const files: UploadFile[] = []
  for (const title of ["first.txt", "second.png", "third.txt"]) {
    const path = join(dir, title)
    await writeFile(path, `fixture ${title}`)
    files.push({ path, title })
  }
  const statePath = join(dir, "state", "telegram.json")
  const clock = virtualClock()
  const notices: string[] = []
  const logs: string[] = []
  return {
    server,
    dir,
    statePath,
    clock,
    notices,
    logs,
    files,
    make: (overrides = {}) =>
      new TelegramAdapter({
        token: server.token,
        apiBase: server.url,
        statePath,
        clock,
        pollTimeoutSec: 1,
        notice: (text) => notices.push(text),
        log: (line) => logs.push(line),
        ...overrides,
      }),
    close: async () => {
      await server.stop()
      await rm(dir, { recursive: true, force: true })
    },
  }
}

export function bounded<T>(promise: Promise<T>, ms: number, what: () => string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`waited ${ms} ms for ${what()}`)), ms)
  })
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer))
}

export async function listenOutcome(adapter: TelegramAdapter, timeoutMs = 3_000): Promise<unknown> {
  const controller = new AbortController()
  const settled = adapter.listen(() => undefined, controller.signal, () => undefined).then(
    () => "resolved without an error",
    (error: unknown) => error,
  )
  try {
    return await bounded(settled, timeoutMs, () => "listen to stop on its own (it kept polling)")
  } catch (error) {
    controller.abort()
    await settled
    return error
  }
}

export async function listenFor(adapter: TelegramAdapter, count: number, trigger: () => void | Promise<void>, timeoutMs = 10_000): Promise<InboundEvent[]> {
  const events: InboundEvent[] = []
  const controller = new AbortController()
  let enough: () => void = () => undefined
  const done = new Promise<void>((resolve) => {
    enough = resolve
  })
  let isReady: () => void = () => undefined
  const ready = new Promise<void>((resolve) => {
    isReady = resolve
  })
  const listening = adapter.listen(
    (event) => {
      events.push(event)
      if (events.length >= count) enough()
    },
    controller.signal,
    isReady,
  )
  try {
    await bounded(Promise.race([ready, listening]), timeoutMs, () => "listen to call ready()")
    await trigger()
    await bounded(Promise.race([done, listening]), timeoutMs, () => `${count} events, got ${events.length}: ${events.map((event) => event.text).join(" | ")}`)
  } finally {
    controller.abort()
  }
  await bounded(listening, timeoutMs, () => "listen to resolve after abort")
  return events
}
