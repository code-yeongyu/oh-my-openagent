// Launching the isolated browser that holds the chat client, and taking it down again.
//
// No debugging port is opened: the protocol runs over the browser's stdio pipe, so no other process
// on this machine can drive the browser or read its session over a socket.

import { type ChildProcess, spawn } from "node:child_process"
import { rmSync } from "node:fs"
import { CdpConnection, type CdpTransport } from "./cdp"
import { createCallProfile } from "./browser-profile"
import { spawnWatchdog } from "./browser-watchdog"

export type ChromeSession = {
  readonly pid: number
  readonly profileDir: string
  readonly connection: CdpConnection
  /** resolves with the exit code once the browser is gone */
  readonly exited: Promise<number | null>
  /** the browser's last stderr, bounded; for diagnosing a launch that never came up */
  stderrTail(): string
  /** polite close, then SIGKILL of the browser's group, then the profile is removed */
  close(): Promise<void>
}

export type LaunchOptions = {
  readonly profilesRoot: string
  readonly executablePath?: string
  readonly headless?: boolean
  readonly extraArgs?: readonly string[]
  readonly env?: Record<string, string | undefined>
  /** the interpreter used for the teardown watchdog; defaults to this process's runtime */
  readonly execPath?: string
}

const MAC_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
] as const
const LINUX_CANDIDATES = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"] as const
const STDERR_TAIL_BYTES = 8_192

/**
 * Find a browser build. The pinned path wins so an operator can hold a known-good version; the
 * protocol details and headless audio behaviour do change between releases.
 */
export function findChromeExecutable(env: Record<string, string | undefined> = process.env): string {
  const pinned = env.OMO_GATEWAY_CHROME_PATH
  if (pinned !== undefined && pinned !== "") return pinned
  if (process.platform === "darwin") {
    for (const candidate of MAC_CANDIDATES) if (Bun.file(candidate).size > 0) return candidate
  }
  for (const name of LINUX_CANDIDATES) {
    const found = Bun.which(name)
    if (found !== null) return found
  }
  throw new Error("no Chromium build found for the huddle voice surface; set OMO_GATEWAY_CHROME_PATH to one")
}

const isWritable = (stream: unknown): stream is NodeJS.WritableStream => typeof stream === "object" && stream !== null && "write" in stream
const isReadable = (stream: unknown): stream is NodeJS.ReadableStream => typeof stream === "object" && stream !== null && "read" in stream

/** The browser's stdio protocol framing: complete JSON messages separated by a NUL byte. */
function pipeTransport(child: ChildProcess): CdpTransport {
  const writable = child.stdio[3]
  const readable = child.stdio[4]
  if (!isWritable(writable) || !isReadable(readable)) throw new Error("the browser was started without a protocol pipe")
  let messageHandler: ((message: string) => void) | null = null
  let closeHandler: ((reason: string) => void) | null = null
  let buffer = ""
  readable.setEncoding("utf8")
  readable.on("data", (chunk: string) => {
    buffer += chunk
    let cut = buffer.indexOf("\0")
    while (cut >= 0) {
      const message = buffer.slice(0, cut)
      buffer = buffer.slice(cut + 1)
      if (message.length > 0) messageHandler?.(message)
      cut = buffer.indexOf("\0")
    }
  })
  readable.on("close", () => closeHandler?.("the browser closed the protocol pipe"))
  child.on("exit", (code) => closeHandler?.(`the browser exited with code ${code ?? "null"}`))
  return {
    write(message) {
      writable.write(`${message}\0`)
    },
    onMessage(handler) {
      messageHandler = handler
    },
    onClose(handler) {
      closeHandler = handler
    },
    close() {
      writable.end()
    },
  }
}

/** Resolve true once the child is gone, false if it outlived the deadline. */
const settle = (child: ChildProcess, ms: number): Promise<boolean> =>
  new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve(true)
      return
    }
    const onExit = (): void => {
      clearTimeout(timer)
      resolve(true)
    }
    const timer = setTimeout(() => {
      child.off("exit", onExit)
      resolve(false)
    }, ms)
    child.once("exit", onExit)
  })

/**
 * Start the browser with a fresh isolated profile and a live protocol connection.
 *
 * The browser is its own process group, so one signal reaches it and every renderer it forked; the
 * watchdog uses that same group id.
 */
export function launchChrome(options: LaunchOptions): ChromeSession {
  const profile = createCallProfile(options.profilesRoot)
  const args = [
    "--remote-debugging-pipe",
    `--user-data-dir=${profile.dir}`,
    ...(options.headless === false ? [] : ["--headless=new"]),
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--disable-extensions",
    "--disable-crash-reporter",
    "--disable-component-update",
    "--disk-cache-size=1",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${profile.silenceWav}`,
    "--autoplay-policy=no-user-gesture-required",
    // a throttled renderer stops pumping audio, and a voice bridge cannot be background work
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--window-size=1280,900",
    ...(options.extraArgs ?? []),
    "about:blank",
  ]

  const child = spawn(options.executablePath ?? findChromeExecutable(options.env), args, {
    stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"],
    detached: true,
    env: { ...process.env, ...options.env },
  })
  const pid = child.pid
  if (pid === undefined) throw new Error("the browser did not start")

  let stderrTail = ""
  child.stderr?.on("data", (chunk: Buffer) => {
    stderrTail = `${stderrTail}${chunk.toString("utf8")}`.slice(-STDERR_TAIL_BYTES)
  })

  const watchdog = spawnWatchdog({ pid, dir: profile.dir, execPath: options.execPath })
  const connection = new CdpConnection(pipeTransport(child))
  const exited: Promise<number | null> = new Promise((resolve) => {
    child.once("exit", (code) => resolve(code))
  })

  let closing: Promise<void> | null = null
  const close = async (): Promise<void> => {
    closing ??= (async () => {
      if (!connection.isClosed) {
        // a browser that is already wedged must not hold up teardown
        await connection.send("Browser.close", {}, { timeoutMs: 3_000 }).catch(() => undefined)
      }
      if (!(await settle(child, 5_000))) {
        process.kill(-pid, "SIGKILL")
        await settle(child, 2_000)
      }
      connection.close()
      // only safe once the group is gone: a live renderer rewrites the profile as it exits
      rmSync(profile.dir, { recursive: true, force: true, maxRetries: 5 })
      watchdog.release()
    })()
    return closing
  }

  return { pid, profileDir: profile.dir, connection, exited, stderrTail: () => stderrTail, close }
}
