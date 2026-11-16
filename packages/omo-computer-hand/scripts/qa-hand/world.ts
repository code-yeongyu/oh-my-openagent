import { spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir, userInfo } from "node:os"
import { join } from "node:path"

import {
  createHandEnsure,
  DaemonLauncher,
  LatchStore,
  resolveHandPaths,
  serveHostApi,
  type HandPaths,
} from "../../src/index.ts"

/** The fake-backend world a QA scenario runs in: one seam dir holding every root, the host API and the daemon. */
export interface World {
  readonly seam: string
  readonly paths: HandPaths
  readonly env: Readonly<Record<string, string>>
  readonly latch: LatchStore
  readonly launcher: DaemonLauncher
  readonly ensure: ReturnType<typeof createHandEnsure>
  /** What hand.status answers for the latch; the persisted file is the LatchStore's. */
  answerLatch(suspended: boolean): void
  close(): Promise<void>
}

const ONE_WINDOW = {
  windows: [
    {
      id: "101",
      title: "Notes",
      app: "Notes",
      pid: 4242,
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      focused: true,
      elevated: null,
    },
  ],
}

function seamEnv(seam: string): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: seam,
    OMO_COMPUTER_BACKEND: "fake",
    OMO_COMPUTER_FAKE_SCENARIO: join(seam, "scenario.json"),
    OMO_COMPUTER_FAKE_STOP_PATH: "live",
    OMO_COMPUTER_RUNTIME_DIR: seam,
  }
}

export function seamPaths(seam: string): HandPaths {
  const resolved = resolveHandPaths({
    env: { OMO_COMPUTER_RUNTIME_DIR: seam },
    fake: true,
    uid: userInfo().uid,
    platform: process.platform,
    home: userInfo().homedir,
    tmp: tmpdir(),
  })
  if (resolved.kind !== "resolved") throw new Error(`no hand paths: ${resolved.reason}`)
  return resolved.paths
}

/** The spawning host, built from source: the role a device service embeds. */
export async function spawningWorld(engine: string, existing?: string): Promise<World> {
  const seam = existing ?? mkdtempSync(join(tmpdir(), "omo-qa-hand-"))
  writeFileSync(join(seam, "scenario.json"), JSON.stringify(ONE_WINDOW))
  // Under the fake backend the engine scripts the host listener's identity verdict (on a real Linux
  // backend the leg is SO_PEERCRED's uid, which this same-uid host passes).
  writeFileSync(join(seam, "fake-host-identity"), "pass")
  // The hand's consent file (without one the engine admits reads only).
  mkdirSync(join(seam, "computer"), { recursive: true, mode: 0o700 })
  writeFileSync(
    join(seam, "computer", "consent.json"),
    JSON.stringify({
      v: 1,
      computerUse: true,
      remoteCommands: true,
      foreground: "policy",
      apps: { allow: [], deny: [], mentions: [] },
      protectedTableVersion: 3,
      stopHotkey: "ctrl+alt+shift+escape",
      foregroundInputLock: false,
      waylandPersistConsent: null,
    }),
    { mode: 0o600 },
  )
  const env = seamEnv(seam)
  const paths = seamPaths(seam)
  const latch = new LatchStore(paths.hostLatch)
  const launcher = new DaemonLauncher({
    engine,
    endpoint: paths.daemonEndpoint,
    lock: paths.daemonLock,
    env,
    latch: () => latch.get(),
    spawnDaemon: (command, args, childEnv) => {
      const child = spawn(command, [...args], { env: { ...childEnv }, stdio: ["pipe", "ignore", "inherit"] })
      return {
        pid: child.pid,
        stdin: child.stdin,
        exited: new Promise((resolve) => child.once("exit", () => resolve())),
        kill: () => child.kill("SIGTERM"),
      }
    },
  })
  const ensure = createHandEnsure({ launcher, remoteCommandsEnabled: () => true })
  let answered: boolean | undefined
  const status = () => ({
    consentFingerprint: "qa-fingerprint",
    latch: { ...latch.get(), ...(answered === undefined ? {} : { suspended: answered }) },
  })
  const api = await serveHostApi(paths.hostAddress, { status, ensure })
  return {
    seam,
    paths,
    env,
    latch,
    launcher,
    ensure,
    answerLatch: (suspended) => {
      answered = suspended
    },
    close: async () => {
      launcher.kill()
      await api.close()
    },
  }
}

/** Runs `command` with `stdin` lines and returns its stdout, stderr and exit code. */
export function run(
  command: string,
  args: readonly string[],
  env: Readonly<Record<string, string>>,
  stdin: string,
): Promise<{ readonly code: number | null; readonly out: string; readonly err: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], { env: { ...env }, stdio: ["pipe", "pipe", "pipe"] })
    let out = ""
    let err = ""
    child.stdout.on("data", (chunk: Buffer) => void (out += chunk.toString()))
    child.stderr.on("data", (chunk: Buffer) => void (err += chunk.toString()))
    child.once("close", (code) => resolve({ code, out, err }))
    child.stdin.end(stdin)
  })
}

export function check(ok: boolean, line: string): boolean {
  console.log(`${ok ? "PASS" : "FAIL"} ${line}`)
  return ok
}

/** Every line the fake backend's input sinks recorded under the seam. */
export function sinkLines(seam: string): readonly string[] {
  return readdirSync(seam)
    .filter((name) => name.startsWith("fake-sink-"))
    .flatMap((name) =>
      readFileSync(join(seam, name), "utf8")
        .split("\n")
        .filter((line) => line !== ""),
    )
}
